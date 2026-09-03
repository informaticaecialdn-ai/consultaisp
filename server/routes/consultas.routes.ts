import { Router } from "express";
import { requireAuth, requireProvider } from "../auth";
import { storage } from "../storage";
import { maskCrossProviderDetail, maskName, maskCpfCnpj, maskOverdueAmount, maskDaysOverdue } from "../services/lgpd-masking";
import { generatePartnerCode } from "../utils/provider-anonymizer";
import { sanitizarResultadoGravado } from "../utils/historico-consulta";
import { hashCPFForNetwork } from "../utils/cpf-hash";
import { getRegionalProviderIds } from "../services/regional.service";
import { queryRegionalErps, queryRegionalErpsByAddress, type RealtimeQueryResult } from "../services/realtime-query.service";
import { chaveDeEndereco } from "../services/endereco-chave";
import { calcularScoreISP, type ISPScoreInput } from "../utils/isp-score";
import { consultationCache } from "../services/consultation-cache.service";
import { buildAddressSearchResult } from "../services/address-search.service";
import { detectMigrator } from "../services/migrator-detection.service";
import { getSafeErrorMessage } from "../utils/safe-error";
import { validarCpfCnpj } from "../utils/cpf-cnpj-validator";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { logger } from "../logger";
import { gerarIdentificadorDeConsulta } from "../services/identificador-consulta";
import { isSpcConfigured, consultarSpc, SpcError, statusHttpParaErroSpc } from "../services/spc/spc.service";
import { CUSTO_EM_CREDITOS } from "@shared/schema";
import { notifyOwnerProviders } from "../services/proactive-alert.service";
import { faixaIdadeOcorrencia, faixaValorEquipamento } from "../services/equipment-recovery-rules";

