import fs from 'fs';

export function buildPostgresSslConfig(loggerTag = 'PostgresSSL') {
  if (process.env.DB_SSL !== 'true') {
    return false;
  }

  const caPath = process.env.DB_SSL_CA && process.env.DB_SSL_CA.trim();
  let caCert;

  if (caPath) {
    try {
      if (!fs.existsSync(caPath)) {
        throw new Error('CA file does not exist');
      }

      caCert = fs.readFileSync(caPath, 'utf8');
      if (!caCert || !caCert.trim()) {
        throw new Error('CA file is empty');
      }
    } catch (error) {
      console.error(`[${loggerTag}] Invalid DB_SSL_CA configuration: ${error.message}`);
      throw new Error('Invalid DB_SSL_CA configuration. Set a valid CA certificate file path.');
    }
  }

  return {
    rejectUnauthorized: true,
    ...(caCert && { ca: caCert })
  };
}
