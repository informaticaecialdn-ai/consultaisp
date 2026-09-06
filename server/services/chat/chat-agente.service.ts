/**
 * A PORTA do agente de IA do Chat BullQ no Consulta ISP.
 *
 * O agente de cobranca do provedor (um AiAgent WORKER na organizacao dele no
 * Chat BullQ) chama o Consulta ISP por skills HTTP quando conversa com o
 * cliente no WhatsApp: consulta o caso pelo telefone antes de falar de valor,
 * registra a promessa de pagamento que o cliente fez, e avisa quando passou
 * a bola ao atendente. Nada disso e decidido pelo agente: ele le o que a
 * regua e a politica do provedor ja decidiram (tom do DNA e as ofertas que a
 * POLITICA DE ACORDO da carteira autoriza) e fala dentro disso.
 *
 * O QUE ELE PODE OFERECER NAO E O ENVELOPE GERAL. Ate 06/09/2026 a instrucao
 * dizia "Pode oferecer ate 20% de desconto e ate 6x" lendo `politica.negociacao`
 * — o TETO do provedor, nao o que a politica autoriza para AQUELE caso. Com
 * `origemDaCobranca = "nao_definida"` (o estado em que todo provedor nasce, e o
 * que a tela de politica afirma ao admin: "o sistema nao oferece desconto — nem
 * no chat, nem no portal") nenhum desconto existe; e mesmo com origem definida
 * quem manda e a faixa por dias de atraso da carteira — cliente ATIVO com 10
 * dias de atraso paga integral, a vista. Por isso a instrucao agora sai de
 * `ofertasDaPolitica`: as MESMAS ofertas concretas que o servidor autorizaria,
 * em vez de um teto que ninguem honraria depois.
 *
 * Quem autentica e uma CHAVE POR PROVEDOR gerada aqui — o Consulta ISP guarda
 * so o SHA-256; a chave crua vive como header da tool no Chat BullQ. Toda
 * chamada sem chave valida e 401, e telefone nunca vai para o log.
 *
 * Regra do Chat BullQ que molda as respostas: status HTTP >= 400 vira alerta
 * "skill falhou" para TODA a organizacao. Por isso "cliente nao encontrado"
 * e 200 com `encontrado: false` — e uma resposta, nao um erro.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { carregarPolitica, carteiraValida, classificarCliente, reguaParaHoje } from "../../routes/cobranca.routes";
import { carteiraDoStatusErp } from "../../storage/cobranca.storage";
// `brl` e o do dominio (espaco comum, "R$ 1.234,56"), nao um `Intl` local: a
// mesma frase mistura valor da divida e valor da oferta, e dois formatadores
// diferentes na mesma linha (um deles com espaco insecavel) e ruido.
import { ACORDO_PADRAO, brl, DIRETIVA_POR_TOM, janelaDaEtapa, ofertasDaPolitica, pct, prescrita, ROTULO_CANAL, rotuloDaFaixa } from "@shared/cobranca";
import type { Acordo, Carteira, OfertasDaPolitica } from "@shared/cobranca";
import { normalizarTelefoneParaChat } from "./chat-bullq.client";
import { dataLocal } from "./chat-autonomia-politica";

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v) || 0);

/* ── A chave do agente ─────────────────────────────────────────────────── */

export function gerarChaveDoAgente(): string {
  return `isp_ag_${randomBytes(24).toString("base64url")}`;
}

export function hashDaChave(chave: string): string {
  return createHash("sha256").update(chave, "utf8").digest("hex");
}

/**
 * Quem esta chamando: o provedor dono da chave, ou null. Compara os hashes
 * em tempo constante; a busca no banco e pelo hash (indice unico), entao um
 * atacante que chute chaves so bate no indice.
 */
