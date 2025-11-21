// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const express = require('express');
const { auth } = require('express-oauth2-jwt-bearer');
const oneRosterRoutes = require('./routes/oneRoster');
const healthRoutes = require('./routes/health');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');
const fs = require('fs');
const file = fs.readFileSync('./config/swagger.yml', 'utf8');
const swaggerDocument = YAML.parse(file.replace("{OAUTH2_ISSUERBASEURL}",process.env.OAUTH2_ISSUERBASEURL)); // switched to YAML so I could comment out portions
//const swaggerDocument = require('../config/swagger.json');
require('dotenv').config();

// This supports no auth for testing (if OAUTH2_ISSUEBASERURL is empty)
// (scope check happens in `controllers/unified/oneRosterController.js`)
let jwtCheck = (req, res, next) => { next(); };
if (process.env.OAUTH2_AUDIENCE) {
  jwtCheck = auth({
    issuerBaseURL: process.env.OAUTH2_ISSUERBASEURL,
    audience: process.env.OAUTH2_AUDIENCE,
    tokenSigningAlg: process.env.OAUTH2_TOKENSIGNINGALG
  });
}

const app = express();
app.use(express.json());
app.use('/health-check', healthRoutes);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use('/ims/oneroster', jwtCheck, oneRosterRoutes);

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
  res.status(200).json(swaggerDocument);
});

app.use('/', (req, res) => {
  const dbType = process.env.DB_TYPE === 'mssql' ? 'MSSQLSERVER' : 'POSTGRESQL';
  res.status(200).json({
    "version": "1.0.0",
    "database": dbType,
    "urls": {
      "openApiMetadata": `${req.protocol}://${req.get('host')}/swagger.json`,
      "swaggerUI": `${req.protocol}://${req.get('host')}/docs`,
      "oauth": `${process.env.OAUTH2_ISSUERBASEURL}oauth/token`,
      "dataManagementApi": `${req.protocol}://${req.get('host')}/ims/oneroster/rostering/v1p2/`,
    }
  });
});

module.exports = app;
