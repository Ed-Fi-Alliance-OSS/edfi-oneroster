// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Shared Aurora / Secrets Manager helpers for Starting Blocks reference plugins.
 * Requires @aws-sdk/client-secrets-manager (optionalDependency).
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

/**
 * @param {string} envLabel
 * @returns {string}
 */
export function getAuroraSecretId(envLabel) {
  const explicit = process.env.AURORA_MASTER_SECRET?.trim();
  if (explicit) {
    return explicit;
  }
  return `${envLabel}-AuroraMasterSecret`;
}

/**
 * @param {string} secretId
 * @returns {Promise<{ host: string, port: string | number, username: string, password: string }>}
 */
export async function fetchAuroraSecret(secretId) {
  const client = new SecretsManagerClient({});
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const secretString = response.SecretString;
  if (!secretString) {
    throw new Error(`Secret ${secretId} has no SecretString`);
  }
  const secret = JSON.parse(secretString);
  const { host, port, username, password } = secret;
  if (!host || username === undefined || password === undefined || port === undefined) {
    throw new Error(`Secret ${secretId} must include host, port, username, and password`);
  }
  return { host, port, username, password };
}

/**
 * Single PostgreSQL admin connection string (same shape as tenant entries).
 * @param {{ host: string, port: string | number, username: string, password: string }} auroraSecret
 * @param {string} databaseName
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function buildPostgresAdminConnection(auroraSecret, databaseName, env = process.env) {
  const appName = env.TENANTS_APPLICATION_NAME || 'EdFi.Ods.WebApi';
  const maxPool = env.MAX_POOL_SIZE;
  const idleLifetime = env.CONNECTION_IDLE_LIFETIME;
  const extraSuffix = env.TENANTS_CONNECTION_STRING_SUFFIX?.trim();

  const parts = [
    `host=${auroraSecret.host}`,
    `port=${String(auroraSecret.port)}`,
    `username=${auroraSecret.username}`,
    `password=${auroraSecret.password}`,
    `database=${databaseName}`,
    `Application Name=${appName}`,
    'sslmode=require'
  ];
  if (maxPool) {
    parts.push(`Maximum Pool Size=${maxPool}`);
  }
  if (idleLifetime) {
    parts.push(`Connection Idle Lifetime=${idleLifetime}`);
  }
  let conn = `${parts.join(';')};`;
  if (extraSuffix) {
    conn += extraSuffix.replace(/^;+/, '');
    if (!conn.endsWith(';')) {
      conn += ';';
    }
  }
  return conn;
}
