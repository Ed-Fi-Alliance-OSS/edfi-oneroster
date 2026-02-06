// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Authorization Query Service
 * Handles education organization-based filtering using Ed-Fi auth views
 */

class AuthorizationQueryService {
  constructor(knexInstance, schema = 'oneroster12', authSchema = 'auth') {
    this.knex = knexInstance;
    this.schema = schema;
    this.authSchema = authSchema;
  }

  /**
   * Get all accessible education organization IDs for a given org
   * Uses hierarchical view to include child organizations
   */
  async getAccessibleEducationOrganizationIds(educationOrganizationId) {
    try {
      const results = await this.knex
        .withSchema(this.authSchema)
        .table('EducationOrganizationIdToEducationOrganizationId')
        .select('TargetEducationOrganizationId')
        .where('SourceEducationOrganizationId', educationOrganizationId);

      console.log(`[AuthorizationQueryService] Found ${results.length} accessible orgs for ${educationOrganizationId}`);

      return results.map(row => row.TargetEducationOrganizationId);
    } catch (error) {
      console.error('[AuthorizationQueryService] Error getting accessible org IDs:', error.message);
      throw error;
    }
  }

  /**
   * Get all accessible student USIs for given education organization IDs
   */
  async getAccessibleStudentUSIs(educationOrganizationIds) {
    if (!educationOrganizationIds || educationOrganizationIds.length === 0) {
      return [];
    }

    try {
      const results = await this.knex
        .withSchema(this.authSchema)
        .table('EducationOrganizationIdToStudentUSI')
        .select('StudentUSI')
        .whereIn('SourceEducationOrganizationId', educationOrganizationIds)
        .distinct();

      console.log(`[AuthorizationQueryService] Found ${results.length} accessible students`);

      return results.map(row => row.StudentUSI);
    } catch (error) {
      console.error('[AuthorizationQueryService] Error getting accessible student USIs:', error.message);
      throw error;
    }
  }

  /**
   * Get all accessible staff USIs for given education organization IDs
   */
  async getAccessibleStaffUSIs(educationOrganizationIds) {
    if (!educationOrganizationIds || educationOrganizationIds.length === 0) {
      return [];
    }

    try {
      const results = await this.knex
        .withSchema(this.authSchema)
        .table('EducationOrganizationIdToStaffUSI')
        .select('StaffUSI')
        .whereIn('SourceEducationOrganizationId', educationOrganizationIds)
        .distinct();

      console.log(`[AuthorizationQueryService] Found ${results.length} accessible staff members`);

      return results.map(row => row.StaffUSI);
    } catch (error) {
      console.error('[AuthorizationQueryService] Error getting accessible staff USIs:', error.message);
      throw error;
    }
  }

  /**
   * Get all accessible education organization IDs including hierarchical children
   * @param {Array<string>} educationOrganizationIds - Source education organization IDs
   * @returns {Array<string>|null} Unique list of accessible org IDs, or null if input is empty
   */
  async getAllAccessibleOrgIds(educationOrganizationIds) {
    if (!educationOrganizationIds || educationOrganizationIds.length === 0) {
      return null;
    }

    // Get accessible orgs including children
    const accessibleOrgIds = [];
    for (const orgId of educationOrganizationIds) {
      const childOrgIds = await this.getAccessibleEducationOrganizationIds(orgId);
      accessibleOrgIds.push(...childOrgIds);
    }
    accessibleOrgIds.push(...educationOrganizationIds);

    // Remove duplicates
    const uniqueOrgIds = [...new Set(accessibleOrgIds)];

    return uniqueOrgIds.length > 0 ? uniqueOrgIds : null;
  }

  /**
   * Build authorization filter for organizations
   * Returns SQL WHERE clause to filter orgs table
   */
  async buildOrgAuthorizationFilter(educationOrganizationIds) {
    const uniqueOrgIds = await this.getAllAccessibleOrgIds(educationOrganizationIds);

    if (!uniqueOrgIds) {
      return null;
    }

    return { field: 'identifier', values: uniqueOrgIds };
  }

  /**
   * Build authorization filter for users (students/teachers)
   * Returns SQL WHERE clause to filter users table
   */
  async buildUserAuthorizationFilter(educationOrganizationIds, role = null) {
    const uniqueOrgIds = await this.getAllAccessibleOrgIds(educationOrganizationIds);

    if (!uniqueOrgIds) {
      return null;
    }

    let userUSIs = [];

    if (!role || role === 'student') {
      const studentUSIs = await this.getAccessibleStudentUSIs(uniqueOrgIds);
      userUSIs.push(...studentUSIs);
    }

    if (!role || role === 'teacher') {
      const staffUSIs = await this.getAccessibleStaffUSIs(uniqueOrgIds);
      userUSIs.push(...staffUSIs);
    }

    // Remove duplicates
    userUSIs = [...new Set(userUSIs)];

    if (userUSIs.length === 0) {
      return null;
    }

    return { field: 'userMasterIdentifier', values: userUSIs };
  }

