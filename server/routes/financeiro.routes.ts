import { Router } from "express";
import { requireSuperAdmin } from "../auth";
import { storage } from "../storage";
import { PLAN_PRICES, PLAN_CREDITS } from "@shared/schema";
import { logger } from "../logger";
import { getAsaasWebhookToken } from "../env";
import { getSafeErrorMessage } from "../utils/safe-error";
import { sendFaturaGeradaEmail, sendFaturaPagaEmail } from "../services/email";
import { creditarPlanoDaFatura } from "../services/credito-do-plano";
import { avisarProvedor, type ProvedorParaEmail } from "../services/email-destinatario";
import { ROTULO_DO_PLANO } from "../services/precos.service";
// O aviso de credito liberado nasce em `credits.routes.ts` porque e la que
// moram os outros dois caminhos de liberacao. Aqui esta o terceiro — o webhook —
// e ele usa a MESMA funcao de proposito: duas copias da regra sao duas chances
// de o provedor receber o aviso duas vezes pelo mesmo pagamento.
import { avisarCreditosLiberados } from "./credits.routes";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * "2026-09" vira "setembro de 2026".
 *
 * A competencia e gravada no formato do banco (AAAA-MM), que serve para ordenar
 * e para a tela do superadmin. No e-mail ela e a primeira coisa que o provedor
 * le — esta no assunto e no titulo — e "Fatura de 2026-09" nao e portugues.
 *
 * Formato inesperado volta como veio: e melhor o provedor ler a competencia crua
 * do que ler "Invalid Date" ou "undefined de NaN".
 */
export function competenciaPorExtenso(period: string): string {
  const casa = /^(\d{4})-(\d{2})$/.exec((period || "").trim());
  if (!casa) return period;
  const mes = MESES[Number(casa[2]) - 1];
  return mes ? `${mes} de ${casa[1]}` : period;
}

/**
 * Vencimento como o provedor le: dd/mm/aaaa.
 *
 * Getters locais, e nao UTC, de proposito: e assim que a data foi construida na
 * geracao mensal (`new Date(ano, mes - 1, 10)`) e e assim que a tela do
 * superadmin a mostra (`toLocaleDateString("pt-BR")` em InvoiceTable). E-mail e
 * tela divergirem em um dia num vencimento e pior do que qualquer fuso.
 */
