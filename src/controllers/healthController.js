// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
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
        // Env JSON missing/invalid, or DynamoDB cache empty — cannot probe tenant DBs
        throw new Error('Multi-tenancy enabled but tenant configuration is not loaded');
      }

      const tenantIds = Object.keys(tenantsConfig);
      const results = [];

      // Test each tenant's EdFi_Admin connection
      for (const tenantId of tenantIds) {
        try {
          const adminConnectionString = getAdminConnectionString(tenantId, dbType);
          const adminDb = odsInstanceService.getAdminConnection(adminConnectionString, dbType);
          await adminDb.raw('SELECT 1 as test');
          results.push({ status: 'pass' });
        } catch (err) {
          const errorMessage = err?.message || 'Unknown error';
          console.error(`[HealthController] Tenant connection check failed: ${errorMessage}`);
          results.push({ status: 'fail' });
        }
      }

      const allPassed = results.every(r => r.status === 'pass');
      res.status(allPassed ? 200 : 503).json({
        status: allPassed ? "pass" : "fail",
        mode: "multi-tenant"
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
    const errorMessage = err?.message || 'Unknown error';
    console.error(`[HealthController] Database health check failed: ${errorMessage}`);
    res.status(503).json({
      status: "fail",
      error: "database unreachable"
    });
  }
};
