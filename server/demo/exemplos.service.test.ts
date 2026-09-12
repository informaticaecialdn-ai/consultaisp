import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * `cpfsDeExemplo` (item 1 do plano de 2026-09-11): a promoção da função
 * privada de `sandbox.service.test.ts` a código de produção. Este arquivo
 * testa só a LÓGICA DE SELEÇÃO (dado um retorno de
 * `storage.getCustomersByProvider`, quais três CPFs saem e com qual
 * situação) — a prova de que a carteira REAL de um sandbox tem os três
 * candidatos, e de que o migrador de exemplo é detectado pelo caminho real
 * (conector + `detectMigrator`), já existe em `sandbox.service.test.ts`.
 */

const storageMock = vi.hoisted(() => ({ getCustomersByProvider: vi.fn() }));
vi.mock("../storage", () => ({ storage: storageMock }));

import { cpfsDeExemplo } from "./exemplos.service";
import { CPFS_COMPARTILHADOS, INDICE_MIGRADOR_DE_EXEMPLO } from "./mundo-base";
import { cpfFicticio } from "./pessoas-ficticias";

const CPF_COMPARTILHADO = CPFS_COMPARTILHADOS[0];
const CPF_LIMPO = cpfFicticio(600_000); // fora de qualquer faixa reservada — so precisa nao estar em CPFS_COMPARTILHADOS
const CPF_MIGRADOR_ESPERADO = cpfFicticio(INDICE_MIGRADOR_DE_EXEMPLO);

function cliente(overrides: Partial<{ cpfCnpj: string; paymentStatus: string; status: string }>) {
  return { id: 1, cpfCnpj: "00000000000", paymentStatus: "current", status: "active", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cpfsDeExemplo", () => {
  it("devolve as tres situacoes, com o cpf certo em cada uma", async () => {
    storageMock.getCustomersByProvider.mockResolvedValue([
      cliente({ cpfCnpj: "11111111111", paymentStatus: "overdue", status: "active" }), // ruido: inadimplente proprio
      cliente({ cpfCnpj: "22222222222", status: "cancelled" }), // ruido: cancelado
      cliente({ cpfCnpj: CPF_COMPARTILHADO }), // devendo_na_rede
      cliente({ cpfCnpj: CPF_LIMPO }), // limpo
    ]);

    const exemplos = await cpfsDeExemplo(42);

    expect(exemplos.map((e) => e.situacao).sort()).toEqual(["devendo_na_rede", "limpo", "migrador_serial"]);
    expect(exemplos.find((e) => e.situacao === "limpo")?.cpf).toBe(CPF_LIMPO);
    expect(exemplos.find((e) => e.situacao === "devendo_na_rede")?.cpf).toBe(CPF_COMPARTILHADO);
    expect(exemplos.find((e) => e.situacao === "migrador_serial")?.cpf).toBe(CPF_MIGRADOR_ESPERADO);
  });

  it("cada entrada tem rotulo e descricao — o chip precisa dizer o que vai demonstrar antes do clique", async () => {
    storageMock.getCustomersByProvider.mockResolvedValue([
      cliente({ cpfCnpj: CPF_COMPARTILHADO }),
      cliente({ cpfCnpj: CPF_LIMPO }),
    ]);

    const exemplos = await cpfsDeExemplo(42);
    for (const e of exemplos) {
      expect(e.rotulo, e.situacao).toBeTruthy();
      expect(e.descricao, e.situacao).toBeTruthy();
    }
  });

  it("um cliente ativo e em dia cujo CPF e compartilhado NAO conta como 'limpo' — a historia e 'limpo aqui, devendo na rede'", async () => {
    // So o cliente compartilhado na carteira: se o filtro do 'limpo' nao
    // excluir CPFS_COMPARTILHADOS, este mesmo cliente sairia ESCOLHIDO para os
    // dois papeis — a demonstracao contaria a mesma pessoa duas vezes,
    // nenhuma das quais prova o contraste que a Tarefa 5 pede.
    storageMock.getCustomersByProvider.mockResolvedValue([cliente({ cpfCnpj: CPF_COMPARTILHADO })]);

    await expect(cpfsDeExemplo(42)).rejects.toThrow(/limpo/);
  });

  it("carteira sem candidato 'limpo' lanca, em vez de devolver um chip que nao entrega a historia", async () => {
    storageMock.getCustomersByProvider.mockResolvedValue([
      cliente({ cpfCnpj: "33333333333", paymentStatus: "overdue" }),
    ]);
    await expect(cpfsDeExemplo(42)).rejects.toThrow(/sandbox 42/);
  });

  it("carteira sem candidato 'devendo_na_rede' lanca", async () => {
    storageMock.getCustomersByProvider.mockResolvedValue([cliente({ cpfCnpj: CPF_LIMPO })]);
    await expect(cpfsDeExemplo(42)).rejects.toThrow(/devendoNaRede=faltando/);
  });

  it("o CPF do migrador serial e sempre o mesmo par fixo do mundo base, independente da carteira do sandbox", async () => {
    storageMock.getCustomersByProvider.mockResolvedValue([
      cliente({ cpfCnpj: CPF_COMPARTILHADO }),
      cliente({ cpfCnpj: CPF_LIMPO }),
    ]);
    const a = await cpfsDeExemplo(1);
    storageMock.getCustomersByProvider.mockResolvedValue([
      cliente({ cpfCnpj: CPFS_COMPARTILHADOS[1] }),
      cliente({ cpfCnpj: cpfFicticio(700_000) }),
    ]);
    const b = await cpfsDeExemplo(2);

    const migradorDe = (arr: Awaited<ReturnType<typeof cpfsDeExemplo>>) =>
      arr.find((e) => e.situacao === "migrador_serial")?.cpf;
    expect(migradorDe(a)).toBe(migradorDe(b));
    expect(migradorDe(a)).toBe(CPF_MIGRADOR_ESPERADO);
  });
});
