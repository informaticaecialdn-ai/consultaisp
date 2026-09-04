/**
 * O que estes testes protegem, em uma frase cada:
 *
 *  - o PATCH comercial não pode mandar o que não mudou (é ele que grava
 *    `alterar_comissao` na trilha, e evento falso polui auditoria append-only);
 *  - a faixa de 0 a 50 é CHECK no banco, e o operador tem de saber disso antes
 *    de clicar em salvar;
 *  - a ordem do onboarding (domínio → HTTPS → revenda → usuário) tem de estar
 *    escrita na tela, porque o servidor devolve 422 e um 422 não ensina ordem.
 */
import { describe, it, expect } from "vitest";
import {
  camposComerciais, corpoComercial, erroDoComercial, avisosDaRevenda,
  motivoParaNaoCriarRevendedor, rotuloDaAcao, nomeDoAtor, nomeDoProvedor,
  dataHoraCurta, percentualDaMarca, COMERCIAL_VAZIO,
  type FormComercial, type EventoDaMarca,
} from "./marca-revenda";

/** Uma marca de revenda já configurada, como o detalhe a devolve. */
const DETALHE = {
  id: 7,
  revendaAtiva: true,
  statusComercial: "ativo",
  // `numeric(5,2)` chega como string do driver do Postgres. É por causa disto
  // que a normalização existe.
  comissaoPercentual: "20.00",
  repasseRazaoSocial: "CredNet Serviços Ltda",
  repasseCnpj: "00.000.000/0001-00",
  repasseChavePix: "financeiro@crednet.com.br",
  repasseEmail: "financeiro@crednet.com.br",
};

const CONFIGURADA: FormComercial = camposComerciais(DETALHE);

describe("percentualDaMarca", () => {
  it("o selo da lista não escreve '20.00%' onde o dono negociou 20%", () => {
    expect(percentualDaMarca("20.00")).toBe("20");
    expect(percentualDaMarca("7.50")).toBe("7.5");
    expect(percentualDaMarca(undefined)).toBe("0");
    expect(percentualDaMarca("nao-e-numero")).toBe("0");
  });
});

describe("camposComerciais", () => {
  it("normaliza o percentual que o driver entrega como string", () => {
    expect(camposComerciais(DETALHE).comissaoPercentual).toBe("20");
    expect(camposComerciais({ comissaoPercentual: 12.5 }).comissaoPercentual).toBe("12.5");
    expect(camposComerciais({ comissaoPercentual: null }).comissaoPercentual).toBe("0");
  });

  it("marca sem detalhe nasce nos padrões da migração: desligada, ativa, zero", () => {
    expect(camposComerciais(null)).toEqual(COMERCIAL_VAZIO);
    expect(camposComerciais(undefined).revendaAtiva).toBe(false);
  });

  it("status desconhecido no banco não vira 'suspenso' por acidente", () => {
    expect(camposComerciais({ statusComercial: "qualquer-coisa" }).statusComercial).toBe("ativo");
    expect(camposComerciais({ statusComercial: "suspenso" }).statusComercial).toBe("suspenso");
  });

  /**
   * `ativo` é lido com `!== false`, e não com `Boolean(...)`. A diferença é o
   * campo AUSENTE: um detalhe que não traga a chave viraria `false` com
   * `Boolean`, o interruptor "Marca no ar" abriria desligado, e o primeiro
   * salvamento da aba mandaria `ativo: false` — desligando uma marca que
   * ninguém pediu para desligar, e derrubando a sessão do revendedor junto.
   */
  it("ativo ausente no detalhe não desliga a marca por acidente", () => {
    expect(camposComerciais({ statusComercial: "ativo" }).ativo).toBe(true);
    expect(camposComerciais({ ativo: true }).ativo).toBe(true);
    expect(camposComerciais({ ativo: false }).ativo).toBe(false);
    expect(COMERCIAL_VAZIO.ativo).toBe(true);
  });
});

