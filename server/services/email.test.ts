/**
 * As 17 mensagens transacionais, sob contrato.
 *
 * A caixa de entrada e o unico lugar do produto onde o defeito e irreversivel.
 * Entao o que este arquivo cobra de CADA mensagem, sem excecao:
 *
 *  1. Todo dado de cadastro sai ESCAPADO. Nome de provedor e campo livre; um
 *     `<img src=x onerror=...>` la dentro nao pode virar tag no e-mail.
 *  2. O assunto existe, nao carrega "undefined" e nao tem quebra de linha.
 *  3. O link leva o destinatario para o endereco por onde ELE entra — nao para
 *     a raiz da plataforma, onde o login e recusado por desenho.
 *  4. Com marca de revendedor, nada da plataforma vaza.
 *
 * A lista das mensagens vem de `script/preview-emails.ts`, que e a mesma fonte
 * da pre-visualizacao. Nao ha um catalogo aqui e outro la: mensagem nova
 * aparece na pre-visualizacao e cai neste teste no mesmo commit, ou em nenhum.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * O cliente do Resend nasce na CARGA do modulo, olhando `RESEND_API_KEY`. Sem
 * `vi.hoisted` a variavel seria posta depois do import e `send` sairia mudo.
 */
const resendFalso = vi.hoisted(() => {
  process.env.RESEND_API_KEY = "re_teste_do_modulo_de_email";
  return {
    chamadas: [] as Array<{ from: string; to: string; subject: string; html: string }>,
    erro: null as { message?: string } | null,
  };
});

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: any) => {
        resendFalso.chamadas.push(payload);
        return resendFalso.erro
          ? { data: null, error: resendFalso.erro }
          : { data: { id: "msg_teste" }, error: null };
      },
    };
  },
}));

/**
 * As 15 mensagens antigas recebem a marca pronta e nao tocam no banco. Os dois
 * e-mails de revenda nao: eles resolvem a marca pelo ID de proposito (ver
 * `painelDaRevenda` em email.ts), entao o banco falso precisa devolver uma
 * linha de `marcas` de verdade — e o caminho real de `resolverMarcaPorId`,
 * incluindo o `montar` que decide `dominioAtivo`, roda no teste.
 */
const bancoFalso = vi.hoisted(() => ({ marcas: new Map<number, any>() }));
vi.mock("../storage", () => ({
  storage: { getMarca: async (id: number) => bancoFalso.marcas.get(id) },
}));

import * as email from "./email";
import { MARCA_PLATAFORMA, esquecerMarcas, urlDaMarca, type MarcaResolvida } from "./marca.service";
import { exemplos } from "../../script/preview-emails";

/** O endereco por onde um provedor real entra: o subdominio dele. */
const URL = "https://nslink.consultaisp.com.br";

/** Se isto sair cru em qualquer lugar, o e-mail virou vetor. */
const HOSTIL = `<img src=x onerror=alert(1)>`;

const CREDNET: MarcaResolvida = {
  ...MARCA_PLATAFORMA,
  origem: "dominio-proprio",
  contexto: "tenant",
  marcaId: 7,
  dominio: "app.crednet.com.br",
  dominioAtivo: true,
  nomeProduto: "CredNet Bureau",
  assinatura: "Crédito para provedores",
  suporteEmail: "suporte@crednet.com.br",
  emailRemetente: null,
  emailNomeExibicao: null,
  cores: {
    claro: { brand: "#1F6F7A", hover: "#186068", soft: "#E4F1F3", ink: "#155760", textOnBrand: "#FFFFFF", ajustada: false },
    escuro: { brand: "#7FC6CF", hover: "#8FD2DA", soft: "#123338", ink: "#A6DCE2", textOnBrand: "#131219", ajustada: false },
  },
};

const URL_CREDNET = "https://app.crednet.com.br";

// ── Leitores do HTML ─────────────────────────────────────────────────────────

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, "&"));

