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
/** As primitivas da conversa (balão, cabeçalho do autor, recibo, faixa, atalho) moram aqui desde o porte de 17/09/2026. */
const ui = executavel(ler("ConversaUi.tsx"));

describe("WhatsApp permanece como compositor principal", () => {
  it("ações de SMS e e-mail abrem diálogos sem trocar o canal do compositor", () => {
    const complementar = executavel(ler("MulticanalDaConversa.tsx"));
    expect(fonte).not.toContain("setCanal");
    expect(fonte).not.toContain('aria-label="Canal de envio"');
    expect(fonte).toContain('aria-label="Ações complementares da conversa"');
    expect(fonte).toContain('data-testid="chat-enviar"');
    expect(fonte).toContain("WhatsApp do provedor · atendimento humano");
    expect(complementar).toContain("<Dialog open={aberto} onOpenChange={setAberto}>");
    expect(complementar).toContain('data-testid={`chat-abrir-${canal}`}');
    expect(complementar).toContain('data-testid={`chat-dialogo-${canal}`}');
  });
});

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
    expect(fonte).toContain("`${API_AUTONOMIA}/conversas/${encodeURIComponent(conversationId)}/devolver?${escopo}`");
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
    // A hora de cada balão sai de horaDaMensagem e é desenhada em mono pela meta do balão.
    expect(fonte).toContain("const hora = horaDaMensagem(m.em)");
    expect(fonte).toMatch(/<MetaDoBalao\s+hora=\{hora\}/);
    expect(ui).toContain("{hora && <span className={NUM_CHAT}>{hora}</span>}");
    expect(fonte).toMatch(/<span className=\{NUM_CHAT\}>\{texto\.length\}\/2000<\/span>/);
    expect(fonte).toContain("<AvatarChat nome={nomeDoCliente}");
  });
  it("carregando é skeleton (após 300 ms), nunca texto", () => {
    expect(fonte).not.toMatch(/Carregando/);
    expect(fonte).toContain("useSkeletonAtrasado(!dados && !query.isError)");
    expect(fonte).toMatch(/mostrarSkeleton \? \([\s\S]*?<SkeletonDaConversa \/>/);
    // A forma da conversa — cabeçalho e balões — com o Skeleton do shadcn.
    expect(ui).toMatch(/export function SkeletonDaConversa\(\)[\s\S]*?<Skeleton className=/);
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
    expect(fonte).toContain("const janela = janelaDaConversa(mensagensWhatsapp)");
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

describe("balões de mensageiro no porte do Provedor.ai", () => {
  it("a corrida abre e fecha pela regra pura; o autor só abre a corrida de saída", () => {
    // A regra (mesma voz, direção, canal, cinco minutos) é provada em conversa.test.ts.
    expect(fonte).toContain("const inicioCorrida = !anterior || !mesmaCorrida(anterior, m)");
    expect(fonte).toContain("const fimCorrida = !proxima || !mesmaCorrida(m, proxima)");
    expect(fonte).toMatch(/autor !== "cliente" && inicioCorrida \? \(\s*<CabecalhoDoAutor/);
    // Um chip de dia só, no topo, calculado da primeira mensagem carregada — sem régua no meio.
    expect(fonte).toContain("const diaDoTopo = chipDoDia(mensagens[0])");
    expect(fonte).toContain('data-testid="chat-dia"');
    expect(fonte).not.toContain("novoDia");
    // Corrida nova respira 10px; dentro dela, 2px. A cauda só no último balão.
    expect(ui).toContain('inicioCorrida ? "mt-2.5" : "mt-0.5"');
    expect(ui).toContain("{fimCorrida && <CaudaDoBalao saida={saida} />}");
    expect(ui).toContain('data-testid={pendente ? "chat-balao-enviando" : "chat-balao"}');
    // Balão com 8px de raio: a referência usa 12px, o DESIGN_SYSTEM não passa de 8px.
    expect(ui).toMatch(/relative max-w-\[68%\][^"]*rounded-lg/);
    expect(ui).not.toMatch(/rounded-(xl|2xl|3xl)/);
    expect(ui).not.toMatch(/shadow-(sm|md|lg|xl)/);
  });

  it("a funcionária digital aparece com o nome e o selo IA; a conta do provedor, com EQUIPE — nunca 'humano' chutado", () => {
    expect(ui).toContain('data-testid={`chat-autor-${autor}`}');
    expect(ui).toMatch(/autor === "funcionaria" \? \(\s*<span[\s\S]*?>\s*IA\s*<\/span>/);
    expect(ui).toMatch(/Equipe\s*<\/span>/);
    expect(ui).not.toMatch(/HUMANO|Humano/);
    // O sinal é o agente gravado pelo fork, não o nome.
    expect(fonte).toContain("const autor = autorDaMensagem(m)");
  });

  it("a situação do envio é a que o servidor mandou — nenhum recibo inventado", () => {
    expect(fonte).toContain("rotulo={rotuloDoStatus(m.status)}");
    // Status fora da tabela não vira tique: sai por extenso.
    expect(ui).toMatch(/const recibo = saida \? reciboDoStatus\(status\) : null/);
    expect(ui).toMatch(/\) : saida \? \(\s*<span>· \{rotulo\}<\/span>/);
  });

  it("o envio é otimista: o campo limpa, o balão sai com o relógio e o texto volta se falhar", () => {
    expect(fonte).toMatch(/acao\.isPending && variaveis\?\.acao === "enviar" \? variaveis\.texto : null/);
    expect(fonte).toMatch(/<BalaoDaConversa\s+saida\s+pendente/);
    expect(fonte).toMatch(/status="QUEUED"/);
    expect(fonte).toMatch(/setUltimoEnvio\("falhou"\);[\s\S]*?setTexto\(\(atual\) =>/);
  });
});

describe("o compositor no porte do Provedor.ai", () => {
  it("faixas no topo: o aviso do canal que a página manda, o 'assuma', a política, o multicanal e a falha de envio", () => {
    expect(fonte).toMatch(/<form[\s\S]*?\{avisoDoCanal\}[\s\S]*?testId="chat-aviso-assumir"/);
    expect(fonte).toContain("Assuma o atendimento para continuar a conversa.");
    expect(fonte).toContain("Primeiro contato realizado. A resposta do cliente será encaminhada à equipe.");
    expect(fonte).toContain('testId="chat-erro-envio"');
    // A falha some quando o atendente volta a escrever.
    expect(fonte).toMatch(/if \(erroEnvio\) setErroEnvio\(null\)/);
  });

  it("linha de entrada: emoji, mensagens rápidas (preenchem, não enviam), campo, enviar; Enter envia", () => {
    expect(fonte).toContain('aria-label="Emojis"');
    expect(fonte).toContain('aria-label="Mensagens rápidas"');
    expect(fonte).toContain("inserirNoCampo(r.texto, true)");
    expect(fonte).toMatch(/teclaEnviaMensagem\(\{[\s\S]*?\}\)\s*\)\s*\{\s*e\.preventDefault\(\);\s*enviar\(\);/);
    // No toque não há Shift: o ponteiro é lido na hora da tecla, e lá o Enter quebra a linha.
    expect(fonte).toMatch(/teclaEnviaMensagem\(\{[^}]*ponteiroFino: ponteiroPrincipalFino\(\),\s*\}\)/);
    expect(fonte).toContain('window.matchMedia("(pointer: fine)").matches');
    // A grade de emojis cresce para o dedo (alvo de 44px) e é um grupo para o leitor de tela.
    expect(fonte).toContain('role="group" className="grid grid-cols-8 gap-0.5 [@media(pointer:coarse)]:grid-cols-6" aria-label="Emojis"');
    expect(fonte).toMatch(/grid h-7 place-items-center[^"]*\[@media\(pointer:coarse\)\]:h-11/);
    // Sem canal que não existe: nada de anexo, áudio ou template HSM no compositor.
    expect(fonte).not.toMatch(/Paperclip|\bMic\b|Template HSM/);
  });

  it("Enter durante uma operação pendente nunca some em silêncio: o envio vai à fila, o resto avisa", () => {
    // O retorno mudo de antes: o Enter chamava preventDefault e o enviar() voltava sem dizer nada.
    expect(fonte).not.toMatch(/if \(!texto\.trim\(\) \|\| acao\.isPending/);
    expect(fonte).toMatch(/if \(acao\.isPending\) \{\s*setEspera\(esperaDoEnvio\(acao\.variables\)\);\s*return;\s*\}/);
    // Quando a operação volta, a fila anda — só com o envio anterior aceito (regra pura em conversa.ts).
    expect(fonte).toMatch(/const segue = filaDoEnvioSegue\(espera, ultimoEnvio\);\s*setEspera\(null\);\s*if \(segue\) enviar\(\);/);
    expect(fonte).toContain("}, [espera, acao.isPending]);");
    // Escrever depois do Enter tira da fila; trocar de conversa zera.
    expect(fonte).toContain("if (espera) setEspera(null);");
    expect(fonte).toMatch(/setUltimoEnvio\(null\);\s*setEspera\(null\);/);
    // A região viva existe sempre e diz o que está acontecendo.
    expect(fonte).toMatch(/<span role="status"[^>]*data-testid="chat-envio-espera">\s*\{espera \? ` · \$\{TEXTO_DA_ESPERA\[espera\]\}` : ""\}/);
  });

  it("o âmbar nunca pinta texto no atendimento: vai ao ícone, e o texto fica em --text-2", () => {
    // --gated (#A9741B) fica em ~4:1 sobre branco — abaixo de AA para texto de 10 a 12px.
    const linhas = fonte.split("\n").filter((l) => l.includes("text-[var(--gated)]"));
    expect(linhas.length).toBeGreaterThan(0);
    for (const linha of linhas) expect(linha, linha.trim()).toContain("aria-hidden");
    expect(fonte).toMatch(/<HeartHandshake aria-hidden className="h-3 w-3 shrink-0 text-\[var\(--gated\)\]" \/>\s*Tom acolhedor · sem pressão/);
    expect(fonte).toMatch(/<HeartHandshake aria-hidden[^>]*text-\[var\(--gated\)\][^>]*\/>\{" "\}\s*tom acolhedor/);
    expect(fonte).toMatch(/<AlertCircle aria-hidden[^>]*text-\[var\(--gated\)\][^>]*\/>\s*caso sem próxima ação — parado na fila/);
    // O traço da janela desconhecida é texto que se lê: --text-muted, nunca --text-faint.
    expect(fonte).toMatch(/janela === null\s*\?\s*"text-\[var\(--text-muted\)\]"/);
  });

  it("no celular os atalhos ficam numa linha que rola de lado, e o nome do canal só aparece de sm para cima", () => {
    expect(fonte).toContain(
      'className="-m-1 mb-1.5 flex gap-[7px] overflow-x-auto p-1 [&>*]:shrink-0 sm:m-0 sm:mb-2.5 sm:flex-wrap sm:overflow-visible sm:p-0"',
    );
    expect(fonte).toContain('<span className="hidden sm:inline">WhatsApp do provedor · atendimento humano</span>');
  });

  it("rodapé Sessão → Envio com o estado real e a janela de contato da política", () => {
    expect(fonte).toContain('testId="chat-rodape-sessao"');
    expect(fonte).toContain('testId="chat-rodape-envio"');
    expect(fonte).toContain('"Sessão · —"');
    expect(fonte).toContain('"Envio · falhou"');
    // Verde só com envio aceito — conversa OPEN não confirma canal nenhum.
    expect(fonte).toContain("estado={estadoDoEnvio}");
    expect(fonte).not.toMatch(/emAtendimento\s*\?\s*"ok"/);
    // A janela de contato é texto que se lê: nada de --text-faint abaixo de AA.
    expect(fonte).toContain('className="ml-auto flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] max-sm:gap-1 max-sm:whitespace-nowrap"');
  });
});

describe("rodapé honesto do compositor", () => {
  it("a janela de contato vem da política; sem política é traço com motivo", () => {
    expect(fonte).toContain('data-testid="chat-rodape-politica"');
    // Lida da política JÁ convertida: o cache guarda a resposta crua do GET (a mesma
    // chave do 360, do kanban e da aba Cobrança) — ver atendimento-politica.test.ts.
    expect(fonte).toContain("const faixaDeHorario = faixaDeContato(politicaLida?.janelaContato)");
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
  it("360px, rolando por si, e sobreposto abaixo de 1400px", () => {
    // A coluna do cliente da referência: minmax(280px, 360px), fixa no máximo. Ao lado da
    // barra lateral de 248px, é a partir de 1400px que a conversa fica com mais de 480px.
    expect(fonte).toMatch(/min-\[1400px\]:static min-\[1400px\]:block min-\[1400px\]:w-\[360px\] min-\[1400px\]:border-l/);
    expect(fonte).toContain('"h-full min-[1400px]:flex-row"');
    expect(fonte).toContain('cn(BOTAO_SECUNDARIO, "min-[1400px]:hidden")');
    expect(fonte).toContain("linkDo360={link360}");
    expect(fonte).toContain("overflow-y-auto");
    expect(fonte).toContain('mostrarContexto ? "absolute inset-0 z-20" : "hidden"');
  });
});


describe("isolamento da carteira no atendimento", () => {
  it("inclui escopo no cache e em todas as operações da conversa", () => {
    expect(fonte).toContain('new URLSearchParams({ origem, ...(carteira ? { carteira } : {}) })');
    expect(fonte).toContain('queryKey: [url, escopo]');
    expect(fonte).toContain('`${url}/contexto?${escopo}');
    expect(fonte).toContain('`${url}?${escopo}&pagina=');
    expect(fonte).toContain('`${url}/acoes?${escopo}');
    expect(fonte).toContain('/midia?${escopo}&pagina=');
    expect(fonte).toContain('escopo={escopo}');
  });
});

describe("a releitura de fundo que falha não derruba a conversa (correção 3)", () => {
  it("o retorno cedo é só sem dado; com dado e erro, a conversa fica com o aviso e as travas de envio", () => {
    expect(fonte).toMatch(/if \(!dados\)\s*return \(/);
    expect(fonte).not.toContain("if (!dados || query.isError)");
    // O aviso de histórico desatualizado mora na conversa carregada, como alerta.
    expect(fonte).toMatch(/\{query\.isError && \(\s*<p role="alert"[\s\S]*?O histórico pode estar desatualizado/);
    // As travas por erro, que o retorno cedo tornava letra morta: o enviar(), o botão e o multicanal.
    expect(fonte).toMatch(/const enviar = \(\) => \{\s*if \(!texto\.trim\(\) \|\| query\.isError\) return;/);
    expect(fonte).toContain("bloqueado={multicanal.isError || query.isError}");
  });
});

describe("o botão Enviar é o mesmo caminho do Enter (correção 3)", () => {
  const fim = fonte.indexOf('data-testid="chat-enviar"');
  const botao = fim < 0 ? "" : fonte.slice(fonte.lastIndexOf("<button", fim), fim);

  it("não trava com a operação em andamento: submete o formulário, e o enviar() põe na fila ou avisa", () => {
    expect(botao).not.toBe("");
    expect(botao).toContain("disabled={!emAtendimento || !texto.trim() || query.isError}");
    expect(botao).not.toContain("acao.isPending");
    // O submit do formulário é o enviar() — o mesmo do Enter, com a fila e o aviso da espera.
    expect(fonte).toMatch(/<form[\s\S]*?onSubmit=\{\(e\) => \{\s*e\.preventDefault\(\);\s*enviar\(\);\s*\}\}/);
    expect(fonte).toMatch(/if \(acao\.isPending\) \{\s*setEspera\(esperaDoEnvio\(acao\.variables\)\);\s*return;\s*\}/);
    // O botão não diz "Enviando…" enquanto aceita um envio: o estado está na pílula e na região viva.
    expect(botao).toContain('aria-label="Enviar"');
  });
});

describe("o cabeçalho no celular (correção 3)", () => {
  const painel = readFileSync(join(__dirname, "..", "painel", "ui.tsx"), "utf8");
  const cabecalho = fonte.slice(fonte.indexOf("<header"), fonte.indexOf("</header>"));
  const menu = cabecalho.slice(cabecalho.indexOf("<DropdownMenuContent"), cabecalho.indexOf("</DropdownMenuContent>"));
  const fora = cabecalho.replace(menu, "");

  it("as ações secundárias vão ao menu 'Mais ações' abaixo de sm, com alvo de 44px e foco visível", () => {
    expect(menu).not.toBe("");
    expect(fonte).toMatch(/import \{\s*DropdownMenu,\s*DropdownMenuContent,\s*DropdownMenuItem,\s*DropdownMenuTrigger,\s*\} from "@\/components\/ui\/dropdown-menu"/);
    expect(cabecalho).toMatch(/<DropdownMenuTrigger asChild>\s*<button\s+type="button"\s+className=\{cn\(BOTAO_SECUNDARIO, CAIXA_ICONE, "sm:hidden"\)\}\s+aria-label="Mais ações"/);
    // CAIXA_ICONE dá 44x44 no toque; BOTAO_SECUNDARIO traz o anel de foco.
    expect(painel).toContain('export const ALVO_CONTROLE = "min-h-[36px] [@media(pointer:coarse)]:min-h-11"');
    expect(painel).toMatch(/export const CAIXA_ICONE = `\$\{ALVO_CONTROLE\}[^`]*\[@media\(pointer:coarse\)\]:w-11`/);
    expect(painel).toMatch(/export const BOTAO_SECUNDARIO = `[^`]*\$\{ALVO_CONTROLE\}[^`]*\$\{FOCO\}/);
    // Cada item: o mesmo alvo e o anel por dentro — o fundo de destaque do Radix não é anel visível.
    expect(fonte).toContain('const ITEM_DO_MENU = cn(ALVO_CONTROLE, "gap-2 text-[13px]", FOCO_INTERNO);');
    expect(menu.match(/<DropdownMenuItem\s+className=\{ITEM_DO_MENU\}/g)).toHaveLength(2);
    expect(menu).toMatch(/onSelect=\{pedirEncerrar\}[\s\S]*?Encerrar conversa/);
    expect(menu).toMatch(/onSelect=\{atualizarMensagens\}[\s\S]*?Atualizar mensagens/);
    // As versões em linha das mesmas ações somem no celular.
    expect(fora).toMatch(/className=\{cn\(BOTAO_SECUNDARIO, "max-sm:hidden"\)\}\s+disabled=\{acao\.isPending\}\s+onClick=\{pedirEncerrar\}/);
    expect(fora).toMatch(/className=\{cn\(BOTAO_SECUNDARIO, CAIXA_ICONE, "max-sm:hidden"\)\}\s+onClick=\{atualizarMensagens\}/);
    // O menu não é modal: o "Encerrar" abre o diálogo do follow-up, que prende o foco.
    expect(cabecalho).toContain("<DropdownMenu modal={false}>");
  });

  it("'Dados do caso' e a ação principal (tomar/reabrir ou devolver) ficam fora do menu e visíveis no celular", () => {
    for (const trecho of ['data-testid="chat-assumir"', 'data-testid="chat-devolver-assistente"', "Dados do caso"]) {
      expect(fora, trecho).toContain(trecho);
      expect(menu, trecho).not.toContain(trecho);
    }
    const tagDoBotao = (marca: string) => fora.slice(fora.lastIndexOf("<button", fora.indexOf(marca)), fora.indexOf(marca));
    expect(tagDoBotao('data-testid="chat-assumir"')).not.toContain("hidden");
    expect(tagDoBotao('data-testid="chat-devolver-assistente"')).not.toContain("hidden");
    expect(tagDoBotao("Dados do caso")).toContain('cn(BOTAO_SECUNDARIO, "min-[1400px]:hidden")');
    // O rótulo encurta no celular para a linha caber; o inteiro volta de sm para cima.
    expect(fora).toContain('<span className="sm:hidden">Devolver</span>');
    expect(fora).toContain('<span className="max-sm:hidden">Devolver ao assistente</span>');
    expect(fora).toContain('<span className="sm:hidden">Reabrir</span>');
    expect(fora).toContain('<span className="max-sm:hidden">Reabrir atendimento</span>');
  });

  it("o follow-up fica numa linha só no celular, truncada, com o texto inteiro no title", () => {
    expect(cabecalho).toMatch(/className="mt-0\.5 text-xs text-\[var\(--text-muted\)\] max-sm:truncate"\s+title=\{followUpPorExtenso\}\s+data-testid="atendimento-followup-atual"/);
    expect(fonte).toContain('`próxima ação: ${c.proximaAcao} · ${dataHoraBr(c.proximoContatoEm)} · ${c.responsavel ?? "sem dono"}`');
    expect(fonte).toContain(': "caso sem próxima ação — parado na fila"');
  });

  it("o resto do recolhimento é só abaixo de sm: nome e selos numa linha, o canal para o leitor de tela, a volta no cabeçalho", () => {
    expect(cabecalho).toContain("px-5 py-3 max-sm:gap-y-1.5 max-sm:py-2");
    expect(cabecalho).toContain('className="flex flex-wrap items-center gap-2 max-sm:flex-nowrap"');
    expect(cabecalho).toContain('<span className="font-medium text-[var(--text-2)] max-sm:sr-only">WhatsApp</span>');
    // A volta às conversas: botão de ícone (44px no toque, com anel de foco) no lugar do avatar, só no celular.
    expect(cabecalho).toMatch(/\{aoVoltar && \(\s*<button\s+type="button"\s+className=\{cn\(BOTAO_ICONE_COMPOSITOR, "-ml-2 text-\[var\(--text-2\)\] sm:hidden"\)\}\s+onClick=\{aoVoltar\}\s+aria-label="Voltar às conversas"/);
    expect(cabecalho).toContain('<AvatarChat nome={nomeDoCliente} className={cn("h-10 w-10 text-sm", aoVoltar && "max-sm:hidden")} />');
    expect(ui).toMatch(/export const BOTAO_ICONE_COMPOSITOR = cn\([\s\S]*?CAIXA_ICONE,\s*FOCO,/);
    // Carregando ou com erro não há cabeçalho: a volta fica no topo, para a tela nunca virar beco.
    expect(fonte).toMatch(/data-testid="atendimento-carregando"\s*>\s*\{aoVoltar && \(/);
  });

  it("o rodapé no celular: as pílulas numa linha que rola, e o link da próxima ação sem o '(opcional)'", () => {
    expect(fonte).toContain(
      'className="flex flex-wrap items-center gap-[5px] max-sm:flex-nowrap max-sm:gap-1 max-sm:overflow-x-auto max-sm:[&>*]:shrink-0"',
    );
    expect(fonte).toMatch(/<span>\s*Próxima ação<span className="max-sm:hidden"> \(opcional\)<\/span>\s*<\/span>/);
  });
});

describe("o âmbar nunca pinta texto nas primitivas da conversa (correção 3)", () => {
  it("em ConversaUi, --gated só em ícone: aria-hidden na linha, ou a chave `icone` dos mapas de tom", () => {
    // O molde da trava do Atendimento. A pílula "atenção" do rodapé pintava o texto de --gated sobre
    // --gated-bg (~3,6:1): o texto passou a --text-2, e o âmbar ficou na borda e no ícone.
    const linhas = ui.split("\n").filter((l) => l.includes("text-[var(--gated)]"));
    expect(linhas.length).toBeGreaterThan(0);
    for (const linha of linhas) expect(linha, linha.trim()).toMatch(/aria-hidden|\bicone: "text-\[var\(--gated\)\]"/);
    expect(ui).toContain(
      'atencao: { caixa: "border-[var(--gated)] bg-[var(--gated-bg)] text-[var(--text-2)]", icone: "text-[var(--gated)]" },',
    );
    // O ícone da pílula recebe a cor do tom; a caixa, o texto.
    expect(ui).toMatch(/TOM_DA_PILULA\[estado\]\.caixa/);
    expect(ui).toMatch(/<IconePilula aria-hidden className=\{cn\("h-2\.5 w-2\.5", TOM_DA_PILULA\[estado\]\.icone/);
  });
});
