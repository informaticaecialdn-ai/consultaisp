/**
 * A POLÍTICA DE ACORDO — por carteira — e as OFERTAS que ela autoriza.
 *
 * É o que destrava o acordo automático (o chat e, depois, o portal do
 * ex-cliente): em vez de "desconto até 20%" para o provedor inteiro, cada
 * carteira tem a própria régua de faixas por dias de atraso, porque o risco e
 * a conversa são outros — o cliente ATIVO ainda paga mensalidade e a dívida é
 * recente; o EX-CLIENTE já foi embora e o que se recupera é o que der.
 *
 * DECISÃO DO DONO (06/09/2026), literal: perguntado onde nasce a cobrança de
 * um acordo com desconto — Asaas por provedor ou escrita no ERP —, respondeu
 * "fica na decisão do provedor". Por isso `origemDaCobranca` é um CAMPO da
 * política, com quatro valores, e não uma escolha nossa. E: "o portal de
 * acordo do ex-cliente sai primeiro só com pagar o valor integral" — então,
 * enquanto a origem for `nao_definida`, NENHUMA oferta com desconto é gerada;
 * o sistema oferece o valor integral pela segunda via do próprio ERP e diz o
 * porquê.
 *
 * O teto de tudo continua sendo `politica.negociacao` (o envelope geral do
 * provedor, já preso aos tetos legais): a política de acordo NUNCA passa do
 * `descontoMaxPct` nem do `maxParcelas` gerais, e `clampAcordo` diz o que
 * puxou cada valor — o mesmo contrato de `clampPolitica` (`{ acordo,
 * ajustes }`), porque ajustar em silêncio esconderia a regra do admin.
 *
 * NOTA DE IMPORTAÇÃO: aqui só entra `import type` de `./politica`. É
 * `politica.ts` que importa ESTE módulo em tempo de execução (o schema e o
 * padrão do campo `acordo`), e um ciclo com valor no topo do módulo quebraria
 * quem importasse `acordo.ts` primeiro (TDZ). Por isso a divisão de parcelas
 * e a soma de meses estão reescritas aqui, em centavos, com um teste que as
 * prende a `gerarParcelas` — duas contas de dinheiro só podem existir se algo
 * garantir que dão o mesmo número.
 *
 * Percentuais são PONTOS PERCENTUAIS, como no resto da política: 20 = 20%.
 * Módulo puro: sem banco, sem React, sem I/O, sem relógio (o "hoje" entra).
 */
import { z } from "zod";
import { CARTEIRAS, type Carteira } from "./estados";
import type { NegociacaoConfig } from "./politica";

/* ── Onde a cobrança do acordo nasce ──────────────────────────────────── */

export const ORIGENS_DA_COBRANCA = ["nao_definida", "asaas", "erp", "manual"] as const;
export type OrigemDaCobranca = (typeof ORIGENS_DA_COBRANCA)[number];

export const ROTULO_ORIGEM_DA_COBRANCA: Record<OrigemDaCobranca, string> = {
  nao_definida: "Não definida",
  asaas: "Asaas do provedor",
  erp: "O próprio ERP",
  manual: "Manual (fora do sistema)",
};

/** Uma linha para o admin entender a escolha sem sair da tela. */
export const EXPLICACAO_ORIGEM_DA_COBRANCA: Record<OrigemDaCobranca, string> = {
  nao_definida: "Enquanto não houver origem, o sistema só oferece o valor integral pela segunda via do próprio ERP — nenhum desconto, nem no chat, nem no portal.",
  // PENDENTE: nada emite cobrança de acordo ainda. A conta Asaas do provedor
  // hoje só cobra a assinatura e os créditos da plataforma; escrever o boleto
  // ou o PIX do acordo nela é trabalho que ainda não existe. A frase fica no
  // futuro de propósito — no presente ela prometeria emissão automática.
  asaas: "Escolha para que a cobrança do acordo passe a nascer na conta Asaas do provedor (PIX ou boleto). A emissão ainda não está ligada: por enquanto o acordo é registrado e a cobrança sai por fora.",
  erp: "A cobrança do acordo nasce no ERP, quando o conector souber escrever nele.",
  manual: "O sistema só registra o acordo; o provedor emite a cobrança por fora.",
};

