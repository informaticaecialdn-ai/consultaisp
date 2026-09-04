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
