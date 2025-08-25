const express = require('express');
const { auth, scopeIncludesAny } = require('express-oauth2-jwt-bearer');
const oneRosterRoutes = require('./routes/oneRoster');
const healthRoutes = require('./routes/health');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');
const fs = require('fs');
const file = fs.readFileSync('./config/swagger.yml', 'utf8');
const swaggerDocument = YAML.parse(file.replace("{OAUTH2_ISSUERBASEURL}",process.env.OAUTH2_ISSUERBASEURL)); // switched to YAML so I could comment out portions
//const swaggerDocument = require('../config/swagger.json');
require('dotenv').config();

const jwtCheck = auth({
    issuerBaseURL: process.env.OAUTH2_ISSUERBASEURL,
    audience: process.env.OAUTH2_AUDIENCE,
    tokenSigningAlg: process.env.OAUTH2_TOKENSIGNINGALG
});

const app = express();
app.use(express.json());
app.use('/health-check', healthRoutes);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// This supports no auth for testing (if OAUTH2_ISSUEBASERURL is empty)
// (scope check happens in `controllers/oneRosterManyController.js` and `controllers/oneRosterOneController.js`)
if (process.env.OAUTH2_ISSUERBASEURL!="") app.use('/ims/oneroster', jwtCheck, oneRosterRoutes);
else app.use('/ims/oneroster', oneRosterRoutes); // no auth

// Handle auth errors:
app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      message: 'Authentication failed: Invalid or missing token.',
      details: err.message
    });
  }
  // Pass other errors to the next error handler or default Express error handling
  next(err);
});

app.use('/swagger.json', (req, res) => {
  res.status(200).json(swaggerDocument);
});

app.use('/', (req, res) => {
  res.status(200).json({
    "version": "1.0.0",
    "urls": {
      "openApiMetadata": `${req.protocol}://${req.get('host')}/swagger.json`,
      "swaggerUI": `${req.protocol}://${req.get('host')}/docs`,
      "oauth": `${process.env.OAUTH2_ISSUERBASEURL}oauth/token`,
      "dataManagementApi": `${req.protocol}://${req.get('host')}/ims/oneroster/rostering/v1p2/`,
    }
  });
});

module.exports = app;
