// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { isMultiTenancyEnabled } from '../config/multi-tenancy-config.js';
import {
  getOdsContextConfig,
  buildUrlTemplate,
  populateUrlTemplate
} from '../config/ods-context-config.js';
import { getExternalBaseUrl } from '../utils/urlHelper.js';
import { isSwaggerUiEnabled, isOpenApiMetadataEnabled } from '../config/api-docs.js';

/**
 * Get discovery response with populated URLs
 */
export function getDiscovery(req, res) {
  const baseUrl = getExternalBaseUrl(req);
  const multiTenancyEnabled = isMultiTenancyEnabled();
  const contextConfig = getOdsContextConfig();

  // Extract tenant and context from request params (may be null if not in route)
  const tenantId = req.params.tenantId || null;
  const contextValue = contextConfig?.parameterName ? req.params[contextConfig.parameterName] : null;

  // Build URL templates with all placeholders
  const oauthTemplate = buildUrlTemplate(process.env.OAUTH2_ISSUERBASEURL, multiTenancyEnabled, contextConfig, '/oauth/token');
  const apiTemplate = buildUrlTemplate(baseUrl, multiTenancyEnabled, contextConfig, '/ims/oneroster/rostering/v1p2/');

  // Populate templates with actual values (leaves placeholders for null values)
  // Each documentation URL is advertised only while its endpoint is mounted; see
  // ENABLE_OPEN_API_METADATA and ENABLE_SWAGGER_UI.
  const urls = {};

  if (isOpenApiMetadataEnabled()) {
    const swaggerTemplate = buildUrlTemplate(baseUrl, multiTenancyEnabled, contextConfig, '/swagger.json');
    urls.openApiMetadata = populateUrlTemplate(swaggerTemplate, tenantId, contextValue, contextConfig);
  }

  if (isSwaggerUiEnabled()) {
    const docsTemplate = buildUrlTemplate(baseUrl, multiTenancyEnabled, contextConfig, '/docs');
    urls.swaggerUI = populateUrlTemplate(docsTemplate, tenantId, contextValue, contextConfig);
  }

  urls.oauth = populateUrlTemplate(oauthTemplate, tenantId, contextValue, contextConfig);
  urls.dataManagementApi = populateUrlTemplate(apiTemplate, tenantId, contextValue, contextConfig);

  const response = {
    version: '1.0.0',
    urls: urls
  };

  res.json(response);
}
