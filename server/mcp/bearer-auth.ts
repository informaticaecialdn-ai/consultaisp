/**
 * Spec 008.5 Batch 1 — Bearer token generation + verification.
 *
 * Reusa o padrão scrypt de server/password.ts (sem nova dep). Token format:
 *   mcp_<8-char-prefix><24-char-secret>   (32 chars total após "mcp_")
 *
 * O prefixo é PÚBLICO (visível na UI superadmin pra identificação) e tem
 * índice em mcp_bearer_tokens.tokenPrefix para lookup O(1) sem expor o hash.
 * Apenas o token completo (prefixo + secret) é capaz de gerar o hash que
 * bate no DB.
 *
 * Token completo é mostrado UMA VEZ na criação. Apenas o hash + prefix
 * persistem em mcp_bearer_tokens.
 */

import crypto from "crypto";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const PREFIX_LENGTH = 8;   // chars após "mcp_"
const SECRET_LENGTH = 24;  // chars adicionais após prefix

export interface GeneratedBearer {
  /** Token completo: "mcp_<prefix><secret>" — mostrar UMA VEZ */
  token: string;
  /** Prefix público (sem o secret): "mcp_<prefix>" */
  prefix: string;
  /** Hash scrypt para persistir em mcp_bearer_tokens.tokenHash */
  hash: string;
}

/** Gera um novo bearer token + hash pronto para insert no DB. */
export async function generateBearerToken(): Promise<GeneratedBearer> {
  // hex: 1 byte → 2 chars. Para 8 chars → 4 bytes; 24 chars → 12 bytes.
  const prefixRaw = crypto.randomBytes(PREFIX_LENGTH / 2).toString("hex");
  const secretRaw = crypto.randomBytes(SECRET_LENGTH / 2).toString("hex");

  const prefix = `mcp_${prefixRaw}`;
  const token = `${prefix}${secretRaw}`;
  const hash = await hashBearer(token);

  return { token, prefix, hash };
}

/** Hash scrypt (formato salt:derivedKey) — mesmo de server/password.ts. */
export async function hashBearer(token: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(token, salt, 64, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

/** Verifica bearer contra hash em DB. Constant-time compare. */
export async function verifyBearer(token: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(":");
  if (!salt || !key) return false;
  return new Promise((resolve, reject) => {
    crypto.scrypt(token, salt, 64, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) return reject(err);
      const storedBuf = Buffer.from(key, "hex");
      if (storedBuf.length !== derivedKey.length) {
        return resolve(false);
      }
      resolve(crypto.timingSafeEqual(storedBuf, derivedKey));
    });
  });
}

/**
 * Extrai o prefixo público de um token completo (ou retorna null se inválido).
 * Usado pelo middleware de auth pra fazer lookup em DB sem hashear todos.
 */
export function extractPrefix(token: string): string | null {
  if (!token.startsWith("mcp_")) return null;
  if (token.length !== "mcp_".length + PREFIX_LENGTH + SECRET_LENGTH) return null;
  return token.slice(0, "mcp_".length + PREFIX_LENGTH);
}

/**
 * Extrai bearer do header Authorization. Retorna null se ausente/mal formatado.
 * Case-insensitive em "Bearer".
 */
export function extractBearerFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
