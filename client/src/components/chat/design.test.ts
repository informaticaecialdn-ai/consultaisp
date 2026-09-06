/**
 * O chat no DESIGN_SYSTEM v5 — travado pelo texto da fonte.
 *
 * O vitest deste projeto não coleta `.tsx` (sem DOM), então, como em
 * `pages/cobranca/telas.test.ts`, o que se prova é o que a fonte executa:
 * selo retangular, nada de `text-white` (o token `--text-on-brand` vira no
 * escuro; branco cravado não), profundidade por anel de 1px e nunca sombra,
 * paleta do projeto e nunca a default do Tailwind, skeleton em vez da palavra
 * "Carregando", `--past` só como cor de dívida — nunca de botão ou avatar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const raiz = join(__dirname, "..", "..");
const ler = (relativo: string) => readFileSync(join(raiz, relativo), "utf8");
/** A fonte sem comentário — o que a tela realmente executa. */
const executavel = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ARQUIVOS = [
  "components/chat/PerfilDoCliente.tsx",
  "components/chat/PagamentosDoChat.tsx",
  "components/chat/AutomacaoPrimeiroContato.tsx",
  "components/chat/ChatDaRecuperacao.tsx",
  "components/chat/TemplatesDatafy.tsx",
  "components/chat/ConexaoWhatsapp.tsx",
  "components/cobranca/ConversaDoChat.tsx",
  "pages/operacional/chat.tsx",
] as const;
const FONTES = ARQUIVOS.map((a) => [a, executavel(ler(a))] as const);

