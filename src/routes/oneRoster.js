const express = require('express');
const router = express.Router();
const oneRosterController = require('../controllers/unified/oneRosterController');

// Single record endpoints (with :id parameter)
router.get('/rostering/v1p2/academicSessions/:id', oneRosterController.academicSessionsOne);
router.get('/rostering/v1p2/gradingPeriods/:id', oneRosterController.gradingPeriodsOne);
router.get('/rostering/v1p2/terms/:id', oneRosterController.termsOne);
router.get('/rostering/v1p2/classes/:id', oneRosterController.classesOne);
router.get('/rostering/v1p2/courses/:id', oneRosterController.coursesOne);
router.get('/rostering/v1p2/demographics/:id', oneRosterController.demographicsOne);
router.get('/rostering/v1p2/enrollments/:id', oneRosterController.enrollmentsOne);
router.get('/rostering/v1p2/orgs/:id', oneRosterController.orgsOne);
router.get('/rostering/v1p2/schools/:id', oneRosterController.schoolsOne);
router.get('/rostering/v1p2/users/:id', oneRosterController.usersOne);
router.get('/rostering/v1p2/students/:id', oneRosterController.studentsOne);
router.get('/rostering/v1p2/teachers/:id', oneRosterController.teachersOne);

// Collection endpoints (many records)
router.get('/rostering/v1p2/academicSessions', oneRosterController.academicSessions);
router.get('/rostering/v1p2/gradingPeriods', oneRosterController.gradingPeriods);
router.get('/rostering/v1p2/terms', oneRosterController.terms);
router.get('/rostering/v1p2/classes', oneRosterController.classes);
router.get('/rostering/v1p2/courses', oneRosterController.courses);
router.get('/rostering/v1p2/demographics', oneRosterController.demographics);
router.get('/rostering/v1p2/enrollments', oneRosterController.enrollments);
router.get('/rostering/v1p2/orgs', oneRosterController.orgs);
router.get('/rostering/v1p2/schools', oneRosterController.schools);
router.get('/rostering/v1p2/users', oneRosterController.users);
router.get('/rostering/v1p2/students', oneRosterController.students);
router.get('/rostering/v1p2/teachers', oneRosterController.teachers);

router.get('/{*any}', function(req, res){
  res.status(404).json({
    imsx_codeMajor: 'failure',
    imsx_severity: 'error',
    imsx_description: 'The specified resource was not found'
  });
});

module.exports = router;