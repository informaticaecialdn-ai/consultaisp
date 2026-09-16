/**
 * A ficha 360 — as seções do Provedor.ai adaptadas aos dados disponíveis.
 *
 * O vitest daqui não monta .tsx: o que se prova é que a tela carrega as 24
 * seções `<Let>` do `cliente360/index.tsx` do Provedor.ai, na ordem e com os
 * rótulos adaptados; que o Hero tem os cinco sub-cards; que a Economia R24 e o
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
  "Confissão de dívida",
  "Comodato a recuperar",
  "Prescrição (CC 206 §5)",
  "Histórico de pagamento",
  "Pontualidade observada",
  "Histórico (suspensões · negativações)",
  "Saúde do relacionamento · 0 a 100",
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
  "Plano e relacionamento",


  "Rede colaborativa",
];

describe("as seções do Provedor.ai, na ordem", () => {
  it("preserva os campos operacionais e a ordem dos três horizontes", () => {
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
  IdentificacaoTecnica, MOTIVO_SEM_ORIGEM, origemDoDado, origemDoSnapshot, TITULO_DEMONSTRACAO,
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

/* ────────────────────────────────────────────────────────────────────────
 * O selo na demonstração pública. No sandbox a leitura "ao vivo" responde
 * (pelo conector de demonstração), então sem esta regra o selo diria "Dados
 * reais" sobre clientes inventados. O sinal é `demoMode` de `useAuth` — o
 * mesmo da faixa — e fora da demo a regra de sempre não muda um caractere.
 * ──────────────────────────────────────────────────────────────────────── */
