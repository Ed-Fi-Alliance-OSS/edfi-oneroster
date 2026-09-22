// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';

import { resolveLevel, getLogger, DEFAULT_LEVEL, VALID_LEVELS } from '../../src/utils/logger.js';

describe('logger', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
    Object.assign(process.env, originalEnv);
  });

  describe('resolveLevel', () => {
    test('defaults to "info" when LOG_LEVEL is not set', () => {
      delete process.env.LOG_LEVEL;
      expect(resolveLevel()).toBe(DEFAULT_LEVEL);
    });

    test.each(VALID_LEVELS)('accepts "%s"', (level) => {
      process.env.LOG_LEVEL = level;
      expect(resolveLevel()).toBe(level);
    });

    test('is case-insensitive', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      expect(resolveLevel()).toBe('debug');
    });

    test('falls back to "info" for an unrecognized value', () => {
      process.env.LOG_LEVEL = 'verbose';
      expect(resolveLevel()).toBe(DEFAULT_LEVEL);
    });
  });

  describe('getLogger', () => {
    test('returns a child logger tagged with the component name', () => {
      const log = getLogger('KnexFactory');
      expect(log.bindings()).toEqual(expect.objectContaining({ component: 'KnexFactory' }));
    });
  });
});
