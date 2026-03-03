// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Authorization Query Service
 * Handles education organization-based filtering using Ed-Fi auth views
 */

const AUTH_TABLES = {
  orgToOrg: 'educationorganizationidtoeducationorganizationid',
  orgToStudent: 'educationorganizationidtostudentusi',
  orgToStaff: 'educationorganizationidtostaffusi',
  orgToContact: 'educationorganizationidtocontactusi',
  orgToParent: 'educationorganizationidtoparentusi'
};

const AUTH_COLUMNS = {
  sourceOrgId: 'sourceeducationorganizationid',
  targetOrgId: 'targeteducationorganizationid',
  studentUsi: 'studentusi',
  staffUsi: 'staffusi',
  contactUsi: 'contactusi',
  parentUsi: 'parentusi'
};

class AuthorizationQueryService {
  constructor(knexInstance, schema = 'oneroster12', authSchema = 'auth') {
    this.knex = knexInstance;
    this.schema = schema;
    this.authSchema = authSchema;
    this.parentAuthMapping = null;
  }

  async resolveParentAuthMapping() {
    const defaultMapping = {
      tableName: AUTH_TABLES.orgToContact,
      usiColumn: AUTH_COLUMNS.contactUsi
    };

    if (this.parentAuthMapping) {
      return this.parentAuthMapping;
    }

    if (!this.knex?.schema || typeof this.knex.schema.withSchema !== 'function') {
      this.parentAuthMapping = defaultMapping;
      return this.parentAuthMapping;
    }

    const candidates = [
      defaultMapping,
      { tableName: AUTH_TABLES.orgToParent, usiColumn: AUTH_COLUMNS.parentUsi }
    ];

    for (const candidate of candidates) {
      try {
        const exists = await this.knex.schema.withSchema(this.authSchema).hasTable(candidate.tableName);
        if (exists) {
          this.parentAuthMapping = candidate;
          return this.parentAuthMapping;
        }
      } catch (error) {
        console.warn(
          `[AuthorizationQueryService] Unable to check auth view ${candidate.tableName}: ${error.message}`
        );
      }
    }

    this.parentAuthMapping = defaultMapping;

    return this.parentAuthMapping;
  }

  /**
  * Build a subquery for accessible education organization IDs
  * @param {Array<string>} educationOrganizationIds - Source education organization IDs
  * @returns {Object|null} Knex subquery selecting accessible org IDs, or null if input is empty
   */
  buildAccessibleOrgIdsQuery(educationOrganizationIds) {
    if (!educationOrganizationIds || educationOrganizationIds.length === 0) {
      return null;
    }

    return this.knex
      .withSchema(this.authSchema)
      .select(AUTH_COLUMNS.targetOrgId)
      .from(AUTH_TABLES.orgToOrg)
      .whereIn(AUTH_COLUMNS.sourceOrgId, educationOrganizationIds);
  }

  /**
   * Build authorization filter for organizations
   * Returns SQL WHERE clause to filter orgs table
   */
  async buildOrgAuthorizationFilter(educationOrganizationIds) {
    const accessibleOrgIds = this.buildAccessibleOrgIdsQuery(educationOrganizationIds);

    if (!accessibleOrgIds) {
      return null;
    }

    return { field: 'educationOrganizationId', values: accessibleOrgIds };
  }

  /**
   * Build authorization filter for users (students/teachers)
   * Returns SQL WHERE clause to filter users table
   */
  async buildUserAuthorizationFilter(educationOrganizationIds) {
    const accessibleOrgIds = this.buildAccessibleOrgIdsQuery(educationOrganizationIds);
    const parentAuthMapping = await this.resolveParentAuthMapping();

    if (!accessibleOrgIds) {
      return null;
    }

    const studentAuthQuery = () =>
      this.knex
        .withSchema(this.authSchema)
        .select(AUTH_COLUMNS.studentUsi)
        .from(AUTH_TABLES.orgToStudent)
        .whereIn(AUTH_COLUMNS.sourceOrgId, educationOrganizationIds);

    const staffAuthQuery = () =>
      this.knex
        .withSchema(this.authSchema)
        .select(AUTH_COLUMNS.staffUsi)
        .from(AUTH_TABLES.orgToStaff)
        .whereIn(AUTH_COLUMNS.sourceOrgId, educationOrganizationIds);

    const contactAuthQuery = () =>
      this.knex
        .withSchema(this.authSchema)
        .select(parentAuthMapping.usiColumn)
        .from(parentAuthMapping.tableName)
        .whereIn(AUTH_COLUMNS.sourceOrgId, educationOrganizationIds);


    return {
      apply: query =>
        query.whereIn('users.educationOrganizationId', accessibleOrgIds)
        .where(builder => {
            builder.orWhere(studentFilter => {
              studentFilter
                .where('users.role', 'student')
                .whereIn('users.participantUSI', studentAuthQuery());
            });

            builder.orWhere(parentFilter => {
              parentFilter
                .where('users.role', 'parent')
                .whereIn('users.participantUSI', contactAuthQuery());
            });

            builder.orWhere(staffFilter => {
              staffFilter
                .whereNotIn('users.role', ['student', 'parent'])
                .whereIn('users.participantUSI', staffAuthQuery());
            });
        })
    };
  }