const preheader = (html: string) => {
  const m = html.match(/opacity:0;">([\s\S]*?)<\/div>/);
  return m ? m[1].trim() : "";
};

/**
 * Os rotulos das linhas de `blocoDeDados`, na ordem em que aparecem.
 *
 * Serve para afirmar QUAIS campos um e-mail expoe — a pergunta que uma busca
 * por palavra no HTML nao responde, porque a mesma palavra aparece em prosa.
 * O `text-transform:uppercase` e do CSS; no fonte o rotulo esta como foi
 * escrito.
 */
const rotulosDeDados = (html: string) =>
  [...html.matchAll(/letter-spacing:1\.2px;text-transform:uppercase;">([^<]*)</g)].map(m => m[1]);

const tituloDe = (html: string) => {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return m ? m[1].replace(/<[^>]*>/g, "").trim() : "";
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. O contrato que vale para as 17
// ─────────────────────────────────────────────────────────────────────────────

describe("as 17 mensagens, uma invariante de cada vez", () => {
  const lista = exemplos(MARCA_PLATAFORMA, URL);
  const CASA = urlDaMarca(MARCA_PLATAFORMA);

  it("sao 17, e a pre-visualizacao e a mesma lista", () => {
    expect(lista).toHaveLength(17);
    expect(new Set(lista.map(x => x.chave)).size).toBe(17);
  });

  it.each(lista.map(x => [x.chave, x] as const))("%s — assunto util", (_chave, x) => {
    expect(x.assunto.trim().length).toBeGreaterThan(0);
    expect(x.assunto).not.toMatch(/undefined|null|NaN|\[object Object\]/);
    // Assunto e cabecalho: quebra de linha nele e injecao de cabecalho.
    expect(x.assunto).not.toMatch(/[\r\n]/);
  });

  it.each(lista.map(x => [x.chave, x] as const))("%s — documento completo", (_chave, x) => {
    expect(x.html.startsWith("<!DOCTYPE")).toBe(true);
    expect(x.html).toContain('lang="pt-BR"');
    expect(x.html).toContain("</html>");
  });

  it.each(lista.map(x => [x.chave, x] as const))("%s — preheader proprio", (_chave, x) => {
    const previa = preheader(x.html);
    expect(previa.length).toBeGreaterThan(0);
    expect(previa).not.toMatch(/undefined|null/);
    // Preheader que repete o titulo desperdica a unica linha de previa que a
    // caixa de entrada da, e o assunto ja diz aquilo.
    expect(previa).not.toBe(tituloDe(x.html));
  });

  it.each(lista.map(x => [x.chave, x] as const))("%s — sem buraco de dado no corpo", (_chave, x) => {
    expect(x.html).not.toContain("undefined");
    expect(x.html).not.toContain("NaN");
    expect(x.html).not.toContain("[object Object]");
  });

  // A base e POR EXEMPLO, e nao uma so para a lista inteira: o provedor entra
  // pelo subdominio dele, o revendedor so pelo dominio proprio da marca. Uma
  // constante unica aqui obrigaria a abrir excecao justamente para os dois
  // e-mails cuja regra de endereco e a mais estrita.
  it.each(lista.map(x => [x.chave, x] as const))("%s — todo link de acao aponta para a urlBase daquele destinatario", (_chave, x) => {
    const links = hrefs(x.html).filter(h => !h.startsWith("mailto:"));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const ehAcao = link.startsWith(x.urlBase);
      // Duas excecoes legitimas, e so estas duas:
      // - o rodape, que e a assinatura da MARCA (`urlDaMarca`), nao um destino;
      // - o link de pagamento, que e do Asaas e nunca foi nosso.
      const ehAssinaturaDaMarca = link === CASA;
      const ehPagamentoExterno = link.startsWith("https://www.asaas.com/");
      expect(
        ehAcao || ehAssinaturaDaMarca || ehPagamentoExterno,
        `${_chave}: link fora da urlBase → ${link}`,
      ).toBe(true);
    }
    // Toda mensagem que TEM acao leva o destinatario para onde ele entra. A
    // suspensao e a unica sem: o acesso esta bloqueado, e mandar o provedor
    // para uma tela que vai recusa-lo seria pior que nao mandar. O caminho
    // dela e o e-mail de suporte, que e mailto.
    if (_chave !== "suspenso") expect(links.some(h => h.startsWith(x.urlBase))).toBe(true);
  });

  it("a suspensao nao oferece botao — o unico caminho e o suporte", () => {
    const suspenso = lista.find(x => x.chave === "suspenso")!;
    expect(hrefs(suspenso.html).filter(h => h.startsWith("http") && h !== CASA)).toEqual([]);
  });

  it("nenhuma mensagem manda o provedor para a raiz da plataforma, onde o login e recusado", () => {
    for (const x of lista) {
      const destinos = hrefs(x.html).filter(h => !h.startsWith("mailto:") && h !== CASA);
      for (const d of destinos) expect(d.startsWith(`${CASA}/`)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Os dados que o provedor confere sem abrir o painel
// ─────────────────────────────────────────────────────────────────────────────

describe("o que cada mensagem grava no corpo", () => {
  const porChave = Object.fromEntries(exemplos(MARCA_PLATAFORMA, URL).map(x => [x.chave, x]));

  it("verificacao leva o token no link e o e-mail cadastrado", () => {
    const x = porChave["verificacao"];
    expect(x.html).toContain(`${URL}/verificar-email?token=tok-exemplo-1234567890abcdef`);
    expect(x.html).toContain("financeiro@nslink.com.br");
  });

  it("boas-vindas leva CNPJ, e-mail de acesso, plano e saldo — e o endereco de entrada", () => {
    const x = porChave["boas-vindas"];
    expect(x.html).toContain("12.345.678/0001-90");
    expect(x.html).toContain("financeiro@nslink.com.br");
    expect(x.html).toContain("Gratuito");
    expect(x.html).toContain("NsLink Provedor");
    expect(x.html).toContain("nslink.consultaisp.com.br");
  });

  it("redefinicao leva o token do reset", () => {
    expect(porChave["reset"].html).toContain(`${URL}/login?reset=tok-reset-abcdef1234567890`);
  });

  it("senha alterada carimba a data e hora em Sao Paulo", () => {
    // 03/09/2026 14:32 local do exemplo — o carimbo tem de aparecer inteiro.
    expect(porChave["senha-alterada"].html).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(porChave["senha-alterada"].html).toMatch(/\d{2}:\d{2}/);
  });

  it("anti-fraude leva CPF mascarado, valor em R$ e os dias de atraso", () => {
    const x = porChave["anti-fraude"];
    expect(x.html).toContain("123.***.**9-04");
    expect(x.html).toContain("R$ 526,00");
    expect(x.html).toContain("76 dias");
    expect(x.html).toContain(`${URL}/anti-fraude`);
  });

  it("cadastro reprovado leva o motivo inteiro — sem ele a porta nao tem maçaneta", () => {
    expect(porChave["kyc-reprovado"].html).toContain("O contrato social enviado está ilegível");
  });

  it("suspensao leva o motivo e a promessa de que nada foi apagado", () => {
    const x = porChave["suspenso"].html;
    expect(x).toContain("Fatura de agosto em aberto");
    expect(x).toContain("preservados");
  });

  it("creditos leva pedido, valor pago e saldo", () => {
    const x = porChave["creditos"].html;
    expect(x).toContain("CR-202609-0042");
    expect(x).toContain("R$ 250,00");
    expect(x).toContain("479");
  });

  it("fatura leva numero, valor, vencimento e o link de pagamento do Asaas", () => {
    const x = porChave["fatura"].html;
    expect(x).toContain("NF-2026-000128");
    expect(x).toContain("R$ 99,00");
    expect(x).toContain("10/09/2026");
    expect(x).toContain("https://www.asaas.com/i/exemplo");
  });

  it("fatura paga leva numero, competencia e valor", () => {
    const x = porChave["fatura-paga"].html;
    expect(x).toContain("NF-2026-000128");
    expect(x).toContain("setembro de 2026");
    expect(x).toContain("R$ 99,00");
  });

  it("plano alterado leva o de e o para", () => {
    const x = porChave["plano"].html;
    expect(x).toContain("Gratuito");
    expect(x).toContain("Profissional");
  });

  it("usuario adicionado leva o e-mail de acesso e NUNCA uma senha", () => {
    const x = porChave["usuario"].html;
    expect(x).toContain("karina@nslink.com.br");
    expect(x).toContain("não viaja por e-mail");
    // Nao ha rotulo de senha em lugar nenhum — e `montarUsuarioAdicionado` nem
    // recebe uma: a assinatura da funcao nao tem esse parametro.
    expect(x).not.toMatch(/senha\s*:/i);
    expect(x).not.toMatch(/senha (inicial|provisória|temporária) é\s+</i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Escape: todo dado de cadastro, em toda mensagem
// ─────────────────────────────────────────────────────────────────────────────

describe("dado de cadastro hostil nao vira marcacao", () => {
  const H = HOSTIL;

  /** As 17, montadas com veneno em cada campo que vem de fora. */
  const envenenadas = (marca: MarcaResolvida = MARCA_PLATAFORMA): Array<[string, email.Mensagem]> => [
    ["verificacao", email.montarVerificacao(H, H, H, marca, URL)],
    ["boas-vindas", email.montarBoasVindas(H, {
      nome: H, provedor: H, cnpj: H, plano: H, creditos: 50, emailDeAcesso: H,
    }, marca, URL)],
    ["reset", email.montarRedefinicaoDeSenha(H, H, H, marca, URL)],
    ["senha-alterada", email.montarSenhaAlterada(H, H, marca, URL)],
    ["anti-fraude", email.montarAlertaAntiFraude(H, H, H, marca, {
      valor: 100, dias: 5, contrato: H, motivo: H, resumo: H,
    }, URL)],
    ["kyc-aprovado", email.montarCadastroAprovado(H, H, marca, URL)],
    ["kyc-reprovado", email.montarCadastroReprovado(H, H, H, marca, URL)],
    ["suspenso", email.montarAcessoSuspenso(H, H, H, marca, URL)],
    ["reativado", email.montarAcessoReativado(H, H, marca, URL)],
    ["creditos", email.montarCreditosLiberados(H, {
      pedido: H, pacote: H, creditos: 10, valor: 10, saldo: 20,
    }, marca, URL)],
    ["fatura", email.montarFaturaGerada(H, {
      numero: H, competencia: H, plano: H, valor: 10, vencimento: H, linkDePagamento: `${URL}/x?a="b`,
    }, marca, URL)],
    ["fatura-paga", email.montarFaturaPaga(H, { numero: H, competencia: H, valor: 10 }, marca, URL)],
    ["plano", email.montarPlanoAlterado(H, { de: H, para: H, creditosDoPlano: 5, observacao: H }, marca, URL)],
    ["usuario", email.montarUsuarioAdicionado(H, H, H, H, marca, URL)],
    ["erp-pausado", email.montarErpPausado(H, { erp: H, falhasSeguidas: 3, ultimoErro: H }, marca, URL)],
    ["revenda-boas-vindas", email.montarBoasVindasRevendedor(
      { nome: H, emailDeAcesso: H }, marca, URL)],
    ["revenda-equipe", email.montarUsuarioDeEquipe(
      { nome: H, quemAdicionou: H, emailDeAcesso: H }, marca, URL)],
  ];

  it.each(envenenadas())("%s — a tag nao sai crua", (_chave, m) => {
    expect(m.html).not.toContain("<img");
    // O que sai e o TEXTO da tag, visivel e inofensivo. `onerror=alert(1)`
    // continua ali como palavra escrita — o que o desarma e nao haver `<`.
    expect(m.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it.each(envenenadas())("%s — nada de <script>, venha de onde vier", (_chave, m) => {
    const comScript = m.html.toLowerCase();
    // O documento nao tem <script> proprio; qualquer um seria injetado.
    expect(comScript).not.toContain("<script");
  });

  const scriptado = (marca: MarcaResolvida) =>
    envenenadas({ ...marca, nomeProduto: `<script>alert(1)</script>` });

  it.each(scriptado(MARCA_PLATAFORMA))("%s — nome de PRODUTO hostil tambem sai escapado", (_chave, m) => {
    expect(m.html.toLowerCase()).not.toContain("<script");
    expect(m.html).toContain("&lt;script&gt;");
  });

  it("a fuga de atributo tambem e fechada — aspas no meio de um href", () => {
    const m = email.montarFaturaGerada("Fulano", {
      numero: "NF-1", competencia: "setembro", plano: "Pro", valor: 1, vencimento: "01/01/2026",
      linkDePagamento: `https://asaas.com/i/x" onclick="alert(1)`,
    }, MARCA_PLATAFORMA, URL);
    expect(m.html).not.toContain(`onclick="alert(1)"`);
    expect(m.html).toContain("&quot; onclick=&quot;alert(1)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Marca: white label de verdade
// ─────────────────────────────────────────────────────────────────────────────

describe("com marca de revendedor", () => {
  const lista = exemplos(CREDNET, URL_CREDNET);

  it.each(lista.map(x => [x.chave, x] as const))("%s — o nome do produto e o do revendedor", (_chave, x) => {
    expect(x.html).toContain("CredNet Bureau");
    expect(x.assunto + x.html).not.toContain("Consulta ISP");
  });

  it.each(lista.map(x => [x.chave, x] as const))("%s — nada da plataforma vaza, nem o dominio", (_chave, x) => {
    // Um provedor que comprou da CredNet nao pode descobrir de quem ela
    // comprou por um endereco no rodape.
    expect(x.html.toLowerCase()).not.toContain("consultaisp.com.br");
  });

  it.each(lista.map(x => [x.chave, x] as const))("%s — a cor da marca entra, a da plataforma sai", (_chave, x) => {
    expect(x.html).toContain("#1F6F7A");
    expect(x.html).not.toContain("#4A4670");
  });

  it.each(lista.map(x => [x.chave, x] as const))("%s — o suporte do revendedor esta no rodape", (_chave, x) => {
    expect(x.html).toContain("suporte@crednet.com.br");
  });

  it("o botao principal sai na cor da marca, nao no roxo da plataforma", () => {
    const boasVindas = lista.find(x => x.chave === "boas-vindas")!;
    expect(boasVindas.html).toContain(`bgcolor="#1F6F7A"`);
  });

  it("marca sem cores cai na berinjela da plataforma — nao em branco", () => {
    const semCor = exemplos({ ...CREDNET, cores: null }, URL_CREDNET)[0];
    expect(semCor.html).toContain("#4A4670");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. O remetente, que e cabecalho
// ─────────────────────────────────────────────────────────────────────────────

describe("remetente", () => {
  const ENDERECO = process.env.EMAIL_FROM || "onboarding@resend.dev";

  it("nome de exibicao da marca na frente do endereco da plataforma", () => {
    expect(email.remetente(MARCA_PLATAFORMA)).toBe(`Consulta ISP <${ENDERECO}>`);
    expect(email.remetente(CREDNET)).toBe(`CredNet Bureau <${ENDERECO}>`);
  });

  it("emailNomeExibicao vence o nome do produto", () => {
    expect(email.remetente({ ...CREDNET, emailNomeExibicao: "CredNet Avisos" }))
      .toBe(`CredNet Avisos <${ENDERECO}>`);
  });

  it("com dominio verificado, o endereco tambem e o do revendedor", () => {
    expect(email.remetente({ ...CREDNET, emailRemetente: "avisos@crednet.com.br" }))
      .toBe("CredNet Bureau <avisos@crednet.com.br>");
  });

  it("aspas, sinais de maior/menor e quebra de linha saem do nome de exibicao", () => {
    const de = email.remetente({ ...CREDNET, emailNomeExibicao: `Marca"\r\nBcc: alguem@x.com` });
    expect(de).not.toMatch(/[\r\n]/);
    expect(de).toBe(`MarcaBcc: alguem@x.com <${ENDERECO}>`);
    // O que importa: um so par de <>, entao um so endereco no cabecalho.
    expect(de.match(/</g)).toHaveLength(1);
    expect(de.match(/>/g)).toHaveLength(1);
  });

  it("nome que era so caractere proibido vira endereco puro, nao '<...>' orfao", () => {
    expect(email.remetente({ ...CREDNET, emailNomeExibicao: `"<>` })).toBe(ENDERECO);
    expect(email.remetente({ ...CREDNET, emailNomeExibicao: "   " })).toBe(ENDERECO);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. O envio
// ─────────────────────────────────────────────────────────────────────────────

describe("send", () => {
  beforeEach(() => {
    resendFalso.chamadas.length = 0;
    resendFalso.erro = null;
  });

  it("manda para o endereco pedido, com o assunto e o HTML da mensagem montada", async () => {
    await email.sendCreditosLiberadosEmail("financeiro@nslink.com.br", "Emerson", {
      pedido: "CR-202609-0042", pacote: "250 créditos", creditos: 250, valor: 250, saldo: 479,
    }, CREDNET, URL_CREDNET);

    expect(resendFalso.chamadas).toHaveLength(1);
    const [envio] = resendFalso.chamadas;
    expect(envio.to).toBe("financeiro@nslink.com.br");
    expect(envio.subject).toBe("Créditos liberados — CredNet Bureau");
    expect(envio.from).toBe(`CredNet Bureau <${process.env.EMAIL_FROM || "onboarding@resend.dev"}>`);
    expect(envio.html).toContain("CR-202609-0042");
  });

  it("o assunto sai sem quebra de linha mesmo com nome de marca envenenado", async () => {
    await email.sendCadastroAprovadoEmail(
      "a@b.com", "NsLink", "Emerson",
      { ...CREDNET, nomeProduto: "CredNet\r\nBcc: alguem@x.com" }, URL_CREDNET,
    );
    expect(resendFalso.chamadas[0].subject).not.toMatch(/[\r\n]/);
    expect(resendFalso.chamadas[0].subject).toBe("Cadastro aprovado — CredNet Bcc: alguem@x.com");
  });

  it("erro do Resend vira excecao — quem chama decide se engole (ver avisarProvedor)", async () => {
    resendFalso.erro = { message: "domain not verified" };
    await expect(
      email.sendAcessoReativadoEmail("a@b.com", "NsLink", "Emerson", MARCA_PLATAFORMA, URL),
    ).rejects.toThrow(/domain not verified/);
  });

  it("cada send* manda exatamente um e-mail", async () => {
    await email.sendVerificationEmail("a@b.com", "Emerson", "tok", MARCA_PLATAFORMA, URL);
    await email.sendPasswordChangedEmail("a@b.com", "Emerson", MARCA_PLATAFORMA, URL);
    expect(resendFalso.chamadas).toHaveLength(2);
    expect(resendFalso.chamadas.map(c => c.subject)).toEqual([
      "Confirme seu cadastro — Consulta ISP",
      "Sua senha foi alterada — Consulta ISP",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Reply-To: quem responde, responde para o suporte da MARCA
// ─────────────────────────────────────────────────────────────────────────────

describe("reply-to", () => {
  beforeEach(() => {
    resendFalso.chamadas.length = 0;
    resendFalso.erro = null;
  });

  it("com suporte proprio, a resposta vai para o revendedor e nao para a plataforma", async () => {
    await email.sendCadastroAprovadoEmail("a@b.com", "NsLink", "Emerson", CREDNET, URL_CREDNET);
    expect(resendFalso.chamadas[0].replyTo).toBe("suporte@crednet.com.br");
  });

  it("sem suporte proprio, o cabecalho nao existe — nada muda para a plataforma", async () => {
    await email.sendCadastroAprovadoEmail("a@b.com", "NsLink", "Emerson", MARCA_PLATAFORMA, URL);
    // `undefined` e ausencia sao coisas diferentes no corpo do pedido: o que se
    // cobra e a chave nao estar la.
    expect("replyTo" in resendFalso.chamadas[0]).toBe(false);
  });

  it("endereco de suporte com quebra de linha nao vira um segundo cabecalho", () => {
    expect(email.respostaPara({ ...CREDNET, suporteEmail: "ok@crednet.com.br\r\nBcc: alguem@x.com" }))
      .toBeUndefined();
    expect(email.respostaPara({ ...CREDNET, suporteEmail: "a@b.com, outro@x.com" })).toBeUndefined();
    expect(email.respostaPara({ ...CREDNET, suporteEmail: "  suporte@crednet.com.br  " }))
      .toBe("suporte@crednet.com.br");
    expect(email.respostaPara({ ...CREDNET, suporteEmail: "nao-e-endereco" })).toBeUndefined();
    expect(email.respostaPara(MARCA_PLATAFORMA)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Revenda: os dois acessos ao painel da marca
//
// Estes dois nao carregam senha nenhuma — e os unicos cujo endereco nao pode
// ser escolhido por quem chama. As duas coisas sao cobradas aqui.
//
// A primeira versao deles carregava a senha temporaria, com o argumento de que
// "ninguem, nem quem criou, a conhece". Era falso: as duas rotas que criam
// esses acessos devolvem `senhaTemporaria` em claro no corpo da resposta, e as
// duas telas a mostram para copiar. O e-mail so somava uma copia numa caixa de
// entrada. O que ele entrega, e a resposta HTTP nao, e o ENDERECO em que
// aquele login e aceito — e e isso que os testes abaixo cobram.
// ─────────────────────────────────────────────────────────────────────────────

/** A linha de `marcas` que o banco falso devolve: dominio proprio no ar. */
const LINHA_CREDNET = {
  id: 7,
  ativo: true,
  nomeProduto: "CredNet Bureau",
  assinatura: "Crédito para provedores",
  dominio: "app.crednet.com.br",
  dominioStatus: "ativo",
  logoSvg: null, logoPng: null, faviconSvg: null,
  corBrand: "#1F6F7A", corBrandDark: null,
  suporteEmail: "suporte@crednet.com.br", suporteWhatsapp: null, site: null,
  responsavelRazaoSocial: null, responsavelCnpj: null,
  emailRemetente: null, emailNomeExibicao: null,
};

describe("revenda: os dois acessos ao painel da marca", () => {
  const porChave = Object.fromEntries(exemplos(CREDNET, URL_CREDNET).map(x => [x.chave, x]));

  it("o link e o dominio da marca — a raiz da plataforma recusa este login", () => {
    for (const chave of ["revenda-boas-vindas", "revenda-equipe"]) {
      const destinos = hrefs(porChave[chave].html).filter(h => h.startsWith("http"));
      expect(destinos.length).toBeGreaterThan(0);
      for (const d of destinos) expect(d.startsWith(URL_CREDNET)).toBe(true);
      expect(destinos).toContain(`${URL_CREDNET}/login`);
    }
  });

  /**
   * A SENHA NAO VIAJA NESTES E-MAILS.
   *
   * Quem cria ja a tem: as duas rotas devolvem `senhaTemporaria` no corpo da
   * resposta, e essa e a entrega. Por-la tambem aqui somaria uma copia numa
   * caixa de entrada, que e o lugar menos controlado dos dois — e contraria a
   * regra que o e-mail de usuario do PROVEDOR (secao 10) ja segue.
   *
   * O teste olha os ROTULOS do bloco de dados, e nao a palavra solta no texto
   * corrido: o corpo hoje explica em prosa que a senha temporaria vem por
   * outro canal, e essa frase e desejada. O que nao pode existir e uma LINHA
   * DE DADO com a senha, que e a forma que ela tinha.
   */
  it("a senha nao entra no corpo, nem no assunto, nem na previa", () => {
    for (const chave of ["revenda-boas-vindas", "revenda-equipe"]) {
      const x = porChave[chave];
      expect(rotulosDeDados(x.html)).toEqual(["endereço de acesso", "e-mail de acesso"]);
      expect(x.html).not.toMatch(/Kx7f|Wb4n/);
      expect(x.assunto).not.toMatch(/Kx7f|Wb4n/);
      expect(preheader(x.html)).not.toMatch(/Kx7f|Wb4n/);
    }
  });

  it("o corpo diz que a senha vem por outro canal — senao quem recebe fica esperando um e-mail", () => {
    for (const chave of ["revenda-boas-vindas", "revenda-equipe"]) {
      expect(porChave[chave].html).toContain("A senha não vem por e-mail");
      expect(porChave[chave].html).toContain("vale por um acesso só");
    }
  });

  /**
   * O que este e-mail entrega e que a resposta HTTP nao entrega: o endereco.
   * Quem recebe nao viu o corpo do POST, e o login dele e recusado em qualquer
   * outro host com mensagem generica de proposito — sem esta linha, a pessoa
   * fica com uma senha e nenhum lugar onde usa-la.
   */
  it("o corpo mostra o endereco de acesso e o e-mail de login", () => {
    for (const chave of ["revenda-boas-vindas", "revenda-equipe"]) {
      expect(porChave[chave].html).toContain("endereço de acesso");
      expect(porChave[chave].html).toContain("e-mail de acesso");
    }
  });

  it("o convite diz QUEM convidou, duas vezes: e o unico jeito de o destinatario desconfiar", () => {
    const x = porChave["revenda-equipe"].html;
    expect(x.match(/Renata Vasconcelos/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("nome de marca hostil sai escapado tambem nestes dois", () => {
    const veneno = { ...CREDNET, nomeProduto: `<script>alert(1)</script>` };
    const a = email.montarBoasVindasRevendedor(
      { nome: "R", emailDeAcesso: "r@x.com" }, veneno, URL_CREDNET);
    const b = email.montarUsuarioDeEquipe(
      { nome: "D", quemAdicionou: "R", emailDeAcesso: "d@x.com" }, veneno, URL_CREDNET);
    for (const m of [a, b]) {
      expect(m.html.toLowerCase()).not.toContain("<script");
      expect(m.html).toContain("&lt;script&gt;");
    }
  });

  describe("o envio resolve a marca pelo ID", () => {
    beforeEach(() => {
      resendFalso.chamadas.length = 0;
      resendFalso.erro = null;
      bancoFalso.marcas.clear();
      bancoFalso.marcas.set(7, { ...LINHA_CREDNET });
      // O cache de marca dura 5 min e e de modulo: sem isto o teste seguinte
      // leria a linha que o anterior plantou.
      esquecerMarcas();
    });

    it("boas-vindas sai com a marca do ID e aponta para o dominio dela", async () => {
      await email.sendBoasVindasRevendedorEmail(
        "renata@crednet.com.br",
        { nome: "Renata", emailDeAcesso: "renata@crednet.com.br" },
        7,
      );
      expect(resendFalso.chamadas).toHaveLength(1);
      const [envio] = resendFalso.chamadas;
      expect(envio.subject).toBe("Seu painel está pronto — CredNet Bureau");
      expect(envio.from).toBe(`CredNet Bureau <${process.env.EMAIL_FROM || "onboarding@resend.dev"}>`);
      expect(envio.replyTo).toBe("suporte@crednet.com.br");
      expect(envio.html).toContain("https://app.crednet.com.br/login");
      // Quem cria e o superadmin, do dominio da plataforma. Se a marca viesse
      // do host, seria a da plataforma que sairia aqui.
      expect(envio.html).not.toContain("consultaisp.com.br");
      expect(envio.subject + envio.html).not.toContain("Consulta ISP");
    });

    it("equipe idem, e nomeia quem convidou", async () => {
      await email.sendUsuarioDeEquipeEmail(
        "diego@crednet.com.br",
        { nome: "Diego", quemAdicionou: "Renata", emailDeAcesso: "diego@crednet.com.br" },
        7,
      );
      const [envio] = resendFalso.chamadas;
      expect(envio.subject).toBe("Seu acesso à equipe — CredNet Bureau");
      expect(envio.html).toContain("Renata");
      expect(envio.html).toContain("https://app.crednet.com.br/login");
    });

    it("marca sem dominio ativo recusa o envio em vez de apontar para a raiz", async () => {
      bancoFalso.marcas.set(7, { ...LINHA_CREDNET, dominioStatus: "pendente" });
      esquecerMarcas();
      await expect(
        email.sendBoasVindasRevendedorEmail(
          "renata@crednet.com.br",
          { nome: "Renata", emailDeAcesso: "renata@crednet.com.br" },
          7,
        ),
      ).rejects.toThrow(/sem dominio proprio ativo/);
      expect(resendFalso.chamadas).toHaveLength(0);
    });

    it("marca inexistente ou desligada tambem recusa — resolverMarcaPorId devolve a plataforma", async () => {
      bancoFalso.marcas.clear();
      esquecerMarcas();
      await expect(
        email.sendUsuarioDeEquipeEmail(
          "diego@crednet.com.br",
          { nome: "Diego", quemAdicionou: "Renata", emailDeAcesso: "d@x.com" },
          7,
        ),
      ).rejects.toThrow(/sem dominio proprio ativo/);
      expect(resendFalso.chamadas).toHaveLength(0);
    });

    /**
     * O e-mail nao recebe senha e nao pode PRODUZIR uma. O que restou para
     * vigiar e o destinatario: `mascarar` reduz o endereco a `ren***@dominio`
     * porque log de servidor e retido e lido por quem nao precisa saber quem
     * recebeu o quê. A captura tambem prova, de graca, que nenhum log de
     * depuracao despeja o corpo do e-mail.
     */
    it("nem o endereco inteiro nem o corpo caem no log — nem quando o Resend recusa", async () => {
      const escrito: string[] = [];
      const capturar = (...args: unknown[]) => { escrito.push(args.map(a => String(a)).join(" ")); };
      const espioes = (["log", "info", "warn", "error", "debug"] as const)
        .map(m => vi.spyOn(console, m).mockImplementation(capturar));

      try {
        await email.sendBoasVindasRevendedorEmail(
          "renata@crednet.com.br",
          { nome: "Renata", emailDeAcesso: "renata@crednet.com.br" },
          7,
        );
        resendFalso.erro = { message: "domain not verified" };
        await email.sendUsuarioDeEquipeEmail(
          "diego@crednet.com.br",
          { nome: "Diego", quemAdicionou: "Renata", emailDeAcesso: "d@x.com" },
          7,
        ).catch(() => {});
      } finally {
        for (const e of espioes) e.mockRestore();
      }

      // O teste so vale se ALGO foi registrado: sem isto ele passaria por
      // silencio, e o dia em que alguem acrescentar um log de depuracao com o
      // corpo do e-mail nao seria pego.
      expect(escrito.length).toBeGreaterThan(0);
      // O endereco sai reduzido, e nao inteiro.
      expect(escrito.join("\n")).not.toContain("renata@crednet.com.br");
      // E nenhum log carrega o corpo montado.
      expect(escrito.join("\n")).not.toContain("endereço de acesso");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. O CNPJ do provedor, na caixa de entrada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A varredura da regressao do CNPJ passou pelas telas e parou na borda do
 * navegador. Aqui e o outro lado.
 *
 * `providers.cnpj` guardava duas formas do mesmo dado — 14 digitos crus em dois
 * provedores, a pontuacao dentro do banco em quatro. A canonizacao poe todo
 * mundo em 14 digitos; sem mascara na exibicao, os quatro veem o proprio CNPJ
 * da empresa virar "23864873000148". Nas telas isso se conserta com um deploy.
 * Aqui nao: este e o unico e-mail que o provedor guarda, e o que ja saiu esta na
 * caixa de entrada dele para sempre.
 *
 * E foi a PREVIA que escondeu o defeito — ela passava o CNPJ ja pontuado a mao,
 * entao a tela de revisao mostrava um e-mail que ninguem receberia. O ultimo
 * teste desta secao trava exatamente isso.
 */
describe("o CNPJ do provedor sai mascarado no e-mail que ele guarda", () => {
  /**
   * O par rotulo/valor de uma linha de `blocoDeDados`, com o estilo do valor.
   *
   * Ler a LINHA, e nao procurar o texto solto no HTML: "23.864.873/0001-48"
   * aparecer em algum lugar da mensagem nao prova que e o campo CNPJ que esta
   * certo, e uma mascara dupla passaria batida numa busca por substring.
   */
  const linhaDeDado = (html: string, rotulo: string) => {
    const m = html.match(
      new RegExp(`uppercase;">${rotulo}</span>\\s*<span style="([^"]*)">([\\s\\S]*?)</span>`),
    );
    return m ? { estilo: m[1], valor: m[2] } : null;
  };

  const boasVindas = (cnpj: string | null | undefined) =>
    email.montarBoasVindas("financeiro@nslink.com.br", {
      nome: "Emerson Queiroz",
      provedor: "NsLink Provedor",
      cnpj,
      plano: "Gratuito",
      creditos: 50,
      emailDeAcesso: "financeiro@nslink.com.br",
    }, MARCA_PLATAFORMA, URL).html;

  it("os 14 digitos crus da coluna saem pontuados, e nao como um numerao", () => {
    // `22759562000156` e o provedor 1, ja canonico no banco antes da migracao.
    const html = boasVindas("22759562000156");
    expect(linhaDeDado(html, "cnpj")?.valor).toBe("22.759.562/0001-56");
    expect(html).not.toContain("22759562000156");
  });

  it("uma linha legada, ja pontuada, nao vira mascara dupla", () => {
    // `23.864.873/0001-48` e a forma que quatro provedores tem HOJE na coluna.
    // Enquanto a migracao nao rodar em todo ambiente, as duas convivem — e a
    // montagem tem de aguentar receber qualquer uma delas.
    const html = boasVindas("23.864.873/0001-48");
    expect(linhaDeDado(html, "cnpj")?.valor).toBe("23.864.873/0001-48");
    expect(html).not.toContain("23..864");
  });

  it("as duas formas gravadas em producao saem IDENTICAS", () => {
    // Este e o teste que da sentido a mascara: nenhum dos seis provedores pode
    // notar diferenca entre o e-mail de antes e o de depois da canonizacao.
    const cru = linhaDeDado(boasVindas("23864873000148"), "cnpj")?.valor;
    // Sem esta linha, um leitor quebrado compararia `undefined` com `undefined`
    // e o teste passaria sem ter lido nada.
    expect(cru).toBe("23.864.873/0001-48");
    expect(linhaDeDado(boasVindas("23.864.873/0001-48"), "cnpj")?.valor).toBe(cru);
  });

  it("o CNPJ e dado numerico: sai em mono (DESIGN_SYSTEM secao 2)", () => {
    expect(linhaDeDado(boasVindas("22759562000156"), "cnpj")?.estilo)
      .toContain(`font-family:${email.MONO}`);
  });

  it("cnpj vazio, nulo ou so com lixo nao imprime uma linha em branco", () => {
    // O antigo `if (dados.cnpj)` testava o valor BRUTO: "--" e truthy e teria
    // aberto um rotulo "CNPJ" sem nada embaixo no bloco de dados.
    for (const vazio of ["", "   ", "--", null, undefined]) {
      expect(linhaDeDado(boasVindas(vazio), "cnpj")).toBeNull();
    }
    // O controle: com um CNPJ de verdade a linha existe. Sem ele, um leitor que
    // nunca acha nada deixaria o laco acima verde para sempre.
    expect(linhaDeDado(boasVindas("22759562000156"), "cnpj")).not.toBeNull();
    // E o resto do bloco continua inteiro quando o CNPJ falta.
    expect(linhaDeDado(boasVindas(null), "provedor")?.valor).toBe("NsLink Provedor");
  });

  it("quem envia passa a coluna crua e o e-mail sai pronto — a mascara e da MONTAGEM", async () => {
    // `sendWelcomeEmail` e chamado em auth.routes.ts com `cnpj: provider.cnpj`,
    // isto e, o registro do banco sem tratamento. Mascarar no ponto de chamada
    // deixaria o proximo e-mail que carregasse o campo descoberto.
    resendFalso.chamadas.length = 0;
    resendFalso.erro = null;
    await email.sendWelcomeEmail("financeiro@nslink.com.br", {
      nome: "Emerson Queiroz",
      provedor: "NsLink Provedor",
      cnpj: "22759562000156",
      plano: "Gratuito",
      creditos: 50,
      emailDeAcesso: "financeiro@nslink.com.br",
    }, MARCA_PLATAFORMA, URL);

    expect(resendFalso.chamadas).toHaveLength(1);
    expect(resendFalso.chamadas[0].html).toContain("22.759.562/0001-56");
    expect(resendFalso.chamadas[0].html).not.toContain("22759562000156");
  });

  it("a mascara vem do modulo compartilhado, e nao de uma quinta copia", () => {
    // Havia QUATRO copias no client, e uma delas ja divergia. O servidor nao
    // pode importar de `client/`, entao a dona subiu para `shared/`.
    const fonte = readFileSync(join(__dirname, "email.ts"), "utf8");
    expect(fonte).toContain('import { cnpjMascarado } from "@shared/cnpj"');
    expect(fonte).not.toMatch(/\.slice\(8,\s*12\)/);
  });

  it("a previa passa o CNPJ como a producao entrega: 14 digitos crus", () => {
    // O defeito era invisivel porque a previa mentia — passava
    // "12.345.678/0001-90" pontuado a mao. Uma previa que formata o que a
    // producao entrega cru revisa um e-mail que ninguem recebe.
    const fonte = readFileSync(join(__dirname, "..", "..", "script", "preview-emails.ts"), "utf8");
    const doExemplo = fonte.match(/cnpj: "([^"]*)"/)?.[1];
    expect(doExemplo).toBe("12345678000190");
    expect(doExemplo).toMatch(/^\d{14}$/);

    // E a previa, montada com ele, mostra o que o provedor vai ler.
    const previa = exemplos(MARCA_PLATAFORMA, URL).find(x => x.chave === "boas-vindas")!;
    expect(linhaDeDado(previa.html, "cnpj")?.valor).toBe("12.345.678/0001-90");
  });
});
