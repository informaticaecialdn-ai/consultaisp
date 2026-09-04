import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Foco: a cidade do cliente é GRAVADA canonizada.
 *
 * Medido na Amplinet (provedor 6) em 04/09/2026: mesmo com a base de endereços
 * de Embu-Guaçu carregada, 23 clientes escritos "EMBUGUAÇU" seguiam fora do
 * mapa — o geocodificador casa `customers.city` normalizada contra a cidade da
 * base, e "embuguacu" não é "embu guacu". Na barra de filtros, sete grafias da
 * mesma cidade viravam sete chips. Resolver a cidade só na hora de baixar a
 * base do IBGE não conserta nenhum dos dois: quem precisa mudar é a linha do
 * cliente.
 *
 * O Postgres não entra aqui. O que precisa de prova é o VALOR que sai para o
 * banco — no insert e no update — e que ele é o mesmo texto que a base de
 * endereços guarda. As regras de reconhecimento em si estão provadas em
 * `server/services/cidade-canonica.service.test.ts`.
 */
const chamadas = vi.hoisted(() => ({
  insert: [] as Record<string, any>[],
  update: [] as Record<string, any>[],
}));

const retornos = vi.hoisted(() => ({ existente: [] as any[] }));

const dbMock = vi.hoisted(() => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => retornos.existente }) }),
    }),
    insert: () => ({
      values: (valores: Record<string, any>) => ({
        returning: async () => { chamadas.insert.push(valores); return [{ id: 1, ...valores }]; },
      }),
    }),
    update: () => ({
      set: (valores: Record<string, any>) => ({
        where: () => ({
          returning: async () => { chamadas.update.push(valores); return [{ id: 1, ...valores }]; },
        }),
      }),
    }),
  },
  pool: {},
}));
vi.mock("../db", () => dbMock);

/**
 * ENTRAR POR `customers.storage` DIRETO TEM DE FUNCIONAR, e este import é
 * também o teste disso.
 *
 * Quando a canonização entrou aqui, o caminho `customers.storage` →
 * `cidade-canonica.service` → `municipio.service` → `area-atendida` →
 * `../storage` fechava um ciclo com o barril, e quem importasse este arquivo
 * antes do barril fazia o barril avaliar `new DatabaseStorage()` com a classe
 * ainda em TDZ — "Cannot access 'CustomersStorage' before initialization", um
 * erro que não menciona ciclo nenhum. Um talo (`vi.mock("./index")`) escondia o
 * problema aqui e deixava a mina armada para o próximo script ou rota.
 *
 * A cura foi na raiz: `area-atendida` passou a importar o barril DENTRO de
 * `resolverAreaAtendida`, e voltou a ser folha. O talo saiu de propósito — se o
 * ciclo voltar, este arquivo é o primeiro a falhar.
 */
import { CustomersStorage } from "./customers.storage";
import { normalizarCidade } from "../services/area-atendida";
import { normalizarLocalidade } from "../services/localidade";

let storage: CustomersStorage;

const doErp = (city: string | undefined, state?: string) => ({
  providerId: 6,
  cpfCnpj: "12328395074",
  name: "Cliente da Carteira",
  city,
  state,
  totalOverdueAmount: 0,
  maxDaysOverdue: 0,
  overdueInvoicesCount: 0,
  erpSource: "mk",
});

beforeEach(() => {
  chamadas.insert.length = 0;
  chamadas.update.length = 0;
  retornos.existente = [];
  storage = new CustomersStorage();
});

