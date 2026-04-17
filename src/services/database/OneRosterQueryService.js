/**
 * OneRoster Database Query Service
 * Provides OneRoster-specific query methods using Knex.js
 */

import AuthorizationQueryService from './AuthorizationQueryService.js';

class OneRosterQueryService {
  constructor(knexInstance, schema = 'oneroster12') {
    this.knex = knexInstance;
    this.schema = schema;
    this.allowedPredicates = ['=', '!=', '>', '>=', '<', '<=', '~'];

    // Security limits for filter values
    this.MAX_FILTER_VALUE_LENGTH = 250; // Maximum length of filter values to prevent DoS
    this.MAX_FILTER_CLAUSES = 20;

    // Initialize authorization service
    this.authService = new AuthorizationQueryService(knexInstance, schema);
  }

  /**
   * Base query builder for OneRoster endpoints
   */
  baseQuery(endpoint) {
    return this.knex.withSchema(this.schema).table(endpoint);
  }

  createMissingAuthFilterError(endpoint) {
    const error = new Error(
      `[OneRosterQueryService] Authorization filter missing for endpoint '${endpoint}' while education organization IDs were provided`
    );
    error.code = 'AUTH_FILTER_MISSING';
    return error;
  }

  /**
   * Build and execute query for many records with OneRoster parameters
   */
  async queryMany(endpoint, config, queryParams, extraWhere = null, educationOrganizationIds = null) {
    if (Array.isArray(educationOrganizationIds) && educationOrganizationIds.length === 0) {
      console.log(`[OneRosterQueryService] Returning empty results for ${endpoint} because no education organization IDs were provided`);
      return [];
    }

    const {
      limit = 10,
      offset = 0,
      sort = config.defaultSortField,
      orderBy = 'asc',
      fields = '*',
      filter = ''
    } = queryParams;

    let query = this.baseQuery(endpoint);

    // Apply field selection
    if (fields !== '*') {
      const selectedFields = this.validateAndParseFields(fields, config.selectableFields);
      query = query.select(selectedFields);
    } else {
      query = query.select(config.selectableFields);
    }

    // Apply authorization filter FIRST (most restrictive)
    if (educationOrganizationIds && educationOrganizationIds.length > 0) {
      const authFilter = await this.authService.getAuthorizationFilter(endpoint, educationOrganizationIds);

      if (authFilter) {
        query = this.authService.applyAuthorizationFilter(query, authFilter);
        console.log(`[OneRosterQueryService] Applied authorization filter on ${endpoint}`);
      } else {
        throw this.createMissingAuthFilterError(endpoint);
      }
    }

    // Apply OneRoster filters wrapped in AND group to prevent OR injection bypass
    if (filter) {
      query = query.where(userFilterGroup => {
        this.applyOneRosterFilters(userFilterGroup, filter, config.allowedFilterFields);
      });
    }

    // Apply extra WHERE conditions (for subset endpoints like /students, /teachers)
    if (extraWhere) {
      query = this.applyExtraWhere(query, extraWhere);
    }

    // Apply sorting
    if (sort && sort.trim() !== '') {
      const sortFields = sort.split(',').map(s => s.trim());
      sortFields.forEach(field => {
        if (config.selectableFields.includes(field)) {
          query = query.orderBy(field, orderBy.toLowerCase());
        }
      });
    } else {
      // Default to sorting by sourcedId for consistent ordering across databases
      query = query.orderBy('sourcedId', 'asc');
    }

    // Apply pagination
    query = query.limit(parseInt(limit)).offset(parseInt(offset));

    // Execute query
    const results = await query;

    console.log(`[OneRosterQueryService] Retrieved ${results.length} records from ${endpoint}`);

    // Strip null fields for OneRoster compliance
    return this.stripNullFields(results, endpoint);
  }

  /**
   * Query single record by sourcedId
   */
  async queryOne(endpoint, sourcedId, extraWhere = null, educationOrganizationIds = null, selectableFields = null) {
    if (Array.isArray(educationOrganizationIds) && educationOrganizationIds.length === 0) {
      console.log(`[OneRosterQueryService] Returning no result for ${endpoint}/${sourcedId} because no education organization IDs were provided`);
      return null;
    }

    let query = this.baseQuery(endpoint).where('sourcedId', sourcedId);

    // Apply field selection to avoid returning internal fields (e.g. educationOrganizationId)
    if (selectableFields) {
      query = query.select(selectableFields);
    }

    // Apply authorization filter
    if (educationOrganizationIds && educationOrganizationIds.length > 0) {
      const authFilter = await this.authService.getAuthorizationFilter(endpoint, educationOrganizationIds);

      if (authFilter) {
        query = this.authService.applyAuthorizationFilter(query, authFilter);
        console.log(`[OneRosterQueryService] Applied authorization filter for single record query on ${endpoint}`);
      } else {
        throw this.createMissingAuthFilterError(endpoint);
      }
    }

    // Apply extra WHERE conditions
    if (extraWhere) {
      query = this.applyExtraWhere(query, extraWhere);
    }

    query = query.limit(1);
    const results = await query;

    console.log(`[OneRosterQueryService] Queried single record from ${endpoint}: ${results.length > 0 ? 'Found' : 'Not found'}`);

    // Strip null fields for OneRoster compliance if record exists
    return results.length > 0 ? this.stripNullFields(results[0], endpoint) : null;
}

