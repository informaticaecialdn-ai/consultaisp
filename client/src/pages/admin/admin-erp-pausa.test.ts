/**
 * A aba Integração ERP do painel do superadmin, depois da pausa automática.
 *
 * Três varreduras automáticas seguidas com falha desligam a integração
 * (`isEnabled = false` + `status = "pausado_por_falhas"`) e avisam o provedor.
 * Quem religa é o superadmin, e o único lugar onde ele pode fazer isso é esta
 * tela — então a pausa precisa aparecer com nome em português E ter um botão.
 * Um selo que só informa deixa o operador procurando onde reativar.
 *
 * A tela é um componente grande de página, sem ambiente de DOM neste projeto
 * (ver o `include` do vitest.config.ts). Como em `marca-hidratacao.test.ts`, o
 * que se pode travar aqui é o texto da fonte — o suficiente para que a remoção
 * do botão, da invalidação da chave ou do rótulo não passe silenciosa.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const fonte = readFileSync(join(__dirname, "admin-provedor.tsx"), "utf8");
const secao = fonte.slice(fonte.indexOf("function IntegracaoTab"));

/** A fonte sem comentário — o que a tela realmente executa. */
const executavel = fonte
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("pausa por falhas na aba do superadmin", () => {
  it("o identificador cru nunca chega à tela — só aparece em comparação", () => {
    const brutos = secao.match(/pausado_por_falhas/g) ?? [];
    const comparacoes = secao.match(/===\s*"pausado_por_falhas"/g) ?? [];
    expect(brutos.length).toBeGreaterThan(0);
    // Toda ocorrência é `status === "pausado_por_falhas"`. Nenhuma é interpolação
    // num nó de texto: o operador lê "Pausado por falhas", não a coluna.
    expect(brutos.length).toBe(comparacoes.length);
    expect(secao).toContain("Pausado por falhas");
  });

  it("a pausa é acionável: há botão de reativar, não só selo", () => {
    expect(secao).toContain("button-reativar-erp-");
    // O rótulo ganhou acento na rodada de linguagem visual ("Reativar integração"):
    // a seção 8 do DESIGN_SYSTEM pede português com acento, e o que este teste
    // trava é a EXISTÊNCIA do botão, não a grafia sem acento que ele tinha.
    expect(secao).toContain("Reativar integração");
    // Só `isEnabled`: a rota grava o que chega no corpo, e mandar os outros
    // campos vazios apagaria a credencial que está lá.
    expect(secao).toContain("corpo: { isEnabled: true },");
  });

  it("religar invalida a chave da aba — senão a tela segue mostrando pausada", () => {
    const salvar = secao.slice(
      secao.indexOf("const salvarMutation"),
      secao.indexOf("const testarMutation"),
    );
    expect(salvar).toContain(
      'queryKey: ["/api/admin/providers", providerId, "integration"]',
    );
  });

  it("o selo de pausa substitui o par ativo/inativo em vez de somar a ele", () => {
    // Dizer só "Inativo" numa integração cortada pelo sistema esconde quem a
    // desligou; os dois selos juntos fazem o operador ler duas coisas.
    expect(secao).toContain(
      'pausado ? "Pausado por falhas" : intg?.isEnabled ? "Ativo" : "Inativo"',
    );
  });
});

describe("histórico de sincronização", () => {
  it("a linha de reativação tem rótulo próprio, fora do ramo genérico", () => {
    expect(fonte).toMatch(/reativado:\s*\{\s*texto:\s*"Reativado"/);
    // Reativação não processou registro nenhum: "0 ok" leria como varredura
    // que não achou ninguém.
    expect(secao).toContain('log.status === "reativado"');
  });
});

describe("contrato do que a tela publica", () => {
  it("nenhum intervalo de sincronização é publicado — ninguém o honra", () => {
    // A coluna `sync_interval_hours` existe e o Zod da rota a aceita, mas nenhum
    // agendador a lê. Fora de comentário, o nome não pode aparecer.
    expect(executavel).not.toContain("syncIntervalHours");
  });

  it("a cadência anunciada é a da agenda de varredura", () => {
    // server/services/erp-agenda.ts: DIAS_PADRAO [1,3,5], HORA_PADRAO 3.
    // "às" com acento desde a rodada de linguagem visual — os DIAS e a HORA,
    // que são o que este teste protege contra desencontro com a agenda, não
    // mudaram.
    expect(secao).toContain("segunda, quarta e sexta às 03:00");
  });
});

describe("falha ao ler a integração", () => {
  it("não vira 'sem credencial' — a tela para antes de listar", () => {
    const guarda = secao.indexOf("if (isError || erroConectores)");
    const lista = secao.indexOf("const integrations = data?.integrations ?? []");
    expect(guarda).toBeGreaterThan(-1);
    expect(lista).toBeGreaterThan(-1);
    // A saída de erro vem ANTES do fallback para lista vazia: sem isso todo
    // conector apareceria como "Sem credencial" e o operador gravaria por cima
    // de uma integração que existe.
    expect(guarda).toBeLessThan(lista);
    expect(secao).toContain("erp-erro-carregamento");
    expect(secao).toContain("button-recarregar-integracao");
  });
});