  /**
   * Build authorization filter for classes
   * Returns SQL WHERE clause to filter classes table
   */
  async buildClassAuthorizationFilter(educationOrganizationIds) {
    const accessibleOrgIds = this.buildAccessibleOrgIdsQuery(educationOrganizationIds);

    if (!accessibleOrgIds) {
      return null;
    }

    return { field: 'educationOrganizationId', values: accessibleOrgIds };
  }

  /**
   * Build authorization filter for courses
   * Returns SQL WHERE clause to filter courses table
   */
  async buildCourseAuthorizationFilter(educationOrganizationIds) {
    const accessibleOrgIds = this.buildAccessibleOrgIdsQuery(educationOrganizationIds);

    if (!accessibleOrgIds) {
      return null;
    }

    /**
    * Uses the RelationshipsWithEdOrgsOnlyInverted authorization strategy to enable
    * reference data access up the education organization hierarchy. The parent
    * EducationOrganizationId is derived from the authorized EducationOrganizationId,
    * allowing schools to read district-level course records while preventing access
    * to data owned by other schools or districts.
    */
    const courseSourceOrgQuery = () =>
      this.knex
        .withSchema(this.authSchema)
        .distinct(AUTH_COLUMNS.sourceOrgId)
        .from(AUTH_TABLES.orgToOrg)
        .whereIn(AUTH_COLUMNS.targetOrgId, educationOrganizationIds);

    return {
      apply: query =>
        query.where(builder => {
          builder
            .whereIn('courses.educationOrganizationId', accessibleOrgIds)
            .orWhereIn('courses.educationOrganizationId', courseSourceOrgQuery());
        })
    };
  }

  /**
   * Build authorization filter for enrollments
   * Returns SQL WHERE clause to filter enrollments table
   */
  async buildEnrollmentAuthorizationFilter(educationOrganizationIds) {
    const accessibleOrgIds = this.buildAccessibleOrgIdsQuery(educationOrganizationIds);

    if (!accessibleOrgIds) {
      return null;
    }

    const studentAuthQuery = () =>
      this.knex
        .withSchema(this.authSchema)
        .select(AUTH_COLUMNS.studentUsi)
        .from(AUTH_TABLES.orgToStudent)
        .whereIn(AUTH_COLUMNS.sourceOrgId, educationOrganizationIds);

    const staffAuthQuery = () =>
      this.knex
        .withSchema(this.authSchema)
        .select(AUTH_COLUMNS.staffUsi)
        .from(AUTH_TABLES.orgToStaff)
        .whereIn(AUTH_COLUMNS.sourceOrgId, educationOrganizationIds);

    return {
      apply: query =>
        query
          .whereIn('enrollments.educationOrganizationId', accessibleOrgIds)
          .where(builder => {
            builder
              .where(studentFilter => {
                studentFilter
                  .where('enrollments.role', 'student')
                  .whereIn('enrollments.participantUSI', studentAuthQuery());
              })
              .orWhere(staffFilter => {
                staffFilter
                  .where('enrollments.role', 'teacher')
                  .whereIn('enrollments.participantUSI', staffAuthQuery());
              });
          })
    };
  }

