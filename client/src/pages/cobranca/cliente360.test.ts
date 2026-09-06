/**
 * A ficha 360 — o molde literal do Provedor.ai, travado pelo fonte.
 *
 * O vitest daqui não monta .tsx: o que se prova é que a tela carrega as 24
 * seções `<Let>` do `cliente360/index.tsx` do Provedor.ai, na ordem e com os
 * rótulos de lá; que o Hero tem os cinco sub-cards; que a Economia R24 e o
 * Transversal existem; e que o que esta base não tem sai como PENDENTE ou
 * A-CRIAR, nunca como zero. A remontagem com o ERP ao vivo usa o MESMO
 * `montarFicha360` do servidor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), "utf8");
const pagina = ler("./cliente360.tsx");

/** Os 24 `<Let k>` do Provedor.ai, na ordem: 9 Passado + 11 Presente + 4 Futuro. */
const LETS = [
  "Faturas vencidas",
  "A vencer (no prazo · não é inadimplência)",
  "Encargos (CDC 52 · transparente)",
  "Negociação ativa",
  "Confissão CPC 784",
  "Comodato a recuperar",
  "Prescrição (CC 206 §5)",
  "Histórico de pagamento",
  "Pontualidade · últimos 12 meses",
  "Histórico (suspensões · negativações)",
  "Health Score",
  "NPS (relacionamento)",
  "CSAT · satisfação por evento",
  "Pior CSAT · últimos 90 dias",
  "Abordagem (DNA 3×3)",
  "Régua atual",
  "Próximo vencimento · risco de atraso",
  "Próximo passo (NBA)",
  "Agente da vez",
  "Chamados técnicos",
  "Opt-out / DND",
  "Plano atual → próximo",
  "Indicação · MGM",
  "Expansão geográfica",
  "Rede colaborativa",
];

describe("as seções do Provedor.ai, na ordem", () => {
  it("todas as 25 chaves (24 Let + Confissão) aparecem, e na ordem de lá", () => {
    let cursor = 0;
    for (const k of LETS) {
      const pos = pagina.indexOf(`k="${k}"`, cursor);
      expect(pos, `faltou ou saiu da ordem: ${k}`).toBeGreaterThan(-1);
      cursor = pos + 1;
    }
  });

  it("as três colunas têm o verbo e o subtítulo do Provedor.ai", () => {
    expect(pagina).toContain('titulo="Recuperar" sub="dívida & ativos"');
    expect(pagina).toContain('titulo="Defender" sub="saúde & régua"');
    expect(pagina).toContain('titulo="Conquistar" sub="upside"');
  });

  it("o Hero tem os cinco sub-cards: dívida, score, economia R24, endereço e ações", () => {
    expect(pagina).toContain("Fatura em aberto");
    expect(pagina).toContain("Score de crédito");
    expect(pagina).toContain("Economia do cliente · R24");
    expect(pagina).toContain('data-testid="card-endereco"');
    expect(pagina).toContain("Gerar PIX à vista");
    expect(pagina).toContain("Abrir negociação");
    expect(pagina).toContain("Confissão de dívida");
    expect(pagina).toContain("Ver na Régua DNA");
    expect(pagina).toContain("Histórico completo");
    expect(pagina).toContain("Sem débitos · em dia");
  });

  it("a seção R24 tem os oito indicadores, o custo mensal e o simulador", () => {
    for (const k of ["ARPU · mensalidade", "CAC · aquisição", "CAPEX · instalação", "OPEX · custo de servir/mês", "Margem de contribuição", "Payback / equilíbrio", "Lucro acumulado", "LTV (receita)"]) {
      expect(pagina).toContain(k);
    }
    expect(pagina).toContain("Economia do cliente · visão financeira");
    expect(pagina).toContain("Para onde vai a mensalidade · custo mensal");
    expect(pagina).toContain("Ponto de equilíbrio & simulador de cancelamento");
    expect(pagina).toContain("Pior caso, sem devolução do equipamento");
    expect(pagina).toContain('type="range"');
  });

  it("o Transversal tem a linha do tempo, o compliance e a memória", () => {
    expect(pagina).toContain("Transversal · os 3 horizontes juntos");
    expect(pagina).toContain("Linha do tempo integrada");
    expect(pagina).toContain("Compliance ·");
    expect(pagina).toContain("Memória");
    expect(pagina).toContain("<LinhaDoTempo");
  });
});

