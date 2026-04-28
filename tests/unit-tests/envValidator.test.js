// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

describe('envValidator', () => {
  let originalEnv;
  let validateEnvironmentVariables;
  let validateAndExit;

  beforeEach(async () => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set up a valid default environment
    process.env.PORT = '3000';
    process.env.DB_TYPE = 'postgres';
    process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY = 'test-key';
    process.env.CONNECTION_CONFIG = '{"adminConnection": "test"}';
    process.env.PG_BOSS_CONNECTION_CONFIG = '{"adminConnection": "test"}';
    process.env.OAUTH2_ISSUERBASEURL = 'https://auth.example.com';
    process.env.OAUTH2_AUDIENCE = 'https://api.example.com';
    process.env.OAUTH2_TOKENSIGNINGALG = 'RS256';
    process.env.OAUTH2_PUBLIC_KEY_PEM = '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----';
    process.env.MULTITENANCY_ENABLED = 'false';

    // Import the module
    const envValidator = await import('../../src/utils/envValidator.js');
    validateEnvironmentVariables = envValidator.validateEnvironmentVariables;
    validateAndExit = envValidator.validateAndExit;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('validateEnvironmentVariables', () => {
    test('should pass validation with all required variables set correctly', () => {
      const result = validateEnvironmentVariables();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    describe('PORT validation', () => {
      test('should fail if PORT is not set', () => {
        delete process.env.PORT;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('PORT must not be empty');
      });

      test('should fail if PORT is empty string', () => {
        process.env.PORT = '';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('PORT must not be empty');
      });
    });

    describe('DB_TYPE validation', () => {
      test('should fail if DB_TYPE is not set', () => {
        delete process.env.DB_TYPE;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('DB_TYPE must not be empty');
      });

      test('should fail if DB_TYPE is empty string', () => {
        process.env.DB_TYPE = '';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('DB_TYPE must not be empty');
      });

      test('should fail if DB_TYPE is not "mssql" or "postgres"', () => {
        process.env.DB_TYPE = 'mysql';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('DB_TYPE must be either "mssql" or "postgres"');
      });

      test('should pass if DB_TYPE is "mssql"', () => {
        process.env.DB_TYPE = 'mssql';
        delete process.env.PG_BOSS_CONNECTION_CONFIG; // Not required for mssql
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(true);
      });

      test('should pass if DB_TYPE is "postgres"', () => {
        process.env.DB_TYPE = 'postgres';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(true);
      });
    });

    describe('ODS_CONNECTION_STRING_ENCRYPTION_KEY validation', () => {
      test('should fail if ODS_CONNECTION_STRING_ENCRYPTION_KEY is not set', () => {
        delete process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('ODS_CONNECTION_STRING_ENCRYPTION_KEY must not be empty');
      });

      test('should fail if ODS_CONNECTION_STRING_ENCRYPTION_KEY is empty string', () => {
        process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY = '';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('ODS_CONNECTION_STRING_ENCRYPTION_KEY must not be empty');
      });
    });

    describe('CONNECTION_CONFIG validation (single tenancy)', () => {
      test('should fail if CONNECTION_CONFIG is not set when MULTITENANCY_ENABLED is false', () => {
        process.env.MULTITENANCY_ENABLED = 'false';
        delete process.env.CONNECTION_CONFIG;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('CONNECTION_CONFIG must not be empty when MULTITENANCY_ENABLED is false');
      });

      test('should fail if CONNECTION_CONFIG is empty when MULTITENANCY_ENABLED is false', () => {
        process.env.MULTITENANCY_ENABLED = 'false';
        process.env.CONNECTION_CONFIG = '';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('CONNECTION_CONFIG must not be empty when MULTITENANCY_ENABLED is false');
      });

      test('should not require CONNECTION_CONFIG when MULTITENANCY_ENABLED is true', () => {
        process.env.MULTITENANCY_ENABLED = 'true';
        process.env.TENANTS_CONNECTION_CONFIG = '{"tenant1": {"adminConnection": "test"}}';
        delete process.env.CONNECTION_CONFIG;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(true);
      });
    });

    describe('PG_BOSS_CONNECTION_CONFIG validation', () => {
      test('should fail if PG_BOSS_CONNECTION_CONFIG is not set when DB_TYPE is postgres', () => {
        process.env.DB_TYPE = 'postgres';
        delete process.env.PG_BOSS_CONNECTION_CONFIG;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('PG_BOSS_CONNECTION_CONFIG must not be empty when DB_TYPE is postgres');
      });

      test('should fail if PG_BOSS_CONNECTION_CONFIG is empty when DB_TYPE is postgres', () => {
        process.env.DB_TYPE = 'postgres';
        process.env.PG_BOSS_CONNECTION_CONFIG = '';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('PG_BOSS_CONNECTION_CONFIG must not be empty when DB_TYPE is postgres');
      });

      test('should not require PG_BOSS_CONNECTION_CONFIG when DB_TYPE is mssql', () => {
        process.env.DB_TYPE = 'mssql';
        delete process.env.PG_BOSS_CONNECTION_CONFIG;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(true);
      });
    });

    describe('OAUTH2_ISSUERBASEURL validation', () => {
      test('should fail if OAUTH2_ISSUERBASEURL is not set', () => {
        delete process.env.OAUTH2_ISSUERBASEURL;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('OAUTH2_ISSUERBASEURL must not be empty');
      });

      test('should fail if OAUTH2_ISSUERBASEURL is empty string', () => {
        process.env.OAUTH2_ISSUERBASEURL = '';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('OAUTH2_ISSUERBASEURL must not be empty');
      });
    });

    describe('OAUTH2_AUDIENCE validation', () => {
      test('should fail if OAUTH2_AUDIENCE is not set', () => {
        delete process.env.OAUTH2_AUDIENCE;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('OAUTH2_AUDIENCE must not be empty');
      });

      test('should fail if OAUTH2_AUDIENCE is empty string', () => {
        process.env.OAUTH2_AUDIENCE = '';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('OAUTH2_AUDIENCE must not be empty');
      });
    });

    describe('OAUTH2_TOKENSIGNINGALG validation', () => {
      test('should fail if OAUTH2_TOKENSIGNINGALG is not set', () => {
        delete process.env.OAUTH2_TOKENSIGNINGALG;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('OAUTH2_TOKENSIGNINGALG must not be empty');
      });

      test('should fail if OAUTH2_TOKENSIGNINGALG is empty string', () => {
        process.env.OAUTH2_TOKENSIGNINGALG = '';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('OAUTH2_TOKENSIGNINGALG must not be empty');
      });

      test('should fail if OAUTH2_TOKENSIGNINGALG is not "RS256"', () => {
        process.env.OAUTH2_TOKENSIGNINGALG = 'HS256';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('OAUTH2_TOKENSIGNINGALG must be "RS256"');
      });

      test('should pass if OAUTH2_TOKENSIGNINGALG is "RS256"', () => {
        process.env.OAUTH2_TOKENSIGNINGALG = 'RS256';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(true);
      });
    });

    describe('OAUTH2_PUBLIC_KEY_PEM validation', () => {
      test('should fail if OAUTH2_PUBLIC_KEY_PEM is not set', () => {
        delete process.env.OAUTH2_PUBLIC_KEY_PEM;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('OAUTH2_PUBLIC_KEY_PEM must not be empty');
      });

      test('should fail if OAUTH2_PUBLIC_KEY_PEM is empty string', () => {
        process.env.OAUTH2_PUBLIC_KEY_PEM = '';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('OAUTH2_PUBLIC_KEY_PEM must not be empty');
      });
    });

    describe('TENANTS_CONNECTION_CONFIG validation (multi-tenancy)', () => {
      test('should fail if TENANTS_CONNECTION_CONFIG is not set when MULTITENANCY_ENABLED is true', () => {
        process.env.MULTITENANCY_ENABLED = 'true';
        delete process.env.TENANTS_CONNECTION_CONFIG;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('TENANTS_CONNECTION_CONFIG must not be empty when MULTITENANCY_ENABLED is true');
      });

      test('should fail if TENANTS_CONNECTION_CONFIG is empty when MULTITENANCY_ENABLED is true', () => {
        process.env.MULTITENANCY_ENABLED = 'true';
        process.env.TENANTS_CONNECTION_CONFIG = '';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('TENANTS_CONNECTION_CONFIG must not be empty when MULTITENANCY_ENABLED is true');
      });

      test('should not require TENANTS_CONNECTION_CONFIG when MULTITENANCY_ENABLED is false', () => {
        process.env.MULTITENANCY_ENABLED = 'false';
        delete process.env.TENANTS_CONNECTION_CONFIG;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(true);
      });
    });

    describe('TLS configuration validation (HTTPS)', () => {
      test('should fail if TLS_KEY_PATH is not set when ENABLE_HTTPS is true', () => {
        process.env.ENABLE_HTTPS = 'true';
        delete process.env.TLS_KEY_PATH;
        process.env.TLS_CERT_PATH = './certs/tls.crt';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('TLS_KEY_PATH must not be empty when ENABLE_HTTPS is true');
      });

      test('should fail if TLS_KEY_PATH is empty when ENABLE_HTTPS is true', () => {
        process.env.ENABLE_HTTPS = 'true';
        process.env.TLS_KEY_PATH = '';
        process.env.TLS_CERT_PATH = './certs/tls.crt';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('TLS_KEY_PATH must not be empty when ENABLE_HTTPS is true');
      });

      test('should fail if TLS_CERT_PATH is not set when ENABLE_HTTPS is true', () => {
        process.env.ENABLE_HTTPS = 'true';
        process.env.TLS_KEY_PATH = './certs/tls.key';
        delete process.env.TLS_CERT_PATH;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('TLS_CERT_PATH must not be empty when ENABLE_HTTPS is true');
      });

      test('should fail if TLS_CERT_PATH is empty when ENABLE_HTTPS is true', () => {
        process.env.ENABLE_HTTPS = 'true';
        process.env.TLS_KEY_PATH = './certs/tls.key';
        process.env.TLS_CERT_PATH = '';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('TLS_CERT_PATH must not be empty when ENABLE_HTTPS is true');
      });

      test('should fail if both TLS_KEY_PATH and TLS_CERT_PATH are not set when ENABLE_HTTPS is true', () => {
        process.env.ENABLE_HTTPS = 'true';
        delete process.env.TLS_KEY_PATH;
        delete process.env.TLS_CERT_PATH;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('TLS_KEY_PATH must not be empty when ENABLE_HTTPS is true');
        expect(result.errors).toContain('TLS_CERT_PATH must not be empty when ENABLE_HTTPS is true');
      });

      test('should not require TLS paths when ENABLE_HTTPS is false', () => {
        process.env.ENABLE_HTTPS = 'false';
        delete process.env.TLS_KEY_PATH;
        delete process.env.TLS_CERT_PATH;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(true);
      });

      test('should not require TLS paths when ENABLE_HTTPS is not set', () => {
        delete process.env.ENABLE_HTTPS;
        delete process.env.TLS_KEY_PATH;
        delete process.env.TLS_CERT_PATH;
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(true);
      });

      test('should pass when ENABLE_HTTPS is true and both TLS paths are set', () => {
        process.env.ENABLE_HTTPS = 'true';
        process.env.TLS_KEY_PATH = './certs/tls.key';
        process.env.TLS_CERT_PATH = './certs/tls.crt';
        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(true);
      });
    });

    describe('multiple validation errors', () => {
      test('should return all validation errors when multiple fields are invalid', () => {
        delete process.env.PORT;
        delete process.env.DB_TYPE;
        delete process.env.OAUTH2_AUDIENCE;
        process.env.OAUTH2_TOKENSIGNINGALG = 'HS256';
        process.env.ENABLE_HTTPS = 'true';
        delete process.env.TLS_KEY_PATH;

        const result = validateEnvironmentVariables();
        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(5);
        expect(result.errors).toContain('PORT must not be empty');
        expect(result.errors).toContain('DB_TYPE must not be empty');
        expect(result.errors).toContain('OAUTH2_AUDIENCE must not be empty');
        expect(result.errors).toContain('OAUTH2_TOKENSIGNINGALG must be "RS256"');
        expect(result.errors).toContain('TLS_KEY_PATH must not be empty when ENABLE_HTTPS is true');
      });
    });
  });

  describe('validateAndExit', () => {
    test('should not exit when validation passes', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
      const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
      const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      validateAndExit();

      expect(mockExit).not.toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith('✅ Environment variable validation passed');
      expect(mockConsoleError).not.toHaveBeenCalled();

      mockExit.mockRestore();
      mockConsoleLog.mockRestore();
      mockConsoleError.mockRestore();
    });

    test('should exit with code 1 when validation fails', () => {
      delete process.env.PORT;
      delete process.env.DB_TYPE;

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
      const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      validateAndExit();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockConsoleError).toHaveBeenCalled();

      // Verify error message format
      const errorCalls = mockConsoleError.mock.calls;
      const errorMessages = errorCalls.map(call => call[0]).join(' ');
      expect(errorMessages).toContain('Environment variable validation failed');
      expect(errorMessages).toContain('PORT must not be empty');
      expect(errorMessages).toContain('DB_TYPE must not be empty');

      mockExit.mockRestore();
      mockConsoleError.mockRestore();
    });
  });
});
