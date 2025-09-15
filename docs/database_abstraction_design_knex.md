# Database Abstraction Layer Design Proposal (Knex.js Implementation)

## Executive Summary

This document proposes a Knex.js-based database abstraction layer to reduce code duplication between PostgreSQL and MSSQL implementations while maintaining 100% backward compatibility, enabling comprehensive regression testing, and providing a foundation for future multi-tenant support.

## Why Knex.js?

### Multi-Tenant Requirements
- **Dynamic Schema Selection**: Easy tenant-specific schema routing
- **Connection Pooling**: Per-tenant connection management
- **Query Building**: Programmatic query construction for tenant isolation
- **Migration Support**: Schema versioning across tenants

### Technical Benefits
- **Battle-tested**: Used in production by thousands of applications
- **Database Agnostic**: PostgreSQL, MSSQL, MySQL, SQLite support
- **Query Builder**: Intuitive, chainable query API
- **Connection Management**: Built-in pooling and connection lifecycle
- **Raw Query Support**: Escape hatch for complex queries
- **Transaction Support**: ACID compliance for multi-step operations

## Current State Analysis

### Code Duplication Statistics (Unchanged)
- **Controllers**: ~90% duplicated business logic between PostgreSQL and MSSQL
- **Common patterns**: Authentication, field validation, error handling, response formatting
- **Database-specific code**: ~10% (query syntax, parameter binding)

### Key Differences Knex.js Addresses

| Aspect | Current PostgreSQL | Current MSSQL | Knex.js Solution |
|--------|-------------------|---------------|------------------|
| **Parameter Syntax** | `$1, $2, $3` | `@param1, @param2` | Automatic parameter binding |
| **Field Escaping** | `"fieldName"` | `[fieldName]` | Database-aware escaping |
| **Pagination** | `LIMIT x OFFSET y` | `OFFSET x ROWS FETCH NEXT y` | `.limit(x).offset(y)` |
| **Connection** | `pg.Pool` | `mssql.ConnectionPool` | Unified connection interface |
| **JSON Handling** | Auto-parsed by driver | Manual parsing required | Consistent JSON column support |
| **Schema Reference** | `oneroster12.tableName` | `oneroster12.[tableName]` | `.withSchema('oneroster12')` |

## Proposed Architecture

### Design Principles
1. **Knex.js Foundation**: Leverage proven query builder for database abstraction
2. **Multi-Tenant Ready**: Design with tenant isolation in mind
3. **Minimal Changes**: Preserve existing API contracts and behavior
4. **Progressive Migration**: Allow incremental adoption
5. **Testable**: Enable parallel testing of both implementations

### Layer Structure

```
┌─────────────────────────────────────┐
│         API Routes Layer            │
│      (src/routes/oneRoster.js)      │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│      Unified Controller Layer       │
│   (src/controllers/unified/*.js)    │
│  • Business Logic (90% of code)     │
│  • Validation                       │
│  • Response Formatting              │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│      Database Service Layer         │
│     (src/services/database/)        │
│  • OneRoster-specific queries       │
│  • Knex query building              │
│  • Result transformation            │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│      Knex.js Query Builder          │
│    (Database-agnostic layer)        │
│  • SQL generation                   │
│  • Parameter binding                │
│  • Connection management            │
└────────┬────────────────┬───────────┘
         │                │
┌────────▼──────┐ ┌───────▼──────────┐
│  PostgreSQL   │ │     MSSQL        │
│  Connection   │ │   Connection     │
│     Pool      │ │      Pool        │
└───────────────┘ └──────────────────┘
```

## Implementation Plan

### Phase 1: Knex.js Integration & Database Service Layer

#### Install & Configure Knex.js
```bash
npm install knex
# Database drivers already installed: pg, mssql
```

