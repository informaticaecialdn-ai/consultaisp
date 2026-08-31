/**
 * Dominio da PLATAFORMA. Nao confundir com o dominio proprio de uma marca
 * white label: aquele vive em `marcas.dominio` e e resolvido em
 * server/services/marca.service.ts.
 *
 * Vem do ambiente para o dev e os testes poderem trocar sem editar codigo.
 */
export const MAIN_DOMAIN = (process.env.MAIN_DOMAIN || "consultaisp.com.br").toLowerCase();

/**
 * Reduz um host a forma canonica de comparacao.
 *
 * `req.hostname` no Express ja tira a porta, mas esta funcao tambem recebe o
 * que o superadmin digita no formulario — onde "https://App.CredNet.com.br/" e
 * entrada perfeitamente comum. Host que nao normaliza igual compara errado, e
 * comparar errado aqui significa entregar a marca de um revendedor ao cliente
 * de outro.
 */
export function normalizarHost(host: string | null | undefined): string {
  return (host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")   // cola de "https://app.crednet.com.br"
    .replace(/[/?#].*$/, "")       // caminho, query e fragmento
    .replace(/:\d+$/, "")          // porta
    .replace(/\.$/, "");           // ponto final do FQDN absoluto
}

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

/**
 * O rotulo de subdominio de um host DA PLATAFORMA, ou null.
 *
 * A versao anterior contava rotulos (`parts.length >= 3`) sem nunca comparar
 * com MAIN_DOMAIN, e errava dos dois lados:
 *
 *   "consultaisp.com.br"      -> devolvia "consultaisp"  (e o proprio dominio raiz)
 *   "app.crednet.com.br"      -> devolvia "app"          (e dominio de OUTRA marca)
 *   "nslink.evil.com"         -> devolvia "nslink"       (nao e nosso dominio)
 *
 * O primeiro caso ja causa efeito hoje: no dominio raiz, `auth.routes.ts`
 * compara "consultaisp" com o subdominio do provedor, nao bate, e o usuario
 * recebe "Email ou senha incorretos" — mensagem que mente sobre o motivo.
 * O terceiro e o que ficaria perigoso com white label, porque o host passa a
 * escolher a marca.
 *
 * Agora e exigido o sufixo da plataforma e um unico rotulo: "a.b.dominio" nao e
 * tenant. Host de marca propria devolve null de proposito — quem responde por
 * ele e o marca.service, nao esta funcao.
 */
export function extractSubdomainFromHost(hostname: string): string | null {
  const host = (hostname || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host.endsWith(`.${MAIN_DOMAIN}`)) return null;

  const sub = host.slice(0, -(MAIN_DOMAIN.length + 1));
  if (!sub || sub === "www" || sub.includes(".")) return null;
  return sub;
}
