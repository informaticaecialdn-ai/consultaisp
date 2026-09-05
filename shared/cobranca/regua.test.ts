/**
 * A régua por dias de atraso, fronteira a fronteira (14/15, 29/30, 89/90,
 * 179/180, 359/360, prescrição), nas duas carteiras, e o que o provedor pode
 * mudar sem furar o piso legal.
 */
import { describe, expect, it } from "vitest";
import {
  DIAS_PRESCRICAO,
  ETAPAS_PADRAO,
  EtapasConfigSchema,
  PISO_AVISO_SUSPENSAO_DIAS,
  PREVENTIVO_DIAS_TOQUE,
  ROTULO_MOTIVO_SEM_ETAPA,
  clampEtapas,
  etapaParaAtraso,
  etapaPorId,
  etapasDaCarteira,
  janelaDaEtapa,
  prescrita,
  resolverEtapas,
  rotuloDoDia,
  type Etapa,
} from "./regua";

const idEm = (dias: number, carteira: "ativo" | "ex_cliente" = "ativo", etapas?: readonly Etapa[]) => {
  const d = etapaParaAtraso(dias, carteira, etapas);
  return d.etapa ? d.etapa.id : d.motivo;
};

describe("ETAPAS_PADRAO — o catálogo", () => {
  it("as janelas são contíguas, começam em D-7 e a última não tem teto", () => {
    expect(ETAPAS_PADRAO[0].diaMin).toBe(-7);
    for (let i = 1; i < ETAPAS_PADRAO.length; i++) {
      expect(ETAPAS_PADRAO[i].diaMin).toBe((ETAPAS_PADRAO[i - 1].diaMax as number) + 1);
    }
    expect(ETAPAS_PADRAO[ETAPAS_PADRAO.length - 1].diaMax).toBeNull();
  });

  it("só o preventivo depende de fatura a fatura; todo o resto vale na fase 1", () => {
    expect(ETAPAS_PADRAO.filter(e => !e.disponivelNaFase1).map(e => e.id)).toEqual(["lembrete_pre_vencimento"]);
  });

  it("o aviso de suspensão começa no piso da Anatel e a pré-negativação cita a Súmula 359", () => {
    expect(etapaPorId("aviso_suspensao")?.diaMin).toBe(PISO_AVISO_SUSPENSAO_DIAS);
    expect(etapaPorId("aviso_suspensao")?.baseLegal).toMatch(/765\/2023/);
    expect(etapaPorId("pre_negativacao")?.baseLegal).toMatch(/359/);
    expect(etapaPorId("fim_de_linha")?.baseLegal).toMatch(/206/);
  });

  it("nenhuma etapa vem com responsável fixo: a fila é de todos até o provedor dizer o contrário", () => {
    for (const e of ETAPAS_PADRAO) expect(e.responsavelUserId).toBeNull();
  });
});

describe("etapaParaAtraso — carteira de clientes ativos", () => {
  it("D0 e antes: o preventivo existe no catálogo mas a fase 1 não tem fatura para lembrar", () => {
    expect(idEm(0)).toBe("depende_de_fatura");
    expect(idEm(-7)).toBe("depende_de_fatura");
    expect(idEm(-1)).toBe("depende_de_fatura");
  });

  it("D+1 a D+14 é lembrete de atraso; D+15 vira aviso de suspensão", () => {
    expect(idEm(1)).toBe("lembrete_atraso");
    expect(idEm(14)).toBe("lembrete_atraso");
    expect(idEm(15)).toBe("aviso_suspensao");
  });

  it("D+29 ainda é aviso; D+30 é negociação até D+89", () => {
    expect(idEm(29)).toBe("aviso_suspensao");
    expect(idEm(30)).toBe("negociacao_recuperacao");
    expect(idEm(89)).toBe("negociacao_recuperacao");
  });

  it("D+90 é pré-negativação até D+179; D+180 é dívida antiga até D+359; D+360 é fim de linha", () => {
    expect(idEm(90)).toBe("pre_negativacao");
    expect(idEm(179)).toBe("pre_negativacao");
    expect(idEm(180)).toBe("divida_antiga");
    expect(idEm(359)).toBe("divida_antiga");
    expect(idEm(360)).toBe("fim_de_linha");
    expect(idEm(1824)).toBe("fim_de_linha");
  });

  it("a decisão traz a etapa inteira, com a ação para o funcionário", () => {
    const d = etapaParaAtraso(20, "ativo");
    expect(d.motivo).toBeNull();
    expect(d.etapa?.acao).toMatch(/notifica/i);
    expect(d.etapa?.canalSugerido).toBe("telefone");
  });
});

