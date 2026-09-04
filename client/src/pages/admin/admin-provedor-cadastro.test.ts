/**
 * A ficha cadastral do provedor no painel do superadmin — o formulário.
 *
 * A lógica (máscara, hidratação, corpo do PATCH, tradutores da Receita e do
 * ViaCEP, validação) já tem prova própria em `cadastro-provedor.test.ts`. O que
 * NÃO tem prova é a montagem: quais campos a tela desenha, para onde ela manda,
 * o que ela deixa de fora e o que ela lê da URL. Nada disso é tipado — um campo
 * esquecido, uma chave de invalidação a menos ou um `?editar=1` com outro nome
 * não produzem erro em lugar nenhum.
 *
 * A tela é um componente grande de página e o vitest deste projeto não coleta
 * `.tsx`, por falta de ambiente de DOM (ver o `include` do vitest.config.ts).
 * Como em `admin-erp-pausa.test.ts` e `CadastrosTab.test.ts`, o que se pode
 * travar aqui é o texto da fonte — o suficiente para que a remoção de um campo,
 * de uma trava ou de uma rota não passe silenciosa.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const fonte = readFileSync(join(__dirname, "admin-provedor.tsx"), "utf8");

/** A fonte sem comentário — o que a tela realmente executa. */
const executavel = fonte
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** Só o cartão de EDIÇÃO: do começo dele até o cartão de leitura logo abaixo. */
const formulario = (() => {
  const inicio = executavel.indexOf('data-testid="card-editar-cadastro"');
  const fim = executavel.indexOf('titulo="Cadastro"', inicio);
  expect(inicio).toBeGreaterThan(-1);
  expect(fim).toBeGreaterThan(inicio);
  return executavel.slice(inicio, fim);
})();

/** Só o cartão de LEITURA. */
const leitura = (() => {
  const inicio = executavel.indexOf('data-testid="dados-cadastro"');
  expect(inicio).toBeGreaterThan(-1);
  return executavel.slice(inicio, inicio + 4000);
})();

describe("os dezessete campos do cadastro", () => {
  /** Cada campo do contrato de `CadastroProvedor` e o testid da caixa dele. */
  const CAMPOS: [string, string][] = [
    ["name", "input-edit-name"],
    ["tradeName", "input-edit-trade-name"],
    ["cnpj", "input-edit-cnpj"],
    ["legalType", "input-edit-legal-type"],
    ["openingDate", "input-edit-opening-date"],
    ["businessSegment", "input-edit-segment"],
    ["contactEmail", "input-edit-email"],
    ["contactPhone", "input-edit-phone"],
    ["website", "input-edit-website"],
    ["subdomain", "input-edit-subdomain"],
    ["addressZip", "input-edit-zip"],
    ["addressStreet", "input-edit-street"],
    ["addressNumber", "input-edit-number"],
    ["addressComplement", "input-edit-complement"],
    ["addressNeighborhood", "input-edit-neighborhood"],
    ["addressCity", "input-edit-city"],
    ["addressState", "input-edit-state"],
  ];

  it.each(CAMPOS)("%s tem caixa própria (%s)", (campo, testid) => {
    expect(formulario).toContain(`id="${testid}"`);
    // O campo é lido E escrito: sem o `mudarCampo` (ou a máscara que o chama),
    // a caixa apareceria preenchida e não guardaria o que se digita nela.
    expect(formulario).toContain(`cadastro.${campo}`);
  });

  it("os testid antigos continuam existindo", () => {
    // A ficha editava name, subdomain, contactEmail, contactPhone e website.
    // Renomear um testid que já existe quebra automação de fora do repositório
    // sem quebrar nada aqui dentro.
    for (const antigo of [
      "input-edit-name", "input-edit-subdomain", "input-edit-email",
      "input-edit-phone", "input-edit-website",
    ]) {
      expect(formulario).toContain(antigo);
    }
    // Os dois botões saíram para `acoesDaEdicao`, que os desenha duas vezes —
    // no cabeçalho do cartão e no fim do formulário. Os nomes de origem ficam.
    expect(executavel).toContain("`button-save-edit${sufixo}`");
    expect(executavel).toContain("`button-cancel-edit${sufixo}`");
  });
});

