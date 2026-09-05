/**
 * O CNPJ do provedor NAS TELAS — a varredura que impede a regressão de voltar.
 *
 * O DEFEITO, medido em produção em 05/09/2026: `providers.cnpj` guardava duas
 * formas do mesmo dado. Dois provedores com os 14 dígitos crus e QUATRO com a
 * pontuação dentro do banco ("23.864.873/0001-48"), porque o cadastro público
 * validava o CNPJ normalizado e gravava o que foi digitado. Como a conferência
 * de duplicidade compara string com string, quem se recadastrasse digitando os
 * 14 dígitos não casaria com a linha pontuada e nasceria um SEGUNDO provedor
 * para a mesma empresa — carteira, créditos e alerta de anti-fraude partidos em
 * dois tenants.
 *
 * A correção normaliza a coluna. E é justamente aí que ela ameaça esses quatro:
 * a pontuação que eles veem hoje vem do BANCO, não de formatação de tela. Sem
 * máscara na exibição, a correção chegaria neles como uma regressão visível —
 * o CNPJ da empresa virando "23864873000148" no painel, na fatura e na gaveta.
 *
 * Esta varredura trava três coisas, e nenhuma delas é tipada:
 *   1. todo lugar que EXIBE CNPJ de provedor passa por `cnpjMascarado`;
 *   2. ninguém escreve um SEGUNDO mascarador (havia quatro cópias);
 *   3. o painel do provedor não manda `cnpj` no corpo do PATCH do perfil.
 *
 * O vitest deste projeto não coleta `.tsx` e não há ambiente de DOM (ver o
 * `include` do vitest.config.ts), então o que se prova aqui é o texto da fonte —
 * o mesmo caminho de `admin-provedor-cadastro.test.ts` e `CadastrosTab.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "..");

function ler(relativo: string): string {
  return readFileSync(join(RAIZ, relativo), "utf8");
}

/** A fonte sem comentário — o que a tela realmente executa. */
function executavel(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Todo `.ts`/`.tsx` de `client/src`, menos os próprios testes. */
function fontesDoClient(dir = RAIZ, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      fontesDoClient(caminho, acc);
    } else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) {
      acc.push(caminho);
    }
  }
  return acc;
}

/**
 * Os lugares que exibem CNPJ DE PROVEDOR, e a expressão de onde o valor sai.
 *
 * Ficam de fora, de propósito, os CNPJ que não são de provedor: o do cliente
 * consultado (`consulta-*`, `inadimplentes`, `equipamentos`), o do tomador da
 * NFS-e, o da marca revendedora em `admin-marcas`/`revenda/marca` (coluna
 * própria, não `providers.cnpj`) e o da página `/lgpd`, que nomeia o
 * controlador a partir da marca ou de `LGPD_CNPJ`. A migração não encosta em
 * nenhum deles.
 */
const TELAS: { arquivo: string; expressao: string; nota: string }[] = [
  {
    arquivo: "pages/provedor/painel-provedor.tsx",
    expressao: "cnpjMascarado(profileData?.cnpj)",
    nota: "cartão Dados Cadastrais",
  },
  {
    arquivo: "pages/provedor/painel-provedor.tsx",
    expressao: "cnpjMascarado(provider?.cnpj)",
    nota: "aviso da busca na Receita e o campo readOnly da aba Empresa",
  },
  {
    arquivo: "pages/provedor/administracao.tsx",
    expressao: "cnpjMascarado(provider?.cnpj)",
    nota: "aba Provedor",
  },
  {
    arquivo: "pages/admin/admin-provedor.tsx",
    expressao: "cnpjMascarado(provider.cnpj)",
    nota: "ficha do superadmin, cartão de leitura",
  },
  {
    arquivo: "pages/admin/admin-provedor.tsx",
    expressao: "cnpjMascarado(cadastro.cnpj)",
    nota: "ficha do superadmin, campo de edição",
  },
  {
    arquivo: "components/admin/ProviderDrawer.tsx",
    expressao: "cnpjMascarado(provider.cnpj)",
    nota: "gaveta da lista de provedores",
  },
  {
    arquivo: "components/admin/tabs/CadastrosTab.tsx",
    expressao: "cnpjMascarado(p.cnpj)",
    nota: "lista de cadastros vindos do site",
  },
  {
    arquivo: "components/admin/NewProviderWizard.tsx",
    expressao: "cnpjMascarado(form.cnpj)",
    nota: "cadastro de provedor pelo superadmin",
  },
  {
    arquivo: "pages/public/invoice-view.tsx",
    expressao: "cnpjMascarado(invoice.providerCnpj)",
    nota: "fatura pública, bloco Tomador de Serviços",
  },
  {
    arquivo: "pages/auth/cadastro-wizard.tsx",
    expressao: "cnpjMascarado(empresa.cnpj)",
    nota: "cadastro público, cartão da empresa achada na Receita",
  },
];

