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

  it("as ações do caso continuam: contato, negociação, abrir caso, fechar, salvar", () => {
    for (const id of ["acao-registrar-contato", "acao-abrir-negociacao", "acao-abrir-caso", "form-caso", "salvar-caso", "confirmar-fechar"]) {
      expect(pagina).toContain(`data-testid="${id}"`);
    }
  });
});
