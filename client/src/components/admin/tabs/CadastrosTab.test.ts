/**
 * A porta de EDICAO na fila de cadastros do painel do superadmin.
 *
 * O defeito que este arquivo existe para impedir de voltar: nao havia, em lugar
 * nenhum do painel SaaS, como corrigir dado cadastral de um provedor. A gaveta
 * da lista chegava a mandar "use o Painel completo" — e la a ficha editava cinco
 * campos, sem CNPJ, sem nome fantasia e sem endereco. A fila de conferencia
 * oferecia aprovar, rejeitar, reenviar, excluir e ver; corrigir, nao.
 *
 * A ligacao entre a fila e o formulario e uma STRING: `?editar=1`. Nada no
 * compilador liga uma ponta na outra. Se a fila parar de mandar o parametro, ou
 * a ficha parar de le-lo, o botao continua existindo, continua navegando e
 * continua sem erro nenhum — vira um segundo "Ver ficha", e o superadmin volta a
 * nao ter por onde arrumar um CNPJ. E o tipo de quebra que so aparece quando
 * alguem precisa dela funcionando.
 *
 * Componente .tsx nao e coletado neste projeto (ver o `include` do
 * vitest.config.ts — falta ambiente de DOM), entao o que se pode travar aqui e o
 * texto da fonte. E o bastante: some o botao, some o parametro ou o botao muda
 * de peso visual, e o teste cai.
 *
 * A metade da ficha — ler `editar` da query — pertence a quem cuida de
 * `pages/admin/admin-provedor.tsx` e deve ser travada la, no teste dela.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { cadastroCasaBusca, termoEhDocumento } from "./CadastrosTab";

const fonte = readFileSync(join(__dirname, "CadastrosTab.tsx"), "utf8");

/** A fonte sem comentario — o que a tela realmente executa. Sem isto, um
 *  comentario que cita o nome de um token faria a auditoria passar sozinha. */
const executavel = fonte
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** O bloco do proprio botao, do `<button` que o abre ao `</button>`. */
const botaoEditar = (() => {
  const marca = executavel.indexOf("button-edit-cadastro-");
  const inicio = executavel.lastIndexOf("<button", marca);
  return executavel.slice(inicio, executavel.indexOf("</button>", marca));
})();

describe("editar o cadastro", () => {
  it("a linha oferece a acao, com o data-testid no padrao das irmas", () => {
    // `view` e `delete` ja nomeiam as duas outras acoes de linha que abrem ou
    // destroem o cadastro inteiro; `edit-cadastro-<id>` entra na mesma familia.
    expect(executavel).toContain("button-edit-cadastro-");
    expect(executavel).toContain("Editar");
  });

  it("leva a ficha JA em modo de edicao — e esse parametro e o contrato", () => {
    expect(executavel).toContain("navigate(`/admin/provedor/${p.id}?editar=1`)");
  });

  it('"Ver ficha" continua sem o parametro, senao os dois botoes sao o mesmo', () => {
    expect(executavel).toContain("navigate(`/admin/provedor/${p.id}`)");
    // Um `?editar=1` so na tela inteira: se ele vazar para o "Ver ficha", a fila
    // passa a abrir a ficha escrevendo mesmo quando o operador so quis conferir.
    expect(executavel.match(/\?editar=1/g)).toHaveLength(1);
  });
});

describe("o peso visual da acao", () => {
  it("nao e destrutiva: nao leva a tinta de --danger", () => {
    // O rotulo e o unico aviso que o operador tem antes de clicar. Vermelho num
    // botao que so abre um formulario ensina a ignorar vermelho.
    expect(botaoEditar).toContain("className={BOTAO_ACAO}");
    expect(botaoEditar).not.toContain("PERIGO");
  });

  it("nao e o CTA: o preenchimento de marca continua sendo o de 'Aprovar'", () => {
    // A fila de cadastros existe para receber aprovacao. Um segundo botao cheio
    // na mesma linha disputa o clique com ela.
    expect(botaoEditar).not.toContain("MARCA");
  });

  it("fala o vocabulario da linha: icone no tamanho das irmas + rotulo", () => {
    expect(botaoEditar).toMatch(/<\w+ className="w-3\.5 h-3\.5 flex-none"/);
  });
});