describe("o que fica FORA do formulário", () => {
  // Crédito: o PATCH SUBSTITUI o saldo enquanto `POST /:id/credits` SOMA — um
  // campo de crédito aqui apagaria saldo comprado. Plano: é enum free|pro, e
  // reenviar o plano atual de um provedor legado (basic, enterprise) dá 400.
  // Situação e conferência: mudar o valor deles DISPARA E-MAIL ao provedor, e
  // um seletor perdido entre dezessete campos transforma um clique errado num
  // aviso que não dá para voltar atrás. Os quatro já têm botão próprio.
  it.each(["ispCredits", "spcCredits", "verificationStatus"])(
    "%s não é editável na ficha cadastral",
    (campo) => {
      expect(formulario).not.toContain(campo);
    },
  );

  it("nem plano nem situação viram campo do formulário", () => {
    expect(formulario).not.toContain("planForm");
    expect(formulario).not.toContain("statusMutation");
  });
});

describe("o que é enviado", () => {
  it("o corpo do PATCH sai de `corpoDoPatch`, não de um objeto montado à mão", () => {
    // `adminUpdateProviderSchema` é `.strict()`: uma chave desconhecida devolve
    // 400 e o PATCH INTEIRO não grava — e o erro cai em `formErrors`, não em
    // `fieldErrors`, então a tela nem consegue apontar o campo.
    expect(executavel).toContain("corpoDoPatch(cadastro, cadastroOriginal)");
    // E o corpo tem de sair COMPARADO com o original, nunca completo: mandar as
    // dezessete colunas a partir do retrato que a tela abriu faz o superadmin
    // desfazer, sem ver, o que o provedor gravou no painel dele nesse intervalo.
    expect(executavel).not.toContain("corpoDoPatch(cadastro)");
  });

  it("o formulário é hidratado com a LINHA INTEIRA de providers", () => {
    // Hidratar de um resumo que não traga todos os campos e depois enviar o
    // corpo completo APAGA o que o resumo não trouxe.
    expect(executavel).toContain("setCadastro(cadastroDoProvedor(p))");
    // E a hidratacao nasce da RELEITURA, nao do retrato em cache: o await tem
    // de estar la, senao a edicao comeca de um dado que pode ter horas.
    expect(executavel).toContain("await relerDetalhe()");
    expect(executavel).toContain("prepararEdicao(p)");
  });

  it("salvar é bloqueado enquanto houver erro, e a frase vai junto do campo", () => {
    // Com cadastroOriginal junto: so se julga o campo que o operador mexeu. O
    // painel do PROPRIO provedor grava sem validacao nenhuma, entao a coluna ja
    // guarda e-mail com virgula e UF por extenso — julgar o cadastro inteiro
    // TRANCA a ficha por um campo herdado que ninguem tocou, e obriga o
    // superadmin a reescrever por cima o dado real do provedor para gravar o CEP.
    expect(executavel).toContain("errosDoCadastro(cadastro, cadastroOriginal)");
    // A guarda vem ANTES do mutate: com o PATCH sendo tudo-ou-nada, mandar
    // assim mesmo faria um campo inválido cancelar as outras dezesseis
    // correções, com um "Dados inválidos" que não diz qual deles foi.
    const salvar = executavel.slice(
      executavel.indexOf("const salvarCadastro"),
      executavel.indexOf("const acoesDaEdicao"),
    );
    expect(salvar).toContain("if (temErros)");
    expect(salvar.indexOf("if (temErros)")).toBeLessThan(salvar.indexOf("editMutation.mutate"));
    // E a frase de cada campo chega à caixa dele.
    expect(formulario).toContain('erro={erroDe("cnpj")}');
    expect(formulario).toContain('erro={erroDe("addressZip")}');
  });

  it("gravar invalida também a lista de provedores", () => {
    // Nome, nome fantasia e cidade aparecem na lista e na gaveta. Sem esta
    // invalidação o superadmin corrige a razão social, volta para a lista e lê
    // o nome antigo — que é o jeito mais rápido de fazer alguém salvar de novo.
    const salvamento = executavel.slice(
      executavel.indexOf("const editMutation"),
      executavel.indexOf("const planMutation"),
    );
    expect(salvamento).toContain('queryKey: ["/api/admin/providers", providerId, "detail"]');
    expect(salvamento).toContain('queryKey: ["/api/admin/providers"]');
  });

  it("colisão de CNPJ/subdomínio (409) tem resposta própria", () => {
    // As duas colunas são UNIQUE e quem já tem o valor é OUTRA linha. A frase
    // do servidor nomeia o provedor dono — é ela que diz ONDE resolver.
    expect(executavel).toContain("e?.status === 409");
  });
});