/**
 * Origem que existe no vocabulário mas que NENHUM código executa hoje. A tela
 * mostra a opção desabilitada com este motivo em vez de escondê-la: esconder
 * faria o admin procurar; oferecer faria o acordo nascer sem cobrança.
 * Os seis conectores de ERP só LEEM — nenhum escreve fatura ou acordo.
 *
 * O `<select>` desabilitado é conveniência, não regra: quem RECUSA é o schema
 * (ver `acordoDaCarteiraSchema`), do mesmo jeito que o servidor recusa
 * configurar conector marcado `naoImplementado`. Sem isso um PUT por curl
 * gravava `erp` e a partir dali saíam ofertas com desconto para um canal onde
 * ninguém escreve cobrança.
 */
export const ORIGEM_INDISPONIVEL: Partial<Record<OrigemDaCobranca, string>> = {
  erp: "Nenhum conector de ERP escreve cobrança hoje — os seis só leem. Enquanto isso, use Asaas ou manual.",
};

export const origemDisponivel = (origem: OrigemDaCobranca): boolean => ORIGEM_INDISPONIVEL[origem] === undefined;

/* ── Faixas por dias de atraso ────────────────────────────────────────── */

/**
 * Uma faixa vale de `acimaDeDias` (exclusivo) até `ateDias` (inclusive);
 * `ateDias: null` é a última, sem teto. `acimaDeDias` é OPCIONAL na entrada e
 * inferido do `ateDias` da faixa anterior (0 na primeira) — assim a forma
 * curta, só com os tetos, sempre valida; quem escreve os dois lados tem a
 * sobreposição e o buraco recusados, não corrigidos em silêncio.
 */
export const FaixaDeAcordoSchema = z.object({
  acimaDeDias: z.number().int().min(0).max(3650).optional(),
  ateDias: z.number().int().min(1).max(3650).nullable(),
  descontoMaxPct: z.number().min(0).max(100),
  maxParcelas: z.number().int().min(1).max(48),
  entradaMinimaPct: z.number().min(0).max(100),
});
export type FaixaDeAcordo = z.infer<typeof FaixaDeAcordoSchema>;

/** A faixa com os dois lados resolvidos — o que a tela mostra e a oferta usa. */
export interface FaixaResolvida {
  acimaDeDias: number;
  ateDias: number | null;
  descontoMaxPct: number;
  maxParcelas: number;
  entradaMinimaPct: number;
}

export type FaixasNormalizadas =
  | { ok: true; faixas: FaixaResolvida[] }
  | { ok: false; erros: string[] };

/**
 * Ordena, infere o piso de cada faixa e prova que a régua cobre de 1 dia ao
 * infinito sem sobrepor. Faixa sobreposta seria duas verdades sobre o mesmo
 * atraso; buraco seria um cliente sem oferta nenhuma.
 */
export function normalizarFaixas(faixas: readonly FaixaDeAcordo[]): FaixasNormalizadas {
  if (faixas.length === 0) return { ok: false, erros: ["informe ao menos uma faixa de atraso"] };

  const ordenadas = [...faixas].sort((a, b) => {
    const pa = a.acimaDeDias ?? a.ateDias ?? Number.MAX_SAFE_INTEGER;
    const pb = b.acimaDeDias ?? b.ateDias ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return (a.ateDias ?? Number.MAX_SAFE_INTEGER) - (b.ateDias ?? Number.MAX_SAFE_INTEGER);
  });

  const erros: string[] = [];
  const resolvidas: FaixaResolvida[] = [];
  let piso = 0;
  let semTeto = false;

  for (const f of ordenadas) {
    if (semTeto) {
      erros.push("a faixa sem teto tem de ser a última: nada vem depois de \"acima de\"");
      break;
    }
    const acimaDe = f.acimaDeDias ?? piso;
    if (acimaDe < piso) erros.push(`faixa a partir de ${acimaDe + 1} dias se sobrepõe à anterior, que vai até ${piso}`);
    if (acimaDe > piso) erros.push(`nenhuma faixa cobre de ${piso + 1} a ${acimaDe} dias de atraso`);
    if (f.ateDias !== null && f.ateDias <= acimaDe) {
      erros.push(`faixa vazia: até ${f.ateDias} dias não pode ser menor ou igual a ${acimaDe}`);
    }
    resolvidas.push({
      acimaDeDias: acimaDe,
      ateDias: f.ateDias,
      descontoMaxPct: f.descontoMaxPct,
      maxParcelas: f.maxParcelas,
      entradaMinimaPct: f.entradaMinimaPct,
    });
    if (f.ateDias === null) semTeto = true;
    else piso = Math.max(piso, f.ateDias);
  }
  if (!semTeto) erros.push(`nenhuma faixa cobre acima de ${piso} dias de atraso: a última precisa ficar sem teto`);
  return erros.length > 0 ? { ok: false, erros } : { ok: true, faixas: resolvidas };
}

