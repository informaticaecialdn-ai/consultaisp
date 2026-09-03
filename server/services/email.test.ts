/**
 * As 15 mensagens transacionais, sob contrato.
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

// O modulo de marca fala com o banco para resolver marca por host/id. Nada
// disto e exercitado aqui: as mensagens recebem a marca pronta.
vi.mock("../storage", () => ({ storage: {} }));

import * as email from "./email";
import { MARCA_PLATAFORMA, urlDaMarca, type MarcaResolvida } from "./marca.service";
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

const tituloDe = (html: string) => {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return m ? m[1].replace(/<[^>]*>/g, "").trim() : "";
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. O contrato que vale para as 15
// ─────────────────────────────────────────────────────────────────────────────

describe("as 15 mensagens, uma invariante de cada vez", () => {
  const lista = exemplos(MARCA_PLATAFORMA, URL);
  const CASA = urlDaMarca(MARCA_PLATAFORMA);

  it("sao 15, e a pre-visualizacao e a mesma lista", () => {
    expect(lista).toHaveLength(15);
    expect(new Set(lista.map(x => x.chave)).size).toBe(15);
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

  it.each(lista.map(x => [x.chave, x] as const))("%s — todo link de acao aponta para a urlBase recebida", (_chave, x) => {
    const links = hrefs(x.html).filter(h => !h.startsWith("mailto:"));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const ehAcao = link.startsWith(URL);
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
    if (_chave !== "suspenso") expect(links.some(h => h.startsWith(URL))).toBe(true);
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

  /** As 15, montadas com veneno em cada campo que vem de fora. */
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