describe("busca por CNPJ", () => {
  it("usa a rota do superadmin, nunca a do provedor", () => {
    // `GET /api/provider/cnpj` lê `req.session.providerId`, que num superadmin
    // não existe.
    expect(executavel).toContain("/api/admin/cnpj/${digitos}");
    expect(executavel).not.toContain("/api/provider/cnpj");
  });

  it("preenche e pede revisão — não salva sozinha", () => {
    const busca = executavel.slice(
      executavel.indexOf("const buscarNaReceita"),
      executavel.indexOf("const buscarCep"),
    );
    expect(busca).toContain("aplicarEmpresaPublica");
    expect(busca).not.toContain("mutate");
  });

  it("os três desfechos são visíveis, e a frase do servidor é repetida", () => {
    expect(executavel).toContain('setBuscaCnpj({ estado: "buscando" })');
    expect(executavel).toContain('setBuscaCnpj({ estado: "ok"');
    expect(executavel).toContain('estado: "erro"');
    expect(executavel).toContain("e?.message");
    // Situação cadastral diferente de ATIVA é aviso, não silêncio — mas a
    // comparação passa por `situacaoRegular`, e não é letra por letra: a
    // cnpj.ws escreve "Ativa", e comparar com "ATIVA" acusava irregularidade de
    // empresa regular toda vez que as duas primeiras fontes respondiam 429.
    // Para um superadmin que pode reprovar com base nisso — e reprovar manda
    // e-mail ao provedor —, o alarme falso é caro.
    expect(formulario).toContain("situacaoRegular(buscaCnpj.situacao)");
  });
});

describe("busca por CEP", () => {
  it("só dispara com 8 dígitos, e uma vez por CEP", () => {
    // O painel do provedor dispara a cada tecla, sem trava. Aqui não: sem a
    // guarda, apagar e redigitar o último dígito manda o mesmo CEP de novo, e a
    // resposta que chegar por último — não a da última digitação — é a que
    // sobrescreve o endereço.
    const busca = executavel.slice(
      executavel.indexOf("const buscarCep"),
      executavel.indexOf("const salvarCadastro"),
    );
    expect(busca).toContain("if (digitos.length !== 8) return");
    expect(busca).toContain("cepJaBuscado.current === digitos");
    expect(busca).toContain("cepJaBuscado.current = digitos");
  });

  it("preserva número e complemento — quem traduz a resposta é `aplicarViaCep`", () => {
    expect(executavel).toContain("aplicarViaCep");
    // O ViaCEP devolve `complemento` como faixa ("de 612 a 1510 - lado par"),
    // que não é o complemento do endereço do provedor.
    expect(executavel).not.toContain("dados.complemento");
  });
});

