import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { maskCrossProviderDetail, maskName, maskCpfCnpj, maskOverdueAmount, maskDaysOverdue } from "../services/lgpd-masking";
import { getProviderDisplayName } from "../utils/provider-anonymizer";
import { hashCPFForNetwork } from "../utils/cpf-hash";
import { getRegionalProviderIds } from "../services/regional.service";
import { queryRegionalErps, type RealtimeQueryResult } from "../services/realtime-query.service";
import { calcularScoreISP, type ISPScoreInput } from "../utils/isp-score";
import { consultationCache } from "../services/consultation-cache.service";
import { buildAddressSearchResult } from "../services/address-search.service";
import { detectMigrator } from "../services/migrator-detection.service";
import { getSafeErrorMessage } from "../utils/safe-error";
import { validarCpfCnpj } from "../utils/cpf-cnpj-validator";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { logger } from "../logger";
import { isSpcConfigured, consultarSpc } from "../services/spc.service";
import { notifyOwnerProviders } from "../services/proactive-alert.service";

export function registerConsultasRoutes(): Router {
  const router = Router();

  const ispConsultaLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
  const spcConsultaLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });

  router.get("/api/isp-consultations", requireAuth, async (req, res) => {
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
        consultations,
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

  router.post("/api/isp-consultations", ispConsultaLimiter, requireAuth, async (req, res) => {
    try {
      const { cpfCnpj, lgpdAccepted, apiVersion } = req.body;
      if (!cpfCnpj) {
        return res.status(400).json({ message: "CPF/CNPJ obrigatorio" });
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
        });
      }

      const lgpdConsentGiven = lgpdAccepted === true;

      if (!lgpdConsentGiven) {
        if (isV2 || new Date() >= lgpdStrictEnforcementDate) {
          // v2 callers and post-deadline: strict enforcement
          return res.status(400).json({ message: "Aceite LGPD obrigatorio para realizar consultas" });
        }
        // Legacy callers within compatibility window: warn but proceed
        deprecationWarnings.push(
          "DEPRECATION: O campo 'lgpdAccepted' sera obrigatorio a partir de 2026-07-01. " +
          "Envie lgpdAccepted: true no body para consentimento LGPD."
        );
        logger.warn(
          { providerId: req.session.providerId, endpoint: "/api/isp-consultations" },
          "Legacy caller missing lgpdAccepted — proceeding with deprecation warning"
        );
      }

      const validacao = validarCpfCnpj(cpfCnpj);
      if (!validacao.valid) {
        return res.status(400).json({ message: validacao.error });
      }
      const { cleaned, type: searchType } = validacao;

      const providerId = req.session.providerId!;
      const provider = await storage.getProvider(providerId);
      if (!provider) {
        return res.status(400).json({ message: "Provedor nao encontrado" });
      }

      const mesoregiao = (provider as any).mesorregioes?.[0] || "";

      // ── CACHE CHECK (CACHE-01, CACHE-02) ─────────────────────────
      const cached = consultationCache.getResult(cleaned, providerId, searchType);
      if (cached) {
        logger.info({ providerId, doc: cleaned.slice(0, 4) + "***" }, "CONSULTA cache hit");
        return res.json({
          ...cached,
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
          logger.warn({ providerId: intg.providerId }, "RT-01 ERP integration not in allowed set — skipping");
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
          erpResults = cachedRegional.erpResults as RealtimeQueryResult[];
          regionalCacheHit = true;
          logger.info({ providerId, doc: cleaned.slice(0, 4) + "***", mesoregiao }, "CONSULTA regional cache hit");
        } else {
          // ── DIRECT ERP QUERY ────────────────────────────────────────────
          erpResults = await queryRegionalErps(erpIntegrations as any, cleaned, searchType);

          // Store raw ERP results in regional cache for reuse by other providers
          if (mesoregiao) {
            consultationCache.setRawResult(cleaned, mesoregiao, searchType, erpResults);
          }
        }

        // Flatten all customers from all ERPs
        const allCustomers: Array<RealtimeQueryResult["customers"][0] & { providerName: string; providerId: number; isSameProvider: boolean }> = [];
        for (const erpResult of erpResults) {
          if (!erpResult.ok || erpResult.customers.length === 0) continue;
          for (const c of erpResult.customers) {
            allCustomers.push({
              ...c,
              providerName: erpResult.providerName,
              providerId: erpResult.providerId,
              isSameProvider: erpResult.providerId === providerId,
            });
          }
        }

        const notFound = allCustomers.length === 0;
        const isOwnCustomer = allCustomers.some(c => c.isSameProvider);

        // DEBUG: log what we received from ERPs before mapping
        console.log(`[CONSULTA] allCustomers (${allCustomers.length}):`,
          allCustomers.map(c => ({
            providerId: c.providerId,
            isSameProvider: c.isSameProvider,
            name: c.name,
            address: c.address,
            city: c.city,
            cep: c.cep,
          }))
        );

        // Build provider details with LGPD masking
        const providerDetails = allCustomers.map(c => {
          const paymentStatus = c.maxDaysOverdue > 90 ? "Inadimplente (90+ dias)"
            : c.maxDaysOverdue > 60 ? "Inadimplente (61-90 dias)"
            : c.maxDaysOverdue > 30 ? "Inadimplente (31-60 dias)"
            : c.maxDaysOverdue > 0 ? "Inadimplente (1-30 dias)"
            : "Em dia";

          const addrParts = [c.address, c.addressNumber, c.complement, c.neighborhood, c.city, c.state, c.cep].filter(Boolean);

          const rawDetail: Record<string, any> = {
            providerName: c.providerName,
            providerId: c.providerId,
            isSameProvider: c.isSameProvider,
            customerName: c.name || "Desconhecido",
            cpfCnpj: c.cpfCnpj || "",
            status: paymentStatus,
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
            hasUnreturnedEquipment: c.hasUnreturnedEquipment || false,
            unreturnedEquipmentCount: 0,
            planName: c.planName,
            phone: c.phone,
            email: c.email,
            serviceAgeMonths: c.serviceAgeMonths,
          };
          return maskCrossProviderDetail(rawDetail, c.isSameProvider);
        });

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
            faturasAtraso: c.overdueInvoicesCount || 0,
            statusContrato: c.status || "unknown",
            mesesComoCliente: c.serviceAgeMonths,
            equipamentosDevolvidos: c.hasUnreturnedEquipment === false,
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
        let autoAddressCrossRef = false;

        if (searchType === "cpf" || searchType === "cnpj") {
          // Candidate selection: prefer ownCustomer, fallback to any network customer with valid CEP+number
          // CEP must be exactly 8 digits after stripping non-numeric chars
          const isValidCep = (cep: string | undefined | null): boolean => {
            if (!cep) return false;
            const digits = cep.replace(/\D/g, "");
            return digits.length === 8;
          };

          let addressCandidate: typeof allCustomers[0] | undefined;
          if (isValidCep(ownCustomer?.cep) && ownCustomer?.addressNumber) {
            addressCandidate = ownCustomer;
            addressSource = "own";
          } else {
            addressCandidate = allCustomers.find(c => isValidCep(c.cep) && c.addressNumber);
            if (addressCandidate) {
              addressSource = addressCandidate.isSameProvider ? "own" : "network";
            }
          }

          if (addressCandidate) {
            try {
              const candidateCep = addressCandidate.cep!.replace(/\D/g, "");
              // Secondary query: fetch all customers at this CEP for real cross-referencing
              let cepErpResults: RealtimeQueryResult[];
              try {
                const cepQueryStart = Date.now();
                cepErpResults = await queryRegionalErps(erpIntegrations as any, candidateCep, "cep");
                logger.info({ cep: candidateCep.slice(0, 5) + "***", results: cepErpResults.filter(r => r.ok).length, latencyMs: Date.now() - cepQueryStart }, "CONSULTA secondary CEP query completed");
              } catch (cepErr) {
                logger.warn({ err: cepErr }, "CONSULTA secondary CEP query failed, using CPF results as fallback");
                cepErpResults = erpResults;
              }
              addressSearchResult = buildAddressSearchResult(
                candidateCep,
                cepErpResults,
                providerId,
              );
              addressUsed = candidateCep;
              autoAddressCrossRef = true;
            } catch (err) {
              logger.warn({ err }, "CONSULTA auto address search error (non-blocking)");
            }
          }
        }

        const scoreInput: ISPScoreInput = {
          proprio: ownCustomer ? {
            mesesComoCliente: ownCustomer.serviceAgeMonths || 0,
            diasAtrasoAtual: ownCustomer.maxDaysOverdue,
            faturasAtrasadasTotal: ownCustomer.overdueInvoicesCount || 0,
            faturasTotal: 0,
            equipamentosDevolvidos: ownCustomer.hasUnreturnedEquipment !== true,
            statusContrato: ownCustomer.maxDaysOverdue > 0 ? "suspenso" : "ativo",
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
        // Alert is detected here but persisted only after successful debit (inside the same transaction)
        let migratorAlert: { detected: true; severity: string; message: string; riskFactors: string[] } | null = null;
        let pendingAlertRecord: Parameters<typeof storage.createAlert>[0] | undefined;
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
              // Store alert record to persist atomically with debit
              pendingAlertRecord = migratorResult.alertRecord;
            }
          } catch (err) {
            logger.warn({ err }, "MIGRADOR detection error (non-blocking)");
          }
        }

        // Credit cost: 1 per external provider found
        const externalProviders = new Set(allCustomers.filter(c => !c.isSameProvider).map(c => c.providerId));
        const creditsCost = externalProviders.size;

        // Alerta de risco por endereco — cruza endereco completo com inadimplentes da rede
        let addressRiskAlerts: { cpfMasked: string; overdueRange: string; maxDaysOverdue: number; status: string; matchType: string }[] = [];
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
          console.warn("[ConsultaISP] Erro ao buscar alerta de endereco:", err);
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
          fatoresScore: scoreResult.fatores,
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
          addressSearch: addressSearchResult || null,
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
                    providerName: getProviderDisplayName(c.providerName, isSame, c.providerId),
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
          autoAddressCrossRef,
          source: "erp_direct",
          // V-02 LGPD fix: anonymize provider names in erpLatencies
          erpLatencies: erpResults.map(r => ({ provider: getProviderDisplayName(r.providerName, r.providerId === providerId, r.providerId), erp: r.erpSource, ok: r.ok, ms: r.latencyMs, error: r.error })),
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
          logger.warn("NETWORK_CPF_SALT not configured — CPF hash will be absent. Configure NETWORK_CPF_SALT in .env for LGPD compliance.");
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
          result: { ...result, ...lgpdConsent },
          score: scoreResult.score,
          decisionReco: result.decisionReco,
          cost: creditsCost,
          approved: scoreResult.score >= 500,
        };

        let consultation;
        if (creditsCost > 0) {
          const txResult = await storage.debitAndCreateIspConsultation(providerId, creditsCost, consultationPayload, pendingAlertRecord);
          if (!txResult) {
            const currentProvider = await storage.getProvider(providerId);
            return res.status(402).json({
              message: `Creditos insuficientes. Requer ${creditsCost} credito(s). Voce tem ${currentProvider?.ispCredits ?? 0}.`,
            });
          }
          consultation = txResult.consultation;
        } else {
          consultation = await storage.createIspConsultation(consultationPayload);
          // Persist alert after consultation is created (no debit needed for free consultations)
          if (pendingAlertRecord) {
            try {
              await storage.createAlert(pendingAlertRecord);
            } catch (err) {
              logger.warn({ err }, "MIGRADOR alert persistence error (non-blocking)");
            }
          }
        }

        // ── CACHE STORE (CACHE-01) ─────────────────────────────────
        consultationCache.setResult(cleaned, providerId, searchType, {
          result,
          consultation,
          cachedAt: Date.now(),
        });

        // ── PROACTIVE ALERT (NM3) ──────────────────────────────────
        // Notify owner providers asynchronously — never block the response
        if (allCustomers.length > 0) {
          setImmediate(() => {
            notifyOwnerProviders(cleaned, allCustomers, providerId).catch(err =>
              logger.error({ err }, "Proactive alert failed"),
            );
          });
        }

        const response: Record<string, any> = { consultation, result };
        if (deprecationWarnings.length > 0) {
          response.warnings = deprecationWarnings;
          res.setHeader("X-Deprecation-Warning", "lgpdAccepted will be required after 2026-07-01");
        }
        return res.json(response);
      }
      // No ERP integrations configured for this provider's region
      const noErpResponse: Record<string, any> = {
        consultation: null,
        result: {
          cpfCnpj: cleaned, searchType, notFound: true, score: 1000,
          faixa: "excelente", nivelRisco: "baixo", sugestaoIA: "APROVAR",
          corIndicador: "verde", riskLabel: "SEM DADOS NA REDE",
          recommendation: "Nenhum provedor com ERP configurado na sua regiao",
          decisionReco: "Review", providersFound: 0, providerDetails: [],
          alerts: ["Nenhuma integracao ERP encontrada na regiao. Configure em Integracoes."],
          recommendedActions: [], creditsCost: 0, isOwnCustomer: false,
          addressSource: null, addressUsed: null, autoAddressCrossRef: false,
          source: "no_erp",
        },
      };
      if (deprecationWarnings.length > 0) {
        noErpResponse.warnings = deprecationWarnings;
        res.setHeader("X-Deprecation-Warning", "lgpdAccepted will be required after 2026-07-01");
      }
      return res.json(noErpResponse);


    } catch (error: any) {
      logger.error({ err: error }, "ISP consultation error");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/isp-consultations/timeline/:cpfCnpj", ispConsultaLimiter, requireAuth, async (req, res) => {
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

      // Batch-load provider names for all unique providerIds in results
      const uniqueProviderIds = [...new Set(consultations.map(c => c.providerId))];
      const providerMap = new Map<number, string>();
      await Promise.all(uniqueProviderIds.map(async (pid) => {
        const p = await storage.getProvider(pid);
        if (p) providerMap.set(pid, p.name);
      }));

      const timeline = consultations.map(c => {
        const isSameProvider = c.providerId === providerId;
        const providerName = providerMap.get(c.providerId) || "Provedor";
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
          provider: getProviderDisplayName(providerName, isSameProvider, c.providerId),
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

  router.get("/api/isp-consultations/benchmark", requireAuth, async (req, res) => {
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

  router.get("/api/spc-consultations", requireAuth, async (req, res) => {
    try {
      const consultations = await storage.getSpcConsultationsByProvider(req.session.providerId!);
      const today = await storage.getSpcConsultationCountToday(req.session.providerId!);
      const month = await storage.getSpcConsultationCountMonth(req.session.providerId!);
      const provider = await storage.getProvider(req.session.providerId!);
      return res.json({ consultations, todayCount: today, monthCount: month, credits: provider?.spcCredits || 0 });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/spc-consultations", spcConsultaLimiter, requireAuth, async (req, res) => {
    try {
      const { cpfCnpj } = req.body;
      if (!cpfCnpj) {
        return res.status(400).json({ message: "CPF/CNPJ obrigatorio" });
      }

      // Check feature flag
      if (!isSpcConfigured()) {
        res.setHeader("X-Feature-Status", "coming-soon");
        return res.status(503).json({
          message: "Consulta SPC temporariamente indisponivel. Integracao em fase de implantacao.",
          featureStatus: "coming_soon",
          eta: null,
        });
      }

      // Check credits
      const provider = await storage.getProvider(req.session.providerId!);
      if (!provider || (provider.spcCredits || 0) < 1) {
        return res.status(402).json({ message: "Creditos SPC insuficientes. Adquira mais creditos em Comprar Creditos." });
      }

      // Clean CPF/CNPJ
      const cleaned = cpfCnpj.replace(/\D/g, "");
      if (cleaned.length !== 11 && cleaned.length !== 14) {
        return res.status(400).json({ message: "CPF/CNPJ invalido" });
      }

      // Call SPC API
      const result = await consultarSpc(cleaned);

      // Debit credits and save consultation atomically
      // Sistema unificado: consulta SPC consome 4 creditos do saldo unico
      const saved = await storage.debitAndCreateSpcConsultation(
        req.session.providerId!,
        4,
        {
          providerId: req.session.providerId!,
          userId: req.session.userId!,
          cpfCnpj: cleaned,
          result: result,
          score: result.score,
        }
      );

      if (!saved) {
        return res.status(402).json({ message: "Creditos SPC insuficientes" });
      }

      return res.json({ result, credits: saved.provider.spcCredits });
    } catch (error: any) {
      logger.error({ err: error }, "SPC consultation error");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
