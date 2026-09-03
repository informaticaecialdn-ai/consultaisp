import { describe, expect, it } from "vitest";
import {
  calcularPrazoRetirada,
  equipamentoFoiRecuperado,
  equipamentoTemRetiradaPendente,
  faixaIdadeOcorrencia,
  faixaValorEquipamento,
  STATUS_EQUIPAMENTO_PENDENTE,
  validarSinalBureau,
} from "./equipment-recovery-rules";

describe("STATUS_EQUIPAMENTO_PENDENTE — a lista do SQL e o predicado da memória são a mesma coisa", () => {
  it("todo status da lista é pendente para o predicado, legados incluídos", () => {
    for (const status of STATUS_EQUIPAMENTO_PENDENTE) expect(equipamentoTemRetiradaPendente(status)).toBe(true);
    // Os três legados existem em base importada: sem eles o kanban perde a fila que a lista mostra.
    expect(STATUS_EQUIPAMENTO_PENDENTE).toEqual(expect.arrayContaining(["retido", "em_cobranca", "not_returned"]));
  });

  it("o que o predicado nega não está na lista", () => {
    for (const status of ["em_comodato", "installed", "recuperado_triagem", "baixado", "devolvido"]) {
      expect(equipamentoTemRetiradaPendente(status)).toBe(false);
      expect(STATUS_EQUIPAMENTO_PENDENTE as readonly string[]).not.toContain(status);
    }
  });
});

describe("regras de recuperação de equipamentos", () => {
  it("calcula 60 dias corridos a partir da rescisão", () => {
    expect(calcularPrazoRetirada(new Date("2026-01-10T12:00:00Z")).toISOString())
      .toBe("2026-03-11T12:00:00.000Z");
  });

  it.each(["retirada_pendente", "nao_localizado", "retido", "em_cobranca", "not_returned"])(
    "reconhece %s como pendência de retirada",
    status => expect(equipamentoTemRetiradaPendente(status)).toBe(true),
  );

  it.each(["recuperado_triagem", "disponivel_reuso", "devolvido", "returned", "baixado"])(
    "reconhece %s como recuperado ou encerrado",
    status => expect(equipamentoFoiRecuperado(status)).toBe(true),
  );

  it("cria faixas de idade e valor sem revelar o dado exato", () => {
    expect(faixaIdadeOcorrencia(new Date("2026-01-01"), new Date("2026-01-20"))).toBe("16-30 dias");
    expect(faixaValorEquipamento(680)).toBe("R$ 500 - R$ 1.000");
  });
});

describe("publicação do sinal no bureau", () => {
  const base = {
    deadlineAt: new Date("2026-03-02T00:00:00Z"),
    proofReference: "OS-4821",
    customerNotifiedAt: new Date("2026-01-05T00:00:00Z"),
    disputedAt: null,
    now: new Date("2026-02-01T00:00:00Z"),
  };

  it("aceita recusa expressa com prova, notificação e prazo vigente", () => {
    expect(validarSinalBureau({ ...base, attemptResults: ["recusa_expressa"] })).toEqual({ ok: true });
  });

  it("aceita duas ausências em horários confirmados", () => {
    expect(validarSinalBureau({
      ...base,
      attemptResults: ["ausente_horario_confirmado", "ausente_horario_confirmado"],
    })).toEqual({ ok: true });
  });

  it("bloqueia informação sem evidência operacional suficiente", () => {
    const result = validarSinalBureau({ ...base, attemptResults: ["sem_resposta"] });
    expect(result.ok).toBe(false);
  });

  it("bloqueia contestação e prazo expirado", () => {
    expect(validarSinalBureau({ ...base, disputedAt: new Date(), attemptResults: ["recusa_expressa"] }).ok).toBe(false);
    expect(validarSinalBureau({ ...base, deadlineAt: new Date("2026-01-31"), attemptResults: ["recusa_expressa"] }).ok).toBe(false);
  });
});
