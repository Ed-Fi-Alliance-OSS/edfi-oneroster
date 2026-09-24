// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';

import { isSwaggerUiEnabled, isSwaggerUiConfigured, isOpenApiMetadataEnabled } from '../../src/config/api-docs.js';

describe('api-docs config', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.ENABLE_SWAGGER_UI;
    delete process.env.ENABLE_OPEN_API_METADATA;
  });

  afterEach(() => {
    Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
    Object.assign(process.env, originalEnv);
  });

  describe.each([
    ['isSwaggerUiEnabled', 'ENABLE_SWAGGER_UI', () => isSwaggerUiEnabled()],
    ['isOpenApiMetadataEnabled', 'ENABLE_OPEN_API_METADATA', () => isOpenApiMetadataEnabled()],
  ])('%s', (_name, envVar, isEnabled) => {
    test('defaults to enabled when the variable is not set', () => {
      expect(isEnabled()).toBe(true);
    });

    test('defaults to enabled when the variable is an empty string', () => {
      process.env[envVar] = '';
      expect(isEnabled()).toBe(true);
    });

    test('returns true when set to "true"', () => {
      process.env[envVar] = 'true';
      expect(isEnabled()).toBe(true);
    });

    test.each(['false', 'False', 'FALSE', '  false  '])(
      'returns false when set to "%s"',
      (value) => {
        process.env[envVar] = value;
        expect(isEnabled()).toBe(false);
      }
    );
  });

  describe('isSwaggerUiEnabled fallback to the OpenAPI metadata setting', () => {
    test('disabling the OpenAPI document also disables the unset UI', () => {
      process.env.ENABLE_OPEN_API_METADATA = 'false';
      expect(isSwaggerUiEnabled()).toBe(false);
    });

    test('an empty ENABLE_SWAGGER_UI also follows the OpenAPI document', () => {
      process.env.ENABLE_SWAGGER_UI = '   ';
      process.env.ENABLE_OPEN_API_METADATA = 'false';
      expect(isSwaggerUiEnabled()).toBe(false);
    });

    // Rejected by envValidator, but the setting itself must still report what was configured.
    test('an explicit "true" overrides the fallback', () => {
      process.env.ENABLE_SWAGGER_UI = 'true';
      process.env.ENABLE_OPEN_API_METADATA = 'false';
      expect(isSwaggerUiEnabled()).toBe(true);
    });

    test('the UI can be disabled on its own while the OpenAPI document stays enabled', () => {
      process.env.ENABLE_SWAGGER_UI = 'false';
      process.env.ENABLE_OPEN_API_METADATA = 'true';
      expect(isSwaggerUiEnabled()).toBe(false);
      expect(isOpenApiMetadataEnabled()).toBe(true);
    });

    test('the OpenAPI document never follows the UI setting', () => {
      process.env.ENABLE_SWAGGER_UI = 'false';
      expect(isOpenApiMetadataEnabled()).toBe(true);
    });
  });

  describe('isSwaggerUiConfigured', () => {
    test.each([
      ['unset', undefined, false],
      ['empty', '', false],
      ['whitespace', '   ', false],
      ['true', 'true', true],
      ['false', 'false', true],
    ])('treats %s as explicitly configured: %s', (_label, value, expected) => {
      if (value === undefined) delete process.env.ENABLE_SWAGGER_UI;
      else process.env.ENABLE_SWAGGER_UI = value;
      expect(isSwaggerUiConfigured()).toBe(expected);
    });
  });
});
