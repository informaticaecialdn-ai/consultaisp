import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bloco = readFileSync(new URL("./ConfissaoDeDivida.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const pagina = readFileSync(new URL("../../pages/cobranca/cliente360.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const linha = readFileSync(new URL("./LinhaDoTempo.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("ConfissaoDeDivida (bloco do 360)", () => {
  it("lê estado, lista e base pelas rotas certas, com o customerId no caminho", () => {
    expect(bloco).toContain('"/api/cobranca/confissoes/estado"');
    expect(bloco).toContain("`/api/cobranca/clientes/${customerId}/confissoes`");
    expect(bloco).toContain("`/api/cobranca/clientes/${customerId}/confissoes/base?${");
    expect(bloco).toContain("`/api/cobranca/confissoes/${");
  });
  it("o operador nunca digita valor: a prévia vem do servidor e o POST manda o baseHash e a chave de idempotência", () => {
    expect(bloco).not.toMatch(/name="valor"|valorTotal:\s*Number\(/);
    expect(bloco).toContain("baseHash: base.baseHash");
    expect(bloco).toContain("chaveIdempotencia");
    expect(bloco).toContain("crypto.randomUUID()");
  });
  it("sandbox: faixa TESTE, confirmação obrigatória, sem reenviar e sem enviar pelo chat", () => {
    expect(bloco).toContain("SELO_SANDBOX");
    expect(bloco).toContain("confirmoTeste");
    expect(bloco).toMatch(/ambiente !== "sandbox" && [^\n]*[Rr]eenviar/);
    expect(bloco).toContain("chatDisponivel");
  });
  it("mostra bloqueios, avisos, custo, estado por signatário, faturas de saída desmarcáveis e o link para copiar", () => {
    for (const t of ["bloqueios", "avisos", "custo.texto", "ROTULO_STATUS_DO_SIGNATARIO", "faturasDeSaida", "signUrlCliente", "navigator.clipboard.writeText"]) expect(bloco).toContain(t);
  });
  it("ações sensíveis passam pelo cadeado do admin", () => {
    expect(bloco).toContain("podeAdministrar");
    expect(bloco).toContain("APROVACAO_OBRIGATORIA");
  });
  it("o 360 monta o bloco no lugar do interruptor antigo, sem o ACriar e sem estado local de confissão", () => {
    expect(pagina).toContain('import { ConfissaoDeDivida } from "@/components/cobranca/ConfissaoDeDivida";');
    expect(pagina).toContain("<ConfissaoDeDivida");
    expect(pagina).toContain('data-k="Confissão de dívida"');
    expect(pagina).not.toContain("setConfissao(");
    expect(pagina).not.toContain("habilitação de confissão POR CLIENTE");
    expect(pagina).not.toContain("GATED: sem assinatura eletrônica");
    expect(pagina).toContain("<SeloConfissao confissao={data?.confissaoViva}");
  });
  it("a prescrição interrompida é dita no 360 e a linha do tempo descreve o evento confissao", () => {
    expect(pagina).toContain("interrompida pela confissão de");
    expect(pagina).toContain("CC art. 202, VI");
    expect(linha).toContain('e.tipo === "confissao"');
  });
  it("não oferece 'enviar pelo chat' sem link de assinatura, e a linha do tempo tem cor para o evento", () => {
    expect(bloco).toContain("c.signUrlCliente && c.status === \"enviada\" && estado?.chatDisponivel");
    expect(bloco).toContain('e.codigo === "APROVACAO_OBRIGATORIA" ? "Ação de administrador"');
    expect(linha).toContain("confissao:");
  });
});
