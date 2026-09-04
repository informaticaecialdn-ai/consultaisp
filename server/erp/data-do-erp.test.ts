/**
 * A leitura de data vinda de ERP.
 *
 * O caso que motivou: o SGP devolve `data_status` como "2024-10-04 11:16:49" no
 * `listacontrato` e `dataCadastro` como "20/03/2024 11:43:25" no
 * `consultacliente`. O mesmo ERP, dois formatos. `new Date(texto)` sobre o
 * brasileiro devolve `Invalid Date` num runtime e uma data ERRADA em outro, com
 * mes e dia trocados — e essa e a pior das duas, porque entra em silencio: um
 * corte de 5 de marco viraria 3 de maio, e o score pesa quanto tempo faz.
 */
import { describe, it, expect } from "vitest";
import { dataDoErp } from "./data-do-erp";

/** Ano-mes-dia local, para comparar sem esbarrar em fuso. */
const ymd = (d: Date | undefined) =>
  d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("dataDoErp", () => {
  it("le os dois formatos que o SGP devolve, medidos em producao", () => {
    expect(ymd(dataDoErp("2024-10-04 11:16:49"))).toBe("2024-10-04");
    expect(ymd(dataDoErp("20/03/2024 11:43:25"))).toBe("2024-03-20");
  });

  it("le tambem sem a hora", () => {
    expect(ymd(dataDoErp("2024-10-04"))).toBe("2024-10-04");
    expect(ymd(dataDoErp("20/03/2024"))).toBe("2024-03-20");
  });

  it("NAO troca dia por mes no formato brasileiro", () => {
    // O erro que passa despercebido: 05/03 e 5 de marco, nunca 3 de maio.
    expect(ymd(dataDoErp("05/03/2024"))).toBe("2024-03-05");
    // E o inverso: 2024-05-03 e 3 de maio, nunca 5 de marco.
    expect(ymd(dataDoErp("2024-05-03"))).toBe("2024-05-03");
  });

  it("aceita o T do ISO alem do espaco do Django", () => {
    expect(ymd(dataDoErp("2024-10-04T11:16:49"))).toBe("2024-10-04");
    expect(ymd(dataDoErp("2024-10-04T11:16:49Z"))).toBe("2024-10-04");
  });

  it("devolve undefined para o que nao sabe ler — nunca uma data inventada", () => {
    expect(dataDoErp("")).toBeUndefined();
    expect(dataDoErp(null)).toBeUndefined();
    expect(dataDoErp(undefined)).toBeUndefined();
    expect(dataDoErp("None")).toBeUndefined();
    expect(dataDoErp("ontem")).toBeUndefined();
    expect(dataDoErp("04-10-2024")).toBeUndefined();   // formato que ninguem mandou
  });

  it("recusa ano absurdo, que e campo vazio convertido", () => {
    // "0000-00-00" e "9999-12-31" aparecem em cadastro de ERP com mais
    // frequencia do que se imagina, e passariam por qualquer checagem de NaN.
    expect(dataDoErp("0001-01-01")).toBeUndefined();
    expect(dataDoErp("9999-12-31")).toBeUndefined();
    expect(dataDoErp("31/12/9999")).toBeUndefined();
  });

  it("data de verdade nas pontas do intervalo aceito continua passando", () => {
    expect(ymd(dataDoErp("1990-01-01"))).toBe("1990-01-01");
    expect(ymd(dataDoErp("2100-12-31"))).toBe("2100-12-31");
  });
});
