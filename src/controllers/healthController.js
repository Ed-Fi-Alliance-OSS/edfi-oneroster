// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { getAdminConnectionString, isMultiTenancyEnabled, getTenantsConfig } from '../config/multi-tenancy-config.js';
import { odsInstanceService } from '../services/database/OdsInstanceService.js';

export const list = async (req, res) => {
  try {
    const dbType = process.env.DB_TYPE || 'postgres';

    // Test EdFi_Admin connection(s)
    if (isMultiTenancyEnabled()) {
      const tenantsConfig = getTenantsConfig();
      if (!tenantsConfig) {
        throw new Error('Multi-tenancy enabled but TENANTS_CONFIG not configured');
      }

      const tenantIds = Object.keys(tenantsConfig);
      const results = [];

      // Test each tenant's EdFi_Admin connection
      for (const tenantId of tenantIds) {
        try {
          const adminConnectionString = getAdminConnectionString(tenantId, dbType);
          const adminDb = odsInstanceService.getAdminConnection(adminConnectionString, dbType);
          await adminDb.raw('SELECT 1 as test');
          results.push({ tenant: tenantId, status: 'pass' });
        } catch (err) {
          results.push({ tenant: tenantId, status: 'fail', error: err.message });
        }
      }

      const allPassed = results.every(r => r.status === 'pass');
      res.status(allPassed ? 200 : 503).json({
        status: allPassed ? "pass" : "fail",
        mode: "multi-tenant",
        tenants: results
      });
    } else {
      // Single-tenant mode: test default EdFi_Admin connection
      const adminConnectionString = getAdminConnectionString(null, dbType);
      const adminDb = odsInstanceService.getAdminConnection(adminConnectionString, dbType);
      await adminDb.raw('SELECT 1 as test');

      res.json({
        status: "pass",
        mode: "single-tenant"
      });
    }
  } catch (err) {
    console.error('[HealthController] Database health check failed:', err);
    res.status(503).json({
      status: "fail",
      error: "database unreachable",
      message: err.message
    });
  }
};