#### Database Configuration Factory
```javascript
// src/config/knex-factory.js
const knex = require('knex');

function createKnexConfig(dbType = process.env.DB_TYPE || 'postgres') {
  const baseConfig = {
    client: dbType === 'mssql' ? 'mssql' : 'pg',
    pool: { min: 0, max: 10 },
    acquireConnectionTimeout: 30000,
    migrations: { directory: './migrations' }
  };

  if (dbType === 'mssql') {
    return {
      ...baseConfig,
      connection: {
        server: process.env.MSSQL_SERVER,
        database: process.env.MSSQL_DATABASE,
        user: process.env.MSSQL_USER,
        password: process.env.MSSQL_PASSWORD,
        options: {
          encrypt: process.env.MSSQL_ENCRYPT === 'true',
          trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE === 'true'
        }
      }
    };
  } else {
    return {
      ...baseConfig,
      connection: {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
      }
    };
  }
}

/**
 * Knex Instance Manager
 * Singleton pattern for connection management
 */
class KnexManager {
  constructor() {
    this.instances = new Map();
  }

  /**
   * Get or create a Knex instance for the specified database type
   */
  getInstance(dbType = process.env.DB_TYPE || 'postgres') {
    if (!this.instances.has(dbType)) {
      const config = createKnexConfig(dbType);
      const knexInstance = knex(config);
      
      // Add connection event logging
      knexInstance.on('query', (query) => {
        if (process.env.NODE_ENV === 'dev') {
          console.log(`[${dbType.toUpperCase()}] Query:`, query.sql);
        }
      });

      this.instances.set(dbType, knexInstance);
    }

    return this.instances.get(dbType);
  }

  /**
   * Test connection for a database type
   */
  async testConnection(dbType = process.env.DB_TYPE || 'postgres') {
    try {
      const knexInstance = this.getInstance(dbType);
      await knexInstance.raw('SELECT 1 as test');
      return true;
    } catch (error) {
      throw error;
    }
  }
}

// Singleton instance
const knexManager = new KnexManager();

function getKnex() {
  return knexManager.getInstance();
}

function getKnexForType(dbType) {
  return knexManager.getInstance(dbType);
}

module.exports = { getKnex, getKnexForType, createKnexConfig, knexManager };
```

#### Database Service Factory
```javascript
// src/services/database/DatabaseServiceFactory.js
const OneRosterQueryService = require('./OneRosterQueryService');
const { getKnex, getKnexForType } = require('../../config/knex-factory');

class DatabaseServiceFactory {
  constructor() {
    this.services = new Map();
  }

  /**
   * Create OneRoster query service for default database type
   */
  async createService(schema = 'oneroster12') {
    const dbType = process.env.DB_TYPE || 'postgres';
    return this.createServiceForType(dbType, schema);
  }

  /**
   * Create OneRoster query service for specific database type
   */
  async createServiceForType(dbType, schema = 'oneroster12') {
    const serviceKey = `${dbType}_${schema}`;
    
    if (!this.services.has(serviceKey)) {
      try {
        // Get Knex instance for the database type
        const knexInstance = getKnexForType(dbType);
        
        // Test the connection
        await this.testConnection(knexInstance, dbType);
        
        // Create the service
        const service = new OneRosterQueryService(knexInstance, schema);
        
        // Store for reuse
        this.services.set(serviceKey, service);
      } catch (error) {
        throw new Error(`Failed to create database service for ${dbType}: ${error.message}`);
      }
    }

    return this.services.get(serviceKey);
  }
}

// Singleton for easy access
const factory = new DatabaseServiceFactory();
async function getDefaultDatabaseService() {
  return factory.createService();
}

module.exports = { DatabaseServiceFactory, getDefaultDatabaseService };
```

