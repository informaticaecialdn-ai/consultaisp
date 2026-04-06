/**
 * Validates that a URL is safe for outbound requests (prevents SSRF).
 * Only allows HTTPS to non-private hosts.
 */
export function isAllowedErpUrl(raw: string): boolean {
  try {
    const url = raw.startsWith("http") ? raw : `https://${raw}`;
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;

    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
