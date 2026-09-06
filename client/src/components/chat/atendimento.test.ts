/**
 * O atendimento do chat, travado pelo texto da fonte — o vitest deste projeto
 * não coleta `.tsx` (sem DOM), então, como em `pages/cobranca/telas.test.ts`,
 * o que se prova é a montagem: o "Encerrar" passa pelo diálogo de follow-up,
 * o "Enviar" carrega a próxima ação opcional, o "Devolver ao assistente"
 * chama a rota da autonomia, e a pele é a do DESIGN_SYSTEM v5.
 *
 * A lógica pura (`encerrarDispensaFollowUp`, `rotaChat`) é provada direto.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ACAO_PADRAO_APOS_RESPOSTA,
  ACOES_COMUNS_DO_CHAT,
  API_AUTONOMIA,
  JANELA_WHATSAPP_MS,
  MOTIVO_JANELA_DESCONHECIDA,
  MOTIVO_SEM_JANELA_DE_CONTATO,
  encerrarDispensaFollowUp,
  faixaDeContato,
  janelaDaConversa,
} from "./tipos";

const ler = (nome: string) => readFileSync(join(__dirname, nome), "utf8");
/** A fonte sem comentário — o que a tela realmente executa. */
const executavel = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const fonte = executavel(ler("Atendimento.tsx"));

describe("encerrar passa pelo follow-up", () => {
  it("o diálogo existe, com ação e data obrigatórias e os chips das ações comuns", () => {
    expect(fonte).toContain('data-testid="dialogo-followup-chat"');
    expect(fonte).toContain('data-testid="followup-chat-acao"');
    expect(fonte).toContain('data-testid="followup-chat-quando"');
    expect(fonte).toContain('type="datetime-local"');
    // As ações comuns vêm de um lugar só: o diálogo de contato da cobrança, mais as do chat.
    expect(fonte).toMatch(/import \{ PROXIMAS_ACOES_COMUNS \} from "@\/components\/cobranca\/DialogoContato"/);
    expect(fonte).toContain("[...ACOES_COMUNS_DO_CHAT, ...PROXIMAS_ACOES_COMUNS]");
    // O botão de confirmar não habilita sem os dois.
    expect(fonte).toMatch(/const semFollowUp = !proximaAcao\.trim\(\) \|\| !proximoContatoEm/);
    expect(fonte).toMatch(/disabled=\{pendente \|\| semFollowUp\}/);
  });
  it("o encerrar da tela abre o diálogo, e só encerra direto quando não há onde gravar", () => {
    expect(fonte).toContain('data-testid="chat-encerrar"');
    expect(fonte).toMatch(/if \(encerrarDispensaFollowUp\(c\)\) acao\.mutate\(\{ acao: "encerrar" \}\);\s*else setEncerrando\(true\)/);
    // O que o diálogo confirma vai inteiro no corpo da ação.
    expect(fonte).toContain('acao.mutate({ acao: "encerrar", ...followUp })');
    // A data é validada aqui também: `min` só segura quem usa o seletor.
    expect(fonte).toMatch(/validarProximoContato\(proximoContatoEm, new Date\(\)\)/);
    expect(fonte).toMatch(/deInputDataHora\(proximoContatoEm\)/);
  });
  it("encerrarDispensaFollowUp: sem caso ou caso fechado; caso vivo exige", () => {
    expect(encerrarDispensaFollowUp(null)).toBe(true);
    expect(encerrarDispensaFollowUp(undefined)).toBe(true);
    for (const status of ["pago", "baixado", "encerrado", "cancelamento"]) expect(encerrarDispensaFollowUp({ status })).toBe(true);
    for (const status of ["aberto", "em_contato", "negociando", "acordo_ativo", "negativado"]) expect(encerrarDispensaFollowUp({ status })).toBe(false);
  });
});

