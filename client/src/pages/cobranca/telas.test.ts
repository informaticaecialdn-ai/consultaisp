/**
 * As quatro telas da cobrança, as rotas e o menu — travados pelo texto da fonte.
 *
 * A lógica (filtros, formatação, formulário de negociação e de política) tem
 * prova própria em `components/cobranca/*.test.ts`. O que NÃO tem prova é a
 * montagem: qual rota abre qual tela, o que o menu aponta, quais testids
 * cada tela desenha, para que caminho cada botão manda e o que a tela
 * promete não fazer (paleta default do Tailwind, sombra, pill em selo).
 * Nada disso é tipado — e o vitest deste projeto não coleta `.tsx` (sem DOM),
 * então, como em `admin-provedor-cadastro.test.ts`, o que se trava é a fonte.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { PROVIDER_ONLY_PATHS, desvioDeRevenda, ehRotaDeCobranca, ehRotaDeProvedor } from "../../App";
import { NAV_PROVEDOR, itemDeProvedorAtivo } from "../../components/app-sidebar";

const raiz = join(__dirname, "..", "..");
const ler = (relativo: string) => readFileSync(join(raiz, relativo), "utf8");

/** A fonte sem comentário — o que a tela realmente executa. */
const executavel = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGINAS = {
  carteira: executavel(ler("pages/cobranca/carteira.tsx")),
  cliente360: executavel(ler("pages/cobranca/cliente360.tsx")),
  regua: executavel(ler("pages/cobranca/regua.tsx")),
  politica: executavel(ler("pages/cobranca/politica.tsx")),
};
const app = executavel(ler("App.tsx"));

const componentes = readdirSync(join(raiz, "components/cobranca"))
  .filter(f => f.endsWith(".tsx"))
  .map(f => [f, executavel(ler(`components/cobranca/${f}`))] as const);

/* ── Rotas ───────────────────────────────────────────────────────────── */

