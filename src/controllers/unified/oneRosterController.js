// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { getDefaultDatabaseService } from '../../services/database/DatabaseServiceFactory.js';

/**
 * Unified OneRoster Controller
 * Uses Knex.js database services for both PostgreSQL and MSSQL
 */

// Map DB table names to OneRoster JSON collection wrapper names
// (only needed where they differ)
const collectionNames = {
    academicsessions: 'academicSessions',
};

function getCollectionName(endpoint) {
    return collectionNames[endpoint] || endpoint;
}

// OneRoster endpoint configurations
const configs = {
    academicsessions: {
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

function handleMissingAuthFilterError(res, error) {
    return res.status(403).json({
        imsx_codeMajor: 'failure',
        imsx_severity: 'error',
        imsx_description: error.message || 'Authorization policy could not be resolved for this endpoint.',
        imsx_codeMinor: 'forbidden'
    });
}

/**
 * Handle collection endpoints (many records)
 */
async function doOneRosterEndpointMany(req, res, endpoint, config, extraWhere = null) {

    if (!req.odsInstanceId) {
        const routeValues = Object.entries(req.params || {}).map(([k, v]) => `${k}=${v}`).join(', ');
        console.error(`[OneRosterController] No ODS instance matching the available route values was found. Route values were: [${routeValues}]`);
        return res.status(404).json({
            imsx_codeMajor: 'failure',
            imsx_severity: 'error',
            imsx_description: 'The specified data could not be found.'
        });
    }

    try {
        // Get database service with two-level resolution (tenant + ODS instance + context)
        const dbService = await getDefaultDatabaseService(req.tenantId, req.odsInstanceId, req.odsCacheKey);
        // Get education organization IDs from token for authorization filtering
        const educationOrgIds = req.educationOrgIds || [];

        // Execute query using Knex.js service with authorization
        const results = await dbService.queryMany(endpoint, config, req.query, extraWhere, educationOrgIds);

        // Return OneRoster-formatted response
        res.json({ [getCollectionName(endpoint)]: results });

    } catch (error) {
        console.error(`[OneRosterController] Error in ${endpoint} many:`, error);

        if (error.code === 'AUTH_FILTER_MISSING') {
            return handleMissingAuthFilterError(res, error);
        }

        // Handle validation errors
        if (error.code === 'FILTER_VALIDATION_ERROR') {
            return res.status(400).json({
                imsx_codeMajor: 'failure',
                imsx_severity: 'error',
                imsx_description: error.message,
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
async function doOneRosterEndpointOne(req, res, endpoint, config, extraWhere = null) {
    const id = req.params.id;

    if (!req.odsInstanceId) {
        const routeValues = Object.entries(req.params || {}).map(([k, v]) => `${k}=${v}`).join(', ');
        console.error(`[OneRosterController] No ODS instance matching the available route values was found. Route values were: [${routeValues}]`);
        return res.status(404).json({
            imsx_codeMajor: 'failure',
            imsx_severity: 'error',
            imsx_description: 'The specified data could not be found.'
        });
    }

    try {
        // Get database service with two-level resolution (tenant + ODS instance + context)
        const dbService = await getDefaultDatabaseService(req.tenantId, req.odsInstanceId, req.odsCacheKey);

        // Get education organization IDs from token for authorization filtering
        const educationOrgIds = req.educationOrgIds || [];

        // Execute single record query with authorization
        const selectableFields = config ? config.selectableFields : null;
        const result = await dbService.queryOne(endpoint, id, extraWhere, educationOrgIds, selectableFields);

        if (!result) {
            return res.status(404).json({
                imsx_codeMajor: 'failure',
                imsx_severity: 'error',
                imsx_description: `Resource not found: ${endpoint}/${id}`
            });
        }

        // Return OneRoster-formatted response with proper wrapper
        res.json({ [getWrapper(endpoint)]: result });

    } catch (error) {
        console.error(`[OneRosterController] Error in ${endpoint} one:`, error);

        if (error.code === 'AUTH_FILTER_MISSING') {
            return handleMissingAuthFilterError(res, error);
        }

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
    if (word=='academicsessions') return 'academicSession';
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
export const academicSessions = async (req, res) => doOneRosterEndpointMany(req, res, 'academicsessions', configs.academicsessions);
export const gradingPeriods = async (req, res) => doOneRosterEndpointMany(req, res, 'academicsessions', configs.academicsessions, "type='gradingPeriod'");
export const terms = async (req, res) => doOneRosterEndpointMany(req, res, 'academicsessions', configs.academicsessions, "type='term'");
export const classes = async (req, res) => doOneRosterEndpointMany(req, res, 'classes', configs.classes);
export const courses = async (req, res) => doOneRosterEndpointMany(req, res, 'courses', configs.courses);
export const demographics = async (req, res) => doOneRosterEndpointMany(req, res, 'demographics', configs.demographics);
export const enrollments = async (req, res) => doOneRosterEndpointMany(req, res, 'enrollments', configs.enrollments);
export const orgs = async (req, res) => doOneRosterEndpointMany(req, res, 'orgs', configs.orgs);
export const schools = async (req, res) => doOneRosterEndpointMany(req, res, 'orgs', configs.orgs, "type='school'");
export const users = async (req, res) => doOneRosterEndpointMany(req, res, 'users', configs.users);
export const students = async (req, res) => doOneRosterEndpointMany(req, res, 'users', configs.users, "role='student'");
export const teachers = async (req, res) => doOneRosterEndpointMany(req, res, 'users', configs.users, "role='teacher'");

// Single record endpoint exports
export const academicSessionsOne = async (req, res) => doOneRosterEndpointOne(req, res, 'academicsessions', configs.academicsessions);
export const gradingPeriodsOne = async (req, res) => doOneRosterEndpointOne(req, res, 'academicsessions', configs.academicsessions, "type='gradingPeriod'");
export const termsOne = async (req, res) => doOneRosterEndpointOne(req, res, 'academicsessions', configs.academicsessions, "type='term'");
export const classesOne = async (req, res) => doOneRosterEndpointOne(req, res, 'classes', configs.classes);
export const coursesOne = async (req, res) => doOneRosterEndpointOne(req, res, 'courses', configs.courses);
export const demographicsOne = async (req, res) => doOneRosterEndpointOne(req, res, 'demographics', configs.demographics);
export const enrollmentsOne = async (req, res) => doOneRosterEndpointOne(req, res, 'enrollments', configs.enrollments);
export const orgsOne = async (req, res) => doOneRosterEndpointOne(req, res, 'orgs', configs.orgs);
export const schoolsOne = async (req, res) => doOneRosterEndpointOne(req, res, 'orgs', configs.orgs, "type='school'");
export const usersOne = async (req, res) => doOneRosterEndpointOne(req, res, 'users', configs.users);
export const studentsOne = async (req, res) => doOneRosterEndpointOne(req, res, 'users', configs.users, "role='student'");
export const teachersOne = async (req, res) => doOneRosterEndpointOne(req, res, 'users', configs.users, "role='teacher'");
