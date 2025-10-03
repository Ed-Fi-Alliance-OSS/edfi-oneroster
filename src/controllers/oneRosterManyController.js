const db = require('../../config/db');

async function doOneRosterEndpointMany(req, res, endpoint, config, extraWhere = "") {
  // check scope/permissions:
  if (process.env.OAUTH2_AUDIENCE) {
    const scope = req.auth.payload.scope;
    if (
      (endpoint=='demographics' && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster-demographics.readonly') && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly'))
      || (endpoint!='demographics' && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly') && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly'))
    ) {
      // permission denied!
      return res.status(403).json({
        message: `Insufficient scope: your token must have the 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly' or '${endpoint=='demographics' ? 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-demographics.readonly' : 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly'}' scope to access this route.`
      });
    }
  }

  try {
    // Default URL param values, overridden by any passed values:
    const {
        limit = 10,
        offset = 0,
        sort = config.defaultSortField,
        orderBy = 'asc',
        fields = '*',
        filter = ''
    } = req.query;

    // Construct the ORDER BY clause for the SQL query:
    const orderClause = sort.split(',').filter(s =>
        config.selectableFields.includes(s.trim())
    ).map(s =>
            orderBy.toLowerCase()=='desc' ? `${endpoint}."${s.trim()}" DESC` : `${endpoint}."${s.trim()}" ASC`
    ).join(', ');
    // (OR1.2 spec doesn't mention any error handling for invalid `sort` fields, so we don't implement it
    // here - though we could.)
    
    // OneRoster 1.2 supports filtering via the `filter` URL param, which is like
    //   `?filter=familyName%3D%27jones%27%20AND%20dateLastModified%3E%272015%3D01-01%27`
    // which is a URL-encoded string like
    //   `familyName="jones" AND dateLastModified>"2015-01-01"`
    // To avoid SQL injection, rather than using the URL-decoded `filter` in our query directly,
    // instead we parse it... first splitting by "logical" (either ` AND ` or ` OR `), then into
    // [field][predicate][value]; we validate that `field` and `predicate` are allowed values,
    // and then use SQL parameterization for the values, letting the database engine handle
    // validation/escaping of the values.
    let logical = ' AND ';
    const allowedPredicates = ['=', '!=', '>', '>=', '<', '<=', '~'];
    let whereClauseArray = [];
    let valueArray = [parseInt(limit), parseInt(offset)];
    let i = 3; // start at 3 since 1 & 2 are used for LIMIT & OFFSET
    if (filter!='') {
        let whereClauses = filter.split(logical);
        if (whereClauses.length==1) {
            logical = ' OR ';
            whereClauses = filter.split(logical);
        }
        for (const whereClause of whereClauses) {
            let allowedPredicateFound = false;
            for (const allowedPredicate of allowedPredicates) {
                const pieces = whereClause.split(allowedPredicate);
                if (pieces.length==2) { // alllowedPredicate is the predicate
                    allowedPredicateFound = true;
                    const field = pieces[0];
                    let value = pieces[1];
                    if (!config.allowedFilterFields.includes(field)) {
                        // `field` is not an allowedFilterField:
                        res.status(400).json({
                            imsx_codeMajor: 'failure',
                            imsx_severity: 'error',
                            imsx_description: `'${field}' is not a field that allows filtering`
                        });
                        return;
                    }
                    // trim enclosing string quotes off `value`:
                    if (value[0]=='"' && value[value.length-1]=='"')
                        value = value.substring(1,value.length-1);
                    if (value[0]=="'" && value[value.length-1]=="'")
                        value = value.substring(1,value.length-1);
                    // push clause and values onto respective arrays:
                    whereClauseArray.push(`${endpoint}."${field}" ${allowedPredicate} $${i}`);
                    valueArray.push(value);
                    i = i + 1;
                }
            }
            // Handle invalid predicate:
            if (!allowedPredicateFound) {
                res.status(400).json({
                    imsx_codeMajor: 'failure',
                    imsx_severity: 'error',
                    imsx_description: `'filters' contains an invalid predicate (allowed predcates are ${allowedPredicates.join(', ')})`
                });
                return;
            }
        }
    }
    // build WHERE clause; inject `extraWhere` which is used to filter down endpoints like /students to a subset of /users.
    const whereClause = "(" + (whereClauseArray.join(logical) || '1=1') + ")" + (extraWhere!="" ? " AND " + extraWhere : "");

    // Construct the SELECT clause for the SQL query:
    let fieldsClause = '';
    if (fields != "*") {
        if (fields.split(',').filter(s => config.selectableFields.includes(s.trim())).length != fields.split(',').length) {
            res.status(400).json({
                imsx_codeMajor: 'failure',
                imsx_severity: 'error',
                imsx_description: `one or more of the selected 'fields' does not exist`
            });
            return;
        }
        fieldsClause = fields.split(',').filter(s =>
            config.selectableFields.includes(s.trim())
        ).map(s =>
            `${endpoint}."${s.trim()}"`
        ).join(', ');
    } else fieldsClause = config.selectableFields.map(f => `${endpoint}."${f}"`).join(", "); //fields;

    // Put together the query:
    const query = `
        SELECT ${fieldsClause}
        FROM oneroster12.${endpoint}
        WHERE ${whereClause}
        ORDER BY ${orderClause}
        LIMIT $1 OFFSET $2`;
    console.log("Query: ", query);
    console.log("Query params: ", valueArray);
    const { rows } = await db.pool.query(query, valueArray);

    // Strip null fields from response for OneRoster schema compliance
    const cleanedRows = rows.map(row => {
      const cleaned = {};
      for (const [key, value] of Object.entries(row)) {
        if (value !== null) {
          cleaned[key] = value;
        }
      }
      return cleaned;
    });

    res.json( { [endpoint]: cleanedRows } );
  } catch (err) {
    console.error(err);
    res.status(500).json({
        imsx_codeMajor: 'failure',
        imsx_severity: 'error',
        imsx_description: 'An internal server error occurred'
    });
  }
}

