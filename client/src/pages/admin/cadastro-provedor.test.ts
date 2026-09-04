/**
 * A ficha cadastral do provedor no painel do superadmin.
 *
 * A tela é `.tsx` e este projeto não roda componente em DOM: sem este arquivo,
 * um formulário que grava CNPJ, subdomínio e endereço de um tenant não teria
 * prova nenhuma. Por isso a lógica saiu do componente — e é aqui que ela é
 * julgada.
 *
 * Quatro defeitos MEDIDOS no caminho antigo estão presos aqui como teste:
 *
 * 1. A tela mandava as 17 colunas SEMPRE, a partir de um retrato que a query do
 *    detalhe congelou (`staleTime` infinito). Isso deixava o superadmin DESFAZER,
 *    sem ver, o que o provedor tinha acabado de gravar no painel dele. O corpo
 *    passou a levar só o que mudou — e a comparação é sobre o valor JÁ
 *    NORMALIZADO dos dois lados, senão a normalização vira reescrita silenciosa.
 * 2. A ficha enviava `""` onde a coluna era nula: 400 "Dados inválidos" sem
 *    dizer qual campo, e o PATCH é tudo-ou-nada.
 * 3. `cnpj` é `regex(/^\d{14}$/)` e não é nulo: máscara na tela, ou campo em
 *    branco, é 400 na hora.
 * 4. A validação do client divergia da do servidor nos dois sentidos, e os dois
 *    doem: mais ESTRITA no site (`new URL()` + host com ponto) trancava as
 *    outras dezesseis correções por causa de um campo que ninguém pediu para
 *    mexer; mais FROUXA no e-mail deixava "contato@x,br" passar e levar 400.
 */
import { describe, it, expect } from "vitest";
import {
  CAMPOS_DO_CADASTRO,
  SEGMENTOS,
  TIPOS_SOCIETARIOS,
  aplicarEmpresaPublica,
  aplicarViaCep,
  cadastroDoProvedor,
  cepCru,
  cepMascarado,
  cnpjCru,
  cnpjMascarado,
  corpoDoPatch,
  errosDoCadastro,
  opcoesComValorAtual,
  siteNormalizado,
  tipoSocietario,
  type CadastroProvedor,
} from "./cadastro-provedor";

/** Uma ficha completa e válida, como ela fica depois de hidratada e revisada. */
const FICHA: CadastroProvedor = {
  name: "AMPLISINAL PROVEDOR TELECOM LTDA",
  tradeName: "Amplisinal",
  cnpj: "12345678000199",
  legalType: "LTDA",
  openingDate: "2015-03-27",
  businessSegment: "ISP / Provedor de Internet",
  contactEmail: "contato@amplisinal.com.br",
  contactPhone: "(31) 99999-8888",
  website: "https://amplisinal.com.br",
  subdomain: "amplisinal",
  addressZip: "31000000",
  addressStreet: "Rua das Palmeiras",
  addressNumber: "150",
  addressComplement: "Sala 3",
  addressNeighborhood: "Centro",
  addressCity: "Belo Horizonte",
  addressState: "MG",
};

/** Campos que o formulário NUNCA pode enviar. Cada um por um motivo diferente. */
const PROIBIDOS = [
  "plan", "ispCredits", "spcCredits", "bigdataCredits",
  "status", "verificationStatus", "motivo", "id", "createdAt", "marcaId",
];

describe("cadastroDoProvedor", () => {
  it("provedor ausente devolve os 17 campos em branco, e nenhum undefined", () => {
    // O formulário é controlado: um `undefined` num `value` faz o React trocar
    // o campo para não-controlado e reclamar no console em cada tecla.
    for (const p of [null, undefined]) {
      const c = cadastroDoProvedor(p);
      expect(Object.keys(c).sort()).toEqual([...CAMPOS_DO_CADASTRO].sort());
      for (const campo of CAMPOS_DO_CADASTRO) expect(c[campo]).toBe("");
    }
  });

  it("coluna nula vira string vazia, nunca 'null'", () => {
    const c = cadastroDoProvedor({
      name: "Provedor Sem Nada", cnpj: "12345678000199",
      tradeName: null, website: null, contactEmail: null, addressComplement: null,
    });
    expect(c.tradeName).toBe("");
    expect(c.website).toBe("");
    expect(c.contactEmail).toBe("");
    expect(c.addressComplement).toBe("");
  });

  it("CNPJ e CEP entram crus, mesmo gravados com máscara", () => {
    // O estado guarda o dado; a máscara é da exibição. Guardar mascarado é o
    // que faz o PATCH devolver 400 no `regex(/^\d{14}$/)`.
    const c = cadastroDoProvedor({ cnpj: "12.345.678/0001-99", addressZip: "31000-000" });
    expect(c.cnpj).toBe("12345678000199");
    expect(c.addressZip).toBe("31000000");
  });

  it("número que chega como número vira texto", () => {
    const c = cadastroDoProvedor({ addressNumber: 150 });
    expect(c.addressNumber).toBe("150");
  });

  it("não traz nada além dos campos do cadastro", () => {
    // A linha de `providers` tem plano, crédito e status. Nenhum deles entra na
    // ficha: se entrasse, sairia no corpo do PATCH.
    const c = cadastroDoProvedor({
      name: "X", cnpj: "12345678000199", plan: "pro", ispCredits: 500,
      status: "active", verificationStatus: "approved", id: 42,
    });
    for (const proibido of PROIBIDOS) expect(c).not.toHaveProperty(proibido);
  });
});

