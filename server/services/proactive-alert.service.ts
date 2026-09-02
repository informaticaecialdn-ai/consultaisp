/**
 * Alerta de FUGA — o aviso ao dono do cliente.
 *
 * Quando um provedor consulta um CPF e outro provedor tem esse CPF como
 * cliente ATIVO e INADIMPLENTE, o dono e avisado (conceito do dono do
 * produto, 02/09/2026). A regra que decide esta em antifraude-rules.ts; este
 * servico decide QUEM avaliar, grava o alerta e entrega o aviso.
 *
 * Duas fontes dizem quem e o dono:
 *   1. a consulta ao vivo nos ERPs da regiao — a mais fresca;
 *   2. a base sincronizada (`customers`), para o provedor cujo ERP nao
 *      respondeu na hora (fora da regiao, fora do ar, timeout). A base tem
 *      no maximo tres dias, e "cliente ativo com fatura vencida" nao muda em
 *      tres dias a ponto de o aviso ser injusto. Sem isto, o alerta dependia
 *      de o ERP do dono estar de pe no exato segundo da consulta.
 *
 * O alerta e GRAVADO em `anti_fraud_alerts` com a foto do momento (divida,
 * dias, contrato, quem consultou): e o que a tela le, e e o que sobrevive ao
 * cliente pagar ou sair depois. `proactive_alerts` fica como log de envio e
 * trava de 24h por CPF e dono.
 */
import { storage } from "../storage";
import { sendProactiveAlertEmail } from "./email";
import { resolverMarcaPorProviderId, urlDaMarca } from "./marca.service";
import { isZapiConfigured, sendText } from "./crm/zapi";
import { logger } from "../logger";
import { avaliarRiscoDeFuga, rotuloDoAlerta, severidadeDoAlerta, motivoPrincipal, type MotivoFuga } from "./antifraude-rules";
import { montarRegras, type RegrasAntiFraude } from "@shared/antifraude-regras";

export type StatusContrato = "active" | "cancelled" | "suspended";

/** Um registro do CPF vindo da consulta ao vivo num ERP da regiao. */
export interface ClienteAoVivo {
  providerId: number;
  providerName: string;
  isSameProvider?: boolean;
  name?: string;
  contractStatus?: StatusContrato;
  contractStartDate?: string;
  totalOverdueAmount?: number;
  maxDaysOverdue?: number;
}

/** O mesmo CPF na base sincronizada — uma linha por provedor que o tem. */
export interface ClienteDaBase {
  id: number;
  providerId: number;
  name: string;
  status: string | null;
  totalOverdueAmount: string | number | null;
  maxDaysOverdue: number | null;
}

export interface DonoCandidato {
  providerId: number;
  providerName?: string;
  /** Linha em `customers`, quando a base conhece o cliente — liga o alerta ao cadastro. */
  customerId?: number;
  name?: string;
  contractStatus?: StatusContrato;
  contractStartDate?: string;
  totalOverdueAmount: number;
  maxDaysOverdue: number;
  origem: "erp" | "base";
}

/**
 * `customers.status` -> status de contrato. Exaustivo, e o resto e
 * desconhecido: o default da coluna ("active" para quem nunca sincronizou)
 * nao pode abrir o portao da regra sozinho — por isso so os valores que o
 * sync escreve de fato contam.
 */
export function statusDaBase(status: string | null | undefined): StatusContrato | undefined {
  switch ((status || "").trim().toLowerCase()) {
    case "active": return "active";
    case "suspended": return "suspended";
    case "cancelled":
    case "inactive": return "cancelled";
    default: return undefined;
  }
}

/**
 * Quem deve ser avaliado para este CPF.
 *
 * Um candidato por provedor (que nao o consulente). O registro ao vivo vence;
 * a base entra so para o provedor cujo ERP NAO respondeu — se respondeu e nao
 * tem o cliente, vale o ERP, que e mais fresco que a base.
 */
