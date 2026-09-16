// @vitest-environment jsdom
/**
 * `gestao-cobranca.css` sobre o pop-up do caso (`.cobranca-atendimento`).
 *
 * O Painel do Caso tem DOIS controles de fechar com o mesmo
 * `data-testid="painel-fechar"`: o × do cabeçalho (dentro de
 * `painel-identidade`) e o botão "Fechar" da barra de ações (dentro de
 * `painel-acoes`). A revisão de 12/09/2026 quis esconder só o da barra —
 * "fechar fica no cabeçalho; a barra é para trabalho" — mas o seletor casou
 * com os dois, e o pop-up ficou sem × visível: só Esc e o clique fora fechavam.
 *
 * O jsdom aplica a folha de verdade (`getComputedStyle` percorre as regras
 * que casam com cada elemento), então o que se prova aqui é o CASCADE, e não
 * uma string: o × do cabeçalho continua visível e o "Fechar" da barra some.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), "utf8");
const folha = ler("./gestao-cobranca.css");
const painel = ler("../../components/cobranca/PainelDoCaso.tsx");

/** O esqueleto do pop-up: só o que o seletor precisa ver — a classe do DialogContent e os dois lugares do `painel-fechar`. */
function montarPopUp() {
  document.head.innerHTML = `<style>${folha}</style>`;
  document.body.innerHTML = `
    <div class="cobranca-atendimento" data-testid="painel-do-caso">
      <div data-testid="painel-identidade"><div><button type="button" aria-label="Fechar" data-testid="painel-fechar">×</button></div></div>
      <div data-testid="painel-acoes"><button type="button" data-testid="painel-fechar">Fechar</button></div>
      <div data-testid="painel-corpo"></div>
    </div>`;
  const [xDoCabecalho, fecharDaBarra] = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="painel-fechar"]'));
  return { xDoCabecalho, fecharDaBarra };
}

describe("o controle de fechar do pop-up do caso", () => {
  it("o esqueleto do teste é o do componente: o × mora no cabeçalho e o 'Fechar' na barra de ações", () => {
    const cabecalho = painel.slice(painel.indexOf('data-testid="painel-identidade"'), painel.indexOf('data-testid="painel-acoes"'));
    expect(cabecalho).toContain('aria-label="Fechar"');
    expect(cabecalho).toContain('data-testid="painel-fechar"');
    const barra = painel.slice(painel.indexOf('data-testid="painel-acoes"'), painel.indexOf('data-testid="painel-corpo"'));
    expect(barra).toContain('data-testid="painel-fechar">Fechar</button>');
  });

  it("a folha está valendo no teste (senão 'visível' seria vitória por folha quebrada)", () => {
    montarPopUp();
    expect(document.styleSheets[0].cssRules.length).toBeGreaterThan(0);
    // uma regra qualquer da folha, aplicada: o padding do cabeçalho do pop-up
    expect(getComputedStyle(document.querySelector('[data-testid="painel-identidade"]')!).padding).toBe("24px 56px 20px 24px");
  });

  it("o × do cabeçalho continua VISÍVEL — a folha esconde só o 'Fechar' da barra de ações", () => {
    const { xDoCabecalho, fecharDaBarra } = montarPopUp();
    expect(getComputedStyle(fecharDaBarra).display).toBe("none");
    expect(getComputedStyle(xDoCabecalho).display).not.toBe("none");
  });

  it("a regra que esconde desce pela barra de ações, não pelo pop-up inteiro", () => {
    const regras = folha.match(/[^{}]*painel-fechar[^{}]*\{[^}]*display\s*:\s*none[^}]*\}/g) ?? [];
    expect(regras.length).toBeGreaterThan(0);
    for (const regra of regras) {
      expect(regra, regra).toMatch(/\[data-testid="painel-acoes"\]\s+\[data-testid="painel-fechar"\]/);
    }
  });
});
