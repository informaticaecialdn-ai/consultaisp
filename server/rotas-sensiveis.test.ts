/**
 * As rotas cujo corpo de resposta NAO pode virar linha de log.
 *
 * Duas redes protegem o log, e as duas ja falharam uma vez cada:
 *
 * · A rede FINA e `sanitizeForLog`, que censura por NOME DE CHAVE. Ela deixou
 *   passar o dossie inteiro da consulta cadastral, porque a lista tem "email"
 *   no singular e a BigDataCorp devolve `emails`, `enderecos` e `telefones`,
 *   com os campos dentro. O primeiro teste abaixo demonstra o furo em vez de
 *   descreve-lo.
 *
 * · A rede GROSSA e `corpoEhSensivel`, que suprime o corpo da rota inteira.
 *   Ela deixou passar `GET /api/admin/providers`, que publicava `erpToken` —
 *   a mesma credencial de ERP sob um nome que a lista de chaves nao conhecia.
 *
 * A lista morava em `server/index.ts`, que sobe o servidor ao ser importado, e
 * por isso este teste LIA O FONTE como texto: afirmava que uma string estava
 * escrita no arquivo, nunca que a comparacao funcionava. Desde 03/09/2026 a
 * decisao mora em `utils/sanitize-log.ts` e o teste chama a funcao — o que
 * importa quando a lista passou a aceitar expressao regular para caminho com id
 * no meio, forma que a leitura por aspas nem enxergava.
 */
import { describe, it, expect } from "vitest";
import { sanitizeForLog, corpoEhSensivel, ROTAS_SEM_CORPO_NO_LOG } from "./utils/sanitize-log";

describe("sanitizeForLog", () => {
  it("NAO cobre o que a consulta cadastral devolve", () => {
    // Este e o furo que obrigou a rota a entrar na lista grossa: a censura
    // procura "email", e a BigDataCorp devolve "emails".
    const corpo = sanitizeForLog({
      emails: ["fulano@exemplo.com"],
      enderecos: [{ logradouro: "Rua das Flores", numero: "100", cidade: "Porto Alegre" }],
      telefones: [{ ddd: "51", numero: "999998888" }],
      identidade: { nome: "FULANO DE TAL" },
    });
    // Passam limpos: a lista tem "email", "address" e "telefone" no singular,
    // e o que a BigDataCorp devolve e no plural, com os campos dentro.
    expect(corpo.emails[0]).toBe("fulano@exemplo.com");
    expect(corpo.enderecos[0].logradouro).toBe("Rua das Flores");
    expect(corpo.enderecos[0].numero).toBe("100");
    expect(corpo.telefones[0].numero).toBe("999998888");
    // "nome" esta na lista e e censurado — a censura por chave pega UM campo
    // e deixa o resto do dossie passar. E por isso que a rota inteira precisa
    // ficar de fora do log, e nao mais um nome de chave na lista.
    expect(corpo.identidade.nome).toBe("[REDACTED]");
  });

  it("censura credencial de ERP em qualquer profundidade, inclusive dentro de array", () => {
    // A forma exata da resposta que vazou em 03/09/2026: uma LISTA de provedores.
    const corpo = sanitizeForLog([
      { name: "NsLink", erpToken: "usuario:TOKEN_DO_MK", erpUrl: "http://10.0.0.5:8080" },
      { apiToken: "t", apiUser: "u", mkContraSenha: "cs", clientSecret: "cse", extraConfig: { sgpApp: "x" } },
    ]);
    expect(corpo[0].name).toBe("NsLink");
    expect(corpo[0].erpToken).toBe("[REDACTED]");
    expect(corpo[0].erpUrl).toBe("[REDACTED]");
    for (const chave of ["apiToken", "apiUser", "mkContraSenha", "clientSecret", "extraConfig"]) {
      expect(corpo[1][chave]).toBe("[REDACTED]");
    }
  });
});

