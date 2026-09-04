import { describe, it, expect } from "vitest";
import {
  PROVIDER_ONLY_PATHS,
  REVENDA_PATHS,
  desvioDeRevenda,
  ehRotaDaPlataforma,
  ehRotaDeRevenda,
  paginaInicial,
} from "./App";

/**
 * O roteamento dos TRES paineis.
 *
 * O que estes testes protegem nao e a comodidade de cair na tela certa: e o
 * quadro em que a tela ERRADA e montada. O desvio de rota e um efeito, e efeito
 * roda depois da primeira pintura — por isso a mesma decisao alimenta o efeito e
 * a guarda de render, e por isso ela mora numa funcao pura em vez de estar
 * espalhada em `if` dentro do componente.
 *
 * A recusa que de fato protege dado continua sendo a do servidor (o 403 central
 * de `server/auth.ts`, com testes proprios). Isto aqui evita montar o esqueleto
 * de um painel que nao e seu — e um esqueleto ja dispara as chamadas de API da
 * tela.
 */

describe("ehRotaDeRevenda", () => {
  it("a raiz do painel e as telas da fase 1", () => {
    for (const caminho of REVENDA_PATHS) {
      expect(ehRotaDeRevenda(caminho), caminho).toBe(true);
    }
  });

  it("subrota futura ja conta como painel do revendedor", () => {
    // As fases 2 a 4 acrescentam /revenda/provedores/:id e afins. Elas tem de
    // nascer protegidas, sem ninguem lembrar de voltar aqui.
    expect(ehRotaDeRevenda("/revenda/provedores/42")).toBe(true);
  });

  /**
   * O caso que a comparacao por segmento existe para pegar. Com
   * `startsWith("/revenda")` cru, qualquer rota que apenas COMECE com o nome do
   * painel entraria nele — e a mesma classe de furo que o 403 central do
   * servidor evita do lado de la.
   */
  it("vizinho de nome parecido nao entra", () => {
    expect(ehRotaDeRevenda("/revendas-antigas")).toBe(false);
    expect(ehRotaDeRevenda("/revendedores")).toBe(false);
  });

  it("tela de provedor nao e do revendedor", () => {
    expect(ehRotaDeRevenda("/")).toBe(false);
    expect(ehRotaDeRevenda("/consulta-isp")).toBe(false);
  });
});

describe("ehRotaDaPlataforma", () => {
  it("pega o painel do superadmin e as telas de dentro dele", () => {
    expect(ehRotaDaPlataforma("/admin-sistema")).toBe(true);
    expect(ehRotaDaPlataforma("/admin/marcas")).toBe(true);
    expect(ehRotaDaPlataforma("/admin/financeiro")).toBe(true);
  });

  /**
   * PLATFORM_ONLY_PATHS compara caminho exato e por isso NAO cobre estas duas.
   * Sao telas com dado de um provedor especifico; deixar o revendedor monta-las
   * seria o oposto do isolamento que o produto vende.
   */
  it("pega tambem as telas com :id, que a lista exata deixa de fora", () => {
    expect(ehRotaDaPlataforma("/admin/provedor/7")).toBe(true);
    expect(ehRotaDaPlataforma("/admin/fatura/91")).toBe(true);
  });

  /* `/administracao` tambem comeca com "/admin" e e tela de PROVEDOR. O destino
     do desvio coincide, mas a regra nao pode acertar por coincidencia. */
  it("nao confunde /administracao com o painel da plataforma", () => {
    expect(ehRotaDaPlataforma("/administracao")).toBe(false);
  });
});

describe("paginaInicial", () => {
  it("cada papel comeca no proprio painel", () => {
    expect(paginaInicial("revendedor")).toBe("/revenda");
    expect(paginaInicial("superadmin")).toBe("/admin-sistema");
    expect(paginaInicial("admin")).toBe("/");
    expect(paginaInicial("user")).toBe("/");
  });

  /**
   * Dentro de uma janela de suporte o `role` continua "superadmin" de proposito
   * (server/auth.ts). Manda-lo para /admin-sistema seria manda-lo para a tela
   * de onde a regra de personificacao o expulsa no quadro seguinte.
   */
  it("superadmin personificando comeca no painel do provedor", () => {
    expect(paginaInicial("superadmin", true)).toBe("/");
  });
});