export function registerConsultasRoutes(): Router {
  const router = Router();

  const ispConsultaLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
  const spcConsultaLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });

  router.get("/api/isp-consultations", requireAuth, requireProvider, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));

      const [{ rows: consultations, total }, today, month, provider] = await Promise.all([
        storage.getIspConsultationsByProviderPaginated(providerId, page, limit),
        storage.getIspConsultationCountToday(providerId),
        storage.getIspConsultationCountMonth(providerId),
        storage.getProvider(providerId),
      ]);

      return res.json({
        // O result gravado sai limpo: resultados antigos guardavam o codigo
        // global do parceiro e o id cru dele (ver historico-consulta.ts).
        consultations: consultations.map(c => ({ ...c, result: sanitizarResultadoGravado(c.result) })),
        total,
        page,
        pageSize: limit,
        todayCount: today,
        monthCount: month,
        credits: provider?.ispCredits || 0,
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/isp-consultations", ispConsultaLimiter, requireAuth, requireProvider, async (req, res) => {
    // O identificador nasce ANTES de tudo que pode falhar — cache, credito,
    // ERP. E no erro que o provedor mais precisa dele ("a consulta
    // CI-2609-K7F3M2 deu erro"), entao gera-lo depois da parte que quebra seria
    // gera-lo justamente para os casos que dispensam ajuda.
    const consultaId = gerarIdentificadorDeConsulta();
    try {
      const { cpfCnpj, lgpdAccepted, apiVersion } = req.body;
      if (!cpfCnpj) {
        return res.status(400).json({ message: "CPF/CNPJ obrigatorio", consultaId });
      }

      // LGPD consent enforcement: strict boolean validation.
      // Only `true` (boolean) is accepted — truthy values like "false", "yes", 1
      // are rejected to ensure reliable audit records for LGPD compliance.
      const lgpdStrictEnforcementDate = new Date("2026-07-01T00:00:00Z");
      const isV2 = apiVersion === "v2";
      const deprecationWarnings: string[] = [];

      if (lgpdAccepted !== undefined && typeof lgpdAccepted !== "boolean") {
        return res.status(400).json({
          message: "O campo 'lgpdAccepted' deve ser um booleano (true/false)",
          consultaId,
        });
      }

      const lgpdConsentGiven = lgpdAccepted === true;

      if (!lgpdConsentGiven) {
        if (isV2 || new Date() >= lgpdStrictEnforcementDate) {
          // v2 callers and post-deadline: strict enforcement
          return res.status(400).json({ message: "Aceite LGPD obrigatorio para realizar consultas", consultaId });
        }
        // Legacy callers within compatibility window: warn but proceed
        deprecationWarnings.push(
          "DEPRECATION: O campo 'lgpdAccepted' sera obrigatorio a partir de 2026-07-01. " +
          "Envie lgpdAccepted: true no body para consentimento LGPD."
        );
        logger.warn(
          { consultaId, providerId: req.session.providerId, endpoint: "/api/isp-consultations" },
          "Legacy caller missing lgpdAccepted — proceeding with deprecation warning"
        );
      }

      const validacao = validarCpfCnpj(cpfCnpj);
      if (!validacao.valid) {
        // Recusa na porta: nada foi consultado e nada sera gravado. Fica no log
        // porque e o unico registro de que este codigo existiu — sem ele, quem
        // liga com o codigo na mao nao encontra nada em lugar nenhum.
        logger.info({ consultaId, providerId: req.session.providerId, motivo: "documento_invalido" }, "CONSULTA recusada — nada gravado");
        return res.status(400).json({ message: validacao.error, consultaId });
      }
      const { cleaned, type: searchType } = validacao;

      const providerId = req.session.providerId!;
      const provider = await storage.getProvider(providerId);
      if (!provider) {
        logger.warn({ consultaId, providerId, motivo: "provedor_inexistente" }, "CONSULTA recusada — nada gravado");
        return res.status(400).json({ message: "Provedor nao encontrado", consultaId });
      }

      const mesoregiao = (provider as any).mesorregioes?.[0] || "";

      // ── CACHE CHECK (CACHE-01, CACHE-02) ─────────────────────────
      const cached = consultationCache.getResult(cleaned, providerId, searchType);
      if (cached) {
        // O codigo devolvido e o da consulta ORIGINAL, nao o que acabou de ser
        // sorteado: o que esta na tela E a consulta antiga (a tela mostra o selo
        // CACHE). Devolver um codigo novo mandaria o suporte procurar uma linha
        // que nao existe — nada foi gravado agora.
        //
        // Consulta anterior a esta versao nao tem codigo, e a resposta sai sem
        // ele: ela nasceu sem, e inventar um aqui seria dizer que foi
        // identificada quando nao foi.
        const idOriginal = (cached.consultation as { consultaId?: string | null } | undefined)?.consultaId ?? undefined;
        logger.info(
          { consultaId: idOriginal, novoSorteioDescartado: consultaId, providerId, doc: cleaned.slice(0, 4) + "***" },
          "CONSULTA cache hit",
        );
        return res.json({
          ...cached,
          ...(idOriginal ? { consultaId: idOriginal } : {}),
          source: "cache",
          cacheAge: Math.round((Date.now() - cached.cachedAt) / 1000),
        });
      }

      // ── REALTIME ERP QUERY ────────────────────────────────────────
      // Query ERPs from the same mesoregion directly via connectors.
      // LGPD: data is never stored. Fetched in real-time, masked, returned.
      const allErpIntegrations = await storage.getAllEnabledErpIntegrationsWithCredentials();
      const regionalProviderIds = await getRegionalProviderIds(providerId);
      const allowedProviderIds = new Set([providerId, ...regionalProviderIds]);
      const erpIntegrations = allErpIntegrations.filter(intg => allowedProviderIds.has(intg.providerId));

      // RT-01: Real-time only guard — no local DB fallback exists.
      // All data comes from ERP connectors for the consulting provider's region.
      // If an integration somehow bypasses the allowedProviderIds filter, log and reject it.
      for (const intg of erpIntegrations) {
        if (!allowedProviderIds.has(intg.providerId)) {
          logger.warn({ consultaId, providerId: intg.providerId }, "RT-01 ERP integration not in allowed set — skipping");
        }
      }

      if (erpIntegrations.length > 0) {

        // ── REGIONAL CACHE CHECK (CACHE-03) ─────────────────────────
        let erpResults: RealtimeQueryResult[];
        let regionalCacheHit = false;
        const cachedRegional = mesoregiao
          ? consultationCache.getRawResult(cleaned, mesoregiao, searchType)
          : undefined;

        if (cachedRegional) {
          // O cache e chaveado pela primeira mesorregiao de quem consultou
          // antes, mas o conjunto permitido e por sobreposicao de regioes:
          // um provedor de OUTRA regiao daquele consulente nao pode chegar a
          // este. Filtra pelo conjunto permitido deste observador.
          erpResults = (cachedRegional.erpResults as RealtimeQueryResult[])
            .filter(r => allowedProviderIds.has(r.providerId));
          regionalCacheHit = true;
          logger.info({ consultaId, providerId, doc: cleaned.slice(0, 4) + "***", mesoregiao }, "CONSULTA regional cache hit");
        } else {
          // ── CONSULTA E SEMPRE AO VIVO ───────────────────────────────────
          //
          // A base local NAO responde consulta. Ela existe para a Localizacao e
          // o mapa de calor, e e atualizada em varredura completa 3x por semana
          // — entao um valor dela pode ter dias. Numa decisao de credito isso e
          // inaceitavel: o produto e um bureau, e a pergunta que ele responde e
          // "quanto esta devendo AGORA", nao "quanto devia na ultima varredura".
          //
          // Por isso a consulta vai ao ERP de todos os provedores da regiao,
          // buscando SO o documento consultado — uma chamada barata e pontual,
          // diferente da varredura noturna. O cache regional acima evita repetir
          // a mesma pergunta em minutos.
          logger.info(
            { consultaId, providerId, doc: cleaned.slice(0, 4) + "***", erps: erpIntegrations.length },
            "CONSULTA ao vivo nos ERPs da regiao",
          );
          erpResults = await queryRegionalErps(erpIntegrations as any, cleaned, searchType, { consultaId });

          // Store raw ERP results in regional cache for reuse by other providers
          if (mesoregiao) {
            consultationCache.setRawResult(cleaned, mesoregiao, searchType, erpResults);
          }
        }

        // Um sinal patrimonial so entra na rede depois de prova, notificacao,
        // evidencia operacional e revisao administrativa. O ERP isolado nao
        // basta para publicar uma ocorrencia contra o titular.
        const recoverySignals = (searchType === "cpf" || searchType === "cnpj")
          ? await storage.getValidatedRecoverySignals(cleaned, Array.from(allowedProviderIds))
          : [];
        const signalByProvider = new Map(recoverySignals.map(signal => [signal.providerId, signal]));

        // Flatten all customers from all ERPs
        const allCustomers: Array<RealtimeQueryResult["customers"][0] & {
          providerName: string;
          providerId: number;
          isSameProvider: boolean;
          recoverySignal?: typeof recoverySignals[number];
        }> = [];
        for (const erpResult of erpResults) {
          if (!erpResult.ok || erpResult.customers.length === 0) continue;
          for (const c of erpResult.customers) {
            allCustomers.push({
              ...c,
              providerName: erpResult.providerName,
              providerId: erpResult.providerId,
              isSameProvider: erpResult.providerId === providerId,
              recoverySignal: signalByProvider.get(erpResult.providerId),
            });
          }
        }

        // Cadastro manual/CSV pode conter uma ocorrencia validada mesmo quando o
        // ERP nao devolve mais o contrato cancelado. Inclui uma linha sintetica,
        // com o minimo necessario e sem inventar inadimplencia financeira.
        for (const signal of recoverySignals) {
          if (allCustomers.some(customer => customer.providerId === signal.providerId)) continue;
          allCustomers.push({
            cpfCnpj: cleaned,
            name: signal.customerName,
            totalOverdueAmount: 0,
            maxDaysOverdue: 0,
            overdueInvoicesCount: 0,
            hasUnreturnedEquipment: true,
            unreturnedEquipmentCount: signal.count,
            equipmentCategories: signal.categories,
            equipmentPendingValue: signal.totalValue,
            providerName: signal.providerName,
            providerId: signal.providerId,
            isSameProvider: signal.providerId === providerId,
            recoverySignal: signal,
          });
        }

        const notFound = allCustomers.length === 0;
        const isOwnCustomer = allCustomers.some(c => c.isSameProvider);

        // Build provider details with LGPD masking
        const providerDetails = allCustomers.map(c => {
          // "Em dia" so para quem AINDA e cliente.
          //
          // O rotulo saia so de `maxDaysOverdue`, entao ex-cliente sem debito
          // aparecia no relatorio como "Em dia" — a leitura mais generosa
          // possivel de alguem que saiu do provedor. O sinal de contrato estava
          // na mao, no mesmo escopo, e era usado 100 linhas abaixo.
          const paymentStatus = c.maxDaysOverdue > 90 ? "Inadimplente (90+ dias)"
            : c.maxDaysOverdue > 60 ? "Inadimplente (61-90 dias)"
            : c.maxDaysOverdue > 30 ? "Inadimplente (31-60 dias)"
            : c.maxDaysOverdue > 0 ? "Inadimplente (1-30 dias)"
            : c.contractStatus === "cancelled" ? "Contrato encerrado"
            : "Em dia";

          const addrParts = [c.address, c.addressNumber, c.complement, c.neighborhood, c.city, c.state, c.cep].filter(Boolean);

          const signal = c.recoverySignal;
          const operationalPending = c.isSameProvider && c.hasUnreturnedEquipment === true;
          const hasUnreturnedEquipment = !!signal || operationalPending;
          // Entre provedores a quantidade viaja em faixa (1 ou 2+), como o resto
          // do sinal; a contagem exata fica restrita ao provedor de origem.
          const unreturnedEquipmentCount = signal
            ? (c.isSameProvider ? signal.count : Math.min(signal.count, 2))
            : (operationalPending ? (c.unreturnedEquipmentCount ?? 1) : 0);
          const rawDetail: Record<string, any> = {
            providerName: c.providerName,
            providerId: c.providerId,
            isSameProvider: c.isSameProvider,
            customerName: c.name || "Desconhecido",
            cpfCnpj: c.cpfCnpj || "",
            status: paymentStatus,
            // So o STATUS do contrato viaja — um enum grosso
            // (active/cancelled/suspended), que e exatamente o tipo de sinal que
            // um bureau existe para compartilhar. O copiador do masker e
            // `if (key in detail)`, entao ele nunca chegava do outro lado.
            //
            // `contractStartDate` DE PROPOSITO fica de fora. Ele consta em
            // PRESERVED_FIELDS e ha teste fixando isso — mas ninguem o
            // preenchia, entao a data exata nunca cruzou tenant de fato. Inclui-
            // lo aqui criaria esse vazamento pela primeira vez, e sem
            // necessidade: nada no client renderiza o campo, e a condicao de
            // "contrato com menos de 90 dias" do anti-fraude e avaliada no
            // servidor, sobre o registro do proprio dono.
            contractStatus: c.contractStatus,
            daysOverdue: c.maxDaysOverdue,
            overdueAmount: c.totalOverdueAmount,
            overdueInvoicesCount: c.overdueInvoicesCount || 0,
            address: c.address || addrParts.join(", "),
            addressNumber: c.addressNumber || undefined,
            neighborhood: c.neighborhood || undefined,
            addressCity: c.city || undefined,
            addressState: c.state || undefined,
            cep: c.cep || undefined,
            latitude: (c as any).latitude || undefined,
            longitude: (c as any).longitude || undefined,
            hasUnreturnedEquipment,
            unreturnedEquipmentCount,
            equipmentStatus: signal
              ? "validated_pending"
              : operationalPending
                ? "operational_pending"
                : "unknown",
            equipmentSignalValidated: !!signal,
            equipmentCategories: signal?.categories ?? (operationalPending ? c.equipmentCategories : undefined),
            equipmentOccurrenceAgeRange: signal
              ? faixaIdadeOcorrencia(signal.terminationDate)
              : undefined,
            equipmentValueRange: signal
              ? faixaValorEquipamento(signal.totalValue)
              : undefined,
            // LGPD: o outro provedor recebe faixa de valor, nunca serie, MAC,
            // modelo, endereco, texto de atendimento ou valor exato.
            equipmentPendingSummary: signal
              ? c.isSameProvider
                ? `${signal.count} equipamento${signal.count > 1 ? "s" : ""} · R$ ${signal.totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `${signal.count === 1 ? "1 equipamento" : "2+ equipamentos"} · ${faixaValorEquipamento(signal.totalValue)} · ${faixaIdadeOcorrencia(signal.terminationDate)}`
              : operationalPending
                ? `${unreturnedEquipmentCount} equipamento${unreturnedEquipmentCount > 1 ? "s" : ""} pendente${unreturnedEquipmentCount > 1 ? "s" : ""} no seu ERP`
                : undefined,
            planName: c.planName,
            phone: c.phone,
            email: c.email,
            serviceAgeMonths: c.serviceAgeMonths,
          };
          return maskCrossProviderDetail(rawDetail, c.isSameProvider, providerId);
        });
        // Proprio primeiro; parceiros na ordem do codigo, que e pseudoaleatoria
        // por observador. A ordem de chegada seguia o id (ordem de cadastro) —
        // mais uma pista de quem e quem.
        providerDetails.sort((a, b) =>
          (a.isSameProvider === b.isSameProvider ? 0 : a.isSameProvider ? -1 : 1)
          || String(a.providerName || "").localeCompare(String(b.providerName || "")));

        // Build alerts — LGPD: mask exact values for cross-provider data
        const alerts: string[] = [];
        for (const c of allCustomers) {
          if (c.maxDaysOverdue > 0 && !c.isSameProvider) {
            const maskedDays = c.maxDaysOverdue > 365 ? "mais de 1 ano"
              : c.maxDaysOverdue > 180 ? "mais de 6 meses"
              : c.maxDaysOverdue > 90 ? "mais de 90 dias"
              : c.maxDaysOverdue > 30 ? "mais de 30 dias"
              : "menos de 30 dias";
            alerts.push(`[Rede ISP] Inadimplente: ${maskedDays} em atraso`);
          } else if (c.maxDaysOverdue > 0 && c.isSameProvider) {
            alerts.push(`[${c.providerName}] Inadimplente: ${c.maxDaysOverdue} dias em atraso`);
          }
        }
        for (const signal of recoverySignals) {
          alerts.push(signal.providerId === providerId
            ? "Ocorrência patrimonial validada pelo seu provedor"
            : "[Rede ISP] Ocorrência validada de equipamento com retirada pendente");
        }

        // Recent consultations for F4 (padrao de consultas) — single DB call for 90d, filter 30d in code
        const recentConsultations90 = await storage.getRecentConsultationsForDocument(cleaned, 90);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentConsultations = recentConsultations90.filter(c => c.createdAt >= thirtyDaysAgo);
        const consultas30d = new Set(recentConsultations.map(c => c.providerId)).size;
        const consultas90d = new Set(recentConsultations90.map(c => c.providerId)).size;

        // ── SCORE ISP 0-1000 ────────────────────────────────────────────
        const ownCustomer = allCustomers.find(c => c.isSameProvider);
        const redeOcorrencias = allCustomers
          .filter(c => !c.isSameProvider)
          .map(c => ({
            diasAtraso: c.maxDaysOverdue,
            // O motor v2 pesa o VALOR da divida — antes R$ 100 e R$ 10.000
            // pontuavam igual porque este campo nunca chegava ao score.
            valorAtraso: c.totalOverdueAmount ?? undefined,
            faturasAtraso: c.overdueInvoicesCount || 0,
            statusContrato: c.status || "unknown",
            mesesComoCliente: c.serviceAgeMonths,
            equipamentosDevolvidos: c.recoverySignal ? false : undefined,
          }));

        // ── ADDRESS SEARCH — automatic for CPF when ERP returns address ──
        // CEP search: uses the CEP directly
        // CPF/CNPJ search: auto-cross using best available address from ERP results
        let addressSearchResult = searchType === "cep"
          ? buildAddressSearchResult(cleaned, erpResults, providerId)
          : undefined;

        // Metadata for API contract: source of address used for crossing
        let addressSource: "own" | "network" | null = null;
        let addressUsed: string | null = null;
        /* O endereco cruzado, em PARTES.
           `addressUsed` e so um rotulo — as vezes um CEP, as vezes
           "Rua X, 17 — Bairro". A tela tratava os dois como CEP: escrevia
           "CEP Rua Amelia Wiesel Rose, 17 — ..." e passava a string para o
           mapa, que extraia os digitos ("17") e desistia de geocodificar. */
        let addressParts: {
          logradouro?: string; numero?: string; bairro?: string;
          cidade?: string; uf?: string; cep?: string;
        } | null = null;
        let autoAddressCrossRef = false;

        if (searchType === "cpf" || searchType === "cnpj") {
          // Candidate selection: prefer ownCustomer, fallback to any network customer with valid CEP+number
          // CEP must be exactly 8 digits after stripping non-numeric chars
          const isValidCep = (cep: string | undefined | null): boolean => {
            if (!cep) return false;
            const digits = cep.replace(/\D/g, "");
            return digits.length === 8;
          };

          // O insumo do cruzamento e o endereco que a propria consulta do
          // documento devolveu — o operador nao digita nada.
          //
          // O criterio deixou de ser CEP. Exigir CEP de 8 digitos descartava 39%
          // da carteira da NsLink (medido em 27/08/2026), e em cidade pequena
          // boa parte do cadastro carrega o CEP geral do municipio, que juntaria
          // imoveis diferentes. Agora basta logradouro + cidade; o numero entra
          // no casamento fino, em endereco-chave.ts.
          const temEnderecoUtil = (c: typeof allCustomers[0]) =>
            chaveDeEndereco(c) !== null || (isValidCep(c.cep) && !!c.addressNumber);

          let addressCandidate: typeof allCustomers[0] | undefined;
          if (ownCustomer && temEnderecoUtil(ownCustomer)) {
            addressCandidate = ownCustomer;
            addressSource = "own";
          } else {
            addressCandidate = allCustomers.find(temEnderecoUtil);
            if (addressCandidate) {
              addressSource = addressCandidate.isSameProvider ? "own" : "network";
            }
          }

          if (addressCandidate) {
            try {
              const chave = chaveDeEndereco(addressCandidate);
              const cepCandidato = (addressCandidate.cep || "").replace(/\D/g, "");

              let cruzamento: RealtimeQueryResult[];
              try {
                const inicio = Date.now();
                cruzamento = chave
                  ? await queryRegionalErpsByAddress(erpIntegrations as any, {
                      logradouro: chave.logradouro,
                      numero: String(chave.numero),
                      bairro: chave.bairro || undefined,
                      cidade: addressCandidate.city || undefined,
                      uf: addressCandidate.state || undefined,
                      cep: cepCandidato || undefined,
                    }, { consultaId })
                  : await queryRegionalErps(erpIntegrations as any, cepCandidato, "cep", { consultaId });
                logger.info(
                  { consultaId, por: chave ? "endereco" : "cep", ok: cruzamento.filter(r => r.ok).length, latencyMs: Date.now() - inicio },
                  "CONSULTA cruzamento de endereco concluido",
                );
              } catch (err) {
                // O cruzamento e complemento, nao a resposta: se ele falha, a
                // consulta ainda vale. Cai no que ja foi trazido pelo documento.
                logger.warn({ consultaId, err }, "CONSULTA cruzamento falhou; usando o resultado do documento");
                cruzamento = erpResults;
              }

              addressUsed = chave
                ? `${chave.logradouro}, ${chave.numero}${chave.bairro ? ` — ${chave.bairro}` : ""}`
                : cepCandidato;
              addressParts = {
                logradouro: chave?.logradouro,
                numero: chave ? String(chave.numero) : undefined,
                bairro: chave?.bairro || undefined,
                cidade: addressCandidate.city || undefined,
                uf: addressCandidate.state || undefined,
                cep: cepCandidato || undefined,
              };
              addressSearchResult = buildAddressSearchResult(addressUsed, cruzamento, providerId, chave ?? undefined, cleaned);
              autoAddressCrossRef = true;
            } catch (err) {
              logger.warn({ consultaId, err }, "CONSULTA auto address search error (non-blocking)");
            }
          }
        }

        const scoreInput: ISPScoreInput = {
          proprio: ownCustomer ? {
            mesesComoCliente: ownCustomer.serviceAgeMonths || 0,
            diasAtrasoAtual: ownCustomer.maxDaysOverdue,
            valorAtrasoAtual: ownCustomer.totalOverdueAmount ?? undefined,
            faturasAtrasadasTotal: ownCustomer.overdueInvoicesCount || 0,
            faturasTotal: 0,
            equipamentosDevolvidos: ownCustomer.recoverySignal || ownCustomer.hasUnreturnedEquipment === true
              ? false
              : undefined,
            // O contrato do ERP quando ele veio; atraso so decide o resto.
            //
            // Cravar "ativo" para quem nao esta em atraso fazia o ex-cliente do
            // proprio consultante entrar na conta como cliente vigente — e o
            // motor usa esse campo para liberar o bonus de "nunca atrasou".
            statusContrato: ownCustomer.contractStatus === "cancelled"
              ? "cancelado"
              : ownCustomer.contractStatus === "suspended" || ownCustomer.maxDaysOverdue > 0
              ? "suspenso"
              : ownCustomer.contractStatus === "active"
              ? "ativo"
              // Existe na base, contrato nao comprovado. NAO use "nunca_teve"
              // aqui: aquilo faz o motor descartar a ocorrencia e a divida dele
              // sumir do score.
              : "desconhecido",
          } : undefined,
          rede: {
            ocorrencias: redeOcorrencias,
            totalProvedores: new Set(allCustomers.filter(c => !c.isSameProvider).map(c => c.providerId)).size,
            consultasRecentes30d: consultas30d,
            consultasRecentes90d: consultas90d,
          },
          cadastro: {
            nomeCompleto: !!(ownCustomer?.name),
            cpfValido: true,
            emailValido: !!(ownCustomer?.email),
            telefoneValido: !!(ownCustomer?.phone),
            enderecoCompleto: !!(ownCustomer?.cep && ownCustomer?.address),
          },
          endereco: addressSearchResult ? {
            cpfsDistintosInadimplentes: addressSearchResult.risk.cpfsDistintosInadimplentes,
            totalOcorrenciasEndereco: addressSearchResult.risk.totalOcorrenciasEndereco,
          } : undefined,
        };

        const scoreResult = calcularScoreISP(scoreInput);

        // ── MIGRATOR DETECTION (MIG-01, MIG-02, MIG-03) ────────────
        // Sinal de bureau para QUEM CONSULTA: vai no resultado da consulta.
        // Nao vira alerta de anti-fraude para o ex-provedor — ex-cliente nao
        // tem contrato a proteger, e o anti-fraude e so para cliente ativo
        // com pendencia financeira (ver notifyOwnerProviders).
        let migratorAlert: { detected: true; severity: string; message: string; riskFactors: string[] } | null = null;
        if (searchType === "cpf" || searchType === "cnpj") {
          try {
            const migratorResult = detectMigrator({
              cpfCnpj: cleaned,
              consultingProviderId: providerId,
              consultingProviderName: provider.name,
              erpResults,
              recentConsultationsByDistinctProviders: consultas30d,
            });
            if (migratorResult) {
              migratorAlert = {
                detected: true,
                severity: migratorResult.severity,
                message: migratorResult.message,
                riskFactors: migratorResult.riskFactors,
              };
            }
          } catch (err) {
            logger.warn({ consultaId, err }, "MIGRADOR detection error (non-blocking)");
          }
        }

        // Credit cost: 1 per external provider found
        const externalProviders = new Set(allCustomers.filter(c => !c.isSameProvider).map(c => c.providerId));
        const creditsCost = externalProviders.size;

        // Alerta de risco por endereco — cruza endereco completo com inadimplentes da rede
        let addressRiskAlerts: { cpfMasked: string; nomeMascarado: string; overdueRange: string; maxDaysOverdue: number; status: string; matchType: string }[] = [];
        try {
          // Pegar endereco do cliente proprio ou do primeiro resultado do ERP
          const addrSource = ownCustomer || allCustomers[0];
          const erpCep = addrSource?.cep || "";
          const erpAddress = addrSource?.address || "";
          const erpNumber = addrSource?.addressNumber || "";
          const erpCity = addrSource?.city || "";
          if (erpNumber) {
            addressRiskAlerts = await storage.getCustomersByAddressForAlert({
              cep: erpCep,
              address: erpAddress,
              addressNumber: erpNumber,
              city: erpCity,
              excludeCpfCnpj: cleaned,
            });
          }
        } catch (err) {
          // Era console.warn: fora do pino, a linha nao carrega campo nenhum e
          // por isso ficava impossivel de ligar a uma consulta. Mesma mensagem,
          // agora com contexto.
          logger.warn({ consultaId, err }, "[ConsultaISP] Erro ao buscar alerta de endereco");
        }

        const result = {
          cpfCnpj: cleaned,
          searchType,
          notFound,
          baseLegal: "Legitimo Interesse (LGPD Art. 7, IX)",
          finalidadeConsulta: "Analise de credito e protecao ao credito no ambito de servicos de telecomunicacoes",
          controlador: provider.name,
          score: scoreResult.score,
          score100: scoreResult.score100, // RT-03: canonical 0-100 from score engine
          faixa: scoreResult.faixa,
          nivelRisco: scoreResult.nivelRisco,
          corIndicador: scoreResult.corIndicador,
          sugestaoIA: scoreResult.sugestaoIA,
          composicaoScore: scoreResult.composicao,
          riskTier: scoreResult.nivelRisco,
          riskLabel: scoreResult.faixa === "excelente" ? "RISCO BAIXO" : scoreResult.faixa === "bom" ? "RISCO MODERADO" : scoreResult.faixa === "baixo" ? "RISCO ALTO" : "RISCO CRITICO",
          recommendation: scoreResult.sugestaoIA,
          decisionReco: scoreResult.sugestaoIA === "APROVAR" ? "Accept" : scoreResult.sugestaoIA === "REJEITAR" ? "Reject" : "Review",
          providersFound: new Set(allCustomers.map(c => c.providerId)).size,
          providerDetails,
          alerts: [
            ...alerts,
            ...scoreResult.alertas,
            ...(addressSearchResult?.risk.alertas || []),
            ...(migratorAlert ? [migratorAlert.message] : []),
          ],
          recommendedActions: scoreResult.condicoesSugeridas,
          creditsCost,
          isOwnCustomer,
          // Sem addressGroups: e o contexto cru, que levava o providerId do
          // parceiro — e era gravado. A visao sanitizada e `addressMatches`.
          addressSearch: addressSearchResult
            ? (({ addressGroups: _grupos, ...resto }) => resto)(addressSearchResult)
            : null,
          addressRiskAlerts: addressRiskAlerts.length > 0 ? {
            type: "address_risk",
            message: `Este endereco tem ${addressRiskAlerts.length} registro(s) de inadimplencia na rede ISP`,
            matches: addressRiskAlerts,
          } : null,
          // Backward compat: frontend consumers expect addressMatches[] for the address-crossing UI
          // V-01 LGPD fix: mask cross-provider data in addressMatches
          addressMatches: addressSearchResult
            ? addressSearchResult.addressGroups.flatMap(g =>
                g.customers.map(c => {
                  const isSame = c.isSameProvider;
                  return {
                    customerName: isSame ? c.name : maskName(c.name, false),
                    cpfCnpj: isSame ? c.cpfCnpj : maskCpfCnpj(c.cpfCnpj, false),
                    address: `${g.cep}, nº ${g.numero}${g.complemento ? `, ${g.complemento}` : ""}`,
                    city: "",
                    state: undefined as string | undefined,
                    // Ja mascarado pelo address-search com este observador. Anonimizar
                    // de novo gerava um terceiro codigo, a partir do proprio codigo.
                    providerName: c.providerName,
                    isSameProvider: isSame,
                    status: c.maxDaysOverdue > 90 ? "Inadimplente (90+ dias)"
                      : c.maxDaysOverdue > 60 ? "Inadimplente (61-90 dias)"
                      : c.maxDaysOverdue > 30 ? "Inadimplente (31-60 dias)"
                      : c.maxDaysOverdue > 0 ? "Inadimplente (1-30 dias)"
                      : "Em dia",
                    daysOverdue: isSame ? c.maxDaysOverdue : undefined,
                    daysOverdueRange: isSame ? undefined : maskDaysOverdue(c.maxDaysOverdue),
                    totalOverdue: isSame ? c.totalOverdueAmount : undefined,
                    totalOverdueRange: isSame ? undefined : maskOverdueAmount(c.totalOverdueAmount, false),
                    hasDebt: c.maxDaysOverdue > 0,
                  };
                })
              )
            : [],
          migratorAlert,
          addressSource,
          addressUsed,
          addressParts,
          autoAddressCrossRef,
          source: "erp_direct",
          // De quando e o dado que o operador esta lendo. A consulta e sempre ao
          // vivo, entao a resposta e sempre "agora" — mas o campo fica, porque e
          // o que deixa isso explicito na tela em vez de subentendido.
          frescor: {
            origem: "erp_ao_vivo" as const,
            sincronizadoEm: new Date().toISOString(),
            idadeHoras: 0,
            descricao: "consultado ao vivo no ERP",
          },
          // So a linha do proprio ERP. Uma linha por parceiro — ERP usado,
          // latencia, texto de erro com hostname, ordem por id — identificava
          // sem precisar de nome. Os parceiros ficam so nos agregados abaixo.
          erpLatencies: erpResults
            .filter(r => r.providerId === providerId)
            .map(r => ({ provider: r.providerName, erp: r.erpSource, ok: r.ok, ms: r.latencyMs, error: r.error })),
          erpSummary: {
            total: erpResults.length,
            responded: erpResults.filter(r => r.ok).length,
            failed: erpResults.filter(r => !r.ok).length,
            timedOut: erpResults.filter(r => r.timedOut).length,
          },
        };

        // V-08 LGPD: hash CPF for storage, keep original only in masked result JSONB
        let cpfCnpjHash: string | undefined;
        try {
          cpfCnpjHash = hashCPFForNetwork(cleaned);
        } catch {
          logger.warn({ consultaId }, "NETWORK_CPF_SALT not configured — CPF hash will be absent. Configure NETWORK_CPF_SALT in .env for LGPD compliance.");
        }

        // LGPD audit: only persist consent metadata when explicitly validated
        const lgpdConsent = lgpdConsentGiven
          ? { lgpdAccepted: true as const, lgpdAcceptedAt: new Date().toISOString(), lgpdSource: "api_request" as const }
          : { lgpdAccepted: false as const, lgpdAcceptedAt: null, lgpdSource: "legacy_deprecation_window" as const };

        const consultationPayload = {
          providerId,
          userId: req.session.userId!,
          cpfCnpj: cleaned,
          cpfCnpjHash,
          searchType,
          // O codigo vai na COLUNA, nao dentro do result: e por ela que o
          // suporte procura a linha, e o indice unico so cobre a coluna.
          consultaId,
          result: { ...result, ...lgpdConsent },
          score: scoreResult.score,
          decisionReco: result.decisionReco,
          cost: creditsCost,
          approved: scoreResult.score >= 500,
        };

        let consultation;
        if (creditsCost > 0) {
          const txResult = await storage.debitAndCreateIspConsultation(providerId, creditsCost, consultationPayload);
          if (!txResult) {
            const currentProvider = await storage.getProvider(providerId);
            // A consulta JA ACONTECEU aqui: os ERPs foram chamados e o score
            // foi calculado. So a gravacao nao coube no saldo — e o dono do CPF
            // NAO chega a ser avisado, porque o aviso sai depois da gravacao.
            // Sem esta linha o codigo que o provedor tem na tela nao existiria
            // em lugar nenhum do servidor.
            logger.warn(
              { consultaId, providerId, motivo: "saldo_insuficiente", creditosNecessarios: creditsCost, creditosDisponiveis: currentProvider?.ispCredits ?? 0 },
              "CONSULTA executada mas nao gravada",
            );
            return res.status(402).json({
              message: `Creditos insuficientes. Requer ${creditsCost} credito(s). Voce tem ${currentProvider?.ispCredits ?? 0}.`,
              consultaId,
            });
          }
          consultation = txResult.consultation;
        } else {
          consultation = await storage.createIspConsultation(consultationPayload);
        }

        // ── CACHE STORE (CACHE-01) ─────────────────────────────────
        consultationCache.setResult(cleaned, providerId, searchType, {
          result,
          consultation,
          cachedAt: Date.now(),
        });

        // ── PROACTIVE ALERT (NM3) ──────────────────────────────────
        // Notify owner providers asynchronously — never block the response
        // Roda SEMPRE, nao so quando algum ERP trouxe o cliente: o dono cujo
        // ERP nao respondeu (fora da regiao, fora do ar, timeout) e avisado
        // pela base sincronizada — ver proactive-alert.service.ts.
        if (searchType === "cpf" || searchType === "cnpj") {
          const responderam = new Set(erpResults.filter(r => r.ok).map(r => r.providerId));
          // O registro CRU de cada ERP, com a data de contrato — que de
          // proposito NAO viaja no resultado da consulta. Aqui ela so serve
          // para avaliar a regra "cliente novo" do proprio dono, no servidor.
          const aoVivo = erpResults
            .filter(r => r.ok)
            .flatMap(r => r.customers
              .filter(c => (c.cpfCnpj || "").replace(/\D/g, "") === cleaned)
              .map(c => ({
                providerId: r.providerId,
                providerName: r.providerName,
                name: c.name,
                contractStatus: c.contractStatus,
                contractStartDate: c.contractStartDate || c.registrationDate,
                totalOverdueAmount: c.totalOverdueAmount,
                maxDaysOverdue: c.maxDaysOverdue,
              })));
          // Quem consultou este CPF em 30 dias, incluindo agora — a regra de
          // consultas repetidas conta provedores diferentes do dono.
          const provedoresConsultando = Array.from(new Set([providerId, ...recentConsultations.map(c => c.providerId)]));
          setImmediate(() => {
            notifyOwnerProviders(cleaned, aoVivo, providerId, responderam, provedoresConsultando).catch(err =>
              logger.error({ consultaId, err }, "Proactive alert failed"),
            );
          });
        }

        const response: Record<string, any> = { consultaId, consultation, result };
        if (deprecationWarnings.length > 0) {
          response.warnings = deprecationWarnings;
          res.setHeader("X-Deprecation-Warning", "lgpdAccepted will be required after 2026-07-01");
        }
        return res.json(response);
      }
      // Sem ERP na regiao a consulta nao traz nada — mas ela ACONTECEU, e o
      // dono do CPF, onde estiver, tem o direito de saber. A base sincronizada
      // e quem decide se ha um cliente ativo e inadimplente a avisar.
      if (searchType === "cpf" || searchType === "cnpj") {
        setImmediate(async () => {
          try {
            const recentes = await storage.getRecentConsultationsForDocument(cleaned, 30);
            const provedoresConsultando = Array.from(new Set([providerId, ...recentes.map(c => c.providerId)]));
            await notifyOwnerProviders(cleaned, [], providerId, new Set(), provedoresConsultando);
          } catch (err) {
            logger.error({ consultaId, err }, "Proactive alert failed");
          }
        });
      }

      // A consulta ACONTECEU — o dono do CPF ate foi notificado acima — mas nao
      // ha linha em isp_consultations para ela: sem ERP na regiao nao ha
      // resultado a gravar nem credito a cobrar. Este e o caso em que o suporte
      // hoje nao tinha absolutamente nada para procurar.
      logger.info(
        { consultaId, providerId, searchType, motivo: "sem_erp_na_regiao" },
        "CONSULTA sem resultado — nada gravado",
      );

      // No ERP integrations configured for this provider's region
      const noErpResponse: Record<string, any> = {
        consultaId,
        consultation: null,
        result: {
          cpfCnpj: cleaned, searchType, notFound: true, score: 1000,
          faixa: "excelente", nivelRisco: "baixo", sugestaoIA: "APROVAR",
          corIndicador: "verde", riskLabel: "SEM DADOS NA REDE",
          recommendation: "Nenhum provedor com ERP configurado na sua regiao",
          decisionReco: "Review", providersFound: 0, providerDetails: [],
          // A frase mandava o provedor "Configurar em Integracoes" — tela que ele
          // nao tem mais desde 03/09/2026: a configuracao de ERP passou a ser do
          // superadmin e a aba dele virou somente leitura. Mandar alguem fazer o
          // que acabou de ser tirado dele gera chamado, nao solucao.
          alerts: ["Nenhum provedor da sua regiao tem ERP integrado. Fale com o suporte para integrar o seu."],
          recommendedActions: [], creditsCost: 0, isOwnCustomer: false,
          addressSource: null, addressUsed: null, addressParts: null, autoAddressCrossRef: false,
          source: "no_erp",
        },
      };
      if (deprecationWarnings.length > 0) {
        noErpResponse.warnings = deprecationWarnings;
        res.setHeader("X-Deprecation-Warning", "lgpdAccepted will be required after 2026-07-01");
      }
      return res.json(noErpResponse);


    } catch (error: any) {
      logger.error({ consultaId, err: error }, "ISP consultation error");
      return res.status(500).json({ message: getSafeErrorMessage(error), consultaId });
    }
  });

  router.get("/api/isp-consultations/timeline/:cpfCnpj", ispConsultaLimiter, requireAuth, requireProvider, async (req, res) => {
    try {
      const validacao = validarCpfCnpj(req.params.cpfCnpj);
      if (!validacao.valid) {
        return res.status(400).json({ message: validacao.error });
      }
      const { cleaned } = validacao;

      const providerId = req.session.providerId!;
      const regionalProviderIds = await getRegionalProviderIds(providerId);
      const allProviderIds = [providerId, ...regionalProviderIds];

      const consultations = await storage.getConsultationTimeline(cleaned, allProviderIds, 50);

      // So o nome do PROPRIO provedor aparece; o parceiro vira o codigo pareado
      // deste observador — nao ha por que carregar o nome de ninguem.
      const meuNome = (await storage.getProvider(providerId))?.name || "Seu provedor";

      const timeline = consultations.map(c => {
        const isSameProvider = c.providerId === providerId;
        const resultData = c.result as any;

        const alerts: string[] = [];
        if (resultData?.migratorAlert?.detected) {
          alerts.push("Migrador detectado");
        }
        if (resultData?.nivelRisco === "critico" || resultData?.nivelRisco === "alto") {
          alerts.push(`Risco ${resultData.nivelRisco}`);
        }

        return {
          date: c.createdAt,
          score: c.score,
          decision: c.decisionReco,
          searchType: c.searchType,
          // So o codigo: a tela ja prefixa "Provedor parceiro · ".
          provider: isSameProvider ? meuNome : generatePartnerCode(providerId, c.providerId),
          alerts,
          isSameProvider,
        };
      });

      return res.json({ timeline });
    } catch (error: any) {
      logger.error({ err: error }, "Timeline fetch error");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/isp-consultations/benchmark", requireAuth, requireProvider, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const regionalProviderIds = await getRegionalProviderIds(providerId);
      const allProviderIds = [providerId, ...regionalProviderIds];

      const [regionalStats30, ownStats30, regionalStats60, regionalAlerts, ownAlerts, topCeps] = await Promise.all([
        storage.getRegionalScoreStats(allProviderIds, 30),
        storage.getRegionalScoreStats([providerId], 30),
        storage.getRegionalScoreStats(allProviderIds, 60),
        storage.getRegionalAlertCount(allProviderIds, 30),
        storage.getRegionalAlertCount([providerId], 30),
        storage.getTopRiskCeps(allProviderIds, 30, 5),
      ]);

      const prev30Consultations = regionalStats60.totalConsultations - regionalStats30.totalConsultations;
      const prev30AvgScore = prev30Consultations > 0
        ? ((regionalStats60.avgScore * regionalStats60.totalConsultations) - (regionalStats30.avgScore * regionalStats30.totalConsultations)) / prev30Consultations
        : 0;
      const scoreDeltaPct = prev30AvgScore > 0
        ? ((regionalStats30.avgScore - prev30AvgScore) / prev30AvgScore) * 100
        : 0;

      res.json({
        own: {
          avgScore: Math.round(ownStats30.avgScore),
          totalConsultations: ownStats30.totalConsultations,
          inadimplenciaPct: ownStats30.totalConsultations > 0
            ? Math.round((ownStats30.belowThresholdCount / ownStats30.totalConsultations) * 100 * 10) / 10
            : 0,
        },
        regional: {
          avgScore: Math.round(regionalStats30.avgScore),
          totalConsultations: regionalStats30.totalConsultations,
          inadimplenciaPct: regionalStats30.totalConsultations > 0
            ? Math.round((regionalStats30.belowThresholdCount / regionalStats30.totalConsultations) * 100 * 10) / 10
            : 0,
        },
        migradores: { own: ownAlerts, regional: regionalAlerts },
        topRiskCeps: topCeps.map(c => ({
          cep: c.cep.length >= 5 ? c.cep.slice(0, 5) + "-***" : c.cep,
          avgScore: Math.round(c.avgScore),
          count: c.count,
        })),
        trend: {
          scoreDeltaPct: Math.round(scoreDeltaPct * 10) / 10,
          direction: scoreDeltaPct > 2 ? "up" : scoreDeltaPct < -2 ? "down" : "stable",
        },
        providersInRegion: allProviderIds.length,
      });
    } catch (err) {
      console.error("Benchmark error:", err);
      res.status(500).json({ error: "Erro ao calcular benchmark regional" });
    }
  });

  router.get("/api/spc-consultations", requireAuth, requireProvider, async (req, res) => {
    try {
      const brutas = await storage.getSpcConsultationsByProvider(req.session.providerId!);
      // O XML cru fica no banco para auditoria; a tela recebe so o resultado.
      const consultations = brutas.map(c => {
        const r = (c.result ?? {}) as Record<string, unknown>;
        const { rawXml: _xml, ...semXml } = r;
        return { ...c, result: semXml };
      });
      const today = await storage.getSpcConsultationCountToday(req.session.providerId!);
      const month = await storage.getSpcConsultationCountMonth(req.session.providerId!);
      const provider = await storage.getProvider(req.session.providerId!);
      // Saldo unico: a consulta SPC debita de isp_credits (ver debitAndCreateSpcConsultation).
      return res.json({ consultations, todayCount: today, monthCount: month, credits: provider?.ispCredits || 0 });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/spc-consultations", spcConsultaLimiter, requireAuth, requireProvider, async (req, res) => {
    // Mesmo contrato da consulta ISP: o codigo nasce antes do SPC, do saldo e
    // da validacao, porque e nas saidas que NAO gravam linha que ele faz falta.
    const consultaId = gerarIdentificadorDeConsulta();
    try {
      const { cpfCnpj } = req.body;
      if (!cpfCnpj) {
        return res.status(400).json({ message: "CPF/CNPJ obrigatorio", consultaId });
      }

      // Check feature flag
      if (!isSpcConfigured()) {
        logger.info({ consultaId, providerId: req.session.providerId, motivo: "spc_nao_configurado" }, "CONSULTA SPC recusada — nada gravado");
        res.setHeader("X-Feature-Status", "coming-soon");
        return res.status(503).json({
          message: "Consulta SPC temporariamente indisponivel. Integracao em fase de implantacao.",
          featureStatus: "coming_soon",
          eta: null,
          consultaId,
        });
      }

      // Saldo unico (isp_credits): e dele que debitAndCreateSpcConsultation
      // desconta. O preco vem de CUSTO_EM_CREDITOS, o unico lugar onde existe.
      const custo = CUSTO_EM_CREDITOS.spc;
      const provider = await storage.getProvider(req.session.providerId!);
      if (!provider || (provider.ispCredits || 0) < custo) {
        logger.info(
          { consultaId, providerId: req.session.providerId, motivo: "saldo_insuficiente", creditosNecessarios: custo, creditosDisponiveis: provider?.ispCredits ?? 0 },
          "CONSULTA SPC recusada — nada gravado",
        );
        return res.status(402).json({
          message: `Saldo insuficiente: a consulta SPC custa ${custo} créditos e você tem ${provider?.ispCredits ?? 0}.`,
          creditosNecessarios: custo,
          creditosDisponiveis: provider?.ispCredits ?? 0,
          consultaId,
        });
      }

      // Digito verificador conferido aqui: documento digitado errado nao vai
      // ao SPC (o Fault E8.2 nao custa credito, mas gasta chamada do operador).
      const validacaoSpc = validarCpfCnpj(String(cpfCnpj));
      if (!validacaoSpc.valid) {
        logger.info({ consultaId, providerId: req.session.providerId, motivo: "documento_invalido" }, "CONSULTA SPC recusada — nada gravado");
        return res.status(400).json({ message: validacaoSpc.error, consultaId });
      }
      if (validacaoSpc.type === "cep") {
        logger.info({ consultaId, providerId: req.session.providerId, motivo: "documento_e_cep" }, "CONSULTA SPC recusada — nada gravado");
        return res.status(400).json({ message: "Informe um CPF ou CNPJ", consultaId });
      }
      const cleaned = validacaoSpc.cleaned;

      // A consulta vem ANTES do debito: SPC fora do ar, credencial recusada ou
      // documento invalido nao custam credito. O XML cru fica gravado para
      // auditoria (e o que o SPC entregou, com protocolo), mas nao vai ao
      // navegador.
      const result = await consultarSpc(cleaned, { guardarXml: true, consultaId });
      const { rawXml, ...paraTela } = result;

      const saved = await storage.debitAndCreateSpcConsultation(
        req.session.providerId!,
        custo,
        {
          providerId: req.session.providerId!,
          userId: req.session.userId!,
          cpfCnpj: cleaned,
          consultaId,
          result: { ...paraTela, rawXml, creditosCobrados: custo },
          score: result.score,
        },
      );

      if (!saved) {
        // O SPC ja foi consultado e respondeu; o saldo caiu entre a conferencia
        // acima e o debito (outra consulta em paralelo). Nada sobra no banco.
        logger.warn(
          { consultaId, providerId: req.session.providerId, motivo: "saldo_insuficiente_no_debito", creditosNecessarios: custo },
          "CONSULTA SPC executada mas nao gravada",
        );
        return res.status(402).json({ message: "Saldo insuficiente para a consulta SPC", consultaId });
      }

      return res.json({ consultaId, result: paraTela, credits: saved.provider.ispCredits });
    } catch (error: any) {
      if (error instanceof SpcError) {
        // Nao e erro nosso: e o SPC dizendo algo. Vai com o status certo e a
        // mensagem em portugues, sem stack.
        logger.warn({ consultaId, categoria: error.categoria, codigo: error.codigo, msg: error.message }, "SPC consultation refused");
        // Credencial e produto sao problema da PLATAFORMA (operador do SPC),
        // nao do provedor: ele recebe aviso generico; o motivo fica no log e
        // em GET /api/admin/spc/produtos.
        const daPlataforma = error.categoria === "credencial" || error.categoria === "produto";
        return res.status(statusHttpParaErroSpc(error)).json({
          message: daPlataforma
            ? "Consulta SPC indisponível no momento por configuração da plataforma. Nenhum crédito foi cobrado; tente mais tarde ou fale com o suporte."
            : error.message,
          categoria: error.categoria,
          // O nosso codigo, nao o protocolo do SPC: quando o SPC recusa nao ha
          // protocolo nenhum, e e justamente ai que o provedor precisa de um
          // numero para apresentar ao suporte.
          consultaId,
        });
      }
      logger.error({ consultaId, err: error }, "SPC consultation error");
      return res.status(500).json({ message: getSafeErrorMessage(error), consultaId });
    }
  });

  return router;
}
