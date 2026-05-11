/**
 * AES-256-GCM encryption — usado para tokens Meta WhatsApp em whatsapp_accounts.access_token_encrypted
 * Spec 003 · Princípio V (LGPD) — tokens nunca em plaintext
 *
 * ENCRYPTION_MASTER_KEY: 32 bytes hex (gerar com: openssl rand -hex 32)
 */
import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_MASTER_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("ENCRYPTION_MASTER_KEY missing or invalid (need 32 bytes hex = 64 chars)");
  }
  return Buffer.from(hex, "hex");
}

/** Encrypts plaintext. Returns format: iv:tag:ciphertext (all hex, colon-separated) */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decrypt(encrypted: string): string {
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const ciphertext = Buffer.from(parts[2], "hex");
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
