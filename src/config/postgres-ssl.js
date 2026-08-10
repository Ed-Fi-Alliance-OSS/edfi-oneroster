import fs from 'node:fs';

const SSL_FILE_OPTIONS = {
  sslrootcert: 'ca',
  sslcert: 'cert',
  sslkey: 'key',
};

// libpq: verify-ca/verify-full; Npgsql: VerifyCA/VerifyFull
const SSL_MODES_WITH_VALIDATION = new Set([
  'require',
  'verify-ca',
  'verify-full',
  'verifyca',
  'verifyfull',
]);

const readFile = (filePath, optionName) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`[Config] Failed to read ${optionName}: ${filePath} - ${error.message}`);
    return undefined;
  }
};

export const buildPostgresSslConfig = (connectionOptions) => {
  const sslConfig = {};

  // libpq: sslmode; Npgsql ("SSL Mode" after lowercasing): "ssl mode"
  const sslMode = (connectionOptions.sslmode ?? connectionOptions['ssl mode'])?.toLowerCase();

  if (sslMode === 'disable') {
    return false;
  }

  if (sslMode === 'prefer' || sslMode === 'allow') {
    // node-postgres cannot negotiate opportunistic TLS: any truthy ssl value makes TLS
    // mandatory (see pg connection.js SSLRequest handling). Return false explicitly
    // so PGSSLMODE cannot silently re-require TLS.
    console.warn(
      `[Config] sslmode='${sslMode}' requests opportunistic TLS, which node-postgres cannot negotiate; connecting without TLS and ignoring any certificate parameters. Use 'require' or 'verify-full' to enforce TLS.`
    );
    return false;
  }

  if (sslMode) {
    sslConfig.rejectUnauthorized = SSL_MODES_WITH_VALIDATION.has(sslMode);
  }

  Object.entries(SSL_FILE_OPTIONS).forEach(([optionName, sslProperty]) => {
    const filePath = connectionOptions[optionName];

    if (!filePath) return;

    const fileContent = readFile(filePath, optionName);

    if (fileContent) {
      sslConfig[sslProperty] = fileContent;
    }
  });

  return Object.keys(sslConfig).length > 0 ? sslConfig : undefined;
};