describe("abrir já editando", () => {
  it("lê `?editar=1` — o contrato da ação Editar da fila de Cadastros", () => {
    // Nada no compilador liga as duas pontas: se o nome do parâmetro divergir,
    // o botão da fila vira um segundo "Ver ficha" — sem erro, sem console, sem
    // sintoma. CadastrosTab.tsx navega para `/admin/provedor/${p.id}?editar=1`.
    expect(executavel).toContain('.get("editar") !== "1"');
  });

  it("a marca sai da URL depois de consumida", () => {
    // Sem isso, cancelar a edição e recarregar reabre o formulário, e o endereço
    // copiado da barra leva outra pessoa direto para dentro de uma tela de
    // escrita.
    expect(executavel).toContain("{ replace: true }");
  });

  it("abre uma vez só", () => {
    expect(executavel).toContain("edicaoAbertaPelaUrl.current = true");
  });
});

describe("leitura da ficha", () => {
  it("mostra o que o formulário edita", () => {
    // O cartão exibia sete linhas: nome fantasia, tipo societário, data de
    // abertura, segmento, endereço e a conferência do cadastro não apareciam
    // em lugar nenhum da ficha — nem em leitura. Quem corrige precisa conferir.
    for (const rotulo of [
      "Nome fantasia", "Tipo societário", "Data de abertura", "Segmento",
      "Endereço", "Conferência do cadastro",
    ]) {
      expect(leitura).toContain(`rotulo="${rotulo}"`);
    }
  });

  it("a data de abertura não passa por `new Date`", () => {
    // "2015-03-27" é lido como meia-noite UTC e, em Brasília, volta como
    // 26/03/2015: a empresa apareceria aberta um dia antes.
    expect(leitura).toContain("fmtDataIso(provider.openingDate)");
    expect(leitura).not.toContain("fmtDate(provider.openingDate)");
  });
});

describe("linguagem visual", () => {
  it("o formulário usa a caixa de campo do painel, não o Input cru do shadcn", () => {
    // O modo de edição usava `<Input>`/`<Label>` do shadcn: 40px de altura,
    // corpo de 14px e o anel de foco quase invisível que a seção 7 chama de não
    // negociável. `CONTROLE_CAMPO` é 36px, 12,5px e anel visível.
    expect(executavel).toContain("CONTROLE_CAMPO");
    expect(formulario).not.toContain("<Label");
  });

  it("nenhuma contagem de coluna é montada em tempo de execução", () => {
    // O Tailwind varre a fonte por nomes de classe inteiros: um
    // `grid-cols-${n}` nunca chega ao bundle, e a grade some sem erro nenhum.
    expect(formulario).not.toMatch(/grid-cols-\$\{/);
    expect(formulario).toContain("sm:grid-cols-2 md:grid-cols-4");
  });

  it("a data de abertura é campo de texto, não caixa de data", () => {
    // A coluna é TEXT: um valor gravado fora do ISO some da caixa `type="date"`
    // sem aviso, e o primeiro salvamento o apagaria do banco.
    const campo = formulario.slice(
      formulario.indexOf('id="input-edit-opening-date"'),
      formulario.indexOf('id="input-edit-opening-date"') + 500,
    );
    expect(campo).not.toContain('tipo="date"');
    expect(campo).toContain('placeholder="AAAA-MM-DD"');
  });

  it("os botões de salvar e cancelar se repetem no fim do formulário", () => {
    // Os do cabeçalho do cartão saem da tela assim que se rola dezessete campos.
    expect(formulario).toContain('acoesDaEdicao("")');
    expect(formulario).toContain('acoesDaEdicao("-fim")');
  });

  it("todo dado que se lê caractere a caractere é mono tabular", () => {
    // Seção 2: CNPJ, CEP, telefone, número, data e UF.
    for (const testid of [
      "input-edit-cnpj", "input-edit-zip", "input-edit-phone",
      "input-edit-number", "input-edit-opening-date", "input-edit-state",
    ]) {
      const campo = formulario.slice(
        formulario.indexOf(`id="${testid}"`) - 400,
        formulario.indexOf(`id="${testid}"`) + 300,
      );
      expect(campo, `${testid} precisa de mono tabular`).toContain("mono");
    }
  });
});