describe("corpoComercial", () => {
  it("abrir a aba e não mexer em nada não manda PATCH nenhum", () => {
    expect(corpoComercial({ ...CONFIGURADA }, CONFIGURADA)).toEqual({});
  });

  it("o percentual 20 digitado sobre o '20.00' do banco não é mudança", () => {
    const form = { ...CONFIGURADA, comissaoPercentual: "20" };
    expect(corpoComercial(form, camposComerciais(DETALHE))).toEqual({});
  });

  it("o interruptor vira booleano e o percentual vira número", () => {
    const form = { ...CONFIGURADA, revendaAtiva: false, comissaoPercentual: "15.5" };
    expect(corpoComercial(form, CONFIGURADA)).toEqual({ revendaAtiva: false, comissaoPercentual: 15.5 });
  });

  it("campo de repasse apagado vira null — limpar continua possível", () => {
    const form = { ...CONFIGURADA, repasseChavePix: "" };
    expect(corpoComercial(form, CONFIGURADA)).toEqual({ repasseChavePix: null });
  });

  it("espaço em volta do texto não é mudança, e o que vai gravado já vai aparado", () => {
    expect(corpoComercial({ ...CONFIGURADA, repasseCnpj: "  00.000.000/0001-00  " }, CONFIGURADA)).toEqual({});
    expect(corpoComercial({ ...CONFIGURADA, repasseCnpj: "  11.111.111/0001-11 " }, CONFIGURADA))
      .toEqual({ repasseCnpj: "11.111.111/0001-11" });
  });

  it("percentual em branco NÃO vira zero: Number('') é 0, e zero é valor legítimo", () => {
    const corpo = corpoComercial({ ...CONFIGURADA, comissaoPercentual: "" }, CONFIGURADA);
    expect(corpo).not.toHaveProperty("comissaoPercentual");
  });

  /**
   * `ativo` é a chave geral da marca e viaja por aqui porque é booleano — a
   * aba Identidade é `Record<string, string>` e transformaria `false` em
   * `null`. Desligar tem efeito imediato e caro (o revendedor perde o painel
   * em até 30s, `requireRevendedor`), então precisa sair no corpo SÓ quando de
   * fato mudou.
   */
  it("desligar a marca sai no corpo, e não mexer nela não sai", () => {
    expect(corpoComercial({ ...CONFIGURADA, ativo: false }, CONFIGURADA)).toEqual({ ativo: false });
    expect(corpoComercial({ ...CONFIGURADA }, CONFIGURADA)).not.toHaveProperty("ativo");
  });

  it("religar também sai — é a volta do estado que só o banco desfazia antes", () => {
    const desligada = { ...CONFIGURADA, ativo: false };
    expect(corpoComercial({ ...desligada, ativo: true }, desligada)).toEqual({ ativo: true });
  });

  it("mexer só na comissão não encosta em repasse nem no interruptor", () => {
    const corpo = corpoComercial({ ...CONFIGURADA, comissaoPercentual: "30" }, CONFIGURADA);
    expect(corpo).toEqual({ comissaoPercentual: 30 });
    for (const campo of ["revendaAtiva", "statusComercial", "repasseChavePix"]) {
      expect(corpo, campo).not.toHaveProperty(campo);
    }
  });
});

