// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Which OAuth scope reaches which OneRoster endpoint, per the OneRoster 1.2 Rostering
// REST binding (section 4.3.3). This is the only place the scope tests read access
// rules from. Load it from a Bruno script with require('./lib/access-matrix.js');
// the path resolves from the collection root (tests/bruno).

const SCOPES = {
  roster: 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly',
  rosterCore: 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly',
  rosterDemographics: 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-demographics.readonly'
};

// Endpoint path -> the collection key in its 200 body and the scopes that grant it.
const ENDPOINTS = {
  academicSessions: { collection: 'academicSessions', grantedBy: ['roster', 'rosterCore'] },
  gradingPeriods: { collection: 'academicSessions', grantedBy: ['roster', 'rosterCore'] },
  terms: { collection: 'academicSessions', grantedBy: ['roster', 'rosterCore'] },
  classes: { collection: 'classes', grantedBy: ['roster', 'rosterCore'] },
  courses: { collection: 'courses', grantedBy: ['roster', 'rosterCore'] },
  demographics: { collection: 'demographics', grantedBy: ['rosterDemographics'] },
  enrollments: { collection: 'enrollments', grantedBy: ['roster', 'rosterCore'] },
  orgs: { collection: 'orgs', grantedBy: ['roster', 'rosterCore'] },
  schools: { collection: 'orgs', grantedBy: ['roster', 'rosterCore'] },
  users: { collection: 'users', grantedBy: ['roster', 'rosterCore'] },
  students: { collection: 'users', grantedBy: ['roster', 'rosterCore'] },
  teachers: { collection: 'users', grantedBy: ['roster', 'rosterCore'] }
};

// Expected HTTP status of an endpoint for a token holding exactly the given scope
// URIs. Access is denied unless one of the scopes grants it, so an empty list
// expects 403 everywhere.
function expectedStatus(scopes, endpoint) {
  const { grantedBy } = ENDPOINTS[endpoint];
  return grantedBy.some((key) => scopes.includes(SCOPES[key])) ? 200 : 403;
}

module.exports = { SCOPES, ENDPOINTS, expectedStatus };
