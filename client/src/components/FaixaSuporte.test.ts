import { afterEach, describe, it, expect } from "vitest";
import {
  CODIGO_SUPORTE_ENCERRADO,
  CODIGO_SUPORTE_NAO_VERIFICADO,
  descricaoDoDono,
  devePerguntarPelaSessao,
  ehRecusaDefinitiva,
  esquecerPersonificacao,
  formatarRestante,
  haOndeLembrar,
  interpretarLembrete,
  lembrarPersonificacao,
  lembreteDePersonificacao,
  leituraDoCodigo,
  restanteDaSessao,
  sessaoDaResposta,
  type EstadoDoAcesso,
} from "./FaixaSuporte";

/**
 * A faixa vermelha da sessão de suporte.
 *
 * O que estes testes protegem não é o desenho: é o momento em que a faixa
 * MENTE. Ela tem duas frases possíveis e as duas são caras.
 *
 * Dizer "suporte conectado" quando já não há liberação é um adesivo inofensivo
 * — o servidor barra sozinho. O caro é o contrário: parar de dizer quando ainda
 * está conectado, ou não dizer nada porque um campo veio faltando. Nesse caso a
 * pessoa do suporte segue operando a conta de um terceiro sem nada na tela
 * lembrando que o dado é de titulares que nunca ouviram falar dela — que é
 * exatamente o esquecimento que esta faixa existe para impedir.
 *
 * O relógio está em 2031 de propósito, longe do relógio do processo: nenhuma
 * destas funções pode consultar `Date.now()` por dentro.
 */
const AGORA = Date.parse("2031-05-04T14:00:00.000Z");
const emMinutos = (m: number) => new Date(AGORA + m * 60_000).toISOString();

const janelaAberta: EstadoDoAcesso = { liberado: true, expiraEm: emMinutos(120) };

describe("sessaoDaResposta", () => {
  it("janela liberada com prazo vira sessão", () => {
    expect(sessaoDaResposta(janelaAberta)).toEqual({
      expiraEm: emMinutos(120),
      providerId: undefined,
      providerNome: undefined,
    });
  });

  it("leva a identidade do provedor quando o servidor a manda", () => {
    const comDono = { ...janelaAberta, providerId: 42, providerNome: "NsLink Telecom" };
    expect(sessaoDaResposta(comDono)?.providerNome).toBe("NsLink Telecom");
    expect(sessaoDaResposta(comDono)?.providerId).toBe(42);
  });

  it("sem liberação não há faixa", () => {
    expect(sessaoDaResposta({ liberado: false })).toBeNull();
  });

  /* Antes da primeira resposta a faixa não pode afirmar nada — nem que há
     sessão, nem que não há. Quem distingue os dois casos é `carregando`. */
  it("resposta ausente não vira faixa", () => {
    expect(sessaoDaResposta(undefined)).toBeNull();
  });

  /* Uma faixa sem contagem vira adesivo permanente, e adesivo permanente é o
     começo de ser ignorado. Prefere-se não afirmar a afirmar sem prazo. */
  it("liberação sem prazo é resposta malformada, e não uma faixa eterna", () => {
    expect(sessaoDaResposta({ liberado: true })).toBeNull();
  });
});

describe("restanteDaSessao", () => {
  it("conta o que falta até o fim da janela", () => {
    expect(restanteDaSessao(emMinutos(120), AGORA)).toBe(120 * 60_000);
  });

  /* Sem o piso, a faixa mostraria uma contagem correndo para trás no negativo. */
  it("janela vencida não devolve número negativo", () => {
    expect(restanteDaSessao(emMinutos(-5), AGORA)).toBe(0);
  });

  /* `NaN` atravessaria a formatação e apagaria o número justamente na hora em
     que ele mais importa. */
  it("prazo ilegível não vira NaN", () => {
    expect(restanteDaSessao("depois do almoço", AGORA)).toBe(0);
  });
});