describe("máscaras de CNPJ e CEP", () => {
  it("cnpjCru aceita máscara, texto e excesso de dígitos", () => {
    expect(cnpjCru("12.345.678/0001-99")).toBe("12345678000199");
    expect(cnpjCru("12345678000199999")).toBe("12345678000199");
    expect(cnpjCru("CNPJ 12.345.678/0001-99 ")).toBe("12345678000199");
    expect(cnpjCru("")).toBe("");
  });

  it("cnpjMascarado formata em degraus, para o campo poder ser digitado", () => {
    expect(cnpjMascarado("12")).toBe("12");
    expect(cnpjMascarado("12345")).toBe("12.345");
    expect(cnpjMascarado("12345678")).toBe("12.345.678");
    expect(cnpjMascarado("123456780001")).toBe("12.345.678/0001");
    expect(cnpjMascarado("12345678000199")).toBe("12.345.678/0001-99");
  });

  it("mascarar o que já está mascarado não estraga o número", () => {
    expect(cnpjMascarado(cnpjMascarado("12345678000199"))).toBe("12.345.678/0001-99");
    expect(cepMascarado(cepMascarado("31000000"))).toBe("31000-000");
  });

  it("cepCru e cepMascarado", () => {
    expect(cepCru("31000-000")).toBe("31000000");
    expect(cepCru("310000001234")).toBe("31000000");
    expect(cepMascarado("310")).toBe("310");
    expect(cepMascarado("31000000")).toBe("31000-000");
  });
});

describe("corpoDoPatch", () => {
  /** A ficha foi aberta em FICHA, o operador mexeu nisto, e salvou. */
  const editando = (mudanca: Partial<CadastroProvedor>) =>
    corpoDoPatch({ ...FICHA, ...mudanca }, FICHA);

  it("abrir a ficha e salvar sem tocar em nada devolve corpo VAZIO", () => {
    // Corpo vazio é a resposta certa, e é o sinal de "não envie o PATCH". O
    // servidor recusa corpo sem campo de coluna com 400 "Nenhum campo para
    // alterar", justamente porque `db.update().set({})` não é no-op.
    expect(corpoDoPatch(FICHA, FICHA)).toEqual({});
  });

  it("só o campo mexido entra no corpo — os outros dezesseis não são reenviados", () => {
    // O CONSERTO-CHAVE. A ficha nasce de uma query com `staleTime` infinito: o
    // `original` é o retrato do cadastro quando a tela abriu, e envelhece. Se o
    // corpo levasse as 17 colunas, o superadmin DESFARIA sem ver o que o
    // provedor acabou de gravar no painel dele — o provedor corrige o endereço
    // às 10h05, o superadmin (ficha aberta desde as 10h00) arruma só o telefone
    // e salva às 10h10, e o endereço novo some. O PATCH responde 200 e ninguém
    // é avisado, porque do lado do servidor foi uma gravação legítima.
    const corpo = editando({ contactPhone: "(31) 98888-7777" });
    expect(Object.keys(corpo)).toEqual(["contactPhone"]);
    expect(corpo.contactPhone).toBe("(31) 98888-7777");
  });

  it("nunca emite plano, crédito, status ou motivo", () => {
    // Plano e crédito têm rota própria (o PATCH SUBSTITUI o saldo, `/credits`
    // SOMA); status e verificação DISPARAM E-MAIL ao provedor. E o schema é
    // `.strict()`: chave desconhecida é 400 e leva o PATCH inteiro.
    const corpo = corpoDoPatch({ ...FICHA, name: "Outro Nome" }, FICHA);
    for (const proibido of PROIBIDOS) expect(corpo, proibido).not.toHaveProperty(proibido);
  });

  it("mexer em tudo emite exatamente as chaves do cadastro — nem mais, nem menos", () => {
    const outra: CadastroProvedor = {
      name: "OUTRO PROVEDOR LTDA", tradeName: "Outro", cnpj: "98765432000188",
      legalType: "MEI", openingDate: "2020-01-02", businessSegment: "Telecom",
      contactEmail: "outro@outro.com.br", contactPhone: "(31) 90000-0000",
      website: "https://outro.com.br", subdomain: "outro",
      addressZip: "30000000", addressStreet: "Rua B", addressNumber: "9",
      addressComplement: "Loja", addressNeighborhood: "Savassi",
      addressCity: "Contagem", addressState: "SP",
    };
    const corpo = corpoDoPatch(outra, FICHA);
    expect(Object.keys(corpo).sort()).toEqual([...CAMPOS_DO_CADASTRO].sort());
  });

  it("campo esvaziado vira null — é assim que se apaga um campo", () => {
    const corpo = editando({ tradeName: "", website: "", addressComplement: "  " });
    expect(corpo.tradeName).toBeNull();
    expect(corpo.website).toBeNull();
    expect(corpo.addressComplement).toBeNull();
  });

  it("razão social e CNPJ esvaziados são OMITIDOS, nunca enviados como null", () => {
    // As duas colunas são `notNull` e o schema as declarou `.optional()`
    // não-nulas: `null` ali não limpa nada, devolve 400 e derruba as outras
    // dezesseis correções junto.
    const corpo = corpoDoPatch({ ...FICHA, name: "   ", cnpj: "", tradeName: "Novo" }, FICHA);
    expect(corpo).not.toHaveProperty("name");
    expect(corpo).not.toHaveProperty("cnpj");
    expect(corpo.tradeName).toBe("Novo");
  });

  it("subdomínio sai em minúsculas e sem espaço; esvaziado vira null, não ''", () => {
    // "" NÃO é NULL numa coluna UNIQUE: o primeiro provedor grava vazio e o
    // segundo estoura em 23505, que o handler traduz para "Erro interno do
    // servidor" — frase que não diz nada a quem está salvando.
    expect(editando({ subdomain: "  OutroNome " }).subdomain).toBe("outronome");
    expect(editando({ subdomain: "" }).subdomain).toBeNull();
    expect(editando({ subdomain: "   " }).subdomain).toBeNull();
  });

  it("CNPJ e CEP saem crus, mesmo digitados com máscara", () => {
    const corpo = editando({ cnpj: "98.765.432/0001-88", addressZip: "30112-000" });
    expect(corpo.cnpj).toBe("98765432000188");
    expect(corpo.addressZip).toBe("30112000");
  });

  it("UF sai em caixa alta", () => {
    // É código, e o resto do sistema compara com "MG".
    expect(editando({ addressState: "sp" }).addressState).toBe("SP");
  });

  it("o site vai como foi digitado — sem esquema inventado", () => {
    // O servidor deixou de exigir `.url()`: aceita texto livre e recusa só
    // esquema fora de http/https. Sem essa exigência, prefixar "https://"
    // seria reescrever em silêncio o que o dono do provedor informou.
    expect(editando({ website: "www.novo.com.br" }).website).toBe("www.novo.com.br");
    expect(editando({ website: "http://novo.com.br" }).website).toBe("http://novo.com.br");
  });

  it("apara espaço dos campos de texto", () => {
    const corpo = editando({
      name: "  Provedor X  ",
      tradeName: " Fantasia ",
      addressCity: " Contagem ",
    });
    expect(corpo.name).toBe("Provedor X");
    expect(corpo.tradeName).toBe("Fantasia");
    expect(corpo.addressCity).toBe("Contagem");
  });

  it("espaço a mais não é alteração: aparar dos dois lados não emite a chave", () => {
    expect(corpoDoPatch({ ...FICHA, addressCity: "  Belo Horizonte  " }, FICHA))
      .not.toHaveProperty("addressCity");
  });
});

