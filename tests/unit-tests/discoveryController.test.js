// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies before importing the controller
const mockIsMultiTenancyEnabled = jest.fn();
const mockGetOdsContextConfig = jest.fn();

jest.unstable_mockModule('../../src/config/multi-tenancy-config.js', () => ({
  isMultiTenancyEnabled: mockIsMultiTenancyEnabled,
}));

jest.unstable_mockModule('../../src/config/ods-context-config.js', () => ({
  getOdsContextConfig: mockGetOdsContextConfig,
  buildUrlTemplate: (baseUrl, multiTenancyEnabled, contextConfig, suffix) => `${baseUrl}${suffix}`,
  populateUrlTemplate: (template) => template,
}));

jest.unstable_mockModule('../../src/utils/urlHelper.js', () => ({
  getExternalBaseUrl: () => 'https://oneroster.example.org',
}));

const { getDiscovery } = await import('../../src/controllers/discoveryController.js');

function createRes() {
  return {
    json: jest.fn().mockReturnThis(),
  };
}

describe('discoveryController', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.ENABLE_SWAGGER_UI;
    delete process.env.ENABLE_OPEN_API_METADATA;
    process.env.OAUTH2_ISSUERBASEURL = 'https://auth.example.org';
    mockIsMultiTenancyEnabled.mockReturnValue(false);
    mockGetOdsContextConfig.mockReturnValue(null);
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
    Object.assign(process.env, originalEnv);
  });

  describe('API documentation URLs', () => {
    test('advertises openApiMetadata and swaggerUI by default', () => {
      const res = createRes();
      getDiscovery({ params: {} }, res);

      const { urls } = res.json.mock.calls[0][0];
      expect(urls.openApiMetadata).toBe('https://oneroster.example.org/swagger.json');
      expect(urls.swaggerUI).toBe('https://oneroster.example.org/docs');
    });

    test('omits both when ENABLE_SWAGGER_UI and ENABLE_OPEN_API_METADATA are false', () => {
      process.env.ENABLE_SWAGGER_UI = 'false';
      process.env.ENABLE_OPEN_API_METADATA = 'false';
      const res = createRes();
      getDiscovery({ params: {} }, res);

      const { urls } = res.json.mock.calls[0][0];
      expect(urls).not.toHaveProperty('openApiMetadata');
      expect(urls).not.toHaveProperty('swaggerUI');
    });

    test('omits only swaggerUI when ENABLE_SWAGGER_UI=false', () => {
      process.env.ENABLE_SWAGGER_UI = 'false';
      const res = createRes();
      getDiscovery({ params: {} }, res);

      const { urls } = res.json.mock.calls[0][0];
      expect(urls).not.toHaveProperty('swaggerUI');
      expect(urls.openApiMetadata).toBe('https://oneroster.example.org/swagger.json');
    });

    // An unset ENABLE_SWAGGER_UI follows the metadata setting, so disabling the document
    // withdraws both URLs. The reverse state is rejected at startup and cannot be reached.
    test('omits both when only ENABLE_OPEN_API_METADATA=false', () => {
      process.env.ENABLE_OPEN_API_METADATA = 'false';
      const res = createRes();
      getDiscovery({ params: {} }, res);

      const { urls } = res.json.mock.calls[0][0];
      expect(urls).not.toHaveProperty('openApiMetadata');
      expect(urls).not.toHaveProperty('swaggerUI');
    });

    test('still advertises oauth and dataManagementApi when both are disabled', () => {
      process.env.ENABLE_SWAGGER_UI = 'false';
      process.env.ENABLE_OPEN_API_METADATA = 'false';
      const res = createRes();
      getDiscovery({ params: {} }, res);

      const { urls } = res.json.mock.calls[0][0];
      expect(urls.oauth).toBe('https://auth.example.org/oauth/token');
      expect(urls.dataManagementApi).toBe('https://oneroster.example.org/ims/oneroster/rostering/v1p2/');
    });

    test('preserves the documented key order when docs are enabled', () => {
      const res = createRes();
      getDiscovery({ params: {} }, res);

      const { urls } = res.json.mock.calls[0][0];
      expect(Object.keys(urls)).toEqual([
        'openApiMetadata',
        'swaggerUI',
        'oauth',
        'dataManagementApi'
      ]);
    });
  });

  test('returns the version alongside the urls', () => {
    const res = createRes();
    getDiscovery({ params: {} }, res);

    expect(res.json.mock.calls[0][0].version).toBe('1.0.0');
  });
});
