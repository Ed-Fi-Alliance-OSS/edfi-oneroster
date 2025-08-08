const express = require('express');
const router = express.Router();
const oneRosterOneController = require('../controllers/oneRosterOneController');
const oneRosterManyController = require('../controllers/oneRosterManyController');

router.get('/rostering/v1p2/academicSessions/:id', oneRosterOneController.academicSessions);
router.get('/rostering/v1p2/gradingPeriods/:id', oneRosterOneController.gradingPeriods);
router.get('/rostering/v1p2/terms/:id', oneRosterOneController.terms);
router.get('/rostering/v1p2/classes/:id', oneRosterOneController.classes);
router.get('/rostering/v1p2/courses/:id', oneRosterOneController.courses);
router.get('/rostering/v1p2/demographics/:id', oneRosterOneController.demographics);
router.get('/rostering/v1p2/enrollments/:id', oneRosterOneController.enrollments);
router.get('/rostering/v1p2/orgs/:id', oneRosterOneController.orgs);
router.get('/rostering/v1p2/schools/:id', oneRosterOneController.schools);
router.get('/rostering/v1p2/users/:id', oneRosterOneController.users);
router.get('/rostering/v1p2/students/:id', oneRosterOneController.students);
router.get('/rostering/v1p2/teachers/:id', oneRosterOneController.teachers);

router.get('/rostering/v1p2/academicSessions', oneRosterManyController.academicSessions);
router.get('/rostering/v1p2/gradingPeriods', oneRosterManyController.gradingPeriods);
router.get('/rostering/v1p2/terms', oneRosterManyController.terms);
router.get('/rostering/v1p2/classes', oneRosterManyController.classes);
router.get('/rostering/v1p2/courses', oneRosterManyController.courses);
router.get('/rostering/v1p2/demographics', oneRosterManyController.demographics);
router.get('/rostering/v1p2/enrollments', oneRosterManyController.enrollments);
router.get('/rostering/v1p2/orgs', oneRosterManyController.orgs);
router.get('/rostering/v1p2/schools', oneRosterManyController.schools);
router.get('/rostering/v1p2/users', oneRosterManyController.users);
router.get('/rostering/v1p2/students', oneRosterManyController.students);
router.get('/rostering/v1p2/teachers', oneRosterManyController.teachers);

module.exports = router;
