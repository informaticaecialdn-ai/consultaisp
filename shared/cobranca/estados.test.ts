/**
 * As duas máquinas de estado, par a par, e o vocabulário que a rota e a tela
 * dividem: toda chave tem rótulo, e toda mudança de status tem o evento que
 * implica.
 */
import { describe, expect, it } from "vitest";
import {
  CANAIS_DE_CONTATO,
  CANAIS_HUMANOS,
  CARTEIRAS,
  MOTIVO_CASO_FECHADO,
  MOTIVO_NEGATIVADO_NAO_VOLTA,
  MOTIVO_NEGOCIACAO_ENCERRADA,
  PRIORIDADES,
  RESULTADOS_DE_CONTATO,
  ROTULO_CANAL,
  ROTULO_CARTEIRA,
  ROTULO_PRIORIDADE,
  ROTULO_RESULTADO,
  ROTULO_STATUS_DE_CASO,
  ROTULO_STATUS_DE_NEGOCIACAO,
  ROTULO_STATUS_DE_PARCELA,
  ROTULO_TIPO_DE_EVENTO,
  ROTULO_TIPO_DE_NEGOCIACAO,
  STATUS_ABERTOS_DE_CASO,
  STATUS_DE_CASO,
  STATUS_DE_NEGOCIACAO,
  STATUS_DE_PARCELA,
  STATUS_FECHADOS_DE_CASO,
  STATUS_FINAIS_DE_NEGOCIACAO,
  STATUS_VIVOS_DE_NEGOCIACAO,
  TIPOS_DE_EVENTO,
  TIPOS_DE_NEGOCIACAO,
  TRANSICOES_DE_CASO,
  TRANSICOES_DE_NEGOCIACAO,
  casoFechado,
  eventoDaTransicaoDeCaso,
  negociacaoEncerrada,
  RESULTADOS_QUE_CONVERSARAM,
  statusAposContato,
  statusAposNegociacaoDesfeita,
  transicaoDeCaso,
  transicaoDeNegociacao,
} from "./estados";

describe("status de caso — abertos e fechados", () => {
  it("pago, baixado, encerrado e cancelamento fecham; negativado continua aberto", () => {
    expect([...STATUS_FECHADOS_DE_CASO]).toEqual(["pago", "baixado", "encerrado", "cancelamento"]);
    expect(casoFechado("negativado")).toBe(false);
    expect(casoFechado("em_contato")).toBe(false);
    expect(casoFechado("pago")).toBe(true);
    expect(casoFechado("cancelamento")).toBe(true);
    expect(casoFechado("qualquer_coisa")).toBe(false);
  });

  it("abertos e fechados partem a lista inteira, sem sobra", () => {
    expect([...STATUS_ABERTOS_DE_CASO, ...STATUS_FECHADOS_DE_CASO].sort()).toEqual([...STATUS_DE_CASO].sort());
  });

  it("a lista está na ordem do kanban: a contatar, em contato, negociando, acordo, pago | cancelamento; o resto recolhido", () => {
    const vivos = STATUS_DE_CASO.filter(s => !casoFechado(s) || s === "pago" || s === "cancelamento");
    expect(vivos.indexOf("aberto")).toBeLessThan(vivos.indexOf("em_contato"));
    expect(vivos.indexOf("em_contato")).toBeLessThan(vivos.indexOf("negociando"));
    expect(vivos.indexOf("negociando")).toBeLessThan(vivos.indexOf("acordo_ativo"));
    expect(vivos.indexOf("acordo_ativo")).toBeLessThan(vivos.indexOf("pago"));
    expect(vivos.indexOf("pago")).toBeLessThan(vivos.indexOf("cancelamento"));
  });
});

