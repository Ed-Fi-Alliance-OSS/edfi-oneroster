// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  DEFAULT_DB_REQUEST_TIMEOUT_MS,
  buildRequestTimeoutOptions,
  getDbRequestTimeoutMs
} from '../../src/config/db-timeouts.js';
import { logger } from '../../src/utils/logger.js';

describe('db-timeouts', () => {
  let originalValue;
  let warnSpy;

  beforeEach(() => {
    originalValue = process.env.DB_REQUEST_TIMEOUT;
    delete process.env.DB_REQUEST_TIMEOUT;
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.DB_REQUEST_TIMEOUT;
    } else {
      process.env.DB_REQUEST_TIMEOUT = originalValue;
    }
    warnSpy.mockRestore();
  });

  describe('getDbRequestTimeoutMs', () => {
    test('defaults to 30000ms when DB_REQUEST_TIMEOUT is unset', () => {
      expect(getDbRequestTimeoutMs()).toBe(30000);
      expect(DEFAULT_DB_REQUEST_TIMEOUT_MS).toBe(30000);
    });

    test('uses the configured value', () => {
      process.env.DB_REQUEST_TIMEOUT = '120000';
      expect(getDbRequestTimeoutMs()).toBe(120000);
    });

    test('tolerates surrounding whitespace', () => {
      process.env.DB_REQUEST_TIMEOUT = '  45000  ';
      expect(getDbRequestTimeoutMs()).toBe(45000);
    });

    test('treats an empty value as unset', () => {
      process.env.DB_REQUEST_TIMEOUT = '   ';
      expect(getDbRequestTimeoutMs()).toBe(DEFAULT_DB_REQUEST_TIMEOUT_MS);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    test('allows 0 to disable the timeout', () => {
      process.env.DB_REQUEST_TIMEOUT = '0';
      expect(getDbRequestTimeoutMs()).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    test('falls back to the default and logs when the value is not a number', () => {
      process.env.DB_REQUEST_TIMEOUT = '30 seconds';
      expect(getDbRequestTimeoutMs()).toBe(DEFAULT_DB_REQUEST_TIMEOUT_MS);
      expect(warnSpy).toHaveBeenCalled();
    });

    test('falls back to the default when the value is negative', () => {
      process.env.DB_REQUEST_TIMEOUT = '-1';
      expect(getDbRequestTimeoutMs()).toBe(DEFAULT_DB_REQUEST_TIMEOUT_MS);
      expect(warnSpy).toHaveBeenCalled();
    });

    test('falls back to the default when the value is a decimal', () => {
      process.env.DB_REQUEST_TIMEOUT = '1500.5';
      expect(getDbRequestTimeoutMs()).toBe(DEFAULT_DB_REQUEST_TIMEOUT_MS);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('buildRequestTimeoutOptions', () => {
    test('MSSQL always carries a requestTimeout, defaulting to 30000ms', () => {
      expect(buildRequestTimeoutOptions('mssql')).toEqual({ requestTimeout: 30000 });
    });

    test('MSSQL honours the configured value', () => {
      process.env.DB_REQUEST_TIMEOUT = '90000';
      expect(buildRequestTimeoutOptions('mssql')).toEqual({ requestTimeout: 90000 });
    });

    test('PostgreSQL always carries a statement_timeout, defaulting to 30000ms', () => {
      expect(buildRequestTimeoutOptions('postgres')).toEqual({ statement_timeout: 30000 });
    });

    test('PostgreSQL honours the configured value', () => {
      process.env.DB_REQUEST_TIMEOUT = '90000';
      expect(buildRequestTimeoutOptions('postgres')).toEqual({ statement_timeout: 90000 });
    });

    test('PostgreSQL passes 0 through to disable statement_timeout', () => {
      process.env.DB_REQUEST_TIMEOUT = '0';
      expect(buildRequestTimeoutOptions('postgres')).toEqual({ statement_timeout: 0 });
    });

    test('both engines resolve to the same timeout value', () => {
      process.env.DB_REQUEST_TIMEOUT = '45000';
      expect(buildRequestTimeoutOptions('mssql').requestTimeout)
        .toBe(buildRequestTimeoutOptions('postgres').statement_timeout);
    });
  });
});
