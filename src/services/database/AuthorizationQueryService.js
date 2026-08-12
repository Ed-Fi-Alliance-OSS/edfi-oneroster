// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
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

// Endpoints with a purpose-built authorization filter
const AUTH_ENDPOINTS = {
  orgs: 'orgs',
  users: 'users',
  classes: 'classes',
  courses: 'courses',
  enrollments: 'enrollments',
  demographics: 'demographics',
  academicSessions: 'academicsessions'
};

// Membership set for the full-access short circuit, so an unrecognised endpoint can never
// take the unfiltered path. Derived from the map above so the two cannot drift apart.
const AUTH_ENDPOINT_NAMES = new Set(Object.values(AUTH_ENDPOINTS));

// Authoritative list of education organizations, independent of the auth mappings
const EDFI_SCHEMA = 'edfi';
const EDFI_ORG_TABLE = 'educationorganization';
const EDFI_ORG_ID_COLUMN = 'educationorganizationid';

class AuthorizationQueryService {
  constructor(knexInstance, schema = 'oneroster12', authSchema = 'auth') {
    this.knex = knexInstance;
    this.schema = schema;
    this.authSchema = authSchema;
    this.parentAuthMapping = null;
  }

  /**
   * Determine whether the caller reaches every education organization in the ODS.
   *
   * When they do, the relationship filter excludes nothing, so evaluating it per row is
   * pure overhead: the auth mappings are correlated subqueries the optimizer cannot estimate
   * through, which forces a nested loop over the whole table.
   *
   * Any error, or an inability to determine coverage, leaves normal filtering in place.
   *
   * @param {Array<string|number>} educationOrganizationIds - Source education organization IDs
   * @returns {Promise<boolean>} True when the caller's reach covers the whole hierarchy
   */
  async hasFullEducationOrganizationAccess(educationOrganizationIds) {
    // No claims means no access, and an empty list would make the coverage query invalid
    if (!educationOrganizationIds || educationOrganizationIds.length === 0) {
      return false;
    }

    const coverage = await this.getOrgCoverage(educationOrganizationIds);

    if (coverage === null) {
      return false;
    }

    // An ODS with no organizations at all must not be read as universal access
    return coverage.hasOrgs && !coverage.hasUnreachableOrgs;
  }

  /**
   * Establish whether any education organization exists that the caller cannot reach.
   *
   * Measured against edfi.educationorganization rather than the auth mapping, so an
   * incomplete mapping cannot read as full coverage and grant unfiltered access.
   *
   * Both figures come from one statement so they describe the same snapshot, and each is an
   * existence test rather than a count, so a partially authorized caller is answered after a
   * handful of rows rather than a scan of every organization.
   *
   * @param {Array<string|number>} educationOrganizationIds - Source education organization IDs
   * @returns {Promise<Object|null>} { hasOrgs, hasUnreachableOrgs }, or null if undetermined
   */
  async getOrgCoverage(educationOrganizationIds) {
    // Schema and column names are internal constants; only the caller's IDs are bound
    const idPlaceholders = educationOrganizationIds.map(() => '?').join(', ');

    const sql = `select
        case when exists (
              select 1 from ${EDFI_SCHEMA}.${EDFI_ORG_TABLE}
            ) then 1 else 0 end as hasorgs,
        case when exists (
              select 1
                from ${EDFI_SCHEMA}.${EDFI_ORG_TABLE} edorg
               where not exists (
                     select 1
                       from ${this.authSchema}.${AUTH_TABLES.orgToOrg} auth_map
                      where auth_map.${AUTH_COLUMNS.targetOrgId} = edorg.${EDFI_ORG_ID_COLUMN}
                        and auth_map.${AUTH_COLUMNS.sourceOrgId} in (${idPlaceholders})
                   )
            ) then 1 else 0 end as hasunreachable`;

    try {
      const result = await this.knex.raw(sql, educationOrganizationIds);

      // PostgreSQL returns { rows }, MSSQL returns the array directly
      const rows = result?.rows || result;

      if (!Array.isArray(rows) || rows.length === 0) {
        return null;
      }

      const hasOrgs = Number(rows[0]?.hasorgs);
      const hasUnreachable = Number(rows[0]?.hasunreachable);

      if (!Number.isFinite(hasOrgs) || !Number.isFinite(hasUnreachable)) {
        return null;
      }

      return { hasOrgs: hasOrgs !== 0, hasUnreachableOrgs: hasUnreachable !== 0 };
    } catch (error) {
      console.warn(
        `[AuthorizationQueryService] Unable to determine education organization coverage: ${error.message}`
      );
      return null;
    }
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
        .select(AUTH_COLUMNS.sourceOrgId)
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
        .select(AUTH_COLUMNS.sourceOrgId)
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
                    .whereIn('academicsessions.educationOrganizationId', schoolYearSourceOrgQuery())
                    .orWhereIn('academicsessions.educationOrganizationId', accessibleOrgIds);
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

    // An empty set of accessible education organization IDs means the caller reaches nothing,
    // so the filter must exclude every row. Stated explicitly rather than relying on knex
    // emitting "1 = 0" for an empty whereIn.
    if (authFilter.values.length === 0) {
      return query.whereRaw('1 = 0');
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

    // Restricted to endpoints with a filter of their own, so an unrecognised endpoint falls
    // through to the null return below rather than reaching the pass-through. fullAccess lets
    // callers report that filtering was skipped; apply() keeps the shape uniform for
    // applyAuthorizationFilter.
    if (AUTH_ENDPOINT_NAMES.has(endpoint) && await this.hasFullEducationOrganizationAccess(educationOrganizationIds)) {
      return { fullAccess: true, apply: query => query };
    }

    switch (endpoint) {
      case AUTH_ENDPOINTS.orgs:
        return await this.buildOrgAuthorizationFilter(educationOrganizationIds);

      case AUTH_ENDPOINTS.users:
        return await this.buildUserAuthorizationFilter(educationOrganizationIds);

      case AUTH_ENDPOINTS.classes:
        return await this.buildClassAuthorizationFilter(educationOrganizationIds);

      case AUTH_ENDPOINTS.courses:
        return await this.buildCourseAuthorizationFilter(educationOrganizationIds);

      case AUTH_ENDPOINTS.enrollments:
        return await this.buildEnrollmentAuthorizationFilter(educationOrganizationIds);

      case AUTH_ENDPOINTS.demographics:
        return await this.buildDemographicsAuthorizationFilter(educationOrganizationIds);

      case AUTH_ENDPOINTS.academicSessions:
        return await this.buildAcademicSessionAuthorizationFilter(educationOrganizationIds);

      default:
        console.warn(`[AuthorizationQueryService] No authorization filter defined for endpoint: ${endpoint}`);
        return null;
    }
  }

}

export { AUTH_ENDPOINTS };
export default AuthorizationQueryService;