  /**
   * Apply OneRoster filter syntax
   * Supports: field=value, field!=value, field>value, etc.
   * Logical operators: AND, OR
   */
  applyOneRosterFilters(query, filter, allowedFields) {
    if (!filter || filter.trim() === '') {
      return query;
    }

    const filterClauses = this.parseOneRosterFilter(filter);
    let isFirstClause = true;

    filterClauses.forEach(({ field, operator, value, logical }) => {
      // Validate field is allowed
      if (!allowedFields.includes(field)) {
        const error = new Error(`Field '${field}' is not allowed for filtering. Allowed fields: ${allowedFields.join(', ')}`);
        error.code = 'FILTER_VALIDATION_ERROR';
        throw error;
      }

      // Validate filter value
      this.validateFilterValue(value, field);

      // Apply logical operator (AND/OR)
      // All conditions are applied within the parent .where() group to prevent
      // OR conditions from escaping authorization constraints
      if (isFirstClause) {
        // First clause - use where
        this.applyWhereClause(query, field, operator, value);
        isFirstClause = false;
      } else {
        // Subsequent clauses - use andWhere or orWhere
        if (logical === 'OR') {
          query.orWhere(subQuery => {
            this.applyWhereClause(subQuery, field, operator, value);
          });
        } else {
          this.applyWhereClause(query, field, operator, value);
        }
      }
    });

    return query;
  }

  /**
   * Apply WHERE clause based on operator
   */
  applyWhereClause(query, field, operator, value) {
    switch (operator) {
      case '=':
        query.where(field, value);
        break;
      case '!=':
        query.whereNot(field, value);
        break;
      case '>':
        query.where(field, '>', value);
        break;
      case '>=':
        query.where(field, '>=', value);
        break;
      case '<':
        query.where(field, '<', value);
        break;
      case '<=':
        query.where(field, '<=', value);
        break;
      case '~':
        // Contains operator (case-insensitive LIKE)
        // Use ?? for identifier to prevent SQL injection, ? for value
        query.whereRaw('LOWER(??) LIKE LOWER(?)', [field, `%${value}%`]);
        break;
      default:
        const error = new Error(`Unsupported operator: ${operator}`);
        error.code = 'FILTER_VALIDATION_ERROR';
        throw error;
    }
  }

  /**
   * Validate filter value for security
   */
  validateFilterValue(value, field) {
    // Check for null/undefined
    if (value === null || value === undefined) {
      const error = new Error(`Filter value for field '${field}' cannot be null or undefined`);
      error.code = 'FILTER_VALIDATION_ERROR';
      throw error;
    }

    // Convert to string for validation
    const stringValue = String(value);

    // Check maximum length to prevent DoS
    if (stringValue.length > this.MAX_FILTER_VALUE_LENGTH) {
      const error = new Error(
        `Filter value for field '${field}' exceeds maximum length of ${this.MAX_FILTER_VALUE_LENGTH} characters`
      );
      error.code = 'FILTER_VALIDATION_ERROR';
      throw error;
    }

    // Check for null bytes (potential injection)
    if (stringValue.includes('\0')) {
      const error = new Error(`Filter value for field '${field}' contains invalid null byte`);
      error.code = 'FILTER_VALIDATION_ERROR';
      throw error;
    }

    // Warn about potentially dangerous characters (but don't block since Knex parameterization handles this)
    const suspiciousPatterns = [
      { pattern: /--/, description: 'SQL comment' },
      { pattern: /\/\*/, description: 'SQL block comment' },
      { pattern: /;.*(?:DROP|DELETE|UPDATE|INSERT|ALTER|CREATE)/i, description: 'SQL command injection attempt' }
    ];

    for (const { pattern, description } of suspiciousPatterns) {
      if (pattern.test(stringValue)) {
        // Log suspicious pattern WITHOUT the actual value to avoid leaking PII
        console.warn(
          `[OneRosterQueryService] Suspicious pattern detected for field '${field}': ${description} (value length: ${stringValue.length})`
        );
      }
    }
  }