describe("rotas da cobrança em App.tsx", () => {
  const ROTAS: [string, string][] = [
    ["/cobranca", "pages/cobranca/carteira"],
    ["/cobranca/ativos", "pages/cobranca/carteira"],
    ["/cobranca/ex-clientes", "pages/cobranca/carteira"],
    ["/cobranca/cliente/:id", "pages/cobranca/cliente360"],
    ["/cobranca/kanban", "pages/cobranca/kanban"],
    ["/cobranca/regua", "pages/cobranca/regua"],
    ["/cobranca/politica", "pages/cobranca/politica"],
  ];

  it.each(ROTAS)("%s abre %s, carregada com pagina() como as outras", (rota, modulo) => {
    expect(app).toContain(`<Route path="${rota}"`);
    // `pagina()` é a defesa contra o chunk que some no deploy (04/09/2026);
    // uma tela importada sem ele cai no "Algo deu errado" no primeiro deploy.
    expect(app).toContain(`lazy(pagina(() => import("@/${modulo}")))`);
  });

  it("as telas fixas estão na lista de provedor; a ficha entra pelo prefixo", () => {
    // `/cobranca` e `/cobranca/fila` so redirecionam, e ficam na lista de
    // proposito: a guarda roda ANTES do desvio.
    for (const rota of ["/cobranca", "/cobranca/fila", "/cobranca/kanban", "/cobranca/regua", "/cobranca/politica"]) {
      expect(PROVIDER_ONLY_PATHS).toContain(rota);
    }
    expect(ehRotaDeCobranca("/cobranca/cliente/42")).toBe(true);
    expect(ehRotaDeProvedor("/cobranca/cliente/42")).toBe(true);
    expect(ehRotaDeProvedor("/Cobranca/Cliente/42/")).toBe(true);
  });

  it("vizinho de nome parecido não entra de carona", () => {
    expect(ehRotaDeCobranca("/cobrancas-antigas")).toBe(false);
    expect(ehRotaDeCobranca("/cobrancador")).toBe(false);
  });

  /**
   * A fila do dia saiu (pedido do dono, 06/09/2026) e o quadro ficou como
   * unico lugar do trabalho diario. O endereco dela nao pode virar "pagina nao
   * encontrada": link salvo, favorito e mensagem antiga continuam chegando.
   */
  describe("a fila do dia saiu, e o endereco dela leva ao quadro", () => {
    it("nao existe mais tela de fila", () => {
      expect(existsSync(join(raiz, "pages/cobranca/fila.tsx"))).toBe(false);
      expect(app).not.toContain('import("@/pages/cobranca/fila")');
    });

    it("/cobranca/fila redireciona para o Kanban da MESMA carteira, com o resto do recorte", () => {
      expect(app).toContain('<Route path="/cobranca/fila"><RedirecionarFila /></Route>');
      expect(app).toContain('const carteira = carteiraDaNavegacao("/cobranca/fila", search);');
      expect(app).toContain('caminhoNaCarteira(`/cobranca/kanban${search ? `?${search}` : ""}`, carteira)');
    });

    it("nenhuma tela importa a fila, e nenhum link do produto aponta para ela", () => {
      const telas = [...Object.values(PAGINAS), ...componentes.map(([, f]) => f)];
      for (const f of telas) expect(f).not.toContain("pages/cobranca/fila");
      // O unico `ROTA_FILA` que sobra e o do quadro, e ele so existe enquanto
      // o botao "Lista" nao sair; nenhuma outra tela pode voltar a apontar.
      for (const [nome, f] of Object.entries(PAGINAS)) expect(f, nome).not.toContain("ROTA_FILA");
    });
  });

  it("o revendedor é desviado da ficha do cliente, não só das telas fixas", () => {
    expect(desvioDeRevenda({ papel: "revendedor", caminho: "/cobranca/cliente/42" })).toBe("/revenda");
    expect(desvioDeRevenda({ papel: "admin", caminho: "/cobranca/cliente/42" })).toBeNull();
  });

  it("as três guardas de painel usam o prefixo, não só a lista exata", () => {
    // Sem isto, o superadmin sem sessão de suporte veria a ficha de um
    // cliente de provedor montar por um quadro antes do desvio.
    expect(app).not.toMatch(/estaNaLista\(PROVIDER_ONLY_PATHS,\s*location\)/);
    expect(app.match(/ehRotaDeProvedor\(location\)/g)?.length).toBe(2);
    expect(app).toContain("ehRotaDeProvedor(caminho) || ehRotaDaPlataforma(caminho)");
  });
});

/* ── Menu ────────────────────────────────────────────────────────────── */

