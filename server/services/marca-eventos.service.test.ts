/**
 * A trilha da revenda, sob contrato.
 *
 * Cada teste aqui existe por um risco concreto da decisao 15:
 *
 *  · A trilha e append-only e vai para um banco que o superadmin le meses
 *    depois. Chave PIX de repasse ou senha temporaria gravada uma vez fica
 *    gravada — e o `detalhe` de uma edicao e justamente onde esses campos
 *    passam. Se a redacao nao alcancar objeto aninhado e item de array, ela nao
 *    alcanca o formato real do dado.
 *
 *  · E, do lado oposto: redigir demais e igualmente ruim. Um evento
 *    `editar_provedor` existe para provar que o contato mudou de X para Y. Com
 *    o e-mail censurado ele nao prova nada.
 *
 *  · Gravar auditoria nao pode desfazer a acao auditada. Quando a suspensao ja
 *    aconteceu, um banco fora do ar nao pode virar 500 na cara do revendedor —
 *    ele clicaria de novo em algo que ja surtiu efeito.
 *
 *  · Acao fora do catalogo poluiria a trilha com um verbo que nenhuma tela sabe
 *    renderizar, e trilha append-only nao se limpa depois.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: log }));

/**
 * O banco e trocado pelo ponto observavel do modulo: o que ele MANDA gravar.
 * `leitura` guarda o limite que a consulta pediu — e o unico jeito de conferir
 * o teto sem um Postgres de verdade.
 */
const bd = vi.hoisted(() => ({
  values: vi.fn(async (_v: any) => {}),
  leitura: { limite: 0 },
}));

vi.mock("../db", () => ({
  db: {
    insert: () => ({ values: bd.values }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: (n: number) => {
              bd.leitura.limite = n;
              return Promise.resolve([]);
            },
          }),
        }),
      }),
    }),
  },
}));

import { registrarEventoDaMarca, listarEventosDaMarca, ACOES_DE_MARCA } from "./marca-eventos.service";

const BASE = { marcaId: 7, userId: 42, atorRole: "revendedor" as const };

/** O objeto que o servico mandou para o INSERT. */
function gravado() {
  expect(bd.values).toHaveBeenCalledTimes(1);
  return bd.values.mock.calls[0][0] as any;
}

beforeEach(() => {
  bd.values.mockReset();
  bd.values.mockResolvedValue(undefined);
  bd.leitura.limite = 0;
  log.error.mockReset();
});

describe("redacao do detalhe", () => {
  it("censura chave sensivel aninhada, dentro de array e sem olhar a caixa", async () => {
    await registrarEventoDaMarca({
      ...BASE,
      acao: "editar_marca",
      detalhe: {
        antes: { repasseChavePix: "11122233344", nomeProduto: "CredNet" },
        equipe: [
          { email: "ana@crednet.com.br", senhaTemporaria: "trocar123" },
          { email: "bruno@crednet.com.br", apiToken: "tok_vivo" },
        ],
        integracao: { credenciais: { CLIENT_SECRET: "s3cr3t" } },
      },
    });

    const d = gravado().detalhe;
    // Aninhado.
    expect(d.antes.repasseChavePix).toBe("[REDACTED]");
    // Dentro de array — o formato real de um diff de equipe.
    expect(d.equipe[0].senhaTemporaria).toBe("[REDACTED]");
    expect(d.equipe[1].apiToken).toBe("[REDACTED]");
    // Tres niveis abaixo, e em caixa alta.
    expect(d.integracao.credenciais.CLIENT_SECRET).toBe("[REDACTED]");
  });

  it("preserva o que a auditoria existe para provar", async () => {
    await registrarEventoDaMarca({
      ...BASE,
      acao: "editar_provedor",
      providerId: 3,
      detalhe: {
        antes: { contactEmail: "antigo@isp.com.br", name: "ISP Antigo" },
        depois: { contactEmail: "novo@isp.com.br", name: "ISP Novo" },
      },
    });

    const d = gravado().detalhe;
    expect(d.antes.contactEmail).toBe("antigo@isp.com.br");
    expect(d.depois.contactEmail).toBe("novo@isp.com.br");
    expect(d.depois.name).toBe("ISP Novo");
  });

  it("guarda Date como ISO em vez de objeto vazio", async () => {
    await registrarEventoDaMarca({
      ...BASE,
      acao: "pagar_fechamento",
      detalhe: { pagoEm: new Date("2026-09-10T12:00:00.000Z") },
    });

    expect(gravado().detalhe.pagoEm).toBe("2026-09-10T12:00:00.000Z");
  });

  it("sem detalhe grava objeto vazio, e nao null", async () => {
    await registrarEventoDaMarca({ ...BASE, acao: "reativar", providerId: 3 });

    const linha = gravado();
    expect(linha.detalhe).toEqual({});
    // `providerId` ausente vira null explicito: a coluna e nullable e o Drizzle
    // nao deve receber `undefined`, que ele omitiria do INSERT.
    expect(linha.providerId).toBe(3);
  });

  it("acao sobre a propria marca grava providerId nulo", async () => {
    await registrarEventoDaMarca({ ...BASE, acao: "alterar_comissao", atorRole: "superadmin" });
    expect(gravado().providerId).toBeNull();
  });
});

describe("best-effort: a acao ja aconteceu", () => {
  it("banco fora do ar nao propaga erro", async () => {
    bd.values.mockRejectedValueOnce(new Error("connection terminated"));

    await expect(
      registrarEventoDaMarca({ ...BASE, acao: "suspender", providerId: 3, detalhe: { motivo: "inadimplencia" } }),
    ).resolves.toBeUndefined();

    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("detalhe ciclico tambem nao derruba a acao", async () => {
    const ciclico: Record<string, unknown> = { nome: "loop" };
    ciclico.eu = ciclico;

    await expect(
      registrarEventoDaMarca({ ...BASE, acao: "editar_marca", detalhe: ciclico }),
    ).resolves.toBeUndefined();

    expect(bd.values).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

describe("catalogo de acoes", () => {
  it("recusa acao fora do catalogo sem gravar e sem lancar", async () => {
    await expect(
      // O tipo `AcaoDeMarca` barra isto em compilacao; o cast reproduz o que
      // chega de um `req.body` ou de um chamador em JavaScript.
      registrarEventoDaMarca({ ...BASE, acao: "apagar_tudo" as any }),
    ).resolves.toBeUndefined();

    expect(bd.values).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("aceita todas as acoes do desenho da fase 2", async () => {
    for (const acao of ACOES_DE_MARCA) {
      bd.values.mockClear();
      await registrarEventoDaMarca({ ...BASE, acao });
      expect(bd.values, acao).toHaveBeenCalledTimes(1);
    }
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe("leitura", () => {
  it("aplica o limite pedido, com teto e piso", async () => {
    await listarEventosDaMarca(7, 10);
    expect(bd.leitura.limite).toBe(10);

    await listarEventosDaMarca(7, 999_999);
    expect(bd.leitura.limite).toBe(200);

    await listarEventosDaMarca(7, 0);
    expect(bd.leitura.limite).toBe(50);

    await listarEventosDaMarca(7, -5);
    expect(bd.leitura.limite).toBe(1);
  });

  it("sem limite explicito devolve a pagina padrao", async () => {
    await listarEventosDaMarca(7);
    expect(bd.leitura.limite).toBe(50);
  });
});
