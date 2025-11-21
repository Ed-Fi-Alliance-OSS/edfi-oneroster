/**
 * MSSQL-specific OneRoster Query Service
 * Extends base service with JSON parsing for MSSQL string fields
 */

const OneRosterQueryService = require('./OneRosterQueryService');

class MSSQLQueryService extends OneRosterQueryService {
  constructor(knexInstance, schema = 'oneroster12') {
    super(knexInstance, schema);
  }

  /**
   * Detect if a string looks like JSON
   */
  isJSONString(str) {
    if (typeof str !== 'string' || str.trim() === '') {
      return false;
    }

    // Check if string starts and ends with JSON-like delimiters
    const trimmed = str.trim();
    return (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    );
  }

  /**
   * Parse JSON string fields returned by MSSQL using automatic detection
   */
  parseJSONFields(results, endpoint) {
    if (!results || !Array.isArray(results)) {
      return results;
    }

    return results.map(record => {
      const parsed = { ...record };

      // Iterate through all fields and automatically parse JSON strings
      Object.keys(parsed).forEach(fieldName => {
        const fieldValue = parsed[fieldName];
        
        // Skip null/undefined values
        if (fieldValue == null) {
          return;
        }

        // Only process string fields that look like JSON
        if (this.isJSONString(fieldValue)) {
          try {
            const parsedValue = JSON.parse(fieldValue);
            parsed[fieldName] = parsedValue;
            console.log(`[MSSQLQueryService] Auto-parsed JSON field '${fieldName}' for ${endpoint}`);
          } catch (error) {
            // If parsing fails, leave as string - it might be intentional
            console.warn(`[MSSQLQueryService] Skipped parsing field '${fieldName}' for ${endpoint}: ${error.message}`);
          }
        }
      });

      return parsed;
    });
  }

  /**
   * Override queryMany to add JSON parsing
   */
  async queryMany(endpoint, config, queryParams, extraWhere = null) {
    console.log(`[MSSQLQueryService] Processing ${endpoint} query with JSON parsing`);
    const results = await super.queryMany(endpoint, config, queryParams, extraWhere);
    const parsed = this.parseJSONFields(results, endpoint);
    console.log(`[MSSQLQueryService] Parsed ${parsed.length} records for ${endpoint}`);
    return parsed;
  }

  /**
   * Override queryOne to add JSON parsing
   */
  async queryOne(endpoint, sourcedId, extraWhere = null) {
    const result = await super.queryOne(endpoint, sourcedId, extraWhere);
    if (result) {
      const parsed = this.parseJSONFields([result], endpoint);
      return parsed[0];
    }
    return result;
  }
}

module.exports = MSSQLQueryService;