describe("o grupo Cobrança na barra lateral", () => {
  const grupoCobranca = NAV_PROVEDOR.find(g => g.grupo === "Cobrança")!;
  const destinos = grupoCobranca.itens.flatMap(i => i.filhos ?? [i]);

  it("fica entre Principal e Financeiro, com Conversas antes dos dois menus", () => {
    const principal = NAV_PROVEDOR.findIndex(g => g.grupo === "Principal");
    const cobranca = NAV_PROVEDOR.findIndex(g => g.grupo === "Cobrança");
    const financeiro = NAV_PROVEDOR.findIndex(g => g.grupo === "Financeiro");
    expect(principal).toBeGreaterThan(-1);
    expect(cobranca).toBeGreaterThan(principal);
    expect(financeiro).toBeGreaterThan(cobranca);
    expect(grupoCobranca.itens.map(i => i.label)).toEqual(["Conversas", "Clientes Ativos", "Ex-Clientes", "Política"]);
    expect(grupoCobranca.itens[0].url).toBe("/cobranca/chat");
    expect(grupoCobranca.itens.at(-1)?.url).toBe("/cobranca/politica");
  });

  it("todo item do menu tem rota em App.tsx", () => {
    for (const destino of destinos) {
      expect(app).toContain(`<Route path="${destino.url.split("?")[0]}"`);
    }
    // /cobranca e so o redirecionamento para o espaco de ativos
    expect(app).toContain('<Route path="/cobranca"><RedirecionarCarteira /></Route>');
  });

  const urls = ["/", "/cobranca", "/cobranca/ativos", "/cobranca/ex-clientes", "/cobranca/kanban", "/cobranca/regua", "/cobranca/politica", "/creditos"];
  const acesos = (caminho: string) => urls.filter(u => itemDeProvedorAtivo(u, caminho));

  it("cada tela acende um item só, inclusive nos links antigos", () => {
    expect(acesos("/cobranca")).toEqual(["/cobranca/ativos"]);
    expect(acesos("/cobranca/ativos")).toEqual(["/cobranca/ativos"]);
    expect(acesos("/cobranca/ex-clientes")).toEqual(["/cobranca/ex-clientes"]);
    expect(acesos("/cobranca/kanban")).toEqual(["/cobranca/kanban"]);
    expect(acesos("/cobranca/regua")).toEqual(["/cobranca/regua"]);
    expect(acesos("/cobranca/politica")).toEqual(["/cobranca/politica"]);
  });

  it("o endereco antigo da fila nao acende nada — ele so redireciona", () => {
    expect(acesos("/cobranca/fila")).toEqual([]);
  });

  it("a ficha do cliente acende Clientes ativos, de onde se abre", () => {
    expect(acesos("/cobranca/cliente/42")).toEqual(["/cobranca/ativos"]);
  });

  it("a ficha aberta na carteira de ex-clientes mantém somente esse espaço destacado", () => {
    expect(urls.filter(u => itemDeProvedorAtivo(u, "/cobranca/cliente/42", "carteira=ex_cliente")))
      .toEqual(["/cobranca/ex-clientes"]);
  });

  it("os outros itens continuam por prefixo, e a raiz exata", () => {
    expect(acesos("/creditos/x")).toEqual(["/creditos"]);
    expect(acesos("/")).toEqual(["/"]);
    expect(acesos("/consulta-isp")).toEqual([]);
  });

  it("os destinos das duas carteiras têm identificadores próprios", () => {
    expect(new Set(destinos.map(i => i.url)).size).toBe(destinos.length);
    expect(new Set(destinos.map(i => i.testId)).size).toBe(destinos.length);
  });
});

/* ── Carteira ────────────────────────────────────────────────────────── */

