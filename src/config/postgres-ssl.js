import fs from 'node:fs';

const SSL_FILE_OPTIONS = {
  sslrootcert: 'ca',
  sslcert: 'cert',
  sslkey: 'key',
};

const SSL_MODES_WITH_VALIDATION = new Set(['require', 'verify-ca', 'verify-full']);

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

  const sslMode = connectionOptions.sslmode?.toLowerCase();

  if (sslMode === 'disable') {
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
