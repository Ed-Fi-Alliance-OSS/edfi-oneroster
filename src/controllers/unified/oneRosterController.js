const { getDefaultDatabaseService } = require('../../services/database/DatabaseServiceFactory');

/**
 * Unified OneRoster Controller
 * Uses Knex.js database services for both PostgreSQL and MSSQL
 */

// OneRoster endpoint configurations
const configs = {
    academicSessions: {
        defaultSortField: '', // Use database natural ordering instead of sourcedId
        allowedFilterFields: ['sourcedId', 'status', 'dateLastModified', 'title', 'type',
            'startDate', 'endDate', 'schoolYear'],
        selectableFields: ['sourcedId', 'status', 'dateLastModified', 'title', 'type',
            'startDate', 'endDate', 'parent', 'schoolYear', 'metadata']
    },
    classes: {
        defaultSortField: '', // Use database natural ordering instead of sourcedId
        allowedFilterFields: ['sourcedId', 'status', 'dateLastModified', 'title', 'classCode',
            'classType', 'location', 'periods'],
        selectableFields: ['sourcedId', 'status', 'dateLastModified', 'title', 'classCode',
            'classType', 'location', 'grades', 'subjects', 'course', 'school', 'terms',
            'subjectCodes', 'periods', 'resources', 'metadata']
    },
    courses: {
        defaultSortField: '', // Use database natural ordering instead of sourcedId
        allowedFilterFields: ['sourcedId', 'status', 'dateLastModified', 'title', 'courseCode'],
        selectableFields: ['sourcedId', 'status', 'dateLastModified', 'title', 'schoolYear',
            'courseCode', 'grades', 'subjects', 'org', 'subjectCodes', 'metadata']
    },
    demographics: {
        defaultSortField: '', // Use database natural ordering instead of sourcedId
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
        defaultSortField: '', // Use database natural ordering instead of sourcedId
        allowedFilterFields: ['sourcedId', 'status', 'dateLastModified', 'role', 'primary',
            'beginDate', 'endDate'],
        selectableFields: ['sourcedId', 'status', 'dateLastModified', 'class', 'user', 'school',
            'role', 'primary', 'beginDate', 'endDate', 'metadata']
    },
    orgs: {
        defaultSortField: '', // Use database natural ordering instead of sourcedId
        allowedFilterFields: ['sourcedId', 'status', 'dateLastModified', 'name', 'type',
            'identifier'],
        selectableFields: ['sourcedId', 'status', 'dateLastModified', 'name', 'type',
            'identifier', 'parent', 'children', 'metadata']
    },
    users: {
        defaultSortField: '', // Use database natural ordering instead of sourcedId
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

/**
 * Handle collection endpoints (many records)
 */
async function doOneRosterEndpointMany(req, res, endpoint, config, extraWhere = null) {
    // OAuth scope validation
    if (process.env.OAUTH2_AUDIENCE) {
        const scope = req.auth.payload.scope;
        if (
            (endpoint=='demographics' && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster-demographics.readonly') && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly'))
            || (endpoint!='demographics' && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly') && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly'))
        ) {
            return res.status(403).json({
                message: `Insufficient scope: your token must have the 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly' or '${endpoint=='demographics' ? 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-demographics.readonly' : 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly'}' scope to access this route.`
            });
        }
    }

    try {
        // Get database service
        const dbService = await getDefaultDatabaseService();
        
        // Execute query using Knex.js service
        const results = await dbService.queryMany(endpoint, config, req.query, extraWhere);
        
        // Return OneRoster-formatted response
        res.json({ [endpoint]: results });
        
    } catch (error) {
        console.error(`[OneRosterController] Error in ${endpoint} many:`, error);
        
        // Handle validation errors
        if (error.message.includes('Invalid fields')) {
            return res.status(400).json({
                imsx_codeMajor: 'failure',
                imsx_severity: 'error',
                imsx_description: error.message
            });
        }
        
        if (error.message.includes('not allowed for filtering')) {
            return res.status(400).json({
                imsx_codeMajor: 'failure',
                imsx_severity: 'error',
                imsx_description: error.message
            });
        }
        
        if (error.message.includes('Invalid filter clause')) {
            return res.status(400).json({
                imsx_codeMajor: 'failure',
                imsx_severity: 'error',
                imsx_description: error.message
            });
        }
        
        // Generic server error
        res.status(500).json({
            imsx_codeMajor: 'failure',
            imsx_severity: 'error',
            imsx_description: 'An internal server error occurred'
        });
    }
}

/**
 * Handle single record endpoints
 */
async function doOneRosterEndpointOne(req, res, endpoint, extraWhere = null) {
    // OAuth scope validation
    if (process.env.OAUTH2_AUDIENCE) {
        const scope = req.auth.payload.scope;
        if (
            (endpoint=='demographics' && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster-demographics.readonly') && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly'))
            || (endpoint!='demographics' && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly') && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly'))
        ) {
            return res.status(403).json({
                message: `Insufficient scope: your token must have the 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly' or '${endpoint=='demographics' ? 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-demographics.readonly' : 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly'}' scope to access this route.`
            });
        }
    }

    const id = req.params.id;
    
    try {
        // Get database service
        const dbService = await getDefaultDatabaseService();
        
        // Execute single record query
        const result = await dbService.queryOne(endpoint, id, extraWhere);
        
        if (!result) {
            return res.status(404).json({
                imsx_codeMajor: 'failure',
                imsx_severity: 'error',
                imsx_description: 'The specified resource was not found'
            });
        }
        
        // Return OneRoster-formatted response with proper wrapper
        res.json({ [getWrapper(endpoint)]: result });
        
    } catch (error) {
        console.error(`[OneRosterController] Error in ${endpoint} one:`, error);
        res.status(500).json({
            imsx_codeMajor: 'failure',
            imsx_severity: 'error',
            imsx_description: 'An internal server error occurred'
        });
    }
}

/**
 * Get OneRoster response wrapper name for single records
 */
function getWrapper(word) {
    if (word=='classes') return 'class';
    //if (word=='demographics') return 'demographics'; // this one is still plural for some reason
    if (word=='gradingPeriod') return 'academicSession';
    if (word=='term') return 'academicSession';
    if (word=='school') return 'org';
    if (word=='student') return 'user';
    if (word=='teacher') return 'user';
    const endings = { ies: 'y', es: 'e', s: '' };
    return word.replace(
        new RegExp(`(${Object.keys(endings).join('|')})$`), 
        r => endings[r]
    );
}

// Collection endpoint exports (many records)
exports.academicSessions = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'academicsessions', configs.academicSessions); };
exports.gradingPeriods = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'academicsessions', configs.academicSessions, "type='gradingPeriod'"); };
exports.terms = async (req, res) =>
    { return doOneRosterEndpointMany(req, res, 'academicsessions', configs.academicSessions, "type='term'"); };
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

// Single record endpoint exports
exports.academicSessionsOne = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'academicsessions'); };
exports.gradingPeriodsOne = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'academicsessions', "type='gradingPeriod'"); };
exports.termsOne = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'academicsessions', "type='term'"); };
exports.classesOne = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'classes'); };
exports.coursesOne = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'courses'); };
exports.demographicsOne = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'demographics'); };
exports.enrollmentsOne = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'enrollments'); };
exports.orgsOne = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'orgs'); };
exports.schoolsOne = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'orgs', "type='school'"); };
exports.usersOne = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'users'); };
exports.studentsOne = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'users', "role='student'"); };
exports.teachersOne = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'users', "role='teacher'"); };