export function dataPorExtenso(valor: Date | string | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** O que o aviso de fatura gerada precisa saber da fatura. */
interface FaturaGerada {
  invoiceNumber: string;
  period: string;
  planAtTime: string;
  amount: string;
  dueDate: Date | string;
  asaasInvoiceUrl?: string | null;
}

/**
 * "Sua fatura foi emitida."
 *
 * `avisarProvedor` resolve destinatario, marca e endereco de entrada, e engole a
 * falha de envio com log — por isso nao ha try/catch aqui. A fatura ja existe
 * quando este aviso sai, e nenhuma falha dele pode desfaze-la.
 */
async function avisarFaturaGerada(provedor: ProvedorParaEmail, fatura: FaturaGerada): Promise<void> {
  await avisarProvedor(provedor, async (para, ctx) => {
    await sendFaturaGeradaEmail(para, ctx.nome, {
      numero: fatura.invoiceNumber,
      competencia: competenciaPorExtenso(fatura.period),
      // Plano fora do catalogo sai com a propria chave em vez de vazio: o
      // provedor precisa saber o que esta sendo cobrado, mesmo num plano legado.
      plano: ROTULO_DO_PLANO[fatura.planAtTime] || fatura.planAtTime,
      valor: parseFloat(fatura.amount),
      vencimento: dataPorExtenso(fatura.dueDate),
      // So existe quando a cobranca Asaas ja foi criada; sem ela o e-mail cai
      // sozinho no botao "ver a fatura no painel".
      linkDePagamento: fatura.asaasInvoiceUrl ?? null,
    }, ctx.marca, ctx.urlBase);
  }, "fatura-gerada");
}

/**
 * O que acontece quando uma fatura passa a paga: os creditos do plano entram
 * no saldo e o provedor e avisado.
 *
 * Os dois na mesma funcao de proposito. Sao o mesmo evento — "a fatura do mes
 * foi paga" — e separa-los convidaria a chamar so um dos dois num dos tres
 * caminhos que quitam fatura (webhook do Asaas, sincronizacao do superadmin e
 * PATCH manual de status).
 *
 * CHAME SOMENTE DENTRO DA TRANSICAO de nao-paga para paga. E `jaEstavaPaga`,
 * nos tres caminhos, que impede a reentrega do webhook de creditar duas vezes
 * a mesma fatura de 30 creditos.
 */
async function quitarFatura(
  provedor: ProvedorParaEmail,
  fatura: { invoiceNumber: string; period: string; ispCreditsIncluded?: number | null; spcCreditsIncluded?: number | null; id?: number; planAtTime?: string | null },
  valorPago: number,
): Promise<void> {
  // Primeiro o credito: e o que o provedor comprou. O aviso vem depois e nao
  // pode atrasar a entrega — se o e-mail falhar, o saldo ja subiu.
  await creditarPlanoDaFatura({
    id: fatura.id ?? 0,
    providerId: provedor.id,
    invoiceNumber: fatura.invoiceNumber,
    planAtTime: fatura.planAtTime,
    ispCreditsIncluded: fatura.ispCreditsIncluded,
    spcCreditsIncluded: fatura.spcCreditsIncluded,
  });

  await avisarProvedor(provedor, async (para, ctx) => {
    await sendFaturaPagaEmail(para, ctx.nome, {
      numero: fatura.invoiceNumber,
      competencia: competenciaPorExtenso(fatura.period),
      valor: valorPago,
    }, ctx.marca, ctx.urlBase);
  }, "fatura-paga");
}

/**
 * O provedor dono da fatura, para o aviso.
 *
 * A leitura acontece DEPOIS que o efeito financeiro ja esta gravado, entao ela
 * nao pode virar 500 na tela nem 500 no webhook (que faria o Asaas reentregar um
 * evento ja processado). Sem provedor, nao ha a quem avisar — e so isso.
 */
async function provedorParaAviso(providerId: number, rotulo: string): Promise<ProvedorParaEmail | undefined> {
  try {
    const provedor = await storage.getProvider(providerId);
    if (!provedor) logger.warn({ providerId, rotulo }, "[email] Provedor da fatura nao encontrado: aviso nao enviado");
    return provedor;
  } catch (err: any) {
    logger.error({ providerId, rotulo, err: err?.message }, "[email] Provedor da fatura nao lido: aviso nao enviado");
    return undefined;
  }
}

/**
 * Quanto entrou. `paidAmount` e o que o superadmin digitou e pode vir vazio,
 * zerado ou nao numerico; nesses casos vale o valor da fatura. O e-mail nunca
 * deve mostrar "R$ NaN".
 */
function valorRecebido(paidAmount: unknown, amount: string): number {
  const informado = Number(paidAmount);
  return Number.isFinite(informado) && informado > 0 ? informado : parseFloat(amount);
}

export function registerFinanceiroRoutes(): Router {
  const router = Router();

  router.get("/api/admin/asaas/status", requireSuperAdmin, async (_req, res) => {
    try {
      const { isAsaasConfigured, getAsaasMode, getBalance } = await import("../services/asaas");
      const configured = isAsaasConfigured();
      const mode = getAsaasMode();
      let balance = null;
      if (configured) {
        try { balance = await getBalance(); } catch {}
      }
      return res.json({ configured, mode, balance });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/invoices/:id/asaas/charge", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { billingType = "UNDEFINED" } = req.body;
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (invoice.asaasChargeId) return res.status(409).json({ message: "Cobranca Asaas ja existe para esta fatura" });

      const { findOrCreateCustomer, createCharge } = await import("../services/asaas");

      const provider = await storage.getProvider(invoice.providerId);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });

      const providerUsers = await storage.getUsersByProvider(invoice.providerId);
      const adminUser = providerUsers.find(u => u.role === "admin") || providerUsers[0];

      const customer = await findOrCreateCustomer({
        name: provider.name,
        cpfCnpj: provider.cnpj,
        email: provider.contactEmail || adminUser?.email,
        phone: provider.contactPhone || undefined,
      });

      const dueDate = new Date(invoice.dueDate).toISOString().split("T")[0];
      const charge = await createCharge({
        customerId: customer.id,
        value: parseFloat(invoice.amount),
        dueDate,
        description: `${invoice.invoiceNumber} - Plano ${invoice.planAtTime} - Periodo ${invoice.period}`,
        externalReference: `invoice_${invoice.id}`,
        billingType: billingType as any,
      });

      const updated = await storage.updateProviderInvoiceAsaas(id, {
        asaasChargeId: charge.id,
        asaasCustomerId: customer.id,
        asaasStatus: charge.status,
        asaasInvoiceUrl: charge.invoiceUrl,
        asaasBankSlipUrl: charge.bankSlipUrl,
        asaasBillingType: charge.billingType,
      });

      return res.json({ invoice: updated, charge });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/invoices/:id/asaas/sync", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (!invoice.asaasChargeId) return res.status(400).json({ message: "Fatura sem cobranca Asaas" });

      const { getCharge, asaasStatusToLocal } = await import("../services/asaas");
      const { conferirPagamento, anotarRecusa } = await import("../services/asaas-conferencia");
      const charge = await getCharge(invoice.asaasChargeId);
      const newStatus = asaasStatusToLocal(charge.status);

      const updateData: any = {
        asaasStatus: charge.status,
        asaasInvoiceUrl: charge.invoiceUrl || invoice.asaasInvoiceUrl,
        asaasBankSlipUrl: charge.bankSlipUrl || invoice.asaasBankSlipUrl,
      };
      // Foto de antes, para o aviso la embaixo: mesmo criterio que a trava do
      // `else if` usa para preservar fatura ja paga.
      const jaEstavaPaga = invoice.status === "paid" || !!invoice.paidDate;
      let conferenciaValorPago = 0;

      if (newStatus === "paid") {
        // O status cru da cobranca nao prova que ela e desta fatura nem que
        // cobre o valor devido. Sem esta conferencia, um boleto pago a menor
        // que o webhook recusou virava fatura quitada por um clique em
        // "sincronizar" — a tela mostra pendente e o superadmin fecha a mao.
        const conferencia = await conferirPagamento(
          { id: invoice.asaasChargeId },
          {
            referencia: `invoice_${invoice.id}`,
            valorEsperado: parseFloat(invoice.amount),
            chargeIdGravado: invoice.asaasChargeId,
          },
        );
        if (!conferencia.ok) {
          logger.error({ invoiceId: id, fatura: invoice.invoiceNumber, motivo: conferencia.motivo },
            "Sincronizacao manual nao deu a fatura por paga");
          const notes = conferencia.indisponivel ? null : anotarRecusa(invoice.notes, conferencia.motivo);
          await storage.updateProviderInvoiceAsaas(id, { ...updateData, ...(notes ? { notes } : {}) });
          return res.status(conferencia.indisponivel ? 502 : 409).json({
            message: `Fatura nao foi marcada como paga: ${conferencia.motivo}`,
          });
        }
        updateData.status = "paid";
        updateData.paidDate = charge.paymentDate ? new Date(charge.paymentDate) : new Date();
        updateData.paidAmount = conferencia.valorPago.toFixed(2);
        conferenciaValorPago = conferencia.valorPago;
      } else if (invoice.status === "paid" || invoice.paidDate) {
        // Mesma trava do webhook: um status nao-pago (chargeback pedido,
        // OVERDUE antigo) so registra o lado do Asaas; a fatura ja paga
        // continua paga.
        logger.warn({ invoiceId: id, fatura: invoice.invoiceNumber, asaasStatus: charge.status },
          "Sincronizacao com status não-pago para fatura já paga: status local preservado");
      } else {
        updateData.status = newStatus;
      }

      const updated = await storage.updateProviderInvoiceAsaas(id, updateData);
      // Mesmo criterio do webhook: so avisa quem passou de nao-paga a paga
      // AGORA. Sincronizar duas vezes a mesma cobranca regrava "paid" sem
      // consequencia — e sem um segundo e-mail.
      if (updateData.status === "paid" && !jaEstavaPaga) {
        const provedor = await provedorParaAviso(invoice.providerId, "fatura-paga");
        if (provedor) await quitarFatura(provedor, invoice, conferenciaValorPago);
      }
      return res.json({ invoice: updated, charge });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/admin/invoices/:id/asaas/charge", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (!invoice.asaasChargeId) return res.status(400).json({ message: "Fatura sem cobranca Asaas" });

      const { cancelCharge } = await import("../services/asaas");
      await cancelCharge(invoice.asaasChargeId);
      const updated = await storage.updateProviderInvoiceAsaas(id, {
        asaasChargeId: undefined,
        asaasStatus: "DELETED",
        status: "cancelled",
      });
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/invoices/:id/asaas/pix", requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getProviderInvoice(id);
      if (!invoice || !invoice.asaasChargeId) return res.status(404).json({ message: "Cobranca Asaas nao encontrada" });

      const { getPixQrCode } = await import("../services/asaas");
      const pix = await getPixQrCode(invoice.asaasChargeId);
      return res.json(pix);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/asaas/webhook", async (req, res) => {
    try {
      const expectedToken = getAsaasWebhookToken();
      if (expectedToken) {
        const rawToken = req.headers["asaas-access-token"];
        const incomingToken = Array.isArray(rawToken) ? rawToken[0]?.trim() : rawToken?.trim();
        if (!incomingToken || incomingToken !== expectedToken) {
          logger.warn({ ip: req.ip, path: req.path }, "Webhook Asaas rejeitado: token inválido ou ausente");
          return res.status(401).json({ ok: true });
        }
      } else if (process.env.NODE_ENV === "production") {
        // validateEnv já derruba o boot sem o token; esta é a segunda tranca,
        // para o caso de a rota subir por outro caminho. Sem token em produção
        // a porta fica aberta para credito de graça — melhor 503.
        logger.error({ ip: req.ip }, "Webhook Asaas recusado: ASAAS_WEBHOOK_TOKEN ausente em produção");
        return res.status(503).json({ ok: false });
      } else {
        logger.warn("ASAAS_WEBHOOK_TOKEN não configurado — webhook sem proteção");
      }

      const { event, payment } = req.body ?? {};

      logger.info({ event, externalReference: payment?.externalReference }, "Webhook Asaas recebido");

      if (!payment?.externalReference || typeof payment.externalReference !== "string") return res.json({ ok: true });

      const { asaasStatusToLocal } = await import("../services/asaas");
      const { conferirPagamento, anotarRecusa, anotarObservacao } = await import("../services/asaas-conferencia");

      const creditOrderMatch = payment.externalReference.match(/^credit_order_(\d+)$/);
      if (creditOrderMatch) {
        const orderId = parseInt(creditOrderMatch[1]);
        const newStatus = asaasStatusToLocal(payment.status);
        const order = await storage.getCreditOrder(orderId);
        if (!order) {
          logger.warn({ orderId }, "Webhook Asaas para pedido inexistente");
          return res.json({ ok: true });
        }

        if (newStatus !== "paid") {
          // Pedido ja creditado nao volta a "pending". `asaasStatusToLocal`
          // devolve "pending" para tudo que nao esta no mapa dele
          // (CHARGEBACK_REQUESTED, AWAITING_RISK_ANALYSIS, DUNNING_REQUESTED),
          // e o botao "reenviar evento" do painel do Asaas reenvia PENDING e
          // OVERDUE antigos. Rebaixar aqui e o que reabria o pedido para um
          // segundo credito quando o PAYMENT_RECEIVED chegasse de novo.
          // O status do Asaas continua sendo registrado — o que nao muda e o
          // status LOCAL, que ja tem um pagamento consumado por tras.
          if (order.creditedAt) {
            logger.warn({ orderId, pedido: order.orderNumber, asaasStatus: payment.status },
              "Evento nao-pago para pedido ja creditado: status local preservado");
            await storage.updateCreditOrder(orderId, { asaasStatus: payment.status });
            return res.json({ ok: true });
          }
          await storage.updateCreditOrder(orderId, { asaasStatus: payment.status, status: newStatus });
          return res.json({ ok: true });
        }

        const conferencia = await conferirPagamento(payment, {
          referencia: `credit_order_${orderId}`,
          valorEsperado: parseFloat(order.amount),
          chargeIdGravado: order.asaasChargeId,
        });
        if (!conferencia.ok) {
          // Recusa sem prova: o Asaas nao respondeu. Responder 200 aqui era
          // perda de dinheiro — para o Asaas, 200 significa "entregue, nao
          // reenvie", e o PIX de R$ 500 pago no minuto em que a API caiu nunca
          // virava credito, porque ninguem reprocessa. 500 poe o evento de
          // volta na fila. Nada e anotado: a mensagem muda a cada tentativa
          // (timeout, 502, 503) e encheria as observacoes de ruido.
          if (conferencia.indisponivel) {
            logger.error({ orderId, pedido: order.orderNumber, motivo: conferencia.motivo },
              "Webhook Asaas sem resposta do Asaas — devolvendo 500 para reentregar");
            return res.status(500).json({ ok: false });
          }
          logger.error({ orderId, pedido: order.orderNumber, motivo: conferencia.motivo }, "Webhook Asaas não liberou crédito");
          const notes = anotarRecusa(order.notes, conferencia.motivo);
          if (notes) await storage.updateCreditOrder(orderId, { notes });
          return res.json({ ok: true });
        }

        const { pedido, liberadoAgora } = await storage.releaseCreditOrder(orderId);
        logger.info({ orderId, pedido: order.orderNumber, valorPago: conferencia.valorPago, liberadoAgora },
          liberadoAgora ? "Créditos liberados pelo webhook Asaas" : "Reentrega do webhook Asaas: pedido já estava liberado");
        if (conferencia.avisoIdDivergente && liberadoAgora) {
          logger.warn({ orderId, pedido: order.orderNumber, aviso: conferencia.avisoIdDivergente },
            "Pagamento veio de cobrança diferente da gravada no pedido");
          const notes = anotarObservacao(order.notes, `Asaas: ${conferencia.avisoIdDivergente}`);
          if (notes) await storage.updateCreditOrder(orderId, { notes });
        }
        // O provedor pagou um PIX e fechou a aba: sem este aviso, a unica forma
        // de saber que caiu e abrir o painel. `liberadoAgora` e a trava contra a
        // reentrega — o Asaas reenvia o mesmo PAYMENT_RECEIVED, e a segunda vez
        // nao credita nem avisa. Esperar o envio antes de responder e seguro: se
        // o Asaas desistir da resposta e reentregar, a reentrega nao avisa de novo.
        if (liberadoAgora) await avisarCreditosLiberados(pedido);
        return res.json({ ok: true });
      }

      const invoiceMatch = payment.externalReference.match(/^invoice_(\d+)$/);
      if (!invoiceMatch) return res.json({ ok: true });

      const invoiceId = parseInt(invoiceMatch[1]);
      const newStatus = asaasStatusToLocal(payment.status);
      const invoice = await storage.getProviderInvoice(invoiceId);
      if (!invoice) {
        logger.warn({ invoiceId }, "Webhook Asaas para fatura inexistente");
        return res.json({ ok: true });
      }

      if (newStatus !== "paid") {
        // Mesma trava do ramo de pedido: fatura ja paga nao volta a pendente.
        // `asaasStatusToLocal` devolve "pending" para todo status fora do mapa
        // (CHARGEBACK_REQUESTED, AWAITING_RISK_ANALYSIS), e o botao "reenviar
        // evento" do painel do Asaas reenvia PAYMENT_OVERDUE antigo. Sem isto,
        // uma fatura com `paidDate` preenchida reaparecia como vencida e o
        // provedor era cobrado de novo por algo que ja pagou. Estorno e
        // chargeback sao lancamento a parte, nao rebaixamento silencioso.
        if (invoice.status === "paid" || invoice.paidDate) {
          logger.warn({ invoiceId, fatura: invoice.invoiceNumber, asaasStatus: payment.status },
            "Evento não-pago para fatura já paga: status local preservado");
          await storage.updateProviderInvoiceAsaas(invoiceId, { asaasStatus: payment.status });
          return res.json({ ok: true });
        }
        await storage.updateProviderInvoiceAsaas(invoiceId, { asaasStatus: payment.status, status: newStatus });
        return res.json({ ok: true });
      }

      const conferencia = await conferirPagamento(payment, {
        referencia: `invoice_${invoiceId}`,
        valorEsperado: parseFloat(invoice.amount),
        chargeIdGravado: invoice.asaasChargeId,
      });
      if (!conferencia.ok) {
        // Ver o ramo do pedido: sem resposta do Asaas nao ha prova nenhuma, e
        // 200 encerraria a fila de reentrega sobre um pagamento que pode ser
        // real.
        if (conferencia.indisponivel) {
          logger.error({ invoiceId, fatura: invoice.invoiceNumber, motivo: conferencia.motivo },
            "Webhook Asaas sem resposta do Asaas — devolvendo 500 para reentregar");
          return res.status(500).json({ ok: false });
        }
        logger.error({ invoiceId, fatura: invoice.invoiceNumber, motivo: conferencia.motivo }, "Webhook Asaas não deu a fatura por paga");
        const notes = anotarRecusa(invoice.notes, conferencia.motivo);
        if (notes) await storage.updateProviderInvoiceAsaas(invoiceId, { notes });
        return res.json({ ok: true });
      }

      // Reentrega não é problema aqui: gravar "paid" de novo com os mesmos
      // valores não soma nada, ao contrário do crédito.
      //
      // O AVISO, porém, soma: sai uma vez por entrega. A foto de antes é o que
      // separa a primeira quitação da reentrega — e é o mesmo critério que a
      // trava logo acima usa para não rebaixar fatura já paga.
      const jaEstavaPaga = invoice.status === "paid" || !!invoice.paidDate;
      await storage.updateProviderInvoiceAsaas(invoiceId, {
        asaasStatus: payment.status,
        status: "paid",
        paidDate: payment.paymentDate ? new Date(payment.paymentDate) : new Date(),
        paidAmount: conferencia.valorPago.toFixed(2),
      });
      logger.info({ invoiceId, fatura: invoice.invoiceNumber, valorPago: conferencia.valorPago }, "Fatura marcada como paga pelo webhook Asaas");
      if (conferencia.avisoIdDivergente) {
        logger.warn({ invoiceId, fatura: invoice.invoiceNumber, aviso: conferencia.avisoIdDivergente },
          "Fatura paga por cobrança diferente da gravada");
        const notes = anotarObservacao(invoice.notes, `Asaas: ${conferencia.avisoIdDivergente}`);
        if (notes) await storage.updateProviderInvoiceAsaas(invoiceId, { notes });
      }
      if (!jaEstavaPaga) {
        const provedor = await provedorParaAviso(invoice.providerId, "fatura-paga");
        if (provedor) await quitarFatura(provedor, invoice, conferencia.valorPago);
      }
      return res.json({ ok: true });
    } catch (error: any) {
      // 200 aqui era perda de dinheiro silenciosa: o Asaas da o evento por
      // entregue e NAO reenvia. Uma queda de banco no meio de um
      // PAYMENT_RECEIVED legitimo deixava o provedor pago e sem credito, sem
      // retentativa e sem registro no pedido. Todo caminho ja tratado responde
      // 200 explicitamente acima; o que sobra aqui e falha inesperada, e a
      // resposta certa e 500, para a fila do Asaas reentregar.
      // Reentregar nao custa nada: a liberacao e travada por `credited_at`.
      logger.error({ err: error?.message }, "Webhook Asaas error — devolvendo 500 para o Asaas reentregar");
      return res.status(500).json({ ok: false });
    }
  });

  // ============ FINANCIAL INVOICE ROUTES ============

  router.get("/api/admin/financial/saas-metrics", requireSuperAdmin, async (_req, res) => {
    try {
      const metrics = await storage.getSaasMetrics();
      return res.json(metrics);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/financial/summary", requireSuperAdmin, async (_req, res) => {
    try {
      const summary = await storage.getFinancialSummary();
      return res.json(summary);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/invoices", requireSuperAdmin, async (req, res) => {
    try {
      const providerId = req.query.providerId ? parseInt(req.query.providerId as string) : undefined;
      const invoiceList = await storage.getAllProviderInvoices(providerId);
      return res.json(invoiceList);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/invoices/:id", requireSuperAdmin, async (req, res) => {
    try {
      const invoice = await storage.getProviderInvoice(parseInt(req.params.id));
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      return res.json(invoice);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/invoices", requireSuperAdmin, async (req, res) => {
    try {
      const { providerId, period, planAtTime, amount, ispCreditsIncluded, spcCreditsIncluded, dueDate, notes } = req.body;
      if (!providerId || !period || !planAtTime || !amount || !dueDate) {
        return res.status(400).json({ message: "Campos obrigatorios: providerId, period, planAtTime, amount, dueDate" });
      }
      const me = await storage.getUser(req.session.userId!);
      const invoiceNumber = await storage.getNextInvoiceNumber();
      const invoice = await storage.createProviderInvoice({
        invoiceNumber,
        providerId: parseInt(providerId),
        period,
        planAtTime,
        amount: amount.toString(),
        ispCreditsIncluded: ispCreditsIncluded || 0,
        spcCreditsIncluded: spcCreditsIncluded || 0,
        dueDate: new Date(dueDate),
        status: "pending",
        notes: notes || null,
        createdById: req.session.userId!,
        createdByName: me?.name || "Admin",
      });
      // A fatura ja esta gravada: o aviso vem depois e nao pode virar 500 na
      // tela do superadmin.
      const provedor = await provedorParaAviso(invoice.providerId, "fatura-gerada");
      if (provedor) await avisarFaturaGerada(provedor, invoice);
      return res.status(201).json(invoice);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/admin/invoices/:id/status", requireSuperAdmin, async (req, res) => {
    try {
      const { status, paidAmount } = req.body;
      if (!status) return res.status(400).json({ message: "Status e obrigatorio" });
      const id = parseInt(req.params.id);

      // Foto de antes. E ela que diz se foi ESTA chamada que quitou a fatura:
      // um segundo PATCH com "paid" — o superadmin clicando de novo, ou
      // corrigindo o valor pago — nao pode render um segundo aviso. Uma falha
      // na leitura nao derruba a alteracao de status: sem a foto nao se avisa,
      // e so.
      const antes = await storage.getProviderInvoice(id).catch((err: any) => {
        logger.warn({ invoiceId: id, err: err?.message },
          "[email] Fatura nao lida antes da mudanca de status: aviso de pagamento nao sera enviado");
        return undefined;
      });

      const paidDate = status === "paid" ? new Date() : undefined;
      const updated = await storage.updateProviderInvoiceStatus(
        id, status, paidDate, paidAmount?.toString()
      );

      if (status === "paid" && antes && !(antes.status === "paid" || antes.paidDate)) {
        const provedor = await provedorParaAviso(antes.providerId, "fatura-paga");
        if (provedor) await quitarFatura(provedor, antes, valorRecebido(paidAmount, antes.amount));
      }
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/admin/invoices/:id", requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const invoice = await storage.getProviderInvoice(parseInt(id));
      if (!invoice) return res.status(404).json({ message: "Fatura nao encontrada" });
      if (invoice.status === "paid") return res.status(400).json({ message: "Nao e possivel cancelar uma fatura paga" });
      await storage.updateProviderInvoiceStatus(parseInt(id), "cancelled");
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/invoices/generate-monthly", requireSuperAdmin, async (req, res) => {
    try {
      const { period } = req.body;
      if (!period) return res.status(400).json({ message: "Period e obrigatorio (ex: 2026-03)" });
      // PLAN_PRICES and PLAN_CREDITS imported from @shared/schema
      const allProviders = await storage.getAllProviders();
      const me = await storage.getUser(req.session.userId!);
      const [year, month] = period.split("-").map(Number);
      const dueDate = new Date(year, month - 1, 10);
      let created = 0;
      let skipped = 0;
      // Os avisos saem SO DEPOIS que todas as faturas existirem. E o que garante
      // que nenhum e-mail lento ou fora do ar se meta entre a geracao de uma
      // fatura e a da proxima: o laco de baixo nao chama nada de fora.
      const aAvisar: { provedor: ProvedorParaEmail; fatura: FaturaGerada }[] = [];
      for (const provider of allProviders) {
        /**
         * Plano fora do catalogo nao gera fatura.
         *
         * A comparacao era `=== 0`, que so pulava o Gratuito: uma chave
         * desconhecida passava, e a linha seguinte fazia `.toString()` em
         * `undefined` — a rota inteira caia com 500 e NENHUM provedor era
         * faturado no mes. Isso deixou de ser hipotese quando o catalogo
         * encolheu para dois planos (03/09/2026): qualquer linha antiga em
         * `basic` ou `enterprise` derrubaria a geracao.
         */
        const preco = PLAN_PRICES[provider.plan];
        if (!preco || preco <= 0) { skipped++; continue; }
        const existingInvoices = await storage.getAllProviderInvoices(provider.id);
        if (existingInvoices.some(i => i.period === period && i.status !== "cancelled")) { skipped++; continue; }
        const invoiceNumber = await storage.getNextInvoiceNumber();
        const credits = PLAN_CREDITS[provider.plan] || { isp: 0, spc: 0 };
        const amount = preco.toString();
        await storage.createProviderInvoice({
          invoiceNumber, providerId: provider.id, period,
          planAtTime: provider.plan, amount,
          ispCreditsIncluded: credits.isp, spcCreditsIncluded: credits.spc,
          dueDate, status: "pending",
          createdById: req.session.userId!, createdByName: me?.name || "Admin",
        });
        created++;
        aAvisar.push({
          provedor: provider,
          fatura: { invoiceNumber, period, planAtTime: provider.plan, amount, dueDate },
        });
      }
      // `avisarFaturaGerada` nunca lanca (ver `avisarProvedor`), entao a falha
      // de um e-mail nao interrompe os outros nem a resposta da rota.
      for (const { provedor, fatura } of aAvisar) await avisarFaturaGerada(provedor, fatura);
      return res.json({ created, skipped, message: `${created} faturas geradas para ${period}` });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