describe("onde a acao fica na linha", () => {
  const ver = executavel.indexOf("button-view-cadastro-");
  const editar = executavel.indexOf("button-edit-cadastro-");
  const excluir = executavel.indexOf("button-delete-cadastro-");

  it("as tres ultimas acoes vao em ordem de consequencia: ver, corrigir, destruir", () => {
    // "Excluir" ficava no meio, encostada nas duas acoes mais inofensivas e mais
    // clicadas da linha. O `confirm()` segura o engano; a vizinhanca e o que
    // evita chegar ate ele.
    expect(ver).toBeGreaterThan(-1);
    expect(editar).toBeGreaterThan(ver);
    expect(excluir).toBeGreaterThan(editar);
  });

  it("quem pode ver pode corrigir — nao ha guarda entre um botao e outro", () => {
    // Limitar a edicao a cadastro pendente derrubaria o motivo de existir da
    // acao: o CNPJ errado que precisa de conserto costuma ser o de um provedor
    // ja APROVADO. "Ver ficha" nao tem condicao nenhuma; se aparecer um `&&`
    // entre as duas, alguem condicionou a edicao.
    expect(executavel.slice(ver, editar)).not.toContain("&&");
  });
});

/* ------------------------------------------------------------------ */
/* A caixa de busca                                                    */
/* ------------------------------------------------------------------ */

/**
 * A busca da fila, agora testada de verdade e nao pelo texto da fonte.
 *
 * O DEFEITO QUE ESTE BLOCO EXISTE PARA IMPEDIR DE VOLTAR. Ao canonizar o CNPJ
 * para 14 digitos, a busca passou a normalizar o termo com `cnpjCru` — que
 * extrai digito de QUALQUER texto. "Net 1" virava "1"; todo CNPJ contem "1"; e
 * como as condicoes sao OR, a fila devolvia os provedores todos. O filtro por
 * nome — o de todo dia, e o unico que um nome comercial de ISP exercita, porque
 * quase todos carregam numero — deixou de estreitar.
 *
 * A intencao original continua valendo e esta coberta logo abaixo: com a coluna
 * em 14 digitos, colar o CNPJ PONTUADO de um contrato tem de achar a linha.
 *
 * A logica saiu de dentro do `.filter` no JSX justamente por isso: la ela nao
 * era alcancavel por teste (componente .tsx nao e coletado neste projeto), e foi
 * la que a regressao passou. O ultimo teste do bloco trava o fio entre a funcao
 * testada e a tela — funcao verde com JSX chamando outra coisa e a mesma falha
 * de novo, so que silenciosa.
 */
