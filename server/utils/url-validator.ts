/**
 * ERP URL validation with configurable policy.
 *
 * Strict defaults for production internet targets, but allows controlled
 * exceptions for known/private ERP endpoints via:
 *   - ERP_ALLOW_PRIVATE_NETWORK=true  (env flag — enables HTTP and private IPs)
 *   - ERP_URL_ALLOWLIST=host1,host2   (env flag — specific hosts always accepted)
 */

/** Result returned by validateErpUrl with actionable detail. */
export interface ErpUrlValidationResult {
  valid: boolean;
  /** Human-readable reason for rejection (Portuguese). */
  reason?: string;
}

const PRIVATE_IP_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/;

const LOCAL_SUFFIXES = [".local", ".internal"];

function isPrivateHost(host: string): boolean {
  if (
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return true;
  }
  if (LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (PRIVATE_IP_RE.test(host)) return true;
  return false;
}

function getAllowlist(): Set<string> {
  const raw = process.env.ERP_URL_ALLOWLIST?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isPrivateNetworkAllowed(): boolean {
  return process.env.ERP_ALLOW_PRIVATE_NETWORK === "true";
}

/**
 * Validates an ERP URL and returns an actionable result.
 *
 * Policy:
 *  - By default only HTTPS to public hosts is accepted.
 *  - If ERP_ALLOW_PRIVATE_NETWORK=true, HTTP and private/local hosts are allowed.
 *  - Hosts listed in ERP_URL_ALLOWLIST are always accepted regardless of policy.
 */
export function validateErpUrl(raw: string): ErpUrlValidationResult {
  try {
    const url = raw.startsWith("http") ? raw : `https://${raw}`;
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const allowlist = getAllowlist();

    // Allowlisted hosts bypass all checks
    if (allowlist.has(host)) {
      return { valid: true };
    }

    const privateAllowed = isPrivateNetworkAllowed();

    // Protocol check
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return {
        valid: false,
        reason:
          "Protocolo invalido. Use uma URL com HTTPS (ex: https://erp.exemplo.com.br).",
      };
    }

    if (parsed.protocol === "http:" && !privateAllowed) {
      return {
        valid: false,
        reason:
          "URLs HTTP nao sao permitidas em modo de producao. " +
          "Use HTTPS ou configure ERP_ALLOW_PRIVATE_NETWORK=true para permitir HTTP em redes privadas.",
      };
    }

    // Private/local host check
    if (isPrivateHost(host) && !privateAllowed) {
      return {
        valid: false,
        reason:
          "Enderecos privados ou locais (localhost, IPs internos, .local) nao sao permitidos em modo de producao. " +
          "Configure ERP_ALLOW_PRIVATE_NETWORK=true ou adicione o host em ERP_URL_ALLOWLIST para permitir.",
      };
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      reason:
        "URL invalida. Informe uma URL valida (ex: https://erp.exemplo.com.br/api).",
    };
  }
}

/**
 * Simple boolean check — kept for backwards compatibility.
 * Delegates to validateErpUrl.
 */
export function isAllowedErpUrl(raw: string): boolean {
  return validateErpUrl(raw).valid;
}
