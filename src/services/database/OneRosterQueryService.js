/**
 * OneRoster Database Query Service
 * Provides OneRoster-specific query methods using Knex.js
 */

class OneRosterQueryService {
  constructor(knexInstance, schema = 'oneroster12') {
    this.knex = knexInstance;
    this.schema = schema;
    this.allowedPredicates = ['=', '!=', '>', '>=', '<', '<=', '~'];
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
  async queryMany(endpoint, config, queryParams, extraWhere = null) {
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

    // Apply filters
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
  async queryOne(endpoint, sourcedId, extraWhere = null) {
    let query = this.baseQuery(endpoint).where('sourcedId', sourcedId);
    
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
        throw new Error(`Field '${field}' is not allowed for filtering`);
      }

      // Remove quotes from value if present
      let cleanValue = value;
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        cleanValue = value.slice(1, -1);
      }

      // Apply the filter based on operator and logical connector
      switch (operator) {
        case '=':
          query = (logical === 'OR' && !isFirstClause) 
            ? query.orWhere(field, cleanValue) 
            : query.where(field, cleanValue);
          break;
        case '!=':
          query = (logical === 'OR' && !isFirstClause)
            ? query.orWhereNot(field, cleanValue)
            : query.whereNot(field, cleanValue);
          break;
        case '>':
          query = (logical === 'OR' && !isFirstClause)
            ? query.orWhere(field, '>', cleanValue)
            : query.where(field, '>', cleanValue);
          break;
        case '>=':
          query = (logical === 'OR' && !isFirstClause)
            ? query.orWhere(field, '>=', cleanValue)
            : query.where(field, '>=', cleanValue);
          break;
        case '<':
          query = (logical === 'OR' && !isFirstClause)
            ? query.orWhere(field, '<', cleanValue)
            : query.where(field, '<', cleanValue);
          break;
        case '<=':
          query = (logical === 'OR' && !isFirstClause)
            ? query.orWhere(field, '<=', cleanValue)
            : query.where(field, '<=', cleanValue);
          break;
        case '~':
          // Use LIKE for pattern matching
          query = (logical === 'OR' && !isFirstClause)
            ? query.orWhere(field, 'like', `%${cleanValue}%`)
            : query.where(field, 'like', `%${cleanValue}%`);
          break;
        default:
          throw new Error(`Unsupported filter operator: ${operator}`);
      }

      isFirstClause = false;
    });

    return query;
  }

  /**
   * Parse OneRoster filter format
   * Example: "status='active' AND type='school'"
   */
  parseOneRosterFilter(filter) {
    const clauses = [];
    let currentLogical = 'AND';
    
    // Split by AND or OR (case insensitive)
    const parts = filter.split(/\s+(AND|OR)\s+/i);
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      
      if (part.toUpperCase() === 'AND' || part.toUpperCase() === 'OR') {
        currentLogical = part.toUpperCase();
        continue;
      }

      // Parse field operator value
      let found = false;
      for (const predicate of this.allowedPredicates) {
        if (part.includes(predicate)) {
          const [field, value] = part.split(predicate);
          clauses.push({
            field: field.trim(),
            operator: predicate,
            value: value.trim(),
            logical: i === 0 ? 'AND' : currentLogical  // First clause is always AND
          });
          found = true;
          break;
        }
      }

      if (!found) {
        throw new Error(`Invalid filter clause: ${part}. Supported operators: ${this.allowedPredicates.join(', ')}`);
      }
    }

    return clauses;
  }

  /**
   * Apply extra WHERE conditions (for subset endpoints)
   */
  applyExtraWhere(query, extraWhere) {
    if (typeof extraWhere === 'string') {
      // Handle simple string conditions like "type='school'"
      if (extraWhere.includes('=')) {
        const [field, value] = extraWhere.split('=').map(s => s.trim());
        let cleanValue = value.replace(/['"]/g, ''); // Remove quotes
        query = query.where(field, cleanValue);
      } else {
        // For complex conditions, use raw where
        query = query.whereRaw(extraWhere);
      }
    } else if (typeof extraWhere === 'object' && extraWhere !== null) {
      // Handle object-style conditions
      Object.entries(extraWhere).forEach(([field, value]) => {
        query = query.where(field, value);
      });
    }

    return query;
  }

  /**
   * Validate and parse requested fields
   */
  validateAndParseFields(fields, allowedFields) {
    const requestedFields = fields.split(',').map(f => f.trim());
    const invalidFields = requestedFields.filter(f => !allowedFields.includes(f));
    
    if (invalidFields.length > 0) {
      throw new Error(`Invalid fields: ${invalidFields.join(', ')}. Allowed fields: ${allowedFields.join(', ')}`);
    }
    
    return requestedFields;
  }

  /**
   * Build raw SQL query (escape hatch for complex queries)
   */
  async rawQuery(sql, bindings = []) {
    console.log('[OneRosterQueryService] Executing raw query:', sql);
    const results = await this.knex.raw(sql, bindings);
    
    // Return rows based on database type
    if (this.knex.client.config.client === 'mssql') {
      return results;
    } else {
      return results.rows;
    }
  }

  /**
   * Get table information for debugging
   */
  async getTableInfo(endpoint) {
    try {
      const tableInfo = await this.knex.withSchema(this.schema).table(endpoint).columnInfo();
      console.log(`[OneRosterQueryService] Table info for ${endpoint}:`, Object.keys(tableInfo));
      return tableInfo;
    } catch (error) {
      console.error(`[OneRosterQueryService] Error getting table info for ${endpoint}:`, error.message);
      throw error;
    }
  }

  /**
   * Strip null fields from response objects for OneRoster compliance
   * Also removes deprecated 'role' field from users endpoints per OneRoster 1.2 spec
   */
  stripNullFields(data, endpoint = null) {
    if (!data) return data;
    
    // Handle single object
    if (!Array.isArray(data)) {
      const cleaned = {};
      for (const [key, value] of Object.entries(data)) {
        // Skip null values
        if (value === null) continue;
        
        // Skip deprecated 'role' field for users endpoints (OneRoster 1.2 compliance)
        if (endpoint === 'users' && key === 'role') continue;
        
        cleaned[key] = value;
      }
      return cleaned;
    }
    
    // Handle array of objects
    return data.map(item => {
      const cleaned = {};
      for (const [key, value] of Object.entries(item)) {
        // Skip null values
        if (value === null) continue;
        
        // Skip deprecated 'role' field for users endpoints (OneRoster 1.2 compliance)
        if (endpoint === 'users' && key === 'role') continue;
        
        cleaned[key] = value;
      }
      return cleaned;
    });
  }

  /**
   * Test connection
   */
  async testConnection() {
    try {
      await this.knex.raw('SELECT 1 as test');
      console.log('[OneRosterQueryService] Connection test successful');
      return true;
    } catch (error) {
      console.error('[OneRosterQueryService] Connection test failed:', error.message);
      throw error;
    }
  }

  /**
   * Close connection
   */
  async close() {
    if (this.knex) {
      await this.knex.destroy();
      console.log('[OneRosterQueryService] Connection closed');
    }
  }
}

module.exports = OneRosterQueryService;