/**
 * O console de agentes, costurado ponta a ponta.
 *
 * Três coisas que só quebram em produção e que teste de unidade não pega:
 *
 * 1. **A chave da query é a URL.** O `queryFn` padrão faz `queryKey.join("/")`.
 *    Uma chave `[rota, "7d"]` vira `/rota/7d` — 404 silencioso, tela vazia,
 *    nenhum erro no console. Já aconteceu antes neste repositório.
 * 2. **Escrita é de admin.** O servidor recusa, mas um botão que só falha ao
 *    ser clicado ensina o operador a desconfiar da tela.
 * 3. **A rota entra na guarda.** `/agentes` hoje so REDIRECIONA para a aba do
 *    Painel do Provedor, mas a guarda roda ANTES do desvio: fora de
 *    `PROVIDER_ONLY_PATHS`, um papel sem provedor atravessaria o
 *    redirecionamento ate o painel. Os dois enderecos precisam estar na lista.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { abaValida, ABAS_DO_CONSOLE, API_AGENTES, API_EXECUCOES, API_RESUMO, API_SKILLS, API_TOOLS, ROTA_AGENTES, textoDeDolar, textoDeDuracao } from "./tipos";

const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const FONTES = {
  execucoes: ler("./AbaExecucoes.tsx"),
  agentes: ler("./AbaAgentes.tsx"),
  skills: ler("./AbaSkills.tsx"),
  conexoes: ler("./AbaConexoes.tsx"),
  dialogoAgente: ler("./DialogoAgente.tsx"),
  dialogoSkills: ler("./DialogoSkillsDoAgente.tsx"),
  pagina: ler("../painel/AbaAgentesDeIa.tsx"),
};
const app = ler("../../App.tsx");
const sidebar = ler("../app-sidebar.tsx");
const rotas = ler("../../../../server/routes/chat-console.routes.ts");
const painel = ler("../../pages/provedor/painel-provedor.tsx");

describe("a chave da query é a URL inteira", () => {
  it("nenhuma chave junta pedaços que virariam caminho falso", () => {
    // Uma chave com vírgula depois do endereço vira `/endereco/pedaco`.
    for (const [nome, fonte] of Object.entries(FONTES)) {
      const chaves = [...fonte.matchAll(/queryKey:\s*\[([^\]]*)\]/g)].map(m => m[1].trim());
      for (const chave of chaves) {
        expect(chave.split(",").length, `${nome}: queryKey com mais de uma peça — ${chave}`).toBe(1);
      }
    }
  });

  it("o período e o filtro viajam na query string, como a rota espera", () => {
    expect(FONTES.execucoes).toContain("?periodo=${periodo}");
    expect(FONTES.execucoes).toContain("soComErro=");
    expect(rotas).toContain("periodo: z.enum([\"24h\", \"7d\", \"30d\", \"all\"]).optional()");
  });
});

describe("os endereços que a tela chama existem na rota", () => {
  it("cada base do client aparece no router do servidor", () => {
    for (const base of [API_AGENTES, API_SKILLS, API_TOOLS, API_EXECUCOES, API_RESUMO]) {
      const sufixo = base.replace("/api/chat-bullq/console", "");
      expect(rotas, `rota ausente para ${base}`).toContain(`\${base}${sufixo}`);
    }
  });

  it("o client nunca manda organização: quem resolve é a sessão", () => {
    for (const [nome, fonte] of Object.entries(FONTES)) {
      expect(fonte, `${nome} manda organizationId`).not.toMatch(/organizationId|orgId/);
    }
  });
});

describe("escrita é de administrador", () => {
  it("todo POST, PATCH, PUT e DELETE do servidor passa por exigirAdmin", () => {
    const escritas = [...rotas.matchAll(/router\.(post|patch|put|delete)\(`\$\{base\}([^`]*)`([^\n]*)/g)];
    expect(escritas.length).toBeGreaterThan(8);
    for (const [, metodo, caminho, resto] of escritas) {
      expect(resto, `${metodo.toUpperCase()} ${caminho} sem exigirAdmin`).toContain("exigirAdmin(");
    }
  });

  it("as leituras NÃO exigem admin — o operador precisa ver o que a IA anda fazendo", () => {
    const leituras = [...rotas.matchAll(/router\.get\(`\$\{base\}([^`]*)`([^\n]*)/g)];
    expect(leituras.length).toBeGreaterThan(4);
    for (const [, caminho, resto] of leituras) {
      expect(resto, `GET ${caminho} exige admin sem precisar`).not.toContain("exigirAdmin(");
    }
  });

  it("os botões de criar só aparecem para quem pode administrar", () => {
    for (const fonte of [FONTES.agentes, FONTES.skills, FONTES.conexoes]) {
      expect(fonte).toMatch(/podeAdministrar\s*&&\s*\(?\s*<\s*button/);
    }
  });
});

describe("o console e uma ABA do Painel do Provedor", () => {
  it("o endereco antigo redireciona, com a sub-aba preservada", () => {
    // Pagina virou aba em 07/09/2026 (pedido do dono). `/agentes` continua
    // roteado como REDIRECIONAMENTO: link salvo e favorito nao podem dar em
    // pagina vazia.
    expect(app).toContain('<Route path="/agentes"><RedirecionarAgentes /></Route>');
    // O CORPO da função, e não "a string aparece 320 caracteres depois": a
    // janela solta passaria com o `&aba=` de qualquer outro trecho do arquivo.
    const corpo = app.slice(app.indexOf("function RedirecionarAgentes()"));
    const redirecionador = corpo.slice(0, corpo.indexOf("\n}") + 2);
    expect(redirecionador).toContain("useSearch()");
    expect(redirecionador).toContain('.get("aba")');
    expect(redirecionador).toContain("${ROTA_AGENTES}");
    expect(redirecionador).toContain("&aba=${encodeURIComponent(aba)}");
    expect(redirecionador).toContain("replace");
    expect(app).not.toContain("pages/agentes");
  });

  it("a guarda continua cobrindo os dois enderecos", () => {
    // A guarda roda ANTES do desvio: sem `/agentes` na lista, um papel sem
    // provedor atravessaria o redirecionamento ate o painel.
    const lista = app.slice(app.indexOf("PROVIDER_ONLY_PATHS = ["), app.indexOf("PROVIDER_ONLY_PATHS = [") + 1400);
    expect(lista).toContain('"/agentes"');
    expect(lista).toContain('"/painel-provedor"');
  });

  it("o painel monta a aba, e o menu nao tem mais item proprio", () => {
    expect(painel).toContain('<TabsTrigger value="agentes"');
    // O gatilho e o corpo TEM de casar pelo mesmo `value`: dois toContain
    // soltos passariam com o corpo pendurado em outra aba, e o clique abriria
    // um painel vazio.
    const corpoDaAba = painel.slice(painel.indexOf('<TabsContent value="agentes">'));
    expect(corpoDaAba.slice(0, corpoDaAba.indexOf("</TabsContent>")))
      .toContain("<AbaAgentesDeIa podeAdministrar={podeAdministrar} />");
    // Dois caminhos para a mesma tela, um deles so redirecionando, e o tipo de
    // menu que ensina o operador a nao confiar no menu.
    expect(sidebar).not.toContain('url: "/agentes"');
    expect(sidebar).not.toContain("link-agentes");
  });

  it("a sub-aba entra com & — trocar por ? derrubaria a aba do painel", () => {
    expect(ROTA_AGENTES).toBe("/painel-provedor?tab=agentes");
    expect(FONTES.pagina).toContain("${ROTA_AGENTES}&aba=");
    expect(FONTES.pagina).not.toContain("${ROTA_AGENTES}?aba=");
  });

  it("URL sem ?tab= volta para a Visão Geral — sem isso o Voltar do navegador parece morto", () => {
    // O efeito de sincronia tinha `if (tab) setActiveTab(tab)`, sem `else`: com
    // a URL perdendo o `?tab=`, a aba visível congelava na última escolhida.
    // Ficou latente até esta aba trazer um <Link> do wouter para `?tab=chat` —
    // aí o Voltar tirava o `?tab=` e a tela continuava no Chat.
    // Âncora no corpo do EFEITO, não no primeiro `useEffect` do arquivo — esse
    // é a linha de import, e a busca a partir dele cai no useState inicial.
    const efeito = painel.slice(painel.indexOf("useEffect(() => {\n    const tab ="));
    expect(efeito).not.toBe(painel);
    expect(efeito.slice(0, 220)).toContain('setActiveTab(tab || "visao-geral")');
    expect(efeito.slice(0, 220)).not.toMatch(/if\s*\(tab\)\s*setActiveTab/);
  });
});

describe("as travas ficam visíveis na tela, não só no servidor", () => {
  it("a lista de hosts liberados é mostrada junto do campo de endereço", () => {
    expect(FONTES.conexoes).toContain("hostsPermitidos");
    expect(FONTES.conexoes).toMatch(/hosts liberados/);
    // A validação do host roda no formulário, antes do clique.
    expect(FONTES.conexoes).toContain("hostPermitido(");
  });

  it("a tela avisa que header vazio MANTÉM o que está gravado, em vez de apagar calado", () => {
    expect(FONTES.conexoes).toMatch(/manter os headers que já estão gravados/);
  });

  it("os perfis da cobrança aparecem como leitura, apontando para o Painel", () => {
    expect(FONTES.agentes).toContain("agente.daPonte");
    expect(FONTES.agentes).toMatch(/Painel do Provedor/);
  });

  it("o agente novo é anunciado como parado — criar não é ligar", () => {
    expect(FONTES.dialogoAgente).toMatch(/nasce parado/);
  });

  it("as skills do agente só nascem depois da resposta do servidor", () => {
    // Começar com Set vazio e salvar antes da resposta desligaria todas.
    expect(FONTES.dialogoSkills).toContain("marcadas === null");
  });
});

describe("desenho", () => {
  it("nenhuma classe da paleta crua do Tailwind", () => {
    const proibidas = /\b(?:bg|text|border|ring|from|to)-(?:slate|gray|zinc|neutral|stone|blue|emerald|red|green|amber|violet|indigo|rose|pink|teal|cyan|lime|orange)-\d{2,3}\b/;
    for (const [nome, fonte] of Object.entries(FONTES)) {
      expect(fonte, `${nome} usa a paleta default do Tailwind`).not.toMatch(proibidas);
    }
  });

  it("profundidade é anel de 1px, nunca shadow-md/lg/xl", () => {
    for (const [nome, fonte] of Object.entries(FONTES)) {
      expect(fonte, `${nome} usa sombra do Tailwind`).not.toMatch(/shadow-(?:md|lg|xl|2xl)\b/);
    }
  });

  it("raio não passa de 8px fora do círculo real (dot e barra)", () => {
    for (const [nome, fonte] of Object.entries(FONTES)) {
      for (const raio of [...fonte.matchAll(/rounded-\[(\d+)px\]/g)]) {
        // 14px é a pílula de filtro, que é um controle, não um selo de estado.
        expect(Number(raio[1]), `${nome}: raio ${raio[1]}px`).toBeLessThanOrEqual(14);
      }
    }
  });

  it("todo número é mono e tabular", () => {
    for (const [nome, fonte] of Object.entries(FONTES)) {
      const tabular = (fonte.match(/tabular-nums/g) ?? []).length;
      if (/textoDeMilhar|textoDeDolar|tabular/.test(fonte)) {
        expect(tabular, `${nome} tem número sem tabular-nums`).toBeGreaterThan(0);
      }
    }
  });
});

describe("formatação", () => {
  it("custo em dólar tem quatro casas — duas zerariam o preço de uma execução", () => {
    expect(textoDeDolar(0.00042)).toBe("US$ 0,0004");
    expect(textoDeDolar(0)).toBe("US$ 0,0000");
  });

  it("duração sem valor é traço, nunca zero", () => {
    expect(textoDeDuracao(null)).toBe("—");
    expect(textoDeDuracao(940)).toBe("940 ms");
    expect(textoDeDuracao(2500)).toBe("2,5 s");
  });

  it("aba desconhecida cai no resumo em vez de tela em branco", () => {
    expect(abaValida("execucoes")).toBe("execucoes");
    expect(abaValida("inventada")).toBe("resumo");
    expect(abaValida(null)).toBe("resumo");
    expect(ABAS_DO_CONSOLE.map(a => a.chave)).toContain("conexoes");
  });
});

describe("a aba vem da query, não do caminho", () => {
  it("a aba lê `?aba=` com useSearch — useLocation do wouter devolve só o caminho", () => {
    // Com `location.split("?")` a tela ficava presa no resumo: os cinco botões
    // apareciam, nenhum trocava o corpo. Só apareceu ao OLHAR a tela renderizada.
    // `toContain("useSearch")` sozinho e satisfeito pela LINHA DE IMPORT: dava
    // verde mesmo com a leitura de volta para o caminho. O que prova e a
    // chamada e o uso do valor dela.
    expect(FONTES.pagina).toMatch(/const\s+busca\s*=\s*useSearch\(\)/);
    expect(FONTES.pagina).toMatch(/URLSearchParams\(busca\)\.get\("aba"\)/);
    expect(FONTES.pagina).not.toContain("location.split");
  });
});
