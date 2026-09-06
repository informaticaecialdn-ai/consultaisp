/**
 * A PORTA do agente de IA do Chat BullQ no Consulta ISP.
 *
 * O agente de cobranca do provedor (um AiAgent WORKER na organizacao dele no
 * Chat BullQ) chama o Consulta ISP por skills HTTP quando conversa com o
 * cliente no WhatsApp: consulta o caso pelo telefone antes de falar de valor,
 * registra a promessa de pagamento que o cliente fez, e avisa quando passou
 * a bola ao atendente. Nada disso e decidido pelo agente: ele le o que a
 * regua e a politica do provedor ja decidiram (tom do DNA, teto de desconto,
 * maximo de parcelas) e fala dentro disso.
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
import { DIRETIVA_POR_TOM, janelaDaEtapa, pct, prescrita, ROTULO_CANAL } from "@shared/cobranca";
import { normalizarTelefoneParaChat } from "./chat-bullq.client";

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v) || 0);
const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

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
  politica: { descontoMaxPct: number; maxParcelas: number; entradaMinimaPct: number; saldoMinimoParcelar: number; multaPct: number; jurosMesPct: number } | null;
  promessaAberta: { data: string | null; valor: number | null; registradaEm: string } | null;
  /** De onde vem o valor em aberto e quando foi lido — aqui e sempre a varredura, nunca o ERP ao vivo. */
  valores?: { origem: "base_sincronizada"; lidoEm: string | null };
  /** O que o agente deve fazer, em uma frase — montado do DNA, da etapa e da politica. */
  instrucao: string;
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || "cliente";
}

/**
 * Le o caso do cliente pelo telefone. Sem cliente, sem caso ou sem divida, a
 * resposta e honesta (`encontrado: false`, ou caso nulo com a instrucao de
 * nao cobrar) — o agente nao inventa valor.
 */
export async function casoParaAgente(providerId: number, telefone: string | null | undefined): Promise<CasoParaAgente> {
  const fone = normalizarTelefoneParaChat(telefone);
  const semNada: CasoParaAgente = { ok: true, encontrado: false, cliente: null, caso: null, tom: null, politica: null, promessaAberta: null, instrucao: "Cliente nao encontrado pelo telefone. Nao cobre nada: pergunte se ele usa outro numero no cadastro e, se preciso, transfira ao atendente." };
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

  const partes: string[] = [];
  if (dividaAtual <= 0) partes.push("O cliente NAO tem divida vencida: nao cobre; agradeca e, se ele pedir algo, transfira ao atendente.");
  else if (prescrita(diasAtraso)) partes.push("A divida esta PRESCRITA (mais de cinco anos): nao cobre nem negocie; transfira ao atendente.");
  else {
    partes.push(`Divida vencida de ${brl(dividaAtual)} ha ${diasAtraso} dia${diasAtraso === 1 ? "" : "s"}${faturas !== null ? ` em ${faturas} fatura${faturas === 1 ? "" : "s"}` : ""}, ${origemDoValor}.`);
    partes.push("Esse valor pode ter mudado desde entao: se o cliente disser que ja pagou, ou questionar o valor, NAO insista e NAO repita o numero — transfira ao atendente.");
    if (regua.etapa) partes.push(`Etapa da regua "${regua.etapa.rotulo}": ${regua.etapa.acao}`);
    if (tom.diretiva) partes.push(`Tom: ${tom.diretiva}`);
    partes.push(`Pode oferecer ate ${pct(politicaResumo.descontoMaxPct)} de desconto e ate ${politicaResumo.maxParcelas}x${politicaResumo.entradaMinimaPct > 0 ? ` com entrada minima de ${pct(politicaResumo.entradaMinimaPct)}` : ""}; abaixo de ${brl(politicaResumo.saldoMinimoParcelar)} so a vista. Fora disso, transfira ao atendente.`);
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
    politica: politicaResumo,
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
