/**
 * O risco do endereco tem que ser do IMOVEL, nao da rua.
 *
 * Medido em producao em 27/08/2026 consultando a Rua Mato Grosso, 1435: a busca
 * no ERP e por LOGRADOURO (tem que ser — filtrar por numero no servidor perde
 * metade dos vizinhos), entao voltou a rua inteira e o risco somou os
 * inadimplentes dos numeros 590 e vizinhos, anunciando "3 CPFs com
 * inadimplencia NESTE ENDERECO" para um imovel onde nao havia nenhum.
 */
import { describe, it, expect } from "vitest";

// O hash de endereco exige o salt de rede (LGPD). Definido antes dos imports
// que o leem, porque getSalt() memoriza o valor na primeira chamada.
process.env.NETWORK_CPF_SALT = process.env.NETWORK_CPF_SALT ?? "salt-de-teste-com-mais-de-32-caracteres-ok";
import { buildAddressSearchResult } from "./address-search.service";
import { chaveDeEndereco } from "./endereco-chave";
import type { RealtimeQueryResult } from "./realtime-query.service";

const cli = (nome: string, numero: string, dias: number) => ({
  cpfCnpj: `${numero}${dias}00000000`.slice(0, 11),
  name: nome, address: "Rua Mato Grosso", addressNumber: numero,
  neighborhood: "Centro", city: "Londrina", state: "PR", cep: "86010180",
  totalOverdueAmount: dias > 0 ? 500 : 0, maxDaysOverdue: dias, overdueInvoicesCount: dias > 0 ? 1 : 0,
});

const erp = (customers: any[]): RealtimeQueryResult[] => ([{
  providerId: 4, providerName: "O L I", erpSource: "ixc", ok: true, customers, latencyMs: 10,
}]);

const alvo = chaveDeEndereco({
  address: "Rua Mato Grosso", addressNumber: "1435",
  neighborhood: "Centro", city: "Londrina", state: "PR",
})!;

describe("buildAddressSearchResult — recorte pelo imovel", () => {
  it("NAO conta devedor de outro numero da mesma rua", () => {
    const r = buildAddressSearchResult("x", erp([
      cli("Alvo", "1435", 0),
      cli("Vizinho devedor", "590", 90),
      cli("Outro devedor", "259", 686),
    ]), 4, alvo);
    expect(r.risk.cpfsDistintosInadimplentes).toBe(0);
    expect(r.risk.riskLevel).toBe("baixo");
    expect(r.risk.alertas).toEqual([]);
  });

  it("conta quem esta NO numero consultado", () => {
    const r = buildAddressSearchResult("x", erp([
      cli("Alvo", "1435", 0),
      cli("Coabitante devedor", "1435", 120),
      cli("Vizinho", "590", 90),
    ]), 4, alvo);
    expect(r.risk.cpfsDistintosInadimplentes).toBe(1);
    expect(r.risk.riskLevel).toBe("moderado");
  });

  it("dois devedores no mesmo imovel elevam para alto", () => {
    const r = buildAddressSearchResult("x", erp([
      cli("A", "1435", 100), cli("B", "1435", 200), cli("Vizinho", "590", 90),
    ]), 4, alvo);
    expect(r.risk.cpfsDistintosInadimplentes).toBe(2);
    expect(r.risk.riskLevel).toBe("alto");
  });

  it("sem alvo, mantem o comportamento antigo (rua inteira)", () => {
    const r = buildAddressSearchResult("x", erp([
      cli("Alvo", "1435", 0), cli("Vizinho", "590", 90),
    ]), 4);
    expect(r.risk.cpfsDistintosInadimplentes).toBe(1);
  });

  it("bairro diferente no mesmo numero nao entra", () => {
    const r = buildAddressSearchResult("x", erp([
      cli("Alvo", "1435", 0),
      { ...cli("Outro bairro", "1435", 300), neighborhood: "Jardim Novo" },
    ]), 4, alvo);
    expect(r.risk.cpfsDistintosInadimplentes).toBe(0);
  });
});
