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
import { ACAO_PADRAO_APOS_RESPOSTA, ACOES_COMUNS_DO_CHAT, API_AUTONOMIA, encerrarDispensaFollowUp } from "./tipos";

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
    expect(fonte).toMatch(/<span className=\{NUM_CHAT\}>\{dataHora\(m\.em\)\}<\/span>/);
    expect(fonte).toMatch(/<span className=\{NUM_CHAT\}>\{texto\.length\}\/2000<\/span>/);
    expect(fonte).toContain("<AvatarChat nome={nomeDoCliente}");
  });
  it("carregando é skeleton (após 300 ms), nunca texto", () => {
    expect(fonte).not.toMatch(/Carregando/);
    expect(fonte).toContain("useSkeletonAtrasado(!dados && !query.isError)");
    expect(fonte).toMatch(/mostrarSkeleton \? \([\s\S]*?<Skeleton className=/);
  });
});