describe("etapaParaAtraso — carteira de ex-clientes", () => {
  it("não há aviso de suspensão: do lembrete vai direto à negociação, já em D+15", () => {
    expect(idEm(14, "ex_cliente")).toBe("lembrete_atraso");
    expect(idEm(15, "ex_cliente")).toBe("negociacao_recuperacao");
    expect(idEm(29, "ex_cliente")).toBe("negociacao_recuperacao");
    expect(idEm(30, "ex_cliente")).toBe("negociacao_recuperacao");
  });

  it("a pré-negativação continua valendo: a dívida existe, e quem revisa é o funcionário", () => {
    expect(idEm(90, "ex_cliente")).toBe("pre_negativacao");
    expect(idEm(360, "ex_cliente")).toBe("fim_de_linha");
  });

  it("etapasDaCarteira mostra a régua sem o aviso e com a negociação começando em D+15", () => {
    const lista = etapasDaCarteira("ex_cliente");
    expect(lista.map(e => e.id)).not.toContain("aviso_suspensao");
    expect(lista.find(e => e.id === "negociacao_recuperacao")?.diaMin).toBe(15);
    // A lista original não é tocada.
    expect(etapaPorId("negociacao_recuperacao")?.diaMin).toBe(30);
  });
});

describe("prescrição — CC art. 206 §5º I", () => {
  it("cinco anos em dias, sem bissexto: 1825", () => {
    expect(DIAS_PRESCRICAO).toBe(1825);
  });

  it("no dia 1824 ainda se cobra; no 1825 nunca mais", () => {
    expect(prescrita(1824)).toBe(false);
    expect(prescrita(1825)).toBe(true);
    expect(prescrita(4000)).toBe(true);
  });

  it("a régua devolve 'prescrita' antes de olhar qualquer etapa, nas duas carteiras", () => {
    expect(idEm(1825)).toBe("prescrita");
    expect(idEm(1825, "ex_cliente")).toBe("prescrita");
    expect(ROTULO_MOTIVO_SEM_ETAPA.prescrita).toMatch(/não se cobra/);
  });
});

describe("preventivo — fase 2, quando houver fatura", () => {
  const comPreventivo: Etapa[] = ETAPAS_PADRAO.map(e =>
    e.id === "lembrete_pre_vencimento" ? { ...e, disponivelNaFase1: true } : { ...e },
  );

  it("dispara só nos dias-toque D-7, D-3 e D-1", () => {
    expect([...PREVENTIVO_DIAS_TOQUE].sort((a, b) => a - b)).toEqual([-7, -3, -1]);
    for (const dia of [-7, -3, -1]) expect(idEm(dia, "ativo", comPreventivo)).toBe("lembrete_pre_vencimento");
  });

  it("fora do dia-toque não contata: D-6, D-2 e D0 ficam em silêncio", () => {
    for (const dia of [-6, -5, -4, -2, 0]) expect(idEm(dia, "ativo", comPreventivo)).toBe("fora_toque_preventivo");
  });
});

