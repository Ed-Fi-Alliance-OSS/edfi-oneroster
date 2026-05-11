// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/**
 * Reference app-secrets plugin: ODS encryption key and JWT public PEM from AWS Secrets Manager;
 * optional PG_BOSS_CONNECTION_CONFIG from Aurora master secret when DB_TYPE=postgres and PG_BOSS_DATABASE is set.
 * Wire with APP_SECRETS_MODULE pointing at this file (non-empty enables the plugin path).
 * Uses ENV_LABEL or ENVLABEL for secret names. Requires @aws-sdk/client-secrets-manager (optional dependency).
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import {
  buildPostgresAdminConnection,
  fetchAuroraSecret,
  getAuroraSecretId
} from './startingblocks-aws-aurora.js';

function getEnvLabel() {
  return (process.env.ENV_LABEL || process.env.ENVLABEL || '').trim();
}

/**
 * @param {string} secretId
 * @returns {Promise<string>}
 */
async function getSecretString(secretId) {
  const client = new SecretsManagerClient({});
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const s = response.SecretString;
  if (s == null || s === '') {
    throw new Error(`Secret ${secretId} has no SecretString`);
  }
  return s;
}

function wantsPgBossFromAurora() {
  const dbType = (process.env.DB_TYPE || '').trim().toLowerCase();
  const dbName = (process.env.PG_BOSS_DATABASE || '').trim();
  return dbType === 'postgres' && dbName !== '';
}

function pgBossShadowEnv() {
  return {
    ...process.env,
    TENANTS_APPLICATION_NAME:
      process.env.PG_BOSS_APPLICATION_NAME || process.env.TENANTS_APPLICATION_NAME,
    TENANTS_CONNECTION_STRING_SUFFIX:
      process.env.PG_BOSS_CONNECTION_STRING_SUFFIX || process.env.TENANTS_CONNECTION_STRING_SUFFIX
  };
}

/**
 * @returns {Promise<{
 *   odsConnectionStringEncryptionKey: string,
 *   oauth2PublicKeyPem: string,
 *   pgBossConnectionConfig?: { adminConnection: string }
 * }>}
 */
export async function loadAppSecrets() {
  const envLabel = getEnvLabel();
  if (!envLabel) {
    throw new Error('ENV_LABEL or ENVLABEL must be set for this app secrets plugin');
  }

  const adminApiSecretId = `${envLabel}-AdminApiSecret`;
  const jwtKeyPairSecretId = `${envLabel}-JwtKeyPair`;
  const loadAurora = wantsPgBossFromAurora();

  let encryptionKeyRaw;
  let jwtPairRaw;
  /** @type {{ host: string, port: string | number, username: string, password: string } | undefined} */
  let auroraSecret;

  if (loadAurora) {
    const auroraSecretId = getAuroraSecretId(envLabel);
    [encryptionKeyRaw, jwtPairRaw, auroraSecret] = await Promise.all([
      getSecretString(adminApiSecretId),
      getSecretString(jwtKeyPairSecretId),
      fetchAuroraSecret(auroraSecretId)
    ]);
  } else {
    [encryptionKeyRaw, jwtPairRaw] = await Promise.all([
      getSecretString(adminApiSecretId),
      getSecretString(jwtKeyPairSecretId)
    ]);
  }

  const jwtPair = JSON.parse(jwtPairRaw);
  const publicKey = jwtPair.publicKey;
  if (typeof publicKey !== 'string' || !publicKey.trim()) {
    throw new Error(`Secret ${jwtKeyPairSecretId} JSON must include a non-empty publicKey string`);
  }

  /** @type {{ odsConnectionStringEncryptionKey: string, oauth2PublicKeyPem: string, pgBossConnectionConfig?: { adminConnection: string } }} */
  const result = {
    odsConnectionStringEncryptionKey: encryptionKeyRaw,
    oauth2PublicKeyPem: publicKey
  };

  if (loadAurora && auroraSecret) {
    const pgBossDb = (process.env.PG_BOSS_DATABASE || '').trim();
    result.pgBossConnectionConfig = {
      adminConnection: buildPostgresAdminConnection(auroraSecret, pgBossDb, pgBossShadowEnv())
    };
  }

  return result;
}