// The structure below allows mapping requested endpoints to data that can be used to validate the request and drive
// the single doOneRosterEndpoint() function (defined above).
configs = {
    academicSessions: {
        defaultSortField: 'sourcedId',
        allowedFilterFields: ['sourcedId', 'status', 'dateLastModified', 'title', 'type',
            'startDate', 'endDate', 'schoolYear'],
        selectableFields: ['sourcedId', 'status', 'dateLastModified', 'title', 'type',
            'startDate', 'endDate', 'parent', 'schoolYear', 'metadata']
    },
    classes: {
        defaultSortField: 'sourcedId',
        allowedFilterFields: ['sourcedId', 'status', 'dateLastModified', 'title', 'classCode',
            'classType', 'location', 'periods'],
        selectableFields: ['sourcedId', 'status', 'dateLastModified', 'title', 'classCode',
            'classType', 'location', 'grades', 'subjects', 'course', 'school', 'terms',
            'subjectCodes', 'periods', 'resources', 'metadata']
    },
    courses: {
        defaultSortField: 'sourcedId',
        allowedFilterFields: ['sourcedId', 'status', 'dateLastModified', 'title', 'courseCode'],
        selectableFields: ['sourcedId', 'status', 'dateLastModified', 'title', 'schoolYear',
            'courseCode', 'grades', 'subjects', 'org', 'subjectCodes', 'metadata']
    },
    demographics: {
        defaultSortField: 'sourcedId',
        allowedFilterFields: ['sourcedId', 'status', 'dateLastModified', 'birthDate', 'sex',
            'americanIndianOrAlaskaNative', 'asian', 'blackOrAfricanAmerican',
            'nativeHawaiianOrOtherPacificIslander', 'white', 'demographicRaceTwoOrMoreRaces',
            'hispanicOrLatinoEthnicity', 'countryOfBirthCode', 'stateOfBirthAbbreviation',
            'cityOfBirth'],
        selectableFields: ['sourcedId', 'status', 'dateLastModified', 'birthDate', 'sex',
            'americanIndianOrAlaskaNative', 'asian', 'blackOrAfricanAmerican',
            'nativeHawaiianOrOtherPacificIslander', 'white', 'demographicRaceTwoOrMoreRaces',
            'hispanicOrLatinoEthnicity', 'countryOfBirthCode', 'stateOfBirthAbbreviation',
            'cityOfBirth', 'publicSchoolResidenceStatus', 'metadata']
    },
    enrollments: {
        defaultSortField: 'sourcedId',
        allowedFilterFields: ['sourcedId', 'status', 'dateLastModified', 'role', 'primary',
            'beginDate', 'endDate'],
        selectableFields: ['sourcedId', 'status', 'dateLastModified', 'class', 'user', 'school',
            'role', 'primary', 'beginDate', 'endDate', 'metadata']
    },
    orgs: {
        defaultSortField: 'sourcedId',
        allowedFilterFields: ['sourcedId', 'status', 'dateLastModified', 'name', 'type',
            'identifier'],
        selectableFields: ['sourcedId', 'status', 'dateLastModified', 'name', 'type',
            'identifier', 'parent', 'children', 'metadata']
    },
    users: {
        defaultSortField: 'sourcedId',
        allowedFilterFields: ['sourcedId', 'status', 'dateLastModified', 'username',
        'enabledUser', 'givenName', 'familyName', 'middleName', 'preferredFirstName',
        'preferredMiddleName', 'preferredLastName', 'roles', 'identifier', 'email'],
        selectableFields: ['sourcedId', 'status', 'dateLastModified', 'userMasterIdentifier',
            'username', 'userIds', 'enabledUser', 'givenName', 'familyName', 'middleName',
            'preferredFirstName', 'preferredMiddleName', 'preferredLastName', 'pronouns',
            'roles', 'userProfiles', 'identifier', 'email', 'sms', 'phone',
            'agentSourceIds', 'grades', 'password', 'metadata']
    }
};

// map endpoints:
exports.academicSessions = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'academicSessions', configs.academicSessions); };
exports.gradingPeriods = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'academicSessions', configs.academicSessions, "type='gradingPeriod'"); };
exports.terms = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'academicSessions', configs.academicSessions, "type='term'"); };
exports.classes = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'classes', configs.classes); };
exports.courses = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'courses', configs.courses); };
exports.demographics = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'demographics', configs.demographics); };
exports.enrollments = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'enrollments', configs.enrollments); };
exports.orgs = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'orgs', configs.orgs); };
exports.schools = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'orgs', configs.orgs, "type='school'"); };
exports.users = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'users', configs.users); };
exports.students = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'users', configs.users, "role='student'"); };
exports.teachers = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'users', configs.users, "role='teacher'"); };