describe("upsertFromErp — a cidade que vai para o banco", () => {
  it("cliente novo nasce com o nome oficial do município", async () => {
    await storage.upsertFromErp(doErp("EMBUGUAÇU", "sp"));

    expect(chamadas.insert).toHaveLength(1);
    expect(chamadas.insert[0].city).toBe("Embu-Guaçu");
    expect(chamadas.insert[0].state).toBe("SP");
  });

  it("cliente que já existe é reescrito canonizado", async () => {
    // A grafia não pode oscilar entre os dois passos do sync: um varre a
    // carteira inteira, o outro detalha o inadimplente, e os dois passam aqui.
    retornos.existente = [{ id: 42, city: "EMBUGUAÇU", state: "SP" }];

    await storage.upsertFromErp(doErp("EMBU GUACU", "SP"));

    expect(chamadas.update).toHaveLength(1);
    expect(chamadas.update[0].city).toBe("Embu-Guaçu");
    expect(chamadas.update[0].state).toBe("SP");
  });

  it("texto não reconhecido é gravado como veio, no insert e no update", async () => {
    await storage.upsertFromErp(doErp("EMBU GAUCU", "SP"));
    expect(chamadas.insert[0].city).toBe("EMBU GAUCU");

    retornos.existente = [{ id: 42 }];
    await storage.upsertFromErp(doErp("PARQUE JANDAIA", "SP"));
    expect(chamadas.update[0].city).toBe("PARQUE JANDAIA");
  });

  it("cidade ausente continua sem apagar a que já estava gravada", async () => {
    // Regra antiga do upsert que segue valendo: ausência de dado novo não é
    // apagamento. Um passo do sync que não conseguiu ler o endereço não pode
    // tirar do mapa quem o outro enriqueceu.
    retornos.existente = [{ id: 42, city: "Embu-Guaçu" }];

    await storage.upsertFromErp(doErp(undefined, "SP"));

    expect(chamadas.update[0]).not.toHaveProperty("city");
    expect(chamadas.update[0].state).toBe("SP");
  });

  it("a UF do ERP não é trocada quando a cidade não resolve", async () => {
    await storage.upsertFromErp(doErp("ITAPECERICA DA SERRA", "RN"));

    expect(chamadas.insert[0].city).toBe("ITAPECERICA DA SERRA");
    expect(chamadas.insert[0].state).toBe("RN");
  });

  it("a sigla escrita no nome preenche o estado que o ERP deixou vazio", async () => {
    await storage.upsertFromErp(doErp("ITAPECERICA DA SERRA SP", undefined));

    expect(chamadas.insert[0].city).toBe("Itapecerica da Serra");
    expect(chamadas.insert[0].state).toBe("SP");
  });
});

describe("a cidade canonizada casa com a base do geocodificador", () => {
  /**
   * O geocodificador local monta a chave com `normalizarCidade` dos dois lados:
   * da cidade do cliente e de `geo_hps_bairro.cidade_norm`, que é gravada como
   * `normalizarLocalidade(nome oficial do município)`. Este teste amarra as
   * duas pontas — é a razão de a canonização existir, e ela passaria a não
   * servir para nada, em silêncio, se alguém mudasse uma das normalizações.
   */
  const chaveDaBase = (nomeOficial: string) => normalizarCidade(normalizarLocalidade(nomeOficial));

  it("o nome gravado alcança a base; a grafia crua do ERP não alcançava", async () => {
    await storage.upsertFromErp(doErp("EMBUGUAÇU", "SP"));

    const gravada = chamadas.insert[0].city as string;
    expect(normalizarCidade(gravada)).toBe(chaveDaBase("Embu-Guaçu"));
    // A prova de que o conserto valeu: a grafia como o ERP a escreveu não
    // chegava à base carregada, e o cliente ficava fora do mapa.
    expect(normalizarCidade("EMBUGUAÇU")).not.toBe(chaveDaBase("Embu-Guaçu"));
  });

  it("vale para as outras cidades da carteira medida", async () => {
    for (const [grafia, oficial] of [
      ["ITAPECERICA DA SERRA SP", "Itapecerica da Serra"],
      ["STRING:SAO PAULO", "São Paulo"],
      ["SAO LOURENCO DA SERRA", "São Lourenço da Serra"],
    ] as const) {
      chamadas.insert.length = 0;
      await storage.upsertFromErp(doErp(grafia, "SP"));
      const gravada = chamadas.insert[0].city as string;
      expect(gravada, grafia).toBe(oficial);
      expect(normalizarCidade(gravada)).toBe(chaveDaBase(oficial));
    }
  });
});