describe("transicaoDeCaso", () => {
  it("o fluxo feliz: aberto → em contato → negociando → acordo ativo → pago", () => {
    expect(transicaoDeCaso("aberto", "em_contato")).toEqual({ ok: true });
    expect(transicaoDeCaso("em_contato", "negociando")).toEqual({ ok: true });
    expect(transicaoDeCaso("negociando", "acordo_ativo")).toEqual({ ok: true });
    expect(transicaoDeCaso("acordo_ativo", "pago")).toEqual({ ok: true });
  });

  it("em contato pula direto para negociação ou acordo, e esfria de volta à fila", () => {
    expect(transicaoDeCaso("aberto", "negociando")).toEqual({ ok: true });
    expect(transicaoDeCaso("em_contato", "acordo_ativo")).toEqual({ ok: true });
    expect(transicaoDeCaso("em_contato", "aberto")).toEqual({ ok: true });
    expect(transicaoDeCaso("em_contato", "negativado")).toEqual({ ok: true });
  });

  it("proposta recusada e acordo quebrado devolvem o caso à fila ou à conversa", () => {
    expect(transicaoDeCaso("negociando", "aberto")).toEqual({ ok: true });
    expect(transicaoDeCaso("negociando", "em_contato")).toEqual({ ok: true });
    expect(transicaoDeCaso("acordo_ativo", "aberto")).toEqual({ ok: true });
    expect(transicaoDeCaso("acordo_ativo", "em_contato")).toEqual({ ok: true });
    expect(transicaoDeCaso("acordo_ativo", "negociando")).toEqual({ ok: true });
  });

  it("de qualquer aberto se pode pagar, baixar, encerrar ou cancelar", () => {
    for (const de of STATUS_ABERTOS_DE_CASO) {
      for (const para of STATUS_FECHADOS_DE_CASO) expect(transicaoDeCaso(de, para)).toEqual({ ok: true });
    }
  });

  it("todo status vivo vai a cancelamento — o contrato acabou, seja em que coluna o caso estiver", () => {
    for (const de of STATUS_ABERTOS_DE_CASO) expect(transicaoDeCaso(de, "cancelamento")).toEqual({ ok: true });
  });

  it("negativar vale de aberto, em contato, negociando e acordo ativo", () => {
    expect(transicaoDeCaso("aberto", "negativado")).toEqual({ ok: true });
    expect(transicaoDeCaso("em_contato", "negativado")).toEqual({ ok: true });
    expect(transicaoDeCaso("negociando", "negativado")).toEqual({ ok: true });
    expect(transicaoDeCaso("acordo_ativo", "negativado")).toEqual({ ok: true });
  });

  it("negativado segue para negociação, acordo ou desfecho — nunca de volta à fila nem à conversa", () => {
    expect(transicaoDeCaso("negativado", "negociando")).toEqual({ ok: true });
    expect(transicaoDeCaso("negativado", "acordo_ativo")).toEqual({ ok: true });
    expect(transicaoDeCaso("negativado", "pago")).toEqual({ ok: true });
    expect(transicaoDeCaso("negativado", "cancelamento")).toEqual({ ok: true });
    expect(transicaoDeCaso("negativado", "aberto")).toEqual({ ok: false, motivo: MOTIVO_NEGATIVADO_NAO_VOLTA });
    expect(transicaoDeCaso("negativado", "em_contato")).toEqual({ ok: false, motivo: MOTIVO_NEGATIVADO_NAO_VOLTA });
  });

  it("fechado é definitivo, para qualquer destino — cancelamento incluso", () => {
    for (const de of STATUS_FECHADOS_DE_CASO) {
      for (const para of STATUS_DE_CASO) {
        if (para === de) continue;
        expect(transicaoDeCaso(de, para)).toEqual({ ok: false, motivo: MOTIVO_CASO_FECHADO });
      }
      expect(TRANSICOES_DE_CASO[de]).toEqual([]);
    }
  });

  it("mesmo status não é transição", () => {
    expect(transicaoDeCaso("aberto", "aberto")).toEqual({ ok: false, motivo: 'O caso já está em "Aberto".' });
    expect(transicaoDeCaso("pago", "pago").ok).toBe(false);
  });

  it("a tabela e a função dizem a mesma coisa para todos os pares", () => {
    for (const de of STATUS_DE_CASO) {
      for (const para of STATUS_DE_CASO) {
        expect(transicaoDeCaso(de, para).ok).toBe(de !== para && TRANSICOES_DE_CASO[de].includes(para));
      }
    }
  });
});

