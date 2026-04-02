// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Authorization Handler
 * Validates OAuth2 scopes and education organization access
 */

const ROSTER_SCOPES = {
    FULL: 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly',
    CORE: 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly',
    DEMOGRAPHICS: 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-demographics.readonly'
};

/**
 * Validate OAuth2 scope for endpoint access
 * @param {Object} req - Express request object
 * @param {string} endpoint - Endpoint name (e.g., 'demographics', 'users')
 * @returns {Object|null} Error response object if validation fails, null if valid
 */
function validateScope(req, endpoint) {
    const scope = req.auth?.payload?.scope || '';
    const isDemographics = endpoint === 'demographics';

    const hasFullAccess = scope.includes(ROSTER_SCOPES.FULL);
    const hasCoreScope = scope.includes(ROSTER_SCOPES.CORE);
    const hasDemographicsScope = scope.includes(ROSTER_SCOPES.DEMOGRAPHICS);

    if (isDemographics && !hasDemographicsScope) {
        return {
            imsx_codeMajor: 'failure',
            imsx_severity: 'error',
            imsx_description: `Insufficient scope: your token must have the '${ROSTER_SCOPES.DEMOGRAPHICS}' scope to access this route.`
        };
    }

    if (!isDemographics && !hasFullAccess && !hasCoreScope) {
        return {
            imsx_codeMajor: 'failure',
            imsx_severity: 'error',
            imsx_description: `Insufficient scope: your token must have the '${ROSTER_SCOPES.FULL}' or '${ROSTER_SCOPES.CORE}' scope to access this route.`
        };
    }

    return null;
}

/**
 * Get education organization IDs from token claims
 * @param {Object} req - Express request object
 * @returns {Array<string>} Array of education organization IDs
 */
function getEducationOrgIds(req) {
    if (!req.auth?.payload) {
        return [];
    }

    // Extract education org IDs from token claims
    // Adjust the claim name based on your OAuth2 provider's token structure
    const orgIds = req.auth.payload.educationOrganizationId || [];

    return Array.isArray(orgIds) ? orgIds : [orgIds];
}

/**
 * Middleware to validate authorization and extract education org IDs
 * @param {string} endpoint - Endpoint name
 * @returns {Function} Express middleware function
 */
function authorizeEndpoint(endpoint) {
    return (req, res, next) => {
        // Validate OAuth2 scope
        const scopeError = validateScope(req, endpoint);
        if (scopeError) {
            return res.status(403).json(scopeError);
        }

        // Get education organization IDs from token and attach to request
        req.educationOrgIds = getEducationOrgIds(req);

        next();
    };
  }

export { authorizeEndpoint, ROSTER_SCOPES };
