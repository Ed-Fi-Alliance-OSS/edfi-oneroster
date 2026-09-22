// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

// Keep test output free of application log noise unless a test overrides it.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