export function escolherDonos(
  consultingProviderId: number,
  aoVivo: ClienteAoVivo[],
  providersQueResponderam: Set<number>,
  daBase: ClienteDaBase[],
): DonoCandidato[] {
  const porDono = new Map<number, DonoCandidato>();
  const linhaDaBase = new Map<number, ClienteDaBase>();
  for (const r of daBase) if (!linhaDaBase.has(r.providerId)) linhaDaBase.set(r.providerId, r);

  for (const c of aoVivo) {
    if (c.providerId === consultingProviderId || porDono.has(c.providerId)) continue;
    porDono.set(c.providerId, {
      providerId: c.providerId,
      providerName: c.providerName,
      customerId: linhaDaBase.get(c.providerId)?.id,
      name: c.name,
      contractStatus: c.contractStatus,
      contractStartDate: c.contractStartDate,
      totalOverdueAmount: Number(c.totalOverdueAmount ?? 0) || 0,
      maxDaysOverdue: Number(c.maxDaysOverdue ?? 0) || 0,
      origem: "erp",
    });
  }

  for (const r of daBase) {
    if (r.providerId === consultingProviderId || porDono.has(r.providerId)) continue;
    if (providersQueResponderam.has(r.providerId)) continue;
    porDono.set(r.providerId, {
      providerId: r.providerId,
      customerId: r.id,
      name: r.name,
      contractStatus: statusDaBase(r.status),
      totalOverdueAmount: Number(r.totalOverdueAmount ?? 0) || 0,
      maxDaysOverdue: Number(r.maxDaysOverdue ?? 0) || 0,
      origem: "base",
    });
  }

  return Array.from(porDono.values());
}

