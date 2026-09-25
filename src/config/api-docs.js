// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * API documentation endpoint configuration
 *
 * The Swagger UI console and the OpenAPI document are controlled separately, matching the
 * swaggerUI and openApiMetadata URLs advertised by the discovery endpoint; the UI follows the
 * document when its own setting is unset. The document defaults to enabled, and both settings
 * accept only "true" or "false", case-insensitively and ignoring surrounding whitespace;
 * envValidator rejects any other value at startup.
 *
 * These defaults are the single source of truth: the Docker stack passes the variables through
 * without supplying its own defaults.
 */

function isEnabled(value) {
  return (value || 'true').trim().toLowerCase() !== 'false';
}

function configuredSwaggerUi() {
  return (process.env.ENABLE_SWAGGER_UI || '').trim();
}

/**
 * Whether the Swagger UI console (/docs and its static assets) is served.
 *
 * The console loads its spec from the /swagger.json path it derives from its own URL, so it
 * cannot run without the OpenAPI document. When ENABLE_SWAGGER_UI is unset it therefore
 * follows ENABLE_OPEN_API_METADATA, which lets disabling the document alone turn both off.
 * Setting it to "true" explicitly while the document is disabled is rejected by envValidator
 * at startup.
 * @returns {boolean}
 */
export function isSwaggerUiEnabled() {
  const configured = configuredSwaggerUi();
  return configured ? isEnabled(configured) : isOpenApiMetadataEnabled();
}

/**
 * Whether ENABLE_SWAGGER_UI was set explicitly rather than following the OpenAPI metadata
 * setting. Lets callers report which variable actually governs the console.
 * @returns {boolean}
 */
export function isSwaggerUiConfigured() {
  return configuredSwaggerUi() !== '';
}

/**
 * Whether the OpenAPI document (/swagger.json) is served.
 * @returns {boolean}
 */
export function isOpenApiMetadataEnabled() {
  return isEnabled(process.env.ENABLE_OPEN_API_METADATA);
}
