// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  isMultiTenancyEnabled,
  getTenantsConfig,
  parseConnectionString,
  getTenantConnectionConfig,
  getDefaultConnectionConfig,
  getConnectionConfig,
  getAdminConnectionString,
  getTenantOdsInstances,
  getDefaultOdsInstances,
  getOdsInstances,
} from '../../src/config/multi-tenancy-config.js';

describe('multi-tenancy-config', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
    Object.assign(process.env, originalEnv);
  });

  // ---------------------------------------------------------------------------
  describe('isMultiTenancyEnabled', () => {
    test('returns true when MULTITENANCY_ENABLED is "true"', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      expect(isMultiTenancyEnabled()).toBe(true);
    });

    test('returns false when MULTITENANCY_ENABLED is "false"', () => {
      process.env.MULTITENANCY_ENABLED = 'false';
      expect(isMultiTenancyEnabled()).toBe(false);
    });

    test('returns false when MULTITENANCY_ENABLED is not set', () => {
      delete process.env.MULTITENANCY_ENABLED;
      expect(isMultiTenancyEnabled()).toBe(false);
    });

    test('returns false for any value other than "true"', () => {
      process.env.MULTITENANCY_ENABLED = '1';
      expect(isMultiTenancyEnabled()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  describe('getTenantsConfig', () => {
    test('returns null when multi-tenancy is disabled', () => {
      process.env.MULTITENANCY_ENABLED = 'false';
      expect(getTenantsConfig()).toBeNull();
    });

    test('returns null when TENANTS_CONNECTION_CONFIG is not set', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      delete process.env.TENANTS_CONNECTION_CONFIG;
      expect(getTenantsConfig()).toBeNull();
    });

    test('returns parsed config object when JSON is valid', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      const config = { tenant1: { adminConnection: 'conn1' } };
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify(config);
      expect(getTenantsConfig()).toEqual(config);
    });

    test('returns null when TENANTS_CONNECTION_CONFIG is invalid JSON', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = '{ not valid json }';
      expect(getTenantsConfig()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  describe('parseConnectionString', () => {
    describe('MSSQL', () => {
      test('parses basic connection string fields', () => {
        const result = parseConnectionString(
          'server=sqlhost;database=EdFi_Admin;user id=sa;password=secret',
          'mssql'
        );
        expect(result).toMatchObject({
          server: 'sqlhost',
          database: 'EdFi_Admin',
          user: 'sa',
          password: 'secret',
        });
      });

      test('defaults port to 1433 when not specified', () => {
        const result = parseConnectionString(
          'server=sqlhost;database=db;user id=u;password=p',
          'mssql'
        );
        expect(result.port).toBe(1433);
      });

      test('defaults encrypt to false and trustServerCertificate to true', () => {
        const result = parseConnectionString(
          'server=sqlhost;database=db;user id=u;password=p',
          'mssql'
        );
        expect(result.encrypt).toBe(false);
        expect(result.trustServerCertificate).toBe(true);
      });

      test('converts "(local)" server name to "localhost"', () => {
        const result = parseConnectionString(
          'server=(local);database=db;user id=u;password=p',
          'mssql'
        );
        expect(result.server).toBe('localhost');
      });

      test('parses explicit port, encrypt, and trustServerCertificate', () => {
        const result = parseConnectionString(
          'server=sqlhost;database=db;user id=u;password=p;port=1434;encrypt=true;trustServerCertificate=false',
          'mssql'
        );
        expect(result.port).toBe(1434);
        expect(result.encrypt).toBe(true);
        expect(result.trustServerCertificate).toBe(false);
      });

      test('supports "Data Source" and "Initial Catalog" aliases', () => {
        const result = parseConnectionString(
          'Data Source=sqlhost;Initial Catalog=MyDb;user id=u;password=p',
          'mssql'
        );
        expect(result.server).toBe('sqlhost');
        expect(result.database).toBe('MyDb');
      });

      test('supports "pwd" alias for password', () => {
        const result = parseConnectionString(
          'server=s;database=db;uid=u;pwd=mypass',
          'mssql'
        );
        expect(result.password).toBe('mypass');
        expect(result.user).toBe('u');
      });
    });

    describe('PostgreSQL', () => {
      test('parses basic connection string fields', () => {
        const result = parseConnectionString(
          'host=localhost;port=5432;database=EdFi_Admin;username=postgres;password=secret',
          'postgres'
        );
        expect(result).toMatchObject({
          host: 'localhost',
          port: 5432,
          database: 'EdFi_Admin',
          user: 'postgres',
          password: 'secret',
        });
      });

      test('defaults port to 5432 when not specified', () => {
        const result = parseConnectionString(
          'host=localhost;database=db;username=u;password=p',
          'postgres'
        );
        expect(result.port).toBe(5432);
      });

      test('supports "user id" key as an alias for username', () => {
        const result = parseConnectionString(
          'host=localhost;database=db;user id=admin;password=p',
          'postgres'
        );
        expect(result.user).toBe('admin');
      });

      test('handles password values that contain "=" characters', () => {
        const result = parseConnectionString(
          'host=localhost;database=db;username=u;password=p=with=equals',
          'postgres'
        );
        expect(result.password).toBe('p=with=equals');
      });

      test('sets ssl to false for sslmode=disable', () => {
        const result = parseConnectionString(
          'host=localhost;database=db;username=u;password=p;sslmode=disable',
          'postgres'
        );
        expect(result.ssl).toBe(false);
      });

      test('sets rejectUnauthorized for sslmode=require', () => {
        const result = parseConnectionString(
          'host=localhost;database=db;username=u;password=p;sslmode=require',
          'postgres'
        );
        expect(result.ssl).toMatchObject({ rejectUnauthorized: true });
      });

      test('does not set ssl property when no sslmode is specified', () => {
        const result = parseConnectionString(
          'host=localhost;database=db;username=u;password=p',
          'postgres'
        );
        expect(result.ssl).toBeUndefined();
      });

      test('supports "server" as alias for host', () => {
        const result = parseConnectionString(
          'server=pghost;database=db;username=u;password=p',
          'postgres'
        );
        expect(result.host).toBe('pghost');
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('getTenantConnectionConfig', () => {
    test('returns null when multi-tenancy is disabled', () => {
      process.env.MULTITENANCY_ENABLED = 'false';
      expect(getTenantConnectionConfig('tenant1')).toBeNull();
    });

    test('returns null when tenantId is null', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({ tenant1: { adminConnection: 'x' } });
      expect(getTenantConnectionConfig(null)).toBeNull();
    });

    test('returns null when tenant key is not found', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({ other: { adminConnection: 'x' } });
      expect(getTenantConnectionConfig('missing')).toBeNull();
    });

    test('returns parsed connection config for matching tenant', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({
        tenant1: { adminConnection: 'host=dbhost;database=EdFi_Admin;username=u;password=p' },
      });
      const result = getTenantConnectionConfig('tenant1');
      expect(result).toMatchObject({ host: 'dbhost', database: 'EdFi_Admin' });
    });

    test('performs case-insensitive tenant key lookup', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({
        Tenant1: { adminConnection: 'host=dbhost;database=EdFi_Admin;username=u;password=p' },
      });
      const result = getTenantConnectionConfig('tenant1');
      expect(result).toMatchObject({ host: 'dbhost' });
    });

    test('returns null when tenant has no adminConnection', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({ tenant1: { other: 'value' } });
      expect(getTenantConnectionConfig('tenant1')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  describe('getDefaultConnectionConfig', () => {
    test('returns null when CONNECTION_CONFIG is not set', () => {
      delete process.env.CONNECTION_CONFIG;
      expect(getDefaultConnectionConfig()).toBeNull();
    });

    test('returns null when CONNECTION_CONFIG contains invalid JSON', () => {
      process.env.CONNECTION_CONFIG = '{ bad json }';
      expect(getDefaultConnectionConfig()).toBeNull();
    });

    test('returns null when adminConnection property is missing', () => {
      process.env.CONNECTION_CONFIG = JSON.stringify({ other: 'value' });
      expect(getDefaultConnectionConfig()).toBeNull();
    });

    test('returns parsed connection config for valid input', () => {
      process.env.CONNECTION_CONFIG = JSON.stringify({
        adminConnection: 'host=localhost;database=EdFi_Admin;username=postgres;password=pass',
      });
      const result = getDefaultConnectionConfig();
      expect(result).toMatchObject({ host: 'localhost', database: 'EdFi_Admin', user: 'postgres' });
    });
  });

  // ---------------------------------------------------------------------------
  describe('getConnectionConfig', () => {
    test('returns default config in single-tenant mode', () => {
      process.env.MULTITENANCY_ENABLED = 'false';
      process.env.CONNECTION_CONFIG = JSON.stringify({
        adminConnection: 'host=localhost;database=EdFi_Admin;username=u;password=p',
      });
      const result = getConnectionConfig();
      expect(result).toMatchObject({ host: 'localhost' });
    });

    test('throws in multi-tenant mode when tenant is not found', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({ other: { adminConnection: 'conn' } });
      expect(() => getConnectionConfig('missing')).toThrow();
    });

    test('returns tenant config in multi-tenant mode when tenant exists', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({
        tenant1: { adminConnection: 'host=tenanthost;database=EdFi_Admin;username=u;password=p' },
      });
      const result = getConnectionConfig('tenant1');
      expect(result).toMatchObject({ host: 'tenanthost' });
    });
  });

  // ---------------------------------------------------------------------------
  describe('getAdminConnectionString', () => {
    test('returns empty string when CONNECTION_CONFIG is not set in single-tenant mode', () => {
      process.env.MULTITENANCY_ENABLED = 'false';
      delete process.env.CONNECTION_CONFIG;
      expect(getAdminConnectionString()).toBe('');
    });

    test('returns the raw adminConnection string in single-tenant mode', () => {
      process.env.MULTITENANCY_ENABLED = 'false';
      const connStr = 'host=localhost;database=EdFi_Admin;username=u;password=p';
      process.env.CONNECTION_CONFIG = JSON.stringify({ adminConnection: connStr });
      expect(getAdminConnectionString()).toBe(connStr);
    });

    test('returns empty string when CONNECTION_CONFIG has no adminConnection in single-tenant mode', () => {
      process.env.MULTITENANCY_ENABLED = 'false';
      process.env.CONNECTION_CONFIG = JSON.stringify({ other: 'x' });
      expect(getAdminConnectionString()).toBe('');
    });

    test('throws in multi-tenant mode when TENANTS_CONNECTION_CONFIG is not set', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      delete process.env.TENANTS_CONNECTION_CONFIG;
      expect(() => getAdminConnectionString('tenant1')).toThrow();
    });

    test('throws in multi-tenant mode when tenant is not found', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({ other: { adminConnection: 'x' } });
      expect(() => getAdminConnectionString('missing')).toThrow();
    });

    test('returns raw adminConnection string for matching tenant in multi-tenant mode', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      const connStr = 'host=tenanthost;database=EdFi_Admin;username=u;password=p';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({ tenant1: { adminConnection: connStr } });
      expect(getAdminConnectionString('tenant1')).toBe(connStr);
    });
  });

  // ---------------------------------------------------------------------------
  describe('getTenantOdsInstances', () => {
    test('returns null when multi-tenancy is disabled', () => {
      process.env.MULTITENANCY_ENABLED = 'false';
      expect(getTenantOdsInstances('tenant1')).toBeNull();
    });

    test('returns null when tenantId is null', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({ tenant1: { adminConnection: 'x' } });
      expect(getTenantOdsInstances(null)).toBeNull();
    });

    test('returns null when tenant has no OdsInstances property', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({ tenant1: { adminConnection: 'conn' } });
      expect(getTenantOdsInstances('tenant1')).toBeNull();
    });

    test('returns OdsInstances object for the matching tenant', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      const odsInstances = { '1': { ConnectionString: 'cs1' }, '2': { ConnectionString: 'cs2' } };
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({
        tenant1: { adminConnection: 'conn', OdsInstances: odsInstances },
      });
      expect(getTenantOdsInstances('tenant1')).toEqual(odsInstances);
    });

    test('returns null when tenant key is not found', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({ other: { adminConnection: 'x' } });
      expect(getTenantOdsInstances('missing')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  describe('getDefaultOdsInstances', () => {
    test('returns null when ODS_INSTANCES is not set', () => {
      delete process.env.ODS_INSTANCES;
      expect(getDefaultOdsInstances()).toBeNull();
    });

    test('returns null when ODS_INSTANCES contains invalid JSON', () => {
      process.env.ODS_INSTANCES = '{ bad json }';
      expect(getDefaultOdsInstances()).toBeNull();
    });

    test('returns parsed ODS instances object', () => {
      const instances = { '1': { ConnectionString: 'cs' }, '2': { ConnectionString: 'cs2' } };
      process.env.ODS_INSTANCES = JSON.stringify(instances);
      expect(getDefaultOdsInstances()).toEqual(instances);
    });
  });

  // ---------------------------------------------------------------------------
  describe('getOdsInstances', () => {
    test('returns ODS_INSTANCES env var content in single-tenant mode', () => {
      process.env.MULTITENANCY_ENABLED = 'false';
      const instances = { '42': { ConnectionString: 'cs' } };
      process.env.ODS_INSTANCES = JSON.stringify(instances);
      expect(getOdsInstances()).toEqual(instances);
    });

    test('returns null when no ODS instances are configured in single-tenant mode', () => {
      process.env.MULTITENANCY_ENABLED = 'false';
      delete process.env.ODS_INSTANCES;
      expect(getOdsInstances()).toBeNull();
    });

    test('returns tenant OdsInstances in multi-tenant mode', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      const instances = { '1': { ConnectionString: 'cs' } };
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({
        tenant1: { adminConnection: 'conn', OdsInstances: instances },
      });
      expect(getOdsInstances('tenant1')).toEqual(instances);
    });

    test('returns null when tenant has no OdsInstances in multi-tenant mode', () => {
      process.env.MULTITENANCY_ENABLED = 'true';
      process.env.TENANTS_CONNECTION_CONFIG = JSON.stringify({ tenant1: { adminConnection: 'conn' } });
      expect(getOdsInstances('tenant1')).toBeNull();
    });
  });
});