describe("statusAposNegociacaoDesfeita — para onde o caso volta", () => {
  it("negativado fica negativado: a proposta não desfez a negativação", () => {
    expect(statusAposNegociacaoDesfeita("negativado")).toBe("negativado");
  });

  it("todo o resto volta à fila", () => {
    for (const s of STATUS_DE_CASO) {
      if (s === "negativado") continue;
      expect(statusAposNegociacaoDesfeita(s)).toBe("aberto");
    }
    expect(statusAposNegociacaoDesfeita(null)).toBe("aberto");
    expect(statusAposNegociacaoDesfeita(undefined)).toBe("aberto");
  });

  it("o destino é sempre um status que a máquina aceita de negociando e de acordo ativo", () => {
    for (const s of STATUS_DE_CASO) {
      const destino = statusAposNegociacaoDesfeita(s);
      expect(TRANSICOES_DE_CASO.negociando).toContain(destino);
      expect(TRANSICOES_DE_CASO.acordo_ativo).toContain(destino);
    }
  });
});

describe("transicaoDeNegociacao", () => {
  it("proposta → aceita → ativa → cumprida", () => {
    expect(transicaoDeNegociacao("proposta", "aceita")).toEqual({ ok: true });
    expect(transicaoDeNegociacao("aceita", "ativa")).toEqual({ ok: true });
    expect(transicaoDeNegociacao("ativa", "cumprida")).toEqual({ ok: true });
  });

  it("proposta não pula para ativa nem para cumprida", () => {
    expect(transicaoDeNegociacao("proposta", "ativa").ok).toBe(false);
    expect(transicaoDeNegociacao("proposta", "cumprida").ok).toBe(false);
    expect(transicaoDeNegociacao("proposta", "ativa")).toEqual({ ok: false, motivo: 'De "Proposta" não se vai para "Ativa".' });
  });

  it("aceita sem entrada quebra; ativa pode quebrar ou ser cancelada numa renegociação", () => {
    expect(transicaoDeNegociacao("aceita", "quebrada")).toEqual({ ok: true });
    expect(transicaoDeNegociacao("aceita", "cancelada")).toEqual({ ok: true });
    expect(transicaoDeNegociacao("ativa", "quebrada")).toEqual({ ok: true });
    expect(transicaoDeNegociacao("ativa", "cancelada")).toEqual({ ok: true });
  });

  it("cumprida, quebrada e cancelada não mudam mais", () => {
    for (const de of STATUS_FINAIS_DE_NEGOCIACAO) {
      expect(negociacaoEncerrada(de)).toBe(true);
      for (const para of STATUS_DE_NEGOCIACAO) {
        if (para === de) continue;
        expect(transicaoDeNegociacao(de, para)).toEqual({ ok: false, motivo: MOTIVO_NEGOCIACAO_ENCERRADA });
      }
    }
    expect(negociacaoEncerrada("ativa")).toBe(false);
  });

  it("vivas e finais partem a lista inteira, sem sobra", () => {
    expect([...STATUS_VIVOS_DE_NEGOCIACAO, ...STATUS_FINAIS_DE_NEGOCIACAO].sort()).toEqual([...STATUS_DE_NEGOCIACAO].sort());
  });

  it("a tabela e a função dizem a mesma coisa para todos os pares", () => {
    for (const de of STATUS_DE_NEGOCIACAO) {
      for (const para of STATUS_DE_NEGOCIACAO) {
        expect(transicaoDeNegociacao(de, para).ok).toBe(de !== para && TRANSICOES_DE_NEGOCIACAO[de].includes(para));
      }
    }
  });
});

