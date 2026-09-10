import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Componente .tsx não renderiza em teste (sem DOM): o contrato é conferido no FONTE. */
const fonte = readFileSync(new URL("./FormularioZapSign.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const pagina = readFileSync(new URL("../../pages/admin/admin-provedor.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("FormularioZapSign", () => {
  it("fala com as três rotas do superadmin e só com elas", () => {
    expect(fonte).toContain("`/api/admin/providers/${providerId}/assinatura/zapsign`");
    expect(fonte).toContain("`/api/admin/providers/${providerId}/assinatura/zapsign/ativar`");
    expect(fonte).not.toContain("/api/provider/");
  });
  it("o token é campo de senha, nunca preenchido pelo servidor; Salvar e Ativar são ações separadas", () => {
    expect(fonte).toMatch(/type="password"/);
    expect(fonte).toContain("apiTokenFinal");
    expect(fonte).not.toContain("webhookSecret");
    expect(fonte).toContain(">Salvar<");
    expect(fonte).toContain(">Ativar<");
  });
  it("mostra a base legal e o custo de cada auth_mode, o aviso do sandbox e o aviso da selfie", () => {
    expect(fonte).toContain("CUSTO_DO_AUTH_MODE");
    expect(fonte).toContain("sem validade jurídica");
    expect(fonte).toContain("LGPD art. 11, II, d");
    expect(fonte).toContain("MP 2.200-2/2001");
  });
  it("assinaturaTela puro não é opção", () => {
    expect(fonte).toContain("AUTH_MODES_DO_CLIENTE");
    expect(fonte).not.toMatch(/value="assinaturaTela"/);
  });
  it("está montado na aba Integração da ficha do provedor", () => {
    expect(pagina).toContain('import { FormularioZapSign } from "@/components/assinatura/FormularioZapSign";');
    expect(pagina).toContain("<FormularioZapSign providerId={providerId} ativo={ativo} />");
  });
});
