// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Reference tenant-configuration plugin: DynamoDB tenant names + Aurora secret (Secrets Manager).
 * Wire via TENANTS_CONFIG_MODULE pointing at this file (non-empty enables the plugin path).
 * Requires @aws-sdk/client-dynamodb and @aws-sdk/client-secrets-manager (optionalDependencies in package.json).
 */

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { buildPostgresAdminConnection, fetchAuroraSecret, getAuroraSecretId } from './startingblocks-aws-aurora.js';

function getEnvLabel() {
  return (process.env.ENV_LABEL || process.env.ENVLABEL || '').trim();
}

/**
 * Build tenant map (same shape as TENANTS_CONNECTION_CONFIG JSON) from Aurora credentials + DynamoDB names.
 * Exported for unit tests.
 * @param {string[]} tenantNames verbatim Name values from DynamoDB (keys + database segment admin_{Name})
 * @param {{ host: string, port: string | number, username: string, password: string }} auroraSecret
 * @param {NodeJS.ProcessEnv} env
 * @returns {Record<string, { adminConnection: string }>}
 */
export function buildTenantsConnectionMap(tenantNames, auroraSecret, env = process.env) {
  const result = {};
  for (const name of tenantNames) {
    result[name] = {
      adminConnection: buildPostgresAdminConnection(auroraSecret, `admin_${name}`, env)
    };
  }
  return result;
}

/**
 * @param {string} tableName
 */
async function scanTenantNames(tableName) {
  const client = new DynamoDBClient({});
  const names = [];
  let exclusiveStartKey = undefined;

  do {
    const response = await client.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: exclusiveStartKey,
        ProjectionExpression: '#n',
        ExpressionAttributeNames: { '#n': 'Name' }
      })
    );

    for (const item of response.Items || []) {
      if (item.Name?.S) {
        names.push(item.Name.S);
      }
    }
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return names;
}

/**
 * Plugin entry point (see docs/tenants-config-plugin.md).
 * Uses ENV_LABEL / ENVLABEL, {label}-tenants table, and Aurora secret from environment.
 */
export async function loadTenantsConfig() {
  const envLabel = getEnvLabel();
  if (!envLabel) {
    throw new Error('ENV_LABEL or ENVLABEL must be set for this tenant plugin');
  }

  const tableName = `${envLabel}-tenants`;
  const secretId = getAuroraSecretId(envLabel);

  const [tenantNames, auroraSecret] = await Promise.all([scanTenantNames(tableName), fetchAuroraSecret(secretId)]);

  return buildTenantsConnectionMap(tenantNames, auroraSecret, process.env);
}
