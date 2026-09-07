import { describe, expect, it } from "vitest";
import { montarFicha360, type EntradaDaFicha360 } from "./ficha360";
import { POLITICA_PADRAO } from "./politica";

/**
 * A montagem da ficha: o gate da Economia é o do Provedor.ai (ARPU real +
 * mês atual), e o que falta sai como PENDENTE com o motivo — nunca um número
 * calculado com chute. O mesmo código roda no servidor e no navegador.
 */

const HOJE = new Date(2026, 8, 5);
const ECONOMIA = {
  ...POLITICA_PADRAO.economia,
  cac: 150, capexInstalacao: 200, equipamentoResidual: 120,
  opexLink: 10, opexRedePop: 10, opexSuporte: 10, opexManutencaoNoc: 10,
  impostoReceitaPct: 10, cicloMeses: 36, confirmado: true,
  precoPorPlano: { "Fibra 300": 100 },
};

const base: EntradaDaFicha360 = {
  hoje: HOJE,
  statusErp: "active",
  carteira: "ativo",
  contractStartDate: "2025-09-05",
  cortadoEm: null,
  plano: "Fibra 300",
  ispScore: 700,
  riskTier: "medium",
  dividaAtual: 100,
  diasAtraso: 45,
  faturasAbertas: 1,
  equipamentos: { ativos: 1, extraviados: 0 },
  contatos90d: 2,
  respostas90d: 1,
  comunicacoes30d: 1,
  totalComunicacoes: 2,
  economia: ECONOMIA,
  historicoPagamento: null,
};

describe("montarFicha360", () => {
  it("cliente ativo, plano com preço, contrato conhecido: tudo calculado, Economia real", () => {
    const f = montarFicha360(base);
    expect(f.situacaoReal).toBe("ativo");
    expect(f.mesesCliente).toBe(12);
    expect(f.anosCliente).toBe(1);
    expect(f.valorMensal).toBe(100);
    expect(f.selo).toMatchObject({ tipo: "inadimplente", motivo: "45 dias em atraso" });
    expect(f.scores.credito).toBe(700);
    expect(f.scores.credito_band).toBe("medium");
    expect(f.scores.health_detalhe.financeiro).toBe(50); // 100 − 30 (45 d) − 10 (1 fatura) − 10 (1 ticket)
    expect(f.scores.health_detalhe.tecnico).toBe(100);
    expect(f.scores.health_detalhe.tecnicoNeutro).toBe(false);
    expect(f.scores.health_detalhe.relacionamento).toBe(55);
    expect(f.scores.health).toBe(67); // .4×50 + .3×100 + .3×55 = 66.5
    expect(f.scores.health_band).toBe("atencao");
    expect(f.scores.propensao).not.toBeNull();
    expect(f.scores.propensao_em_dia).toBe(false);
    expect(f.prescricao).toMatchObject({ data_prescricao: "2031-07-22", prescrita: false });
    expect(f.economia).not.toBeNull();
    expect(f.economia!.arpu).toBe(100);
    expect(f.economia!.mes_atual).toBe(12);
    expect(f.economia!.lucro_acumulado).toBe(150); // 50×12 − 350 − 100 de dívida
    expect(f.economia!.ciclo_encerrado).toBe(false);
    expect(f.economiaPendente).toBeNull();
    expect(f.resumo).toContain("Inadimplente");
    expect(f.resumo).toContain("LTV");
  });

  it("sem dívida: selo pelo histórico (aqui 'Sem histórico'), propensão em dia, sem prescrição, financeiro 100", () => {
    const f = montarFicha360({ ...base, dividaAtual: 0, diasAtraso: 0, faturasAbertas: 0 });
    expect(f.selo).toMatchObject({ tipo: "novo", rotulo: "Sem histórico" });
    expect(f.scores.propensao).toBeNull();
    expect(f.scores.propensao_detalhe).toBeNull();
    expect(f.scores.propensao_em_dia).toBe(true);
    expect(f.prescricao).toBeNull();
    expect(f.scores.health_detalhe.financeiro).toBe(100);
    expect(f.economia!.inadimplencia_aberta).toBe(0);
  });

  it("cliente há dois meses, sem dívida: selo 'Novo' com os meses de casa", () => {
    const f = montarFicha360({ ...base, contractStartDate: "2026-07-01", dividaAtual: 0, diasAtraso: 0, faturasAbertas: 0 });
    expect(f.mesesCliente).toBe(2);
    expect(f.selo).toMatchObject({ tipo: "novo", rotulo: "Novo", motivo: "2 meses de casa" });
  });

  it("sem equipamento nenhum: técnico é NEUTRAL 50 e a ficha diz que é neutro", () => {
    const f = montarFicha360({ ...base, equipamentos: { ativos: 0, extraviados: 0 } });
    expect(f.scores.health_detalhe.tecnico).toBe(50);
    expect(f.scores.health_detalhe.tecnicoNeutro).toBe(true);
  });

  it("o ERP não informou o plano: Economia PENDENTE, e a razão dívida/ticket não penaliza o financeiro", () => {
    const f = montarFicha360({ ...base, plano: null });
    expect(f.economia).toBeNull();
    expect(f.economiaPendente).toMatch(/não tem fatura vinda do ERP/);
    expect(f.valorMensal).toBeNull();
    expect(f.origemDoValorMensal).toBeNull();
    expect(f.scores.health_detalhe.financeiro).toBe(60); // sem a penalidade de razão
    expect(f.scores.propensao_detalhe!.fatores.find(x => x.factor === "valorVsTicket")!.hadData).toBe(false);
    expect(f.resumo).not.toContain("LTV");
  });

  it("plano sem preço cadastrado: o motivo cita o plano", () => {
    const f = montarFicha360({ ...base, plano: "Fibra 500" });
    expect(f.economia).toBeNull();
    expect(f.economiaPendente).toContain('"Fibra 500"');
  });

  it("sem data de contrato: sem meses, sem anos, Economia PENDENTE pela data", () => {
    const f = montarFicha360({ ...base, contractStartDate: null });
    expect(f.mesesCliente).toBeNull();
    expect(f.anosCliente).toBeNull();
    expect(f.economia).toBeNull();
    expect(f.economiaPendente).toMatch(/sem data de contrato/);
  });

  it("sem política de economia: PENDENTE apontando a Política", () => {
    const f = montarFicha360({ ...base, economia: null });
    expect(f.economiaPendente).toMatch(/Política > Economia/);
  });

  it("ex-cliente sem histórico: ciclo encerrado, meses contados até o corte, Economia PENDENTE com o motivo do Provedor.ai", () => {
    const f = montarFicha360({ ...base, statusErp: "cancelled", carteira: "ex_cliente", cortadoEm: "2026-03-05" });
    expect(f.situacaoReal).toBe("ex-cliente");
    expect(f.mesesCliente).toBe(6);
    expect(f.economia).toBeNull();
    expect(f.economiaPendente).toMatch(/ex-cliente sem histórico de pagamento sincronizado/);
  });

  it("ex-cliente COM histórico: Economia realizada, ciclo encerrado e efetivo = meses de casa", () => {
    const f = montarFicha360({ ...base, statusErp: "cancelled", carteira: "ex_cliente", cortadoEm: "2026-03-05", historicoPagamento: { pagas: 6, recebido: 600, pct_em_dia: 100 } });
    expect(f.economia).not.toBeNull();
    expect(f.economia!.ciclo_encerrado).toBe(true);
    expect(f.economia!.ciclo_efetivo).toBe(6);
    expect(f.economia!.fonte_receita).toBe("recebida");
    expect(f.selo).toMatchObject({ tipo: "inadimplente" }); // dívida vencida manda sobre o histórico
  });

  it("situação real vence a pessoa: status desconhecido cai na carteira", () => {
    expect(montarFicha360({ ...base, statusErp: "whatever", carteira: "ex_cliente" }).situacaoReal).toBe("ex-cliente");
    expect(montarFicha360({ ...base, statusErp: null, carteira: null }).situacaoReal).toBeNull();
  });
});

