// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import path from 'path';
import { pathToFileURL } from 'url';
import { describe, test, expect } from '@jest/globals';
import { resolveEsmModuleSpecifier } from '../../src/config/resolve-esm-module-specifier.js';

describe('resolveEsmModuleSpecifier', () => {
  test('throws when specifier is empty', () => {
    expect(() => resolveEsmModuleSpecifier('')).toThrow('Module specifier is empty');
  });

  test('throws when specifier is whitespace only', () => {
    expect(() => resolveEsmModuleSpecifier('   ')).toThrow('Module specifier is empty');
  });

  test('returns file: URLs unchanged', () => {
    const u = 'file:///opt/app/plugin.js';
    expect(resolveEsmModuleSpecifier(u)).toBe(u);
  });

  test('resolves relative paths from cwd', () => {
    const expected = pathToFileURL(path.resolve(process.cwd(), './foo.js')).href;
    expect(resolveEsmModuleSpecifier('./foo.js')).toBe(expected);
  });

  test('resolves Windows-style current-directory relative paths from cwd', () => {
    const expected = pathToFileURL(path.resolve(process.cwd(), '.\\foo.js')).href;
    expect(resolveEsmModuleSpecifier('.\\foo.js')).toBe(expected);
  });

  test('resolves Windows-style parent-directory relative paths from cwd', () => {
    const expected = pathToFileURL(path.resolve(process.cwd(), '..\\foo.js')).href;
    expect(resolveEsmModuleSpecifier('..\\foo.js')).toBe(expected);
  });

  test('returns bare package specifiers unchanged', () => {
    expect(resolveEsmModuleSpecifier('@scope/tenant-loader')).toBe('@scope/tenant-loader');
  });

  test('converts absolute filesystem paths to file URLs', () => {
    const abs = path.resolve('/tmp', 'x.js');
    expect(resolveEsmModuleSpecifier(abs)).toBe(pathToFileURL(abs).href);
  });
});
