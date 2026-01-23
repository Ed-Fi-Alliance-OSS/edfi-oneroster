const { jwtVerify, importSPKI } = require('jose');

/**
 * Middleware to verify JWT using a PEM-encoded public key from config
 * @param {string} publicKeyPem - PEM-encoded public key
 * @param {string} audience - Expected audience
 * @param {string} issuer - Expected issuer
 * @returns Express middleware
 */
function jwtVerifyWithPem(publicKeyPem, audience, issuer) {
  return async function (req, res, next) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        imsx_codeMajor: 'failure',
        imsx_severity: 'error',
        imsx_description: 'Missing or invalid Authorization header.'
      });
    }
    const token = authHeader.substring(7);
    try {
      // Replace escaped newlines with real newlines for PEM
      const fixedPem = publicKeyPem.replace(/\\n/g, '\n');
      const publicKey = await importSPKI(fixedPem, 'RS256');
      const { payload } = await jwtVerify(token, publicKey, {
        audience,
        issuer
      });
      req.auth = { payload };
      next();
    } catch (err) {
      console.error('JWT verification error:', err);
      return res.status(401).json({
        imsx_codeMajor: 'failure',
        imsx_severity: 'error',
        imsx_description: 'Invalid or expired token.'
      });
    }
  };
}

module.exports = { jwtVerifyWithPem };