  /**
   * Build authorization filter for demographics
   * Returns SQL WHERE clause to filter demographics table
   */
  async buildDemographicsAuthorizationFilter(educationOrganizationIds) {
    const accessibleOrgIds = this.buildAccessibleOrgIdsQuery(educationOrganizationIds);

    if (!accessibleOrgIds) {
      return null;
    }

    const studentAuthQuery = () =>
      this.knex
        .withSchema(this.authSchema)
        .select(AUTH_COLUMNS.studentUsi)
        .from(AUTH_TABLES.orgToStudent)
        .whereIn(AUTH_COLUMNS.sourceOrgId, educationOrganizationIds);

     return {
      apply: query =>
        query
          .whereIn('demographics.educationOrganizationId', accessibleOrgIds)
          .where(builder => {
            builder
              .where(studentFilter => {
                studentFilter
                  .whereIn('demographics.studentUSI', studentAuthQuery());
              })
          })
    };
  }

  /**
   * Build authorization filter for academic sessions
   * Returns SQL WHERE clause to filter academicsessions table
   */
  async buildAcademicSessionAuthorizationFilter(educationOrganizationIds) {
    const accessibleOrgIds = this.buildAccessibleOrgIdsQuery(educationOrganizationIds);

    if (!accessibleOrgIds) {
      return null;
    }

    /**
    * Uses the RelationshipsWithEdOrgsOnlyInverted authorization strategy for schoolYear.
    * The parent EducationOrganizationId is derived from the authorized
    * EducationOrganizationId so schools can read district-level school year records
    */
    const schoolYearSourceOrgQuery = () =>
      this.knex
        .withSchema(this.authSchema)
        .distinct(AUTH_COLUMNS.sourceOrgId)
        .from(AUTH_TABLES.orgToOrg)
        .whereIn(AUTH_COLUMNS.targetOrgId, educationOrganizationIds);

    return {
      apply: query =>
        query.where(builder => {
          builder
            .where(nonSchoolYearFilter => {
              nonSchoolYearFilter
                .where('academicsessions.type', '!=', 'schoolYear')
                .whereIn('academicsessions.educationOrganizationId', accessibleOrgIds);
            })
            .orWhere(schoolYearFilter => {
              schoolYearFilter
                .where('academicsessions.type', 'schoolYear')
                .where(schoolYearOrgBuilder => {
                  schoolYearOrgBuilder
                    .whereIn('academicsessions.educationOrganizationId', schoolYearSourceOrgQuery());
                });
            });
        })
    };
  }

  /**
   * Apply authorization filter to a Knex query
   * @param {Object} query - Knex query builder object
   * @param {Object} authFilter - Authorization filter { field, values } or { apply }
   * @returns {Object} Modified Knex query
   */
  applyAuthorizationFilter(query, authFilter) {
    if (!authFilter) {
      return query;
    }

    if (typeof authFilter.apply === 'function') {
      return authFilter.apply(query);
    }

    if (!authFilter.values) {
      return query;
    }

    if (typeof authFilter.values.toSQL === 'function') {
      return query.whereIn(authFilter.field, authFilter.values);
    }

    if (authFilter.values.length === 0) {
      return query;
    }

    const stringValues = authFilter.values.map(v => String(v));

    return query.whereIn(authFilter.field, stringValues);
  }

  /**
   * Get authorization filter for any endpoint
   * @param {string} endpoint - Endpoint name (e.g., 'users', 'classes', 'orgs')
   * @param {Array<string>} educationOrganizationIds - Education org IDs to filter by
   * @returns {Object|null} Authorization filter object
   */
  async getAuthorizationFilter(endpoint, educationOrganizationIds) {
    if (!educationOrganizationIds || educationOrganizationIds.length === 0) {
      return null;
    }

    switch (endpoint) {
      case 'orgs':
        return await this.buildOrgAuthorizationFilter(educationOrganizationIds);

      case 'users':
        return await this.buildUserAuthorizationFilter(educationOrganizationIds);

      case 'classes':
        return await this.buildClassAuthorizationFilter(educationOrganizationIds);

      case 'courses':
        return await this.buildCourseAuthorizationFilter(educationOrganizationIds);

      case 'enrollments':
        return await this.buildEnrollmentAuthorizationFilter(educationOrganizationIds);

      case 'demographics':
        return await this.buildDemographicsAuthorizationFilter(educationOrganizationIds);

      case 'academicsessions':
        return await this.buildAcademicSessionAuthorizationFilter(educationOrganizationIds);

      default:
        console.warn(`[AuthorizationQueryService] No authorization filter defined for endpoint: ${endpoint}`);
        return null;
    }
  }

}

module.exports = AuthorizationQueryService;
