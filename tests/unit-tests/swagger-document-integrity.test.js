// SPDX-License-Identifier: Apache-2.0
// Licensed to 1EdTech Consortium, Inc. under one or more agreements.
// 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import YAML from 'yaml';

// config/swagger.yml is hand-maintained and served to clients by src/app.js. A
// malformed document does not stop the service from starting, so defects in it
// surface only downstream — in the rendered docs, in generated clients, and in
// contract tests. These checks assert structural invariants that must hold for
// the document to describe the API accurately.
const doc = YAML.parse(readFileSync(new URL('../../config/swagger.yml', import.meta.url), 'utf8'));

const isObject = value => value !== null && typeof value === 'object';

const hasDeclaredType = schema =>
  Boolean(schema.type || schema.$ref || schema.allOf || schema.oneOf || schema.anyOf || schema.enum);

/** Visits every Schema Object nested under components.schemas, depth first. */
const walkSchemas = visit => {
  const walk = (schema, path) => {
    if (!isObject(schema)) return;
    visit(schema, path);

    Object.entries(schema.properties ?? {}).forEach(([name, value]) => walk(value, `${path}.${name}`));
    walk(schema.items, `${path}[]`);
    ['allOf', 'oneOf', 'anyOf'].forEach(keyword =>
      (schema[keyword] ?? []).forEach((value, i) => walk(value, `${path}.${keyword}[${i}]`))
    );
  };

  Object.entries(doc.components.schemas).forEach(([name, schema]) => walk(schema, name));
};

/** Every operation in the document, as [label, operation] pairs. */
const operations = () =>
  Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([, operation]) => isObject(operation) && operation.responses)
      .map(([method, operation]) => [`${method.toUpperCase()} ${path}`, operation])
  );

describe('config/swagger.yml', () => {
  // `schema` is a key of the Parameter, Media Type, and Header objects — never
  // of a Schema Object. Nesting one inside a schema silently discards
  // everything beneath it, leaving the property with no type.
  test('no schema nests a definition under a `schema` key', () => {
    const offenders = [];
    walkSchemas((schema, path) => {
      if ('schema' in schema) offenders.push(path);
    });

    expect(offenders).toEqual([]);
  });

  // An untyped property renders blank in Swagger UI and generates as `any`.
  test('every property declares a type', () => {
    const untyped = [];
    walkSchemas((schema, path) => {
      Object.entries(schema.properties ?? {}).forEach(([name, value]) => {
        if (isObject(value) && !hasDeclaredType(value)) untyped.push(`${path}.${name}`);
      });
    });

    expect(untyped).toEqual([]);
  });

  // A $ref to a component that was renamed or removed produces an empty schema
  // rather than an error, so responses quietly lose their documented shape.
  test('every $ref resolves to a component in this document', () => {
    const unresolved = [];
    const collect = (node, path) => {
      if (!isObject(node)) return;
      if (typeof node.$ref === 'string') {
        const target = node.$ref.startsWith('#/')
          ? node.$ref
              .slice(2)
              .split('/')
              .reduce((current, key) => (isObject(current) ? current[key] : undefined), doc)
          : undefined;
        if (target === undefined) unresolved.push(`${path} -> ${node.$ref}`);
      }
      Object.entries(node).forEach(([key, value]) => collect(value, `${path}/${key}`));
    };
    collect(doc, '');

    expect(unresolved).toEqual([]);
  });

  // An operation with no security block documents an endpoint as anonymous,
  // which contradicts the authorization the service actually enforces.
  test('every operation declares security using scopes the scheme defines', () => {
    const declaredScopes = new Set(
      Object.values(doc.components.securitySchemes ?? {}).flatMap(scheme =>
        Object.values(scheme.flows ?? {}).flatMap(flow => Object.keys(flow.scopes ?? {}))
      )
    );

    const problems = [];
    operations().forEach(([label, operation]) => {
      if (!operation.security) {
        problems.push(`${label}: no security`);
        return;
      }

      operation.security.forEach(requirement =>
        Object.entries(requirement).forEach(([scheme, scopes]) => {
          if (!doc.components.securitySchemes?.[scheme]) problems.push(`${label}: unknown scheme ${scheme}`);
          (scopes ?? []).forEach(scope => {
            if (!declaredScopes.has(scope)) problems.push(`${label}: undeclared scope ${scope}`);
          });
        })
      );
    });

    expect(problems).toEqual([]);
  });
});