  /**
   * Build authorization filter for classes
   * Returns SQL WHERE clause to filter classes table
   */
  async buildClassAuthorizationFilter(educationOrganizationIds) {
    if (!educationOrganizationIds || educationOrganizationIds.length === 0) {
      return null;
    }

   const authAlias = 'auth_class_eo';
   return {
      type: 'join',
      alias: authAlias,
      apply: (query) =>
        query
          .innerJoin(
            this.knex.raw(
              `${this.authSchema}.EducationOrganizationIdToEducationOrganizationId as ${authAlias}`
            ),
            'classes.educationOrganizationId',
            `${authAlias}.TargetEducationOrganizationId`
          )
          .whereIn(`${authAlias}.SourceEducationOrganizationId`, educationOrganizationIds)
    };
  }


  /**
   * Build authorization filter for courses
   * Returns SQL WHERE clause to filter courses table
   */
  async buildCourseAuthorizationFilter(educationOrganizationIds) {
    const uniqueOrgIds = await this.getAllAccessibleOrgIds(educationOrganizationIds);

    if (!uniqueOrgIds) {
      return null;
    }

    // Courses are filtered by org identifier
    return { field: 'orgSourcedId', values: uniqueOrgIds };
  }

  /**
   * Build authorization filter for enrollments
   * Returns SQL WHERE clause to filter enrollments table
   */
  async buildEnrollmentAuthorizationFilter(educationOrganizationIds) {
    const uniqueOrgIds = await this.getAllAccessibleOrgIds(educationOrganizationIds);

    if (!uniqueOrgIds) {
      return null;
    }

    // Enrollments are filtered by school identifier
    return { field: 'schoolSourcedId', values: uniqueOrgIds };
  }

  /**
   * Build authorization filter for demographics
   * Returns SQL WHERE clause to filter demographics table
   */
  async buildDemographicsAuthorizationFilter(educationOrganizationIds) {
    // Demographics are linked to students, so use student authorization
    const userFilter = await this.buildUserAuthorizationFilter(educationOrganizationIds, 'student');

    if (!userFilter) {
      return null;
    }

    // Demographics uses sourcedId which maps to student USI
    return { field: 'sourcedId', values: userFilter.values };
  }

  /**
   * Apply authorization filter to a Knex query
   * @param {Object} query - Knex query builder object
   * @param {Object} authFilter - Authorization filter { field, values }
   * @returns {Object} Modified Knex query
   */
  applyAuthorizationFilter(query, authFilter) {
    if (!authFilter) {
      return query;
    }

    if (authFilter.type === 'join' && typeof authFilter.apply === 'function') {
      return authFilter.apply(query);
    }

    if (!authFilter.values || authFilter.values.length === 0) {
      return query;
    }

    const stringValues = authFilter.values.map(v => String(v));

    return query.whereIn(authFilter.field, stringValues);
  }

  /**
   * Get authorization filter for any endpoint
   * @param {string} endpoint - Endpoint name (e.g., 'users', 'classes', 'orgs')
   * @param {Array<string>} educationOrganizationIds - Education org IDs to filter by
   * @param {string} role - Optional role filter for users ('student', 'teacher')
   * @returns {Object|null} Authorization filter object
   */
  async getAuthorizationFilter(endpoint, educationOrganizationIds, role = null) {
    if (!educationOrganizationIds || educationOrganizationIds.length === 0) {
      return null;
    }

    switch (endpoint) {
      case 'orgs':
        return await this.buildOrgAuthorizationFilter(educationOrganizationIds);

      case 'users':
        return await this.buildUserAuthorizationFilter(educationOrganizationIds, role);

      case 'classes':
        return await this.buildClassAuthorizationFilter(educationOrganizationIds);

      case 'courses':
        return await this.buildCourseAuthorizationFilter(educationOrganizationIds);

      case 'enrollments':
        return await this.buildEnrollmentAuthorizationFilter(educationOrganizationIds);

      case 'demographics':
        return await this.buildDemographicsAuthorizationFilter(educationOrganizationIds);

      case 'academicsessions':
        // Academic sessions don't have org-specific filtering in standard OneRoster
        return null;

      default:
        console.warn(`[AuthorizationQueryService] No authorization filter defined for endpoint: ${endpoint}`);
        return null;
    }
  }

  /**
   * Test connection to auth views
   */
  async testAuthViews() {
    try {
      // Test each auth view
      await this.knex.withSchema(this.authSchema).table('EducationOrganizationIdToEducationOrganizationId').limit(1);
      await this.knex.withSchema(this.authSchema).table('EducationOrganizationIdToStudentUSI').limit(1);
      await this.knex.withSchema(this.authSchema).table('EducationOrganizationIdToStaffUSI').limit(1);

      console.log('[AuthorizationQueryService] Auth views test successful');
      return true;
    } catch (error) {
      console.error('[AuthorizationQueryService] Auth views test failed:', error.message);
      throw error;
    }
  }
}

module.exports = AuthorizationQueryService;
