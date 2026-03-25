// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.


import express from 'express';
import * as oneRosterController from '../controllers/unified/oneRosterController.js';
import { authorizeEndpoint } from '../middleware/authorizationHandler.js';

const router = express.Router();

// Single record endpoints (with :id parameter)
router.get('/rostering/v1p2/academicSessions/:id', authorizeEndpoint('academicsessions'), oneRosterController.academicSessionsOne);
router.get('/rostering/v1p2/gradingPeriods/:id', authorizeEndpoint('academicsessions'), oneRosterController.gradingPeriodsOne);
router.get('/rostering/v1p2/terms/:id', authorizeEndpoint('academicsessions'), oneRosterController.termsOne);
router.get('/rostering/v1p2/classes/:id', authorizeEndpoint('classes'), oneRosterController.classesOne);
router.get('/rostering/v1p2/courses/:id', authorizeEndpoint('courses'), oneRosterController.coursesOne);
router.get('/rostering/v1p2/demographics/:id', authorizeEndpoint('demographics'), oneRosterController.demographicsOne);
router.get('/rostering/v1p2/enrollments/:id', authorizeEndpoint('enrollments'), oneRosterController.enrollmentsOne);
router.get('/rostering/v1p2/orgs/:id', authorizeEndpoint('orgs'), oneRosterController.orgsOne);
router.get('/rostering/v1p2/schools/:id', authorizeEndpoint('orgs'), oneRosterController.schoolsOne);
router.get('/rostering/v1p2/users/:id', authorizeEndpoint('users'), oneRosterController.usersOne);
router.get('/rostering/v1p2/students/:id', authorizeEndpoint('users'), oneRosterController.studentsOne);
router.get('/rostering/v1p2/teachers/:id', authorizeEndpoint('users'), oneRosterController.teachersOne);

// Collection endpoints (many records)
router.get('/rostering/v1p2/academicSessions', authorizeEndpoint('academicsessions'), oneRosterController.academicSessions);
router.get('/rostering/v1p2/gradingPeriods', authorizeEndpoint('academicsessions'), oneRosterController.gradingPeriods);
router.get('/rostering/v1p2/terms', authorizeEndpoint('academicsessions'), oneRosterController.terms);
router.get('/rostering/v1p2/classes', authorizeEndpoint('classes'), oneRosterController.classes);
router.get('/rostering/v1p2/courses', authorizeEndpoint('courses'), oneRosterController.courses);
router.get('/rostering/v1p2/demographics', authorizeEndpoint('demographics'), oneRosterController.demographics);
router.get('/rostering/v1p2/enrollments', authorizeEndpoint('enrollments'), oneRosterController.enrollments);
router.get('/rostering/v1p2/orgs', authorizeEndpoint('orgs'), oneRosterController.orgs);
router.get('/rostering/v1p2/schools', authorizeEndpoint('orgs'), oneRosterController.schools);
router.get('/rostering/v1p2/users', authorizeEndpoint('users'), oneRosterController.users);
router.get('/rostering/v1p2/students', authorizeEndpoint('users'), oneRosterController.students);
router.get('/rostering/v1p2/teachers', authorizeEndpoint('users'), oneRosterController.teachers);

router.get('/{*any}', function(req, res){
  res.status(404).json({
    imsx_codeMajor: 'failure',
    imsx_severity: 'error',
    imsx_description: 'The specified resource was not found'
  });
});

export default router;