describe("erroDoComercial", () => {
  it("aceita a faixa inteira do CHECK do banco, pontas incluídas", () => {
    expect(erroDoComercial({ ...CONFIGURADA, comissaoPercentual: "0" })).toBeNull();
    expect(erroDoComercial({ ...CONFIGURADA, comissaoPercentual: "50" })).toBeNull();
    expect(erroDoComercial({ ...CONFIGURADA, comissaoPercentual: "20.5" })).toBeNull();
  });

  it("recusa fora da faixa e o texto diz a faixa", () => {
    expect(erroDoComercial({ ...CONFIGURADA, comissaoPercentual: "51" })).toMatch(/0 a 50/);
    expect(erroDoComercial({ ...CONFIGURADA, comissaoPercentual: "-1" })).toMatch(/0 a 50/);
  });

  it("campo em branco pede o valor em vez de assumir zero", () => {
    expect(erroDoComercial({ ...CONFIGURADA, comissaoPercentual: "  " })).toMatch(/Informe a comissão/);
  });

  it("e-mail de repasse torto é recusado aqui, não pelo 400 do servidor", () => {
    expect(erroDoComercial({ ...CONFIGURADA, repasseEmail: "financeiro" })).toMatch(/E-mail de repasse/);
    expect(erroDoComercial({ ...CONFIGURADA, repasseEmail: "" })).toBeNull();
  });
});

describe("avisosDaRevenda", () => {
  it("revenda desligada é um estado explicado, não um alerta", () => {
    const avisos = avisosDaRevenda({ ...COMERCIAL_VAZIO });
    expect(avisos).toHaveLength(1);
    expect(avisos[0].tom).toBe("info");
    expect(avisos[0].texto).toMatch(/só a pele/);
  });

  it("com revenda desligada nada mais é cobrado — nem repasse, nem comissão zero", () => {
    const avisos = avisosDaRevenda({ ...COMERCIAL_VAZIO, statusComercial: "suspenso" });
    expect(avisos.every(a => a.tom === "info")).toBe(true);
  });

  it("marca configurada e ativa não avisa nada", () => {
    expect(avisosDaRevenda(CONFIGURADA)).toEqual([]);
  });

  it("ligada com 0% avisa que o lançamento nasce zerado", () => {
    const avisos = avisosDaRevenda({ ...CONFIGURADA, comissaoPercentual: "0" });
    expect(avisos.some(a => a.tom === "gated" && /zerado/.test(a.texto))).toBe(true);
  });

  it("sem chave PIX avisa que o fechamento não tem como ser pago", () => {
    const avisos = avisosDaRevenda({ ...CONFIGURADA, repasseChavePix: "   " });
    expect(avisos.some(a => /repasse/.test(a.texto))).toBe(true);
  });

  it("suspenso explica o que NÃO cai junto: a pele e os provedores", () => {
    const avisos = avisosDaRevenda({ ...CONFIGURADA, statusComercial: "suspenso" });
    expect(avisos[0].texto).toMatch(/provedores seguem operando/);
  });
});

