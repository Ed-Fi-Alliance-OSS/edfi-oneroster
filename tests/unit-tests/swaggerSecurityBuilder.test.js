// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock dependencies before importing the module under test
const mockIsMultiTenancyEnabled = jest.fn();
const mockGetTenantsConfig = jest.fn();
const mockGetOdsContextConfig = jest.fn();
const mockGetValidContextValues = jest.fn();

jest.unstable_mockModule('../../src/config/multi-tenancy-config.js', () => ({
  isMultiTenancyEnabled: mockIsMultiTenancyEnabled,
  getTenantsConfig: mockGetTenantsConfig
}));

jest.unstable_mockModule('../../src/config/ods-context-config.js', () => ({
  getOdsContextConfig: mockGetOdsContextConfig
}));

jest.unstable_mockModule('../../src/services/odsContextValidationService.js', () => ({
  getValidContextValues: mockGetValidContextValues
}));

// Import the module under test
const { buildSwaggerSecuritySchemes } = await import('../../src/services/swaggerSecurityBuilder.js');

describe('swaggerSecurityBuilder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildSwaggerSecuritySchemes - trailing slash handling', () => {
    test('should handle oauth base URL with trailing slash - single tenant no context', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue(null);

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746/', {});

      expect(result.oauth2_auth.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/oauth/token');
      expect(result.oauth2_auth.flows.clientCredentials.tokenUrl).not.toContain('//oauth');
    });

    test('should handle oauth base URL without trailing slash - single tenant no context', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue(null);

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746', {});

      expect(result.oauth2_auth.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/oauth/token');
    });

    test('should handle oauth base URL with trailing slash - single tenant with context', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue({
        parameterName: 'schoolYearFromRoute',
        constraintType: 'range',
        constraintArgs: '2025,2027'
      });
      mockGetValidContextValues.mockResolvedValue(['2026']);

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746/', {});

      expect(result.oauth2_client_credentials.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/2026/oauth/token');
      expect(result.oauth2_client_credentials.flows.clientCredentials.tokenUrl).not.toContain('//oauth');
      expect(result.oauth2_client_credentials.flows.clientCredentials.tokenUrl).not.toContain('//2026');
    });

    test('should handle oauth base URL with trailing slash - multi-tenant no context', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetOdsContextConfig.mockReturnValue(null);
      mockGetTenantsConfig.mockReturnValue({
        Tenant1: { adminConnection: 'conn1' },
        Tenant2: { adminConnection: 'conn2' }
      });

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746/', {});

      expect(result.Tenant1_oauth2_client_credentials.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/Tenant1/oauth/token');
      expect(result.Tenant2_oauth2_client_credentials.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/Tenant2/oauth/token');
      expect(result.Tenant1_oauth2_client_credentials.flows.clientCredentials.tokenUrl).not.toContain('//oauth');
      expect(result.Tenant1_oauth2_client_credentials.flows.clientCredentials.tokenUrl).not.toContain('//Tenant1');
    });

    test('should handle oauth base URL with trailing slash - multi-tenant with context', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetOdsContextConfig.mockReturnValue({
        parameterName: 'schoolYearFromRoute',
        constraintType: 'range',
        constraintArgs: '2025,2027'
      });
      mockGetTenantsConfig.mockReturnValue({
        Tenant1: { adminConnection: 'conn1' }
      });
      mockGetValidContextValues.mockResolvedValue(['2026']);

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746/', {});

      expect(result.Tenant1_oauth2_client_credentials.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/Tenant1/2026/oauth/token');
      expect(result.Tenant1_oauth2_client_credentials.flows.clientCredentials.tokenUrl).not.toContain('//oauth');
      expect(result.Tenant1_oauth2_client_credentials.flows.clientCredentials.tokenUrl).not.toContain('//Tenant1');
      expect(result.Tenant1_oauth2_client_credentials.flows.clientCredentials.tokenUrl).not.toContain('//2026');
    });
  });

  describe('buildSwaggerSecuritySchemes - Case 1: Single-tenant without context', () => {
    test('should return oauth2_auth scheme with correct structure', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue(null);

      const scopes = { read: 'Read access', write: 'Write access' };
      const result = await buildSwaggerSecuritySchemes('http://localhost:54746', scopes);

      expect(result).toHaveProperty('oauth2_auth');
      expect(result.oauth2_auth).toEqual({
        type: 'oauth2',
        description: 'Ed-Fi ODS/API OAuth 2.0 Client Credentials Grant Type authorization',
        flows: {
          clientCredentials: {
            tokenUrl: 'http://localhost:54746/oauth/token',
            scopes
          }
        }
      });
    });
  });

  describe('buildSwaggerSecuritySchemes - Case 2: Single-tenant with context', () => {
    test('should return oauth2_client_credentials with context in token URL', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue({
        parameterName: 'schoolYearFromRoute'
      });
      mockGetValidContextValues.mockResolvedValue(['2026']);

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746', {});

      expect(result).toHaveProperty('oauth2_client_credentials');
      expect(result.oauth2_client_credentials.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/2026/oauth/token');
    });

    test('should fallback to base URL when no context values found', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue({
        parameterName: 'schoolYearFromRoute'
      });
      mockGetValidContextValues.mockResolvedValue([]);

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746', {});

      expect(result.oauth2_client_credentials.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/oauth/token');
    });

    test('should handle errors when fetching context values', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue({
        parameterName: 'schoolYearFromRoute'
      });
      mockGetValidContextValues.mockRejectedValue(new Error('DB error'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746', {});

      expect(result.oauth2_client_credentials.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/oauth/token');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[SwaggerSecurityBuilder] Error fetching context values:',
        'DB error'
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('buildSwaggerSecuritySchemes - Case 3: Multi-tenant without context', () => {
    test('should return separate schemes for each tenant', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetOdsContextConfig.mockReturnValue(null);
      mockGetTenantsConfig.mockReturnValue({
        Tenant1: { adminConnection: 'conn1' },
        Tenant2: { adminConnection: 'conn2' }
      });

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746', {});

      expect(result).toHaveProperty('Tenant1_oauth2_client_credentials');
      expect(result).toHaveProperty('Tenant2_oauth2_client_credentials');
      expect(result.Tenant1_oauth2_client_credentials.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/Tenant1/oauth/token');
      expect(result.Tenant2_oauth2_client_credentials.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/Tenant2/oauth/token');
    });

    test('should handle empty tenants config', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetOdsContextConfig.mockReturnValue(null);
      mockGetTenantsConfig.mockReturnValue({});

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746', {});

      // Should fall through to fallback
      expect(result).toHaveProperty('oauth2_auth');
      expect(result.oauth2_auth.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/oauth/token');
    });
  });

  describe('buildSwaggerSecuritySchemes - Case 4: Multi-tenant with context', () => {
    test('should include context in tenant token URLs', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetOdsContextConfig.mockReturnValue({
        parameterName: 'schoolYearFromRoute'
      });
      mockGetTenantsConfig.mockReturnValue({
        Tenant1: { adminConnection: 'conn1' }
      });
      mockGetValidContextValues.mockResolvedValue(['2026']);

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746', {});

      expect(result.Tenant1_oauth2_client_credentials.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/Tenant1/2026/oauth/token');
    });

    test('should handle tenant without context values', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetOdsContextConfig.mockReturnValue({
        parameterName: 'schoolYearFromRoute'
      });
      mockGetTenantsConfig.mockReturnValue({
        Tenant1: { adminConnection: 'conn1' }
      });
      mockGetValidContextValues.mockResolvedValue([]);

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746', {});

      expect(result.Tenant1_oauth2_client_credentials.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/Tenant1/oauth/token');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("No context values found for tenant 'Tenant1'")
      );

      consoleWarnSpy.mockRestore();
    });

    test('should handle errors fetching context for tenant', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetOdsContextConfig.mockReturnValue({
        parameterName: 'schoolYearFromRoute'
      });
      mockGetTenantsConfig.mockReturnValue({
        Tenant1: { adminConnection: 'conn1' }
      });
      mockGetValidContextValues.mockRejectedValue(new Error('DB error'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746', {});

      expect(result.Tenant1_oauth2_client_credentials.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/Tenant1/oauth/token');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error fetching context values for tenant 'Tenant1'"),
        'DB error'
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('buildSwaggerSecuritySchemes - Fallback behavior', () => {
    test('should return oauth2_auth as fallback when config is incomplete', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(true);
      mockGetOdsContextConfig.mockReturnValue(null);
      mockGetTenantsConfig.mockReturnValue(null);

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746', {});

      expect(result).toHaveProperty('oauth2_auth');
      expect(result.oauth2_auth.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/oauth/token');
    });
  });

  describe('Edge cases', () => {
    test('should handle URLs with multiple trailing slashes', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue(null);

      const result = await buildSwaggerSecuritySchemes('http://localhost:54746///', {});

      expect(result.oauth2_auth.flows.clientCredentials.tokenUrl).toBe('http://localhost:54746/oauth/token');
      expect(result.oauth2_auth.flows.clientCredentials.tokenUrl).not.toContain('//oauth');
    });

    test('should handle HTTPS URLs with trailing slash', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue(null);

      const result = await buildSwaggerSecuritySchemes('https://api.example.com/', {});

      expect(result.oauth2_auth.flows.clientCredentials.tokenUrl).toBe('https://api.example.com/oauth/token');
    });

    test('should preserve scopes in all cases', async () => {
      mockIsMultiTenancyEnabled.mockReturnValue(false);
      mockGetOdsContextConfig.mockReturnValue(null);

      const scopes = {
        'read:all': 'Read all resources',
        'write:all': 'Write all resources'
      };
      const result = await buildSwaggerSecuritySchemes('http://localhost:54746/', scopes);

      expect(result.oauth2_auth.flows.clientCredentials.scopes).toEqual(scopes);
    });
  });
});
