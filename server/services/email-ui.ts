/**
 * A APARENCIA dos e-mails, separada do que eles dizem.
 *
 * `email.ts` cuida de QUANDO e O QUE se manda; aqui mora COMO isso se parece.
 * A separacao existe porque a caixa de entrada e o unico lugar do produto onde
 * nao da para corrigir depois: nao ha CSS externo, nao ha recarregar, e o que
 * saiu errado ficou errado na caixa de milhares de pessoas.
 *
 * ── Regras que o e-mail impoe, e que valem mais que o DESIGN_SYSTEM ─────────
 * 1. Layout e TABELA. Flex e grid nao existem no Outlook (motor Word).
 * 2. Todo estilo e INLINE. Gmail descarta `<style>` em boa parte dos casos.
 * 3. Nada de variavel CSS: `var(--brand)` chega como texto morto. Por isso a
 *    paleta aqui e de hexadecimais literais, copiados de client/src/index.css.
 * 4. Imagem pode nao carregar (bloqueio por padrao em Gmail e Outlook). Nada
 *    que importe pode depender dela — o logo tem sempre a inicial por baixo.
 * 5. Fonte web nao carrega. Inter e IBM Plex Mono viram pilha de fallback; o
 *    que se preserva do DESIGN_SYSTEM e a INTENCAO: sem serifa, dado em
 *    monoespacada, numero alinhado.
 *
 * ── A pele ──────────────────────────────────────────────────────────────────
 * Instrumento de medicao, nao cartao de felicitacao: fundo cinza-violeta,
 * cartao branco com hairline, um filete da marca no topo em vez de uma tarja
 * colorida, titulo em peso medio e dado em bloco alinhado. A cor da marca
 * aparece em tres lugares e nada mais — filete, botao e link.
 */
import { urlDaMarca, type MarcaResolvida } from "./marca.service";

// ── Paleta (client/src/index.css, tema claro) ────────────────────────────────
export const INK = "#1F1D29";
export const TEXT_2 = "#45414F";
export const MUTED = "#6B6878";
export const FAINT = "#918EA0";
export const BG = "#F6F6F9";
export const SURFACE = "#FFFFFF";
export const SURFACE_2 = "#FAFAFC";
export const BORDER = "#EAEAF0";
export const BORDER_FAINT = "#F2F2F6";

export const OK = "#1F7A4C";
export const OK_BG = "#E6F3EC";
export const OK_BORDER = "#B9DECB";
export const GOLD = "#A9741B";
export const GOLD_BG = "#FBF1DF";
export const GOLD_BORDER = "#E8D2A3";
export const DANGER = "#B3261E";
export const DANGER_BG = "#FBE7E5";
export const DANGER_BORDER = "#F0C4BF";
export const INFO = "#3B6E96";
export const INFO_BG = "#E9EFF5";
export const INFO_BORDER = "#C3D5E4";

/** Sem serifa, como o sistema. Inter fica na frente para quem a tiver local. */
export const SANS = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
/** Todo dado — documento, valor, data, contagem — sai daqui. */
export const MONO = "'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/** A cor de acento e o texto sobre ela, para esta marca. */
export function acento(marca: MarcaResolvida): { brand: string; hover: string; sobre: string; suave: string } {
  const c = marca.cores?.claro;
  return {
    brand: c?.brand ?? "#4A4670",
    hover: c?.hover ?? "#3C3860",
    sobre: c?.textOnBrand ?? "#FFFFFF",
    suave: c?.soft ?? "#EDECF3",
  };
}

