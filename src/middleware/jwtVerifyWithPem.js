const { jwtVerify, importSPKI } = require('jose');

/**
 * Middleware to verify JWT using a PEM-encoded public key from config
 * @param {string} publicKeyPem - PEM-encoded public key
 * @param {string} audience - Expected audience
 * @param {string} issuer - Expected issuer
 * @returns Express middleware
 */
function normalizeIssuer(iss) {
  return iss ? iss.replace(/\/+$/, '') : iss;
}

function jwtVerifyWithPem(publicKeyPem, audience, issuer) {
  // Replace escaped newlines with real newlines for PEM
  const fixedPem = publicKeyPem.replace(/\\n/g, '\n');
  const algorithm = process.env.OAUTH2_TOKENSIGNINGALG || 'RS256';
  let publicKeyPromise = null;

  function getPublicKey() {
    if (!publicKeyPromise) {
      publicKeyPromise = importSPKI(fixedPem, 'RS256').catch((err) => {
        // Reset the cached promise on failure to avoid permanently caching a rejected promise
        publicKeyPromise = null;
        throw err;
      });
    }
    return publicKeyPromise;
  }

  const normalizedIssuer = normalizeIssuer(issuer);

  return async function (req, res, next) {
    const authHeader = req.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        imsx_codeMajor: 'failure',
        imsx_severity: 'error',
        imsx_description: 'Missing or invalid Authorization header.'
      });
    }
    const token = authHeader.substring(7).trim();
    if (!token) {
      return res.status(401).json({
        imsx_codeMajor: 'failure',
        imsx_severity: 'error',
        imsx_description: 'Missing or invalid Authorization header.'
      });
    }
    try {
      const publicKey = await getPublicKey();
      // Accept any issuer, validate manually after
      const { payload } = await jwtVerify(token, publicKey, {
        audience,
        issuer: undefined
      });
      // Normalize both configured and token issuer for comparison
      const tokenIssuer = normalizeIssuer(payload.iss);
      if (tokenIssuer !== normalizedIssuer) {
        throw new Error(`Issuer claim mismatch: expected '${normalizedIssuer}', got '${tokenIssuer}'`);
      }
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
