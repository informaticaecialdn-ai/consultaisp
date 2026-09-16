import { describe, expect, it } from "vitest";
import { avaliarCandidatoAoContato } from "./elegibilidade-chat";
import { resolverEtapas } from "./regua";

const agora = new Date("2026-09-14T14:00:00Z");
const avaliar = (c: Parameters<typeof avaliarCandidatoAoContato>[0]) => avaliarCandidatoAoContato(c, ["ativo", "ex_cliente"], resolverEtapas(null), agora);
describe("elegibilidade compartilhada da agenda e da prévia", () => {
  it("usa a carteira atual e não envia pelo caso de outra carteira", () => {
    expect(avaliar({ id: 1, carteira: "ex_cliente", carteiraDoCaso: "ativo", diasAtraso: 40 }).elegivel).toBe(false);
    expect(avaliar({ id: 1, carteira: null, diasAtraso: 40 }).elegivel).toBe(false);
  });
  it("respeita próximo contato, telefone e vulnerabilidade", () => {
    for (const extra of [{ proximoContatoEm: "2026-10-01" }, { telefoneValido: false }, { tom: "humanizado_vulneravel" }]) {
      expect(avaliar({ id: 1, carteira: "ativo", diasAtraso: 10, ...extra }).elegivel).toBe(false);
    }
  });
  it("ex-cliente sem DNA pode receber abertura neutra na sua etapa", () => {
    const r = avaliar({ id: 1, carteira: "ex_cliente", diasAtraso: 20, tom: "boas_vindas", quadrante: "A1" });
    expect(r.elegivel).toBe(true);
    expect(r.orientacao.tom).toBe("cordial");
    expect(r.orientacao.quadrante).toBeNull();
    expect(r.orientacao.etapa?.id).toBe("negociacao_recuperacao");
  });
});