describe("resolverEtapas — o que o provedor muda", () => {
  it("sem política, ou com etapas vazias, é o catálogo padrão", () => {
    expect(resolverEtapas(null)).toEqual([...ETAPAS_PADRAO]);
    expect(resolverEtapas({ etapas: [] })).toEqual([...ETAPAS_PADRAO]);
    expect(resolverEtapas({})).toEqual([...ETAPAS_PADRAO]);
  });

  it("JSON de outra versão cai no padrão em vez de derrubar a régua", () => {
    expect(resolverEtapas({ etapas: "lembrete" })).toEqual([...ETAPAS_PADRAO]);
    expect(resolverEtapas({ etapas: [{ id: "etapa_que_nao_existe" }] })).toEqual([...ETAPAS_PADRAO]);
  });

  it("mescla janela, ação, canal e responsável sobre o padrão, mantendo o resto", () => {
    const etapas = resolverEtapas({
      etapas: [{ id: "negociacao_recuperacao", diaMin: 25, acao: "Ligar e oferecer o acordo da campanha.", canalSugerido: "whatsapp", responsavelUserId: 42 }],
    });
    const neg = etapas.find(e => e.id === "negociacao_recuperacao")!;
    expect(neg.diaMin).toBe(25);
    expect(neg.diaMax).toBe(89);
    expect(neg.acao).toBe("Ligar e oferecer o acordo da campanha.");
    expect(neg.canalSugerido).toBe("whatsapp");
    expect(neg.responsavelUserId).toBe(42);
    expect(neg.rotulo).toBe("Negociação");
    expect(neg.disponivelNaFase1).toBe(true);
    expect(etapas.filter(e => e.id !== "negociacao_recuperacao")).toEqual(
      ETAPAS_PADRAO.filter(e => e.id !== "negociacao_recuperacao"),
    );
  });

  it("o provedor não liga o preventivo na fase 1: a chave nem existe na config", () => {
    const parsed = EtapasConfigSchema.safeParse([{ id: "lembrete_pre_vencimento", disponivelNaFase1: true }]);
    expect(parsed.success).toBe(true);
    const etapas = resolverEtapas({ etapas: parsed.success ? parsed.data : [] });
    expect(etapas.find(e => e.id === "lembrete_pre_vencimento")?.disponivelNaFase1).toBe(false);
  });

  it("aviso de suspensão antes de D+15 é puxado ao piso da Anatel", () => {
    const etapas = resolverEtapas({ etapas: [{ id: "aviso_suspensao", diaMin: 5, diaMax: 10 }] });
    const aviso = etapas.find(e => e.id === "aviso_suspensao")!;
    expect(aviso.diaMin).toBe(15);
    expect(aviso.diaMax).toBe(15);
  });

  it("diaMin acima do diaMax padrão arrasta o teto junto", () => {
    const etapas = resolverEtapas({ etapas: [{ id: "lembrete_atraso", diaMin: 20 }] });
    const lembrete = etapas.find(e => e.id === "lembrete_atraso")!;
    expect(lembrete.diaMin).toBe(20);
    expect(lembrete.diaMax).toBe(20);
  });

  it("a saída vem ordenada por diaMin — o motor casa a primeira janela que contém o dia", () => {
    const etapas = resolverEtapas({ etapas: [{ id: "divida_antiga", diaMin: 100 }] });
    expect(etapas.map(e => e.diaMin)).toEqual([...etapas.map(e => e.diaMin)].sort((a, b) => a - b));
    expect(idEm(100, "ativo", etapas)).toBe("pre_negativacao");
    expect(idEm(179, "ativo", etapas)).toBe("pre_negativacao");
    expect(idEm(180, "ativo", etapas)).toBe("divida_antiga");
  });
});