describe("statusAposContato — a esteira anda pelo trabalho feito", () => {
  it("caso aberto + conversa de verdade vai para em contato", () => {
    expect(statusAposContato("aberto", "falou")).toBe("em_contato");
    expect(statusAposContato("aberto", "promessa_pagamento")).toBe("em_contato");
  });

  it("tentativa não é conversa: não atendeu, caixa postal e número errado não movem nada", () => {
    for (const resultado of ["nao_atendeu", "caixa_postal", "numero_errado"]) {
      expect(statusAposContato("aberto", resultado), resultado).toBeNull();
    }
    // Sem resultado registrado não há prova de conversa — ausência não move o caso.
    expect(statusAposContato("aberto", null)).toBeNull();
    expect(statusAposContato("aberto", undefined)).toBeNull();
  });

  it("recusou não muda status (decisão do dono): o cliente disse não, o caso continua na fila", () => {
    expect(statusAposContato("aberto", "recusou")).toBeNull();
    expect([...RESULTADOS_QUE_CONVERSARAM]).toEqual(["falou", "promessa_pagamento"]);
  });

  it("uma regra só: nenhum outro status é tocado pelo contato", () => {
    for (const status of STATUS_DE_CASO.filter(s => s !== "aberto")) {
      expect(statusAposContato(status, "falou"), status).toBeNull();
    }
  });

  it("o destino é uma transição que a máquina de estados autoriza", () => {
    const destino = statusAposContato("aberto", "falou");
    expect(destino).not.toBeNull();
    expect(transicaoDeCaso("aberto", destino as typeof STATUS_DE_CASO[number])).toEqual({ ok: true });
    // E o vocabulário dos resultados é o mesmo da lista oficial.
    for (const r of RESULTADOS_QUE_CONVERSARAM) expect(RESULTADOS_DE_CONTATO).toContain(r);
  });
});

describe("eventoDaTransicaoDeCaso — o rastro na linha do tempo", () => {
  it("entrar em negociação, fechar acordo, quebrar acordo", () => {
    expect(eventoDaTransicaoDeCaso("aberto", "negociando")).toBe("negociacao_proposta");
    expect(eventoDaTransicaoDeCaso("em_contato", "negociando")).toBe("negociacao_proposta");
    expect(eventoDaTransicaoDeCaso("negativado", "negociando")).toBe("negociacao_proposta");
    expect(eventoDaTransicaoDeCaso("negociando", "acordo_ativo")).toBe("acordo_aceito");
    expect(eventoDaTransicaoDeCaso("acordo_ativo", "aberto")).toBe("acordo_quebrado");
    expect(eventoDaTransicaoDeCaso("acordo_ativo", "em_contato")).toBe("acordo_quebrado");
    expect(eventoDaTransicaoDeCaso("acordo_ativo", "negociando")).toBe("acordo_quebrado");
  });

  it("negativar e encerrar", () => {
    expect(eventoDaTransicaoDeCaso("aberto", "negativado")).toBe("negativacao");
    expect(eventoDaTransicaoDeCaso("acordo_ativo", "pago")).toBe("encerramento");
    expect(eventoDaTransicaoDeCaso("aberto", "baixado")).toBe("encerramento");
    expect(eventoDaTransicaoDeCaso("negativado", "encerrado")).toBe("encerramento");
  });

  it("cancelamento tem evento próprio, de qualquer status vivo — é ele que carrega o motivo", () => {
    for (const de of STATUS_ABERTOS_DE_CASO) expect(eventoDaTransicaoDeCaso(de, "cancelamento")).toBe("cancelamento");
  });

  it("proposta recusada e a conversa (aberto ↔ em contato) não têm evento próprio: o contato já contou a história", () => {
    expect(eventoDaTransicaoDeCaso("negociando", "aberto")).toBeNull();
    expect(eventoDaTransicaoDeCaso("negociando", "em_contato")).toBeNull();
    expect(eventoDaTransicaoDeCaso("aberto", "em_contato")).toBeNull();
    expect(eventoDaTransicaoDeCaso("em_contato", "aberto")).toBeNull();
  });

  it("todo evento implicado existe no vocabulário", () => {
    for (const de of STATUS_DE_CASO) {
      for (const para of STATUS_DE_CASO) {
        const evento = eventoDaTransicaoDeCaso(de, para);
        if (evento !== null) expect(TIPOS_DE_EVENTO).toContain(evento);
      }
    }
  });
});

