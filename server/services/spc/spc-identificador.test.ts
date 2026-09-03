import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { consultarSpc, _resetTravaCredencialParaTestes } from "./spc.service";
import { logger } from "../../logger";

/**
 * O identificador da consulta no cliente do SPC.
 *
 * O ponto que erra facil: `chamar` REPETE a chamada HTTP quando o SPC cai
 * (withResilience, `retries: 1`). O codigo identifica a consulta LOGICA — a que
 * o provedor viveu e levara ao suporte — e nao a tentativa de rede. Duas
 * tentativas, um codigo so.
 *
 * O segundo ponto: o `protocolo` que o SPC devolve NAO e este codigo. Aquele e
 * o numero deles, so existe quando a consulta deu certo, e serve para reclamar
 * com o SPC. O nosso existe mesmo quando o SPC recusa.
 */

const CODIGO = "CI-2609-K7F3M2";
const CPF = "00752477714";

const fixture = readFileSync(join(__dirname, "__fixtures__", "pf-limpo-com-score.xml"), "utf8");

const resposta = (status: number, body: string) =>
  ({ status, ok: status < 400, text: async () => body, headers: new Headers() } as unknown as Response);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.SPC_USERNAME = "000000000";
  process.env.SPC_PASSWORD = "senha-de-teste";
  process.env.SPC_WSDL_URL = "https://exemplo.invalido/spc/remoting/ws/consulta/consultaWebService";
  delete process.env.SPC_INSUMOS_OPCIONAIS;
  _resetTravaCredencialParaTestes();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(logger, "info").mockImplementation((() => logger) as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetTravaCredencialParaTestes();
});

/** As linhas de log da consulta, na ordem. */
function linhas() {
  return vi.mocked(logger.info).mock.calls.map(([ctx, msg]: any[]) => ({ ctx, msg: String(msg ?? "") }));
}

describe("consultarSpc com identificador", () => {
  it("carimba a abertura e o encerramento da consulta", async () => {
    fetchMock.mockResolvedValue(resposta(200, fixture));

    await consultarSpc(CPF, { consultaId: CODIGO });

    const abertura = linhas().find(l => l.msg === "[SPC] consulta iniciada");
    const fim = linhas().find(l => l.msg === "[SPC] consulta concluída");
    expect(abertura?.ctx.consultaId).toBe(CODIGO);
    expect(fim?.ctx.consultaId).toBe(CODIGO);
  });

  it("o SPC caiu e a chamada foi repetida: um codigo so para as duas tentativas", async () => {
    fetchMock
      .mockResolvedValueOnce(resposta(503, "<html>Service Unavailable</html>"))
      .mockResolvedValueOnce(resposta(200, fixture));

    await consultarSpc(CPF, { consultaId: CODIGO });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const daConsulta = linhas().filter(l => l.msg.startsWith("[SPC] consulta"));
    expect(daConsulta).toHaveLength(2);
    expect(new Set(daConsulta.map(l => l.ctx.consultaId))).toEqual(new Set([CODIGO]));
  }, 15_000);

  it("o nosso codigo nao e o protocolo do SPC — eles convivem na mesma linha", async () => {
    fetchMock.mockResolvedValue(resposta(200, fixture));

    const resultado = await consultarSpc(CPF, { consultaId: CODIGO });

    const fim = linhas().find(l => l.msg === "[SPC] consulta concluída");
    expect(fim?.ctx.protocolo).toBe(resultado.protocolo);
    expect(fim?.ctx.consultaId).toBe(CODIGO);
    expect(resultado.protocolo).not.toBe(CODIGO);
  });

  it("o documento continua mascarado — o codigo nao abre espaco para o CPF no log", async () => {
    fetchMock.mockResolvedValue(resposta(200, fixture));

    await consultarSpc(CPF, { consultaId: CODIGO });

    for (const linha of linhas()) {
      expect(JSON.stringify(linha.ctx)).not.toContain(CPF);
    }
    expect(linhas()[0].ctx.doc).toBe("007***");
  });

  it("sem codigo a consulta segue igual — o parametro e opcional", async () => {
    fetchMock.mockResolvedValue(resposta(200, fixture));

    const resultado = await consultarSpc(CPF);

    expect(resultado.protocolo).toBeTruthy();
    expect(linhas().find(l => l.msg === "[SPC] consulta iniciada")?.ctx.consultaId).toBeUndefined();
  });
});
