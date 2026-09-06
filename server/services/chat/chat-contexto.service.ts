import { storage } from "../../storage";
import { buildConnectorConfig, getConnector } from "../../erp";
import { snapshotAoVivoDoCliente } from "../cobranca/snapshot-ao-vivo.service";
import { ErroDaPonteDoChat } from "./chat-ponte.service";
import {
  normalizarPagamento,
  type PagamentoDoChat,
} from "@shared/cobranca/pagamento-chat";
import type { ContextoDoChat } from "@shared/cobranca/contexto-chat";

async function clienteDaConversa(providerId: number, conversationId: string) {
  const conversa = await storage.getConversaDoChat(providerId, conversationId);
  if (!conversa)
    throw new ErroDaPonteDoChat(
      "CASO_NAO_ENCONTRADO",
      "Conversa não encontrada neste provedor",
    );
  const cliente = await storage.clienteDoAtendimento(
    providerId,
    conversa.customerId,
  );
  if (!cliente)
    throw new ErroDaPonteDoChat(
      "CASO_NAO_ENCONTRADO",
      "Cliente não encontrado neste provedor",
    );
  return cliente;
}
const numero = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v))
    ? null
    : Number(v);

/** O que a coluna nasce com: `isp_score` DEFAULT 100 e `risk_tier` DEFAULT 'low'. */
const ISP_SCORE_DEFAULT = 100;
const RISK_TIER_DEFAULT = "low";

/**
 * `customers.isp_score` como SCORE, ou null quando é só o default da coluna.
 *
 * Mesma regra de `ispScoreReal` (server/routes/cobranca.routes.ts), e pelo
 * mesmo motivo: ninguém calcula o score do cliente da base — o motor roda na
 * CONSULTA e grava em `isp_consultations`. O par (100, 'low') é a assinatura
 * do default, contraditório como resultado (na escala 0–1000, 100 é crítico,
 * não 'low'). Sem cálculo: null nos dois, e a ficha mostra traço.
 *
 * A regra vive aqui em vez de ser importada da rota da cobrança porque aquele
 * módulo é um router inteiro; a duplicação é de cinco linhas e está travada
 * por teste nos dois lados.
 */
function scoreIspReal(
  score: unknown,
  risco: string | null,
): { ispScore: number | null; risco: string | null } {
  const n = numero(score);
  if (n === null) return { ispScore: null, risco: risco ?? null };
  if (n === ISP_SCORE_DEFAULT && (risco ?? RISK_TIER_DEFAULT) === RISK_TIER_DEFAULT)
    return { ispScore: null, risco: null };
  return { ispScore: n, risco: risco ?? null };
}

/** Dia de calendário do ERP. AAAA-MM-DD ordena em texto igual ao que ordena no tempo. */
const DIA_DE_CALENDARIO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Da mais antiga para a mais nova. Nenhum conector promete ordem, e a ficha
 * afirma "as 50 mais antigas" — sem ordenar aqui, a frase seria um palpite.
 * O que não é data legível não tem lugar na linha do tempo: vai para o fim e
 * é contado, nunca chutado para o começo.
 */
const porVencimento = (a: { vencimento: string }, b: { vencimento: string }) => {
  const ilegivel = (v: string) => (DIA_DE_CALENDARIO.test(v) ? 0 : 1);
  return (
    ilegivel(a.vencimento) - ilegivel(b.vencimento) ||
    a.vencimento.localeCompare(b.vencimento)
  );
};

/**
 * Todo texto que exibe valor da BASE diz de quando ele é. Sem a data, "a base
 * sincronizada" é uma origem sem idade — e um saldo de três dias atrás lido como
 * se fosse de agora é exatamente o erro que a regra da integridade proíbe.
 * Sem `last_sync_at` não inventamos data: o texto sai sem o sufixo.
 */
function sufixoDaVarredura(sincronizadoEm: Date | null | undefined): string {
  if (!sincronizadoEm || !Number.isFinite(sincronizadoEm.getTime())) return "";
  return ` (varredura de ${sincronizadoEm.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })})`;
}

