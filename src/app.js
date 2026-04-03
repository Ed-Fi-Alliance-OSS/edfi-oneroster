// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import express from 'express';
import cors from 'cors';
import { auth } from 'express-oauth2-jwt-bearer';
import { jwtVerifyWithPem } from './middleware/jwtVerifyWithPem.js';
import { extractTenantMiddleware } from './middleware/tenantMiddleware.js';
import { isMultiTenancyEnabled } from './config/multi-tenancy-config.js';
import { getOdsContextConfig, buildRoutePattern } from './config/ods-context-config.js';
import oneRosterRoutes from './routes/oneRoster.js';
import discoveryRoutes from './routes/discovery.js';
import rateLimit from 'express-rate-limit';
import healthRoutes from './routes/health.js';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import fs from 'fs';
import { buildSwaggerServers } from './services/swaggerServerBuilder.js';

// Rate limit config for /ims/oneroster endpoints
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000; // default 1 min
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 60; // default 60 reqs/min
const limiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});

// Safe URL join
function joinUrl(base, path) {
  if (!base) return path;
  if (!path) return base;
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

const MAX_BASE_PATH_LENGTH = 1024;

function normalizeBasePath(basePath) {
  if (!basePath || basePath === '/') return '';
  const safeBasePath = basePath.slice(0, MAX_BASE_PATH_LENGTH);
  return '/' + safeBasePath.replace(/^\/+|\/+$/g, '');
}

function getExternalBaseUrl(req) {
  const forwardedProto = req.get('x-forwarded-proto');
  const forwardedHost = req.get('x-forwarded-host');
  const forwardedPrefix = req.get('x-forwarded-prefix');

  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host');

  const basePath = normalizeBasePath(forwardedPrefix || process.env.API_BASE_PATH || '');
  return `${protocol}://${host}${basePath}`;

}

const file = fs.readFileSync('./config/swagger.yml', 'utf8');
const tokenUrl = joinUrl(process.env.OAUTH2_ISSUERBASEURL, 'oauth/token');
const swaggerDocument = YAML.parse(file.replace("{OAUTH_TOKEN_URL}", tokenUrl));

// Require OAuth configuration for all environments.
let jwtCheck = (req, res, next) => { next(); };
if (!process.env.OAUTH2_AUDIENCE || !process.env.OAUTH2_ISSUERBASEURL) {
  throw new Error('OAUTH2_AUDIENCE and OAUTH2_ISSUERBASEURL are required to start the server.');
}
if (process.env.OAUTH2_PUBLIC_KEY_PEM) {
  // Validate required env vars for PEM-based JWT verification
  jwtCheck = jwtVerifyWithPem(
    process.env.OAUTH2_PUBLIC_KEY_PEM,
    process.env.OAUTH2_AUDIENCE,
    process.env.OAUTH2_ISSUERBASEURL
  );
} else if (process.env.OAUTH2_AUDIENCE) {
  // Fallback to express-oauth2-jwt-bearer
  jwtCheck = auth({
    issuerBaseURL: process.env.OAUTH2_ISSUERBASEURL,
    audience: process.env.OAUTH2_AUDIENCE,
    tokenSigningAlg: process.env.OAUTH2_TOKENSIGNINGALG
  });
}

const app = express();

// Configurable trust proxy: expect TRUST_PROXY to be "true" or "false".
const trustProxyEnabled = (process.env.TRUST_PROXY || 'false').toLowerCase() === 'true';
app.set('trust proxy', trustProxyEnabled);

// Configurable CORS origins
const allowedOrigins = process.env.CORS_ORIGINS;
let corsOptions;
if (!allowedOrigins) {
  corsOptions = { origin: true };
} else {
  const originsArray = allowedOrigins.split(',').map(o => o.trim());
  corsOptions = {
    origin: function (origin, callback) {
      // Allow requests with no origin (curl, postman, server-to-server)
      if (!origin) return callback(null, true);
      if (originsArray.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error(`Not allowed by CORS: ${origin}`), false);
      }
    }
  };
}
app.use(cors(corsOptions));
app.use(express.json());

// Build dynamic route pattern for OneRoster API based on multi-tenancy and context config
const multiTenancyEnabled = isMultiTenancyEnabled();
const contextConfig = getOdsContextConfig();
const routePrefix = buildRoutePattern(multiTenancyEnabled, contextConfig);

// Health check (always at root, no dynamic routing)
app.use('/health-check', healthRoutes);

// Swagger documentation handler
const swaggerHandler = swaggerUi.serve;
const swaggerSetup = async (req, res) => {
  const baseUrl = process.env.API_SERVER_URL || getExternalBaseUrl(req);
  const servers = await buildSwaggerServers(baseUrl);

  const runtimeDoc = JSON.parse(JSON.stringify(swaggerDocument));
  runtimeDoc.servers = servers;
  swaggerUi.setup(runtimeDoc)(req, res);
};

// OAuth token redirect handler
const oauthHandler = (req, res) => {
  const oauthTokenUrl = joinUrl(process.env.OAUTH2_ISSUERBASEURL, 'oauth/token');
  res.redirect(307, oauthTokenUrl);
};

// Swagger JSON handler
const swaggerJsonHandler = async (req, res) => {
  const baseUrl = process.env.API_SERVER_URL || getExternalBaseUrl(req);
  const servers = await buildSwaggerServers(baseUrl);

  const runtimeDoc = JSON.parse(JSON.stringify(swaggerDocument));
  runtimeDoc.servers = servers;
  res.status(200).json(runtimeDoc);
};

// Mount swagger, oauth, and docs routes with dynamic routing
// IMPORTANT: Mount these BEFORE discovery routes to prevent /:contextParam from catching them
// Always mount at base paths for backward compatibility
app.use('/docs', swaggerHandler, swaggerSetup);
app.use('/oauth/token', oauthHandler);
app.use('/swagger.json', swaggerJsonHandler);

// Additionally mount with prefix when context routing is enabled
if (routePrefix) {
  app.use(`${routePrefix}/docs`, swaggerHandler, swaggerSetup);
  app.use(`${routePrefix}/oauth/token`, oauthHandler);
  app.use(`${routePrefix}/swagger.json`, swaggerJsonHandler);
}

// Discovery endpoint (no auth required for metadata)
// IMPORTANT: Mounted after swagger/docs/oauth to prevent route conflicts
app.use('/', discoveryRoutes);

// Mount OneRoster routes with dynamic pattern
// Examples:
// - Single-tenant, no context: /ims/oneroster
// - Single-tenant with context: /:schoolYear/ims/oneroster
// - Multi-tenant, no context: /:tenantId/ims/oneroster
// - Multi-tenant with context: /:tenantId/:schoolYear/ims/oneroster
const oneRosterPath = routePrefix ? `${routePrefix}/ims/oneroster` : '/ims/oneroster';
app.use(oneRosterPath, limiter, jwtCheck, extractTenantMiddleware, oneRosterRoutes);

// Handle auth errors:
app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
      imsx_description: 'Authentication failed: Invalid or missing token.'
    });
  }

  // Handle JSON syntax errors (422)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(422).json({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
      imsx_description: 'Request contains well-formed but semantically erroneous JSON.'
    });
  }

  // Handle rate limiting (429) - basic implementation
  if (err.name === 'TooManyRequestsError') {
    return res.status(429).json({
      imsx_codeMajor: 'failure',
      imsx_severity: 'error',
      imsx_description: 'Too many requests. Server is busy, retry later.'
    });
  }

  // Pass other errors to the next error handler or default Express error handling
  next(err);
});

export default app;
