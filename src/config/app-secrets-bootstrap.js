// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import { resolveEsmModuleSpecifier } from './resolve-esm-module-specifier.js';

/**
 * When APP_SECRETS_MODULE is set (non-empty), load ODS encryption key, OAuth2 public key, and optional pg-boss config via loadAppSecrets() and set process.env.
 * Must run before env validation and before importing app.js. See docs/app-secrets-plugin.md.
 */
export async function bootstrapAppSecretsIfNeeded() {
  const modulePath = (process.env.APP_SECRETS_MODULE || '').trim();
  if (!modulePath) {
    return;
  }

  const moduleHref = resolveEsmModuleSpecifier(modulePath);
  const mod = await import(moduleHref);

  if (typeof mod.loadAppSecrets !== 'function') {
    throw new Error('App secrets plugin must export async function loadAppSecrets');
  }

  const secrets = await mod.loadAppSecrets();

  const odsKey = secrets?.odsConnectionStringEncryptionKey;
  const pem = secrets?.oauth2PublicKeyPem;

  if (typeof odsKey !== 'string' || !odsKey.trim()) {
    throw new Error('loadAppSecrets must return a non-empty string odsConnectionStringEncryptionKey');
  }
  if (typeof pem !== 'string' || !pem.trim()) {
    throw new Error('loadAppSecrets must return a non-empty string oauth2PublicKeyPem');
  }

  process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY = odsKey.trim();
  process.env.OAUTH2_PUBLIC_KEY_PEM = pem.trim();

  const pgBoss = secrets?.pgBossConnectionConfig;
  if (pgBoss !== undefined && pgBoss !== null) {
    const ac = pgBoss?.adminConnection;
    if (typeof ac !== 'string' || !ac.trim()) {
      throw new Error('loadAppSecrets pgBossConnectionConfig.adminConnection must be a non-empty string when pgBossConnectionConfig is returned');
    }
    process.env.PG_BOSS_CONNECTION_CONFIG = JSON.stringify({ adminConnection: ac.trim() });
  }

  console.log('[AppSecrets] Loaded via plugin');
}
