import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maskName, maskCpfCnpj, maskCep } from "./lgpd-masking.js";

describe("maskName", () => {
  it("masks name for different provider", () => {
    assert.equal(maskName("Joao Silva", false), "Joao ***");
  });

  it("returns full name for same provider", () => {
    assert.equal(maskName("Joao Silva", true), "Joao Silva");
  });
});

describe("maskCpfCnpj", () => {
  it("masks CPF (11 digits) for different provider", () => {
    assert.equal(maskCpfCnpj("12345678901", false), "123.***.***-**");
  });

  it("masks CNPJ (14 digits) for different provider", () => {
    assert.equal(maskCpfCnpj("12345678000190", false), "12.***.***/0001-**");
  });
});

describe("maskCep", () => {
  it("masks CEP for different provider", () => {
    assert.equal(maskCep("01310100", false), "01310-***");
  });

  it("returns full formatted CEP for same provider", () => {
    assert.equal(maskCep("01310100", true), "01310-100");
  });
});
