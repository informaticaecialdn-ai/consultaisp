import { describe, expect, it } from "vitest";
import { CREDIT_PACKAGES } from "@shared/planos";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";
import { empresaPublicaSimulada } from "./cnpj-simulado";
import {
  configNfseDaDemo,
  documentosDaDemo,
  fichaDoProvedorDaDemo,
  integracaoErpSincronizada,
  logsDeSyncDaDemo,
  notasFiscaisDaDemo,
  pedidosDeCreditoDaDemo,
  sociosDaDemo,
  usuariosExtrasDaDemo,
} from "./semeadura-ficha";

/**
 * A ficha do provedor do sandbox é um módulo PURO: nenhum banco, nenhum mock.
 * O que se prova aqui é a COERÊNCIA — a ficha é a mesma empresa que o "buscar
 * na Receita" devolve, os sócios são os do QSA simulado, o histórico de sync
 * bate com a integração, e nada do que sai daqui trava a limpeza do sandbox
 * (e-mail do administrador intocado, pedido sem Asaas). A prova no banco é da
 * fiação, em `sandbox.service.ts`.
 */

const SUBDOMINIO = "sandbox-0123456789abcdef";
const PROVEDOR = 777;
const DIA = 86_400_000;
const HASH = "$2b$10$hashinutilizaveldademonstracaoxxxxxxxxxxxxxxxxxxxxxxxxx";

/** Hora do relógio de Brasília (UTC-3, sem horário de verão desde 2019). */
const horaEmBrasilia = (d: Date) => (d.getUTCHours() + 21) % 24;

describe("fichaDoProvedorDaDemo", () => {
  it("é a MESMA empresa que o 'buscar na Receita' da demonstração devolve", () => {
    const ficha = fichaDoProvedorDaDemo(SUBDOMINIO);
    const receita = empresaPublicaSimulada("00000000000000");
    // Mesmo mapeamento de `handleCnpjLookup` (painel-provedor.tsx): clicar em
    // "Buscar" sobre a ficha semeada não muda nenhum campo.
    expect(ficha).toMatchObject({
      tradeName: receita.nomeFantasia,
      legalType: "LTDA",
      openingDate: receita.dataAbertura,
      contactEmail: receita.email,
      addressZip: receita.cep,
      addressStreet: receita.logradouro,
      addressNumber: receita.numero,
      addressNeighborhood: receita.bairro,
      addressCity: receita.cidade,
      addressState: receita.uf,
    });
  });

  it("ficha completa: segmento de ISP, e-mail e site no domínio da demonstração", () => {
    const ficha = fichaDoProvedorDaDemo(SUBDOMINIO);
    expect(ficha.businessSegment).toBe("ISP / Provedor de Internet");
    expect(ficha.contactEmail).toMatch(/@demo\.consultaisp\.com\.br$/);
    expect(ficha.website).toMatch(/^https:\/\/demo\.consultaisp\.com\.br/);
  });

  it("telefone de Londrina numa faixa que não é atribuída a assinante (primeiro dígito 1)", () => {
    expect(fichaDoProvedorDaDemo(SUBDOMINIO).contactPhone).toMatch(/^\(43\) 1\d{3}-\d{4}$/);
  });

  it("recusa subdomínio que não é de sandbox: a ficha fictícia nunca vai para um provedor de verdade", () => {
    expect(() => fichaDoProvedorDaDemo("nslink")).toThrow(/sandbox/);
  });
});

