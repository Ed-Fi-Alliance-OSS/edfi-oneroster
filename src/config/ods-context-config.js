// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Get ODS context route template from environment
 */
export function getOdsContextRouteTemplate() {
  return process.env.ODS_CONTEXT_ROUTE_TEMPLATE || null;
}

/**
 * Parse ODS context route template to extract parameter name and constraint
 */
export function parseOdsContextTemplate(template) {
  if (!template) return null;

  // Match pattern: {parameterName:constraintType(args)}
  // Examples: {schoolYearFromRoute:range(2026,2027)}, {year:int}
  const match = template.match(/^\{([^:}]+)(?::([^(}]+)(?:\(([^)]+)\))?)?\}$/);

  if (!match) {
    console.warn(`[OdsContext] Invalid template format: ${template}`);
    return null;
  }

  const [, parameterName, constraintType, constraintArgs] = match;

  return {
    parameterName: parameterName.trim(),
    constraintType: constraintType?.trim() || null,
    constraintArgs: constraintArgs?.trim() || null,
    fullConstraint: constraintType ? `${constraintType}${constraintArgs ? `(${constraintArgs})` : ''}` : null
  };
}

/**
 * Get parsed ODS context configuration
 * @returns {Object|null} Parsed context config or null if not configured
 */
export function getOdsContextConfig() {
  const template = getOdsContextRouteTemplate();
  if (!template) return null;

  return parseOdsContextTemplate(template);
}

/**
 * Check if ODS context routing is enabled
 */
export function isOdsContextEnabled() {
  return !!getOdsContextRouteTemplate();
}

/**
 * Validate a context value against the constraint
 */
export function validateContextValue(value, contextConfig) {
  if (!contextConfig) return true; // No validation if no context

  const { constraintType, constraintArgs } = contextConfig;

  if (!constraintType) {
    // No constraint specified, just check that value exists
    return !!value;
  }

  switch (constraintType.toLowerCase()) {
    case 'range': {
      // Parse range(min,max)
      if (!constraintArgs) return false;
      const [min, max] = constraintArgs.split(',').map(s => parseInt(s.trim(), 10));
      const numValue = parseInt(value, 10);
      return !isNaN(numValue) && numValue >= min && numValue <= max;
    }

    case 'int':
    case 'integer': {
      const numValue = parseInt(value, 10);
      return !isNaN(numValue) && numValue.toString() === value;
    }

    case 'regex': {
      if (!constraintArgs) return false;
      const regex = new RegExp(constraintArgs);
      return regex.test(value);
    }

    case 'values': {
      // Parse values(2025,2026,2027)
      if (!constraintArgs) return false;
      const allowedValues = constraintArgs.split(',').map(s => s.trim());
      return allowedValues.includes(value);
    }

    default:
      console.warn(`[OdsContext] Unknown constraint type: ${constraintType}`);
      return true; // Allow by default if constraint type is unknown
  }
}

/**
 * Build route pattern for Express based on multi-tenancy and context configuration
 */
export function buildRoutePattern(multiTenancyEnabled, contextConfig) {
  const parts = [];

  if (multiTenancyEnabled) {
    parts.push(':tenantId');
  }

  if (contextConfig?.parameterName) {
    parts.push(`:${contextConfig.parameterName}`);
  }

  return parts.length > 0 ? `/${parts.join('/')}` : '';
}

/**
 * Build URL template for discovery responses
 */
export function buildUrlTemplate(baseUrl, multiTenancyEnabled, contextConfig, path = '') {
  const parts = [baseUrl.replace(/\/$/, '')];

  if (multiTenancyEnabled) {
    parts.push('{tenantIdentifier}');
  }

  if (contextConfig?.parameterName) {
    parts.push(`{${contextConfig.parameterName}}`);
  }

  if (path) {
    parts.push(path.replace(/^\//, ''));
  }

  return parts.join('/');
}

/**
 * Populate URL template with actual values from request
 */
export function populateUrlTemplate(template, tenantId, contextValue, contextConfig) {
  let url = template;

  if (tenantId) {
    url = url.replace('{tenantIdentifier}', tenantId);
  }

  if (contextValue && contextConfig?.parameterName) {
    url = url.replace(`{${contextConfig.parameterName}}`, contextValue);
  }

  return url;
}