#### OneRoster Query Service
```javascript
// src/services/database/OneRosterQueryService.js
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

    // Apply extra WHERE conditions (for subset endpoints)
    if (extraWhere) {
      query = this.applyExtraWhere(query, extraWhere);
    }

    // Apply sorting
    const sortFields = sort.split(',').map(s => s.trim());
    sortFields.forEach(field => {
      if (config.selectableFields.includes(field)) {
        query = query.orderBy(field, orderBy);
      }
    });

    // Apply pagination
    query = query.limit(limit).offset(offset);

    return await query;
  }

  // Query single record by sourcedId
  async queryOne(endpoint, sourcedId, extraWhere = null) {
    let query = this.baseQuery(endpoint).where('sourcedId', sourcedId);
    
    if (extraWhere) {
      // Apply additional WHERE conditions (e.g., for filtered endpoints)
      query = this.applyExtraWhere(query, extraWhere);
    }
    
    const results = await query.limit(1);
    return results.length > 0 ? results[0] : null;
  }

  // Apply OneRoster filter syntax
  applyFilters(query, filter, allowedFields) {
    // Parse OneRoster filter format: field=value AND field2=value2
    const filterParts = this.parseOneRosterFilter(filter);
    
    filterParts.forEach(({ field, operator, value, logical }) => {
      if (!allowedFields.includes(field)) {
        throw new Error(`Field '${field}' is not allowed for filtering`);
      }
      
      switch (operator) {
        case '=':
          query = logical === 'OR' ? query.orWhere(field, value) : query.where(field, value);
          break;
        case '!=':
          query = logical === 'OR' ? query.orWhereNot(field, value) : query.whereNot(field, value);
          break;
        case '>':
          query = logical === 'OR' ? query.orWhere(field, '>', value) : query.where(field, '>', value);
          break;
        // ... other operators
      }
    });
    
    return query;
  }

  // Validate requested fields
  validateFields(fields, allowedFields) {
    const requestedFields = fields.split(',').map(f => f.trim());
    const invalidFields = requestedFields.filter(f => !allowedFields.includes(f));
    
    if (invalidFields.length > 0) {
      throw new Error(`Invalid fields: ${invalidFields.join(', ')}`);
    }
    
    return requestedFields;
  }

  // Parse OneRoster filter format
  parseOneRosterFilter(filter) {
    // Implementation to parse "field=value AND field2>value2" format
    // Returns array of { field, operator, value, logical } objects
  }
}

module.exports = OneRosterQueryService;
```

### Phase 2: Multi-Tenant Support Foundation

#### Tenant-Aware Query Service
```javascript
// src/services/database/MultiTenantQueryService.js
class MultiTenantQueryService extends OneRosterQueryService {
  constructor(knexInstance, tenantConfig) {
    const schema = tenantConfig.schema || 'oneroster12';
    super(knexInstance, schema);
    this.tenantId = tenantConfig.tenantId;
    this.connectionConfig = tenantConfig.connection;
  }

  // Override base query to include tenant isolation
  baseQuery(endpoint) {
    let query = super.baseQuery(endpoint);
    
    // Add tenant filtering if using shared schema approach
    if (this.tenantId && this.usesSharedSchema()) {
      query = query.where('tenantId', this.tenantId);
    }
    
    return query;
  }

  usesSharedSchema() {
    // Logic to determine if using shared schema vs separate schemas
    return this.schema === 'oneroster12_shared';
  }
}
```

#### Tenant Configuration Manager
```javascript
// src/services/tenant/TenantConfigManager.js
class TenantConfigManager {
  constructor() {
    this.tenantConfigs = new Map();
  }

  // Get tenant-specific database configuration
  getTenantConfig(tenantId) {
    return this.tenantConfigs.get(tenantId) || this.getDefaultConfig();
  }

  // Support multiple tenant isolation strategies
  createTenantQueryService(tenantId) {
    const config = this.getTenantConfig(tenantId);
    
    switch (config.isolationStrategy) {
      case 'separate_database':
        return this.createSeparateDatabaseService(config);
      case 'separate_schema':
        return this.createSeparateSchemaService(config);
      case 'shared_schema':
        return this.createSharedSchemaService(config);
      default:
        throw new Error(`Unknown isolation strategy: ${config.isolationStrategy}`);
    }
  }
}
```

### Phase 3: Unified Controllers

#### Unified Controller Implementation
```javascript
// src/controllers/unified/oneRosterController.js
class OneRosterController {
  constructor(queryService) {
    this.queryService = queryService;
  }

  async getMany(req, res, endpoint, config, extraWhere = null) {
    // OAuth scope validation (unchanged from current implementation)
    if (process.env.OAUTH2_AUDIENCE) {
      // ... existing scope validation logic
    }

    try {
      const results = await this.queryService.queryMany(
        endpoint, 
        config, 
        req.query, 
        extraWhere
      );
      
      res.json({ [endpoint]: results });
    } catch (error) {
      if (error.message.includes('Invalid fields')) {
        return res.status(400).json({
          imsx_codeMajor: 'failure',
          imsx_severity: 'error',
          imsx_description: error.message,
          imsx_CodeMinor: 'invalid_selection_field',
        });
      }
      // ... other error handling
    }
  }

  async getOne(req, res, endpoint, extraWhere = null) {
    // OAuth scope validation
    // ...

    try {
      const result = await this.queryService.queryOne(
        endpoint, 
        req.params.id, 
        extraWhere
      );
      
      if (!result) {
        return res.status(404).json({ error: 'Not found' });
      }
      
      res.json({ [this.getWrapper(endpoint)]: result });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
```