  /**
   * Parse OneRoster filter format
   * Example: "status='active' AND type='school'"
   */
  parseOneRosterFilter(filter) {
    const clauses = [];
    let currentLogical = 'AND';

    // Split by AND/OR but preserve quoted strings
    const tokens = filter.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];

    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];

      // Check for logical operators
      if (token.toUpperCase() === 'AND' || token.toUpperCase() === 'OR') {
        currentLogical = token.toUpperCase();
        i++;
        continue;
      }

      // Parse field operator value
      let field, operator, value;

      // Try to match pattern: field operator value
      const predicateMatch = token.match(/^([^=!><~]+)([=!><~]+)(.+)$/);

      if (predicateMatch) {
        field = predicateMatch[1].trim();
        operator = predicateMatch[2].trim();
        value = predicateMatch[3].trim();
      } else {
        // Try multi-token pattern
        field = token;
        operator = tokens[i + 1];
        value = tokens[i + 2];
        i += 2;
      }

      // Validate operator
      if (!this.allowedPredicates.includes(operator)) {
        const error = new Error(`Invalid filter clause: unsupported operator '${operator}'`);
        error.code = 'FILTER_VALIDATION_ERROR';
        throw error;
      }

      // Clean up value (remove quotes)
      if (value) {
        value = value.replace(/^["']|["']$/g, '');
      }

      clauses.push({ field, operator, value, logical: currentLogical });
      currentLogical = 'AND'; // Reset to default
      i++;
    }

    // Check maximum number of clauses to prevent DoS (after parsing actual clauses)
    if (clauses.length > this.MAX_FILTER_CLAUSES) {
      const error = new Error(
        `Filter contains too many clauses (${clauses.length}). Maximum allowed: ${this.MAX_FILTER_CLAUSES}`
      );
      error.code = 'FILTER_VALIDATION_ERROR';
      throw error;
    }

    return clauses;
  }

  /**
   * Apply extra WHERE conditions (for subset endpoints)
   */
  applyExtraWhere(query, extraWhere) {
    if (!extraWhere) {
      return query;
    }

    // If it's a string, use whereRaw
    if (typeof extraWhere === 'string') {
      return query.whereRaw(extraWhere);
    }

    // If it's an object, use where
    if (typeof extraWhere === 'object') {
      return query.where(extraWhere);
    }

    return query;
  }

  /**
   * Validate and parse requested fields
   */
  validateAndParseFields(fields, allowedFields) {
    const requestedFields = fields.split(',').map(f => f.trim());

    // Validate all requested fields are allowed
    const invalidFields = requestedFields.filter(f => !allowedFields.includes(f));
    if (invalidFields.length > 0) {
      const error = new Error(`Invalid fields requested: ${invalidFields.join(', ')}. Allowed fields: ${allowedFields.join(', ')}`);
      error.code = 'FILTER_VALIDATION_ERROR';
      throw error;
    }

    return requestedFields;
  }

  /**
   * Build raw SQL query (escape hatch for complex queries)
   */
  async rawQuery(sql, bindings = []) {
    try {
      const results = await this.knex.raw(sql, bindings);

      // Different databases return results differently
      // PostgreSQL: results.rows
      // MSSQL: results (array directly)
      return results.rows || results;
    } catch (error) {
      console.error('[OneRosterQueryService] Raw query failed:', error.message);
      throw error;
    }
  }

  /**
   * Get table information for debugging
   */
  async getTableInfo(endpoint) {
    try {
      const columns = await this.knex.withSchema(this.schema).table(endpoint).columnInfo();
      return columns;
    } catch (error) {
      console.error(`[OneRosterQueryService] Failed to get table info for ${endpoint}:`, error.message);
      throw error;
    }
  }

  /**
   * Strip null fields from response objects for OneRoster compliance
   * Also removes deprecated 'role' field from users endpoints per OneRoster 1.2 spec
   */
  stripNullFields(data, endpoint = null) {
    if (!data) return data;

    const stripObject = (obj) => {
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        // Skip null/undefined values
        if (value === null || value === undefined) {
          continue;
        }

        // Remove deprecated 'role' field from users endpoints (OneRoster 1.2)
        if (endpoint === 'users' && key === 'role') {
          continue;
        }

        cleaned[key] = value;
      }
      return cleaned;
    };

    // Handle array of objects
    if (Array.isArray(data)) {
      return data.map(stripObject);
    }

    // Handle single object
    return stripObject(data);
  }

  /**
   * Test connection
   */
  async testConnection() {
    try {
      await this.knex.raw('SELECT 1');
      console.log('[OneRosterQueryService] Database connection test successful');
      return true;
    } catch (error) {
      console.error('[OneRosterQueryService] Database connection test failed:', error.message);
      throw error;
    }
  }

  /**
   * Close connection
   */
  async close() {
    try {
      await this.knex.destroy();
      console.log('[OneRosterQueryService] Database connection closed');
    } catch (error) {
      console.error('[OneRosterQueryService] Error closing database connection:', error.message);
      throw error;
    }
  }
}

export default OneRosterQueryService;