describe("busca da fila de cadastros", () => {
  /** Nomes reais de ISP: quase todos carregam numero. Os CNPJs sao os que a
   *  migracao canonizou, e TODOS contem o digito "1" — que e o que fazia a
   *  busca por "Net 1" devolver a lista inteira. */
  const CADASTROS = [
    { name: "Net 1 Telecom", contactEmail: "contato@net1.com.br", cnpj: "23864873000148" },
    { name: "Fibra 3 Provedor", contactEmail: "financeiro@fibra3.net", cnpj: "22759562000156" },
    { name: "Via 2 Telecom", contactEmail: "adm@via2.com.br", cnpj: "11444777000161" },
    { name: "Net 10 Internet", contactEmail: "suporte@net10.com.br", cnpj: "34028316000103" },
    { name: "Conecta Sul", contactEmail: "ola@conectasul.com.br", cnpj: "45997418000153" },
  ];

  const acha = (termo: string) =>
    CADASTROS.filter((c) => cadastroCasaBusca(c, termo)).map((c) => c.name);

  describe("o CNPJ colado continua achando — a intencao do lote anterior", () => {
    it("pontuado, como se copia de um contrato, acha a linha gravada em 14 digitos", () => {
      expect(acha("23.864.873/0001-48")).toEqual(["Net 1 Telecom"]);
    });

    it("os 14 digitos crus acham", () => {
      expect(acha("22759562000156")).toEqual(["Fibra 3 Provedor"]);
    });

    it("a raiz de 8 digitos acha — e o piso, entao tem de passar", () => {
      expect(acha("23864873")).toEqual(["Net 1 Telecom"]);
    });

    it("espaco em volta do que foi colado nao atrapalha", () => {
      expect(acha("  23.864.873/0001-48  ")).toEqual(["Net 1 Telecom"]);
    });

    it("normaliza os DOIS lados: linha ainda pontuada tambem e achada", () => {
      // A migracao canonizou a coluna, mas comparar digito com digito e o que
      // torna a busca indiferente a forma — de qualquer um dos lados.
      const pontuado = { name: "Legado", contactEmail: "", cnpj: "23.864.873/0001-48" };
      expect(cadastroCasaBusca(pontuado, "23864873000148")).toBe(true);
    });

    it("CNPJ que nao esta na fila nao acha nada", () => {
      expect(acha("99.999.999/0001-99")).toEqual([]);
    });
  });

  describe("a busca por nome volta a estreitar", () => {
    it('"Net 1" acha quem se chama assim, nao os cinco', () => {
      // O caso medido em producao: 0 -> 4 resultados, porque todo CNPJ contem
      // "1". Os dois que sobram sobram por NOME — "Net 1" e prefixo de "Net 10",
      // que e o que uma busca por texto tem de fazer mesmo. O que nao pode
      // voltar e a terceira, a quarta e a quinta linha entrarem pelo CNPJ.
      expect(acha("Net 1")).toEqual(["Net 1 Telecom", "Net 10 Internet"]);
      expect(acha("Net 1 Telecom")).toEqual(["Net 1 Telecom"]);
    });

    it('"Fibra 3" acha o "Fibra 3"', () => {
      expect(acha("Fibra 3")).toEqual(["Fibra 3 Provedor"]);
    });

    it('"Via 2 Telecom" acha o "Via 2 Telecom"', () => {
      expect(acha("Via 2 Telecom")).toEqual(["Via 2 Telecom"]);
    });

    it("nome sem numero nenhum continua achando", () => {
      expect(acha("Conecta")).toEqual(["Conecta Sul"]);
    });

    it("caixa nao importa", () => {
      expect(acha("NET 1 TELECOM")).toEqual(["Net 1 Telecom"]);
    });

    it("o e-mail continua sendo caminho de busca", () => {
      expect(acha("financeiro@fibra3.net")).toEqual(["Fibra 3 Provedor"]);
    });

    it("termo vazio nao filtra — a fila inteira aparece", () => {
      expect(acha("")).toHaveLength(CADASTROS.length);
      expect(acha("   ")).toHaveLength(CADASTROS.length);
    });
  });

  describe("o piso de digitos: fragmento curto nao e documento", () => {
    it('"10" sozinho procura NOME, e nao o "10" dentro de todo CNPJ', () => {
      // Sem letra para reprovar o termo, so o piso o segura. "10" cabe dentro de
      // praticamente qualquer CNPJ; sem piso, esta busca devolveria a fila toda.
      expect(acha("10")).toEqual(["Net 10 Internet"]);
    });

    it("sete digitos ainda nao sao documento — a raiz tem oito", () => {
      expect(termoEhDocumento("2386487")).toBe(false);
      expect(acha("2386487")).toEqual([]);
    });

    it("uma linha cujo CNPJ contem o fragmento nao e arrastada por ele", () => {
      // "0001" esta em quatro dos cinco CNPJs da amostra.
      expect(acha("0001")).toEqual([]);
    });
  });

  describe("termoEhDocumento", () => {
    it("aprova o que se escreve com digito, ponto, barra e hifen", () => {
      expect(termoEhDocumento("23.864.873/0001-48")).toBe(true);
      expect(termoEhDocumento("23864873000148")).toBe(true);
      expect(termoEhDocumento("23864873")).toBe(true);
    });

    it("uma letra reprova: e a assinatura de um nome", () => {
      expect(termoEhDocumento("Via 2 Telecom")).toBe(false);
      expect(termoEhDocumento("Net 1")).toBe(false);
      // Ate quando sobram digitos de sobra — o nome e que manda.
      expect(termoEhDocumento("Fibra 23864873")).toBe(false);
    });

    it("poucos digitos reprovam, mesmo sem letra nenhuma", () => {
      expect(termoEhDocumento("1")).toBe(false);
      expect(termoEhDocumento("10")).toBe(false);
      expect(termoEhDocumento("0001")).toBe(false);
      expect(termoEhDocumento("")).toBe(false);
      expect(termoEhDocumento("   ")).toBe(false);
    });

    it("pontuacao que nao e de CNPJ reprova", () => {
      // Um pedaco de e-mail ou de valor nao pode virar consulta de documento.
      expect(termoEhDocumento("@2386487300")).toBe(false);
      expect(termoEhDocumento("23.864,873")).toBe(false);
    });
  });

  it("a tela usa esta funcao — senao o teste fica verde e a busca, quebrada", () => {
    // Funcao pura testada + JSX chamando outra coisa e exatamente a mesma falha,
    // so que sem ninguem para avisar.
    expect(executavel).toContain("cadastroCasaBusca(p, cadastroSearch)");
    // E o termo cru nao volta a ser espremido por `cnpjCru` no caminho da busca:
    // foi essa linha, e so ela, que transformou "Net 1" em "1".
    expect(executavel).not.toContain("cnpjCru(cadastroSearch)");
  });
});