describe("corpoEhSensivel", () => {
  it("cobre as tres consultas e o pedido do titular", () => {
    expect(corpoEhSensivel("/api/isp-consultations")).toBe(true);
    expect(corpoEhSensivel("/api/spc-consultations")).toBe(true);
    expect(corpoEhSensivel("/api/bigdata-consultations")).toBe(true);
    expect(corpoEhSensivel("/api/public/titular-request")).toBe(true);
  });

  it("casa por prefixo — o historico e a consulta ficam na mesma entrada", () => {
    expect(corpoEhSensivel("/api/bigdata-consultations/42")).toBe(true);
    // E so por prefixo: uma rota vizinha de nome parecido nao e coberta por acidente.
    expect(corpoEhSensivel("/api/bigdata-integration")).toBe(false);
  });

  it("cobre a leitura e a gravacao de integracao do superadmin, que devolvem credencial", () => {
    expect(corpoEhSensivel("/api/admin/providers/6/integration")).toBe(true);
    expect(corpoEhSensivel("/api/admin/providers/123/erp/mk")).toBe(true);
    expect(corpoEhSensivel("/api/admin/providers/123/erp/sgp")).toBe(true);
  });

  it("cobre tambem o teste de conexao, que devolve a mensagem crua do ERP", () => {
    // Hoje o teste responde so {ok, message} — sem credencial. Mas a `message`
    // de varios conectores carrega o hostname interno do provedor, e a rota
    // irma foi protegida justamente por esse tipo de conteudo. Se um dia o
    // diagnostico ficar mais rico, o corpo iria inteiro para o log sem ninguem
    // notar: o sufixo `/test` escapava do `[^/]+$` da expressao.
    expect(corpoEhSensivel("/api/admin/providers/42/erp/ixc/test")).toBe(true);
    expect(corpoEhSensivel("/api/admin/providers/42/erp/mk/test")).toBe(true);
  });

  /**
   * A TRILHA DE ACESSO DE SUPORTE (04/09/2026).
   *
   * `GET /api/admin/acesso-suporte/:providerId` devolve `liberadoPorNome`,
   * `revogadoPorNome` e `usadoPorNome` — nome de gente, que e exatamente o que
   * a tela pergunta. `sanitizeForLog` nao alcanca nenhum dos tres: a lista de
   * chaves tem "nome", e nenhum dos sufixados casa. Sem esta entrada, o corpo
   * virava linha de log a cada abertura da aba Suporte da ficha do provedor.
   */
  it("cobre a trilha de acesso de suporte, que devolve nome de pessoa", () => {
    expect(corpoEhSensivel("/api/admin/acesso-suporte/42")).toBe(true);
    expect(corpoEhSensivel("/api/admin/acesso-suporte/42/")).toBe(true);
    expect(corpoEhSensivel("/API/ADMIN/ACESSO-SUPORTE/42")).toBe(true);
  });

  /**
   * `GET /api/auth/me` (04/09/2026).
   *
   * Devolve a linha inteira de `providers` mais o nome de quem esta logado, e
   * `sanitizeForLog` mal a alcanca: a lista de chaves tem "nome" e "email" em
   * portugues, e as colunas se chamam `name` e `contactEmail`. Como e o endpoint
   * mais chamado do sistema, o cadastro do provedor ia para o log a cada
   * montagem de tela.
   */
  it("cobre o /me, que devolve a linha inteira do provedor", () => {
    expect(corpoEhSensivel("/api/auth/me")).toBe(true);
    expect(corpoEhSensivel("/API/AUTH/ME")).toBe(true);
    // E so ele: o resto da area de autenticacao continua no log, e e onde se
    // enxerga tentativa de login e verificacao de e-mail.
    expect(corpoEhSensivel("/api/auth/login")).toBe(false);
    expect(corpoEhSensivel("/api/auth/logout")).toBe(false);
    expect(corpoEhSensivel("/api/auth/register")).toBe(false);
  });

  it("nao cala o log de quem entrou e de quem saiu do provedor", () => {
    // Estes dois corpos nao tem nome de ninguem — id de provedor, id da janela
    // e prazo — e sao a evidencia mais barata de quem atravessou o isolamento
    // entre tenants e quando. Um prefixo teria levado os dois junto.
    expect(corpoEhSensivel("/api/admin/acesso-suporte/42/entrar")).toBe(false);
    expect(corpoEhSensivel("/api/admin/acesso-suporte/sair")).toBe(false);
    // O lado do provedor tambem fica no log: carimbos de tempo, contagens e a
    // identificacao do PROPRIO provedor que perguntou.
    expect(corpoEhSensivel("/api/provider/acesso-suporte")).toBe(false);
    expect(corpoEhSensivel("/api/provider/acesso-suporte/liberar")).toBe(false);
    expect(corpoEhSensivel("/api/provider/acesso-suporte/revogar")).toBe(false);
  });

  it("NAO apaga o log da area administrativa inteira", () => {
    // O motivo de a entrada ser expressao regular e nao o prefixo
    // "/api/admin/providers": cortar o prefixo levaria junto tudo isto.
    expect(corpoEhSensivel("/api/admin/providers")).toBe(false);
    expect(corpoEhSensivel("/api/admin/providers/6")).toBe(false);
    expect(corpoEhSensivel("/api/admin/providers/6/plan")).toBe(false);
    expect(corpoEhSensivel("/api/admin/providers/6/credits")).toBe(false);
    // O sync nao devolve credencial: responde 202 com {ok, iniciado, message}.
    expect(corpoEhSensivel("/api/admin/providers/6/sync/mk")).toBe(false);
  });

  it("nao casa com id que nao seja numero", () => {
    // Guarda contra uma regex frouxa demais que cobrisse caminhos vizinhos.
    expect(corpoEhSensivel("/api/admin/providers/abc/integration")).toBe(false);
  });

  it("a lista nao esta vazia — trava contra alguem esvazia-la sem perceber", () => {
    expect(ROTAS_SEM_CORPO_NO_LOG.length).toBeGreaterThanOrEqual(5);
  });

  /**
   * O FURO DE CAIXA (04/09/2026).
   *
   * A comparacao era `path.startsWith(entrada)`, sensivel a caixa, decidindo
   * sobre um roteador que NAO e: este projeto nao chama
   * `app.set("case sensitive routing", true)`, e o default do Express e false.
   * Medido no express 5.2.1 deste `node_modules`: `/API/isp-consultations` e
   * `/API/ISP-CONSULTATIONS` chegam ao MESMO handler que a forma em caixa
   * baixa. Ou seja, existia um endereco que servia o dossie inteiro da consulta
   * cadastral e nao casava com esta lista — o corpo iria para o log em texto
   * puro, e em cada arquivo rotacionado.
   */
  it("reconhece a rota qualquer que seja a caixa — o roteador do Express ignora caixa", () => {
    expect(corpoEhSensivel("/API/bigdata-consultations")).toBe(true);
    expect(corpoEhSensivel("/API/BIGDATA-CONSULTATIONS")).toBe(true);
    expect(corpoEhSensivel("/aPi/BigData-Consultations/42")).toBe(true);
    expect(corpoEhSensivel("/API/isp-consultations")).toBe(true);
    expect(corpoEhSensivel("/Api/Spc-Consultations")).toBe(true);
    expect(corpoEhSensivel("/API/PUBLIC/TITULAR-REQUEST")).toBe(true);
    // A entrada de expressao regular tinha o mesmo problema, com o agravante de
    // o `$` do fim nao tolerar a barra final que o Express aceita.
    expect(corpoEhSensivel("/API/ADMIN/PROVIDERS/6/INTEGRATION")).toBe(true);
    expect(corpoEhSensivel("/api/admin/providers/6/ERP/MK/TEST")).toBe(true);
  });

  it("tolera a barra final, que o Express aceita sem `strict routing`", () => {
    // Medido: `GET /api/admin/providers/6/integration/` chega ao handler. Sem
    // a normalizacao, o `$` da expressao regular nao casava e o corpo com a
    // credencial decifrada do ERP virava linha de log.
    expect(corpoEhSensivel("/api/admin/providers/6/integration/")).toBe(true);
    expect(corpoEhSensivel("/api/isp-consultations/")).toBe(true);
  });

  it("normalizar caixa nao passa a cobrir rota vizinha", () => {
    // A folga da normalizacao e so caixa e barra final: o resto continua
    // valendo, e o log da area administrativa segue inteiro.
    expect(corpoEhSensivel("/API/ADMIN/PROVIDERS")).toBe(false);
    expect(corpoEhSensivel("/API/BIGDATA-INTEGRATION")).toBe(false);
    expect(corpoEhSensivel("/API/ADMIN/PROVIDERS/6/PLAN")).toBe(false);
    expect(corpoEhSensivel("/")).toBe(false);
    expect(corpoEhSensivel("")).toBe(false);
  });

  it("toda entrada de texto da lista esta em caixa baixa", () => {
    // A comparacao rebaixa o caminho; uma entrada com maiuscula nunca casaria
    // com nada e a rota ficaria descoberta em silencio.
    for (const entrada of ROTAS_SEM_CORPO_NO_LOG) {
      if (typeof entrada === "string") expect(entrada).toBe(entrada.toLowerCase());
    }
  });
});