describe("honestidade do dado", () => {
  it("o que esta base não tem sai como PENDENTE ou A-CRIAR com motivo, nunca como zero", () => {
    expect(pagina).toContain("function Pendente(");
    expect(pagina).toContain("function ACriar(");
    expect(pagina).toContain("PENDENTE");
    expect(pagina).toContain("A-CRIAR");
    // o Provedor.ai não fabrica NPS/CSAT/chamados/DND; aqui também não
    expect(pagina).toMatch(/NPS \(relacionamento\)[\s\S]{0,400}<ACriar/);
    expect(pagina).toMatch(/Chamados técnicos[\s\S]{0,300}<Pendente/);
  });

  it("remonta a ficha com o ERP ao vivo usando o MESMO montarFicha360 do servidor", () => {
    expect(pagina).toContain("montarFicha360(");
    expect(pagina).toContain("api360AoVivo(");
    expect(pagina).toMatch(/vivo.plano|snapshot.cliente.plano/);
  });

  it("a Economia só sai com ARPU real: sem preço do plano mostra o motivo e o caminho da política", () => {
    expect(pagina).toContain("economiaPendente");
    expect(pagina).toContain("≈ parâmetros padrão");
    expect(pagina).toContain("Confirmar custos");
  });

  it("o funcionário está no lugar do agente: a ação da régua é o próximo passo e o responsável é o agente da vez", () => {
    expect(pagina).toContain("etapa.acao");
    expect(pagina).toContain("responsavelNome");
    expect(pagina).toContain("abrir contato →");
  });

  it("o chat com o cliente: botão de enviar para cobrança e o bloco da conversa, só com o chat pronto", () => {
    expect(pagina).toContain('data-testid="acao-enviar-chat"');
    expect(pagina).toContain("<ConversaDoChat");
    expect(pagina).toContain("chatProntoParaEnviar(integracaoDoChat)");
    expect(pagina).toContain("apiEnviarCasoParaChat(caso.id)");
  });

  it("as ações do caso continuam: contato, negociação, abrir caso, fechar, salvar", () => {
    for (const id of ["acao-registrar-contato", "acao-abrir-negociacao", "acao-abrir-caso", "form-caso", "salvar-caso", "confirmar-fechar"]) {
      expect(pagina).toContain(`data-testid="${id}"`);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * O cabeçalho no porte do print, o bloco CONEXÃO e a regra do selo de origem.
 *
 * Aqui não é só leitura de fonte: `origemDoDado`, `estadoDaConexao`,
 * `bloqueioDoContrato` e `formatarMac` são funções puras, e o `BlocoConexao`
 * é apresentação sem hook nem contexto — dá para renderizar em SSR e ler o
 * HTML. É o que prova que a ausência sai como traço COM motivo, e que
 * "Dados reais" nunca aparece sobre base sincronizada.
 * ──────────────────────────────────────────────────────────────────────── */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BlocoConexao, bloqueioDoContrato, estadoDaConexao, formatarMac,
  IdentificacaoTecnica, MOTIVO_SEM_ORIGEM, origemDoDado, origemDoSnapshot,
} from "@/components/cobranca/IdentificacaoTecnica";
import type { EquipamentoDoCliente, SnapshotAoVivo } from "@/components/cobranca/tipos";

const identificacao = ler("../../components/cobranca/IdentificacaoTecnica.tsx");
const perfilDoChat = ler("../../components/chat/PerfilDoCliente.tsx");

const CONEXAO = {
  login: "ana.silva@ppp", mac: "64DBF7ED1D24", ip: "100.72.14.9",
  contrato: "40122", serial: "ALCLFC65623D", online: false, fonte: "sgp",
};
const AGORA = "2026-09-06T11:30:00.000Z";
const snapshotDe = (p: Partial<SnapshotAoVivo>): SnapshotAoVivo => ({
  ok: true, encontrado: true, erpSource: "mk", cliente: null,
  erro: null, latenciaMs: 9, lidoEm: AGORA, doCache: false, ...p,
});

describe("a regra do selo de origem", () => {
  it("só diz 'Dados reais' quando a leitura ao vivo respondeu e disse quando", () => {
    const vivo = origemDoDado({ aoVivo: true, erpSource: "sgp", lidoEm: AGORA });
    expect(vivo.aoVivo).toBe(true);
    expect(vivo.rotulo).toBe("Dados reais");
    expect(vivo.titulo).toContain("Leitura ao vivo do SGP");
  });

  it("sem instante de leitura não há como afirmar leitura ao vivo — não vira 'Dados reais'", () => {
    const semQuando = origemDoDado({ aoVivo: true, erpSource: "sgp", lidoEm: null });
    expect(semQuando.aoVivo).toBe(false);
    expect(semQuando.rotulo).not.toBe("Dados reais");
    expect(semQuando.titulo).toBe(MOTIVO_SEM_ORIGEM);
    expect(origemDoDado({ aoVivo: true, lidoEm: "não é data" }).rotulo).toBe("Origem —");
  });

  it("números da varredura dizem 'Base sincronizada' e MOSTRAM a data, com o motivo da falha ao vivo", () => {
    const base = origemDoDado({ aoVivo: false, erpSource: "ixc", lidoEm: AGORA, motivo: "IP bloqueado no painel do IXC" });
    expect(base.aoVivo).toBe(false);
    expect(base.rotulo).toBe("Base sincronizada");
    expect(base.quando).toMatch(/06\/09\/2026/);
    expect(base.titulo).toContain("varredura do IXC");
    expect(base.titulo).toContain("IP bloqueado no painel do IXC");
    expect(base.titulo).not.toContain("Dados reais");
  });

  it("o snapshot só é ao vivo com ok + encontrado + lidoEm; cada falha tem seu motivo", () => {
    const varredura = { erpSource: "mk", lidoEm: AGORA };
    expect(origemDoSnapshot(snapshotDe({}), varredura).rotulo).toBe("Dados reais");

    const naoAchou = origemDoSnapshot(snapshotDe({ encontrado: false }), varredura);
    expect(naoAchou.rotulo).toBe("Base sincronizada");
    expect(naoAchou.titulo).toContain("não encontrou este cliente");

    const caiu = origemDoSnapshot(snapshotDe({ ok: false, encontrado: false, erro: "timeout" }), varredura);
    expect(caiu.rotulo).toBe("Base sincronizada");
    expect(caiu.titulo).toContain("timeout");

    expect(origemDoSnapshot(undefined, varredura).titulo).toContain("ainda não respondeu");
    expect(origemDoSnapshot(undefined, undefined).rotulo).toBe("Origem —");
  });

  it("o cabeçalho do 360 usa a regra em vez de cravar 'Dados reais' no fonte", () => {
    expect(pagina).toContain("origemDoSnapshot(");
    expect(pagina).toContain('<SeloOrigem origem={origemDoCabecalho} testId="selo-origem-360" />');
    expect(pagina).not.toMatch(/>Dados reais</);
    // o valor e o atraso do cabeçalho vêm da varredura: o title tem que dizer
    expect(pagina).toContain("vêm sempre da varredura gravada em customers");
  });
});

describe("o cabeçalho do 360 no porte do print", () => {
  it("nome, origem, plano, documento, telefone, tempo de casa, cidade e selos continuam lá", () => {
    for (const id of ["cabecalho-360", "nome-cliente", "documento-cliente", "tempo-de-casa", "resumo-executivo", "card-divida", "card-endereco", "acoes-360"]) {
      expect(pagina, `faltou ${id}`).toContain(`data-testid="${id}"`);
    }
    expect(pagina).toContain('testId="selo-origem-360"');
    expect(pagina).toContain("quadrante DNA");
  });

  it("cada ausência do cabeçalho sai como traço COM motivo, nunca como zero", () => {
    expect(pagina).toContain('<Traco titulo="Sem data de contrato no ERP" />');
    expect(pagina).toContain('"plano vem do ERP ao vivo"');
    expect(pagina).toContain("Sem débitos · em dia");
  });
});

describe("o bloco CONEXÃO", () => {
  const html = (props: Partial<Parameters<typeof BlocoConexao>[0]> = {}) =>
    renderToStaticMarkup(createElement(BlocoConexao, {
      conexoes: [CONEXAO],
      inventario: [{ id: 7, mac: "64DBF7ED1D24", serial: "ALCLFC65623D", rotulo: "ONU Nokia" }],
      origem: origemDoDado({ aoVivo: true, erpSource: "sgp", lidoEm: AGORA }),
      ...props,
    }));

  it("mostra serial e MAC em mono tabular, e o MAC formatado como no print", () => {
    expect(formatarMac("64DBF7ED1D24")).toBe("64:DB:F7:ED:1D:24");
    expect(formatarMac("64:db:f7:ed:1d:24")).toBe("64:DB:F7:ED:1D:24");
    expect(formatarMac(null)).toBeNull();
    // o que não é MAC de 48 bits não vira MAC inventado
    expect(formatarMac("ONU-123")).toBe("ONU-123");
    const saida = html();
    expect(saida).toContain("64:DB:F7:ED:1D:24");
    expect(saida).toContain("ALCLFC65623D");
    expect(saida).toContain("font-mono tabular-nums");
  });

  it("login, IP e contrato saem com a fonte do dado e o cruzamento com o inventário", () => {
    const saida = html();
    expect(saida).toContain("ana.silva@ppp");
    expect(saida).toContain("100.72.14.9");
    expect(saida).toContain("40122");
    expect(saida).toContain("Identificador coincide com o cadastro");
    expect(saida).toContain("ONU Nokia");
    expect(saida).toContain("fonte sgp");
  });

  it("estado da sessão: online, offline e SEM LEITURA — null nunca vira offline", () => {
    expect(estadoDaConexao(true).rotulo).toBe("Online");
    expect(estadoDaConexao(false).rotulo).toBe("Offline");
    expect(estadoDaConexao(null).rotulo).toBe("Sem leitura");
    expect(estadoDaConexao(null).motivo).toContain("não é prova de que está fora do ar");
    expect(estadoDaConexao(undefined).rotulo).toBe("Sem leitura");
    expect(html({ conexoes: [{ ...CONEXAO, online: null }] })).toContain("Sem leitura");
  });

  it("'Bloqueada' é o CONTRATO suspenso, um selo à parte do estado da sessão", () => {
    expect(bloqueioDoContrato("suspended")?.rotulo).toBe("Bloqueada");
    expect(bloqueioDoContrato("suspended")?.motivo).toContain("estado do contrato, não da sessão");
    expect(bloqueioDoContrato("active")).toBeNull();
    expect(bloqueioDoContrato(null)).toBeNull();
    const saida = html({ statusContrato: "suspended" });
    expect(saida).toContain("Bloqueada");
    expect(saida).toContain("Offline"); // a sessão continua sendo dita por ela mesma
    expect(html({ statusContrato: "active" })).not.toContain("Bloqueada");
  });

  it("sem autenticação nenhuma, diz por que falta — não mostra zero nem inventa aparelho", () => {
    const saida = html({ conexoes: [] });
    expect(saida).toContain("conexao-sem-leitura");
    expect(saida).toContain("não devolveu login, MAC nem serial");
    expect(saida).not.toContain("Online");
  });

  it("cada campo ausente é traço com o motivo no title", () => {
    const saida = html({ conexoes: [{ login: null, mac: null, ip: null, contrato: null, serial: null, online: null, fonte: "ixc_radius" }] });
    expect(saida).toContain("O ERP não devolveu o MAC desta autenticação");
    expect(saida).toContain("O ERP não devolveu o serial da ONU desta autenticação");
    expect(saida).toContain("O ERP não devolveu o login desta autenticação");
    expect(saida).toContain("O ERP não devolveu o IP desta autenticação");
    expect(saida).toContain("Sem MAC ou serial para cruzar");
  });

  it("o selo de origem viaja com o bloco: ao vivo diz 'Dados reais', varredura mostra a data", () => {
    expect(html()).toContain("Dados reais");
    const daBase = html({ origem: origemDoDado({ aoVivo: false, erpSource: "sgp", lidoEm: AGORA, motivo: "timeout" }) });
    expect(daBase).toContain("Base sincronizada");
    expect(daBase).not.toContain("Dados reais");
  });

  it("o 360 monta o bloco pelo snapshot e passa a varredura e o status do contrato", () => {
    const equipamento = { id: 7, tipo: "ONU", marca: "Nokia", modelo: null, serie: "ALCLFC65623D", mac: null, status: "em_comodato", valor: null } as unknown as EquipamentoDoCliente;
    const saida = renderToStaticMarkup(createElement(IdentificacaoTecnica, {
      snapshot: snapshotDe({
        erpSource: "sgp",
        cliente: {
          autenticacoes: [CONEXAO], nome: "Ana", plano: null, statusContrato: "suspended", motivoCorte: null,
          cortadoEm: null, contractStartDate: null, dividaAtual: 0, diasAtraso: 0, faturasAbertas: null,
          telefone: null, email: null, equipamentos: [],
        },
      }),
      equipamentos: [equipamento],
      statusContrato: "suspended",
    }));
    expect(saida).toContain('data-testid="identificacao-tecnica"');
    expect(saida).toContain("64:DB:F7:ED:1D:24");
    expect(saida).toContain("Bloqueada");
    expect(saida).toContain("Dados reais");
  });

  it("o 360 tira o bloco de dentro da coluna e o põe como cartão, com a varredura", () => {
    expect(pagina).toContain("varredura={{ erpSource: varredura?.erpSource, lidoEm: varredura?.lastSyncAt }}");
    expect(pagina).toContain("statusContrato={vivo?.statusContrato ?? cliente.statusErp}");
    // fora da coluna Passado: o cartão vem antes do tri-horizonte
    expect(pagina.indexOf("<IdentificacaoTecnica")).toBeLessThan(pagina.indexOf('testId="coluna-passado"'));
  });

  it("o painel do chat REAPROVEITA o bloco em vez de manter uma segunda versão", () => {
    expect(perfilDoChat).toContain("BlocoConexao");
    expect(perfilDoChat).toContain('from "@/components/cobranca/IdentificacaoTecnica"');
    expect(perfilDoChat).toContain("origemDoDado(");
    expect(perfilDoChat).toContain('testId="chat-bloco-conexao"');
    // nada de MAC/serial renderizados à mão fora do bloco comum
    expect(perfilDoChat).not.toContain("Estado da autenticação na última consulta");
  });

  it("o bloco comum vive num arquivo só — a duplicata do 360 não voltou", () => {
    expect(identificacao).toContain("export function BlocoConexao(");
    expect(identificacao).toContain("export function origemDoDado(");
    expect(identificacao).toContain("export function estadoDaConexao(");
    expect(identificacao).toContain("export function formatarMac(");
  });
});
