// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Application-wide logger factory.
 * Verbosity is controlled by the LOG_LEVEL environment variable.
 */

import pino from 'pino';

export const VALID_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
export const DEFAULT_LEVEL = 'info';

export function resolveLevel() {
  const configured = (process.env.LOG_LEVEL || '').trim().toLowerCase();
  return VALID_LEVELS.includes(configured) ? configured : DEFAULT_LEVEL;
}

export const logger = pino({
  level: resolveLevel(),
});

/**
 * Returns a child logger tagged with a component name, e.g.:
 *   const log = getLogger('KnexFactory');
 *   log.info('Created postgres instance');
 */
export function getLogger(component) {
  return logger.child({ component });
}