describe("o selo de origem na demonstração pública", () => {
  const ENTRADAS = [
    { aoVivo: true, erpSource: "mk", lidoEm: AGORA },
    { aoVivo: false, erpSource: "mk", lidoEm: AGORA, motivo: "timeout" },
    { aoVivo: false, lidoEm: null },
  ];

  it("com demonstração, ao vivo, varredura ou sem data: sempre 'Dados fictícios', tom info, nunca 'Dados reais'", () => {
    for (const entrada of ENTRADAS) {
      const demo = origemDoDado({ ...entrada, demonstracao: true });
      expect(demo.rotulo).toBe("Dados fictícios");
      expect(demo.tom).toBe("info");
      expect(demo.titulo).toContain("Demonstração pública");
      expect(demo.titulo).toContain("conector de demonstração");
      expect(demo.titulo).not.toContain("Leitura ao vivo do");
      // a data e o `aoVivo` continuam os da regra: só a afirmação do selo muda
      const real = origemDoDado(entrada);
      expect(demo.aoVivo).toBe(real.aoVivo);
      expect(demo.quando).toBe(real.quando);
    }
    expect(origemDoDado({ aoVivo: true, lidoEm: AGORA, nota: "Nota do bloco.", demonstracao: true }).titulo).toBe(`${TITULO_DEMONSTRACAO} Nota do bloco.`);
  });

  it("fora da demonstração (false ou ausente) a regra é exatamente a de antes", () => {
    for (const entrada of ENTRADAS) {
      expect(origemDoDado({ ...entrada, demonstracao: false })).toEqual(origemDoDado(entrada));
    }
    expect(origemDoDado({ aoVivo: true, erpSource: "mk", lidoEm: AGORA, demonstracao: false }).rotulo).toBe("Dados reais");
    expect(origemDoDado({ aoVivo: true, erpSource: "mk", lidoEm: AGORA }).rotulo).not.toContain("fictícios");
  });

  it("o erpSource não liga a demonstração: só o sinal explícito liga", () => {
    expect(origemDoDado({ aoVivo: true, erpSource: "demo", lidoEm: AGORA }).rotulo).toBe("Dados reais");
  });

  it("origemDoSnapshot repassa a demonstração nos dois caminhos — respondeu e não respondeu", () => {
    const varredura = { erpSource: "mk", lidoEm: AGORA };
    expect(origemDoSnapshot(snapshotDe({}), varredura, undefined, true).rotulo).toBe("Dados fictícios");
    expect(origemDoSnapshot(undefined, varredura, undefined, true).rotulo).toBe("Dados fictícios");
    expect(origemDoSnapshot(snapshotDe({}), varredura, undefined, false).rotulo).toBe("Dados reais");
    expect(origemDoSnapshot(undefined, varredura).rotulo).toBe("Base sincronizada");
  });

  it("o bloco do 360 renderizado: 'Dados fictícios' com demonstração, 'Dados reais' sem", () => {
    const props = { snapshot: snapshotDe({}), equipamentos: [] };
    const demo = renderToStaticMarkup(createElement(IdentificacaoTecnica, { ...props, demonstracao: true }));
    expect(demo).toContain("Dados fictícios");
    expect(demo).not.toContain("Dados reais");
    const real = renderToStaticMarkup(createElement(IdentificacaoTecnica, props));
    expect(real).toContain("Dados reais");
    expect(real).not.toContain("Dados fictícios");
    expect(renderToStaticMarkup(createElement(IdentificacaoTecnica, { ...props, demonstracao: false }))).toBe(real);
  });

  it("o 360 lê demoMode de useAuth e passa ao cabeçalho e ao bloco CONEXÃO", () => {
    expect(pagina).toContain("const { user, personificando, demoMode } = useAuth();");
    expect(pagina).toMatch(/origemDoSnapshot\([\s\S]{0,400}?,\s*demoMode,\s*\)/);
    expect(pagina).toMatch(/<IdentificacaoTecnica[\s\S]{0,400}?demonstracao=\{demoMode\}/);
    // nunca decidido pelo erpSource no client
    expect(pagina).not.toMatch(/erpSource\s*===\s*["']demo/);
  });

  it("o painel do chat lê demoMode de useAuth e passa ao selo da conexão", () => {
    expect(perfilDoChat).toContain('import { useAuth } from "@/lib/auth";');
    expect(perfilDoChat).toContain("const { demoMode } = useAuth();");
    expect(perfilDoChat).toContain("demonstracao: demoMode,");
    expect(perfilDoChat).not.toMatch(/erpSource\s*===\s*["']demo/);
  });
});

describe("o texto da cobranca de saida no card R24 (multa/equipamento fora do prejuizo)", () => {
  const semNbsp2 = (t: string) => t.replace(/\u00a0/g, " ");
  it("nomeia o que existe — multa, equipamento ou os dois — e a razao vale em qualquer regime", async () => {
    const { textoDaCobrancaDeSaida } = await import("./cliente360");
    expect(semNbsp2(textoDaCobrancaDeSaida({ multaForaDoPrejuizo: 600, multasIndeterminadas: 0, multa: 600, equipamento: 0 }).linha ?? "")).toBe("multa R$ 600,00 cobrada à parte não entra no prejuízo — o equipamento já está no investimento que a Economia cobra");
    expect(semNbsp2(textoDaCobrancaDeSaida({ multaForaDoPrejuizo: 800, multasIndeterminadas: 0, multa: 0, equipamento: 800 }).linha ?? "")).toBe("equipamento R$ 800,00 cobrado à parte não entra no prejuízo — o equipamento já está no investimento que a Economia cobra");
    expect(semNbsp2(textoDaCobrancaDeSaida({ multaForaDoPrejuizo: 1400, multasIndeterminadas: 0, multa: 600, equipamento: 800 }).linha ?? "")).toBe("multa e equipamento R$ 1.400,00 cobrados à parte não entram no prejuízo — o equipamento já está no investimento que a Economia cobra");
    expect(textoDaCobrancaDeSaida({ multaForaDoPrejuizo: 600, multasIndeterminadas: 0, multa: 600, equipamento: 0 }).rotuloSaldo).toBe("Saldo devedor · sem multa");
    expect(textoDaCobrancaDeSaida({ multaForaDoPrejuizo: 0, multasIndeterminadas: 0 })).toEqual({ linha: null, rotuloSaldo: "Saldo devedor", indeterminadas: null });
    expect(textoDaCobrancaDeSaida({ multaForaDoPrejuizo: 0, multasIndeterminadas: 1 }).indeterminadas).toBe("1 fatura mistura multa e mensalidade sem dizer os valores: contada como dívida");
    expect(textoDaCobrancaDeSaida({ multaForaDoPrejuizo: 0, multasIndeterminadas: 3 }).indeterminadas).toBe("3 faturas misturam multa e mensalidade sem dizer os valores: contadas como dívida");
  });
  it("a linha da multa fica FORA do gate da Economia, e a remontagem ao vivo leva o historico e o plano da varredura", () => {
    const fonte = ler("./cliente360.tsx");
    expect(fonte).toMatch(/\{saida\.linha && \(/);
    expect(fonte).not.toMatch(/economia && multaForaDoPrejuizo > 0 &&/);
    expect(fonte).toMatch(/historicoPagamento: historicoParaEconomia\(data\.historicoPagamentos \?\? null\)/);
    expect(fonte).toMatch(/plano: vivo\.plano \?\? data\.fichaEntrada\.plano/);
  });
});

describe("a mensalidade deduzida da fatura de saida tem rotulo proprio", () => {
  it("rotuloDaMensalidade e ORIGEM_DO_VALOR conhecem 'fatura_de_saida'", async () => {
    const { rotuloDaMensalidade, ORIGEM_DO_VALOR } = await import("./cliente360");
    expect(rotuloDaMensalidade("deduzida_da_fatura", null)).toBe("deduzida da própria fatura");
    expect(ORIGEM_DO_VALOR.deduzida_da_fatura.rotulo).toBe("deduzida da própria fatura");
    expect(ORIGEM_DO_VALOR.deduzida_da_fatura.titulo).toMatch(/Proporcional 40 dias/);
  });
  it("o card R24 troca 'Recebido' por 'Receita estimada' e leva o selo quando a fonte e estimada", () => {
    const fonte = ler("./cliente360.tsx");
    expect(fonte).toMatch(/fonte_receita !== "projetada"/);
    expect(fonte).toMatch(/Receita estimada/);
    expect(fonte).toMatch(/data-testid="economia-estimada"/);
    expect(fonte).toMatch(/LTV estimado/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * O selo do "Comodato a recuperar". Ate 12/09/2026 a regra era inline e so
 * conhecia seis status: tudo o mais caia em "em comodato" — inclusive o
 * aparelho nao localizado, o retido, o ja recolhido para triagem e o baixado.
 * O vocabulario vem de server/services/equipment-recovery-rules.ts
 * (EQUIPMENT_STATUSES + STATUS_RECUPERADO + STATUS_EQUIPAMENTO_PENDENTE) e dos
 * legados que equipamentos.tsx ainda exibe.
 * ──────────────────────────────────────────────────────────────────────── */
describe("o selo do comodato no 360, por status", () => {
  const casos: Array<[string, string, string]> = [
    // devolvido: voltou para o provedor, inclusive o que ainda esta na triagem
    ["devolvido", "devolvido", "devolvido"],
    ["returned", "devolvido", "devolvido"],
    ["recuperado", "devolvido", "devolvido"],
    ["recuperado_triagem", "devolvido", "devolvido"],
    ["disponivel_reuso", "devolvido", "devolvido"],
    ["avariado", "devolvido", "devolvido"],
    ["concluido", "devolvido", "devolvido"],
    // a recuperar: o aparelho continua fora de casa
    ["em_cobranca", "a_recuperar", "a recuperar"],
    ["retirada_pendente", "a_recuperar", "a recuperar"],
    ["prazo_expirado", "a_recuperar", "a recuperar"],
    ["nao_localizado", "a_recuperar", "a recuperar"],
    ["retido", "a_recuperar", "a recuperar"],
    ["not_returned", "a_recuperar", "a recuperar"],
    // baixado: saiu da conta, nao e comodato nem cobranca
    ["baixado", "baixado", "baixado"],
    ["baixa", "baixado", "baixado"],
    // em comodato: instalado e em uso
    ["em_comodato", "em_comodato", "em comodato"],
    ["installed", "em_comodato", "em comodato"],
  ];

  it.each(casos)("%s → %s", async (status, classe, rotulo) => {
    const { classificarComodato } = await import("./cliente360");
    const c = classificarComodato(status);
    expect(c.classe).toBe(classe);
    expect(c.rotulo).toBe(rotulo);
  });

  it("os tons: devolvido ok, a recuperar past, em comodato gated, baixado neutro", async () => {
    const { classificarComodato } = await import("./cliente360");
    expect(classificarComodato("recuperado_triagem").tom).toBe("ok");
    expect(classificarComodato("nao_localizado").tom).toBe("past");
    expect(classificarComodato("em_comodato").tom).toBe("gated");
    expect(classificarComodato("baixado").tom).toBe("neutro");
  });

  it("caixa e espaco do ERP nao mudam a classe", async () => {
    const { classificarComodato } = await import("./cliente360");
    expect(classificarComodato(" NAO_LOCALIZADO ").classe).toBe("a_recuperar");
    expect(classificarComodato("Devolvido").classe).toBe("devolvido");
  });

  it("status que nao se conhece nunca vira 'em comodato': sai o proprio status, neutro", async () => {
    const { classificarComodato } = await import("./cliente360");
    const furto = classificarComodato("furto_roubo_declarado");
    expect(furto.rotulo).not.toBe("em comodato");
    expect(furto.rotulo).toBe("furto/roubo declarado");
    const estranho = classificarComodato("status_novo_do_erp");
    expect(estranho.classe).toBe("desconhecido");
    expect(estranho.rotulo).toBe("status_novo_do_erp");
    expect(estranho.tom).toBe("neutro");
    expect(classificarComodato("").rotulo).not.toBe("em comodato");
  });

  it("a lista do 360 usa a funcao, e a regra inline de seis status nao voltou", () => {
    expect(pagina).toContain("classificarComodato(e.status)");
    expect(pagina).not.toMatch(/const pendente = e\.status === "em_cobranca"/);
  });
});

describe("o suspenso com corte e o historico parcial na tela", () => {
  it("o card R24 diz 'ate o corte' para o suspenso, e o selo distingue estimado de historico parcial", () => {
    const fonte = ler("./cliente360.tsx");
    expect(fonte).toMatch(/Resultado até o corte · R24/);
    expect(fonte).toMatch(/≈ histórico parcial/);
    expect(fonte).toMatch(/ciclo encerrado · histórico parcial/);
    expect(fonte).toMatch(/suspenso=\{ficha\?\.situacaoReal === "suspenso"\}/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * O que a revisão de 12/09/2026 tirou do cabeçalho e não podia: o aviso de
 * vulnerabilidade (Lei 14.181). Esta base não tem coluna de vulnerabilidade,
 * e a régua NÃO pausa sozinha por ela — quem cobra precisa saber disso ANTES
 * de cobrar. É limite de compliance, não polimento: volta discreto, mas na
 * tela, e não só no `title` (a razão é a mesma do `<Pendente>`: tooltip não
 * sobrevive a print, celular nem leitor de tela).
 * ──────────────────────────────────────────────────────────────────────── */
describe("o aviso de vulnerabilidade (Lei 14.181) no cabeçalho", () => {
  it("diz NA TELA que a régua não pausa sozinha, cita a lei e leva o motivo completo no title", async () => {
    const { AvisoVulnerabilidade } = await import("./cliente360");
    const html = renderToStaticMarkup(createElement(AvisoVulnerabilidade));
    expect(html).toContain('data-testid="aviso-vulnerabilidade"');
    expect(html).toContain("Lei 14.181");
    expect(html).toContain("a régua não pausa sozinha");
    expect(html).toMatch(/title="[^"]*coluna de vulnerabilidade[^"]*"/);
  });

  it("vive no cabeçalho do 360, junto da identidade — não numa coluna lá embaixo", () => {
    const aviso = pagina.indexOf("<AvisoVulnerabilidade />");
    expect(aviso).toBeGreaterThan(pagina.indexOf('data-testid="cabecalho-360"'));
    expect(aviso).toBeLessThan(pagina.indexOf('data-testid="card-divida"'));
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * A dobra "Conexão e equipamentos". A revisão a fechou por padrão — e é
 * dentro dela que vive o selo "Dados fictícios" do bloco CONEXÃO. Na
 * demonstração pública, o visitante leria a tela inteira sem ver o aviso;
 * por isso, com `demoMode` a dobra nasce ABERTA. Fora da demo, fechada como
 * a revisão deixou.
 * ──────────────────────────────────────────────────────────────────────── */
describe("a dobra 'Conexão e equipamentos' e a demonstração", () => {
  it("na demonstração nasce ABERTA: o selo 'Dados fictícios' aparece sem clique", async () => {
    const { DetalhesDaConexao } = await import("./cliente360");
    const demo = renderToStaticMarkup(createElement(DetalhesDaConexao, { demonstracao: true }, "conteúdo"));
    expect(demo).toMatch(/<details[^>]* open=""/);
    expect(demo).toContain("Conexão e equipamentos");
    expect(demo).toContain("conteúdo");
  });

  it("fora da demonstração continua FECHADA, como a revisão deixou", async () => {
    const { DetalhesDaConexao } = await import("./cliente360");
    const real = renderToStaticMarkup(createElement(DetalhesDaConexao, { demonstracao: false }, "conteúdo"));
    expect(real).toContain("<details");
    expect(real).not.toMatch(/<details[^>]* open/);
  });

  it("o 360 liga a dobra ao demoMode de useAuth e põe o bloco CONEXÃO dentro dela", () => {
    expect(pagina).toMatch(/<DetalhesDaConexao demonstracao=\{demoMode\}>\s*<IdentificacaoTecnica/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * `cliente360.css` chegou com duas iterações sobrepostas (a segunda
 * reescrevia metade da primeira). Trava: uma iteração só. O mini-card
 * "Economia do cliente · R24" do Hero segue escondido por CSS de propósito
 * (revisão de 16/09/2026): a SecaoR24 completa já mostra a Economia logo
 * abaixo do Hero, e mostrar os dois um sobre o outro seria mudar a tela de
 * produção antes da decisão de layout (manter os dois ou tirar um no TSX).
 * Até lá, o visual é o que está no ar.
 * ──────────────────────────────────────────────────────────────────────── */
describe("cliente360.css: a Economia do Hero segue escondida até a decisão de layout, e cada seletor é declarado uma vez", () => {
  const css = ler("./cliente360.css");

  it("o mini-card card-economia do Hero está escondido por CSS (a SecaoR24 mostra a Economia)", () => {
    expect(css).toMatch(/card-economia[^{]*\{[^}]*display\s*:\s*none/);
    // E o TSX continua com os dois: mexer no layout é decisão do Arquiteto, não deste CSS.
    expect(pagina).toContain('data-testid="card-economia"');
    expect(pagina).toMatch(/<SecaoR24 /);
  });

  it("fora das @media, nenhum seletor aparece duas vezes (uma iteração só)", () => {
    const foraDeMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const seletores = Array.from(foraDeMedia.matchAll(/([^{}]+)\{/g), m => m[1].trim());
    const repetidos = seletores.filter((s, i) => seletores.indexOf(s) !== i);
    expect(repetidos, repetidos.join(" | ")).toEqual([]);
  });
});