/**
 * BAIXA-8: não reescrever em silêncio o campo que o operador não tocou.
 *
 * A comparação tem de ser sobre o valor JÁ NORMALIZADO dos dois lados. Se fosse
 * sobre o texto cru, a própria normalização da ficha viraria uma alteração — e o
 * campo do provedor seria regravado num formato que ele não escolheu, sem que
 * ninguém tenha pedido.
 */
describe("corpoDoPatch: o que o operador não tocou não vai no corpo", () => {
  it("site sem esquema, como o provedor gravou no painel dele, não é reenviado", () => {
    const gravado = cadastroDoProvedor({
      name: "PROVEDOR LEGADO LTDA", cnpj: "12345678000199", website: "www.x.com.br",
    });
    const corpo = corpoDoPatch({ ...gravado, contactPhone: "(31) 3333-4444" }, gravado);
    expect(corpo).not.toHaveProperty("website");
    expect(Object.keys(corpo)).toEqual(["contactPhone"]);
  });

  it("CEP com máscara na tela e cru no banco não é reenviado", () => {
    const corpo = corpoDoPatch(
      { ...FICHA, addressZip: "31000-000", contactPhone: "(31) 3333-4444" },
      { ...FICHA, addressZip: "31000000" },
    );
    expect(corpo).not.toHaveProperty("addressZip");
  });

  it("CNPJ com pontuação não é reenviado", () => {
    const corpo = corpoDoPatch(
      { ...FICHA, cnpj: "12.345.678/0001-99" },
      { ...FICHA, cnpj: "12345678000199" },
    );
    expect(corpo).not.toHaveProperty("cnpj");
    expect(corpo).toEqual({});
  });

  it("UF minúscula não é reenviada", () => {
    const corpo = corpoDoPatch({ ...FICHA, addressState: "mg" }, { ...FICHA, addressState: "MG" });
    expect(corpo).not.toHaveProperty("addressState");
  });

  it("subdomínio em caixa mista não é reenviado", () => {
    const corpo = corpoDoPatch(
      { ...FICHA, subdomain: "AmpliSinal" },
      { ...FICHA, subdomain: "amplisinal" },
    );
    expect(corpo).not.toHaveProperty("subdomain");
  });

  it("nulo dos dois lados não é alteração: campo em branco continua em branco", () => {
    // A ficha hidrata coluna nula como "". Enviar `null` para uma coluna que já
    // é nula é uma escrita à toa — e, num campo UNIQUE, escrita à toa é risco.
    const semNada = cadastroDoProvedor({ name: "Provedor Novo", cnpj: "12345678000199" });
    expect(corpoDoPatch(semNada, semNada)).toEqual({});
  });
});

