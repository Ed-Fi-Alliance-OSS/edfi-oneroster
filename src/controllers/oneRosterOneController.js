// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const db = require('../../config/db');

async function doOneRosterEndpointOne(req, res, endpoint, extraWhere = "1=1") {
  // check scope/permissions:
  if (process.env.OAUTH2_AUDIENCE) {
    const scope = req.auth.payload.scope;
    if (
      (endpoint=='demographics' && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster-demographics.readonly') && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly'))
      || (endpoint!='demographics' && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly') && !scope.includes('https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly'))
    ) {
      // permission denied!
      return res.status(403).json({
        imsx_codeMajor: 'failure',
        imsx_severity: 'error',
        imsx_description: `Insufficient scope: your token must have the 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly' or '${endpoint=='demographics' ? 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-demographics.readonly' : 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly'}' scope to access this route.`
      });
    }
  }

  const id = req.params.id;
  try {
    // Put together the query:
    const query = `SELECT * FROM oneroster12.${endpoint} WHERE ${endpoint}."sourcedId" = $1 AND ${extraWhere} LIMIT 1`;
    console.log("Query: ", query);
    console.log("Query params: ", [id]);
    const { rows } = await db.pool.query(query, [id]);
    if (rows.length==0) {
        res.status(404).json({
            imsx_codeMajor: 'failure',
            imsx_severity: 'error',
            imsx_description: 'The specified resource was not found'
        });
        return;
    }

    // Strip null fields from response for OneRoster schema compliance
    // Also remove 'role' field for users endpoint (deprecated in OneRoster 1.2)
    const cleanedRow = {};
    for (const [key, value] of Object.entries(rows[0])) {
      if (value !== null && !(endpoint === 'users' && key === 'role')) {
        cleanedRow[key] = value;
      }
    }

    res.json({ [getWrapper(endpoint)]: cleanedRow });
  } catch (err) {
    console.error(err);
    res.status(500).json({
        imsx_codeMajor: 'failure',
        imsx_severity: 'error',
        imsx_description: 'An internal server error occurred'
    });
  }
}

// map endpoints:
exports.academicSessions = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'academicSessions'); };
exports.gradingPeriods = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'academicSessions', "type='gradingPeriod'"); };
exports.terms = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'academicSessions', "type='term'"); };
exports.classes = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'classes'); };
exports.courses = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'courses'); };
exports.demographics = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'demographics'); };
exports.enrollments = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'enrollments'); };
exports.orgs = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'orgs'); };
exports.schools = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'orgs', "type='school'"); };
exports.users = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'users'); };
exports.students = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'users', "role='student'"); };
exports.teachers = async (req, res) =>
    { return doOneRosterEndpointOne(req, res, 'users', "role='teacher'"); };


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
