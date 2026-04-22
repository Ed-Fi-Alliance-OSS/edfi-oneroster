# Security Fix: SQL Operator Precedence Authorization Bypass

**Severity:** HIGH
**Status:** FIXED
**Date:** April 15, 2026
**CWE:** CWE-1286 - Improper Validation of Syntactic Correctness of Input

## Summary

A critical authorization bypass vulnerability was discovered and fixed in the OneRoster API filter implementation. User-supplied OR conditions in filter parameters could escape authorization constraints due to SQL operator precedence, allowing attackers to access data outside their authorized education organizations.

## Vulnerability Details

### Root Cause

The application allows user-supplied filter parameters containing logical OR operators. When these filters were applied to database queries, they were chained at the same level as authorization constraints without explicit grouping. Due to SQL's operator precedence rules (AND binds tighter than OR), the OR conditions could break out of authorization boundaries.

### Affected Code

**File:** `src/services/database/OneRosterQueryService.js`
**Method:** `queryMany()`

**Before Fix (Vulnerable):**
```javascript
// Apply authorization filter
const authFilter = await this.authService.getAuthorizationFilter(endpoint, educationOrganizationIds);
query = this.authService.applyAuthorizationFilter(query, authFilter);

// Apply user filters (VULNERABLE - no grouping)
if (filter) {
  query = this.applyOneRosterFilters(query, filter, config.allowedFilterFields);
}
```

### Generated SQL (Vulnerable)

```sql
SELECT * FROM users
WHERE (educationOrganizationId IN (123))     -- Authorization constraint
  AND (role='student' OR role='parent')      -- Authorization constraint
  AND status='active'                         -- User filter 1
  OR status='inactive'                        -- User filter 2 with OR
```

Due to operator precedence, this evaluates as:
```sql
(educationOrganizationId IN (123) AND role IN ('student','parent') AND status='active')
OR
(status='inactive')
```

**Impact:** Returns ALL inactive users from the entire database, regardless of organization authorization!

### Attack Examples

#### Example 1: Simple Data Exfiltration
```
GET /api/ims/oneroster/v1p2/users?filter=status='active' OR status='inactive'
```
**Result:** Bypasses organization filter, returns users from all organizations.

#### Example 2: Tautology Injection
```
GET /api/ims/oneroster/v1p2/users?filter=givenName='John' OR 1=1
```
**Result:** Returns all users (1=1 is always true), bypassing all authorization.

#### Example 3: Cross-Organization Access
```
GET /api/ims/oneroster/v1p2/classes?filter=title='Math' OR educationOrganizationId='456'
```
**Result:** User authorized for org 123 can access data from org 456.

## The Fix

### Implementation

Wrap all user-supplied filters in an explicit AND group using Knex's `.where(callback)` pattern:

**After Fix (Secure):**
```javascript
// Apply authorization filter FIRST
const authFilter = await this.authService.getAuthorizationFilter(endpoint, educationOrganizationIds);
query = this.authService.applyAuthorizationFilter(query, authFilter);

// Apply user filters wrapped in AND group to prevent OR injection bypass
if (filter) {
  query = query.where(userFilterGroup => {
    this.applyOneRosterFilters(userFilterGroup, filter, config.allowedFilterFields);
  });
}
```

### Generated SQL (Secure)

```sql
SELECT * FROM users
WHERE (educationOrganizationId IN (123))           -- Authorization constraint
  AND (role='student' OR role='parent')            -- Authorization constraint
  AND (                                            -- USER FILTER GROUP
    status='active' OR status='inactive'           -- User filters are contained
  )
```

Now evaluates correctly as:
```sql
(educationOrganizationId IN (123))
AND
(role IN ('student','parent'))
AND
(status IN ('active','inactive'))
```

**Result:** OR conditions are contained within their own group and cannot bypass authorization.

## Affected Endpoints

All OneRoster endpoints that accept filter parameters:

- `/api/ims/oneroster/v1p2/users`
- `/api/ims/oneroster/v1p2/classes`
- `/api/ims/oneroster/v1p2/courses`
- `/api/ims/oneroster/v1p2/enrollments`
- `/api/ims/oneroster/v1p2/orgs`
- `/api/ims/oneroster/v1p2/academicSessions`
- `/api/ims/oneroster/v1p2/demographics`

## Testing

### Security Test

A comprehensive security test suite has been added:

**File:** `tests/unit-tests/OneRosterQueryService.orInjection.test.js`

Run the tests:
```bash
npm test -- OneRosterQueryService.orInjection.test.js
```

### Manual Verification

1. **Setup:** Deploy with authorization enabled for a specific education organization (e.g., org 123)

2. **Test Vulnerable Scenario:**
   ```bash
   # This should ONLY return users from org 123
   curl -H "Authorization: Bearer <token>" \
     "http://localhost/api/ims/oneroster/v1p2/users?filter=status='active' OR status='inactive'"
   ```

3. **Verify Fix:**
   - Confirm response only contains records from authorized organization 123
   - Verify no data from other organizations is returned
   - Check SQL logs to confirm proper grouping

## Defense in Depth

While this fix resolves the primary vulnerability, several layers of defense are in place:

1. **Field Allowlist:** User filters are restricted to allowed fields only
2. **Parameterized Queries:** Knex prevents classic SQL injection
3. **Authorization First:** Auth filters are always applied before user filters
4. **Input Validation:** Filter syntax is strictly parsed and validated

## Recommendations

### For Developers

1. **Always group user input:** Never apply user-supplied logical conditions at the same level as security constraints
2. **Review filter logic:** Any changes to `applyOneRosterFilters()` must maintain the grouping wrapper
3. **Test security:**  Run the OR injection test suite before deploying

### For Operators

1. **Update immediately:** This is a critical security fix
2. **Review logs:** Check for suspicious filter patterns with OR operators
3. **Rotate tokens:** Consider rotating API tokens if exploitation is suspected

## References

- **Fixed Code:** `src/services/database/OneRosterQueryService.js` lines 73-77
- **Tests:** `tests/unit-tests/OneRosterQueryService.orInjection.test.js`
- **CWE-1286:** Improper Validation of Syntactic Correctness of Input
- **SQL Operator Precedence:** https://dev.mysql.com/doc/refman/8.0/en/operator-precedence.html

## Version History

- **v1.0.0 and earlier:** Vulnerable
- **v1.0.1+:** Fixed (current)

---

**Questions or Concerns?**
Contact the security team or file an issue in the project repository.