describe("carteira — os dois espaços, no molde do Provedor.ai", () => {
  const f = PAGINAS.carteira;

  it("KPIs, composição, a faixa do mês, a situação ERP fixada, as pílulas, cards, tabela e rodapé", () => {
    for (const id of [
      "cobranca-carteira-${espaco}", "kpis-carteira", "kpi-clientes", "kpi-em-aberto", "kpi-contatados", "kpi-recuperado", "composicao-carteira",
      "faixa-do-mes", "mes-anterior", "mes-seguinte", "mes-atual", "mes-${ch.id}", "mes-filtro-ligado", "mes-sem-base",
      "filtros-carteira", "busca-carteira", "filtro-quadrante", "filtro-saude", "filtro-etapa", "filtro-situacao-erp", "filtro-status", "filtro-bairro", "filtro-divida",
      "grade-cards", "tabela-carteira", "rodape-carteira", "carteira-vazia", "erro-carteira",
    ]) {
      // ids com template (`mes-${ch.id}`) vivem entre crases; os fixos, entre aspas
      expect(f.includes(`"${id}"`) || f.includes(`\`${id}\``), id).toBe(true);
    }
  });

  it("dois espaços separados: ativo e ex-cliente, cada um com a própria rota, título e situação ERP fixada", () => {
    expect(f).toContain('ativos: {');
    expect(f).toContain('ex: {');
    expect(f).toContain('carteira: "ativo"');
    expect(f).toContain('carteira: "ex_cliente"');
    expect(f).toContain("rota: ROTA_CARTEIRA_ATIVOS");
    expect(f).toContain("rota: ROTA_CARTEIRA_EX");
    expect(f).toContain('titulo: "Clientes ativos"');
    expect(f).toContain('titulo: "Ex-clientes com dívida"');
    // trocar de espaço troca o recorte inteiro — nada de filtro de um vazando no outro
    expect(f).toContain("{ ...limparFiltros(atual), carteira: meta.carteira }");
  });

  it("a realidade mensal só existe para quem ainda é cliente, e os chips filtram a lista", () => {
    expect(f).toContain('enabled: espaco === "ativos"');
    expect(f).toContain('{espaco === "ativos" && (');
    expect(f).toContain("onGrupo(ativo ? \"\" : ch.id)");
    expect(f).toContain('"Pagou o mês"');
    expect(f).toContain('"Inadimplente do mês"');
    expect(f).toContain('"A vencer no mês"');
    expect(f).toContain('"Sem fatura no mês"');
    // sem base de fatura do ERP, a faixa mostra o traço e diz o motivo — nunca zero
    expect(f).toContain("const r = dados?.live ? dados.resumo : null;");
    expect(f).toContain("valor: r ? brl(r.inadimplente) : TRACO");
  });

  it("a query vai inteira ao servidor — nenhum filtro é só da página", () => {
    expect(f).toContain("queryDaCarteira(filtros)");
    expect(f).toContain("${API_CARTEIRA}?${query}");
    expect(f).not.toContain(".filter(item =>");
  });

  it("os filtros vivem na URL, com replace, para a régua e o DNA apontarem para um recorte", () => {
    expect(f).toContain("filtrosDaUrl(search)");
    expect(f).toContain("navigate(alvo, { replace: true })");
  });

  it("a URL que muda por fora vira estado — o link do DNA abre o recorte dele, não o de antes", () => {
    expect(f).toContain("if (mesmosFiltros(filtrosAtuais.current, daUrl)) return;");
    expect(f).toContain("}, [search, meta.carteira]);");
    expect(f).toContain("setFiltros(daUrl);\n    setBuscaDigitada(daUrl.busca);");
    expect(f).not.toContain("setBuscaDigitada(atual =>");
  });

  it("clique no card ou na linha abre o cliente 360", () => {
    expect(f).toContain("navigate(rotaDoCliente(item.customerId, meta.carteira))");
  });

  it("o KPI sem dado é traço, nunca zero", () => {
    expect(f).toContain("v === null || v === undefined ? TRACO");
  });
});

/* ── Cliente 360 ─────────────────────────────────────────────────────── */

