// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const app = require('./src/app');
const PORT = process.env.PORT || 3000;
const db = require('./config/db');

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// set up CRON for view refresh:
db.pg_boss();
