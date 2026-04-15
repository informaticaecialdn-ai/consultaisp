/**
 * NFS-e Automatica — emite nota fiscal via FocusNFe apos pagamento de creditos.
 *
 * Dados do prestador (Pks Sistemas): CNPJ 64.199.963/0001-49
 * Servico: 01.07 - Analise e desenvolvimento de sistemas
 */

import { emitirNfse, isFocusNfeConfigured, consultarNfse } from "./focusnfe";
import { storage } from "../storage";
import { logger } from "../logger";

// Dados do prestador (Pks Sistemas / Consulta ISP)
const PRESTADOR_CNPJ = "64199963000149";
const PRESTADOR_IM = process.env.FOCUS_NFE_IM || "";
const CODIGO_SERVICO = "01.07";
const ALIQUOTA_ISS = 2.90;

/**
 * Emite NFS-e automaticamente para uma compra de creditos paga.
 * Chamado pelo releaseCreditOrder() apos confirmacao de pagamento.
 */
export async function emitirNfseParaCompra(
  providerId: number,
  order: { id: number; orderNumber: string; amount: string; packageName: string; ispCredits: number; spcCredits: number },
): Promise<void> {
  if (!isFocusNfeConfigured()) {
    logger.warn("[NFS-e Auto] FocusNFe nao configurado — NFS-e nao emitida");
    return;
  }

  if (!PRESTADOR_IM) {
    logger.warn("[NFS-e Auto] FOCUS_NFE_IM (Inscricao Municipal) nao configurada — NFS-e nao emitida");
    return;
  }

  // Buscar dados do provedor (tomador)
  const provider = await storage.getProvider(providerId);
  if (!provider) {
    logger.warn({ providerId }, "[NFS-e Auto] Provedor nao encontrado");
    return;
  }

  if (!provider.cnpj) {
    logger.warn({ providerId }, "[NFS-e Auto] Provedor sem CNPJ — NFS-e nao emitida");
    return;
  }

  const valor = parseFloat(order.amount || "0");
  if (valor <= 0) {
    logger.warn({ orderId: order.id, valor }, "[NFS-e Auto] Valor zero — NFS-e nao emitida");
    return;
  }

  // Gerar referencia unica
  const ref = `nfse_cr_${order.id}_${Date.now()}`;

  // Montar descricao do servico
  const totalCredits = order.ispCredits + order.spcCredits;
  const descricao = `Licenciamento de uso do software SaaS - Consulta ISP. `
    + `Pacote: ${order.packageName || "Creditos"}. `
    + `${totalCredits} creditos de consulta. `
    + `Pedido: ${order.orderNumber}.`;

  logger.info({
    ref,
    providerId,
    valor,
    orderNumber: order.orderNumber,
  }, "[NFS-e Auto] Emitindo NFS-e");

  // Resolver codigo IBGE do municipio do tomador via CEP
  let codigoMunicipioTomador = "3550308"; // fallback SP
  if (provider.addressZip) {
    try {
      const cepClean = provider.addressZip.replace(/\D/g, "").padEnd(8, "0").slice(0, 8);
      const cepRes = await fetch(`https://viacep.com.br/ws/${cepClean}/json/`, { signal: AbortSignal.timeout(5000) });
      if (cepRes.ok) {
        const cepData = await cepRes.json();
        if (cepData.ibge) codigoMunicipioTomador = cepData.ibge;
      }
    } catch {}
  }

  const result = await emitirNfse({
    ref,
    cnpjPrestador: PRESTADOR_CNPJ,
    inscricaoMunicipal: PRESTADOR_IM,
    tomador: {
      cnpjCpf: provider.cnpj.replace(/\D/g, ""),
      razaoSocial: provider.name || provider.tradeName || "",
      email: provider.contactEmail || "",
      telefone: provider.contactPhone || undefined,
      logradouro: provider.addressStreet || "Nao informado",
      numero: provider.addressNumber || "S/N",
      complemento: provider.addressComplement || undefined,
      bairro: provider.addressNeighborhood || "Centro",
      codigoMunicipio: codigoMunicipioTomador,
      uf: provider.addressState || "SP",
      cep: provider.addressZip || "01000000",
    },
    descricao,
    valor,
    codigoServico: CODIGO_SERVICO,
    aliquotaIss: ALIQUOTA_ISS,
  });

  if (result.status === "processing") {
    logger.info({ ref, status: result.status }, "[NFS-e Auto] NFS-e enviada para processamento");

    // Poll resultado em background (ate 5 tentativas, 10s intervalo)
    pollNfseStatus(ref).catch(err =>
      logger.warn({ ref, err: err.message }, "[NFS-e Auto] Erro ao consultar status")
    );
  } else if (result.status === "error") {
    logger.error({ ref, erros: result.erros }, "[NFS-e Auto] Erro ao emitir NFS-e");
  }
}

/**
 * Poll status da NFS-e ate ser autorizada ou dar erro.
 */
async function pollNfseStatus(ref: string, maxAttempts = 5): Promise<void> {
  for (let i = 1; i <= maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 10000 * i)); // 10s, 20s, 30s, ...

    const result = await consultarNfse(ref);

    if (result.status === "authorized") {
      logger.info({
        ref,
        numero: result.numero,
        linkPdf: result.linkPdf,
        linkNfse: result.linkNfse,
      }, "[NFS-e Auto] NFS-e AUTORIZADA");
      return;
    }

    if (result.status === "error") {
      logger.error({ ref, erros: result.erros }, "[NFS-e Auto] NFS-e com ERRO");
      return;
    }

    logger.info({ ref, attempt: i, status: result.status }, "[NFS-e Auto] NFS-e ainda processando...");
  }

  logger.warn({ ref }, "[NFS-e Auto] NFS-e nao autorizada apos todas tentativas");
}