describe("todo CNPJ de provedor sai mascarado", () => {
  it.each(TELAS)("$arquivo — $nota", ({ arquivo, expressao }) => {
    expect(executavel(ler(arquivo))).toContain(expressao);
  });

  it.each([...new Set(TELAS.map(t => t.arquivo))])(
    "%s importa a máscara compartilhada",
    arquivo => {
      const fonte = ler(arquivo);
      // A ficha do superadmin importa de `./cadastro-provedor`, que reexporta o
      // mesmo par — nunca uma cópia.
      expect(
        fonte.includes('from "@/lib/cnpj"') || fonte.includes('from "./cadastro-provedor"'),
      ).toBe(true);
    },
  );
});

describe("nenhuma tela mostra o CNPJ cru", () => {
  /**
   * As expressões que imprimiriam a coluna direto na tela. Cada uma delas
   * ESTAVA no código antes desta correção — não são hipóteses.
   */
  const CRUS: [string, string][] = [
    ["pages/provedor/painel-provedor.tsx", "{provider?.cnpj}"],
    ["pages/provedor/painel-provedor.tsx", "{ label: \"CNPJ\", value: profileData?.cnpj }"],
    ["pages/provedor/painel-provedor.tsx", "value={provider?.cnpj || \"\"}"],
    ["pages/provedor/administracao.tsx", "value={provider?.cnpj || \"\"}"],
    ["components/admin/ProviderDrawer.tsx", "{provider.cnpj || \"—\"}"],
  ];

  it.each(CRUS)("%s não contém %s", (arquivo, cru) => {
    expect(executavel(ler(arquivo))).not.toContain(cru);
  });
});

describe("existe UM mascarador de CNPJ de provedor, e ele mora em shared/cnpj.ts", () => {
  /**
   * A assinatura de uma máscara de CNPJ escrita à mão: o pedaço que corta o
   * bloco do dígito verificador. Havia QUATRO cópias — a ficha do superadmin, o
   * wizard do superadmin, o cadastro público e a fatura. Cada cópia é uma
   * divergência esperando acontecer, e a da fatura já divergia: devolvia o
   * valor INTACTO quando ele não tinha exatamente 14 dígitos.
   */
  const ASSINATURA_DE_CNPJ = /\.slice\(8,\s*12\)/;

  /**
   * O CPF/CNPJ DO CLIENTE CONSULTADO é outro assunto, e não entra nesta conta.
   *
   * Sete telas formatam o documento de quem foi consultado — anti-fraude,
   * inadimplentes, equipamentos, SPC, LGPD, relatório cadastral. Ali o dado tem
   * 11 OU 14 dígitos (pessoa física ou jurídica), a máscara é dupla, e nada
   * disso é `providers.cnpj`: a migração não encosta em nenhum deles.
   *
   * Por isso o critério é o RAMO DE 11 DÍGITOS. Uma máscara que só sabe CNPJ é,
   * neste código, máscara de provedor — e essa já tem dono. Uma que também sabe
   * CPF é a do cliente, e fica onde está.
   */
  const ramoDeCpf = (fonte: string) =>
    /\.slice\(6,\s*9\)/.test(fonte) || /length === 11/.test(fonte);

  it("nenhum outro arquivo de client formata CNPJ de provedor por conta própria", () => {
    const culpados = fontesDoClient()
      .filter(caminho => !caminho.endsWith(join("lib", "cnpj.ts")))
      .filter(caminho => {
        const fonte = readFileSync(caminho, "utf8");
        return ASSINATURA_DE_CNPJ.test(fonte) && !ramoDeCpf(fonte);
      })
      .map(caminho => caminho.slice(RAIZ.length + 1));

    expect(culpados).toEqual([]);
  });

  it("o critério não é vazio: a dona seria pega, não fosse ela a dona", () => {
    // Sem esta segunda metade, trocar a assinatura por algo que não casa com
    // nada deixaria o teste acima verde para sempre.
    //
    // A dona subiu para `shared/` quando o e-mail de boas-vindas entrou na
    // conta: o servidor imprime o mesmo CNPJ para uma pessoa ler, não pode
    // importar de `client/`, e a alternativa era a quinta cópia da máscara.
    // `client/src/lib/cnpj.ts` virou reexportação — por isso a varredura acima
    // continua ignorando aquele caminho, e por isso a assinatura é procurada
    // aqui.
    const dona = readFileSync(join(RAIZ, "..", "..", "shared", "cnpj.ts"), "utf8");
    expect(ASSINATURA_DE_CNPJ.test(dona)).toBe(true);
    expect(ramoDeCpf(dona)).toBe(false);
  });

  it("a lib do client reexporta a dona em vez de guardar uma cópia", () => {
    const lib = readFileSync(join(RAIZ, "lib", "cnpj.ts"), "utf8");
    expect(lib).toContain('export { cnpjCru, cnpjMascarado } from "@shared/cnpj"');
    expect(ASSINATURA_DE_CNPJ.test(lib)).toBe(false);
  });

  it("a ficha do superadmin reexporta a máscara em vez de guardar uma cópia", () => {
    // Quem já importava de `./cadastro-provedor` não pode ter quebrado: o
    // módulo continua publicando os dois nomes.
    const ficha = ler("pages/admin/cadastro-provedor.ts");
    expect(ficha).toContain('import { cnpjCru, cnpjMascarado } from "@/lib/cnpj"');
    expect(ficha).toContain("export { cnpjCru, cnpjMascarado }");
    expect(ficha).not.toContain("export function cnpjMascarado");
  });
});

