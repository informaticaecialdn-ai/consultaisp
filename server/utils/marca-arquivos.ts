/**
 * Os arquivos que uma marca guarda: logo SVG, logo PNG e favicon.
 *
 * Mora aqui, e nao dentro de uma rota, porque DUAS rotas gravam os mesmos
 * campos com regras que precisam ser as mesmas: o superadmin, por
 * `PATCH /api/admin/marcas/:id`, e o proprio revendedor, por
 * `PATCH /api/revenda/marca`. Enquanto cada uma tinha a sua copia, um ajuste
 * de limite num lado deixava o outro aceitando o que o primeiro recusava — e
 * as duas escrevem na MESMA coluna, servida pelo mesmo `/api/marca/:id/logo`.
 *
 * ISTO NAO E A DEFESA CONTRA XSS. A defesa e o SVG nunca ser embutido na
 * pagina: ele e servido por URL e carregado em `<img>`, onde o navegador
 * desliga script por especificacao (ver o topo de `server/routes/marca.routes.ts`).
 * Aqui e higiene de formato e teto de tamanho.
 *
 * O teto nao e estetica. Em producao cabem 10 MB no corpo
 * (`express.json({limit:"10mb"})`), e `/api/marca/:id/logo` serve esse campo a
 * CADA visitante do dominio da marca: sem limite, o proprio dono da marca
 * derruba a propria marca com um upload.
 */

/** Teto de tamanho. Logo de marca nao chega perto disso; e barreira de abuso. */
export const LIMITE_SVG = 256 * 1024;
export const LIMITE_PNG = 512 * 1024;

export type Veredito = { ok: true } | { ok: false; motivo: string };

/**
 * Recusa o que claramente nao e SVG antes de gravar.
 *
 * Impede guardar HTML no campo do logo e devolver um 500 confuso mais tarde.
 */
export function svgAceitavel(svg: string): Veredito {
  const t = svg.trim();
  if (t.length > LIMITE_SVG) return { ok: false, motivo: "SVG acima de 256 KB." };
  if (!t.startsWith("<") || !/<svg[\s>]/i.test(t)) return { ok: false, motivo: "Conteudo nao e um SVG." };
  if (!/<\/svg>\s*$/i.test(t)) return { ok: false, motivo: "SVG incompleto." };
  return { ok: true };
}

export function pngAceitavel(dataUri: string): Veredito {
  if (dataUri.length > LIMITE_PNG) return { ok: false, motivo: "PNG acima de 512 KB." };
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUri.trim());
  if (!m) return { ok: false, motivo: "Envie um PNG como data URI base64." };
  // Assinatura do formato: 89 50 4E 47. Extensao e cabecalho mentem; o byte nao.
  const cabecalho = Buffer.from(m[1].slice(0, 16), "base64");
  if (cabecalho.length < 4 || cabecalho[0] !== 0x89 || cabecalho[1] !== 0x50 ||
      cabecalho[2] !== 0x4e || cabecalho[3] !== 0x47) {
    return { ok: false, motivo: "O arquivo nao e um PNG de verdade." };
  }
  return { ok: true };
}