function maskCpfForAlert(cpf: string): string {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.***.***.${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.***.***/****-${digits.slice(12)}`;
  }
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

function maskNameForAlert(name: string): string {
  if (!name) return "Cliente";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2) + "***";
  }
  return parts[0] + " " + parts.slice(1).map(p => p.charAt(0) + "***").join(" ");
}

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Para quem vai o e-mail: o contato do provedor e, sem ele, os administradores.
 * A NsLink esta cadastrada sem e-mail de contato — o aviso era descartado com um
 * warn no log e ninguem ficava sabendo.
 */
async function destinatariosDeEmail(provider: { id: number; contactEmail?: string | null }): Promise<string[]> {
  const contato = (provider.contactEmail || "").trim();
  if (contato) return [contato];
  try {
    const usuarios = await storage.getUsersByProvider(provider.id);
    return Array.from(new Set(
      usuarios.filter(u => u.role === "admin" && u.email).map(u => u.email.trim().toLowerCase()),
    ));
  } catch {
    return [];
  }
}

/** As regras do dono. Sem acesso ao banco, vale o padrao — o aviso nao pode depender disso. */
async function regrasDoProvedor(providerId: number): Promise<RegrasAntiFraude> {
  try {
    return montarRegras(await storage.getAntiFraudRules(providerId));
  } catch (err) {
    logger.warn({ err, providerId }, "Alerta de fuga: regras do provedor indisponiveis — usando o padrao");
    return montarRegras([]);
  }
}

/** O texto do alerta, pelo motivo principal — o que a tela, o e-mail e o WhatsApp dizem. */
export function textoDoAlerta(
  motivos: MotivoFuga[],
  dono: { contractStatus?: StatusContrato; totalOverdueAmount: number; maxDaysOverdue: number },
  consultasDeOutros: number,
  diasDeContrato?: number,
): string {
  const contrato = dono.contractStatus === "suspended" ? "suspenso" : "ativo";
  switch (motivoPrincipal(motivos)) {
    case "divida_ativa":
      return `Seu cliente ${contrato} com ${brl(dono.totalOverdueAmount)} vencidos há ${dono.maxDaysOverdue} dia${dono.maxDaysOverdue === 1 ? "" : "s"} foi consultado por outro provedor da rede`;
    case "consultas_repetidas":
      return `Seu cliente ${contrato} foi consultado por ${consultasDeOutros} provedores diferentes nos últimos 30 dias`;
    case "contrato_novo":
      return `Seu cliente novo, com ${diasDeContrato ?? 0} dia${diasDeContrato === 1 ? "" : "s"} de contrato, foi consultado por outro provedor da rede`;
    default:
      return `Seu cliente ${contrato} foi consultado por outro provedor da rede`;
  }
}

export async function notifyOwnerProviders(
  cpfCnpj: string,
  allCustomers: ClienteAoVivo[],
  consultingProviderId: number,
  /** ERPs que responderam ao vivo (ok). Sem a lista, vale quem trouxe registro. */
  providersQueResponderam: Set<number> = new Set(allCustomers.map(c => c.providerId)),
  /** Provedores DISTINTOS que consultaram este CPF em 30 dias, incluindo o de agora. */
  provedoresConsultando: number[] = [consultingProviderId],
): Promise<void> {
  let daBase: ClienteDaBase[] = [];
  try {
    daBase = (await storage.getCustomerByCpfCnpj(cpfCnpj)).map(c => ({
      id: c.id, providerId: c.providerId, name: c.name, status: c.status,
      totalOverdueAmount: c.totalOverdueAmount, maxDaysOverdue: c.maxDaysOverdue,
    }));
  } catch (err) {
    logger.warn({ err }, "Alerta de fuga: base sincronizada indisponivel — avaliando so o que veio ao vivo");
  }

  const donos = escolherDonos(consultingProviderId, allCustomers, providersQueResponderam, daBase);
  if (donos.length === 0) return;

  let nomeDoConsulente: string | undefined;
  try {
    nomeDoConsulente = (await storage.getProvider(consultingProviderId))?.name;
  } catch { /* o nome e anonimizado na leitura de qualquer jeito */ }

  for (const dono of donos) {
    try {
      // ── PORTAO DA REGRA ────────────────────────────────────────────────
      // Antes daqui, QUALQUER consulta a QUALQUER cliente virava alerta — foi
      // o que encheu a tela de ex-clientes com anos de atraso. O alerta so faz
      // sentido para quem ainda e cliente e esta devendo.
      // As regras sao do DONO: e ele quem escolhe o que quer vigiar na base.
      const regras = await regrasDoProvedor(dono.providerId);
      const consultasDeOutros = new Set(provedoresConsultando.filter(id => id !== dono.providerId)).size;
      const avaliacao = avaliarRiscoDeFuga(
        {
          contractStatus: dono.contractStatus,
          contractStartDate: dono.contractStartDate,
          totalOverdueAmount: dono.totalOverdueAmount,
          maxDaysOverdue: dono.maxDaysOverdue,
        },
        { consultanteEhDono: false, regras, consultasDeOutros },
      );

      if (!avaliacao.alerta) {
        logger.debug(
          { providerId: dono.providerId, cpfCnpj: maskCpfForAlert(cpfCnpj), origem: dono.origem, descartadoPor: avaliacao.descartadoPor },
          "Alerta de fuga descartado pela regra",
        );
        continue;
      }

      const ownerProvider = await storage.getProvider(dono.providerId);
      if (!ownerProvider) continue;

      if (ownerProvider.proactiveAlertsEnabled === false) {
        logger.info({ providerId: ownerProvider.id }, "Proactive alerts disabled for provider, skipping");
        continue;
      }

      // Trava: no maximo 1 alerta por CPF por dono a cada 24h. O mesmo CPF
      // consultado tres vezes e UM caso a tratar, nao tres.
      const lastAlert = await storage.getLastProactiveAlert(cpfCnpj, ownerProvider.id);
      if (lastAlert) {
        logger.info({ providerId: ownerProvider.id, cpfCnpj: maskCpfForAlert(cpfCnpj) }, "Proactive alert throttled (24h)");
        continue;
      }

      const severidade = severidadeDoAlerta(avaliacao.motivos, dono);
      const motivo = rotuloDoAlerta(avaliacao.motivos);
      const maskedCpf = maskCpfForAlert(cpfCnpj);
      const maskedName = maskNameForAlert(dono.name || "Cliente");
      const contrato = dono.contractStatus === "suspended" ? "suspenso" : "ativo";
      const resumo = textoDoAlerta(avaliacao.motivos, dono, consultasDeOutros, avaliacao.diasDeContrato);

      // ── 1. O REGISTRO QUE A TELA LE ────────────────────────────────────
      // Com a foto do momento: e o que sobrevive ao cliente pagar ou sair
      // depois, e o que diz ao provedor por que o alerta existiu.
      try {
        await storage.createAlert({
          providerId: ownerProvider.id,
          customerId: dono.customerId ?? null,
          consultingProviderId,
          consultingProviderName: nomeDoConsulente ?? null,
          customerName: dono.name ?? null,
          customerCpfCnpj: cpfCnpj,
          type: "defaulter_consulted",
          severity: severidade,
          message: resumo,
          riskScore: severidade === "critical" ? 90 : severidade === "high" ? 70 : 50,
          riskLevel: severidade === "critical" ? "critico" : severidade === "high" ? "alto" : "medio",
          riskFactors: ["consulta_outro_provedor", ...avaliacao.motivos, dono.origem === "base" ? "base_sincronizada" : "erp_ao_vivo"],
          daysOverdue: dono.maxDaysOverdue,
          overdueAmount: dono.totalOverdueAmount.toFixed(2),
          recentConsultations: consultasDeOutros,
          resolved: false,
          status: "new",
        });
      } catch (err) {
        logger.error({ err, providerId: ownerProvider.id }, "Alerta de fuga: falha ao gravar o registro");
      }

      // ── 2. OS AVISOS ───────────────────────────────────────────────────
      const canais: string[] = [];
      const marca = await resolverMarcaPorProviderId(ownerProvider.id);
      const detalhes = { valor: dono.totalOverdueAmount, dias: dono.maxDaysOverdue, contrato, motivo, resumo };

      const destinos = await destinatariosDeEmail(ownerProvider);
      if (destinos.length === 0) {
        logger.warn({ providerId: ownerProvider.id }, "Alerta de fuga: provedor sem e-mail de contato e sem admin com e-mail");
      }
      for (const to of destinos) {
        try {
          await sendProactiveAlertEmail(to, ownerProvider.name, maskedCpf, maskedName, marca, detalhes);
          if (!canais.includes("email")) canais.push("email");
        } catch (emailErr) {
          logger.error({ err: emailErr, providerId: ownerProvider.id }, "Failed to send proactive alert email");
        }
      }

      // WhatsApp pela instancia da plataforma, para o telefone de contato do
      // provedor. So quando a Z-API esta configurada — sem ela, nada a fazer.
      if (isZapiConfigured() && ownerProvider.contactPhone) {
        try {
          const texto =
            `Alerta anti-fraude · ${marca.nomeProduto}\n` +
            `${motivo}\n` +
            `Cliente ${maskedName} (${maskedCpf}). ${resumo}.\n` +
            `Detalhes: ${urlDaMarca(marca)}/anti-fraude`;
          const r = await sendText(ownerProvider.contactPhone, texto);
          if (r.success) canais.push("zap");
          else logger.warn({ providerId: ownerProvider.id, erro: r.error }, "Alerta de fuga: WhatsApp nao enviado");
        } catch (zapErr) {
          logger.error({ err: zapErr, providerId: ownerProvider.id }, "Alerta de fuga: falha no WhatsApp");
        }
      }

      const webhookUrl = ownerProvider.proactiveAlertWebhookUrl;
      if (webhookUrl) {
        try {
          const webhookPayload = {
            event: "proactive_alert",
            provider: ownerProvider.name,
            maskedCpf,
            maskedCustomerName: maskedName,
            message: resumo,
            motivo,
            motivos: avaliacao.motivos,
            severidade,
            contrato,
            valorVencido: dono.totalOverdueAmount,
            diasDeAtraso: dono.maxDaysOverdue,
            diasDeContrato: avaliacao.diasDeContrato ?? null,
            timestamp: new Date().toISOString(),
          };
          const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(webhookPayload),
            signal: AbortSignal.timeout(10_000),
          });
          canais.push("hook");
          logger.info({ providerId: ownerProvider.id, channel: "webhook", status: response.status }, "Proactive alert webhook sent");
        } catch (webhookErr) {
          logger.error({ err: webhookErr, providerId: ownerProvider.id }, "Failed to send proactive alert webhook");
        }
      }

      // ── 3. O LOG DE ENVIO — e a trava de 24h ───────────────────────────
      await storage.createProactiveAlert({
        providerId: ownerProvider.id,
        cpfCnpj,
        consultingProviderId,
        channel: canais.length > 0 ? canais.join(",") : "nenhum",
        acknowledged: false,
      });

      logger.info(
        { providerId: ownerProvider.id, canais, severidade, motivos: avaliacao.motivos, origem: dono.origem, cpfCnpj: maskedCpf },
        "Alerta de fuga gravado",
      );
    } catch (err) {
      logger.error({ err, providerId: dono.providerId }, "Proactive alert processing error");
    }
  }
}