describe("formatarRestante", () => {
  it("sai em HH:MM:SS", () => {
    expect(formatarRestante(2 * 3600_000)).toBe("02:00:00");
    expect(formatarRestante(3600_000 + 2 * 60_000 + 3_000)).toBe("01:02:03");
  });

  /* Largura fixa: em fonte tabular, uma casa a menos faz a faixa inteira
     tremer a cada segundo. */
  it("mantém as três casas mesmo com poucos segundos", () => {
    expect(formatarRestante(7_000)).toBe("00:00:07");
  });

  it("zero e negativo param em 00:00:00", () => {
    expect(formatarRestante(0)).toBe("00:00:00");
    expect(formatarRestante(-90_000)).toBe("00:00:00");
  });

  /* O teto do storage é 24h. Uma janela longa não pode voltar para 00. */
  it("não dá a volta em janela longa", () => {
    expect(formatarRestante(24 * 3600_000)).toBe("24:00:00");
  });
});

/**
 * Os dois códigos vêm dentro da mensagem do Error porque é assim que
 * `client/src/lib/queryClient.ts` a monta: `${status}: ${corpo}`, com o corpo
 * cru da resposta. As mensagens abaixo são as do servidor, literais.
 */
const erroDoServidor = (status: number, message: string, code: string) =>
  new Error(`${status}: ${JSON.stringify({ message, code })}`);

describe("leituraDoCodigo", () => {
  it("reconhece o fim da liberação", () => {
    const erro = erroDoServidor(403, "A liberacao de acesso de suporte terminou.", CODIGO_SUPORTE_ENCERRADO);
    expect(leituraDoCodigo(erro)).toBe("encerrada");
  });

  /* 503 é fail-closed: o banco não respondeu, a requisição foi recusada por
     precaução e a personificação continua de pé. Tratar como fim mandaria o
     suporte embora por causa de um soluço de rede. */
  it("banco fora do ar não é fim de liberação", () => {
    const erro = erroDoServidor(503, "Nao foi possivel confirmar a liberacao de suporte.", CODIGO_SUPORTE_NAO_VERIFICADO);
    expect(leituraDoCodigo(erro)).toBe("nao-verificado");
  });

  /* Uma tela qualquer quebrando não pode derrubar a faixa: se ela sumisse a
     cada 500 de um ERP, o suporte aprenderia a ignorar o aviso. */
  it("erro de outra rota não mexe na faixa", () => {
    expect(leituraDoCodigo(erroDoServidor(500, "Erro interno", "ERP_TIMEOUT"))).toBeNull();
    expect(leituraDoCodigo(new Error("Failed to fetch"))).toBeNull();
  });

  it("o que não é Error não é lido", () => {
    expect(leituraDoCodigo(CODIGO_SUPORTE_ENCERRADO)).toBeNull();
    expect(leituraDoCodigo(null)).toBeNull();
    expect(leituraDoCodigo({ code: CODIGO_SUPORTE_ENCERRADO })).toBeNull();
  });
});

describe("descricaoDoDono", () => {
  it("o nome do provedor é o que a faixa prefere dizer", () => {
    expect(descricaoDoDono({ expiraEm: emMinutos(60), providerNome: "NsLink Telecom" })).toBe(
      "na conta de NsLink Telecom",
    );
  });

  it("sem nome, o número identifica", () => {
    expect(descricaoDoDono({ expiraEm: emMinutos(60), providerId: 42 })).toBe(
      "na conta do provedor #42",
    );
  });

  /* O último degrau: o servidor não nomeou o provedor e não há bilhete que o
     supra (ver a nota no fim de FaixaSuporte.tsx). A frase perde o nome, nunca
     o aviso — e em nenhuma hipótese imprime "undefined". */
  it("sem identidade nenhuma, ainda diz que a conta é de outra pessoa", () => {
    const frase = descricaoDoDono({ expiraEm: emMinutos(60) });
    expect(frase).toBe("dentro da conta de um provedor");
    expect(frase).not.toContain("undefined");
  });
});

