// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');

router.get('/', healthController.list);

module.exports = router;