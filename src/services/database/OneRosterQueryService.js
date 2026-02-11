/**
 * OneRoster Database Query Service
 * Provides OneRoster-specific query methods using Knex.js
 */

const AuthorizationQueryService = require('./AuthorizationQueryService');

class OneRosterQueryService {
  constructor(knexInstance, schema = 'oneroster12') {
    this.knex = knexInstance;
    this.schema = schema;
    this.allowedPredicates = ['=', '!=', '>', '>=', '<', '<=', '~'];

    // Initialize authorization service
    this.authService = new AuthorizationQueryService(knexInstance, schema);
  }

  /**
   * Base query builder for OneRoster endpoints
   */
  baseQuery(endpoint) {
    return this.knex.withSchema(this.schema).table(endpoint);
  }

  /**
   * Build and execute query for many records with OneRoster parameters
   */
  async queryMany(endpoint, config, queryParams, extraWhere = null, educationOrganizationIds = null) {
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
        const filterDescriptor = authFilter.type === 'join'
          ? `authorization join (${authFilter.alias || 'auth'})`
          : `${(authFilter.values || []).length} accessible IDs`;
        console.log(`[OneRosterQueryService] Applied ${filterDescriptor} on ${endpoint}`);
      } else {
        console.log(`[OneRosterQueryService] No authorization filter applied for ${endpoint}`);
      }
    }

    // Apply OneRoster filters
    if (filter) {
      query = this.applyOneRosterFilters(query, filter, config.allowedFilterFields);
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
  async queryOne(endpoint, sourcedId, extraWhere = null, educationOrganizationIds = null) {
    let query = this.baseQuery(endpoint).where('sourcedId', sourcedId);

    // Apply authorization filter
    if (educationOrganizationIds && educationOrganizationIds.length > 0) {
      const authFilter = await this.authService.getAuthorizationFilter(endpoint, educationOrganizationIds);

      if (authFilter) {
        query = this.authService.applyAuthorizationFilter(query, authFilter);
        const filterDescriptor = authFilter.type === 'join'
          ? `authorization join (${authFilter.alias || 'auth'})`
          : `${(authFilter.values || []).length} accessible IDs`;
        console.log(`[OneRosterQueryService] Applied authorization constraint for single record query on ${endpoint}: ${filterDescriptor}`);
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
        throw new Error(`Field '${field}' is not allowed for filtering. Allowed fields: ${allowedFields.join(', ')}`);
      }

      // Apply logical operator (AND/OR)
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
        query.whereRaw(`LOWER(${field}) LIKE LOWER(?)`, [`%${value}%`]);
        break;
      default:
        throw new Error(`Unsupported operator: ${operator}`);
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
        throw new Error(`Invalid filter clause: unsupported operator '${operator}'`);
      }

      // Clean up value (remove quotes)
      if (value) {
        value = value.replace(/^["']|["']$/g, '');
      }

      clauses.push({ field, operator, value, logical: currentLogical });
      currentLogical = 'AND'; // Reset to default
      i++;
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
      throw new Error(`Invalid fields requested: ${invalidFields.join(', ')}. Allowed fields: ${allowedFields.join(', ')}`);
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
   * Test authorization views connection
   */
  async testAuthViews() {
    try {
      await this.authService.testAuthViews();
      return true;
    } catch (error) {
      console.error('[OneRosterQueryService] Authorization views test failed:', error.message);
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

module.exports = OneRosterQueryService;
