import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { maskCrossProviderDetail } from "../lgpd-masking";
import { getRegionalProviderIds } from "../services/regional.service";
import { queryRegionalErps, type RealtimeQueryResult } from "../services/realtime-query.service";
import { calcularScoreISP, type ISPScoreInput } from "../utils/isp-score";
import { consultationCache } from "../services/consultation-cache.service";
import { buildAddressSearchResult } from "../services/address-search.service";
import { detectMigrator } from "../services/migrator-detection.service";

export function registerConsultasRoutes(): Router {
  const router = Router();

  router.get("/api/isp-consultations", requireAuth, async (req, res) => {
    try {
      const consultations = await storage.getIspConsultationsByProvider(req.session.providerId!);
      const today = await storage.getIspConsultationCountToday(req.session.providerId!);
      const month = await storage.getIspConsultationCountMonth(req.session.providerId!);
      const provider = await storage.getProvider(req.session.providerId!);
      return res.json({ consultations, todayCount: today, monthCount: month, credits: provider?.ispCredits || 0 });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/isp-consultations", requireAuth, async (req, res) => {
    try {
      const { cpfCnpj } = req.body;
      if (!cpfCnpj) {
        return res.status(400).json({ message: "CPF/CNPJ obrigatorio" });
      }

      const cleaned = cpfCnpj.replace(/\D/g, "");
      let searchType: "cpf" | "cnpj" | "cep" = "cpf";
      if (cleaned.length === 14) searchType = "cnpj";
      else if (cleaned.length === 8) searchType = "cep";

      const providerId = req.session.providerId!;
      const provider = await storage.getProvider(providerId);
      if (!provider) {
        return res.status(400).json({ message: "Provedor nao encontrado" });
      }

      // ── CACHE CHECK (CACHE-01, CACHE-02) ─────────────────────────
      const cached = consultationCache.getResult(cleaned, providerId, searchType);
      if (cached) {
        console.log(`[CONSULTA] Cache hit for ${cleaned.slice(0, 4)}*** (provider ${providerId})`);
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

      if (erpIntegrations.length > 0) {

        // ── DIRECT ERP QUERY ────────────────────────────────────────────
        const erpResults = await queryRegionalErps(erpIntegrations as any, cleaned, searchType);

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
            isSameProvider: c.isSameProvider,
            customerName: c.name || "Desconhecido",
            cpfCnpj: c.cpfCnpj || "",
            status: paymentStatus,
            daysOverdue: c.maxDaysOverdue,
            overdueAmount: c.totalOverdueAmount,
            overdueInvoicesCount: c.overdueInvoicesCount || 0,
            address: addrParts.join(", "),
            cep: c.cep || undefined,
            hasUnreturnedEquipment: c.hasUnreturnedEquipment || false,
            unreturnedEquipmentCount: 0,
            planName: c.planName,
            phone: c.phone,
            email: c.email,
            serviceAgeMonths: c.serviceAgeMonths,
          };
          return maskCrossProviderDetail(rawDetail, c.isSameProvider);
        });

        // Build alerts
        const alerts: string[] = [];
        for (const c of allCustomers) {
          if (c.maxDaysOverdue > 0 && !c.isSameProvider) {
            alerts.push(`[${c.isSameProvider ? c.providerName : "Rede ISP"}] Inadimplente: ${c.maxDaysOverdue} dias em atraso`);
          }
        }

        // Recent consultations for F4 (padrao de consultas)
        const recentConsultations = await storage.getRecentConsultationsForDocument(cleaned, 30);
        const consultas30d = new Set(recentConsultations.map(c => c.providerId)).size;
        const recentConsultations90 = await storage.getRecentConsultationsForDocument(cleaned, 90);
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
        // CPF search: if own customer found with address, auto-cross address in the network
        let addressSearchResult = searchType === "cep"
          ? buildAddressSearchResult(cleaned, erpResults, providerId)
          : undefined;

        // Auto address lookup for CPF: pull address from ERP result, cross in network
        const ownCustomerHasAddress = ownCustomer?.cep && ownCustomer?.addressNumber;
        if ((searchType === "cpf" || searchType === "cnpj") && ownCustomerHasAddress) {
          try {
            addressSearchResult = buildAddressSearchResult(
              ownCustomer!.cep!.replace(/\D/g, ""),
              erpResults,
              providerId,
            );
          } catch (err) {
            console.warn("[CONSULTA] Auto address search error (non-blocking):", err);
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

        // RT-03: Map internal 0-1000 score to user-facing 0-100
        const score100 = Math.round(scoreResult.score / 10);

        // ── MIGRATOR DETECTION (MIG-01, MIG-02, MIG-03) ────────────
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
              // Persist alert to DB
              await storage.createAlert(migratorResult.alertRecord);
            }
          } catch (err) {
            console.warn("[MIGRADOR] Detection error (non-blocking):", err);
          }
        }

        // Credit cost: 1 per external provider found
        const externalProviders = new Set(allCustomers.filter(c => !c.isSameProvider).map(c => c.providerId));
        const creditsCost = externalProviders.size;

        const freshProvider = await storage.getProvider(providerId);
        if (creditsCost > 0 && freshProvider && freshProvider.ispCredits < creditsCost) {
          return res.status(402).json({
            message: `Creditos insuficientes. Requer ${creditsCost} credito(s). Voce tem ${freshProvider.ispCredits}.`,
          });
        }
        if (creditsCost > 0 && freshProvider) {
          await storage.updateProviderCredits(providerId, freshProvider.ispCredits - creditsCost, freshProvider.spcCredits);
        }

        const result = {
          cpfCnpj: cleaned,
          searchType,
          notFound,
          score: scoreResult.score,
          score100, // RT-03: user-facing 0-100
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
          addressMatches: [] as any[],
          addressSearch: addressSearchResult || null,
          migratorAlert,
          source: "erp_direct",
          erpLatencies: erpResults.map(r => ({ provider: r.providerName, erp: r.erpSource, ok: r.ok, ms: r.latencyMs, error: r.error })),
          erpSummary: {
            total: erpResults.length,
            responded: erpResults.filter(r => r.ok).length,
            failed: erpResults.filter(r => !r.ok).length,
            timedOut: erpResults.filter(r => r.timedOut).length,
          },
        };

        const consultation = await storage.createIspConsultation({
          providerId,
          userId: req.session.userId!,
          cpfCnpj: cleaned,
          searchType,
          result,
          score: scoreResult.score,
          decisionReco: result.decisionReco,
          cost: creditsCost,
          approved: scoreResult.score >= 500,
        });

        // ── CACHE STORE (CACHE-01) ─────────────────────────────────
        consultationCache.setResult(cleaned, providerId, searchType, {
          result,
          consultation,
          cachedAt: Date.now(),
        });

        return res.json({ consultation, result });
      }
      // No ERP integrations configured for this provider's region
      return res.json({
        consultation: null,
        result: {
          cpfCnpj: cleaned, searchType, notFound: true, score: 1000,
          faixa: "excelente", nivelRisco: "baixo", sugestaoIA: "APROVAR",
          corIndicador: "verde", riskLabel: "SEM DADOS NA REDE",
          recommendation: "Nenhum provedor com ERP configurado na sua regiao",
          decisionReco: "Review", providersFound: 0, providerDetails: [],
          alerts: ["Nenhuma integracao ERP encontrada na regiao. Configure em Integracoes."],
          recommendedActions: [], creditsCost: 0, isOwnCustomer: false,
          addressMatches: [], source: "no_erp",
        },
      });


    } catch (error: any) {
      console.error("ISP consultation error:", error);
      return res.status(500).json({ message: error.message });
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
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/spc-consultations", requireAuth, async (req, res) => {
    try {
      const { cpfCnpj } = req.body;
      if (!cpfCnpj) {
        return res.status(400).json({ message: "CPF/CNPJ obrigatorio" });
      }

      const provider = await storage.getProvider(req.session.providerId!);
      if (!provider || provider.spcCredits <= 0) {
        return res.status(400).json({ message: "Creditos SPC insuficientes" });
      }

      const cleaned = cpfCnpj.replace(/\D/g, "");
      const isCpf = cleaned.length === 11;

      const hash = cleaned.split("").reduce((a: number, b: string) => a + parseInt(b), 0);
      const seed = hash % 100;

      let score: number;
      let situacaoRf: string;
      let obitoRegistrado = false;

      if (seed < 15) {
        score = Math.floor(Math.random() * 300) + 100;
        situacaoRf = seed < 5 ? "Irregular" : "Regular";
        obitoRegistrado = seed < 3;
      } else if (seed < 40) {
        score = Math.floor(Math.random() * 200) + 301;
        situacaoRf = "Regular";
      } else if (seed < 70) {
        score = Math.floor(Math.random() * 200) + 501;
        situacaoRf = "Regular";
      } else {
        score = Math.floor(Math.random() * 200) + 750;
        situacaoRf = "Regular";
      }

      const firstNames = ["Joao", "Maria", "Pedro", "Ana", "Carlos", "Fernanda", "Lucas", "Julia", "Rafael", "Camila"];
      const lastNames = ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Almeida", "Pereira", "Lima", "Costa"];
      const motherNames = ["Maria", "Ana", "Luisa", "Helena", "Teresa", "Rosa", "Carmen", "Lucia"];
      const nameIdx = hash % firstNames.length;
      const lastIdx = (hash + 3) % lastNames.length;
      const motherIdx = (hash + 7) % motherNames.length;

      const birthYear = 1960 + (hash % 40);
      const birthMonth = (hash % 12) + 1;
      const birthDay = (hash % 28) + 1;

      const cadastralData = isCpf ? {
        nome: `${firstNames[nameIdx]} ${lastNames[lastIdx]} dos Santos`.toUpperCase(),
        cpfCnpj: cleaned,
        dataNascimento: `${String(birthDay).padStart(2, "0")}/${String(birthMonth).padStart(2, "0")}/${birthYear}`,
        nomeMae: `${motherNames[motherIdx]} ${lastNames[(lastIdx + 2) % lastNames.length]}`.toUpperCase(),
        situacaoRf,
        obitoRegistrado,
        tipo: "PF" as const,
      } : {
        nome: `${firstNames[nameIdx].toUpperCase()} ${lastNames[lastIdx].toUpperCase()} TELECOMUNICACOES LTDA`,
        cpfCnpj: cleaned,
        dataFundacao: `${String(birthDay).padStart(2, "0")}/${String(birthMonth).padStart(2, "0")}/${birthYear + 20}`,
        situacaoRf,
        obitoRegistrado: false,
        tipo: "PJ" as const,
      };

      const restrictionTypes = [
        { type: "PEFIN", desc: "Pendencia Financeira", severity: "medium" as const },
        { type: "REFIN", desc: "Restricao Financeira", severity: "high" as const },
        { type: "CCF", desc: "Cheque sem Fundo", severity: "high" as const },
        { type: "Protesto", desc: "Titulo protestado em cartorio", severity: "high" as const },
        { type: "Acao Judicial", desc: "Processo de cobranca", severity: "critical" as const },
        { type: "Falencia", desc: "Processo falimentar", severity: "critical" as const },
      ];

      const creditors = [
        "Claro S.A.", "Banco Itau S.A.", "Vivo Telefonica", "Casas Bahia", "Magazine Luiza",
        "Banco do Brasil", "Caixa Economica", "Oi S.A.", "Tim S.A.", "Bradesco S.A.",
        "Lojas Americanas", "Santander S.A.", "Banco Pan", "Net Servicos", "Sky Brasil",
      ];

      const restrictions: any[] = [];
      if (score < 700) {
        const numRestrictions = score < 300 ? Math.floor(Math.random() * 3) + 3 : score < 500 ? Math.floor(Math.random() * 2) + 1 : Math.random() > 0.5 ? 1 : 0;
        for (let i = 0; i < numRestrictions; i++) {
          const rType = restrictionTypes[Math.floor(Math.random() * (score < 300 ? 6 : 4))];
          const value = Math.floor(Math.random() * 5000) + 100;
          const daysAgo = Math.floor(Math.random() * 365) + 30;
          const date = new Date();
          date.setDate(date.getDate() - daysAgo);
          restrictions.push({
            type: rType.type,
            description: rType.desc,
            severity: rType.severity,
            creditor: creditors[Math.floor(Math.random() * creditors.length)],
            value: value.toFixed(2),
            date: date.toISOString().split("T")[0],
            origin: i % 2 === 0 ? "SPC" : "Serasa",
          });
        }
      }

      const totalRestrictions = restrictions.reduce((sum, r) => sum + parseFloat(r.value), 0);

      const segments = ["Telecomunicacoes", "Varejo", "Financeiras", "Servicos", "Industria"];
      const previousConsultations: any[] = [];
      const numPrevConsultations = Math.floor(Math.random() * 10) + 1;
      for (let i = 0; i < numPrevConsultations; i++) {
        const daysAgo = Math.floor(Math.random() * 90) + 1;
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        previousConsultations.push({
          date: d.toISOString().split("T")[0],
          segment: segments[Math.floor(Math.random() * segments.length)],
        });
      }

      const segmentCounts: Record<string, number> = {};
      previousConsultations.forEach(c => {
        segmentCounts[c.segment] = (segmentCounts[c.segment] || 0) + 1;
      });

      const spcAlerts: { type: string; message: string; severity: string }[] = [];
      if (numPrevConsultations > 5) {
        spcAlerts.push({ type: "many_queries", message: `${numPrevConsultations} consultas nos ultimos 90 dias - possivel cliente "rodando" entre empresas`, severity: "high" });
      }
      if (restrictions.some(r => ["Claro S.A.", "Vivo Telefonica", "Oi S.A.", "Tim S.A.", "Net Servicos", "Sky Brasil"].includes(r.creditor))) {
        spcAlerts.push({ type: "telecom_debt", message: "Dividas no segmento de telecomunicacoes detectadas", severity: "high" });
      }
      if (situacaoRf === "Irregular") {
        spcAlerts.push({ type: "cpf_irregular", message: "CPF irregular na Receita Federal - documento com problema", severity: "critical" });
      }
      if (obitoRegistrado) {
        spcAlerts.push({ type: "death_registered", message: "Obito registrado - possivel fraude de identidade", severity: "critical" });
      }
      if (score < 400 && restrictions.length > 0) {
        spcAlerts.push({ type: "score_drop", message: "Score muito baixo com restricoes ativas - situacao financeira critica", severity: "medium" });
      }

      let riskLevel: string;
      let riskLabel: string;
      let recommendation: string;

      if (score >= 901) { riskLevel = "very_low"; riskLabel = "RISCO MUITO BAIXO"; recommendation = "Aprovar"; }
      else if (score >= 701) { riskLevel = "low"; riskLabel = "RISCO BAIXO"; recommendation = "Aprovar"; }
      else if (score >= 501) { riskLevel = "medium"; riskLabel = "RISCO MEDIO"; recommendation = "Aprovar com cautela"; }
      else if (score >= 301) { riskLevel = "high"; riskLabel = "RISCO ALTO"; recommendation = "Nao aprovar sem garantias"; }
      else { riskLevel = "very_high"; riskLabel = "RISCO MUITO ALTO"; recommendation = "Rejeitar"; }

      const result = {
        cpfCnpj: cleaned,
        cadastralData,
        score,
        riskLevel,
        riskLabel,
        recommendation,
        status: restrictions.length === 0 ? "clean" : "restricted",
        restrictions,
        totalRestrictions,
        previousConsultations: {
          total: numPrevConsultations,
          last90Days: numPrevConsultations,
          bySegment: segmentCounts,
        },
        alerts: spcAlerts,
      };

      const consultation = await storage.createSpcConsultation({
        providerId: req.session.providerId!,
        userId: req.session.userId!,
        cpfCnpj: cleaned,
        result,
        score,
      });

      await storage.updateProviderCredits(
        provider.id,
        provider.ispCredits,
        provider.spcCredits - 1,
      );

      return res.json({ consultation, result });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return router;
}