describe("tipoSocietario", () => {
  it("reconhece a natureza da Amplisinal, com e sem acento", () => {
    expect(tipoSocietario("Sociedade Empresária Limitada")).toBe("LTDA");
    expect(tipoSocietario("Sociedade Empresaria Limitada")).toBe("LTDA");
  });

  it("MEI vem antes de EIRELI, e EIRELI antes de LTDA", () => {
    // As três compartilham palavras. Sem a ordem, "limitada" captura as três e
    // um MEI vira LTDA na ficha — e o tipo societário sai na nota fiscal.
    expect(tipoSocietario("Empresário Individual")).toBe("MEI");
    expect(tipoSocietario("Microempresário Individual (MEI)")).toBe("MEI");
    expect(tipoSocietario("Empresa Individual de Responsabilidade Limitada (EIRELI)")).toBe("EIRELI");
    expect(tipoSocietario("Sociedade Anônima Fechada")).toBe("S/A");
  });

  it("devolve vazio — e não 'Outro' — quando não reconhece", () => {
    expect(tipoSocietario("Cooperativa")).toBe("");
    expect(tipoSocietario("Associação Privada")).toBe("");
    expect(tipoSocietario(null)).toBe("");
    expect(tipoSocietario(undefined)).toBe("");
    expect(tipoSocietario("")).toBe("");
  });

  it("tudo que ele devolve existe no seletor", () => {
    // Valor fora da lista deixa o `<select>` sem `<option>` e o campo volta
    // sozinho para "Selecione...", sem erro nenhum.
    const naturezas = [
      "Sociedade Empresária Limitada", "Empresário Individual",
      "Microempresário Individual (MEI)", "Sociedade Anônima Aberta",
      "Empresa Individual de Responsabilidade Limitada", "Cooperativa",
    ];
    for (const n of naturezas) {
      const t = tipoSocietario(n);
      if (t) expect(TIPOS_SOCIETARIOS).toContain(t);
    }
  });
});

describe("opcoesComValorAtual", () => {
  it("o valor gravado fora da lista entra como opção, em vez de sumir", () => {
    // `NewProviderWizard` grava `legalType` com a natureza CRUA da Receita e
    // `businessSegment` com a atividade principal. Nenhuma das duas está nas
    // listas: num `<select>` comum o campo volta para "Selecione..." e o
    // primeiro salvamento apaga o que a Receita tinha trazido.
    const tipos = opcoesComValorAtual(TIPOS_SOCIETARIOS, "Sociedade Empresária Limitada");
    expect(tipos[0]).toBe("Sociedade Empresária Limitada");
    expect(tipos).toContain("LTDA");

    const segmentos = opcoesComValorAtual(SEGMENTOS, "Serviços de comunicação multimídia");
    expect(segmentos[0]).toBe("Serviços de comunicação multimídia");
    expect(segmentos).toContain("Telecom");
  });

  it("valor que já está na lista não é duplicado, e vazio não vira opção", () => {
    expect(opcoesComValorAtual(TIPOS_SOCIETARIOS, "LTDA")).toEqual([...TIPOS_SOCIETARIOS]);
    expect(opcoesComValorAtual(SEGMENTOS, "")).toEqual([...SEGMENTOS]);
    expect(opcoesComValorAtual(SEGMENTOS, "   ")).toEqual([...SEGMENTOS]);
  });
});

