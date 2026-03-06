const MAIN_DOMAIN = "consultaisp.com.br";

export function getSubdomain(): string | null {
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return null;
  if (hostname.endsWith(`.${MAIN_DOMAIN}`)) {
    const sub = hostname.replace(`.${MAIN_DOMAIN}`, "");
    if (sub && sub !== "www") return sub;
  }
  return null;
}