describe("enviar leva a próxima ação opcional", () => {
  it("campo recolhido, com o padrão anunciado e a data validada antes de enviar", () => {
    expect(fonte).toContain('data-testid="chat-followup-envio-abrir"');
    expect(fonte).toContain('data-testid="chat-followup-envio-acao"');
    expect(fonte).toContain('data-testid="chat-followup-envio-quando"');
    expect(fonte).toContain("{followUpEnvio.aberto && (");
    expect(fonte).toContain("placeholder={ACAO_PADRAO_APOS_RESPOSTA}");
    expect(ACAO_PADRAO_APOS_RESPOSTA).toBe("Aguardar resposta do cliente");
    expect(ACOES_COMUNS_DO_CHAT).toContain(ACAO_PADRAO_APOS_RESPOSTA);
    expect(fonte).toMatch(/validarProximoContato\(\s*followUpEnvio\.proximoContatoEm,\s*new Date\(\),?\s*\)/);
    // Só o que foi preenchido vai; o padrão é do servidor, não inventado aqui.
    expect(fonte).toMatch(/\.\.\.\(followUpEnvio\.proximaAcao\.trim\(\)\s*\? \{ proximaAcao: followUpEnvio\.proximaAcao\.trim\(\) \}\s*: \{\}\)/);
    expect(fonte).toMatch(/\.\.\.\(proximoContatoEm \? \{ proximoContatoEm \} : \{\}\)/);
  });
});