/** Independente do transporte: a ficha continua disponível se o BullQ não responder. */
export async function contextoDoAtendimento(
  providerId: number,
  conversationId: string,
  atualizar = false,
): Promise<ContextoDoChat> {
  const c = await clienteDaConversa(providerId, conversationId);
  const [base, snapshot] = await Promise.all([
    storage.contextoFinanceiroDoChat(providerId, c.id),
    snapshotAoVivoDoCliente(providerId, c.documento, { forcar: atualizar }),
  ]);
  const vivo = snapshot.ok ? snapshot.cliente : null;
  const financeiroCompleto =
    vivo?.faturas !== undefined && !snapshot.leituraParcial;
  const fonte = snapshot.erpSource;
  const conector = fonte ? getConnector(fonte) : null;
  const faturas = financeiroCompleto
    ? // Cópia antes de ordenar: o snapshot pode vir do cache e é lido por outros.
      [...vivo.faturas!]
        .sort(porVencimento)
        .slice(0, 50)
        .map((f) => ({
          ref: f.ref,
          fonte,
          valor: f.valor,
          vencimento: f.vencimento,
          descricao: f.descricao ?? null,
          consultavel: !!conector?.fetchSegundaVia || !!f.pagamento,
          pagamento: f.pagamento ? normalizarPagamento(f.pagamento) : null,
        }))
    : // A base já sai do storage ordenada por `due_date`, e a data é sempre legível.
      base.faturas.map((f) => ({
        ref: f.ref ?? `local-${f.id}`,
        fonte: f.fonte,
        valor: Number(f.valor),
        vencimento: f.vencimento.toISOString().slice(0, 10),
        descricao: f.descricao,
        consultavel:
          !!f.ref && f.fonte === fonte && !!conector?.fetchSegundaVia,
        pagamento: null,
      }));
  return {
    cliente: {
      id: c.id,
      nome: c.nome,
      documento: c.documento,
      telefone: vivo?.telefone ?? c.telefone,
      email: vivo?.email ?? c.email,
      endereco:
        [c.endereco, c.numero].filter(Boolean).join(", ") +
          (c.complemento ? ` · ${c.complemento}` : "") || null,
      bairro: c.bairro,
      cidade: c.cidade,
      uf: c.uf,
      cep: c.cep,
      statusContrato: vivo?.statusContrato ?? c.statusContrato,
      clienteDesde: vivo?.contractStartDate ?? c.clienteDesde,
      plano: vivo?.plano ?? base.contrato?.plano ?? null,
      mensalidade:
        base.contrato && (!vivo?.plano || vivo.plano === base.contrato.plano)
          ? numero(base.contrato.mensalidade)
          : null,
      ...scoreIspReal(c.credito, c.risco),
      // Sem leitura do ERP e sem valor na base, o campo é NULO: zero seria a
      // afirmação "não deve nada", que ninguém mediu.
      divida:
        vivo && financeiroCompleto ? vivo.dividaAtual : numero(c.divida),
      diasAtraso:
        vivo && financeiroCompleto ? vivo.diasAtraso : numero(c.diasAtraso),
      sincronizadoEm: c.sincronizadoEm?.toISOString() ?? null,
    },
    pagamentos: {
      pagas: base.pagamentos.pagas,
      comData: base.pagamentos.comData,
      pontualidade: base.pagamentos.comData
        ? Math.round((100 * base.pagamentos.pontuais) / base.pagamentos.comData)
        : null,
    },
    faturas,
    temMaisFaturas: financeiroCompleto
      ? vivo.faturas!.length > 50
      : base.temMaisFaturas,
    faturasSemData: faturas.filter((f) => !DIA_DE_CALENDARIO.test(f.vencimento))
      .length,
    conexoes: vivo?.autenticacoes ?? [],
    ordens: base.ordens.map((o) => ({
      ...o,
      agendadoEm: o.agendadoEm?.toISOString() ?? null,
    })),
    erp: {
      fonte,
      atualizadoEm: snapshot.lidoEm,
      status: !vivo
        ? "indisponivel"
        : snapshot.leituraParcial
          ? "parcial"
          : "disponivel",
      mensagem: !vivo
        ? `ERP indisponível. Exibindo o último cadastro sincronizado${sufixoDaVarredura(c.sincronizadoEm)}.`
        : snapshot.leituraParcial
          ? `Leitura parcial do ERP. Valores da base sincronizada${sufixoDaVarredura(c.sincronizadoEm)} mantidos para conferência.`
          : !financeiroCompleto
            ? `Faturas detalhadas não disponíveis no ERP. Valores financeiros da base sincronizada${sufixoDaVarredura(c.sincronizadoEm)}.`
            : null,
      // O valor exibido é do ERP de agora, ou da varredura. `status: "disponivel"`
      // não separa os dois: o ERP responde e mesmo assim devolve zero fatura
      // quando o cliente pagou tudo. Quem for falar um número lê ISTO.
      financeiroAoVivo: financeiroCompleto,
      valoresDe: financeiroCompleto ? "ao_vivo" : "base_sincronizada",
      lidoEm: financeiroCompleto
        ? snapshot.lidoEm
        : (c.sincronizadoEm?.toISOString() ?? null),
    },
  };
}