/** A faixa que vale para um atraso. Atraso menor que 1 dia usa a primeira. */
export function faixaDoAtraso(faixas: readonly FaixaResolvida[], diasAtraso: number): FaixaResolvida | null {
  if (faixas.length === 0) return null;
  const dias = Math.max(0, Math.trunc(diasAtraso));
  return faixas.find(f => dias > f.acimaDeDias && (f.ateDias === null || dias <= f.ateDias)) ?? faixas[0];
}

/** "de 31 a 60 dias" · "acima de 60 dias" · "até 30 dias" — o rótulo da tela. */
export function rotuloDaFaixa(f: FaixaResolvida): string {
  if (f.ateDias === null) return `acima de ${f.acimaDeDias} dias`;
  if (f.acimaDeDias === 0) return `até ${f.ateDias} dias`;
  return `de ${f.acimaDeDias + 1} a ${f.ateDias} dias`;
}

/* ── A política de acordo ─────────────────────────────────────────────── */

/**
 * Os padrões, um por carteira. O cliente ATIVO em atraso recente paga o que
 * deve: nenhum desconto e à vista — dar desconto a quem ainda está na base
 * ensina a atrasar. Do EX-CLIENTE se recupera o que der, e o desconto sobe
 * com o tempo, sem nunca passar do envelope geral (20% / 6x no padrão).
 */
export const FAIXAS_PADRAO: Record<Carteira, FaixaDeAcordo[]> = {
  ativo: [
    { acimaDeDias: 0, ateDias: 30, descontoMaxPct: 0, maxParcelas: 1, entradaMinimaPct: 100 },
    { acimaDeDias: 30, ateDias: 60, descontoMaxPct: 5, maxParcelas: 2, entradaMinimaPct: 50 },
    { acimaDeDias: 60, ateDias: null, descontoMaxPct: 10, maxParcelas: 3, entradaMinimaPct: 30 },
  ],
  ex_cliente: [
    { acimaDeDias: 0, ateDias: 90, descontoMaxPct: 10, maxParcelas: 3, entradaMinimaPct: 30 },
    { acimaDeDias: 90, ateDias: 180, descontoMaxPct: 15, maxParcelas: 4, entradaMinimaPct: 25 },
    { acimaDeDias: 180, ateDias: null, descontoMaxPct: 20, maxParcelas: 6, entradaMinimaPct: 20 },
  ],
};

/**
 * O padrão de cada carteira. `tetoDeExcecaoPct` e `parcelasDeExcecao` nascem
 * iguais ao envelope geral do padrão (20% e 6x): é a faixa entre o que o
 * sistema oferece sozinho e o que um humano ainda pode aprovar.
 * `janelaVencimentoDias` é o que o Acordo Fácil chama de janela do credor —
 * em quantos dias à frente o devedor pode escolher a primeira parcela.
 */
export const ACORDO_DA_CARTEIRA_PADRAO: Record<Carteira, AcordoDaCarteira> = {
  ativo: {
    origemDaCobranca: "nao_definida",
    faixas: FAIXAS_PADRAO.ativo,
    janelaVencimentoDias: 10,
    tetoDeExcecaoPct: 20,
    parcelasDeExcecao: 6,
  },
  ex_cliente: {
    origemDaCobranca: "nao_definida",
    faixas: FAIXAS_PADRAO.ex_cliente,
    janelaVencimentoDias: 10,
    tetoDeExcecaoPct: 20,
    parcelasDeExcecao: 6,
  },
};

