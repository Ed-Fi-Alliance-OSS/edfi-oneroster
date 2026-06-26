// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import path from 'path';
import { pathToFileURL } from 'url';

/**
 * Resolve a configured module path to an ESM import URL or bare package specifier.
 * Relative paths are resolved from process.cwd().
 *
 * @param {string} specifier
 * @returns {string}
 */
export function resolveEsmModuleSpecifier(specifier) {
  const s = specifier.trim();
  if (!s) {
    throw new Error('Module specifier is empty');
  }
  if (s.startsWith('file:')) {
    return s;
  }
  if (path.isAbsolute(s)) {
    return pathToFileURL(s).href;
  }
  if (s.startsWith('./') || s.startsWith('../')) {
    return pathToFileURL(path.resolve(process.cwd(), s)).href;
  }
  return s;
}
