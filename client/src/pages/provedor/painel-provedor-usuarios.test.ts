/**
 * O aviso da aba Usuarios quando esta sessao e o sandbox publico da
 * demonstracao.
 *
 * Ate esta rodada os dois botoes (Novo Usuario e excluir usuario) ficavam
 * totalmente clicaveis para um visitante da demonstracao e so revelavam a
 * trava DEPOIS de um pedido recusado — o 403 de `recusarEmSandbox`
 * (server/routes/provider.routes.ts), com a mensagem
 * `MENSAGEM_EQUIPE_CONGELADA_NO_SANDBOX`. Quem tropeca na regra em vez de
 * le-la antes.
 *
 * `avisoEquipeBloqueadaNoSandbox` reaproveita `ehInstanciaDeDemonstracao`
 * (FaixaDemonstracao.tsx) — o MESMO par de sinais (demoMode do servidor +
 * prefixo `sandbox-` do subdominio) — em vez de reimplementar a checagem.
 */
import { describe, it, expect } from "vitest";
import { avisoEquipeBloqueadaNoSandbox } from "./painel-provedor";

describe("avisoEquipeBloqueadaNoSandbox", () => {
  it("sandbox de verdade (demoMode ligado + prefixo sandbox-): devolve o aviso", () => {
    const aviso = avisoEquipeBloqueadaNoSandbox(true, "sandbox-ab12cd");

    expect(aviso).not.toBeNull();
    expect(aviso).toContain("não pode ser alterada");
    expect(aviso).toContain("24 horas");
  });

  /**
   * Os DOIS sinais, exigidos JUNTOS — mesma defesa de
   * `ehInstanciaDeDemonstracao`: um provedor de VERDADE cujo subdominio por
   * acidente comecasse com "sandbox-" nao pode perder os proprios botoes so
   * por causa do prefixo. Sem `demoMode` do servidor, nao ha aviso.
   */
  it("fora do modo demonstracao, o prefixo sozinho nao basta", () => {
    expect(avisoEquipeBloqueadaNoSandbox(false, "sandbox-ab12cd")).toBeNull();
    expect(avisoEquipeBloqueadaNoSandbox(undefined, "sandbox-ab12cd")).toBeNull();
  });

  it("demoMode ligado mas subdominio nao comeca com sandbox-: nao avisa", () => {
    expect(avisoEquipeBloqueadaNoSandbox(true, "provedor-de-verdade")).toBeNull();
  });

  it("sem subdominio (null ou ausente): nao avisa", () => {
    expect(avisoEquipeBloqueadaNoSandbox(true, null)).toBeNull();
    expect(avisoEquipeBloqueadaNoSandbox(true, undefined)).toBeNull();
  });
});