export interface AcordoDaCarteira {
  origemDaCobranca: OrigemDaCobranca;
  faixas: FaixaDeAcordo[];
  janelaVencimentoDias: number;
  tetoDeExcecaoPct: number;
  parcelasDeExcecao: number;
}

const faixasDaCarteira = (carteira: Carteira) =>
  z.array(FaixaDeAcordoSchema)
    .min(1)
    .superRefine((faixas, ctx) => {
      const r = normalizarFaixas(faixas);
      if (!r.ok) for (const erro of r.erros) ctx.addIssue({ code: z.ZodIssueCode.custom, message: erro });
    })
    .default(() => FAIXAS_PADRAO[carteira].map(f => ({ ...f })));

const acordoDaCarteiraSchema = (carteira: Carteira) =>
  z.object({
    // O gate da origem indisponível mora AQUI, e não na tela: o `<select>`
    // desabilitado só protege quem usa a tela. Recusar (em vez de corrigir em
    // silêncio para `nao_definida`) é o mesmo contrato do resto da política —
    // o admin fica sabendo o que não foi gravado, com a frase que ele leu.
    origemDaCobranca: z.enum(ORIGENS_DA_COBRANCA).default("nao_definida").superRefine((origem, ctx) => {
      const indisponivel = ORIGEM_INDISPONIVEL[origem];
      if (indisponivel) ctx.addIssue({ code: z.ZodIssueCode.custom, message: indisponivel });
    }),
    faixas: faixasDaCarteira(carteira),
    /** 0 = só hoje. Sessenta dias é o limite operacional: acordo marcado para daqui a meio ano não é acordo. */
    janelaVencimentoDias: z.number().int().min(0).max(60).default(ACORDO_DA_CARTEIRA_PADRAO[carteira].janelaVencimentoDias),
    tetoDeExcecaoPct: z.number().min(0).max(100).default(ACORDO_DA_CARTEIRA_PADRAO[carteira].tetoDeExcecaoPct),
    parcelasDeExcecao: z.number().int().min(1).max(48).default(ACORDO_DA_CARTEIRA_PADRAO[carteira].parcelasDeExcecao),
  });

export const AcordoSchema = z.object({
  ativo: acordoDaCarteiraSchema("ativo").default(() => ({ ...ACORDO_DA_CARTEIRA_PADRAO.ativo })),
  ex_cliente: acordoDaCarteiraSchema("ex_cliente").default(() => ({ ...ACORDO_DA_CARTEIRA_PADRAO.ex_cliente })),
});
export type Acordo = z.infer<typeof AcordoSchema>;

/** O valor do JSONB novo em `cobranca_politica.acordo` — e o default da coluna. */
export const ACORDO_PADRAO: Acordo = {
  ativo: { ...ACORDO_DA_CARTEIRA_PADRAO.ativo, faixas: FAIXAS_PADRAO.ativo.map(f => ({ ...f })) },
  ex_cliente: { ...ACORDO_DA_CARTEIRA_PADRAO.ex_cliente, faixas: FAIXAS_PADRAO.ex_cliente.map(f => ({ ...f })) },
};

/* ── Clamp contra o envelope geral ────────────────────────────────────── */

export interface AcordoAjustado {
  acordo: Acordo;
  /** Frases para o admin: o que foi puxado e o que puxou. Vazio = nada mexido. */
  ajustes: string[];
}

/**
 * A política de acordo vive DENTRO do envelope geral: desconto e parcelas não
 * passam de `negociacao`, e a entrada mínima de uma faixa não pode ser MENOR
 * que a geral (seria afrouxar por outra porta). Puxa e avisa — nunca recusa a
 * tela inteira por um número, e nunca ajusta calado.
 */
