/**
 * AES-256-GCM encryption/decryption for sensitive fields (ERP tokens, API keys).
 * Derives a 256-bit key from SESSION_SECRET via PBKDF2.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT = "consulta-isp-erp-token-v1"; // fixed salt — key changes when SESSION_SECRET changes
const KEY_ITERATIONS = 100_000;

let _derivedKey: Buffer | null = null;

function getDerivedKey(): Buffer {
  if (_derivedKey) return _derivedKey;
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET nao definido");
  _derivedKey = crypto.pbkdf2Sync(secret, SALT, KEY_ITERATIONS, 32, "sha256");
  return _derivedKey;
}

/**
 * Encrypt a plaintext string. Returns base64-encoded `iv:tag:ciphertext`.
 * Returns null/empty inputs unchanged.
 */
export function encryptField(plaintext: string | null | undefined): string | null {
  if (!plaintext) return plaintext as string | null;
  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv) + "." + base64(tag) + "." + base64(ciphertext)
  return `enc:${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

/**
 * Decrypt a previously encrypted string. Non-encrypted strings pass through unchanged.
 */
export function decryptField(encrypted: string | null | undefined): string | null {
  if (!encrypted) return encrypted as string | null;
  // Not encrypted — return as-is (handles legacy plaintext values)
  if (!encrypted.startsWith("enc:")) return encrypted;
  const key = getDerivedKey();
  const parts = encrypted.slice(4).split(".");
  if (parts.length !== 3) throw new Error("Formato de campo criptografado invalido");
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Check if a value is already encrypted.
 */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("enc:");
}