describe("aplicarEmpresaPublica", () => {
  /** A resposta de `GET /api/admin/cnpj/:cnpj`, como o servidor a monta. */
  const RECEITA = {
    razaoSocial: "AMPLISINAL PROVEDOR TELECOM LTDA",
    nomeFantasia: "Amplisinal",
    cnpj: "12.345.678/0001-99",
    naturezaJuridica: "Sociedade Empresária Limitada",
    dataAbertura: "2015-03-27",
    atividadePrincipal: "Serviços de comunicação multimídia",
    telefone: "(31) 3333-4444",
    email: "fiscal@amplisinal.com.br",
    cep: "31000-000",
    logradouro: "Rua das Palmeiras",
    numero: "150",
    complemento: "Sala 3",
    bairro: "Centro",
    cidade: "Belo Horizonte",
    uf: "MG",
    situacao: "ATIVA",
    socios: [{ nome: "Helio Cainelli", qualificacao: "Sócio-Administrador", cpf: "" }],
    fonte: "brasilapi",
  };

  const SUJA: CadastroProvedor = {
    ...FICHA,
    // O defeito real: o nome do SÓCIO gravado na razão social da empresa.
    name: "helio cainelli",
    tradeName: "", legalType: "", openingDate: "", contactEmail: "", contactPhone: "",
    addressZip: "", addressStreet: "", addressNumber: "", addressComplement: "",
    addressNeighborhood: "", addressCity: "", addressState: "",
  };

  it("o que a Receita traz substitui o que está na ficha", () => {
    const c = aplicarEmpresaPublica(SUJA, RECEITA);
    expect(c.name).toBe("AMPLISINAL PROVEDOR TELECOM LTDA");
    expect(c.tradeName).toBe("Amplisinal");
    expect(c.legalType).toBe("LTDA");
    expect(c.openingDate).toBe("2015-03-27");
    expect(c.addressStreet).toBe("Rua das Palmeiras");
    expect(c.addressCity).toBe("Belo Horizonte");
    expect(c.addressState).toBe("MG");
  });

  it("e-mail e telefone JÁ PREENCHIDOS são preservados — são o canal de aviso", () => {
    // Na Receita esses dois são o contato de quem ABRIU a empresa, quase sempre
    // o escritório de contabilidade. Aqui eles são por onde saem o aviso de sync
    // pausado, o e-mail de cadastro e o WhatsApp do anti-fraude. Trocados pelos
    // do contador, o provedor simplesmente PARA DE RECEBER ALERTA — e nada na
    // tela denuncia: o envio "dá certo", só chega na caixa errada.
    const c = aplicarEmpresaPublica(FICHA, RECEITA);
    expect(c.contactEmail).toBe(FICHA.contactEmail);
    expect(c.contactPhone).toBe(FICHA.contactPhone);
    expect(c.contactEmail).not.toBe(RECEITA.email);
    expect(c.contactPhone).not.toBe(RECEITA.telefone);
    // O resto do cadastro continua sendo corrigido pela Receita.
    expect(c.name).toBe(RECEITA.razaoSocial);
  });

  it("e-mail e telefone VAZIOS continuam vazios: o contato do contador é PIOR que nenhum", () => {
    /**
     * A primeira versão desta regra preenchia o campo vazio, pela intuição de
     * que vazio não tem nada a perder. Está errado, e a medição na busca real do
     * provedor 6 mostra os dois motivos de uma vez.
     *
     * A Receita devolveu `paralegal@contabilrh.com.br` e um fixo de São Paulo
     * para um provedor de Embu-Guaçu: o que o cadastro fiscal guarda é a caixa e
     * a linha do ESCRITÓRIO DE CONTABILIDADE.
     *
     * E campo vazio não é "sem canal". `destinatariosDoProvedor`
     * (server/services/email-destinatario.ts:48) só cai nos usuários `admin` do
     * provedor QUANDO `contactEmail` está vazio. Preencher o vazio com o
     * endereço do contador não tapa uma lacuna: sombreia o resgate, e troca as
     * pessoas que trabalham no provedor por um terceiro — em silêncio, porque o
     * e-mail "é entregue" e o WhatsApp falha só no log.
     */
    const c = aplicarEmpresaPublica(SUJA, RECEITA);
    expect(c.contactEmail).toBe(SUJA.contactEmail);
    expect(c.contactPhone).toBe(SUJA.contactPhone);
  });

  it("e-mail e telefone JÁ preenchidos também não são tocados", () => {
    const c = aplicarEmpresaPublica(FICHA, RECEITA);
    expect(c.contactEmail).toBe(FICHA.contactEmail);
    expect(c.contactPhone).toBe(FICHA.contactPhone);
    // E o resto do cadastro continua sendo corrigido pela Receita na mesma
    // chamada: a porta é só para os dois campos de contato.
    expect(c.name).toBe(RECEITA.razaoSocial);
    expect(c.addressCity).toBe(RECEITA.cidade);
  });

  it("CNPJ e CEP chegam mascarados da fonte e são guardados crus", () => {
    const c = aplicarEmpresaPublica(SUJA, RECEITA);
    expect(c.cnpj).toBe("12345678000199");
    expect(c.addressZip).toBe("31000000");
  });

  it("o que a Receita não traz é preservado", () => {
    const c = aplicarEmpresaPublica(FICHA, { ...RECEITA, nomeFantasia: "", email: "", numero: "" });
    expect(c.tradeName).toBe(FICHA.tradeName);
    expect(c.contactEmail).toBe(FICHA.contactEmail);
    expect(c.addressNumber).toBe(FICHA.addressNumber);
  });

  it("natureza jurídica que não casa preserva o tipo que já estava", () => {
    // "Outro" seria um chute, e o tipo societário sai impresso em nota fiscal.
    const c = aplicarEmpresaPublica(FICHA, { ...RECEITA, naturezaJuridica: "Cooperativa" });
    expect(c.legalType).toBe("LTDA");
  });

  it("não encosta em subdomínio, site nem segmento", () => {
    // Subdomínio é chave nossa. Site a Receita não devolve. E
    // `atividadePrincipal` é descrição de CNAE: não é nenhuma das opções de
    // SEGMENTOS, e escrevê-la num seletor fechado apaga o campo em silêncio.
    const c = aplicarEmpresaPublica(FICHA, RECEITA);
    expect(c.subdomain).toBe(FICHA.subdomain);
    expect(c.website).toBe(FICHA.website);
    expect(c.businessSegment).toBe(FICHA.businessSegment);
    expect(SEGMENTOS).not.toContain(RECEITA.atividadePrincipal);
  });

  it("resposta sem nada não apaga a ficha", () => {
    expect(aplicarEmpresaPublica(FICHA, {})).toEqual(FICHA);
  });

  it("UF minúscula da fonte vira caixa alta", () => {
    expect(aplicarEmpresaPublica(FICHA, { ...RECEITA, uf: "sp" }).addressState).toBe("SP");
  });
});

describe("aplicarViaCep", () => {
  const VIACEP = {
    cep: "01310-100",
    logradouro: "Avenida Paulista",
    complemento: "de 612 a 1510 - lado par",
    bairro: "Bela Vista",
    localidade: "São Paulo",
    uf: "SP",
  };

  it("preenche rua, bairro, cidade e UF", () => {
    const c = aplicarViaCep(FICHA, VIACEP);
    expect(c.addressStreet).toBe("Avenida Paulista");
    expect(c.addressNeighborhood).toBe("Bela Vista");
    expect(c.addressCity).toBe("São Paulo");
    expect(c.addressState).toBe("SP");
    expect(c.addressZip).toBe("01310100");
  });

  it("número e complemento digitados são preservados", () => {
    // Quem preencheu o número não quer perdê-lo ao corrigir o CEP. E o
    // `complemento` do ViaCEP não é complemento de endereço — é faixa.
    const c = aplicarViaCep(FICHA, VIACEP);
    expect(c.addressNumber).toBe("150");
    expect(c.addressComplement).toBe("Sala 3");
    expect(c.addressComplement).not.toBe(VIACEP.complemento);
  });

  it("CEP inexistente devolve a ficha intacta, nas duas formas de `erro`", () => {
    expect(aplicarViaCep(FICHA, { erro: true })).toEqual(FICHA);
    expect(aplicarViaCep(FICHA, { erro: "true" })).toEqual(FICHA);
  });

  it("CEP único de município não apaga a rua que já estava", () => {
    // Em CEP de cidade inteira o ViaCEP devolve logradouro e bairro em branco.
    // Sobrescrever ali apaga o endereço que o operador acabou de digitar.
    const c = aplicarViaCep(FICHA, {
      cep: "45000-000", logradouro: "", complemento: "", bairro: "",
      localidade: "Vitória da Conquista", uf: "BA",
    });
    expect(c.addressStreet).toBe(FICHA.addressStreet);
    expect(c.addressNeighborhood).toBe(FICHA.addressNeighborhood);
    expect(c.addressCity).toBe("Vitória da Conquista");
    expect(c.addressState).toBe("BA");
  });

  it("não encosta em nada fora do endereço", () => {
    const c = aplicarViaCep(FICHA, VIACEP);
    expect(c.name).toBe(FICHA.name);
    expect(c.cnpj).toBe(FICHA.cnpj);
    expect(c.subdomain).toBe(FICHA.subdomain);
    expect(c.contactEmail).toBe(FICHA.contactEmail);
  });
});