describe("etapa desligada — a seguinte absorve a janela", () => {
  it("sem pré-negativação, a dívida antiga começa em D+90: quem vem depois absorve a janela", () => {
    const etapas = resolverEtapas({ etapas: [{ id: "pre_negativacao", ativa: false }] });
    expect(idEm(89, "ativo", etapas)).toBe("negociacao_recuperacao");
    expect(idEm(90, "ativo", etapas)).toBe("divida_antiga");
    expect(idEm(179, "ativo", etapas)).toBe("divida_antiga");
    expect(idEm(360, "ativo", etapas)).toBe("fim_de_linha");
    expect(etapasDaCarteira("ativo", etapas).map(e => e.id)).not.toContain("pre_negativacao");
  });

  it("sem fim de linha, a dívida antiga fica sem teto", () => {
    const etapas = resolverEtapas({ etapas: [{ id: "fim_de_linha", ativa: false }] });
    expect(idEm(1000, "ativo", etapas)).toBe("divida_antiga");
    expect(idEm(1825, "ativo", etapas)).toBe("prescrita");
  });

  it("sem lembrete de atraso, o aviso NÃO desce abaixo do piso: D+1 a D+14 ficam sem etapa", () => {
    const etapas = resolverEtapas({ etapas: [{ id: "lembrete_atraso", ativa: false }] });
    expect(idEm(1, "ativo", etapas)).toBe("sem_etapa");
    expect(idEm(14, "ativo", etapas)).toBe("sem_etapa");
    expect(idEm(15, "ativo", etapas)).toBe("aviso_suspensao");
    // Ex-cliente não tem aviso: a negociação absorve as duas janelas, desde D+1.
    expect(idEm(1, "ex_cliente", etapas)).toBe("negociacao_recuperacao");
  });
});

describe("EtapasConfigSchema — o que a rota recusa com 400", () => {
  it("etapa repetida", () => {
    const r = EtapasConfigSchema.safeParse([{ id: "lembrete_atraso" }, { id: "lembrete_atraso" }]);
    expect(r.success).toBe(false);
  });

  it("diaMax menor que diaMin", () => {
    expect(EtapasConfigSchema.safeParse([{ id: "lembrete_atraso", diaMin: 10, diaMax: 5 }]).success).toBe(false);
    expect(EtapasConfigSchema.safeParse([{ id: "lembrete_atraso", diaMin: 10, diaMax: 10 }]).success).toBe(true);
    expect(EtapasConfigSchema.safeParse([{ id: "fim_de_linha", diaMin: 400, diaMax: null }]).success).toBe(true);
  });

  it("canal 'sistema' não é sugestão para gente; responsável zero não é usuário", () => {
    expect(EtapasConfigSchema.safeParse([{ id: "lembrete_atraso", canalSugerido: "sistema" }]).success).toBe(false);
    expect(EtapasConfigSchema.safeParse([{ id: "lembrete_atraso", responsavelUserId: 0 }]).success).toBe(false);
    expect(EtapasConfigSchema.safeParse([{ id: "lembrete_atraso", responsavelUserId: null }]).success).toBe(true);
  });
});

describe("apresentação", () => {
  it("rotuloDoDia e janelaDaEtapa", () => {
    expect(rotuloDoDia(0)).toBe("D0");
    expect(rotuloDoDia(7)).toBe("D+7");
    expect(rotuloDoDia(-7)).toBe("D-7");
    expect(janelaDaEtapa(etapaPorId("lembrete_pre_vencimento")!)).toBe("D-7 → D0");
    expect(janelaDaEtapa(etapaPorId("lembrete_atraso")!)).toBe("D+1 → D+14");
    expect(janelaDaEtapa(etapaPorId("fim_de_linha")!)).toBe("D+360+");
  });

  it("clampEtapas devolve cópias ordenadas sem mexer na entrada", () => {
    const entrada: Etapa[] = [{ ...ETAPAS_PADRAO[3] }, { ...ETAPAS_PADRAO[1] }];
    const saida = clampEtapas(entrada);
    expect(saida.map(e => e.id)).toEqual(["lembrete_atraso", "negociacao_recuperacao"]);
    expect(entrada.map(e => e.id)).toEqual(["negociacao_recuperacao", "lembrete_atraso"]);
  });
});
