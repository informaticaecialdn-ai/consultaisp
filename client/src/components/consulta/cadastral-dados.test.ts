/**
 * Derivações do relatório cadastral.
 *
 * O caso que dá nome a este arquivo é o do CPF que deve R$ 10.103 ao provedor e
 * tira 1000 na régua da BigData: nenhum teste de "score alto = bom" pode passar
 * aqui, porque a régua não mede o que o provedor precisa saber.
 */
import { describe, it, expect } from "vitest";
import {
  faixaCapacidade, decisaoCadastral, sinaisCadastrais, fmtDoc, fmtData,
  enderecoEmLinha, LEGENDA_CAPACIDADE,
} from "./cadastral-dados";
import type { ResultadoCadastral } from "./cadastral-tipos";

const base = (over: Partial<ResultadoCadastral> = {}): ResultadoCadastral => ({
  id: 1, cpfCnpj: "12906586927", veredito: "APROVAR", motivos: [],
  latenciaMs: 100, consultasComFalha: 0, consultasIndisponiveis: 0,
  enderecos: [], telefones: [], emails: [],
  inadimplencia: {
    emCobrancaAgora: false, cobrancas365d: 0, credores365d: 0, mesesConsecutivos: 0,
    processosTotal: 0, processosComoReu: 0, processos365d: 0,
    temExecucao: false, naturezas: [], dividaAtiva: 0,
  },
  rastro: {
    consultas30d: 0, consultas365d: 0, passagensRuins: 0,
    mudancasNome: 0, mudancasStatus: 0,
  },
  ...over,
});

describe("faixaCapacidade · a palavra importa", () => {
  it("nunca usa a palavra risco", () => {
    for (const s of [0, 200, 350, 600, 800, 1000]) {
      expect(faixaCapacidade(s)).not.toMatch(/risco/i);
    }
  });

  it("score maximo diz capacidade alta, nao risco baixo", () => {
    // Este e o devedor de R$ 10.103. A tela pode dizer que ele tem capacidade;
    // nao pode dizer que ele e de baixo risco.
    expect(faixaCapacidade(1000)).toBe("capacidade alta");
  });

  it("respeita as mesmas fronteiras da barra que a desenha", () => {
    expect(faixaCapacidade(300)).toBe("capacidade mínima");
    expect(faixaCapacidade(301)).toBe("capacidade baixa");
    expect(faixaCapacidade(500)).toBe("capacidade baixa");
    expect(faixaCapacidade(501)).toBe("capacidade média");
    expect(faixaCapacidade(700)).toBe("capacidade média");
    expect(faixaCapacidade(701)).toBe("capacidade boa");
    expect(faixaCapacidade(850)).toBe("capacidade boa");
    expect(faixaCapacidade(851)).toBe("capacidade alta");
  });

  it("a legenda avisa que a regua nao ve divida de provedor", () => {
    expect(LEGENDA_CAPACIDADE).toMatch(/não enxerga dívida de provedor/i);
  });
});

describe("decisaoCadastral", () => {
  it("fala de CPF ou de CNPJ conforme o documento", () => {
    expect(decisaoCadastral(base({ veredito: "RECUSAR" })).titulo).toMatch(/^CPF/);
    expect(decisaoCadastral(base({ veredito: "RECUSAR", tipoDocumento: "cnpj" })).titulo).toMatch(/^CNPJ/);
  });

  it("nao encontrado nao e recusa", () => {
    const d = decisaoCadastral(base({ veredito: "NAO_ENCONTRADO" }));
    expect(d.curto).toBe("Analisar");
    expect(d.tom).toBe("neutral");
  });

  it("atencao pede garantia, nao rejeicao", () => {
    const d = decisaoCadastral(base({ veredito: "ATENCAO" }));
    expect(d.curto).toBe("Analisar");
    expect(d.titulo).toBe("Exigir garantias");
  });
});

describe("sinaisCadastrais", () => {
  it("sempre devolve quatro — a grade do card conta com isso", () => {
    expect(sinaisCadastrais(base())).toHaveLength(4);
    expect(sinaisCadastrais(base({ tipoDocumento: "cnpj" }))).toHaveLength(4);
  });

  it("empresa mostra idade e socios; pessoa mostra cobranca e consultas", () => {
    const pj = sinaisCadastrais(base({
      tipoDocumento: "cnpj",
      empresa: { cnpj: "1", atividadesSecundarias: [], socios: [{ nome: "A", atual: true }], idadeAnos: 5 },
    })).map(s => s.rotulo);
    expect(pj).toContain("Anos de atividade");
    expect(pj).toContain("Sócios no quadro");

    const pf = sinaisCadastrais(base()).map(s => s.rotulo);
    expect(pf).toContain("Cobranças 12 meses");
    expect(pf).toContain("Consultas 30 dias");
  });

  it("marca como ruim o CNPJ recem-aberto e o sem socio", () => {
    const s = sinaisCadastrais(base({
      tipoDocumento: "cnpj",
      empresa: { cnpj: "1", atividadesSecundarias: [], socios: [], idadeAnos: 0 },
    }));
    expect(s[0].ruim).toBe(true);
    expect(s[1].ruim).toBe(true);
  });

  it("empresa madura com quadro societario nao vira alerta", () => {
    const s = sinaisCadastrais(base({
      tipoDocumento: "cnpj",
      empresa: { cnpj: "1", atividadesSecundarias: [], socios: [{ nome: "A", atual: true }], idadeAnos: 8 },
    }));
    expect(s[0].ruim).toBe(false);
    expect(s[1].ruim).toBe(false);
  });
});

describe("formatadores", () => {
  it("mascara CPF e CNPJ pelo comprimento", () => {
    expect(fmtDoc("12906586927")).toBe("129.065.869-27");
    expect(fmtDoc("40538997000152")).toBe("40.538.997/0001-52");
  });

  it("data nao escorrega de fuso", () => {
    // Meia-noite UTC lida como local devolveria o dia anterior no Brasil.
    expect(fmtData("2026-03-18")).toBe("18/03/2026");
    expect(fmtData("2026-03-18T00:00:00Z")).toBe("18/03/2026");
  });

  it("sentinela de data vazia vira traco, nao 01/01/0001", () => {
    expect(fmtData("0001-01-01T00:00:00")).toBe("—");
    expect(fmtData("9999-12-31T23:59:59.9999999")).toBe("—");
    expect(fmtData(undefined)).toBe("—");
  });

  it("endereco omite as partes que faltam sem deixar separador solto", () => {
    expect(enderecoEmLinha({
      logradouro: "AV SANTOS DUMONT", numero: "100", cidade: "LONDRINA", uf: "PR",
      ratificado: true, ativo: true, principal: true, naReceita: true,
      passagens: 1, passagensRuins: 0,
    })).toBe("AV SANTOS DUMONT, 100 — LONDRINA/PR");

    expect(enderecoEmLinha({
      logradouro: "RUA SEM NUMERO",
      ratificado: false, ativo: false, principal: false, naReceita: false,
      passagens: 0, passagensRuins: 0,
    })).toBe("RUA SEM NUMERO");
  });
});