describe("errosDoCadastro", () => {
  it("ficha completa e correta salva", () => {
    expect(errosDoCadastro(FICHA, FICHA)).toEqual({});
  });

  it("ficha mínima — só razão social e CNPJ — também salva", () => {
    // Endereço, telefone e site em branco são estado legítimo: as colunas são
    // nulas. Exigir aqui o que o servidor não exige é campo que trava a tela
    // por nada.
    const minima = cadastroDoProvedor({ name: "Provedor Novo", cnpj: "12345678000199" });
    expect(errosDoCadastro(minima, FICHA)).toEqual({});
  });

  it("razão social é obrigatória, e espaço não conta como nome", () => {
    expect(errosDoCadastro({ ...FICHA, name: "" }, FICHA).name).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, name: "   " }, FICHA).name).toBeTruthy();
  });

  it("CNPJ vazio e CNPJ incompleto dizem coisas diferentes", () => {
    // A coluna é `notNull` e o schema do PATCH declarou o campo não-nulo: não
    // existe gravar provedor sem CNPJ. O formulário não pode prometer isso.
    const vazio = errosDoCadastro({ ...FICHA, cnpj: "" }, FICHA).cnpj;
    const curto = errosDoCadastro({ ...FICHA, cnpj: "123456780001" }, FICHA).cnpj;
    expect(vazio).toBeTruthy();
    expect(curto).toBeTruthy();
    expect(curto).not.toBe(vazio);
    expect(curto).toContain("12");   // diz quantos dígitos foram digitados
  });

  it("CNPJ digitado com máscara é válido — a máscara é da tela", () => {
    expect(errosDoCadastro({ ...FICHA, cnpj: "12.345.678/0001-99" }, FICHA)).toEqual({});
  });

  it("e-mail: formato inválido acusa, vazio não", () => {
    expect(errosDoCadastro({ ...FICHA, contactEmail: "contato" }, FICHA).contactEmail).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, contactEmail: "contato@" }, FICHA).contactEmail).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, contactEmail: "contato@empresa" }, FICHA).contactEmail).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, contactEmail: "" }, FICHA).contactEmail).toBeUndefined();
  });

  it("e-mail: o que a regra caseira deixava passar e o servidor recusava", () => {
    // A divergência medida. A regra antiga (`[^\s@]+@[^\s@]+\.[^\s@]{2,}`) só
    // exigia "um arroba e um ponto depois", então a vírgula no lugar do ponto
    // — o erro de digitação mais comum em teclado numérico — passava na tela, o
    // botão Salvar habilitava, e o servidor (`z.string().email()`) devolvia 400
    // "Dados inválidos" sem dizer qual dos dezessete campos reprovou. Agora as
    // duas pontas julgam com o MESMO zod, e não com duas regras parecidas.
    for (const email of [
      "contato@empresa,com.br",   // vírgula no lugar do ponto
      "contato@x.com,br",
      "contato@.com.br",          // domínio começando em ponto
      "contato@x..com.br",        // ponto duplo
      ".contato@x.com.br",        // local começando em ponto
      "contato@-x.com.br",        // domínio começando em hífen
      "contato@x_y.com.br",       // sublinhado em domínio
    ]) {
      expect(errosDoCadastro({ ...FICHA, contactEmail: email }, FICHA).contactEmail, email).toBeTruthy();
    }
    expect(errosDoCadastro({ ...FICHA, contactEmail: "contato@x.com.br" }, FICHA).contactEmail).toBeUndefined();
    expect(errosDoCadastro({ ...FICHA, contactEmail: "Contato@X.COM.BR" }, FICHA).contactEmail).toBeUndefined();
  });

  it("e-mail acima de 254 caracteres diz que o problema é o TAMANHO", () => {
    // O servidor é `.email().max(254)`. Um "e-mail inválido" genérico faria o
    // operador procurar erro de digitação num endereço que está certo.
    const enorme = `${"a".repeat(250)}@x.com.br`;
    const erro = errosDoCadastro({ ...FICHA, contactEmail: enorme }, FICHA).contactEmail;
    expect(erro).toBeTruthy();
    expect(erro).toContain("254");
  });

  it("site: a regra é a do servidor — texto livre, só o esquema é julgado", () => {
    // O servidor aceita `z.string().max(500)` e recusa APENAS esquema fora de
    // http/https. A regra antiga daqui (`new URL()` + host com ponto) era mais
    // estrita e trancava as outras dezesseis correções: um provedor que gravou
    // "Não temos site" no painel dele impedia o superadmin de corrigir o CNPJ.
    for (const site of [
      "www.exemplo.com.br", "exemplo.com.br", "https://exemplo.com.br",
      "http://exemplo.com.br", "https://semponto", "meu site", "Não temos site", "",
    ]) {
      expect(errosDoCadastro({ ...FICHA, website: site }, FICHA).website, site).toBeUndefined();
    }
  });

  it("site: esquema que não é http/https é recusado", () => {
    // Única recusa que sobrou, e ela tem motivo: este valor é candidato natural
    // a virar href numa tela futura, e "javascript:" num href é XSS.
    expect(errosDoCadastro({ ...FICHA, website: "javascript:alert(1)" }, FICHA).website).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, website: "mailto:contato@x.com.br" }, FICHA).website).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, website: "ftp://arquivos.exemplo.com.br" }, FICHA).website).toBeTruthy();
  });

  it("siteNormalizado apara espaço e não inventa esquema", () => {
    // Prefixar "https://" reescreveria em silêncio o dado do provedor — e o
    // servidor não pede mais isso.
    expect(siteNormalizado("www.exemplo.com.br")).toBe("www.exemplo.com.br");
    expect(siteNormalizado("  https://exemplo.com.br  ")).toBe("https://exemplo.com.br");
    expect(siteNormalizado("Não temos site")).toBe("Não temos site");
    expect(siteNormalizado("")).toBe("");
  });

  it("site acima de 500 caracteres é acusado antes de ir e voltar", () => {
    const erro = errosDoCadastro({ ...FICHA, website: `https://x.com.br/${"a".repeat(500)}` }, FICHA).website;
    expect(erro).toBeTruthy();
    expect(erro).toContain("500");
  });

  it("subdomínio: só letras minúsculas, números e hífen", () => {
    // O PATCH do servidor só limita o tamanho. Pela ficha antiga dava para
    // gravar "Meu Provedor!" numa chave de resolução de host.
    expect(errosDoCadastro({ ...FICHA, subdomain: "Meu Provedor!" }, FICHA).subdomain).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, subdomain: "meu provedor" }, FICHA).subdomain).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, subdomain: "meu_provedor" }, FICHA).subdomain).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, subdomain: "meu-provedor-2" }, FICHA).subdomain).toBeUndefined();
    // Maiúscula passa porque o corpo grava em minúsculas — o dado não muda.
    expect(errosDoCadastro({ ...FICHA, subdomain: "MeuProvedor" }, FICHA).subdomain).toBeUndefined();
  });

  it("subdomínio: menos de 2 caracteres é o mesmo mínimo do cadastro", () => {
    expect(errosDoCadastro({ ...FICHA, subdomain: "a" }, FICHA).subdomain).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, subdomain: "ab" }, FICHA).subdomain).toBeUndefined();
  });

  it("subdomínio em branco é 'sem subdomínio', não erro", () => {
    expect(errosDoCadastro({ ...FICHA, subdomain: "" }, FICHA).subdomain).toBeUndefined();
  });

  it("data de abertura: AAAA-MM-DD e data que existe de verdade", () => {
    // A coluna é TEXT em ISO. "27/03/2015" grava e depois ninguém consegue ler.
    expect(errosDoCadastro({ ...FICHA, openingDate: "27/03/2015" }, FICHA).openingDate).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, openingDate: "2015-3-7" }, FICHA).openingDate).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, openingDate: "2015-02-31" }, FICHA).openingDate).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, openingDate: "2015-13-01" }, FICHA).openingDate).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, openingDate: "2016-02-29" }, FICHA).openingDate).toBeUndefined();
    expect(errosDoCadastro({ ...FICHA, openingDate: "" }, FICHA).openingDate).toBeUndefined();
  });

  it("UF tem 2 letras; caixa não importa", () => {
    expect(errosDoCadastro({ ...FICHA, addressState: "Minas" }, FICHA).addressState).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, addressState: "M" }, FICHA).addressState).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, addressState: "31" }, FICHA).addressState).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, addressState: "mg" }, FICHA).addressState).toBeUndefined();
    expect(errosDoCadastro({ ...FICHA, addressState: "" }, FICHA).addressState).toBeUndefined();
  });

  it("CEP preenchido tem 8 dígitos", () => {
    expect(errosDoCadastro({ ...FICHA, addressZip: "3100" }, FICHA).addressZip).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, addressZip: "31000-000" }, FICHA).addressZip).toBeUndefined();
    expect(errosDoCadastro({ ...FICHA, addressZip: "" }, FICHA).addressZip).toBeUndefined();
  });

  it("os limites de tamanho do servidor são espelhados", () => {
    // Estourar um deles devolve "Dados inválidos" depois de ir e voltar, e o
    // PATCH é tudo-ou-nada: nenhuma das outras correções grava.
    expect(errosDoCadastro({ ...FICHA, name: "x".repeat(201) }, FICHA).name).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, name: "x".repeat(200) }, FICHA).name).toBeUndefined();
    expect(errosDoCadastro({ ...FICHA, tradeName: "x".repeat(201) }, FICHA).tradeName).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, contactPhone: "9".repeat(21) }, FICHA).contactPhone).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, addressCity: "x".repeat(101) }, FICHA).addressCity).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, addressNumber: "1".repeat(21) }, FICHA).addressNumber).toBeTruthy();
    expect(errosDoCadastro({ ...FICHA, subdomain: "a".repeat(51) }, FICHA).subdomain).toBeTruthy();
  });

  it("toda chave de erro é um campo que existe no formulário", () => {
    // Erro apontando para campo que a tela não tem é erro que ninguém vê — e
    // botão desabilitado sem explicação.
    const erros = errosDoCadastro({
      ...FICHA, name: "", cnpj: "1", contactEmail: "x", website: "meu site",
      subdomain: "Meu Provedor!", openingDate: "ontem", addressState: "Minas", addressZip: "3",
    }, FICHA);
    expect(Object.keys(erros).length).toBeGreaterThan(0);
    for (const campo of Object.keys(erros)) {
      expect(CAMPOS_DO_CADASTRO, campo).toContain(campo);
    }
  });
});