export function clampAcordo(acordo: Acordo, negociacao: NegociacaoConfig): AcordoAjustado {
  const ajustes: string[] = [];
  const ajustado = structuredClone(acordo);

  for (const carteira of CARTEIRAS) {
    const c = ajustado[carteira];
    const onde = ROTULO_CARTEIRA_NO_ACORDO[carteira];

    // As faixas válidas são gravadas ORDENADAS e com o piso explícito: o que
    // se lê depois é o que vale, sem depender de inferir de novo. Faixas
    // inconsistentes ficam como vieram (quem recusa é o Zod, na rota) e o
    // aviso cai no número da linha em vez de apontar a faixa errada.
    const normalizadas = normalizarFaixas(c.faixas);
    if (normalizadas.ok) c.faixas = normalizadas.faixas;
    const rotulos = normalizadas.ok
      ? normalizadas.faixas.map(rotuloDaFaixa)
      : c.faixas.map((_, i) => `faixa ${i + 1}`);

    c.faixas = c.faixas.map((f, i) => {
      const faixa = { ...f };
      const rotulo = rotulos[i] ?? `faixa ${i + 1}`;
      if (faixa.descontoMaxPct > negociacao.descontoMaxPct) {
        ajustes.push(`${onde}, ${rotulo}: desconto de ${pctCurto(faixa.descontoMaxPct)} reduzido a ${pctCurto(negociacao.descontoMaxPct)} — o teto geral da negociação.`);
        faixa.descontoMaxPct = negociacao.descontoMaxPct;
      }
      if (faixa.maxParcelas > negociacao.maxParcelas) {
        ajustes.push(`${onde}, ${rotulo}: ${faixa.maxParcelas} parcelas reduzidas a ${negociacao.maxParcelas} — o teto geral da negociação.`);
        faixa.maxParcelas = negociacao.maxParcelas;
      }
      if (faixa.entradaMinimaPct < negociacao.entradaMinimaPct) {
        ajustes.push(`${onde}, ${rotulo}: entrada mínima de ${pctCurto(faixa.entradaMinimaPct)} elevada a ${pctCurto(negociacao.entradaMinimaPct)} — o mínimo geral da negociação.`);
        faixa.entradaMinimaPct = negociacao.entradaMinimaPct;
      }
      return faixa;
    });

    if (c.tetoDeExcecaoPct > negociacao.descontoMaxPct) {
      ajustes.push(`${onde}: teto de exceção de ${pctCurto(c.tetoDeExcecaoPct)} reduzido a ${pctCurto(negociacao.descontoMaxPct)} — nem com aprovação se passa do teto geral.`);
      c.tetoDeExcecaoPct = negociacao.descontoMaxPct;
    }
    if (c.parcelasDeExcecao > negociacao.maxParcelas) {
      ajustes.push(`${onde}: ${c.parcelasDeExcecao} parcelas de exceção reduzidas a ${negociacao.maxParcelas} — nem com aprovação se passa do teto geral.`);
      c.parcelasDeExcecao = negociacao.maxParcelas;
    }
  }
  return { acordo: ajustado, ajustes };
}

export const ROTULO_CARTEIRA_NO_ACORDO: Record<Carteira, string> = {
  ativo: "Clientes ativos",
  ex_cliente: "Ex-clientes",
};

/* ── As ofertas que a política autoriza ───────────────────────────────── */

export interface EntradaDasOfertas {
  /** O saldo em aberto de hoje — a base do desconto. */
  saldo: number;
  diasAtraso: number;
  carteira: Carteira;
  /** "AAAA-MM-DD". Entra como dado: a função é pura e não olha o relógio. */
  hoje: string;
  /** A data que o devedor escolheu para a primeira parcela; presa à janela da política. */
  primeiroVencimento?: string;
}

export interface OfertaDeAcordo {
  tipo: "a_vista" | "parcelado";
  /** O total que o cliente paga, entrada inclusa. */
  valor: number;
  descontoPct: number;
  parcelas: number;
  /** A primeira parcela; a última pode diferir em centavos para a soma fechar. */
  valorParcela: number;
  /** Paga na aceitação — não é uma das parcelas. */
  entrada: number;
  /** Uma data por parcela, "AAAA-MM-DD". */
  vencimentos: string[];
}

export interface OfertasDaPolitica {
  ofertas: OfertaDeAcordo[];
  origemDaCobranca: OrigemDaCobranca;
  /** Sempre preenchido: por que estas ofertas, e não outras. */
  motivo: string;
  faixa: FaixaResolvida | null;
  /** A última data que o devedor pode escolher para a primeira parcela. */
  vencimentoMaximo: string;
}

/**
 * O CORAÇÃO: saldo, dias de atraso e carteira entram; saem as ofertas que o
 * servidor autoriza — nada de rede, nada de relógio, nada de banco.
 *
 * Sem origem da cobrança definida, sai UMA oferta: o valor integral, à vista,
 * sem desconto, com o motivo escrito — foi o que o dono pediu para o portal
 * do ex-cliente sair primeiro.
 */
