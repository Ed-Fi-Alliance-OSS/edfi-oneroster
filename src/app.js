// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const express = require('express');
const cors = require('cors');
const { auth } = require('express-oauth2-jwt-bearer');
const { jwtVerifyWithPem } = require('./middleware/jwtVerifyWithPem');
const oneRosterRoutes = require('./routes/oneRoster');
const rateLimit = require('express-rate-limit');

// Rate limit config for /ims/oneroster endpoints
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000; // default 1 min
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 60; // default 60 reqs/min
const limiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});

const healthRoutes = require('./routes/health');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Safe URL join
function joinUrl(base, path) {
  if (!base) return path;
  if (!path) return base;
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

function normalizeBasePath(basePath) {
  if (!basePath) return '';
  const value = String(basePath).trim();
  if (!value || value === '/') return '';
  return '/' + value.replace(/^\/+|\/+$/g, '');
}

const configuredBasePath = normalizeBasePath(process.env.API_BASE_PATH || process.env.BASE_PATH);

function resolveBasePath(req) {
  return configuredBasePath || req.originalVirtualDirectory || (() => {
    const pathOnly = (req.originalUrl || '').split('?')[0];
    if (!pathOnly || pathOnly === '/') return '';
    const singleSegmentMatch = pathOnly.match(/^\/[^/]+\/?$/);
    return singleSegmentMatch ? normalizeBasePath(pathOnly) : '';
  })();
}

function resolveServerUrl(req) {
  return `${req.protocol}://${req.get('host')}${resolveBasePath(req)}`;
}

const swaggerPath = path.join(__dirname, '..', 'config', 'swagger.yml');
const file = fs.readFileSync(swaggerPath, 'utf8');
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

// Support IIS virtual directories (for example: /oneroster/*) by stripping one
// leading path segment when the remainder matches known routes.
app.use((req, _res, next) => {
  const [pathname, query = ''] = req.url.split('?');
  const knownPrefixes = ['/health-check', '/docs', '/swagger.json', '/ims/oneroster'];
  const matchesKnownPrefix = (pathValue) => {
    return knownPrefixes.some(prefix => pathValue === prefix || pathValue.startsWith(`${prefix}/`));
  };

  if (matchesKnownPrefix(pathname)) {
    return next();
  }

  const secondSlashIndex = pathname.indexOf('/', 1);
  if (secondSlashIndex > 0) {
    const strippedPathname = pathname.substring(secondSlashIndex);
    if (matchesKnownPrefix(strippedPathname)) {
      req.originalVirtualDirectory = pathname.substring(0, secondSlashIndex);
      req.url = query ? `${strippedPathname}?${query}` : strippedPathname;
    }
  }

  next();
});

app.use('/health-check', healthRoutes);
app.use('/docs', swaggerUi.serve, (req, res, next) => {
  const dynamicSwaggerDocument = {
    ...swaggerDocument,
    servers: [{ url: resolveServerUrl(req) }]
  };
  return swaggerUi.setup(dynamicSwaggerDocument)(req, res, next);
});
app.use('/ims/oneroster', limiter, jwtCheck, oneRosterRoutes);

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

app.use('/swagger.json', (req, res) => {
  const dynamicSwaggerDocument = {
    ...swaggerDocument,
    servers: [{ url: resolveServerUrl(req) }]
  };
  res.status(200).json(dynamicSwaggerDocument);
});

app.use('/', (req, res) => {
  const resolvedBasePath = resolveBasePath(req);
  const appRootUrl = `${req.protocol}://${req.get('host')}${resolvedBasePath}`;
  const dbType = process.env.DB_TYPE === 'mssql' ? 'MSSQLSERVER' : 'POSTGRESQL';
  res.status(200).json({
    "version": "1.0.0",
    "database": dbType,
    "urls": {
      "openApiMetadata": `${appRootUrl}/swagger.json`,
      "swaggerUI": `${appRootUrl}/docs`,
      "oauth": `${tokenUrl}`,
      "dataManagementApi": `${appRootUrl}/ims/oneroster/rostering/v1p2/`,
    }
  });
});

module.exports = app;