describe("o caminho inteiro: hidratar, corrigir e salvar", () => {
  /** A linha crua de um provedor legado, com tudo que já derrubou o PATCH. */
  const LINHA_LEGADA = {
    name: "PROVEDOR LEGADO LTDA", tradeName: null,
    cnpj: "12.345.678/0001-99", website: "www.legado.com.br",
    contactEmail: null, subdomain: "Legado", addressZip: "31000-000",
    addressComplement: null, addressState: "mg",
  };

  it("a ficha do provedor legado abre SEM ERRO e, intocada, não tem o que gravar", () => {
    // Antes, cada um desses valores travava a tela ou voltava 400: o site que o
    // provedor gravou na casa dele, o CNPJ com máscara, o subdomínio em caixa
    // mista, a UF minúscula e os campos nulos. Hoje eles abrem limpos — e, se
    // ninguém encostar em nada, o corpo é vazio: nenhuma coluna é reescrita só
    // porque a ficha foi aberta.
    const ficha = cadastroDoProvedor(LINHA_LEGADA);
    expect(errosDoCadastro(ficha, FICHA)).toEqual({});
    expect(corpoDoPatch(ficha, ficha)).toEqual({});
  });

  it("corrigir um campo do provedor legado envia esse campo, e só ele", () => {
    const ficha = cadastroDoProvedor(LINHA_LEGADA);
    const corpo = corpoDoPatch({ ...ficha, addressCity: "Betim" }, ficha);
    expect(corpo).toEqual({ addressCity: "Betim" });
  });

  it("preencher o que estava nulo grava só o que foi preenchido", () => {
    const ficha = cadastroDoProvedor(LINHA_LEGADA);
    const corpo = corpoDoPatch(
      { ...ficha, tradeName: "Legado", contactEmail: "contato@legado.com.br" },
      ficha,
    );
    expect(corpo).toEqual({ tradeName: "Legado", contactEmail: "contato@legado.com.br" });
  });

  it("siteNormalizado é o que o corpo envia, quando o site muda", () => {
    for (const site of ["exemplo.com.br", "https://exemplo.com.br", "http://x.com", ""]) {
      const corpo = corpoDoPatch({ ...FICHA, website: site }, FICHA);
      expect(corpo.website).toBe(siteNormalizado(site) || null);
    }
  });
});