export function ofertasDaPolitica(
  entrada: EntradaDasOfertas,
  politica: { acordo: Acordo; negociacao: NegociacaoConfig },
): OfertasDaPolitica {
  const carteira = politica.acordo[entrada.carteira];
  const janela = carteira.janelaVencimentoDias;
  const vencimentoMaximo = somarDias(entrada.hoje, janela);
  const escolhido = dataNaJanela(entrada.primeiroVencimento, entrada.hoje, vencimentoMaximo);
  const saldo = arredondarLocal(entrada.saldo);
  const base = {
    origemDaCobranca: carteira.origemDaCobranca,
    faixa: null as FaixaResolvida | null,
    vencimentoMaximo,
  };

  if (!(saldo > 0)) {
    return { ...base, ofertas: [], motivo: "Não há saldo em aberto: nada a negociar." };
  }

  const aVistaIntegral: OfertaDeAcordo = {
    tipo: "a_vista",
    valor: saldo,
    descontoPct: 0,
    parcelas: 1,
    valorParcela: saldo,
    entrada: 0,
    vencimentos: [escolhido],
  };

  if (carteira.origemDaCobranca === "nao_definida") {
    return {
      ...base,
      ofertas: [aVistaIntegral],
      motivo: "A política ainda não diz onde a cobrança do acordo nasce, então nenhum desconto é oferecido: só o valor integral, pela segunda via do próprio ERP.",
    };
  }

  // Cinto e suspensório: o schema já recusa gravar origem indisponível, mas
  // uma política montada em memória — ou gravada antes deste gate existir —
  // não pode virar desconto para um canal onde ninguém escreve a cobrança.
  const indisponivel = ORIGEM_INDISPONIVEL[carteira.origemDaCobranca];
  if (indisponivel) {
    return {
      ...base,
      ofertas: [aVistaIntegral],
      motivo: `${indisponivel} Até lá, só o valor integral, pela segunda via do próprio ERP.`,
    };
  }

  const normalizadas = normalizarFaixas(carteira.faixas);
  if (!normalizadas.ok) {
    return {
      ...base,
      ofertas: [aVistaIntegral],
      motivo: `As faixas de atraso da política estão inconsistentes (${normalizadas.erros[0]}): só o valor integral até um administrador corrigi-las.`,
    };
  }
  const faixa = faixaDoAtraso(normalizadas.faixas, entrada.diasAtraso);
  if (!faixa) {
    return { ...base, ofertas: [aVistaIntegral], motivo: "Nenhuma faixa da política cobre este atraso: só o valor integral." };
  }

  // O centavo do desconto arredonda PARA CIMA no valor a pagar: R$ 99,99 com
  // 20% dá 79,992, e arredondar para 79,99 seria um desconto de 20,002% — o
  // servidor recusaria a propria oferta na hora de registrar. O desconto
  // publicado é o EFETIVO, não o da faixa: o que o cliente vê é o que a conta
  // deu.
  const valor = Math.ceil((Math.round(saldo * 100) * (100 - faixa.descontoMaxPct)) / 100) / 100;
  const descontoPct = arredondarLocal(((saldo - valor) / saldo) * 100);
  const ofertas: OfertaDeAcordo[] = [{
    tipo: "a_vista",
    valor,
    descontoPct,
    parcelas: 1,
    valorParcela: valor,
    entrada: 0,
    vencimentos: [escolhido],
  }];

  const parcelas = Math.min(faixa.maxParcelas, politica.negociacao.maxParcelas);
  const entradaDoParcelado = arredondarLocal((valor * Math.max(faixa.entradaMinimaPct, politica.negociacao.entradaMinimaPct)) / 100);
  const saldoAParcelar = arredondarLocal(valor - entradaDoParcelado);
  const podeParcelar = parcelas >= 2 && saldoAParcelar >= politica.negociacao.saldoMinimoParcelar;

  if (podeParcelar) {
    const linhas = dividirEmParcelas(valor, parcelas, entradaDoParcelado, escolhido);
    ofertas.push({
      tipo: "parcelado",
      valor,
      descontoPct: faixa.descontoMaxPct,
      parcelas,
      valorParcela: linhas[0]?.valor ?? 0,
      entrada: entradaDoParcelado,
      vencimentos: linhas.map(l => l.vencimento),
    });
  }

  const motivo = podeParcelar
    ? `Faixa ${rotuloDaFaixa(faixa)}: desconto de até ${pctCurto(faixa.descontoMaxPct)}, em até ${parcelas}x, com entrada de ${pctCurto(Math.max(faixa.entradaMinimaPct, politica.negociacao.entradaMinimaPct))}.`
    : parcelas < 2
      ? `Faixa ${rotuloDaFaixa(faixa)}: a política pede pagamento à vista, com desconto de até ${pctCurto(faixa.descontoMaxPct)}.`
      : `Faixa ${rotuloDaFaixa(faixa)}: saldo abaixo do mínimo para parcelar (${dinheiroCurto(politica.negociacao.saldoMinimoParcelar)}), então só à vista, com desconto de até ${pctCurto(faixa.descontoMaxPct)}.`;

  return { ...base, faixa, ofertas, motivo };
}

