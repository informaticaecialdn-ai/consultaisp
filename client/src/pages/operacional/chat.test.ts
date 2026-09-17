/**
 * A tela de Conversas no porte do módulo Cobrança do Provedor.ai, travada pelo
 * texto da fonte — o vitest deste projeto não coleta `.tsx` (sem DOM), então,
 * como em `pages/cobranca/telas.test.ts`, o que se prova é a montagem:
 *
 *  - três colunas de verdade em tela larga, cada uma rolando por si, e a página
 *    inteira sem barra de rolagem;
 *  - as abas apontam para status que a ROTA aceita (conferido contra o zod do
 *    servidor) — nenhuma aba inventada;
 *  - a janela do que a fila não traz fica honesta: contagem só com `total`,
 *    prévia só com `ultimaMensagem`, e o motivo sempre no `title`;
 *  - a pele é a do DESIGN_SYSTEM v5.
 *
 * `tempoRelativo` é lógica pura e é provada direto.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  conversaAtiva,
  MOTIVO_SEM_HISTORICO,
  MOTIVO_SEM_PREVIA,
  STATUS_ATIVOS_DO_CHAT,
  STATUS_CHAT,
  TOM_DO_STATUS_CHAT,
  tempoRelativo,
} from "@/components/chat/tipos";

const raiz = join(__dirname, "..", "..");
/** A fonte sem comentário — o que a tela realmente executa. */
const executavel = (fonte: string) =>
  fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const fonte = executavel(readFileSync(join(raiz, "pages", "operacional", "chat.tsx"), "utf8"));
const rota = readFileSync(
  join(raiz, "..", "..", "server", "routes", "chat-bullq.routes.ts"),
  "utf8",
);