/** Escapa o que vem de cadastro antes de entrar no HTML do e-mail. */
export function esc(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** R$ 1.234,56 — sempre com dois decimais, para a coluna nao dancar. */
export function brl(v: number): string {
  return `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Blocos ───────────────────────────────────────────────────────────────────

/** O titulo do e-mail. Um por mensagem: se precisa de dois, sao duas mensagens. */
export function titulo(texto: string): string {
  return `<h1 style="margin:0 0 10px;color:${INK};font-family:${SANS};font-size:21px;font-weight:600;line-height:1.3;letter-spacing:-0.4px;">${texto}</h1>`;
}

/** Rotulo curto acima do titulo: mono, caixa alta, tracking aberto. */
export function kicker(texto: string, cor = MUTED): string {
  return `<p style="margin:0 0 10px;color:${cor};font-family:${MONO};font-size:10px;font-weight:500;letter-spacing:1.4px;text-transform:uppercase;">${esc(texto)}</p>`;
}

export function paragrafo(html: string, margemBaixo = 16): string {
  return `<p style="margin:0 0 ${margemBaixo}px;color:${TEXT_2};font-family:${SANS};font-size:14.5px;line-height:1.65;">${html}</p>`;
}

/** "Ola, Fulano" — o nome em tinta cheia, o resto em texto secundario. */
export function saudacao(nome: string): string {
  return paragrafo(`Olá, <strong style="color:${INK};font-weight:600;">${esc(nome)}</strong>`, 10);
}

export interface LinhaDeDado {
  rotulo: string;
  /** Ja escapado por quem chama quando contiver marcacao (link, por exemplo). */
  valor: string;
  /** Documento, dinheiro, data, contagem: sai em monoespacada. */
  mono?: boolean;
  cor?: string;
}

/**
 * O bloco de dados — a peca que faltava.
 *
 * E o que transforma "sua conta foi criada" em "sua conta foi criada, e aqui
 * esta exatamente o que ficou gravado". Rotulo em mono minusculo a esquerda,
 * valor a direita; nada de duas colunas em telefone estreito, entao o rotulo
 * fica em cima e o valor embaixo em telas pequenas — como e tabela, isso se
 * resolve com uma linha por dado, e nao com media query que metade dos
 * clientes ignora.
 */
export function blocoDeDados(linhas: LinhaDeDado[]): string {
  const celulas = linhas.map((l, i) => `
    <tr>
      <td style="padding:${i === 0 ? "0" : "9px"} 0 0;">
        <span style="display:block;color:${FAINT};font-family:${MONO};font-size:9.5px;font-weight:500;letter-spacing:1.2px;text-transform:uppercase;">${esc(l.rotulo)}</span>
        <span style="display:block;margin-top:3px;color:${l.cor || INK};font-family:${l.mono ? MONO : SANS};font-size:14px;font-weight:${l.mono ? 500 : 600};line-height:1.45;word-break:break-word;">${l.valor}</span>
      </td>
    </tr>`).join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;background:${SURFACE_2};border:1px solid ${BORDER};border-radius:8px;">
    <tr><td style="padding:16px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${celulas}</table>
    </td></tr>
  </table>`;
}

/**
 * Botao. Tabela com `bgcolor`, e nao `<div>` com background: o Outlook
 * descarta background de div e o botao virava texto azul sublinhado.
 */
export function botao(href: string, texto: string, marca: MarcaResolvida): string {
  const cor = acento(marca);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;">
    <tr>
      <td align="center" bgcolor="${cor.brand}" style="border-radius:4px;">
        <a href="${esc(href)}" style="display:inline-block;padding:13px 30px;color:${cor.sobre};font-family:${SANS};font-size:14px;font-weight:600;line-height:1;text-decoration:none;border-radius:4px;">${texto}</a>
      </td>
    </tr>
  </table>`;
}

/** Ação secundária, em texto: nunca compete com o botao principal. */
export function linkSecundario(href: string, texto: string, marca: MarcaResolvida): string {
  return `<p style="margin:0 0 18px;font-family:${SANS};font-size:13px;line-height:1.6;">
    <a href="${esc(href)}" style="color:${acento(marca).brand};font-weight:600;text-decoration:none;">${texto}</a>
  </p>`;
}

export function alerta(html: string, tipo: "ok" | "aviso" | "info" | "perigo" = "aviso"): string {
  const paleta = {
    ok: { bg: OK_BG, borda: OK_BORDER, texto: OK },
    aviso: { bg: GOLD_BG, borda: GOLD_BORDER, texto: "#7A5313" },
    info: { bg: INFO_BG, borda: INFO_BORDER, texto: "#2C5474" },
    perigo: { bg: DANGER_BG, borda: DANGER_BORDER, texto: DANGER },
  }[tipo];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:${paleta.bg};border:1px solid ${paleta.borda};border-radius:6px;">
    <tr><td style="padding:12px 14px;color:${paleta.texto};font-family:${SANS};font-size:13px;line-height:1.55;">${html}</td></tr>
  </table>`;
}

/** Passos numerados. O numero em mono, dentro de um quadrado da marca. */
export function passos(itens: string[], marca: MarcaResolvida): string {
  const cor = acento(marca);
  const linhas = itens.map((item, i) => `
    <tr>
      <td width="26" valign="top" style="padding:0 10px ${i === itens.length - 1 ? 0 : 12}px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td width="22" height="22" align="center" bgcolor="${cor.suave}" style="border-radius:4px;color:${cor.hover};font-family:${MONO};font-size:11px;font-weight:600;line-height:22px;">${i + 1}</td></tr>
        </table>
      </td>
      <td valign="top" style="padding:0 0 ${i === itens.length - 1 ? 0 : 12}px;color:${TEXT_2};font-family:${SANS};font-size:14px;line-height:1.55;">${item}</td>
    </tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${linhas}</table>`;
}

/** Fio de separacao. `border-top` numa celula vazia — `<hr>` some no Outlook. */
export function divisor(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
    <tr><td style="border-top:1px solid ${BORDER_FAINT};font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>`;
}

/** O link cru, para quem o botao nao funcionar. */
export function linkDeReserva(url: string, marca: MarcaResolvida): string {
  return `<p style="margin:0 0 4px;color:${FAINT};font-family:${SANS};font-size:12px;line-height:1.5;">
    Se o botão não abrir, copie este endereço no navegador:<br/>
    <a href="${esc(url)}" style="color:${acento(marca).brand};font-family:${MONO};font-size:11.5px;word-break:break-all;text-decoration:none;">${esc(url)}</a>
  </p>`;
}

// ── O envelope ───────────────────────────────────────────────────────────────

/**
 * O casco de todo e-mail: cabecalho com a marca, corpo e rodape.
 *
 * `preheader` e a linha que a caixa de entrada mostra ao lado do assunto. Sem
 * ela, o cliente de e-mail rouba as primeiras palavras do HTML — que costumam
 * ser "Se o botao nao abrir...".
 */
export function envelope(conteudo: string, preheader: string | undefined, marca: MarcaResolvida): string {
  const cor = acento(marca);
  const nome = esc(marca.nomeProduto);
  const url = urlDaMarca(marca);
  const inicial = esc(marca.nomeProduto.trim().charAt(0).toUpperCase() || "C");
  const assinatura = esc(marca.assinatura || "Análise de crédito para provedores de internet");

  // Marca visual: quadrado com a inicial, sempre; a imagem entra por cima
  // quando o cliente permitir. Nenhuma informacao depende de ela carregar.
  const marcaVisual = marca.logoUrl
    ? `<img src="${esc(url)}${esc(marca.logoUrl)}" alt="${nome}" height="28" style="height:28px;width:auto;display:block;border:0;" />`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
         <tr><td width="28" height="28" align="center" bgcolor="${cor.brand}" style="border-radius:6px;color:${cor.sobre};font-family:${SANS};font-size:14px;font-weight:700;line-height:28px;">${inicial}</td></tr>
       </table>`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${nome}</title>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${BG};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader || "")}</div>
  <!-- Espacos invisiveis: sem eles a caixa de entrada completa a previa com o texto do rodape. -->
  <div style="display:none;max-height:0;overflow:hidden;">&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG};">
    <tr>
      <td align="center" style="padding:32px 12px 40px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${SURFACE};border:1px solid ${BORDER};border-radius:8px;">

          <!-- Filete da marca: identidade sem tarja colorida ocupando um terco da tela -->
          <tr><td height="3" bgcolor="${cor.brand}" style="height:3px;font-size:0;line-height:0;border-radius:8px 8px 0 0;">&nbsp;</td></tr>

          <!-- Cabecalho -->
          <tr>
            <td style="padding:20px 28px;border-bottom:1px solid ${BORDER_FAINT};">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle">${marcaVisual}</td>
                  <td valign="middle" style="padding-left:11px;">
                    <span style="display:block;color:${INK};font-family:${SANS};font-size:15px;font-weight:600;letter-spacing:-0.2px;">${nome}</span>
                    <span style="display:block;margin-top:1px;color:${FAINT};font-family:${MONO};font-size:9.5px;letter-spacing:1.1px;text-transform:uppercase;">${assinatura}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Corpo -->
          <tr><td style="padding:28px;">${conteudo}</td></tr>

          <!-- Rodape -->
          <tr>
            <td style="padding:18px 28px 20px;background:${SURFACE_2};border-top:1px solid ${BORDER_FAINT};border-radius:0 0 8px 8px;">
              <p style="margin:0;color:${FAINT};font-family:${SANS};font-size:11.5px;line-height:1.6;">
                <a href="${esc(url)}" style="color:${cor.brand};text-decoration:none;font-weight:600;">${esc(url.replace(/^https?:\/\//, ""))}</a>${
                  marca.suporteEmail
                    ? ` &nbsp;·&nbsp; Suporte: <a href="mailto:${esc(marca.suporteEmail)}" style="color:${cor.brand};text-decoration:none;">${esc(marca.suporteEmail)}</a>`
                    : ""
                }
              </p>
              <p style="margin:8px 0 0;color:${FAINT};font-family:${SANS};font-size:11px;line-height:1.55;">
                Você recebeu esta mensagem porque tem uma conta de provedor no ${nome}. É um aviso do sistema, não uma oferta.
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