describe("o chat na pele do DESIGN_SYSTEM v5", () => {
  /**
   * Antes a checagem só olhava dentro de `<tag …>`, então uma constante
   * (`const SELO = "rounded-full …"`) passava batido. Agora vale para QUALQUER
   * linha da fonte; a licença é o marcador de decoração — `aria-hidden` ou o
   * comentário `// avatar` — na própria linha ou nas três anteriores, que é
   * onde a tag abre quando o `className` desce de linha.
   */
  it.each(FONTES)("%s: pill só em avatar ou ponto decorativo, nunca em selo", (arquivo, fonte) => {
    const linhas = fonte.split("\n");
    linhas.forEach((linha, i) => {
      if (!linha.includes("rounded-full")) return;
      const janela = linhas.slice(Math.max(0, i - 3), i + 1).join("\n");
      expect(janela, `${arquivo}:${i + 1}`).toMatch(/aria-hidden|\/\/ avatar/);
    });
  });

  it.each(FONTES)("%s: sem text-white — sobre a marca o texto é --text-on-brand", (_, fonte) => {
    expect(fonte).not.toMatch(/\btext-white\b/);
  });

  it.each(FONTES)("%s: profundidade por anel de 1px, nunca shadow-sm/md/lg/xl", (_, fonte) => {
    expect(fonte).not.toMatch(/\bshadow-(sm|md|lg|xl|2xl)\b/);
  });

  // A lista antiga cobria seis cores; o Tailwind tem vinte e duas, e um
  // `text-amber-600` passava. Agora é a paleta inteira.
  it.each(FONTES)("%s: paleta do projeto, nunca a default do Tailwind", (_, fonte) => {
    expect(fonte).not.toMatch(
      /\b(bg|text|border|ring|from|to|via|divide|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/,
    );
  });

  it.each(FONTES)("%s: skeleton mostra a forma do que vem; a palavra 'Carregando' não aparece", (_, fonte) => {
    expect(fonte).not.toMatch(/Carregando/);
  });

  it.each(FONTES)("%s: --past pinta dívida, nunca botão nem avatar", (_, fonte) => {
    expect(fonte).not.toMatch(/bg-\[var\(--past\)\]/);
  });
});

describe("as primitivas do chat", () => {
  const perfil = executavel(ler("components/chat/PerfilDoCliente.tsx"));

  it("o botão de marca usa --brand com --text-on-brand, alvo de toque e anel de foco", () => {
    expect(perfil).toMatch(/BOTAO_CHAT_MARCA = `[^`]*bg-\[var\(--brand\)\][^`]*text-\[var\(--text-on-brand\)\]/);
    expect(perfil).toMatch(/BOTAO_CHAT_MARCA = `[^`]*\$\{ALVO_CONTROLE\}[^`]*\$\{FOCO\}/);
  });

  it("os selos vêm de SeloCobranca/SeloQuadrante, e todo número sai em mono tabular", () => {
    expect(perfil).toContain("<SeloCobranca");
    expect(perfil).toContain("<SeloQuadrante");
    expect(perfil).toContain('NUM_CHAT = "font-mono tabular-nums"');
    // A grade de métricas (em aberto, atraso, crédito, propensão) e a fatura.
    expect(perfil).toMatch(/<dd[\s\S]*?NUM_CHAT/);
    expect(perfil).toMatch(/\{dinheiroChat\(f\.valor\)\}/);
    expect(perfil).toMatch(/className=\{cn\("flex justify-between gap-2", NUM_CHAT\)\}/);
  });

  it("o dado que não veio é <Traco> com motivo próprio, nunca zero nem traço mudo", () => {
    expect(perfil).not.toMatch(/\?\? 0\b/);
    // Cada métrica carrega o próprio porquê — "não calculado" servia para tudo.
    expect(perfil).toContain("{m.v ?? <Traco titulo={m.motivo} />}");
    for (const motivo of ["MOTIVO_SEM_DIVIDA", "MOTIVO_SEM_ATRASO", "MOTIVO_SEM_SCORE", "MOTIVO_SEM_PROPENSAO"])
      expect(perfil).toContain(`motivo: ${motivo}`);
    // Nada de "—" cru caindo no lugar de um dado: quem mostra ausência é <Traco>.
    expect(perfil).not.toMatch(/\?\?\s*"—"/);
    expect(perfil).toContain("<Traco titulo={MOTIVO_SEM_TELEFONE} />");
    expect(perfil).toContain("<Traco titulo={MOTIVO_SEM_INICIO} />");
    expect(perfil).toContain("<Traco titulo={MOTIVO_SEM_MAC} />");
  });

  it("a métrica de score é o isp_score rotulado Score ISP, na faixa de cor do DESIGN_SYSTEM", () => {
    // O valor sempre foi `customers.isp_score`; o rótulo "Crédito" prometia bureau.
    expect(perfil).toContain('k: "Score ISP"');
    expect(perfil).not.toMatch(/k: "Crédito"/);
    expect(perfil).toContain('import { faixaDoScore } from "@/components/cobranca/formatacao"');
    expect(perfil).toContain("style: faixa ? { color: faixa.cor } : undefined");
  });

  it("dívida, atraso e score chegam como number | null — o servidor não inventa zero", () => {
    const contrato = ler("../../shared/cobranca/contexto-chat.ts");
    expect(contrato).toMatch(/divida: number \| null/);
    expect(contrato).toMatch(/diasAtraso: number \| null/);
    expect(contrato).toMatch(/ispScore: number \| null/);
    expect(contrato).not.toMatch(/credito:/);
  });

  it("a frase das 50 mais antigas se sustenta na ordenação do serviço, e o que não tem data é contado", () => {
    const servico = readFileSync(
      join(raiz, "..", "..", "server", "services", "chat", "chat-contexto.service.ts"),
      "utf8",
    );
    expect(servico).toContain(".sort(porVencimento)");
    expect(servico).toContain("faturasSemData:");
    expect(perfil).toContain("faturas mais");
    expect(perfil).toContain("contexto.faturasSemData");
  });

  it("carregando vira <Skeleton>, atrasado 300 ms como manda a seção 6", () => {
    expect(perfil).toContain('import { Skeleton } from "@/components/ui/skeleton"');
    expect(perfil).toContain("useSkeletonAtrasado(carregando)");
  });
});

describe("a fila de conversas", () => {
  const fila = executavel(ler("pages/operacional/chat.tsx"));

  it("a aba ativa sobe por anel de 1px; a conversa aberta acende na marca, não na cor de dívida", () => {
    expect(fila).toContain("shadow-[0_0_0_1px_var(--border)]");
    expect(fila).toContain("border-l-[var(--brand)] bg-[var(--brand-soft)]");
  });

  it("carregando é LinhasSkeleton, com os 300 ms; paginação e voltar têm alvo e foco", () => {
    expect(fila).toContain("<LinhasSkeleton");
    expect(fila).toContain("useSkeletonAtrasado(fila.isPending)");
    expect(fila).toMatch(/BOTAO_PAGINA = `\$\{ALVO_TEXTO\}[^`]*\$\{FOCO\}[^`]*\$\{DESABILITAVEL\}`/);
    expect(fila).toContain("FOCO_INTERNO,");
  });

  it("telefone, data e número da página saem em mono tabular", () => {
    expect(fila).toContain("c.telefone && NUM_CHAT");
    expect(fila).toContain("c.ultimoEventoEm && NUM_CHAT");
    expect(fila).toContain("Página <span className={NUM_CHAT}>{pagina}</span>");
  });
});

describe("primeiros contatos automáticos", () => {
  const tela = executavel(ler("components/chat/AutomacaoPrimeiroContato.tsx"));
  const worker = readFileSync(
    join(raiz, "..", "..", "server", "services", "chat", "chat-primeiro-contato.service.ts"),
    "utf8",
  );

  it("o teto por rodada é o do worker (Math.min(5, …)), e a rodada corre a cada minuto", () => {
    expect(worker).toMatch(/Math\.min\(\s*5,/);
    expect(worker).toContain("60_000");
    expect(tela).toContain("CONTATOS_POR_RODADA = 5");
    expect(tela).toContain("A rodada corre a cada minuto");
  });

  /**
   * Este caso já provou o contrário: enquanto a contagem não existia, a tela
   * TINHA de mostrar traço. Agora ela existe (`GET
   * /api/cobranca/indicadores/automacao`, contada pelo mesmo
   * `contatosIniciadosNoDia` que o worker usa), e o que continua valendo é a
   * regra de origem: quando a rota não tem de onde contar, vem nulo com motivo
   * e a tela desenha traço — nunca zero.
   */
  it("contatos de hoje: número do worker quando existe, traço com motivo quando não", () => {
    expect(tela).toContain('data-testid="automacao-contatos-hoje"');
    expect(tela).toContain("indicador.data?.hoje ?? (");
    expect(tela).toContain("indicador.data?.motivo ??");
    expect(tela).toContain("indicador.data?.limiteDiario ??");
    expect(tela).not.toMatch(/hoje\s*\?\?\s*0/);
  });
});

describe("o bloco de conversa na ficha 360", () => {
  it("ConversaDoChat não recebe mais inboxUrl nem casoId, e a ficha não os passa", () => {
    const bloco = executavel(ler("components/cobranca/ConversaDoChat.tsx"));
    expect(bloco).not.toContain("inboxUrl");
    expect(bloco).not.toContain("casoId");
    const ficha = executavel(ler("pages/cobranca/cliente360.tsx"));
    // A chamada traz `() => enviarParaChat.mutate()`, então `[^>]*` não serve.
    const chamada = ficha.match(/<ConversaDoChat[\s\S]*?\/>/)?.[0] ?? "";
    expect(chamada).not.toBe("");
    expect(chamada).not.toContain("inboxUrl");
    expect(chamada).not.toContain("casoId");
  });
});