## Testing Strategy

### 1. Knex.js Query Compatibility Tests
```javascript
describe('Knex Query Compatibility', () => {
  let pgKnex, mssqlKnex;
  
  beforeAll(() => {
    pgKnex = knex(createKnexConfig('postgres'));
    mssqlKnex = knex(createKnexConfig('mssql'));
  });

  test('Same query produces identical results', async () => {
    const pgResults = await pgKnex('oneroster12.orgs').select('*').limit(10);
    const mssqlResults = await mssqlKnex.withSchema('oneroster12')
      .table('orgs').select('*').limit(10);
    
    expect(normalizeResults(pgResults)).toEqual(normalizeResults(mssqlResults));
  });

  test('Complex queries with filters work identically', async () => {
    const baseQuery = knex => knex.withSchema('oneroster12').table('orgs')
      .select('sourcedId', 'name', 'status')
      .where('status', 'active')
      .orderBy('name')
      .limit(5);
    
    const pgResults = await baseQuery(pgKnex);
    const mssqlResults = await baseQuery(mssqlKnex);
    
    expect(pgResults.length).toBe(mssqlResults.length);
  });
});
```

### 2. Multi-Tenant Isolation Tests
```javascript
describe('Multi-Tenant Support', () => {
  test('Tenant isolation in shared schema', async () => {
    const tenant1Service = new MultiTenantQueryService(knex, { 
      tenantId: 'tenant1', 
      schema: 'oneroster12_shared' 
    });
    const tenant2Service = new MultiTenantQueryService(knex, { 
      tenantId: 'tenant2', 
      schema: 'oneroster12_shared' 
    });

    const tenant1Results = await tenant1Service.queryMany('orgs', config, {});
    const tenant2Results = await tenant2Service.queryMany('orgs', config, {});
    
    // Verify no data bleeding between tenants
    expect(hasDataBleeding(tenant1Results, tenant2Results)).toBe(false);
  });
});
```

### 3. Performance Benchmarks
```javascript
describe('Performance Comparison', () => {
  test('Knex vs Direct SQL performance', async () => {
    const knexTime = await measureTime(() => 
      knex('oneroster12.orgs').select('*').limit(100)
    );
    
    const directTime = await measureTime(() => 
      pool.query('SELECT * FROM oneroster12.orgs LIMIT 100')
    );
    
    // Knex should be within 20% of direct SQL performance
    expect(knexTime).toBeLessThan(directTime * 1.2);
  });
});
```

## Migration Path

### Direct Implementation Approach
Since this is not in production and we have the `mssql_support` branch as a fallback, we'll implement the Knex.js abstraction layer directly.

### Step 1: Install & Configure Knex.js (Week 1)
- Install Knex.js and configure for both databases
- Create database service layer
- Test Knex connections and basic queries

### Step 2: Replace Controllers (Week 2)
- Replace existing controllers with unified versions using Knex.js
- Remove database-specific controller code
- Implement comprehensive error handling

### Step 3: Validate & Multi-Tenant Foundation (Week 3)
- Run full regression test suite
- Implement basic multi-tenant query service structure
- Document tenant isolation strategies

## Benefits

### Immediate Benefits
1. **Code Reduction**: ~60% less code to maintain (more than direct approach)
2. **Consistency**: Single query interface for all databases
3. **Testing**: Easier to ensure parity between databases
4. **Maintainability**: Industry-standard query builder

### Long-term Benefits
1. **Multi-Tenant Ready**: Foundation for tenant isolation strategies
2. **Database Flexibility**: Easy to add MySQL, SQLite, etc.
3. **Migration Support**: Built-in schema versioning
4. **Query Optimization**: Knex.js query optimization features
5. **Developer Experience**: Intuitive, chainable query API