/** Ref deve pertencer às faturas abertas lidas AGORA no ERP do cliente vinculado. */
export async function segundaViaDoAtendimento(
  providerId: number,
  conversationId: string,
  ref: string,
): Promise<PagamentoDoChat> {
  const c = await clienteDaConversa(providerId, conversationId);
  const snapshot = await snapshotAoVivoDoCliente(providerId, c.documento, {
    forcar: true,
  });
  if (!snapshot.ok || !snapshot.cliente || snapshot.leituraParcial)
    throw new ErroDaPonteDoChat(
      "CHAT_FALHOU",
      "Não foi possível conferir as faturas no ERP. Tente atualizar os dados do cliente.",
    );
  const fatura = snapshot.cliente.faturas?.find((f) => f.ref === ref);
  if (!fatura)
    throw new ErroDaPonteDoChat(
      "CASO_NAO_ENCONTRADO",
      "Esta fatura não está entre as pendências atuais deste cliente",
    );
  let instrumento = fatura.pagamento
    ? normalizarPagamento(fatura.pagamento)
    : null;
  if (!instrumento?.link && !instrumento?.pix && !instrumento?.linhaDigitavel) {
    const integracao = (await storage.getErpIntegrations(providerId)).find(
      (i) => i.isEnabled && i.erpSource === snapshot.erpSource,
    );
    const conector = integracao ? getConnector(integracao.erpSource) : null;
    if (!integracao || !conector?.fetchSegundaVia)
      throw new ErroDaPonteDoChat(
        "CONFLITO",
        "Este ERP não disponibilizou uma segunda via para o chat",
      );
    const config = buildConnectorConfig(integracao);
    config.extra = { ...config.extra, providerId: String(providerId) };
    try {
      instrumento = await conector.fetchSegundaVia(
        config,
        c.documento,
        fatura.ref,
      );
    } catch {
      throw new ErroDaPonteDoChat(
        "CHAT_FALHOU",
        "O ERP não confirmou a segunda via. Confira as permissões da integração e a situação da fatura.",
      );
    }
  }
  if (
    !instrumento ||
    (!instrumento.link && !instrumento.pix && !instrumento.linhaDigitavel)
  )
    throw new ErroDaPonteDoChat(
      "CONFLITO",
      "A fatura não possui PIX, boleto ou linha digitável disponível no ERP",
    );
  return normalizarPagamento({
    ...instrumento,
    valor: instrumento.valor ?? fatura.valor,
    vencimento: instrumento.vencimento ?? fatura.vencimento,
  });
}