describe("motivoParaNaoCriarRevendedor", () => {
  it("sem domínio próprio, o acesso não teria por onde entrar", () => {
    expect(motivoParaNaoCriarRevendedor({ dominio: null, dominioStatus: "pendente" }))
      .toMatch(/domínio próprio/);
  });

  it("com domínio mas sem HTTPS confirmado, o motivo é outro e é dito", () => {
    const motivo = motivoParaNaoCriarRevendedor({ dominio: "app.crednet.com.br", dominioStatus: "pendente" });
    expect(motivo).toMatch(/HTTPS/);
  });

  it("domínio ativo libera", () => {
    expect(motivoParaNaoCriarRevendedor({ dominio: "app.crednet.com.br", dominioStatus: "ativo" })).toBeNull();
  });

  /**
   * Os dois degraus que faltavam. O servidor responde 422 nos dois casos
   * (`MARCA_DESLIGADA` e `MARCA_SEM_REVENDA_ATIVA`); enquanto eles não estavam
   * aqui, a tela deixava o botão clicável e ainda escrevia que "o acesso é
   * criado e o login funciona".
   */
  it("marca desligada bloqueia — ela não responde no próprio domínio", () => {
    const motivo = motivoParaNaoCriarRevendedor({
      dominio: "app.crednet.com.br", dominioStatus: "ativo", ativo: false, revendaAtiva: true,
    });
    expect(motivo).toMatch(/desligada/);
    expect(motivo).toMatch(/Religue/);
  });

  it("revenda desligada bloqueia, e a frase manda ligar onde se liga", () => {
    const motivo = motivoParaNaoCriarRevendedor({
      dominio: "app.crednet.com.br", dominioStatus: "ativo", ativo: true, revendaAtiva: false,
    });
    expect(motivo).toMatch(/revenda desta marca está desligada/i);
    expect(motivo).toMatch(/aba Comercial/);
  });

  /**
   * A ordem dos degraus é a do servidor. Com domínio faltando E revenda
   * desligada, quem responde é o domínio: mandar ligar a revenda primeiro faria
   * o operador ligar e continuar bloqueado, sem entender por quê.
   */
  it("com mais de um impedimento, o motivo é o primeiro passo do onboarding", () => {
    expect(motivoParaNaoCriarRevendedor({ dominio: null, dominioStatus: "ativo", ativo: false, revendaAtiva: false }))
      .toMatch(/domínio próprio/);
  });

  /**
   * Ausência de campo não é prova de campo falso. Quem chama pode montar o
   * objeto sem `ativo`/`revendaAtiva` (a lista da tela não os traz sempre), e
   * `!marca.ativo` bloquearia uma marca perfeitamente ligada.
   */
  it("campo ausente não bloqueia: undefined não é false", () => {
    expect(motivoParaNaoCriarRevendedor({ dominio: "app.crednet.com.br", dominioStatus: "ativo" })).toBeNull();
    expect(motivoParaNaoCriarRevendedor({
      dominio: "app.crednet.com.br", dominioStatus: "ativo", ativo: null, revendaAtiva: null,
    })).toBeNull();
  });
});

describe("rotuloDaAcao", () => {
  it("traduz o verbo do catálogo", () => {
    expect(rotuloDaAcao("suspender")).toBe("Suspendeu provedor");
    expect(rotuloDaAcao("alterar_comissao")).toBe("Alterou a comissão");
  });

  it("verbo que a tela ainda não conhece aparece cru, e não sumido", () => {
    expect(rotuloDaAcao("verbo_novo_da_fase_4")).toBe("Verbo novo da fase 4");
  });

  it("string vazia não vira frase vazia no meio da tabela", () => {
    expect(rotuloDaAcao("")).toBe("—");
  });
});

describe("a trilha na tela", () => {
  const EVENTO: EventoDaMarca = {
    id: 1, userId: 12, atorRole: "superadmin", acao: "suspender",
    providerId: 3, createdAt: "2026-09-03T14:05:00.000Z",
  };

  it("sem o nome do ator, o id ainda identifica quem fez", () => {
    expect(nomeDoAtor(EVENTO)).toBe("usuário #12");
    expect(nomeDoAtor({ ...EVENTO, atorNome: "Ana" })).toBe("Ana");
    expect(nomeDoAtor({ ...EVENTO, atorNome: "   " })).toBe("usuário #12");
  });

  it("o provedor é resolvido pela lista que o detalhe da marca já traz", () => {
    expect(nomeDoProvedor(EVENTO, [{ id: 3, name: "Provedor Alfa" }])).toBe("Provedor Alfa");
    expect(nomeDoProvedor(EVENTO, [])).toBe("provedor #3");
    expect(nomeDoProvedor({ ...EVENTO, provedorNome: "Do servidor" }, [])).toBe("Do servidor");
  });

  it("ação sobre a própria marca não tem provedor, e isso é null e não um id", () => {
    expect(nomeDoProvedor({ ...EVENTO, acao: "editar_marca", providerId: null })).toBeNull();
  });

  it("horário ausente ou impossível vira traço, nunca 'Invalid Date'", () => {
    expect(dataHoraCurta(null)).toBe("—");
    expect(dataHoraCurta("nao-e-data")).toBe("—");
    expect(dataHoraCurta(EVENTO.createdAt)).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});
