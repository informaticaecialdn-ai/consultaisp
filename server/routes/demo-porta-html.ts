/**
 * A página de erro da PORTA da demonstração (`GET /demo`), quando a resposta
 * não pode ser o redirecionamento de sempre (item 5 do plano de 2026-09-11).
 *
 * Até aqui, o limite de tentativas e uma falha de criação respondiam
 * `{"message":"..."}` como JSON cru — o Express nunca embrulha isso em página
 * nenhuma. Um estranho que clica "Ver demonstração" duas vezes rápido demais,
 * ou pega o sistema no meio de uma falha, via um blob de texto no lugar de
 * qualquer coisa que pareça um site.
 *
 * O visual é o da landing (`client/src/pages/public/landingpage.css`): creme
 * `#F5F3EE`, quase-preto `#0E0D0B`, JetBrains Mono — a MESMA exceção ao
 * `DESIGN_SYSTEM.md` que a landing e a porta de entrada da plataforma já são,
 * por desenho do dono. As cores da marca vêm de `email-ui.ts` (TINTA/DESTAQUE/
 * CREME_DA_MARCA) — a mesma fonte que os e-mails transacionais usam — para o
 * hex não divergir aos poucos em um terceiro lugar.
 *
 * Esta página NÃO faz parte do bundle Vite: é HTML puro, montado no servidor
 * e devolvido direto por `res.send()` — o mesmo motivo que faz o wordmark de
 * e-mail sair em texto, não em componente React (nada daqui passa pelo
 * `index.html`/Vite).
 */
import { TINTA_DA_MARCA, DESTAQUE_DA_MARCA, CREME_DA_MARCA } from "../services/email-ui";

/** O wordmark /consulta.isp em HTML cru — mesmo desenho do topo de `email-ui.ts`, sem o wrapper de tabela de e-mail. */
const WORDMARK = `<span style="color:${DESTAQUE_DA_MARCA}">/</span>consulta<span style="color:${DESTAQUE_DA_MARCA}">.isp</span>`;

export interface PaginaDeErroDaPorta {
  /** Título curto: o que aconteceu. */
  titulo: string;
  /** Uma ou duas frases explicando a situação, em tom afirmativo — nunca jargão de erro HTTP. */
  mensagem: string;
  /** O que fazer agora — sempre presente; é o que esta página existe para dizer. */
  proximoPasso: string;
}

/** Uma página HTML completa, na paleta monocromática da landing, para as respostas de `/demo` que não são o redirecionamento de sempre. */
export function paginaDeErroDaPorta({ titulo, mensagem, proximoPasso }: PaginaDeErroDaPorta): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${titulo} · Consulta ISP</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: ${CREME_DA_MARCA};
    color: ${TINTA_DA_MARCA};
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    font-size: 16px; line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    padding: 24px;
  }
  .cartao {
    max-width: 460px; width: 100%;
    background: #FFFFFF;
    border: 1px solid rgba(14, 13, 11, 0.12);
    border-radius: 10px;
    padding: 36px 32px;
  }
  .wordmark {
    display: block;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 19px; font-weight: 700; letter-spacing: -0.04em;
    margin-bottom: 22px;
  }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 10px; }
  p { margin: 0 0 8px; color: #45414A; }
  p.proximo-passo { color: ${TINTA_DA_MARCA}; font-weight: 500; margin-top: 18px; }
  a.voltar {
    display: inline-flex; align-items: center; gap: 6px;
    margin-top: 20px; padding: 10px 18px;
    background: ${TINTA_DA_MARCA}; color: ${CREME_DA_MARCA};
    border-radius: 6px; text-decoration: none;
    font-size: 14px; font-weight: 500;
  }
  a.voltar:hover { opacity: 0.88; }
</style>
</head>
<body>
  <div class="cartao">
    <span class="wordmark">${WORDMARK}</span>
    <h1>${titulo}</h1>
    <p>${mensagem}</p>
    <p class="proximo-passo">${proximoPasso}</p>
    <a class="voltar" href="/">Voltar para a página inicial</a>
  </div>
</body>
</html>
`;
}