describe("desvioDeRevenda — o revendedor fora do painel dele", () => {
  it("toda tela de provedor manda o revendedor de volta", () => {
    for (const caminho of PROVIDER_ONLY_PATHS) {
      expect(desvioDeRevenda({ papel: "revendedor", caminho }), caminho).toBe("/revenda");
    }
  });

  /**
   * NA FORMA QUE O ROTEADOR CASA, e nao so na forma canonica.
   *
   * O wouter usa `parse` do regexparam, que monta
   * `new RegExp('^' + padrao + '\\/?$', 'i')`: caixa ignorada e barra final
   * opcional. Enquanto a guarda comparava literal, `/Inadimplentes` e
   * `/inadimplentes/` nao desviavam e o `<Route path="/inadimplentes">` casava
   * assim mesmo — a tela de provedor montava inteira no painel do revendedor.
   *
   * Percorre a LISTA, e nao uma amostra: tela nova entra na lista e cai neste
   * teste nas tres formas, sem ninguem lembrar deste arquivo.
   */
  it("caixa trocada e barra final nao driblam o desvio — o roteador aceita as duas", () => {
    for (const caminho of PROVIDER_ONLY_PATHS) {
      for (const forma of [caminho.toUpperCase(), `${caminho.replace(/\/$/, "")}/`, `${caminho}?x=1`]) {
        expect(desvioDeRevenda({ papel: "revendedor", caminho: forma }), forma).toBe("/revenda");
      }
    }
  });

  it("as telas da plataforma tambem", () => {
    for (const caminho of [
      "/admin-sistema", "/admin/marcas", "/admin/provedor/7",
      "/Admin/Marcas", "/ADMIN-SISTEMA", "/admin/marcas/",
    ]) {
      expect(desvioDeRevenda({ papel: "revendedor", caminho }), caminho).toBe("/revenda");
    }
  });

  /**
   * A normalizacao nao pode virar uma rede que pega o que nao e para pegar:
   * `/administracao` comeca com "/admin" e e tela de PROVEDOR — desvia pela
   * lista de provedor, nao pela regra da plataforma —, e um nome que so comeca
   * igual continua fora.
   */
  it("vizinho de nome parecido nao entra de carona", () => {
    expect(ehRotaDaPlataforma("/administracao")).toBe(false);
    expect(ehRotaDeRevenda("/revendas-antigas")).toBe(false);
    expect(ehRotaDeRevenda("/REVENDAS-ANTIGAS")).toBe(false);
  });

  it("no proprio painel ele fica", () => {
    for (const caminho of [...REVENDA_PATHS, "/revenda/provedores/42"]) {
      expect(desvioDeRevenda({ papel: "revendedor", caminho }), caminho).toBeNull();
    }
  });

  /**
   * O que e publico nao e painel de ninguem. A politica de privacidade em
   * especial: a LGPD garante ao titular saber quem trata os dados dele, e o
   * rodape da barra lateral aponta para /lgpd em todos os papeis.
   */
  it("pagina publica e 404 nao desviam", () => {
    for (const caminho of ["/lgpd", "/meus-dados", "/verificar-email", "/rota-que-nao-existe"]) {
      expect(desvioDeRevenda({ papel: "revendedor", caminho }), caminho).toBeNull();
    }
  });
});

describe("desvioDeRevenda — quem nao revende dentro do painel de revenda", () => {
  it("provedor volta para o dashboard dele", () => {
    expect(desvioDeRevenda({ papel: "admin", caminho: "/revenda" })).toBe("/");
    expect(desvioDeRevenda({ papel: "user", caminho: "/revenda/marca" })).toBe("/");
  });

  it("superadmin volta para o painel da plataforma", () => {
    expect(desvioDeRevenda({ papel: "superadmin", caminho: "/revenda" })).toBe("/admin-sistema");
  });

  /* Um salto so: sem isto ele iria a /admin-sistema e de la seria expulso para
     "/" pela regra de personificacao, duas viagens para o mesmo destino. */
  it("superadmin personificando volta para o painel do provedor", () => {
    expect(
      desvioDeRevenda({ papel: "superadmin", caminho: "/revenda", dentroDeSessaoDeSuporte: true }),
    ).toBe("/");
  });

  it("fora do painel de revenda ninguem e desviado por esta regra", () => {
    // Quem cuida destes casos sao as duas regras de sessao de suporte, que
    // continuam onde estavam.
    expect(desvioDeRevenda({ papel: "superadmin", caminho: "/consulta-isp" })).toBeNull();
    expect(desvioDeRevenda({ papel: "admin", caminho: "/" })).toBeNull();
    expect(desvioDeRevenda({ papel: "user", caminho: "/admin-sistema" })).toBeNull();
  });
});