/**
 * O LEMBRETE DE PERSONIFICAÇÃO.
 *
 * Ele existe para a faixa não perguntar ao servidor em toda montagem do app —
 * e o que estes testes protegem é a assimetria que o torna aceitável: errar
 * para o lado de PERGUNTAR é desperdício de uma requisição; errar para o lado
 * de NÃO perguntar é a faixa calada com dado de titular alheio na tela. Por
 * isso "não sei onde guardar" pergunta, e só a recusa explícita do servidor
 * apaga o bilhete.
 *
 * O ambiente destes testes é Node, sem DOM (ver o `include` do vitest.config):
 * o armazenamento é injetado à mão, que é também a forma de simular o navegador
 * que bloqueia escrita.
 */
class CofreFalso implements Storage {
  private dados = new Map<string, string>();
  /** Quando verdadeiro, imita a janela privativa: o objeto existe, o setItem estoura. */
  constructor(private bloqueado = false) {}
  get length() { return this.dados.size; }
  clear() { this.dados.clear(); }
  getItem(k: string) { return this.dados.get(k) ?? null; }
  key(i: number) { return Array.from(this.dados.keys())[i] ?? null; }
  removeItem(k: string) { this.dados.delete(k); }
  setItem(k: string, v: string) {
    if (this.bloqueado) throw new Error("QuotaExceededError");
    this.dados.set(k, v);
  }
}

const comCofre = (cofre: Storage | undefined) => {
  (globalThis as Record<string, unknown>).localStorage = cofre;
};

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).sessionStorage;
});

describe("interpretarLembrete", () => {
  it("guarda e devolve quem está sendo personificado", () => {
    comCofre(new CofreFalso());
    lembrarPersonificacao({ providerId: 42, providerNome: "NsLink Telecom" });
    expect(lembreteDePersonificacao()).toEqual({ providerId: 42, providerNome: "NsLink Telecom" });
    esquecerPersonificacao();
    expect(lembreteDePersonificacao()).toBeNull();
  });

  /* Conteúdo de armazenamento é dado de fora: versão anterior, truncado pelo
     navegador, adulterado à mão. Nada disso pode estourar na montagem do app. */
  it("lixo no armazenamento não vira lembrete nem exceção", () => {
    expect(interpretarLembrete(null)).toBeNull();
    expect(interpretarLembrete("")).toBeNull();
    expect(interpretarLembrete("{ isto não é json")).toBeNull();
    expect(interpretarLembrete(JSON.stringify({ providerNome: "Sem id" }))).toBeNull();
    expect(interpretarLembrete(JSON.stringify({ providerId: "quarenta e dois" }))).toBeNull();
    expect(interpretarLembrete(JSON.stringify({ providerId: 0 }))).toBeNull();
    expect(interpretarLembrete(JSON.stringify({ providerId: -3 }))).toBeNull();
  });

  it("nome em branco não é nome", () => {
    expect(interpretarLembrete(JSON.stringify({ providerId: 7, providerNome: "   " }))).toEqual({
      providerId: 7,
      providerNome: undefined,
    });
  });

  /* Armazenamento bloqueado não pode derrubar a tela — nem inventar um lembrete. */
  it("navegador que recusa escrita não estoura", () => {
    comCofre(new CofreFalso(true));
    expect(haOndeLembrar()).toBe(false);
    expect(() => lembrarPersonificacao({ providerId: 9 })).not.toThrow();
    expect(lembreteDePersonificacao()).toBeNull();
    expect(() => esquecerPersonificacao()).not.toThrow();
  });

  it("sem armazenamento nenhum, nada estoura", () => {
    comCofre(undefined);
    expect(haOndeLembrar()).toBe(false);
    expect(lembreteDePersonificacao()).toBeNull();
    expect(() => lembrarPersonificacao({ providerId: 9 })).not.toThrow();
  });
});