export async function provedorDaChave(chave: string | undefined | null): Promise<{ providerId: number; organizationId: string } | null> {
  const bruta = (chave ?? "").trim();
  if (bruta.length < 20 || bruta.length > 200) return null;
  const hash = hashDaChave(bruta);
  const intg = await storage.getIntegracaoDoChatPorChave(hash);
  if (!intg?.chaveAgenteHash) return null;
  const a = Buffer.from(intg.chaveAgenteHash, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { providerId: intg.providerId, organizationId: intg.organizationId };
}

/* ── O caso, como o agente precisa ler ─────────────────────────────────── */

export interface CasoParaAgente {
  ok: true;
  encontrado: boolean;
  cliente: { primeiroNome: string; nome: string; cidade: string | null; situacaoContrato: string; clienteHaMeses: number | null } | null;
  caso: {
    id: number;
    status: string;
    carteira: string;
    valorEmAberto: number;
    valorAtualizado: number;
    diasAtraso: number;
    faturasVencidas: number | null;
    etapa: { rotulo: string; janela: string; acao: string; canalSugerido: string } | null;
    prescrita: boolean;
    responsavel: string | null;
  } | null;
  tom: { quadrante: string | null; tom: string | null; diretiva: string | null } | null;
  /**
   * O ENVELOPE GERAL do provedor — o teto legal, nao o que o agente pode
   * oferecer. Mantido no contrato porque o Chat BullQ ja o consome; quem diz o
   * que oferecer e `acordo`, abaixo.
   */
  politica: { descontoMaxPct: number; maxParcelas: number; entradaMinimaPct: number; saldoMinimoParcelar: number; multaPct: number; jurosMesPct: number } | null;
  /**
   * ADITIVO (06/09/2026): o que a POLITICA DE ACORDO da carteira do caso
   * autoriza para ESTE atraso — origem da cobranca, faixa e as ofertas
   * concretas. `null` quando nao ha divida a negociar (sem caso, quitado ou
   * prescrito). E a unica fonte do que o agente pode propor.
   */
  acordo: {
    origemDaCobranca: OfertasDaPolitica["origemDaCobranca"];
    /** Por que estas ofertas e nao outras — a frase da propria politica. */
    motivo: string;
    faixa: { rotulo: string; descontoMaxPct: number; maxParcelas: number; entradaMinimaPct: number } | null;
    ofertas: OfertasDaPolitica["ofertas"];
    /** Ultima data que o devedor pode escolher para a primeira parcela. */
    vencimentoMaximo: string;
  } | null;
  promessaAberta: { data: string | null; valor: number | null; registradaEm: string } | null;
  /** De onde vem o valor em aberto e quando foi lido — aqui e sempre a varredura, nunca o ERP ao vivo. */
  valores?: { origem: "base_sincronizada"; lidoEm: string | null };
  /** O que o agente deve fazer, em uma frase — montado do DNA, da etapa e da politica. */
  instrucao: string;
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || "cliente";
}

/** So existem duas carteiras na politica de acordo; qualquer outra coisa e ex-cliente, como em `carteiraValida`. */
const carteiraDoAcordo = (valor: string): Carteira => (valor === "ativo" ? "ativo" : "ex_cliente");

/**
 * A politica de acordo gravada, ou o padrao. Linha legada (gravada antes da
 * migracao 0029) nao tem a coluna, e o padrao ja e o conservador: origem
 * `nao_definida` nas duas carteiras, isto e, NENHUM desconto. Cair no padrao
 * aqui nunca afrouxa nada — so evita que uma linha antiga quebre a porta do
 * agente.
 */
function acordoDaPolitica(politica: { acordo?: Acordo | null }): Acordo {
  const gravado = politica.acordo;
  if (!gravado?.ativo?.faixas || !gravado?.ex_cliente?.faixas) return ACORDO_PADRAO;
  return gravado;
}

/**
 * As ofertas do servidor, ditas ao agente. NUNCA cita um teto: cita o que a
 * politica autoriza para este caso, e manda transferir tudo que passe disso.
 * Com `origemDaCobranca = "nao_definida"` a frase e a mesma que a tela de
 * politica afirma ao admin — nenhum desconto, so o integral pela segunda via.
 */
function frasesDoAcordo(r: OfertasDaPolitica, saldo: number): string {
  const ondeFica = r.faixa ? `faixa ${rotuloDaFaixa(r.faixa)}` : "sem faixa aplicavel";
  if (r.origemDaCobranca === "nao_definida") {
    return `A politica de acordo desta carteira ainda NAO define onde a cobranca nasce, entao NAO ha desconto nem parcelamento a oferecer: so o valor integral de ${brl(saldo)}, pela segunda via do proprio ERP. NAO cite nenhum percentual nem numero de parcelas, nem o teto geral do provedor. Se o cliente pedir abatimento ou prazo, transfira ao atendente.`;
  }
  const aVista = r.ofertas.find(o => o.tipo === "a_vista");
  const parcelado = r.ofertas.find(o => o.tipo === "parcelado");
  if (!parcelado && (!aVista || aVista.descontoPct <= 0)) {
    return `A politica de acordo NAO autoriza desconto nem parcelamento neste caso (${ondeFica}): ofereca o valor integral de ${brl(saldo)} a vista. NAO cite nenhum percentual nem numero de parcelas, nem o teto geral do provedor. Qualquer abatimento ou prazo, transfira ao atendente.`;
  }
  const linhas: string[] = [`A politica de acordo autoriza (${ondeFica}) SOMENTE estas ofertas:`];
  if (aVista) {
    linhas.push(aVista.descontoPct > 0
      ? `a vista ${brl(aVista.valor)}, que e ${pct(aVista.descontoPct)} de desconto sobre ${brl(saldo)};`
      : `a vista ${brl(aVista.valor)}, sem desconto;`);
  }
  if (parcelado) {
    linhas.push(`ou ${parcelado.parcelas}x de ${brl(parcelado.valorParcela)}${parcelado.entrada > 0 ? ` com entrada de ${brl(parcelado.entrada)}` : ""}, total ${brl(parcelado.valor)}.`);
  }
  linhas.push(`Nao ofereca desconto, prazo ou parcela alem disso, e nao cite o teto geral do provedor; a primeira parcela nao pode passar de ${r.vencimentoMaximo}. Fora dessas ofertas, transfira ao atendente.`);
  return linhas.join(" ");
}

/**
 * Le o caso do cliente pelo telefone. Sem cliente, sem caso ou sem divida, a
 * resposta e honesta (`encontrado: false`, ou caso nulo com a instrucao de
 * nao cobrar) — o agente nao inventa valor.
 */
export async function casoParaAgente(providerId: number, telefone: string | null | undefined): Promise<CasoParaAgente> {
  const fone = normalizarTelefoneParaChat(telefone);
  const semNada: CasoParaAgente = { ok: true, encontrado: false, cliente: null, caso: null, tom: null, politica: null, acordo: null, promessaAberta: null, instrucao: "Cliente nao encontrado pelo telefone. Nao cobre nada: pergunte se ele usa outro numero no cadastro e, se preciso, transfira ao atendente." };
  if (!fone) return semNada;

  const cliente = await storage.getCustomerByPhoneDigits(providerId, fone);
  if (!cliente) return semNada;

  const hoje = new Date();
  const [{ politica, etapas }, casoVivo] = await Promise.all([
    carregarPolitica(providerId),
    storage.casoAbertoDoCliente(providerId, cliente.id),
  ]);
  const detalhe = casoVivo ? await storage.obterCasoDeCobranca(providerId, casoVivo.id) : undefined;
  const diasAtraso = num(cliente.maxDaysOverdue);
  const dividaAtual = num(cliente.totalOverdueAmount);
  const faturas = cliente.overdueInvoicesCount === null || cliente.overdueInvoicesCount === undefined ? null : num(cliente.overdueInvoicesCount);
  const carteira = detalhe ? carteiraValida(detalhe.carteira) : carteiraDoStatusErp(cliente.status);
  const cls = classificarCliente({ contractStartDate: cliente.contractStartDate, diasAtraso, faturasAbertas: faturas ?? (dividaAtual > 0 ? 1 : 0) }, hoje);
  const regua = reguaParaHoje(diasAtraso, carteira, etapas);
  const situacao = cliente.status === "active" ? "ativo" : cliente.status === "suspended" ? "suspenso" : cliente.status === "cancelled" ? "cancelado" : cliente.status ?? "desconhecido";

  // A ultima promessa registrada no caso vivo, se ainda esta no futuro (ou hoje).
  let promessaAberta: CasoParaAgente["promessaAberta"] = null;
  if (detalhe) {
    const eventos = await storage.listarEventosDoCaso(providerId, detalhe.id);
    const promessa = eventos.filter(e => e.tipo === "promessa").sort((a, b) => new Date(b.ocorridoEm).getTime() - new Date(a.ocorridoEm).getTime())[0];
    if (promessa) {
      const meta = (promessa.metadata ?? {}) as Record<string, unknown>;
      const data = typeof meta.dataPrometida === "string" ? meta.dataPrometida : null;
      const vencida = data ? new Date(`${data}T23:59:59`).getTime() < hoje.getTime() : false;
      if (!vencida) promessaAberta = { data, valor: typeof meta.valor === "number" ? meta.valor : null, registradaEm: new Date(promessa.ocorridoEm).toISOString() };
    }
  }

  const politicaResumo = {
    descontoMaxPct: politica.negociacao.descontoMaxPct,
    maxParcelas: politica.negociacao.maxParcelas,
    entradaMinimaPct: politica.negociacao.entradaMinimaPct,
    saldoMinimoParcelar: politica.negociacao.saldoMinimoParcelar,
    multaPct: politica.encargos.multaPct,
    jurosMesPct: politica.encargos.jurosMesPct,
  };
  const tom = { quadrante: cls.dna?.quadrante ?? null, tom: cls.tom, diretiva: cls.tom ? DIRETIVA_POR_TOM[cls.tom] : null };

  /*
   * O VALOR AQUI NUNCA E LEITURA DE AGORA — e diz isso ao agente.
   *
   * `cliente.totalOverdueAmount` e o que a ultima varredura do ERP gravou (a
   * automatica roda seg/qua/sex as 03:00). A revisao de 06/09/2026 achou este
   * caminho como a porta lateral do mesmo defeito que fechamos na autonomia:
   * a instrucao dizia "Divida vencida de R$ X" como fato do momento, e quem
   * pagou depois da varredura seria cobrado por WhatsApp. Esta rota nao tem
   * consulta ao vivo (o agente do fork pergunta por telefone, sem o ERP na
   * mao), entao a saida honesta e datar o valor e mandar transferir a duvida.
   */
  const lidoEm = cliente.lastSyncAt ? new Date(cliente.lastSyncAt) : null;
  const dataDaLeitura = lidoEm && Number.isFinite(lidoEm.getTime())
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(lidoEm)
    : null;
  const origemDoValor = dataDaLeitura
    ? `segundo a ultima leitura do ERP em ${dataDaLeitura}`
    : "segundo a ultima leitura do ERP (sem data registrada)";

  /*
   * O QUE O AGENTE PODE OFERECER — da politica de acordo DA CARTEIRA DESTE
   * CASO, nunca do envelope geral. `ofertasDaPolitica` e pura e ja devolve as
   * ofertas concretas que o servidor autorizaria; a instrucao so as traduz em
   * portugues. Nao ha divida a negociar (quitado ou prescrito) => `null`.
   */
  const negociavel = dividaAtual > 0 && !prescrita(diasAtraso);
  const ofertas = negociavel
    ? ofertasDaPolitica(
        { saldo: dividaAtual, diasAtraso, carteira: carteiraDoAcordo(carteira), hoje: dataLocal(hoje) },
        { acordo: acordoDaPolitica(politica), negociacao: politica.negociacao },
      )
    : null;
  const acordo: CasoParaAgente["acordo"] = ofertas
    ? {
        origemDaCobranca: ofertas.origemDaCobranca,
        motivo: ofertas.motivo,
        faixa: ofertas.faixa
          ? { rotulo: rotuloDaFaixa(ofertas.faixa), descontoMaxPct: ofertas.faixa.descontoMaxPct, maxParcelas: ofertas.faixa.maxParcelas, entradaMinimaPct: ofertas.faixa.entradaMinimaPct }
          : null,
        ofertas: ofertas.ofertas,
        vencimentoMaximo: ofertas.vencimentoMaximo,
      }
    : null;

  const partes: string[] = [];
  if (dividaAtual <= 0) partes.push("O cliente NAO tem divida vencida: nao cobre; agradeca e, se ele pedir algo, transfira ao atendente.");
  else if (prescrita(diasAtraso)) partes.push("A divida esta PRESCRITA (mais de cinco anos): nao cobre nem negocie; transfira ao atendente.");
  else {
    partes.push(`Divida vencida de ${brl(dividaAtual)} ha ${diasAtraso} dia${diasAtraso === 1 ? "" : "s"}${faturas !== null ? ` em ${faturas} fatura${faturas === 1 ? "" : "s"}` : ""}, ${origemDoValor}.`);
    partes.push("Esse valor pode ter mudado desde entao: se o cliente disser que ja pagou, ou questionar o valor, NAO insista e NAO repita o numero — transfira ao atendente.");
    if (regua.etapa) partes.push(`Etapa da regua "${regua.etapa.rotulo}": ${regua.etapa.acao}`);
    if (tom.diretiva) partes.push(`Tom: ${tom.diretiva}`);
    if (ofertas) partes.push(frasesDoAcordo(ofertas, dividaAtual));
    if (promessaAberta) partes.push(`Ja existe promessa de pagamento para ${promessaAberta.data ?? "data combinada"}: nao registre outra; so lembre com cordialidade.`);
    partes.push("Quando o cliente confirmar data e valor, registre a promessa. Nunca invente valor, boleto ou link.");
  }

  return {
    ok: true,
    encontrado: true,
    cliente: { primeiroNome: primeiroNome(cliente.name), nome: cliente.name, cidade: cliente.city ?? null, situacaoContrato: situacao, clienteHaMeses: cls.mesesComoCliente },
    caso: detalhe
      ? {
          id: detalhe.id,
          status: detalhe.status,
          carteira: detalhe.carteira,
          valorEmAberto: detalhe.valorAtual,
          valorAtualizado: detalhe.valorAtual,
          diasAtraso,
          faturasVencidas: faturas,
          etapa: regua.etapa ? { rotulo: regua.etapa.rotulo, janela: janelaDaEtapa(regua.etapa), acao: regua.etapa.acao, canalSugerido: ROTULO_CANAL[regua.etapa.canalSugerido] } : null,
          prescrita: prescrita(diasAtraso),
          responsavel: detalhe.responsavelNome,
        }
      : null,
    // De onde vem o valor acima e quando ele foi lido. Nunca e leitura de agora:
    // esta rota nao consulta o ERP ao vivo (ver a nota junto de `origemDoValor`).
    valores: { origem: "base_sincronizada" as const, lidoEm: lidoEm && Number.isFinite(lidoEm.getTime()) ? lidoEm.toISOString() : null },
    tom,
    /*
     * O TETO GERAL SO SAI QUANDO NAO HA ACORDO A OFERECER.
     *
     * A revisao de 06/09/2026 fechou a frase que mandava o agente oferecer
     * 20% e 6x ignorando a faixa da carteira, mas o mesmo numero continuava
     * viajando neste campo, dentro do JSON que o modelo le — e numero no
     * payload e numero que ele pode repetir ao cliente. Quando `acordo`
     * responde (sempre que ha divida a negociar), o teto legal nao vai junto:
     * o que se pode oferecer esta em `acordo.ofertas`, e so.
     */
    politica: acordo ? null : politicaResumo,
    acordo,
    promessaAberta,
    instrucao: partes.join(" "),
  };
}

/* ── O que o agente grava ──────────────────────────────────────────────── */

export interface PromessaDoAgente {
  telefone: string;
  dataPrometida: string;
  valor: number | null;
  observacao: string | null;
  conversaId: string | null;
}

export type RespostaDoAgente = { ok: true; mensagem: string; promessaId?: number } | { ok: false; encontrado: false; mensagem: string };

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A promessa vira evento `promessa` no caso vivo do cliente, e o proximo
 * contato do caso passa a ser a data prometida — e assim que ela entra na
 * fila do funcionario. Sem caso vivo, nao ha onde gravar: resposta honesta.
 */
export async function registrarPromessaDoAgente(providerId: number, p: PromessaDoAgente): Promise<RespostaDoAgente> {
  const fone = normalizarTelefoneParaChat(p.telefone);
  const cliente = fone ? await storage.getCustomerByPhoneDigits(providerId, fone) : undefined;
  if (!cliente) return { ok: false, encontrado: false, mensagem: "Cliente nao encontrado pelo telefone; a promessa nao foi registrada." };
  const caso = await storage.casoAbertoDoCliente(providerId, cliente.id);
  if (!caso) return { ok: false, encontrado: false, mensagem: "O cliente nao tem caso de cobranca aberto; a promessa nao foi registrada. Transfira ao atendente." };
  if (!DATA_ISO.test(p.dataPrometida)) return { ok: false, encontrado: false, mensagem: "Data invalida: use AAAA-MM-DD." };
  const data = new Date(`${p.dataPrometida}T12:00:00`);
  if (Number.isNaN(data.getTime())) return { ok: false, encontrado: false, mensagem: "Data invalida: use AAAA-MM-DD." };

  const valor = p.valor !== null && Number.isFinite(p.valor) && p.valor > 0 ? Math.round(p.valor * 100) / 100 : null;
  const evento = await storage.registrarEventoDeCobranca(providerId, {
    casoId: caso.id,
    userId: null,
    tipo: "promessa",
    canal: "whatsapp",
    resultado: "promessa_pagamento",
    notas: `Agente de IA: promessa para ${p.dataPrometida}${valor !== null ? ` de ${brl(valor)}` : ""}${p.observacao ? ` — ${p.observacao.slice(0, 200)}` : ""}`,
    metadata: { origem: "agente_chat", dataPrometida: p.dataPrometida, valor, observacao: p.observacao?.slice(0, 200) ?? null, conversaId: p.conversaId },
  });
  await storage.atualizarCasoDeCobranca(providerId, caso.id, { proximoContatoEm: data }, null).catch(err => {
    logger.warn({ err, providerId, casoId: caso.id }, "Agente do chat: promessa gravada, mas o proximo contato do caso nao foi atualizado");
  });
  logger.info({ providerId, casoId: caso.id, dataPrometida: p.dataPrometida }, "Agente do chat: promessa registrada");
  return { ok: true, mensagem: `Promessa registrada para ${p.dataPrometida}. O funcionario vera na fila nesse dia.`, promessaId: evento.id };
}

/** O agente passou a bola: fica na linha do tempo do caso com o motivo, para o funcionario ler antes de assumir. */
export async function registrarTransferenciaDoAgente(providerId: number, t: { telefone: string; motivo: string | null; resumo: string | null; conversaId: string | null }): Promise<RespostaDoAgente> {
  const fone = normalizarTelefoneParaChat(t.telefone);
  const cliente = fone ? await storage.getCustomerByPhoneDigits(providerId, fone) : undefined;
  const caso = cliente ? await storage.casoAbertoDoCliente(providerId, cliente.id) : undefined;
  if (!caso) return { ok: false, encontrado: false, mensagem: "Sem caso aberto para este telefone; a transferencia foi registrada so no chat." };
  await storage.registrarEventoDeCobranca(providerId, {
    casoId: caso.id,
    userId: null,
    tipo: "nota",
    canal: "whatsapp",
    resultado: null,
    notas: `Agente de IA transferiu ao atendente${t.motivo ? `: ${t.motivo.slice(0, 300)}` : ""}${t.resumo ? ` — ${t.resumo.slice(0, 500)}` : ""}`,
    metadata: { origem: "agente_chat", transferencia: true, conversaId: t.conversaId },
  });
  return { ok: true, mensagem: "Transferencia registrada no caso." };
}