describe("o CNPJ mascarado nunca entra no corpo de um PATCH", () => {
  /**
   * A trava mais importante do lote, e a menos visível.
   *
   * O botão Salvar da aba Empresa manda `getEmpresa()` INTEIRO para
   * `PATCH /api/provider/profile`, e `cnpj` está na lista de campos permitidos
   * do handler. Enquanto a tela exibia o valor cru, o CNPJ dava a volta pelo
   * navegador e voltava igual — trabalho à toa. Com a exibição mascarada, basta
   * alguém ligar o campo ao formulário para "23.864.873/0001-48" ser regravado
   * na coluna, que é exatamente a pontuação dentro do banco que a correção está
   * fechando. Chave ausente é "não mexi" para o servidor.
   */
  const painel = executavel(ler("pages/provedor/painel-provedor.tsx"));

  const fichaDaEmpresa = (() => {
    const inicio = painel.indexOf("const getEmpresa = () => empresa ??");
    expect(inicio).toBeGreaterThan(-1);
    const fim = painel.indexOf("};", inicio);
    expect(fim).toBeGreaterThan(inicio);
    return painel.slice(inicio, fim);
  })();

  it("a ficha da aba Empresa não carrega `cnpj`", () => {
    expect(fichaDaEmpresa).not.toContain("cnpj");
  });

  it("mas continua carregando os outros campos do perfil", () => {
    // Sem esta segunda metade, apagar a ficha inteira faria o teste acima passar.
    for (const campo of [
      "name", "tradeName", "legalType", "openingDate", "businessSegment",
      "contactEmail", "contactPhone", "website",
      "addressZip", "addressStreet", "addressNumber", "addressComplement",
      "addressNeighborhood", "addressCity", "addressState",
    ]) {
      expect(fichaDaEmpresa).toContain(`${campo}: profileData?.${campo}`);
    }
  });

  it("o campo de CNPJ do painel continua somente leitura", () => {
    // Ele não tem par no estado: se virasse editável, o que se digitasse não
    // seria gravado — e, pior, poderia passar a ser.
    const campo = painel.slice(painel.indexOf('data-testid="input-cnpj-somente-leitura"') - 400);
    expect(campo.slice(0, 500)).toContain("readOnly");
  });
});

describe("CNPJ é dado numérico: mono e tabular (DESIGN_SYSTEM seção 2)", () => {
  /**
   * Coluna de número desalinhada destrói a leitura de organização — e um CNPJ
   * em fonte proporcional é a pior delas, porque tem 18 caracteres e aparece em
   * lista. Cada linha abaixo é o trecho que envolve a exibição do CNPJ.
   */
  const COM_MONO: [string, string][] = [
    ["pages/provedor/painel-provedor.tsx", "font-mono tabular-nums font-bold ml-1"],
    ["pages/provedor/painel-provedor.tsx", 'className="bg-muted font-mono tabular-nums"'],
    ["pages/provedor/administracao.tsx", 'className="font-mono tabular-nums"'],
    ["components/admin/tabs/CadastrosTab.tsx", 'className="font-mono tabular-nums"'],
    ["pages/public/invoice-view.tsx", "font-mono tabular-nums"],
  ];

  it.each(COM_MONO)("%s tem %s", (arquivo, classe) => {
    expect(ler(arquivo)).toContain(classe);
  });

  it("o cartão Dados Cadastrais marca o CNPJ como mono", () => {
    // A lista mistura texto ("Razao Social") e dado ("CNPJ"); só o dado vira
    // mono, senão a razão social também sairia em fonte de máquina.
    const painel = executavel(ler("pages/provedor/painel-provedor.tsx"));
    expect(painel).toContain('{ label: "CNPJ", value: cnpjMascarado(profileData?.cnpj), mono: true }');
    expect(painel).toContain('i.mono ? " font-mono tabular-nums" : ""');
  });

  it("a gaveta e a ficha do superadmin marcam o CNPJ como mono", () => {
    expect(ler("components/admin/ProviderDrawer.tsx"))
      .toContain('<Dado rotulo="CNPJ" mono={!!provider.cnpj}>');
    expect(ler("pages/admin/admin-provedor.tsx"))
      .toContain('<DadoCadastro rotulo="CNPJ" mono={!!provider.cnpj}>');
  });
});
