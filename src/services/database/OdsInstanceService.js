// SPDX-License-Identifier: Apache-2.0
// Licensed to EdTech Consortium, Inc. under one or more agreements.
// EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

import crypto from 'crypto';
import knex from 'knex';
import { parseConnectionString } from '../../config/multi-tenancy-config.js';

/**
 * ODS Instance Resolution Service
 * Handles lookup of ODS connection strings from EdFi_Admin database
 * and decryption using AES-256-CBC
 */
class OdsInstanceService {
  constructor() {
    this.encryptionKey = null;
    this.adminConnections = new Map(); // Cache admin database connections
  }

  /**
   * Get or initialize the encryption key from environment
   */
  getEncryptionKey() {
    if (!this.encryptionKey) {
      const keyBase64 = process.env.ODS_CONNECTION_STRING_ENCRYPTION_KEY;
      if (!keyBase64) {
        throw new Error('ODS_CONNECTION_STRING_ENCRYPTION_KEY not configured in environment');
      }
      this.encryptionKey = Buffer.from(keyBase64, 'base64');

      if (this.encryptionKey.length !== 32) {
        throw new Error(`Invalid encryption key length: expected 32 bytes, got ${this.encryptionKey.length}`);
      }
    }
    return this.encryptionKey;
  }

  /**
   * Detect whether a connection string is in the encrypted format IV|EncryptedMessage|HMACSignature.
   * Plain-text connection strings (e.g. MSSQL ADO or PostgreSQL connection strings) never
   * contain exactly two pipe characters with valid base64 segments.
   */
  isEncrypted(value) {
    const parts = value.split('|');
    if (parts.length !== 3) return false;
    const base64Re = /^[A-Za-z0-9+/]+=*$/;
    return parts.every(p => p.length > 0 && base64Re.test(p));
  }

  /**
   * Decrypt AES-256-CBC encrypted connection string with HMAC verification
   * Format: {IV}|{EncryptedMessage}|{HMACSignature} all in base64
   * Matches Ed-Fi ODS API AES256SymmetricStringDecryptionProvider
   */
  decryptConnectionString(encryptedString) {
    try {
      const key = this.getEncryptionKey();

      // Parse the encrypted string format: IV|EncryptedMessage|HMACSignature
      const parts = encryptedString.split('|');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted connection string format. Expected IV|EncryptedMessage|HMACSignature');
      }

      const iv = Buffer.from(parts[0], 'base64');
      const encryptedData = Buffer.from(parts[1], 'base64');
      const providedHmac = Buffer.from(parts[2], 'base64');

      // Step 1: Verify HMAC signature (mitigates padding oracle attacks)
      const hmac = crypto.createHmac('sha256', key);
      hmac.update(encryptedData);
      const computedHmac = hmac.digest();

      if (!crypto.timingSafeEqual(providedHmac, computedHmac)) {
        throw new Error('HMAC signature verification failed - encrypted data may be tampered');
      }

      // Step 2: Decrypt using AES-256-CBC
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encryptedData);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString('utf8');
    } catch (error) {
      console.error('[OdsInstanceService] Decryption failed:', error.message);
      throw new Error(`Failed to decrypt connection string: ${error.message}`);
    }
  }

  /**
   * Get or create admin database connection
   * @param {string} adminConnectionString - EdFi_Admin connection string
   * @param {string} dbType - Database type (postgres or mssql)
   * @returns {Object} Knex instance for admin database
   */
  getAdminConnection(adminConnectionString, dbType) {
    const cacheKey = `${dbType}_${adminConnectionString}`;

    if (!this.adminConnections.has(cacheKey)) {
      const connectionConfig = parseConnectionString(adminConnectionString, dbType);

      let knexConfig;
      if (dbType === 'mssql') {
        knexConfig = {
          client: 'mssql',
          connection: {
            server: connectionConfig.server,
            database: connectionConfig.database,
            user: connectionConfig.user,
            password: connectionConfig.password,
            port: connectionConfig.port,
            options: {
              encrypt: connectionConfig.encrypt ?? false,
              trustServerCertificate: connectionConfig.trustServerCertificate ?? true,
              enableArithAbort: true
            }
          },
          pool: { min: 0, max: 5 }
        };
      } else {
        // PostgreSQL
        knexConfig = {
          client: 'pg',
          connection: {
            host: connectionConfig.host,
            port: connectionConfig.port,
            database: connectionConfig.database,
            user: connectionConfig.username,
            password: connectionConfig.password,
            ssl: connectionConfig.ssl
          },
          pool: { min: 0, max: 5 }
        };
      }

      const connection = knex(knexConfig);
      this.adminConnections.set(cacheKey, connection);
      console.log(`[OdsInstanceService] Created admin connection for ${connectionConfig.database}`);
    }

    return this.adminConnections.get(cacheKey);
  }

  /**
   * Resolve ODS connection string from EdFi_Admin database
   * @param {Object} params
   * @param {string} params.adminConnectionString - EdFi_Admin database connection string
   * @param {string} params.dbType - Database type (postgres or mssql)
   * @param {number} params.odsInstanceId - ODS Instance ID from JWT
   * @returns {Promise<string>} Decrypted ODS connection string
   */
  async resolveOdsConnectionString({ adminConnectionString, dbType, odsInstanceId }) {
    if (!odsInstanceId) {
      throw new Error('OdsInstanceId is required to resolve ODS connection string');
    }

    console.log(`[OdsInstanceService] Resolving ODS connection for OdsInstanceId: ${odsInstanceId}`);

    const adminDb = this.getAdminConnection(adminConnectionString, dbType);

    try {
      // Query OdsInstances table
      const result = await adminDb('dbo.OdsInstances')
        .select('ConnectionString')
        .where('OdsInstanceId', odsInstanceId)
        .first();

      if (!result) {
        throw new Error(`No ODS instance found with OdsInstanceId: ${odsInstanceId}`);
      }

      const rawConnectionString = result.ConnectionString;
      if (!rawConnectionString) {
        throw new Error(`ODS instance ${odsInstanceId} has no connection string configured`);
      }

      // Detect whether the connection string is encrypted (IV|EncryptedMessage|HMACSignature)
      // or plain text and use it directly in the latter case
      let decryptedConnectionString;
      if (this.isEncrypted(rawConnectionString)) {
        decryptedConnectionString = this.decryptConnectionString(rawConnectionString);
      } else {
        console.log(`[OdsInstanceService] Connection string for instance ${odsInstanceId} is not encrypted, using as-is`);
        decryptedConnectionString = rawConnectionString;
      }

      console.log(`[OdsInstanceService] Successfully resolved ODS connection for instance ${odsInstanceId}`);
      return decryptedConnectionString;
    } catch (error) {
      console.error(`[OdsInstanceService] Failed to resolve ODS connection:`, error.message);
      throw error;
    }
  }

  /**
   * Clean up all admin database connections
   */
  async destroy() {
    for (const [key, connection] of this.adminConnections.entries()) {
      try {
        await connection.destroy();
        console.log(`[OdsInstanceService] Closed admin connection: ${key}`);
      } catch (error) {
        console.error(`[OdsInstanceService] Error closing admin connection ${key}:`, error.message);
      }
    }
    this.adminConnections.clear();
  }
}

// Singleton instance
const odsInstanceService = new OdsInstanceService();

export { OdsInstanceService, odsInstanceService };