/* ── O pedido manual, medido contra a faixa ───────────────────────────── */

export type DecisaoDoAcordo =
  /** Dentro da faixa: o operador registra e pronto. */
  | { decisao: "dentro"; faixa: FaixaResolvida | null }
  /** Passou da faixa mas cabe no teto de exceção: registra e vai a um humano aprovar. */
  | { decisao: "excecao"; faixa: FaixaResolvida | null; motivos: string[] }
  /** Fora até do teto de exceção: não entra. */
  | { decisao: "recusado"; faixa: FaixaResolvida | null; violacoes: string[] };

export interface PedidoMedido {
  carteira: Carteira;
  diasAtraso: number;
  valorOriginal: number;
  valorNegociado: number;
  entrada?: number;
  parcelas?: number;
}

/**
 * Mede uma proposta MANUAL contra a faixa da carteira. O envelope geral
 * (`validarNegociacao`) já correu antes e é intransponível; aqui se separa o
 * que a política autoriza sozinha do que precisa de um humano dizendo sim.
 *
 * A `origemDaCobranca` NÃO entra: ela governa o que o SISTEMA oferece (chat e
 * portal), não o que um funcionário fecha ao telefone. Bloquear o humano por
 * falta de um campo de configuração pararia a cobrança do provedor.
 */
export function avaliarPedidoDeAcordo(pedido: PedidoMedido, politica: { acordo: Acordo }): DecisaoDoAcordo {
  const carteira = politica.acordo[pedido.carteira];
  const normalizadas = normalizarFaixas(carteira.faixas);
  // Faixas inconsistentes não podem virar recusa: a política gravada é
  // problema do admin, não do operador que está com o cliente na linha.
  if (!normalizadas.ok) return { decisao: "dentro", faixa: null };
  const faixa = faixaDoAtraso(normalizadas.faixas, pedido.diasAtraso);
  if (!faixa) return { decisao: "dentro", faixa: null };

  const descontoPct = pedido.valorOriginal > 0
    ? ((pedido.valorOriginal - pedido.valorNegociado) / pedido.valorOriginal) * 100
    : 0;
  const parcelas = Math.max(1, Math.trunc(pedido.parcelas ?? 1));
  const entrada = pedido.entrada ?? 0;

  const motivos: string[] = [];
  const violacoes: string[] = [];

  if (descontoPct > faixa.descontoMaxPct + 1e-9) {
    if (descontoPct > carteira.tetoDeExcecaoPct + 1e-9) {
      violacoes.push(`Desconto de ${pctCurto(descontoPct)} acima do teto de exceção de ${pctCurto(carteira.tetoDeExcecaoPct)} para ${rotuloMinusculo(pedido.carteira)} (a faixa ${rotuloDaFaixa(faixa)} permite ${pctCurto(faixa.descontoMaxPct)}).`);
    } else {
      motivos.push(`Desconto de ${pctCurto(descontoPct)} acima dos ${pctCurto(faixa.descontoMaxPct)} da faixa ${rotuloDaFaixa(faixa)}.`);
    }
  }
  if (parcelas > faixa.maxParcelas) {
    if (parcelas > carteira.parcelasDeExcecao) {
      violacoes.push(`${parcelas} parcelas acima do limite de exceção de ${carteira.parcelasDeExcecao}x para ${rotuloMinusculo(pedido.carteira)} (a faixa ${rotuloDaFaixa(faixa)} permite ${faixa.maxParcelas}x).`);
    } else {
      motivos.push(`${parcelas} parcelas acima das ${faixa.maxParcelas}x da faixa ${rotuloDaFaixa(faixa)}.`);
    }
  }
  if (parcelas > 1) {
    const minima = arredondarLocal((pedido.valorNegociado * faixa.entradaMinimaPct) / 100);
    if (entrada + 0.005 < minima) {
      motivos.push(`Entrada de ${dinheiroCurto(entrada)} abaixo dos ${pctCurto(faixa.entradaMinimaPct)} (${dinheiroCurto(minima)}) da faixa ${rotuloDaFaixa(faixa)}.`);
    }
  }

  if (violacoes.length > 0) return { decisao: "recusado", faixa, violacoes: [...violacoes, ...motivos] };
  if (motivos.length > 0) return { decisao: "excecao", faixa, motivos };
  return { decisao: "dentro", faixa };
}