/**
 * O campo herdado não pode trancar a ficha.
 *
 * O painel do PRÓPRIO provedor grava os dezesseis campos SEM validação nenhuma
 * (`PATCH /api/provider/profile` copia a lista de campos permitidos direto para
 * o banco, e as colunas são `text` sem limite). A coluna já guarda, hoje,
 * valores que este módulo recusa.
 *
 * Enquanto `errosDoCadastro` julgava o cadastro inteiro a cada render, um desses
 * valores trancava o botão Salvar: o superadmin abria a ficha para corrigir o
 * CEP e, para gravar, precisava antes reescrever por cima o e-mail de contato
 * REAL do provedor — que é por onde saem o aviso de cadastro, o de suspensão e o
 * WhatsApp do anti-fraude. E o provedor não vê essa edição acontecer.
 *
 * O servidor já se comporta assim por construção: o campo intocado nem chega até
 * ele, porque `corpoDoPatch` não o envia.
 */
describe("o campo que o operador não tocou não é julgado", () => {
  /** Valores que o painel do provedor aceita e que este módulo recusaria. */
  const LEGADOS: Array<[keyof CadastroProvedor, string]> = [
    ["contactEmail", "financeiro@x.com, suporte@x.com"],
    ["openingDate", "27/03/2015"],
    ["subdomain", "acme_net"],
    ["addressState", "Minas Gerais"],
    ["website", "x".repeat(600)],
  ];

  for (const [campo, herdado] of LEGADOS) {
    it(`\`${campo}\` herdado não impede corrigir o CEP`, () => {
      const original = { ...FICHA, [campo]: herdado };
      // O operador mexe SÓ no CEP.
      const atual = { ...original, addressZip: "37132000" };

      expect(errosDoCadastro(atual, original)).toEqual({});
      // E o corpo leva só o CEP: o valor herdado não é reenviado nem reescrito.
      expect(corpoDoPatch(atual, original)).toEqual({ addressZip: "37132000" });
    });

    it(`\`${campo}\` volta a ser julgado assim que o operador encosta nele`, () => {
      const original = { ...FICHA, [campo]: herdado };
      // Qualquer edição do próprio campo o traz de volta para a régua — a porta
      // é para o valor herdado, nunca para o valor novo.
      const atual = { ...original, [campo]: `${herdado} ` + "!" };

      expect(errosDoCadastro(atual, original)[campo]).toBeTruthy();
    });
  }

  it("razão social e CNPJ herdados também não trancam a ficha", () => {
    // Os dois são obrigatórios, mas obrigatório não é o mesmo que "impede
    // gravar outra coisa": a coluna já tem o valor, e o PATCH não vai tocá-la.
    const original = { ...FICHA, name: "", cnpj: "123" };
    const atual = { ...original, contactPhone: "(35) 3333-1111" };

    expect(errosDoCadastro(atual, original)).toEqual({});
    expect(corpoDoPatch(atual, original)).toEqual({ contactPhone: "(35) 3333-1111" });
  });

  it("apagar a razão social continua sendo erro — isso é o operador mexendo", () => {
    expect(errosDoCadastro({ ...FICHA, name: "" }, FICHA).name).toBeTruthy();
  });
});