/*
 * A segunda fonte de ARPU e o gate dos custos (06/09/2026).
 *
 * A Economia ficava PENDENTE para a base inteira porque o ARPU tinha um
 * caminho so — nome do plano casado com um preco digitado a mao — e esse
 * caminho esta cortado dos dois lados: `customers` nao guarda o plano e o
 * mapa de precos nasce vazio. O valor que o provedor cobra esta nas faturas
 * do ERP desde a migracao 0027, e e de la que ele passa a sair.
 */
describe("a mensalidade lida das faturas", () => {
  const COM_FATURA = { ...base, plano: null, mensalidadeObservada: { valor: 129.9, concordam: 3, faturas: 4 } };

  it("sem preço de plano, a mensalidade das faturas vira o ARPU — e a ficha diz de onde veio", () => {
    const f = montarFicha360(COM_FATURA);
    expect(f.valorMensal).toBe(129.9);
    expect(f.origemDoValorMensal).toBe("faturas_do_erp");
    expect(f.economia).not.toBeNull();
    expect(f.economia!.arpu).toBe(129.9);
    expect(f.economiaPendente).toBeNull();
  });

  it("o preço CADASTRADO vence a leitura: configuração do admin ganha de observação", () => {
    const f = montarFicha360({ ...COM_FATURA, plano: "Fibra 300" });
    expect(f.valorMensal).toBe(100); // o preço da tabela do fixture
    expect(f.origemDoValorMensal).toBe("plano_cadastrado");
  });

  it("valor zero ou negativo nas faturas não vira ARPU", () => {
    for (const valor of [0, -10]) {
      const f = montarFicha360({ ...base, plano: null, mensalidadeObservada: { valor, concordam: 1, faturas: 1 } });
      expect(f.valorMensal).toBeNull();
      expect(f.origemDoValorMensal).toBeNull();
    }
  });
});

describe("custos zerados não viram número bonito e falso", () => {
  const SEM_CUSTO = { ...POLITICA_PADRAO.economia, precoPorPlano: { "Fibra 300": 100 } };

  it("com todos os custos em branco a Economia é PENDENTE, e o motivo diz o que preencher", () => {
    const f = montarFicha360({ ...base, plano: "Fibra 300", economia: SEM_CUSTO });
    // O que NAO pode acontecer: margem = 100% do ARPU e payback = 0 mês.
    expect(f.economia).toBeNull();
    expect(f.economiaPendente).toMatch(/faltam os custos do provedor/);
    // Mas a mensalidade é dado real e continua na ficha, para a tela mostrar.
    expect(f.valorMensal).toBe(100);
    expect(f.origemDoValorMensal).toBe("plano_cadastrado");
  });

  it("um custo informado já basta: o provedor não precisa preencher os nove", () => {
    const f = montarFicha360({ ...base, plano: "Fibra 300", economia: { ...SEM_CUSTO, opexLink: 12 } });
    expect(f.economia).not.toBeNull();
    expect(f.economiaPendente).toBeNull();
  });

  it("o gate do ARPU vem ANTES do dos custos: sem mensalidade, é dela que a tela fala", () => {
    const f = montarFicha360({ ...base, plano: null, economia: { ...POLITICA_PADRAO.economia } });
    expect(f.economiaPendente).toMatch(/sem mensalidade/);
  });
});