describe("devePerguntarPelaSessao", () => {
  const lembrete = { providerId: 42 };

  it("provedor nunca pergunta — a faixa não é dele", () => {
    expect(devePerguntarPelaSessao({ ehSuperadmin: false, lembrete, haOndeLembrar: true })).toBe(false);
  });

  it("superadmin com bilhete pergunta", () => {
    expect(devePerguntarPelaSessao({ ehSuperadmin: true, lembrete, haOndeLembrar: true })).toBe(true);
  });

  /* O caso que apaga o 403 por carregamento: superadmin no painel da
     plataforma, sem nunca ter entrado em provedor nenhum. */
  it("superadmin sem bilhete não gasta a requisição", () => {
    expect(devePerguntarPelaSessao({ ehSuperadmin: true, lembrete: null, haOndeLembrar: true })).toBe(false);
  });

  /* Sem onde lembrar não há economia possível, e o aviso vale mais do que a
     requisição poupada: volta a perguntar sempre. */
  it("sem onde guardar bilhete, pergunta assim mesmo", () => {
    expect(devePerguntarPelaSessao({ ehSuperadmin: true, lembrete: null, haOndeLembrar: false })).toBe(true);
  });
});

describe("ehRecusaDefinitiva", () => {
  it("403 é o servidor dizendo que não há personificação", () => {
    expect(ehRecusaDefinitiva(erroDoServidor(403, "Acesso negado", "PROVIDER_REQUIRED"))).toBe(true);
  });

  it("o fim da liberação também apaga o bilhete", () => {
    expect(ehRecusaDefinitiva(erroDoServidor(403, "A liberacao terminou.", CODIGO_SUPORTE_ENCERRADO))).toBe(true);
  });

  /* Apagar o bilhete por causa de rede caída ou banco fora do ar faria a faixa
     parar de perguntar no próximo carregamento com o suporte ainda dentro. */
  it("instabilidade não apaga bilhete", () => {
    expect(ehRecusaDefinitiva(erroDoServidor(503, "Nao confirmado.", CODIGO_SUPORTE_NAO_VERIFICADO))).toBe(false);
    expect(ehRecusaDefinitiva(erroDoServidor(500, "Erro interno", "X"))).toBe(false);
    expect(ehRecusaDefinitiva(new Error("Failed to fetch"))).toBe(false);
    expect(ehRecusaDefinitiva(null)).toBe(false);
  });
});

describe("sessaoDaResposta com lembrete", () => {
  it("o servidor manda no nome; o bilhete é suplente", () => {
    const doServidor = { ...janelaAberta, providerId: 42, providerNome: "NsLink Telecom" };
    const bilhete = { providerId: 42, providerNome: "Nome velho" };
    expect(sessaoDaResposta(doServidor, bilhete)?.providerNome).toBe("NsLink Telecom");
  });

  /* O caso real do suplente: `nomeDoProvedor` engole o erro no servidor para
     não derrubar a faixa, e o nome chega vazio. */
  it("servidor sem nome cai no que a aba do superadmin já sabia", () => {
    const semNome = { ...janelaAberta, providerId: 42 };
    const sessao = sessaoDaResposta(semNome, { providerId: 42, providerNome: "NsLink Telecom" });
    expect(sessao?.providerNome).toBe("NsLink Telecom");
  });

  /* Nomear a conta errada é pior do que não nomear: um bilhete de outro
     provedor (entrada trocada noutra aba) não empresta nada. */
  it("bilhete de outro provedor não nomeia esta conta", () => {
    const sessao = sessaoDaResposta({ ...janelaAberta, providerId: 42 }, { providerId: 7, providerNome: "Outra" });
    expect(sessao?.providerNome).toBeUndefined();
    expect(sessao?.providerId).toBe(42);
    expect(descricaoDoDono(sessao!)).toBe("na conta do provedor #42");
  });

  it("sem liberação, bilhete nenhum inventa faixa", () => {
    expect(sessaoDaResposta({ liberado: false }, { providerId: 42, providerNome: "NsLink" })).toBeNull();
  });
});