describe("devolver ao assistente", () => {
  it("chama a rota da autonomia e fica desabilitado, com o motivo, quando o assistente está desligado", () => {
    expect(API_AUTONOMIA).toBe("/api/chat-bullq/autonomia");
    expect(fonte).toContain("`${API_AUTONOMIA}/conversas/${encodeURIComponent(conversationId)}/devolver`");
    expect(fonte).toContain('data-testid="chat-devolver-assistente"');
    expect(fonte).toMatch(/const assistenteLigado = autonomia\.data\?\.config\?\.ativa === true/);
    expect(fonte).toMatch(/disabled=\{\s*!assistenteLigado \|\| devolver\.isPending \|\| acao\.isPending\s*\}/);
    expect(fonte).toContain('const MOTIVO_ASSISTENTE_DESLIGADO = "assistente desligado"');
    // A rota pode não existir nesta instalação: 404 vira o mesmo motivo, nunca um erro genérico.
    expect(fonte).toMatch(/\.status === 404\s*\? `\$\{MOTIVO_ASSISTENTE_DESLIGADO\}/);
    // O estado é lido sem retry: a rota ausente não pode ficar martelando.
    expect(fonte).toMatch(/queryKey: \[API_AUTONOMIA\],[\s\S]*?retry: false/);
  });
});

describe("pele do DESIGN_SYSTEM v5", () => {
  it("botão e campo vêm das primitivas; nada de pílula, raio acima de 8px, branco cravado ou --past em ação", () => {
    expect(fonte).toMatch(/BOTAO_SECUNDARIO,[\s\S]*?CONTROLE_CAMPO,[\s\S]*?\} from "@\/components\/painel\/ui"/);
    expect(fonte).toContain("BOTAO_CHAT_MARCA");
    expect(fonte).not.toContain("rounded-full");
    expect(fonte).not.toContain("rounded-3xl");
    expect(fonte).not.toMatch(/rounded-(xl|2xl)/);
    expect(fonte).not.toContain("text-white");
    expect(fonte).not.toContain("bg-[var(--past)]");
    expect(fonte).not.toMatch(/shadow-(sm|md|lg|xl)/);
    expect(fonte).not.toMatch(/\b(?:bg|text|border)-(?:slate|gray|zinc|neutral|blue|emerald|green|red|amber|yellow|indigo|violet|purple)-\d{2,3}\b/);
  });
  it("todo número em mono tabular; o avatar é o neutro do chat", () => {
    expect(fonte).toContain("NUM_CHAT");
    expect(fonte).toMatch(/<span className=\{NUM_CHAT\}>\{hora\(m\.em\)\}<\/span>/);
    expect(fonte).toMatch(/<span className=\{NUM_CHAT\}>\{texto\.length\}\/2000<\/span>/);
    expect(fonte).toContain("<AvatarChat nome={nomeDoCliente}");
  });
  it("carregando é skeleton (após 300 ms), nunca texto", () => {
    expect(fonte).not.toMatch(/Carregando/);
    expect(fonte).toContain("useSkeletonAtrasado(!dados && !query.isError)");
    expect(fonte).toMatch(/mostrarSkeleton \? \([\s\S]*?<Skeleton className=/);
  });
});

/* ── O porte do Provedor.ai: cabeçalho, balões e rodapé ───────────────── */

describe("a janela de 24 h do WhatsApp é honesta", () => {
  const agora = new Date("2026-09-06T12:00:00.000Z");
  const msg = (direcao: string, em: string) => ({ direcao, em });

  it("com recebimento recente: aberta, e o motivo explica por quê", () => {
    const j = janelaDaConversa([msg("OUTBOUND", "2026-09-06T09:00:00.000Z"), msg("INBOUND", "2026-09-06T11:00:00.000Z")], agora);
    expect(j).not.toBeNull();
    expect(j!.aberta).toBe(true);
    expect(j!.ultimoRecebimentoEm).toBe("2026-09-06T11:00:00.000Z");
    expect(j!.motivo).toContain("menos de 24 h");
  });

  it("com recebimento antigo: fechada, e o motivo fala em template", () => {
    const j = janelaDaConversa([msg("INBOUND", "2026-09-04T11:00:00.000Z")], agora);
    expect(j!.aberta).toBe(false);
    expect(j!.motivo).toContain("template");
  });

  it("sem recebimento, mas com histórico velho: fechada com certeza — nada seria mais novo", () => {
    const j = janelaDaConversa([msg("OUTBOUND", "2026-09-01T11:00:00.000Z"), msg("OUTBOUND", "2026-09-02T11:00:00.000Z")], agora);
    expect(j!.aberta).toBe(false);
    expect(j!.ultimoRecebimentoEm).toBeNull();
  });

  it("sem recebimento e com histórico recente: DESCONHECIDA — null, nunca 'aberta' por otimismo", () => {
    expect(janelaDaConversa([msg("OUTBOUND", "2026-09-06T11:30:00.000Z")], agora)).toBeNull();
    expect(janelaDaConversa([], agora)).toBeNull();
    // Data ilegível não vira janela: entra como se não existisse.
    expect(janelaDaConversa([msg("INBOUND", "sem data")], agora)).toBeNull();
  });

  it("o limite é o das 24 h do WhatsApp, no milissegundo", () => {
    expect(JANELA_WHATSAPP_MS).toBe(24 * 60 * 60 * 1000);
    const limite = new Date(agora.getTime() - JANELA_WHATSAPP_MS).toISOString();
    expect(janelaDaConversa([msg("INBOUND", limite)], agora)!.aberta).toBe(false);
    const dentro = new Date(agora.getTime() - JANELA_WHATSAPP_MS + 1000).toISOString();
    expect(janelaDaConversa([msg("INBOUND", dentro)], agora)!.aberta).toBe(true);
  });

  it("o cabeçalho escreve os três estados, com o motivo no title", () => {
    expect(fonte).toContain('data-testid="chat-janela"');
    expect(fonte).toContain("const janela = janelaDaConversa(mensagens)");
    expect(fonte).toContain("title={janela?.motivo ?? MOTIVO_JANELA_DESCONHECIDA}");
    expect(fonte).toContain('"janela —"');
    expect(fonte).toContain('"janela aberta · 24h"');
    expect(fonte).toContain('"janela fechada · só template"');
    // Cor semântica, nunca a paleta crua do Tailwind.
    expect(fonte).toContain("text-[var(--ok)]");
    expect(fonte).toContain("text-[var(--past)]");
    expect(MOTIVO_JANELA_DESCONHECIDA).toContain("não dá para saber");
  });
});

describe("cabeçalho da conversa no porte da referência", () => {
  it("nome, selo de estado, quadrante, telefone, canal e janela — e o Cliente 360", () => {
    expect(fonte).toContain('testId="chat-selo-estado"');
    expect(fonte).toContain("tom={TOM_DO_STATUS_CHAT[dados.conversa.status] ?? \"neutro\"}");
    expect(fonte).toContain('testId="chat-selo-quadrante"');
    expect(fonte).toContain("<SeloQuadrante");
    expect(fonte).toContain('data-testid="chat-cabecalho-360"');
    // O quadrante só aparece quando há caso de cobrança: sem caso não há DNA a mostrar.
    expect(fonte).toMatch(/\{c && \(\s*<SeloQuadrante/);
  });
});

describe("balões de mensageiro", () => {
  it("o dia separa, o autor abre o grupo e a hora é mono tabular", () => {
    expect(fonte).toContain('data-testid="chat-balao"');
    expect(fonte).toContain("const GRUPO_JANELA_MS = 5 * 60_000");
    expect(fonte).toContain("rotuloDoDia");
    expect(fonte).toContain('return "Hoje"');
    expect(fonte).toContain('return "Ontem"');
    expect(fonte).toMatch(/const novoGrupo =[\s\S]*?anterior\.direcao !== m\.direcao[\s\S]*?dentroDaJanelaDeGrupo\(anterior\.em, m\.em\)/);
    expect(fonte).toContain("{novoGrupo && (");
    // Agrupamento aperta o espaço; grupo novo respira.
    expect(fonte).toContain('novoGrupo ? "mt-3" : "mt-0.5"');
  });

  it("a situação do envio é a que o servidor mandou — nenhum recibo inventado", () => {
    for (const s of ["SENT", "DELIVERED", "READ", "QUEUED", "FAILED", "RECEIVED", "PENDING"])
      expect(fonte).toContain(`${s}:`);
    expect(fonte).toContain("[m.status] ?? m.status");
  });
});

describe("rodapé honesto do compositor", () => {
  it("a janela de contato vem da política; sem política é traço com motivo", () => {
    expect(fonte).toContain('data-testid="chat-rodape-politica"');
    expect(fonte).toContain("const faixaDeHorario = faixaDeContato(politica.data?.janelaContato)");
    expect(fonte).toMatch(/faixaDeHorario \? \([\s\S]*?\) : \(\s*<Traco titulo=\{MOTIVO_SEM_JANELA_DE_CONTATO\} \/>/);
    expect(fonte).toContain("title={AVISO_CDC_42}");
    expect(fonte).toContain("CDC 42");
    // A política é lida sempre — o rodapé existe fora do diálogo de parcelamento.
    expect(fonte).not.toContain("enabled: negociar");
    expect(MOTIVO_SEM_JANELA_DE_CONTATO).toContain("não foi lida");
  });

  it("faixaDeContato: sem janela, null; com janela, a faixa do provedor", () => {
    expect(faixaDeContato(null)).toBeNull();
    expect(faixaDeContato(undefined)).toBeNull();
    expect(faixaDeContato({ horaInicio: 8, horaFim: 20 })).toBe("8–20h");
    expect(faixaDeContato({ horaInicio: 9, horaFim: 18 })).toBe("9–18h");
    expect(faixaDeContato({ horaInicio: Number.NaN, horaFim: 20 })).toBeNull();
  });

  it("os atalhos do compositor continuam sendo PIX / 2ª via, Parcelar e Cliente 360", () => {
    expect(fonte).toContain("Enviar PIX / 2ª via");
    expect(fonte).toContain("Parcelar");
    expect(fonte).toContain("Cliente 360");
  });
});

describe("o painel do cliente é a terceira coluna", () => {
  it("~360px, rolando por si, e sobreposto abaixo de xl", () => {
    expect(fonte).toMatch(/xl:w-\[344px\][^"]*2xl:w-\[360px\]/);
    expect(fonte).toContain("overflow-y-auto");
    expect(fonte).toContain('mostrarContexto ? "absolute inset-0 z-20" : "hidden"');
  });
});
