import { describe, expect, it } from "vitest";
import { chaveDoTelefoneWhatsapp, mesmoTelefoneWhatsapp } from "./telefone-whatsapp";

describe("equivalência de telefones no WhatsApp", () => {
  it("o contato sem o nono dígito que a Evolution devolve é o mesmo número do cadastro com o 9", () => {
    // O caso real de 16/09/2026: cadastro 43 9 8821-9420, contato 55 43 8821-9420.
    expect(mesmoTelefoneWhatsapp("43988219420", "554388219420")).toBe(true);
    expect(mesmoTelefoneWhatsapp("5543988219420", "554388219420")).toBe(true);
    expect(mesmoTelefoneWhatsapp("(43) 98821-9420", "55 43 8821-9420")).toBe(true);
    expect(chaveDoTelefoneWhatsapp("43988219420")).toBe("4388219420");
    expect(chaveDoTelefoneWhatsapp("554388219420")).toBe("4388219420");
  });
  it("com ou sem DDI 55 é o mesmo número; fixo de 10 dígitos também", () => {
    expect(mesmoTelefoneWhatsapp("43999990000", "5543999990000")).toBe(true);
    expect(mesmoTelefoneWhatsapp("4333330000", "554333330000")).toBe(true);
  });
  it("números diferentes continuam diferentes — inclusive DDD diferente com os mesmos oito dígitos", () => {
    expect(mesmoTelefoneWhatsapp("43988219420", "43988219421")).toBe(false);
    expect(mesmoTelefoneWhatsapp("43988219420", "41988219420")).toBe(false);
    expect(mesmoTelefoneWhatsapp("43988219420", "5541988219420")).toBe(false);
  });
  it("o que não tem forma de telefone brasileiro não é igual a nada, nem a si mesmo", () => {
    expect(chaveDoTelefoneWhatsapp("")).toBeNull();
    expect(chaveDoTelefoneWhatsapp(null)).toBeNull();
    expect(chaveDoTelefoneWhatsapp("123")).toBeNull();
    expect(chaveDoTelefoneWhatsapp("5543988219420123")).toBeNull();
    expect(mesmoTelefoneWhatsapp("", "")).toBe(false);
    expect(mesmoTelefoneWhatsapp(null, null)).toBe(false);
  });
  it("um local de nove dígitos que não começa por 9 fica inteiro e não colide com o de oito", () => {
    expect(chaveDoTelefoneWhatsapp("43188219420")).toBe("43188219420");
    expect(mesmoTelefoneWhatsapp("43188219420", "43188219420")).toBe(true);
    expect(mesmoTelefoneWhatsapp("43188219420", "4388219420")).toBe(false);
  });
});