describe("sociosDaDemo", () => {
  it("dois sócios, 60/40, iguais ao QSA do cadastro simulado", () => {
    const socios = sociosDaDemo();
    expect(socios).toHaveLength(2);
    expect(socios.map((s) => Number(s.sharePercentage))).toEqual([60, 40]);
    const qsa = empresaPublicaSimulada("00000000000000").socios;
    expect(socios.map((s) => ({ nome: s.name, qualificacao: s.role, cpf: s.cpf }))).toEqual(qsa);
  });

  it("CPF sempre mascarado, como a Receita publica: nenhum documento inteiro", () => {
    for (const s of sociosDaDemo()) {
      expect(s.cpf).toMatch(/^\*{3}\.\d{3}\.\d{3}-\*{2}$/);
      expect(s.cpf.replace(/\D/g, "")).toHaveLength(6);
    }
  });

  it("o importador de QSA tem o que mostrar: o cadastro simulado passa a trazer sócios", () => {
    expect(empresaPublicaSimulada("00000000000000").socios.length).toBeGreaterThan(0);
  });

  it("sem providerId: quem grava é a fiação, com o id do sandbox", () => {
    for (const s of sociosDaDemo()) expect("providerId" in s).toBe(false);
  });
});

describe("documentosDaDemo", () => {
  const documentos = documentosDaDemo(PROVEDOR);

  it("os três documentos do KYC, aprovados, do próprio sandbox", () => {
    expect(documentos.map((d) => d.documentType).sort()).toEqual(["cartao_cnpj", "comprovante_endereco", "contrato_social"]);
    for (const d of documentos) {
      expect(d.status).toBe("approved");
      expect(d.providerId).toBe(PROVEDOR);
      // `apagarSandbox` apaga por `uploadedById` e `deleteProvider` por `providerId`.
      expect(d.uploadedById).toBe(PROVEDOR);
      expect(d.documentMimeType).toBe("application/pdf");
    }
  });

  it("PDF mínimo e válido (< 2 KB), com tamanho declarado igual ao arquivo", () => {
    for (const d of documentos) {
      expect(d.fileData).toMatch(/^data:application\/pdf;base64,/);
      // A rota de download decodifica o que vem depois da vírgula.
      const bytes = Buffer.from(d.fileData.split(",")[1], "base64");
      expect(bytes.length).toBeLessThan(2048);
      expect(d.documentSize).toBe(bytes.length);
      const texto = bytes.toString("latin1");
      expect(texto.startsWith("%PDF-1.")).toBe(true);
      expect(texto.trimEnd().endsWith("%%EOF")).toBe(true);
      expect(texto).toMatch(/demonstra/i);

      // Cada deslocamento da tabela xref aponta para o início do objeto.
      // "\nxref\n", e não "xref": `startxref`, no fim do arquivo, também contém a palavra.
      const xref = texto.slice(texto.indexOf("\nxref\n"));
      const deslocamentos = [...xref.matchAll(/^(\d{10}) 00000 n\s*$/gm)].map((m) => Number(m[1]));
      expect(deslocamentos.length).toBeGreaterThan(0);
      deslocamentos.forEach((pos, i) => expect(texto.slice(pos)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
      const startxref = Number(texto.match(/startxref\s+(\d+)/)![1]);
      expect(texto.slice(startxref).startsWith("xref")).toBe(true);
    }
  });
});

describe("usuariosExtrasDaDemo", () => {
  const extras = usuariosExtrasDaDemo(SUBDOMINIO, HASH);

  it("equipe de 3: um admin e dois usuários, todos verificados", () => {
    expect(extras.map((u) => u.role).sort()).toEqual(["admin", "user", "user"]);
    for (const u of extras) expect(u.emailVerified).toBe(true);
  });

  it("e-mails únicos, canônicos, com o subdomínio e no domínio da demonstração", () => {
    const emails = extras.map((u) => u.email);
    expect(new Set(emails).size).toBe(3);
    for (const e of emails) {
      expect(e).toBe(e.trim().toLowerCase());
      expect(e).toContain(SUBDOMINIO);
      expect(e).toMatch(/@demo\.consultaisp\.com\.br$/);
    }
    const outro = usuariosExtrasDaDemo("sandbox-fedcba9876543210", HASH).map((u) => u.email);
    expect(emails.some((e) => outro.includes(e))).toBe(false);
  });

  /**
   * `apagarSandbox` só apaga quem tem, entre os usuários, o e-mail do
   * administrador da demo (`<subdomain>@demo.consultaisp.com.br`). Um extra
   * com esse e-mail violaria o UNIQUE e travaria a criação; e trocar o e-mail
   * do admin tiraria o segundo sinal e deixaria o sandbox zumbi.
   */
  it("nenhum extra usa o e-mail do administrador da demo (o segundo sinal da limpeza)", () => {
    expect(extras.map((u) => u.email)).not.toContain(`${SUBDOMINIO}@demo.consultaisp.com.br`);
  });

  it("todos com o hash inutilizável recebido — nenhuma senha nova, nenhum bcrypt por usuário", () => {
    for (const u of extras) expect(u.password).toBe(HASH);
  });

  it("recusa hash vazio e subdomínio que não é de sandbox", () => {
    expect(() => usuariosExtrasDaDemo(SUBDOMINIO, "")).toThrow();
    expect(() => usuariosExtrasDaDemo("nslink", HASH)).toThrow(/sandbox/);
  });
});

describe("logsDeSyncDaDemo e integracaoErpSincronizada", () => {
  const TOTAL = 1_500;
  // Duas horas do dia: antes das madrugadas de hoje e depois delas.
  const agoras = [new Date("2026-09-13T04:00:00.000Z"), new Date("2026-09-13T18:00:00.000Z")];

  for (const agora of agoras) {
    describe(`agora = ${agora.toISOString()}`, () => {
      const logs = logsDeSyncDaDemo(PROVEDOR, TOTAL, agora);

      it("10 sincronizações automáticas, nas madrugadas dos últimos 5 dias, nunca no futuro", () => {
        expect(logs).toHaveLength(10);
        for (const l of logs) {
          const quando = l.syncedAt as Date;
          expect(quando.getTime()).toBeLessThanOrEqual(agora.getTime());
          expect(agora.getTime() - quando.getTime()).toBeLessThan(5 * DIA);
          expect(horaEmBrasilia(quando)).toBeLessThan(6);
          expect(l).toMatchObject({ providerId: PROVEDOR, erpSource: FONTE_ERP_DEMO, syncType: "auto" });
        }
        expect(new Set(logs.map((l) => (l.syncedAt as Date).getTime())).size).toBe(10);
      });

      it("upserted coerente com a carteira; exatamente um parcial, e não o mais recente", () => {
        const parciais = logs.filter((l) => l.status === "partial");
        expect(parciais).toHaveLength(1);
        for (const l of logs) {
          expect((l.upserted ?? 0) + (l.errors ?? 0)).toBe(TOTAL);
          expect(l.recordsProcessed).toBe(TOTAL);
          expect(l.recordsFailed).toBe(l.errors);
          if (l.status === "success") expect(l).toMatchObject({ upserted: TOTAL, errors: 0 });
        }
        const maisRecente = [...logs].sort((a, b) => (b.syncedAt as Date).getTime() - (a.syncedAt as Date).getTime())[0];
        expect(maisRecente.status).toBe("success");
      });

      it("a integração diz o que o histórico diz: última sincronização = log mais recente", () => {
        const intg = integracaoErpSincronizada(agora, TOTAL);
        const ultima = Math.max(...logs.map((l) => (l.syncedAt as Date).getTime()));
        expect((intg.lastSyncAt as Date).getTime()).toBe(ultima);
        expect(intg).toMatchObject({ lastSyncStatus: "success", totalSynced: TOTAL, totalErrors: 0 });
      });
    });
  }
});

describe("pedidosDeCreditoDaDemo", () => {
  const agora = new Date("2026-09-13T15:00:00.000Z");
  const pedidos = pedidosDeCreditoDaDemo(PROVEDOR, agora);

  it("um pago, um cancelado e um pendente, todos no passado", () => {
    expect(pedidos.map((p) => p.status).sort()).toEqual(["cancelled", "paid", "pending"]);
    for (const p of pedidos) expect((p.createdAt as Date).getTime()).toBeLessThanOrEqual(agora.getTime());
    const pago = pedidos.find((p) => p.status === "paid")!;
    expect((pago.creditedAt as Date).getTime()).toBeLessThanOrEqual(agora.getTime());
  });

  it("nenhum campo do Asaas: sem cobrança, sem link para fora da demonstração", () => {
    for (const p of pedidos) {
      expect(Object.keys(p).filter((k) => k.startsWith("asaas"))).toEqual([]);
    }
  });

  it("pacote, valor e créditos saem da tabela de preço da plataforma", () => {
    for (const p of pedidos) {
      const pacote = CREDIT_PACKAGES.find((k) => k.name === p.packageName);
      expect(pacote).toBeDefined();
      expect(p.ispCredits).toBe(pacote!.credits);
      expect(p.amount).toBe((pacote!.price / 100).toFixed(2));
      expect(p.precoUnitarioCentavos).toBe(pacote!.price / pacote!.credits);
      expect(p.providerId).toBe(PROVEDOR);
      expect(p.providerName).toBe("Provedor Demonstração");
    }
  });

  it("número do pedido único entre sandboxes e fora do formato da sequence (CR-aaaamm-nnnn)", () => {
    const numeros = pedidos.map((p) => p.orderNumber);
    expect(new Set(numeros).size).toBe(3);
    const outros = pedidosDeCreditoDaDemo(PROVEDOR + 1, agora).map((p) => p.orderNumber);
    expect(numeros.some((n) => outros.includes(n))).toBe(false);
    for (const n of numeros) expect(n).not.toMatch(/^CR-\d{6}-\d{4}$/);
  });
});

describe("NFS-e da demonstração", () => {
  const criadoEm = new Date("2026-09-12T15:00:00.000Z");

  it("config do sandbox: CNPJ do próprio sandbox, Londrina (4113700), serviço de internet", () => {
    expect(configNfseDaDemo("12345678000190")).toMatchObject({
      configured: true,
      environment: "demonstracao",
      cnpjPrestador: "12345678000190",
      codigoMunicipio: "4113700",
      municipio: "Londrina",
      uf: "PR",
      descricaoPadrao: expect.stringMatching(/internet/i),
    });
  });

  it("5 a 8 notas determinísticas, com referência demo- e emitidas antes do sandbox nascer", () => {
    const notas = notasFiscaisDaDemo(42, criadoEm);
    expect(notas).toEqual(notasFiscaisDaDemo(42, criadoEm));
    expect(notas.length).toBeGreaterThanOrEqual(5);
    expect(notas.length).toBeLessThanOrEqual(8);
    expect(new Set(notas.map((n) => n.ref)).size).toBe(notas.length);
    for (const n of notas) {
      expect(n.ref).toMatch(/^demo-42-\d+$/);
      expect(new Date(n.emitidaEm).getTime()).toBeLessThanOrEqual(criadoEm.getTime());
      expect(n.valor).toBeGreaterThan(0);
    }
  });

  it("uma em processamento (o 'Verificar' aparece), uma cancelada; número = 6 últimos dígitos da referência", () => {
    const notas = notasFiscaisDaDemo(42, criadoEm);
    const processando = notas.filter((n) => n.status === "processing");
    expect(processando).toHaveLength(1);
    expect(processando[0].numero).toBeUndefined();
    expect(notas.some((n) => n.status === "cancelled")).toBe(true);
    const numeradas = notas.filter((x) => x.status !== "processing");
    for (const n of numeradas) {
      expect(n.numero).toBe(n.ref.replace(/\D/g, "").slice(-6).padStart(6, "0"));
    }
    expect(new Set(numeradas.map((n) => n.numero)).size).toBe(numeradas.length);
  });

  it("números distintos para qualquer nascimento do sandbox, não só o do exemplo", () => {
    for (let k = 0; k < 200; k++) {
      const notas = notasFiscaisDaDemo(9, new Date(Date.UTC(2026, 8, 1) + k * 3_600_000 + k * 7919));
      const numeros = notas.filter((n) => n.numero).map((n) => n.numero);
      expect(new Set(numeros).size).toBe(numeros.length);
    }
  });
});
