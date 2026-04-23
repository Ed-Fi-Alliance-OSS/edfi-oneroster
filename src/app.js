// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import express from 'express';
import cors from 'cors';
import { auth } from 'express-oauth2-jwt-bearer';
import { jwtVerifyWithPem } from './middleware/jwtVerifyWithPem.js';
import { extractTenantMiddleware } from './middleware/tenantMiddleware.js';
import { validateOdsInstanceFlow } from './middleware/odsInstanceValidationMiddleware.js';
import { isMultiTenancyEnabled } from './config/multi-tenancy-config.js';
import { getOdsContextConfig, buildRoutePattern } from './config/ods-context-config.js';
import oneRosterRoutes from './routes/oneRoster.js';
import discoveryRoutes from './routes/discovery.js';
import rateLimit from 'express-rate-limit';
import healthRoutes from './routes/health.js';
import YAML from 'yaml';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';
import { buildSwaggerServers } from './services/swaggerServerBuilder.js';
import { buildSwaggerSecuritySchemes } from './services/swaggerSecurityBuilder.js';
import { joinUrl, getExternalBaseUrl } from './utils/urlHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const _require = createRequire(import.meta.url);
const swaggerUiDist = path.dirname(_require.resolve('swagger-ui-dist/package.json'));
const swaggerIndexHtml = path.join(__dirname, 'public', 'swagger-index.html');

// Rate limit config for /ims/oneroster endpoints
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000; // default 1 min
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100; // default 100 reqs/min
// Configurable trust proxy for rate limiting (must be set before creating limiter)
const trustProxyEnabled = (process.env.TRUST_PROXY || 'false').toLowerCase() === 'true';
const limiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  // Standard IP-based rate limiting: each IP address gets its own rate limit counter.
  // When behind a reverse proxy (NGINX, IIS, ARR), set TRUST_PROXY=true to use the
  // X-Forwarded-For header to identify the real client IP.
  validate: { trustProxy: trustProxyEnabled },
});

// Rate limiter for docs/file-serving endpoints
const docsRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: trustProxyEnabled },
});

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

// Apply trust proxy configuration
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

// Serve swagger-ui-dist static assets (JS, CSS, fonts) at /docs/assets
app.use('/docs/assets', express.static(swaggerUiDist));

// Helper function to update operation security references
function updateOperationSecurity(runtimeDoc, securitySchemeNames) {
  if (!runtimeDoc.paths) return;

  for (const path in runtimeDoc.paths) {
    for (const method in runtimeDoc.paths[path]) {
      const operation = runtimeDoc.paths[path][method];
      if (operation && operation.security) {
        // Replace oauth2_auth references with new scheme names
        const updatedSecurity = [];
        for (const securityItem of operation.security) {
          if (securityItem.oauth2_auth) {
            const scopes = securityItem.oauth2_auth;
            // Add all available security schemes with the same scopes
            for (const schemeName of securitySchemeNames) {
              updatedSecurity.push({ [schemeName]: scopes });
            }
          } else {
            updatedSecurity.push(securityItem);
          }
        }
        operation.security = updatedSecurity;
      }
    }
  }
}

// Swagger documentation handler — serves the external HTML which fetches /swagger.json
const swaggerSetup = (req, res) => res.sendFile(swaggerIndexHtml);

// OAuth token redirect handler
const oauthHandler = (req, res) => {
  const oauthTokenUrl = joinUrl(process.env.OAUTH2_ISSUERBASEURL, 'oauth/token');
  res.redirect(307, oauthTokenUrl);
};

// Swagger JSON handler
const swaggerJsonHandler = async (req, res) => {
  try{
  const baseUrl = process.env.API_SERVER_URL || getExternalBaseUrl(req);
  const servers = await buildSwaggerServers(baseUrl);

  const runtimeDoc = JSON.parse(JSON.stringify(swaggerDocument));
  runtimeDoc.servers = servers;

  // Update OAuth token URL to match server configuration with tenant/context routing
  // Build dynamic security schemes for each tenant/context combination
  if (runtimeDoc.components?.securitySchemes?.oauth2_auth) {
    const existingScopes = runtimeDoc.components.securitySchemes.oauth2_auth.flows?.clientCredentials?.scopes || {};
    const securitySchemes = await buildSwaggerSecuritySchemes(process.env.OAUTH2_ISSUERBASEURL, existingScopes);
    runtimeDoc.components.securitySchemes = securitySchemes;

    // Update all operation security references to use new scheme names
    const securitySchemeNames = Object.keys(securitySchemes);
    updateOperationSecurity(runtimeDoc, securitySchemeNames);
  }
  res.status(200).json(runtimeDoc);
}
catch (err) {
 next(err);
};
}

// Mount swagger, oauth, and docs routes with dynamic routing
app.use('/docs', docsRateLimiter, swaggerSetup);
app.use('/oauth/token', oauthHandler);
app.use('/swagger.json', docsRateLimiter, swaggerJsonHandler);

// Additionally mount with prefix when context routing is enabled
if (routePrefix) {
  app.use(`${routePrefix}/docs/assets`, express.static(swaggerUiDist));
  app.use(`${routePrefix}/docs`, docsRateLimiter, swaggerSetup);
  app.use(`${routePrefix}/oauth/token`, oauthHandler);
  app.use(`${routePrefix}/swagger.json`, docsRateLimiter, swaggerJsonHandler);
}

// Discovery endpoint (no auth required for metadata)
// IMPORTANT: Mounted after swagger/docs/oauth to prevent route conflicts
app.use('/', discoveryRoutes);

// Mount OneRoster routes with dynamic pattern and middleware
const oneRosterPath = routePrefix ? `${routePrefix}/ims/oneroster` : '/ims/oneroster';
app.use(oneRosterPath, limiter, jwtCheck, extractTenantMiddleware, validateOdsInstanceFlow, oneRosterRoutes);

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
