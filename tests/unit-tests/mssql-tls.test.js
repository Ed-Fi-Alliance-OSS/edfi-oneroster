// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildMssqlTlsOptions,
  buildMssqlTlsOptionsFromEnv,
  parseMssqlBoolean
} from '../../src/config/mssql-tls.js';
import { parseConnectionString } from '../../src/config/multi-tenancy-config.js';

describe('buildMssqlTlsOptions', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('defaults', () => {
    test('is secure by default when nothing is specified', () => {
      expect(buildMssqlTlsOptions({})).toEqual({
        encrypt: true,
        trustServerCertificate: false
      });
    });

    test('is secure by default when called with no argument', () => {
      expect(buildMssqlTlsOptions()).toEqual({
        encrypt: true,
        trustServerCertificate: false
      });
    });

    test('emits no warning for the secure default', () => {
      buildMssqlTlsOptions({});
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('explicit values are honoured', () => {
    test('respects Encrypt=False', () => {
      expect(buildMssqlTlsOptions({ encrypt: false }).encrypt).toBe(false);
    });

    test('respects TrustServerCertificate=True', () => {
      expect(buildMssqlTlsOptions({ encrypt: true, trustServerCertificate: true })).toEqual({
        encrypt: true,
        trustServerCertificate: true
      });
    });

    test('respects a fully secure explicit configuration without warning', () => {
      expect(buildMssqlTlsOptions({ encrypt: true, trustServerCertificate: false })).toEqual({
        encrypt: true,
        trustServerCertificate: false
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('warnings', () => {
    test('warns that traffic is cleartext when encryption is disabled', () => {
      buildMssqlTlsOptions({ encrypt: false });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/encryption is DISABLED/);
      expect(warnSpy.mock.calls[0][0]).toMatch(/cleartext/);
    });

    test('warns about man-in-the-middle when certificate validation is disabled', () => {
      buildMssqlTlsOptions({ encrypt: true, trustServerCertificate: true });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/certificate validation/);
      expect(warnSpy.mock.calls[0][0]).toMatch(/man-in-the-middle/);
    });

    test('cleartext warning takes precedence over the certificate warning', () => {
      buildMssqlTlsOptions({ encrypt: false, trustServerCertificate: true });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/encryption is DISABLED/);
    });

    test('names the database so an operator can locate the connection string', () => {
      buildMssqlTlsOptions({ encrypt: false, database: 'roster_ods_sy2027' });
      expect(warnSpy.mock.calls[0][0]).toMatch(/'roster_ods_sy2027'/);
    });

    test('falls back to a generic label when the database is unknown', () => {
      buildMssqlTlsOptions({ encrypt: false });
      expect(warnSpy.mock.calls[0][0]).toMatch(/MSSQL connection:/);
      expect(warnSpy.mock.calls[0][0]).not.toMatch(/undefined/);
    });

    test('discloses neither host nor credentials', () => {
      buildMssqlTlsOptions({
        encrypt: false,
        server: 'sql-prod.internal',
        port: 1434,
        database: 'EdFi_Ods_2026',
        user: 'svc_oneroster',
        password: 'sup3rs3cret'
      });
      const message = warnSpy.mock.calls[0][0];
      expect(message).toMatch(/'EdFi_Ods_2026'/);
      expect(message).not.toMatch(/sql-prod\.internal/);
      expect(message).not.toMatch(/1434/);
      expect(message).not.toMatch(/svc_oneroster/);
      expect(message).not.toMatch(/sup3rs3cret/);
    });
  });
});

describe('parseMssqlBoolean', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test.each(['true', 'True', 'TRUE', '  true  ', 'yes', 'Yes', '1', 'mandatory', 'Mandatory', 'strict', 'Strict'])(
    'treats %p as enabled', (value) => {
      expect(parseMssqlBoolean(value, 'Encrypt')).toBe(true);
    }
  );

  test.each(['false', 'False', 'no', 'No', '0', 'optional', 'Optional'])(
    'treats %p as disabled', (value) => {
      expect(parseMssqlBoolean(value, 'Encrypt')).toBe(false);
    }
  );

  test.each(['maybe', 'enabled', 'tru', '2', ''])(
    'returns undefined for unrecognised value %p so the secure default applies', (value) => {
      expect(parseMssqlBoolean(value, 'Encrypt')).toBeUndefined();
    }
  );

  test('warns on an unrecognised value, naming the keyword and the accepted set', () => {
    parseMssqlBoolean('Mabye', 'Encrypt');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/unrecognised value 'Mabye' for 'Encrypt'/);
    expect(warnSpy.mock.calls[0][0]).toMatch(/secure default/);
    expect(warnSpy.mock.calls[0][0]).toMatch(/mandatory/);
  });

  test('does not warn for recognised values', () => {
    ['true', 'Mandatory', 'no', 'Optional'].forEach(v => parseMssqlBoolean(v, 'Encrypt'));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('applies the same vocabulary to TrustServerCertificate', () => {
    expect(parseMssqlBoolean('yes', 'TrustServerCertificate')).toBe(true);
    expect(parseMssqlBoolean('no', 'TrustServerCertificate')).toBe(false);
  });

  test('Encrypt=Mandatory must not produce a cleartext connection', () => {
    const encrypt = parseMssqlBoolean('Mandatory', 'Encrypt');
    expect(buildMssqlTlsOptions({ encrypt }).encrypt).toBe(true);
  });

  test('an unrecognised value still ends up encrypted', () => {
    const encrypt = parseMssqlBoolean('Mabye', 'Encrypt');
    expect(encrypt).toBeUndefined();
    expect(buildMssqlTlsOptions({ encrypt }).encrypt).toBe(true);
  });
});

describe('Encrypt=Strict', () => {
  test('requires encryption rather than falling through to cleartext', () => {
    const cfg = parseConnectionString(
      'server=s;database=Db;user id=u;password=p;Encrypt=Strict', 'mssql'
    );
    expect(buildMssqlTlsOptions(cfg)).toEqual({
      encrypt: true,
      trustServerCertificate: false
    });
  });

  test('is accepted from the deploy-tooling environment', () => {
    expect(buildMssqlTlsOptionsFromEnv({ DB_ENCRYPT: 'Strict' }).encrypt).toBe(true);
  });
});

describe('buildMssqlTlsOptionsFromEnv', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('is secure when neither variable is set', () => {
    expect(buildMssqlTlsOptionsFromEnv({})).toEqual({
      encrypt: true,
      trustServerCertificate: false
    });
  });

  test('treats an empty value as unset so the secure default applies', () => {
    expect(buildMssqlTlsOptionsFromEnv({ DB_ENCRYPT: '' }).encrypt).toBe(true);
  });

  test('honours the local-development opt-out', () => {
    expect(buildMssqlTlsOptionsFromEnv({
      DB_ENCRYPT: 'false',
      DB_TRUST_SERVER_CERTIFICATE: 'true'
    })).toEqual({ encrypt: false, trustServerCertificate: true });
  });

  test('accepts the wider SqlClient vocabulary', () => {
    expect(buildMssqlTlsOptionsFromEnv({ DB_ENCRYPT: 'Mandatory' }).encrypt).toBe(true);
    expect(buildMssqlTlsOptionsFromEnv({ DB_ENCRYPT: 'no' }).encrypt).toBe(false);
  });

  test('names the database in the warning when DB_NAME is set', () => {
    buildMssqlTlsOptionsFromEnv({ DB_ENCRYPT: 'false', DB_NAME: 'EdFi_Ods_2027' });
    expect(warnSpy.mock.calls[0][0]).toMatch(/'EdFi_Ods_2027'/);
  });
});

describe('custom CA (DB_SSL_CA, tooling only)', () => {
  let caPath;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    caPath = path.join(os.tmpdir(), `oneroster-test-ca-${Date.now()}.pem`);
    fs.writeFileSync(
      caPath,
      ['-----BEGIN CERTIFICATE-----', 'TEST', '-----END CERTIFICATE-----', ''].join('\n')
    );
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    try { fs.unlinkSync(caPath); } catch { /* already gone */ }
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('supplies the CA to tedious via cryptoCredentialsDetails', () => {
    const result = buildMssqlTlsOptions({ caFilePath: caPath, database: 'Db' });
    expect(result.encrypt).toBe(true);
    expect(result.trustServerCertificate).toBe(false);
    expect(result.cryptoCredentialsDetails.ca).toMatch(/BEGIN CERTIFICATE/);
  });

  test('emits no warning for the fully secure enterprise-CA configuration', () => {
    buildMssqlTlsOptions({ caFilePath: caPath, database: 'Db' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('omits cryptoCredentialsDetails when no CA is configured', () => {
    expect(buildMssqlTlsOptions({ database: 'Db' }).cryptoCredentialsDetails).toBeUndefined();
  });

  test('ignores a CA when encryption is disabled', () => {
    const result = buildMssqlTlsOptions({ caFilePath: caPath, encrypt: false, database: 'Db' });
    expect(result.cryptoCredentialsDetails).toBeUndefined();
  });

  test('warns that the CA is unused when validation is disabled', () => {
    buildMssqlTlsOptions({ caFilePath: caPath, trustServerCertificate: true, database: 'Db' });
    expect(warnSpy.mock.calls.some(c => /CA is unused/.test(c[0]))).toBe(true);
  });

  test('falls back to the default store when the CA file cannot be read', () => {
    const result = buildMssqlTlsOptions({ caFilePath: '/no/such/ca.pem', database: 'Db' });
    expect(result.cryptoCredentialsDetails).toBeUndefined();
    expect(result.encrypt).toBe(true);
    expect(errorSpy.mock.calls[0][0]).toMatch(/failed to read DB_SSL_CA/);
  });

  test('is NOT reachable from a connection string', () => {
    // These connection strings are shared with the ODS and Admin API, whose
    // .NET parsers reject keywords they do not know.
    const cfg = parseConnectionString(
      `server=s;database=Db;user id=u;password=p;sslrootcert=${caPath}`, 'mssql'
    );
    expect(cfg.sslrootcert).toBeUndefined();
    expect(cfg.caFilePath).toBeUndefined();
    expect(buildMssqlTlsOptions(cfg).cryptoCredentialsDetails).toBeUndefined();
  });

  test('deploy tooling can supply a CA via DB_SSL_CA', () => {
    const result = buildMssqlTlsOptionsFromEnv({ DB_SSL_CA: caPath, DB_NAME: 'Db' });
    expect(result.cryptoCredentialsDetails.ca).toMatch(/BEGIN CERTIFICATE/);
  });
});