describe("cliente 360", () => {
  const f = PAGINAS.cliente360;

  it("cabeçalho, cluster, ações, três horizontes e linha do tempo", () => {
    for (const id of [
      "cobranca-cliente-360", "cabecalho-360", "nome-cliente", "documento-cliente", "tempo-de-casa", "acoes-360",
      "acao-registrar-contato", "acao-abrir-negociacao", "acao-ver-regua", "acao-historico", "acao-abrir-caso",
      "card-divida", "card-score", "card-endereco", "card-economia", "secao-r24", "secao-transversal",
      "coluna-passado", "coluna-presente", "coluna-futuro", "form-caso", "sem-caso", "linha-do-tempo", "dialogo-fechar-caso",
    ]) {
      expect(f, id).toContain(`"${id}"`);
    }
  });

  it("fala com as rotas no contrato delas: motivo no fechamento, casoId na negociação, negociacaoId na parcela", () => {
    expect(f).toContain("{ status: fechar.status, ...(fechar.motivo.trim() ? { motivo: fechar.motivo.trim() } : {}) }");
    expect(f).not.toContain("motivoEncerramento:");
    expect(f).toContain("{ casoId, status }");
    expect(f).toContain("{ negociacaoId, valorPago: valor, pagoEm:");
  });

  it("o select de situação não oferece o que só a negociação muda", () => {
    expect(f).toContain('new Set(["aberto", "negociando", "acordo_ativo"])');
    expect(f).toContain("!STATUS_SO_PELA_NEGOCIACAO.has(s)");
    // Cumprida nasce da última parcela paga — a rota recusa o botão.
    expect(f).toContain('.filter(s => s !== "cumprida")');
  });

  it("o que a fase 1 não tem fica marcado, nunca preenchido com zero", () => {
    // O molde do Provedor.ai: PENDENTE e A-CRIAR com motivo, nunca zero.
    expect(f.match(/<Pendente /g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(f.match(/<ACriar /g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(f).not.toContain("NPS: 0");
  });

  it("a máquina de estados vem de shared/cobranca, não de uma lista local", () => {
    expect(f).toContain("TRANSICOES_DE_CASO[statusDoCaso]");
    expect(f).toContain("TRANSICOES_DE_NEGOCIACAO[status]");
  });
});

/* ── Régua ───────────────────────────────────────────────────────────── */

describe("régua e DNA", () => {
  const f = PAGINAS.regua;

  it("bloco A com cartões por carteira, bloco B com a grade, pausa", () => {
    for (const id of ["cobranca-regua", "bloco-regua", "abas-regua", "etapas-regua", "bloco-dna", "grade-dna", "botao-pausar-regua", "aviso-regua-pausada", "dialogo-pausar", "nota-ex-cliente", "link-politica"]) {
      expect(f, id).toContain(`"${id}"`);
    }
  });

  it("a lista por carteira vem da rota e cai na regra compartilhada sem ela", () => {
    expect(f).toContain("regua?.porCarteira?.[carteira] ?? etapasDaCarteira(carteira, catalogo)");
  });

  it("pausar e atribuir responsável gravam a política pela mesma mutação, só admin", () => {
    expect(f).toContain('apiRequest("PUT", API_POLITICA, corpo)');
    expect(f).toContain("corpoDaPausa(politica, !pausada, pausa.motivo)");
    expect(f).toContain("editarEtapa(form.etapas, id, { responsavelUserId: userId })");
    expect(f).toContain("podeEditar={podeAdministrar && politica !== null}");
  });

  it("os pisos legais aparecem por constante, não por número solto", () => {
    expect(f).toContain("PISO_AVISO_SUSPENSAO_DIAS");
    expect(f).toContain("DIAS_PRESCRICAO");
    expect(f).toContain("PRESCRICAO_ANOS");
  });

  it("fala em 'dias de atraso da fatura mais antiga', não no nome da coluna", () => {
    expect(f).not.toContain("max_days_overdue");
    expect(f).toContain("dias de atraso da fatura mais antiga");
  });

  it("os números de dado saem em mono tabular: D+15 e os 5 anos", () => {
    expect(f).toContain("<span className={MONO}>{rotuloDoDia(PISO_AVISO_SUSPENSAO_DIAS)}</span>");
    expect(f).toContain("<span className={MONO}>{PRESCRICAO_ANOS} anos</span>");
    expect(f).toContain('const MONO = "font-mono tabular-nums"');
  });

  it("a grade DNA sabe quando está carregando — zero é zero depois que a resposta chega", () => {
    expect(f).toContain("isLoading: dnaCarregando");
    expect(f).toContain("carregando={dnaCarregando}");
  });
});

/* ── Política ────────────────────────────────────────────────────────── */

describe("política", () => {
  const f = PAGINAS.politica;

  it("os seis cartões e o botão de gravar", () => {
    for (const id of ["cobranca-politica", "cartao-negociacao", "cartao-encargos", "cartao-janela", "cartao-pausa", "cartao-economia", "cartao-etapas", "salvar-politica", "aviso-somente-leitura", "erro-politica"]) {
      expect(f, id).toContain(`"${id}"`);
    }
    for (const campo of ["max-parcelas", "entrada-minima", "desconto-max", "saldo-minimo", "multa", "juros", "hora-inicio", "hora-fim", "sabado-fim", "pausada"]) {
      expect(f, campo).toContain(`"politica-${campo}"`);
    }
  });

  it("o corpo do PUT sai de corpoDoPut mais o acordo, comparados com a política gravada; a mutação recebe os dois", () => {
    // A política de acordo (0029) e por CARTEIRA e tem estado proprio na tela;
    // ela viaja no MESMO PUT, senao gravar a pausa apagaria o acordo.
    expect(f).toContain("corpoDoPut(f, gravada)");
    expect(f).toContain("acordo: acordoDoForm(a, gravada.acordo)");
    expect(f).toContain('apiRequest("PUT", API_POLITICA, corpo)');
    expect(f).toContain("lerRespostaDoPut(resposta)");
    expect(f).toContain("gravar.mutate({ f: form, a: acordo })");
  });

  it("a seção Acordo vem por carteira, com a ORIGEM da cobrança em primeiro lugar e o aviso de que sem ela não há desconto", () => {
    expect(f).toContain('"cartao-acordo"');
    expect(f).toContain("CARTEIRAS.map(carteira =>");
    // a origem antes das faixas: e ela que liga o desconto
    expect(f.indexOf("acordo-origem-")).toBeLessThan(f.indexOf("acordo-faixa-"));
    expect(f).toContain("onde a cobrança do acordo nasce");
    expect(f).toContain("acordo-sem-origem-");
    expect(f).toContain("nem no chat, nem no portal");
    // o ERP aparece desabilitado, com o motivo, em vez de sumir
    expect(f).toContain("disabled={!origemDisponivel(o)}");
    expect(f).toContain("ORIGEM_INDISPONIVEL.erp");
    for (const id of ["acordo-ate-", "acordo-desconto-", "acordo-parcelas-", "acordo-entrada-", "acordo-janela-", "acordo-excecao-desconto-", "acordo-excecao-parcelas-", "acordo-avisos-"]) {
      expect(f, id).toContain(id);
    }
  });

  it("os tetos legais são mostrados por constante ao lado das caixas, em mono tabular", () => {
    expect(f).toContain("<N>{TETOS_LEGAIS.multaPct}%</N>");
    expect(f).toContain("<N>{TETOS_LEGAIS.jurosMesPct}%</N>");
    expect(f).toContain("<N>{TETOS_LEGAIS.maxParcelas}×</N>");
    expect(f).toContain("<N>{TETOS_LEGAIS.janelaContato.horaFim}h</N>");
    expect(f).toContain("<N>{rotuloDoDia(PISO_AVISO_SUSPENSAO_DIAS)}</N>");
  });

  it("o perfil de parcelamento sai em português, não como enum cru", () => {
    expect(f).toContain("ROTULO_PARCELAMENTO_POR_STATUS[s]");
    expect(f).not.toContain(".map(([k]) => k).join(");
  });

  describe("custos e economia (R24) — decisão (d) do dono", () => {
    it("as nove caixas, com o testid derivado do campo", () => {
      for (const id of [
        "opex-link", "opex-rede-pop", "opex-suporte", "opex-manutencao-noc",
        "cac", "capex-instalacao", "equipamento-residual", "imposto-receita-pct", "ciclo-meses",
      ]) {
        // O testid nasce de `testIdDoCusto(campo)`; o que se trava aqui é o campo no catálogo das caixas.
        const campo = id.replace(/-([a-z])/g, (_, l: string) => l.toUpperCase());
        expect(f, id).toContain(`campo: "${campo}"`);
      }
      expect(f).toContain('`politica-economia-${campo.replace(/[A-Z]/g, l => `-${l.toLowerCase()}`)}`');
      expect(f).toContain("editarCusto(f, c.campo, e.target.value)");
    });

    it("'Confirmar custos' marca confirmado e grava; sem confirmação, o selo '≈ parâmetros padrão'", () => {
      expect(f).toContain('"confirmar-custos"');
      expect(f).toContain("const confirmado = confirmarCustos(form)");
      expect(f).toContain("gravar.mutate({ f: confirmado, a: acordo })");
      expect(f).toContain('"selo-parametros-padrao"');
      expect(f).toContain("≈ parâmetros padrão");
      expect(f).toContain('"selo-custos-confirmados"');
      expect(f).toContain("custosConfirmados ? (");
    });

    it("os limites vêm do vocabulário compartilhado, não de número solto", () => {
      expect(f).toContain("LIMITES_DA_ECONOMIA.cicloMeses.max");
      expect(f).toContain("LIMITES_DA_ECONOMIA.impostoReceitaPct.max");
      expect(f).toContain("CICLO_MESES_PADRAO");
    });
  });

  it("domingo e feriado ficam travados — o servidor desliga de qualquer jeito", () => {
    expect(f).toContain("disabled checked={false} readOnly /> domingo");
    expect(f).toContain("disabled checked={false} readOnly /> feriado");
  });

  it("operador não grava: as caixas travam e a razão aparece", () => {
    expect(f).toContain("const travado = !podeAdministrar || gravar.isPending || !form");
  });
});

/* ── Importação — o que o tsc não vê ─────────────────────────────────── */

describe("as quatro telas e os diálogos importam sem erro", () => {
  // Uma tela é só JSX; o que quebra em tempo de import — um símbolo que a
  // versão do lucide não exporta, um nome errado de `@shared/cobranca` — não
  // dá erro de tipo quando o símbolo existe com outro valor. Importar de
  // verdade é a prova mais barata que existe sem DOM.
  it.each([
    "../../pages/cobranca/carteira.tsx",
    "../../pages/cobranca/cliente360.tsx",
    "../../pages/cobranca/regua.tsx",
    "../../pages/cobranca/politica.tsx",
  ])("%s", async modulo => {
    const m = (await import(/* @vite-ignore */ modulo)) as { default: unknown };
    expect(typeof m.default).toBe("function");
  }, 20_000); // Importar a árvore inteira de shadcn/lucide num Windows frio passa dos 5 s padrão.
});

/* ── Diálogos e primitivas — o que o tsc não vê ──────────────────────── */

describe("diálogos de contato e de abrir caso", () => {
  const contato = componentes.find(([n]) => n === "DialogoContato.tsx")![1];
  const abrirCaso = componentes.find(([n]) => n === "DialogoAbrirCaso.tsx")![1];

  it("resultado e canal não têm padrão: caixa vazia, obrigatória, botão travado sem escolha", () => {
    expect(contato).toContain('resultado: "",');
    expect(contato).toContain('canal: alvo?.canalSugerido ?? "",');
    expect(contato).toContain('<option value="" disabled>escolha o resultado</option>');
    expect(contato).toContain('<option value="" disabled>escolha o canal</option>');
    expect(contato).toContain("const semEscolha = !form.canal || !form.resultado");
    expect(contato).toContain("|| semEscolha ||");
    expect(contato.match(/<select className=\{CONTROLE_CAMPO\} required/g)?.length).toBe(2);
  });

  it("próximo contato tem agora como piso nos dois diálogos, e o submit recusa data passada", () => {
    for (const f of [contato, abrirCaso]) {
      expect(f).toContain("min={agoraInput()}");
      expect(f).toContain("validarProximoContato(form.proximoContatoEm, new Date())");
      expect(f).toContain("onSubmit={e => { e.preventDefault(); enviar(); }}");
    }
  });
});

describe("os toasts de erro mostram todas as frases da API", () => {
  const comToast: Array<readonly [string, string]> = [
    ["pages/regua.tsx", PAGINAS.regua],
    ["pages/politica.tsx", PAGINAS.politica],
    ...componentes.filter(([n]) => n === "DialogoContato.tsx" || n === "DialogoAbrirCaso.tsx"),
  ];

  it.each(comToast)("%s usa descricaoDoErro no description, nunca só a primeira frase", (_nome, f) => {
    expect(f).toContain("description: descricaoDoErro(erro)");
    expect(f).not.toContain("description: mensagemDoErro(erro)");
  });

  it("descricaoDoErro nasce de frasesDoErro, e mensagemDoErro é a primeira delas", () => {
    const ui = componentes.find(([n]) => n === "ui.tsx")![1];
    expect(ui).toContain("const frases = frasesDoErro(erro)");
    expect(ui).toContain("return frasesDoErro(erro)[0]");
  });
});

describe("primitivas da cobrança", () => {
  const ui = componentes.find(([n]) => n === "ui.tsx")![1];
  const grade = componentes.find(([n]) => n === "GradeDna.tsx")![1];

  it("o foco da pílula sobe para o chip visível — o select dentro dela é invisível", () => {
    expect(ui).toContain("has-[:focus-visible]:outline has-[:focus-visible]:outline-2");
    // Ancorado em código: `executavel()` já tirou os comentários de seção.
    const pilula = ui.slice(ui.indexOf("export function FiltroPilula"), ui.indexOf("export function Cartao"));
    expect(pilula.length).toBeGreaterThan(0);
    expect(pilula).toContain("FOCO_DENTRO,");
    expect(pilula).not.toContain("FOCO)");
    expect(pilula).toContain("opacity-0 outline-none");
  });

  it("os status novos têm tom e rótulo no selo do caso", () => {
    expect(ui).toContain('em_contato: "info"');
    expect(ui).toContain('cancelamento: "past"');
    expect(ui).toContain("{rotuloDoStatusDeCaso(status)}");
  });

  it("a grade DNA mostra zero depois de carregar; traço só enquanto carrega", () => {
    expect(grade).toContain("totais.get(quadrante) ?? (carregando ? null : { casos: 0, valor: 0 })");
    expect(grade).toContain("const t = contagemDoQuadrante(totais, q, carregando)");
    expect(grade).not.toContain("const t = totais.get(q) ?? null");
  });
});

/* ── Linguagem visual — o DESIGN_SYSTEM é lei ────────────────────────── */

describe("linguagem visual da cobrança inteira", () => {
  const fontes: Array<readonly [string, string]> = [
    ...Object.entries(PAGINAS).map(([n, f]) => [`pages/${n}.tsx`, f] as const),
    ...componentes,
  ];

  it.each(fontes)("%s não usa a paleta default do Tailwind", (_nome, f) => {
    expect(f).not.toMatch(/\b(?:bg|text|border|from|to|via|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/);
  });

  it.each(fontes)("%s não usa sombra do Tailwind nem gradiente nem raio acima de 8px", (_nome, f) => {
    expect(f).not.toMatch(/\bshadow-(?:sm|md|lg|xl|2xl)\b/);
    expect(f).not.toMatch(/\bbg-gradient-to-/);
    expect(f).not.toMatch(/\brounded-(?:xl|2xl|3xl)\b/);
  });

  it("selo é retangular — o único rounded-full é avatar ou ponto", () => {
    const ui = componentes.find(([n]) => n === "ui.tsx")![1];
    const selo = ui.slice(ui.indexOf("export function SeloCobranca"), ui.indexOf("const FAMILIA_PARA_TOM"));
    expect(selo).not.toContain("rounded-full");
    expect(selo).toContain("font-mono");
    expect(selo).toContain("tabular-nums");
  });

  it.each(Object.entries(PAGINAS))("%s escreve número em mono tabular", (_nome, f) => {
    expect(f).toContain("tabular-nums");
  });

  it("a carteira mostra o documento por extenso, e sem documento mostra o traço com o motivo", () => {
    // Decisão do dono (06/09/2026): a carteira é do provedor; o "***" saiu.
    const card = componentes.find(([n]) => n === "CardCliente.tsx")![1];
    expect(card).toContain("item.documento || <Traco titulo={MOTIVO_SEM_DOCUMENTO} />");
    expect(card).not.toContain("documentoMascarado");
    expect(card).not.toContain("cpfCnpj");
  });
});