describe("três colunas de verdade", () => {
  it("a página mede a janela e prende o overflow: nada de rolar o documento inteiro", () => {
    expect(fonte).toContain("h-[calc(100dvh-3rem)]");
    expect(fonte).toMatch(/<main[\s\S]{0,200}?overflow-hidden/);
    // A faixa das colunas também: quem rola é cada coluna, não a faixa.
    expect(fonte).toContain("flex min-h-0 flex-1 overflow-hidden");
  });

  it("lista 310px (260px com duas colunas), conversa fluida, e o painel do cliente é desenhado por <Atendimento>", () => {
    // A lista da referência: minmax(240px, 310px) com três colunas; minmax(200px, 260px) com duas.
    expect(fonte).toMatch(/lg:w-\[260px\] xl:w-\[310px\]/);
    expect(fonte).toContain("flex min-h-0 min-w-0 flex-1 flex-col");
    expect(fonte).toContain("<Atendimento");
  });

  it("a lista e a paginação rolam separadas: só o miolo tem overflow", () => {
    expect(fonte).toContain("min-h-0 flex-1 overflow-y-auto");
    // Busca/abas e paginação são fixas nas pontas da coluna.
    expect(fonte).toContain("shrink-0 space-y-3 border-b");
    expect(fonte).toContain("flex shrink-0 items-center justify-between border-t");
  });

  it("abaixo de lg é uma coluna por vez, com caminho de volta", () => {
    expect(fonte).toContain('selecionada || casoDoLink ? "hidden lg:flex" : "flex"');
    expect(fonte).toContain('!selecionada && !casoDoLink && "hidden lg:flex"');
    expect(fonte).toContain("Voltar às conversas");
    expect(fonte).toMatch(/text-xs lg:hidden/);
  });

  it("com a conversa aberta, abaixo de sm a volta mora no cabeçalho do atendimento (correção 3)", () => {
    // A faixa da página some só com conversa aberta e só no celular; com ?caso= ela fica.
    expect(fonte).toMatch(/text-xs lg:hidden",\s*selecionada && "max-sm:hidden",/);
    // O atendimento recebe o mesmo destino da faixa — nunca um caminho de volta diferente.
    expect(fonte).toContain("aoVoltar={() => navegar(rotaChat(origem, undefined, carteira))}");
    expect(fonte).toContain("onClick={() => navegar(rotaChat(origem, undefined, carteira))}");
  });
});

describe("a lista", () => {
  it("busca por nome ou telefone, com o rótulo dizendo os dois", () => {
    expect(fonte).toContain('aria-label="Buscar cliente ou telefone"');
    expect(fonte).toContain('placeholder="Buscar cliente, telefone…"');
    // Trocar o filtro volta à primeira página: senão a página 3 de outro recorte fica vazia.
    expect(fonte).toMatch(/setBusca\(e\.target\.value\);\s*setPagina\(1\)/);
  });

  it("a busca espera 250 ms, como na referência: uma leitura quando o operador para, não uma por tecla", () => {
    expect(fonte).toContain("const ESPERA_DA_BUSCA_MS = 250");
    expect(fonte).toContain("setTimeout(() => setBuscaAplicada(busca.trim()), ESPERA_DA_BUSCA_MS)");
    expect(fonte).toContain("return () => clearTimeout(espera)");
    // O que vai à rota é a busca aplicada, nunca o texto cru do campo.
    expect(fonte).toContain('if (buscaAplicada) params.set("busca", buscaAplicada)');
    expect(fonte).not.toMatch(/params\.set\("busca", busca\.trim\(\)\)/);
  });

  it("com as colunas lado a lado, a primeira conversa abre — nunca por cima de um link", () => {
    expect(fonte).toContain('const TELA_COM_COLUNAS = "(min-width: 1024px)"');
    expect(fonte).toContain("if (!primeiraDaLista || selecionada || casoDoLink) return;");
    expect(fonte).toContain("window.matchMedia(TELA_COM_COLUNAS).matches");
    expect(fonte).toContain("navegar(rotaChat(origem, primeiraDaLista, carteira), { replace: true })");
  });

  it("escalada é o 'não lido': a hora acende com o ponto âmbar — o âmbar não pinta texto de 10px", () => {
    expect(fonte).toContain('const escalada = c.status === "PENDING"');
    // --gated a 10px fica em ~4:1 sobre branco e ~3,4:1 sobre --brand-soft: a cor vai ao ponto.
    // A hora não escalada é --text-muted (o --text-3 da referência): --text-faint dava ~3,2:1 no
    // branco e ~2,7:1 na linha ativa.
    expect(fonte).toContain('escalada ? "font-bold text-[var(--text-2)]" : "text-[var(--text-muted)]"');
    expect(fonte).not.toMatch(/escalada \?[^:]*: "text-\[var\(--text-faint\)\]"/);
    expect(fonte).toContain('<span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--gated)]" />');
    expect(fonte).not.toContain('"font-bold text-[var(--gated)]"');
    expect(fonte).toContain('<span className="sr-only"> · escalada</span>');
  });

  it("a conversa recebe o diagnóstico do canal: pronto só confirmado, problema é false, sem leitura é indefinido", () => {
    expect(fonte).toContain('canalPronto={canalComProblema ? false : transporte.data?.codigo === "PRONTO" ? true : undefined}');
  });

  it("o aviso do canal vai ao compositor da conversa, a toda coluna sem conversa (vazio e caso) e à lista estreita", () => {
    expect(fonte).toContain('avisoDoCanal={avisoDoCanal("chat-diagnostico-transporte")}');
    expect(fonte).toContain('{canalComProblema && <div className="lg:hidden">{avisoDoCanal("chat-diagnostico-transporte-lista")}</div>}');
    // Fora do ternário do caso: carregando, com erro ou sem conversa, a faixa fica. O render de
    // verdade (em qualquer largura) está em chat-aviso-do-canal.test.ts.
    const coluna = fonte.slice(fonte.indexOf('data-testid="chat-coluna-sem-conversa"'));
    expect(coluna.indexOf('data-testid="chat-coluna-aviso-do-canal"')).toBeGreaterThan(0);
    expect(coluna.indexOf('data-testid="chat-coluna-aviso-do-canal"')).toBeLessThan(coluna.indexOf("{casoDoLink ? ("));
    expect(fonte).toContain('transporte.data.codigo !== "PRONTO"');
    expect(fonte).toContain("Verificar novamente");
    expect(fonte).toContain('href="/painel-provedor?tab=chat"');
  });

  it("as abas são Todas / Escaladas / Encerradas — e cada status existe na rota", () => {
    expect(fonte).toContain("const ABAS_DA_FILA = [");
    for (const [valor, rotulo] of [
      ["", "Todas"],
      ["PENDING", "Escaladas"],
      ["CLOSED", "Encerradas"],
    ])
      expect(fonte).toContain(`["${valor}", "${rotulo}"]`);
    // O contrato do servidor: só estes cinco status entram no filtro.
    const enumDaRota = rota.match(/status: z\.enum\(\[([^\]]+)\]\)/)?.[1] ?? "";
    expect(enumDaRota).not.toBe("");
    for (const status of ["PENDING", "CLOSED"]) expect(enumDaRota).toContain(`"${status}"`);
    // Nenhuma aba com status fora do enum (a vazia é "sem filtro", e é a única).
    const abas = [...fonte.matchAll(/\["([A-Z_]*)", "[^"]+"\]/g)].map((m) => m[1]);
    expect(abas.length).toBeGreaterThanOrEqual(3);
    for (const valor of abas) if (valor) expect(enumDaRota).toContain(`"${valor}"`);
  });

  it("a linha traz avatar com canal, nome, tempo relativo e os selos reais", () => {
    expect(fonte).toContain('data-testid="fila-chat-linha"');
    expect(fonte).toContain("<AvatarChat nome={c.nome}");
    expect(fonte).toContain("const quando = tempoRelativo(c.ultimoEventoEm)");
    expect(fonte).toContain("<SeloCobranca tom={TOM_DO_STATUS_CHAT[c.status] ?? \"neutro\"}>");
    expect(fonte).toContain("<SeloCarteira carteira={c.carteira} />");
    // O tom de cada estado existe para os cinco status do contrato.
    for (const status of Object.keys(STATUS_CHAT)) expect(TOM_DO_STATUS_CHAT[status]).toBeTruthy();
  });

  it("a linha de selos só existe com o estado fora do curso normal ou sem histórico, como na referência (correção 3)", () => {
    expect(fonte).toContain("const estadoForaDoCurso = !conversaAtiva(c.status)");
    expect(fonte).toMatch(/\{\(estadoForaDoCurso \|\| !c\.ultimoEventoEm\) && \(\s*<span className="mt-\[5px\] flex flex-wrap items-center gap-\[5px\]" data-testid="fila-chat-selos">/);
    expect(fonte).toMatch(/\{estadoForaDoCurso && \(\s*<SeloCobranca tom=\{TOM_DO_STATUS_CHAT\[c\.status\] \?\? "neutro"\}>/);
    // Sem o selo, o estado continua dito ao leitor de tela.
    expect(fonte).toContain('{!estadoForaDoCurso && <span className="sr-only"> · {STATUS_CHAT[c.status] ?? c.status}</span>}');
    // A carteira sai da linha de selos: na cobrança a lista já é de uma carteira só; em equipamentos
    // ela mistura, e o selo vai à direita da segunda linha.
    expect(fonte).toContain("{mostrarCarteira && c.carteira && <SeloCarteira carteira={c.carteira} />}");
    expect(fonte).toContain('mostrarCarteira={origem === "equipamentos"}');
  });

  it("conversaAtiva: aberta, com agente e aguardando cliente seguem o curso; escalada, encerrada e o desconhecido não", () => {
    expect([...STATUS_ATIVOS_DO_CHAT]).toEqual(["OPEN", "BOT", "WAITING"]);
    for (const status of ["OPEN", "BOT", "WAITING"]) expect(conversaAtiva(status)).toBe(true);
    for (const status of ["PENDING", "CLOSED", "EXPIRED", ""]) expect(conversaAtiva(status)).toBe(false);
    // Os ativos são status do contrato — nenhum inventado.
    for (const status of STATUS_ATIVOS_DO_CHAT) expect(STATUS_CHAT[status]).toBeTruthy();
  });

  it("sem histórico é um selo com motivo, e o tempo vira traço — nunca uma data inventada", () => {
    expect(fonte).toContain("{!c.ultimoEventoEm && (");
    expect(fonte).toContain("sem histórico");
    expect(fonte).toContain("<Traco titulo={MOTIVO_SEM_HISTORICO} />");
    expect(MOTIVO_SEM_HISTORICO).toContain("Nenhum evento registrado");
  });

  it("a prévia só sai se a API mandar; sem ela, o telefone e o porquê no title", () => {
    expect(fonte).toContain("const previa = c.ultimaMensagem");
    expect(fonte).toContain("{previa ? (");
    expect(fonte).toContain("title={MOTIVO_SEM_PREVIA}");
    expect(MOTIVO_SEM_PREVIA).toContain("A fila não traz a prévia");
    // O prefixo é quem falou: primeiro nome do cliente, ou quem respondeu.
    expect(fonte).toContain('previa.de === "cliente"');
    expect(fonte).toContain("primeiroNome(c.nome)");
    expect(fonte).toContain('(previa.quem ?? "Provedor")');
  });

  it("o quadrante só aparece quando a fila o traz — ausente não vira traço mudo", () => {
    expect(fonte).toContain("{c.quadrante !== undefined && <SeloQuadrante quadrante={c.quadrante} />}");
  });

  it("a contagem do título só existe se o servidor contar", () => {
    expect(fonte).toContain("{fila.data?.total !== undefined && (");
    expect(fonte).toContain('data-testid="fila-chat-total"');
    // Nada de derivar o número da página atual como se fosse o total.
    expect(fonte).not.toMatch(/itens\.length\}\s*<\/span>/);
    expect(fonte).not.toMatch(/total\s*\?\?\s*0/);
    // E a rota, hoje, realmente não conta: quem paginar com limit não sabe o total.
    expect(rota).not.toMatch(/atendimentos[\s\S]{0,400}?total:/);
  });
});

describe("tempoRelativo", () => {
  const agora = new Date("2026-09-06T12:00:00.000Z");
  const atras = (ms: number) => new Date(agora.getTime() - ms).toISOString();

  it("fala como a lista da referência: agora, min, h, d", () => {
    expect(tempoRelativo(atras(5_000), agora)).toBe("agora");
    expect(tempoRelativo(atras(3 * 60_000), agora)).toBe("há 3 min");
    expect(tempoRelativo(atras(5 * 3_600_000), agora)).toBe("há 5 h");
    expect(tempoRelativo(atras(31 * 86_400_000), agora)).toBe("há 31 d");
    expect(tempoRelativo(atras(400 * 86_400_000), agora)).toBe("há 1 a");
  });

  it("sem instante legível devolve null — quem chama desenha traço", () => {
    expect(tempoRelativo(null, agora)).toBeNull();
    expect(tempoRelativo(undefined, agora)).toBeNull();
    expect(tempoRelativo("não é data", agora)).toBeNull();
  });

  it("data no futuro não vira número negativo", () => {
    expect(tempoRelativo(new Date(agora.getTime() + 60_000).toISOString(), agora)).toBe("agora");
  });
});

describe("pele do DESIGN_SYSTEM v5", () => {
  it("selo retangular, raio até 8px, e o círculo só no avatar e no ponto do canal", () => {
    expect(fonte).not.toMatch(/rounded-(xl|2xl|3xl)/);
    const linhas = fonte.split("\n");
    linhas.forEach((linha, i) => {
      if (!linha.includes("rounded-full")) return;
      expect(linhas.slice(Math.max(0, i - 3), i + 1).join("\n"), `linha ${i + 1}`).toMatch(
        /aria-hidden|\/\/ avatar|<AvatarChat/,
      );
    });
  });

  it("tokens do projeto, nunca a paleta crua do Tailwind nem branco cravado", () => {
    expect(fonte).not.toMatch(
      /\b(bg|text|border|ring|from|to|via|divide|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/,
    );
    expect(fonte).not.toMatch(/\btext-white\b/);
    expect(fonte).toContain("var(--brand-soft)");
    expect(fonte).toContain("var(--text-muted)");
  });

  it("profundidade por anel de 1px, nunca sombra", () => {
    expect(fonte).toContain("shadow-[0_0_0_1px_var(--border)]");
    expect(fonte).not.toMatch(/\bshadow-(sm|md|lg|xl|2xl)\b/);
  });

  it("todo número em mono tabular", () => {
    expect(fonte).toContain("c.telefone && NUM_CHAT");
    expect(fonte).toContain("c.ultimoEventoEm && NUM_CHAT");
    expect(fonte).toContain("Página <span className={NUM_CHAT}>{pagina}</span>");
  });

  it("carregando é skeleton com os 300 ms, nunca a palavra", () => {
    expect(fonte).not.toMatch(/Carregando/);
    expect(fonte).toContain("useSkeletonAtrasado(fila.isPending)");
    expect(fonte).toContain("<SkeletonDaFila");
    expect(fonte).toContain("<LinhasSkeleton");
  });

  it("alvo de toque e anel de foco em tudo que se clica", () => {
    expect(fonte).toContain("FOCO_INTERNO,");
    expect(fonte).toMatch(/BOTAO_PAGINA = `\$\{ALVO_TEXTO\}[^`]*\$\{FOCO\}[^`]*\$\{DESABILITAVEL\}`/);
    expect(fonte).toMatch(/ALVO_CONTROLE,\s*FOCO,/);
  });
});
