import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fonte = readFileSync(new URL("./EstadoDaAssinatura.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const painel = readFileSync(new URL("../../pages/provedor/painel-provedor.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("EstadoDaAssinatura (Painel do Provedor)", () => {
  it("é só leitura: lê o estado e, no máximo, marca o modelo como revisado (admin)", () => {
    expect(fonte).toContain('"/api/cobranca/confissoes/estado"');
    expect(fonte).toContain('"/api/cobranca/confissoes/modelo/revisado"');
    expect(fonte).not.toContain("/api/admin/");
    expect(fonte).not.toMatch(/apiToken|webhookSecret/);
    expect(fonte).toContain("podeAdministrar");
  });
  it("mostra ambiente, auth_mode com custo e o aviso do sandbox; explica que quem configura é o superadmin", () => {
    expect(fonte).toContain("CUSTO_DO_AUTH_MODE");
    expect(fonte).toContain("sem validade jurídica");
    expect(fonte).toContain("superadmin");
  });
  it("está montado na aba Integração do Painel do Provedor", () => {
    expect(painel).toContain('import { EstadoDaAssinatura } from "@/components/assinatura/EstadoDaAssinatura";');
    expect(painel).toContain("<EstadoDaAssinatura podeAdministrar={podeAdministrar} />");
  });
  it("uma leitura que falha diz que falhou, em vez de ficar em 'Lendo…'", () => {
    expect(fonte).toContain("isError");
    expect(fonte).toContain('data-testid="assinatura-erro"');
  });
});
