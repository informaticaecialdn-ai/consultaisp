const MAIN_DOMAIN = "consultaisp.com.br";

export function slugifySubdomain(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);
}

export function buildSubdomainUrl(subdomain: string): string {
  return `https://${subdomain}.${MAIN_DOMAIN}`;
}

export function extractSubdomainFromHost(hostname: string): string | null {
  const parts = hostname.split(".");
  if (parts.length >= 3) {
    const sub = parts[0];
    if (sub && sub !== "www") return sub;
  }
  return null;
}
