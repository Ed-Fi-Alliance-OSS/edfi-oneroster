// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { isMultiTenancyEnabled } from '../config/multi-tenancy-config.js';
import {
  getOdsContextConfig,
  buildUrlTemplate,
  populateUrlTemplate
} from '../config/ods-context-config.js';

/**
 * Get base URL from request
 */
function getBaseUrl(req) {
  const forwardedProto = req.get('x-forwarded-proto');
  const forwardedHost = req.get('x-forwarded-host');

  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host');

  return `${protocol}://${host}`;
}

/**
 * Get discovery response with populated URLs
 */
export function getDiscovery(req, res) {
  const baseUrl = getBaseUrl(req);
  const multiTenancyEnabled = isMultiTenancyEnabled();
  const contextConfig = getOdsContextConfig();

  // Extract tenant and context from request params (may be null if not in route)
  const tenantId = req.params.tenantId || null;
  const contextValue = contextConfig?.parameterName ? req.params[contextConfig.parameterName] : null;

  // Build URL templates with all placeholders
  const swaggerTemplate = buildUrlTemplate(baseUrl, multiTenancyEnabled, contextConfig, '/swagger.json');
  const docsTemplate = buildUrlTemplate(baseUrl, multiTenancyEnabled, contextConfig, '/docs');
  const oauthTemplate = buildUrlTemplate(process.env.OAUTH2_ISSUERBASEURL, multiTenancyEnabled, contextConfig, '/oauth/token');
  const apiTemplate = buildUrlTemplate(baseUrl, multiTenancyEnabled, contextConfig, '/ims/oneroster/rostering/v1p2/');

  // Populate templates with actual values (leaves placeholders for null values)
  const urls = {
    openApiMetadata: populateUrlTemplate(swaggerTemplate, tenantId, contextValue, contextConfig),
    swaggerUI: populateUrlTemplate(docsTemplate, tenantId, contextValue, contextConfig),
    oauth: populateUrlTemplate(oauthTemplate, tenantId, contextValue, contextConfig),
    dataManagementApi: populateUrlTemplate(apiTemplate, tenantId, contextValue, contextConfig)
  };

  // Determine database type from environment
  const dbType = process.env.DB_TYPE || 'postgres';
  const database = dbType === 'mssql' ? 'MSSQLSERVER' : 'PostgreSQL';

  const response = {
    version: '1.0.0',
    database: database,
    urls: urls
  };

  res.json(response);
}