describe("vocabulário — toda chave tem rótulo, e só ela", () => {
  const mesmasChaves = (lista: readonly string[], rotulos: Record<string, string>) => {
    expect(Object.keys(rotulos).sort()).toEqual([...lista].sort());
    for (const chave of lista) expect(rotulos[chave].length).toBeGreaterThan(0);
  };

  it("caso, negociação, parcela", () => {
    mesmasChaves(STATUS_DE_CASO, ROTULO_STATUS_DE_CASO);
    mesmasChaves(STATUS_DE_NEGOCIACAO, ROTULO_STATUS_DE_NEGOCIACAO);
    mesmasChaves(STATUS_DE_PARCELA, ROTULO_STATUS_DE_PARCELA);
    mesmasChaves(TIPOS_DE_NEGOCIACAO, ROTULO_TIPO_DE_NEGOCIACAO);
  });

  it("linha do tempo, canal, resultado, prioridade, carteira", () => {
    mesmasChaves(TIPOS_DE_EVENTO, ROTULO_TIPO_DE_EVENTO);
    mesmasChaves(CANAIS_DE_CONTATO, ROTULO_CANAL);
    mesmasChaves(RESULTADOS_DE_CONTATO, ROTULO_RESULTADO);
    mesmasChaves(PRIORIDADES, ROTULO_PRIORIDADE);
    mesmasChaves(CARTEIRAS, ROTULO_CARTEIRA);
  });

  it("os canais humanos são os de contato menos 'sistema'", () => {
    expect([...CANAIS_HUMANOS]).toEqual(CANAIS_DE_CONTATO.filter(c => c !== "sistema"));
  });

  it("os valores batem com o schema autorizado, letra por letra", () => {
    expect([...STATUS_DE_CASO]).toEqual([
      "aberto", "em_contato", "negociando", "acordo_ativo", "pago", "baixado", "negativado", "encerrado", "cancelamento",
    ]);
    expect([...STATUS_DE_NEGOCIACAO]).toEqual(["proposta", "aceita", "ativa", "cumprida", "quebrada", "cancelada"]);
    expect([...STATUS_DE_PARCELA]).toEqual(["pendente", "paga", "atrasada", "cancelada"]);
    expect([...TIPOS_DE_NEGOCIACAO]).toEqual(["parcelamento", "quitacao_desconto", "baixa_negociada"]);
    expect([...CARTEIRAS]).toEqual(["ativo", "ex_cliente"]);
    expect([...TIPOS_DE_EVENTO]).toEqual([
      "contato", "promessa", "negociacao_proposta", "acordo_aceito", "acordo_quebrado", "parcela_paga",
      "etapa_mudou", "responsavel_mudou", "nota", "suspensao", "negativacao", "encerramento", "cancelamento",
    ]);
    expect([...CANAIS_DE_CONTATO]).toEqual(["telefone", "whatsapp", "email", "presencial", "sistema"]);
    expect([...RESULTADOS_DE_CONTATO]).toEqual(["falou", "nao_atendeu", "caixa_postal", "promessa_pagamento", "recusou", "numero_errado"]);
  });
});