const rotuloMinusculo = (c: Carteira) => ROTULO_CARTEIRA_NO_ACORDO[c].toLowerCase();

/* ── Contas locais (ver a NOTA DE IMPORTAÇÃO no topo) ─────────────────── */

const arredondarLocal = (valor: number): number => Math.round(valor * 100) / 100;

/** "20%" ou "12,5%" — a mesma forma de `pct` em politica.ts, com teste que as prende. */
function pctCurto(valor: number): string {
  const v = Math.round(valor * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1).replace(".", ",")}%`;
}

/** "R$ 1.234,56" — a mesma forma de `brl` em politica.ts, com teste que as prende. */
function dinheiroCurto(valor: number): string {
  const negativo = valor < 0;
  const [inteiro, decimais] = Math.abs(valor).toFixed(2).split(".");
  return `${negativo ? "-" : ""}R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimais}`;
}

interface LinhaDaOferta { numero: number; valor: number; vencimento: string }

/**
 * Divide em centavos, com a última parcela absorvendo a sobra, e vence mês a
 * mês no mesmo dia (dia que não existe no mês cai no último). É a conta de
 * `gerarParcelas`, reescrita aqui para não criar ciclo de importação — e há
 * teste comparando as duas parcela a parcela.
 */
function dividirEmParcelas(valorNegociado: number, parcelas: number, entrada: number, primeiroVencimento: string): LinhaDaOferta[] {
  const saldoCentavos = Math.round((valorNegociado - entrada) * 100);
  if (saldoCentavos < 0) return [];
  const base = Math.floor(saldoCentavos / parcelas);
  const ultima = saldoCentavos - base * (parcelas - 1);
  const [ano, mes, dia] = lerData(primeiroVencimento);
  return Array.from({ length: parcelas }, (_, i) => ({
    numero: i + 1,
    valor: (i === parcelas - 1 ? ultima : base) / 100,
    vencimento: somarMesesLocal(ano, mes, dia, i),
  }));
}

function lerData(iso: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`Data inválida: "${iso}" (esperado AAAA-MM-DD).`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function somarMesesLocal(ano: number, mes: number, dia: number, meses: number): string {
  const total = ano * 12 + (mes - 1) + meses;
  const novoAno = Math.floor(total / 12);
  const novoMes = (total % 12) + 1;
  const ultimoDia = new Date(Date.UTC(novoAno, novoMes, 0)).getUTCDate();
  return `${novoAno}-${String(novoMes).padStart(2, "0")}-${String(Math.min(dia, ultimoDia)).padStart(2, "0")}`;
}

export function somarDias(iso: string, dias: number): string {
  const [ano, mes, dia] = lerData(iso);
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** A escolha do devedor, presa à janela do credor: nunca antes de hoje, nunca depois do teto. */
export function dataNaJanela(escolhida: string | undefined, hoje: string, maxima: string): string {
  if (!escolhida || !/^\d{4}-\d{2}-\d{2}$/.test(escolhida)) return hoje;
  if (escolhida < hoje) return hoje;
  if (escolhida > maxima) return maxima;
  return escolhida;
}