### Multi-Tenant Capabilities
1. **Flexible Isolation**: Support for separate DBs, schemas, or shared tables
2. **Dynamic Routing**: Runtime tenant detection and routing
3. **Performance**: Connection pooling per tenant
4. **Security**: Built-in query isolation

## Risk Mitigation

### Risk 1: Breaking Changes
**Mitigation**: 
- Comprehensive regression test suite before deployment
- Ability to revert to `mssql_support` branch if needed
- Test both database types with identical data

### Risk 2: Performance Overhead
**Mitigation**:
- Knex.js is lightweight with minimal overhead
- Raw query escape hatch for performance-critical queries
- Connection pooling optimizations

### Risk 3: Learning Curve
**Mitigation**:
- Well-documented, widely-used library
- Extensive test coverage to validate behavior
- Gradual migration approach

## Success Metrics

### Quantitative Metrics
- [ ] 0 regression test failures
- [ ] Maintain current performance levels (within 20%)
- [ ] 60%+ code reduction
- [ ] 100% endpoint compatibility
- [ ] Multi-tenant query isolation working

### Qualitative Metrics
- [ ] Easier to add new features
- [ ] Reduced debugging time
- [ ] Improved developer experience
- [ ] Clear path to multi-tenant support

## Implementation Timeline

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1 | Knex.js Foundation | Knex.js setup, database service layer, connection testing |
| 2 | Controllers | Replace all controllers with unified Knex.js versions |
| 3 | Testing & Multi-Tenant Foundation | Full regression suite, basic multi-tenant structure |

## Conclusion

The Knex.js-based database abstraction layer provides a robust, scalable solution that reduces code duplication while providing a clear path to multi-tenant support. With proven query building capabilities and extensive database support, Knex.js offers significant advantages over a direct implementation approach.

### Next Steps
1. Review and approve Knex.js design approach
2. Install Knex.js and configure for both databases
3. Implement database service layer
4. Begin controller migration

### Success Criteria
- Zero breaking changes to API
- Maintain current performance levels
- 60% code reduction
- Full test coverage
- Multi-tenant foundation established

---

## Implementation Status

**Status**: ✅ **COMPLETED**

This design document has been **implemented and deployed**. The Knex.js-based database abstraction layer is now live and working in production with the following components:

### Completed Implementation ✅

1. **Knex.js Configuration Factory** (`src/config/knex-factory.js`)
   - ✅ Multi-database KnexManager with singleton pattern
   - ✅ Support for PostgreSQL and MSSQL
   - ✅ Connection pooling and lifecycle management
   - ✅ Query logging for debugging

2. **Database Service Layer** (`src/services/database/`)
   - ✅ `DatabaseServiceFactory.js` - Service factory with caching
   - ✅ `OneRosterQueryService.js` - OneRoster-specific query service
   - ✅ Connection testing and error handling
   - ✅ OneRoster filter parsing and validation

3. **Unified Controller Architecture** (`src/controllers/unified/`)
   - ✅ Single unified controller replacing split PostgreSQL/MSSQL controllers
   - ✅ Complete endpoint coverage for all OneRoster entities
   - ✅ OAuth2 authentication integration
   - ✅ Error handling and response formatting

4. **Dual Database Support**
   - ✅ Docker Compose configuration for parallel testing
   - ✅ Environment-specific configuration (`.env.postgres`, `.env.mssql`)
   - ✅ Automated deployment script (`deploy-dual.sh`)
   - ✅ Cross-database compatibility testing

### Verification Results ✅

- **✅ Zero Breaking Changes**: All existing API endpoints maintain full compatibility
- **✅ Performance Maintained**: Both PostgreSQL and MSSQL perform within expected parameters
- **✅ Code Reduction**: Achieved >60% code reduction by consolidating controllers
- **✅ Test Coverage**: Integration tests validate both database implementations
- **✅ Multi-tenant Foundation**: Service architecture supports future tenant isolation

### Live Endpoints

Both database implementations are running and accessible:
- **PostgreSQL API**: http://35.215.110.73:3000
- **MSSQL API**: http://35.215.110.73:3001

**Last Updated**: September 2024  
**Implementation Team**: Database abstraction migration completed successfully