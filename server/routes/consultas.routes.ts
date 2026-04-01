import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { calculateIspScore, getRiskTier, getDecisionReco, getRecommendedActions } from "./utils";
import { maskCrossProviderDetail } from "../lgpd-masking";
import { getRegionalProviderIds } from "../services/regional.service";
import { queryRegionalErps, type RealtimeQueryResult } from "../services/realtime-query.service";
import { calcularScoreISP, type ISPScoreInput } from "../utils/isp-score";

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

      // ── REALTIME ERP QUERY (DIRECT — NO N8N) ──────────────────────
      // Query ERPs from the same mesoregion directly via connectors.
      // LGPD: data is never stored. Fetched in real-time, masked, returned.
      const allErpIntegrations = await storage.getAllEnabledErpIntegrationsWithCredentials();
      const regionalProviderIds = await getRegionalProviderIds(providerId);
      const allowedProviderIds = new Set([providerId, ...regionalProviderIds]);
      const erpIntegrations = allErpIntegrations.filter(intg => allowedProviderIds.has(intg.providerId));

      if (erpIntegrations.length > 0) {

        // ── DIRECT ERP QUERY (replaces N8N) ────────────────────────────
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
        };

        const scoreResult = calcularScoreISP(scoreInput);

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
          alerts: [...alerts, ...scoreResult.alertas],
          recommendedActions: scoreResult.condicoesSugeridas,
          creditsCost,
          isOwnCustomer,
          addressMatches: [] as any[],
          source: "erp_direct",
          erpLatencies: erpResults.map(r => ({ provider: r.providerName, erp: r.erpSource, ok: r.ok, ms: r.latencyMs, error: r.error })),
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

        return res.json({ consultation, result });
      }
      // ── FIM REALTIME ERP QUERY ────────────────────────────────────────

      // Fallback: no ERP integrations configured — use local DB
      // (This path will be deprecated as providers configure ERP connections)

      // @LEGACY: keeping the original local-DB path for backwards compatibility.
      // TODO: Remove this fallback once all providers have ERP integrations.
      const LEGACY_FALLBACK_ENABLED = true; // flip to false to disable
      if (!LEGACY_FALLBACK_ENABLED) {
        return res.json({
          consultation: null,
          result: {
            cpfCnpj: cleaned, searchType, notFound: true, score: 1000,
            faixa: "excelente", nivelRisco: "baixo", sugestaoIA: "APROVAR",
            corIndicador: "verde", riskLabel: "SEM DADOS",
            recommendation: "Sem integracao ERP — configure em Integracoes",
            decisionReco: "Review", providersFound: 0, providerDetails: [],
            alerts: ["Nenhuma integracao ERP configurada. Configure em Configuracoes > Integracoes."],
            recommendedActions: [], creditsCost: 0, isOwnCustomer: false,
            addressMatches: [], source: "no_erp",
          },
        });
      }

      // The old N8N code used to be here. Now replaced by direct ERP queries above.
      // This is the legacy local-DB fallback for providers without ERP integrations.
      const DUMMY_N8N_REMOVED = true; // marker that N8N was removed


      const allCustomerRecords = await storage.getCustomerByCpfCnpj(cleaned);

      const isOwnCustomer = allCustomerRecords.some(c => c.providerId === providerId);
      const hasOtherProviderRecords = allCustomerRecords.some(c => c.providerId !== providerId);
      const notFound = allCustomerRecords.length === 0;

      const otherProviderIds = new Set(
        allCustomerRecords.filter(c => c.providerId !== providerId).map(c => c.providerId)
      );
      const cost = otherProviderIds.size; // 1 credit per unique other provider found
      if (cost > 0 && provider.ispCredits < cost) {
        return res.status(400).json({ message: "Creditos ISP insuficientes" });
      }

      const recentConsultations = await storage.getRecentConsultationsForDocument(cleaned, 30);
      const distinctProviders = new Set(recentConsultations.map(c => c.providerId));
      const recentConsultationsCount = distinctProviders.size;

      const providerDetails: any[] = [];
      const alerts: string[] = [];
      let globalMaxDaysOverdue = 0;
      let globalTotalOverdue = 0;
      let providersWithDebtCount = 0;
      let hasUnreturnedEquipmentGlobal = false;

      for (const customer of allCustomerRecords) {
        const customerProvider = await storage.getProvider(customer.providerId);
        const customerContracts = await storage.getContractsByCustomer(customer.id);
        const customerEquipment = await storage.getEquipmentByCustomer(customer.id);
        const customerInvoices = await storage.getInvoicesByCustomer(customer.id);

        const overdueInvoices = customerInvoices.filter(inv => inv.status === "overdue");
        const totalOverdue = overdueInvoices.reduce((sum, inv) => sum + parseFloat(inv.value || "0"), 0);
        const overdueCount = overdueInvoices.length;

        let maxDays = 0;
        for (const inv of overdueInvoices) {
          const dueDate = new Date(inv.dueDate);
          const diffDays = Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays > maxDays) maxDays = diffDays;
        }

        const unreturnedEquipment = customerEquipment.filter(eq => eq.status === "not_returned");
        const unreturnedCount = unreturnedEquipment.length;

        if (totalOverdue > 0) providersWithDebtCount++;
        if (maxDays > globalMaxDaysOverdue) globalMaxDaysOverdue = maxDays;
        globalTotalOverdue += totalOverdue;
        if (unreturnedCount > 0) hasUnreturnedEquipmentGlobal = true;

        const oldestContract = customerContracts.reduce((oldest, ct) => {
          const start = ct.startDate ? new Date(ct.startDate) : new Date();
          return start < oldest ? start : oldest;
        }, new Date());
        const contractAgeDays = Math.floor((Date.now() - oldestContract.getTime()) / (1000 * 60 * 60 * 24));

        let paymentStatusLabel = "Em dia";
        if (maxDays > 90) paymentStatusLabel = "Inadimplente (90+ dias)";
        else if (maxDays > 60) paymentStatusLabel = "Inadimplente (61-90 dias)";
        else if (maxDays > 30) paymentStatusLabel = "Inadimplente (31-60 dias)";
        else if (maxDays > 0) paymentStatusLabel = "Inadimplente (1-30 dias)";

        const isSameProvider = customer.providerId === providerId;

        const activeContract = customerContracts.find(ct => ct.status === "active");
        const latestContract = customerContracts.length > 0
          ? [...customerContracts].sort((a, b) => b.id - a.id)[0]
          : null;
        const relevantContract = activeContract || latestContract;
        const contractStatus = relevantContract?.status || "sem_contrato";

        const rawDetail: Record<string, any> = {
          providerName: customerProvider?.name || "Provedor desconhecido",
          isSameProvider,
          customerName: customer.name,
          cpfCnpj: customer.cpfCnpj,
          address: customer.address || undefined,
          cep: customer.cep || undefined,
          status: paymentStatusLabel,
          daysOverdue: maxDays,
          overdueAmount: totalOverdue,
          overdueInvoicesCount: overdueCount,
          contractStartDate: oldestContract.toISOString(),
          contractAgeDays,
          contractStatus,
          hasUnreturnedEquipment: unreturnedCount > 0,
          unreturnedEquipmentCount: unreturnedCount,
        };

        const detail: any = maskCrossProviderDetail(rawDetail, isSameProvider);

        if (isSameProvider) {
          detail.equipmentDetails = unreturnedEquipment.map(eq => ({
            type: eq.type,
            brand: eq.brand,
            model: eq.model,
            value: eq.value,
            inRecoveryProcess: eq.inRecoveryProcess,
          }));
          const newestContract = customerContracts.length > 0 ? customerContracts[0] : null;
          if (newestContract?.endDate) {
            detail.cancelledDate = newestContract.endDate;
          }
        } else {
          detail.equipmentPendingSummary = unreturnedCount > 0
            ? `${unreturnedCount} equipamento(s) nao devolvido(s)`
            : "Todos devolvidos";
        }

        providerDetails.push(detail);

        if (customer.providerId !== providerId) {
          const equipmentValue = unreturnedEquipment.reduce((sum, eq) => sum + parseFloat(eq.value || "0"), 0);
          const totalConsultingProviders = recentConsultationsCount + 1;

          let riskScore = 0;
          const riskFactors: string[] = [];

          if (maxDays >= 90) { riskScore += 35; riskFactors.push("Atraso superior a 90 dias"); }
          else if (maxDays >= 60) { riskScore += 25; riskFactors.push("Atraso entre 60-90 dias"); }
          else if (maxDays >= 30) { riskScore += 15; riskFactors.push("Atraso entre 30-60 dias"); }
          else if (maxDays >= 1) { riskScore += 8; riskFactors.push("Atraso de 1-30 dias"); }

          if (totalOverdue >= 1000) { riskScore += 25; riskFactors.push(`Valor alto em aberto: R$ ${totalOverdue.toFixed(2)}`); }
          else if (totalOverdue >= 500) { riskScore += 18; riskFactors.push(`Valor medio em aberto: R$ ${totalOverdue.toFixed(2)}`); }
          else if (totalOverdue >= 200) { riskScore += 10; riskFactors.push(`Valor em aberto: R$ ${totalOverdue.toFixed(2)}`); }
          else if (totalOverdue > 0) { riskScore += 5; riskFactors.push(`Pequeno valor em aberto: R$ ${totalOverdue.toFixed(2)}`); }

          if (equipmentValue >= 500) { riskScore += 25; riskFactors.push(`Equipamento de alto valor: R$ ${equipmentValue.toFixed(2)}`); }
          else if (equipmentValue >= 200) { riskScore += 18; riskFactors.push(`Equipamento nao devolvido: R$ ${equipmentValue.toFixed(2)}`); }
          else if (unreturnedCount > 0) { riskScore += 10; riskFactors.push(`${unreturnedCount} equipamento(s) pendente(s)`); }

          if (totalConsultingProviders >= 5) { riskScore += 15; riskFactors.push(`Consultado por ${totalConsultingProviders} provedores recentemente`); }
          else if (totalConsultingProviders >= 3) { riskScore += 10; riskFactors.push(`Multiplas consultas recentes: ${totalConsultingProviders}`); }
          else if (totalConsultingProviders >= 2) { riskScore += 5; riskFactors.push("Consultado por 2 provedores nos ultimos 30 dias"); }

          if (contractAgeDays < 30) { riskScore += 10; riskFactors.push("Contrato muito recente (< 30 dias)"); }
          else if (contractAgeDays < 90) { riskScore += 5; riskFactors.push("Contrato recente (< 90 dias)"); }

          riskScore = Math.min(riskScore, 100);
          const riskLevel = riskScore >= 75 ? "critical" : riskScore >= 50 ? "high" : riskScore >= 25 ? "medium" : "low";
          const severity = riskLevel;

          if (maxDays >= 1 || unreturnedCount > 0 || contractAgeDays < 90) {
            const alertType = maxDays >= 1 ? "defaulter_consulted" : unreturnedCount > 0 ? "equipment_risk" : "recent_contract";
            const alertMessage = maxDays >= 1
              ? `Seu cliente ${customer.name} foi consultado por ${provider.name}. O cliente possui R$ ${totalOverdue.toFixed(2)} em atraso ha ${maxDays} dias.`
              : unreturnedCount > 0
              ? `Seu cliente ${customer.name} possui ${unreturnedCount} equipamento(s) nao devolvido(s) (R$ ${equipmentValue.toFixed(2)}) e foi consultado por ${provider.name}.`
              : `Seu cliente ${customer.name} (contrato recente: ${contractAgeDays} dias) foi consultado por ${provider.name}.`;

            await storage.createAlert({
              providerId: customer.providerId,
              customerId: customer.id,
              consultingProviderId: providerId,
              consultingProviderName: provider.name,
              customerName: customer.name,
              customerCpfCnpj: customer.cpfCnpj,
              type: alertType,
              severity,
              message: alertMessage,
              riskScore,
              riskLevel,
              riskFactors,
              daysOverdue: maxDays,
              overdueAmount: totalOverdue.toFixed(2),
              equipmentNotReturned: unreturnedCount,
              equipmentValue: equipmentValue.toFixed(2),
              recentConsultations: totalConsultingProviders,
              resolved: false,
              status: "new",
            });
          }
        }
      }

      if (recentConsultationsCount > 2) {
        alerts.push(`Consultado por ${recentConsultationsCount + 1} provedores nos ultimos 30 dias`);
        for (const customer of allCustomerRecords) {
          if (customer.providerId !== providerId) {
            await storage.createAlert({
              providerId: customer.providerId,
              customerId: customer.id,
              consultingProviderId: providerId,
              consultingProviderName: provider.name,
              customerName: customer.name,
              customerCpfCnpj: customer.cpfCnpj,
              type: "multiple_consultations",
              severity: "high",
              message: `Seu cliente ${customer.name} foi consultado por ${recentConsultationsCount + 1} provedores nos ultimos 30 dias. Possivel padrao de fraude.`,
              riskScore: 80,
              riskLevel: "high",
              riskFactors: [`Consultado por ${recentConsultationsCount + 1} provedores nos ultimos 30 dias`, "Possivel padrao de fraude"],
              daysOverdue: customer.maxDaysOverdue || 0,
              overdueAmount: customer.totalOverdueAmount || "0",
              equipmentNotReturned: 0,
              equipmentValue: "0",
              recentConsultations: recentConsultationsCount + 1,
              resolved: false,
              status: "new",
            });
          }
        }
      }

      if (providersWithDebtCount > 1) {
        alerts.push("Padrao de divida em multiplos provedores detectado");
      }

      let contractAgeDays = 365;
      let neverLate = true;
      let allEquipmentReturned = true;
      let clientYears = 0;
      let hasAnyContract = false;

      if (allCustomerRecords.length > 0) {
        for (const customer of allCustomerRecords) {
          const cts = await storage.getContractsByCustomer(customer.id);
          for (const ct of cts) {
            hasAnyContract = true;
            const start = ct.startDate ? new Date(ct.startDate) : new Date();
            const age = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
            if (age < contractAgeDays) contractAgeDays = age;
            const years = age / 365;
            if (years > clientYears) clientYears = years;
          }
          const invs = await storage.getInvoicesByCustomer(customer.id);
          if (invs.some(inv => inv.status === "overdue")) neverLate = false;
          const eqs = await storage.getEquipmentByCustomer(customer.id);
          if (eqs.some(eq => eq.status === "not_returned")) allEquipmentReturned = false;
        }
      }

      if (!hasAnyContract) {
        contractAgeDays = 365;
      }

      let actualUnreturnedCount = 0;
      for (const customer of allCustomerRecords) {
        const eqs = await storage.getEquipmentByCustomer(customer.id);
        actualUnreturnedCount += eqs.filter(eq => eq.status === "not_returned").length;
      }

      const recalculated = allCustomerRecords.length === 0
        ? { score: 100, penalties: [], bonuses: [] }
        : calculateIspScore({
            maxDaysOverdue: globalMaxDaysOverdue,
            totalOverdueAmount: globalTotalOverdue,
            unreturnedEquipmentCount: actualUnreturnedCount,
            contractAgeDays,
            recentConsultationsCount: recentConsultationsCount + 1,
            providersWithDebt: providersWithDebtCount,
            clientYears,
            neverLate,
            allEquipmentReturned,
          });

      const finalScore = recalculated.score;
      const risk = getRiskTier(finalScore);
      const decisionReco = getDecisionReco(finalScore);
      const recommendedActions = getRecommendedActions(finalScore, hasUnreturnedEquipmentGlobal);

      // ── CRUZAMENTO DE ENDEREÇO ──────────────────────────────────────────
      const addressMatches: any[] = [];
      const seenAddressCpfCnpj = new Set<string>();

      const addressKeys = new Map<string, { address: string; city: string; state: string | null; cep: string | null }>();
      for (const customer of allCustomerRecords) {
        if (customer.address && customer.city) {
          const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
          const key = [
            norm(customer.address),
            norm(customer.city),
            customer.state ? norm(customer.state) : "",
            customer.cep ? customer.cep.replace(/\D/g, "") : "",
          ].join("|");
          addressKeys.set(key, {
            address: customer.address,
            city: customer.city,
            state: customer.state || null,
            cep: customer.cep || null,
          });
        }
      }

      for (const [, addrData] of Array.from(addressKeys)) {
        const matched = await storage.getCustomersByExactAddress(addrData.address, addrData.city, addrData.state, addrData.cep, cleaned);
        for (const mc of matched) {
          const cpfKey = mc.cpfCnpj.replace(/\D/g, "");
          if (seenAddressCpfCnpj.has(cpfKey)) continue;
          seenAddressCpfCnpj.add(cpfKey);

          const mcProvider = await storage.getProvider(mc.providerId);
          const mcInvoices = await storage.getInvoicesByCustomer(mc.id);
          const overdueInvoices = mcInvoices.filter(i => i.status === "overdue");
          const totalOverdue = overdueInvoices.reduce((s, i) => s + parseFloat(i.value || "0"), 0);
          let maxDays = 0;
          for (const inv of overdueInvoices) {
            const days = Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86400000);
            if (days > maxDays) maxDays = days;
          }

          const isSameProvider = mc.providerId === providerId;

          const rawMatch: Record<string, any> = {
            customerName: mc.name,
            cpfCnpj: mc.cpfCnpj,
            address: mc.address,
            cep: mc.cep || undefined,
            city: mc.city,
            state: mc.state,
            providerName: isSameProvider ? (mcProvider?.name || "Seu provedor") : "Outro provedor da rede",
            isSameProvider,
            status: maxDays === 0 ? "Em dia" : `Inadimplente (${maxDays}d)`,
            daysOverdue: maxDays,
            overdueAmount: totalOverdue,
            hasDebt: maxDays > 0 || totalOverdue > 0,
          };
          addressMatches.push(maskCrossProviderDetail(rawMatch, isSameProvider));
        }
      }

      if (addressMatches.length > 0) {
        const debtAtAddress = addressMatches.filter(m => m.hasDebt).length;
        if (debtAtAddress > 0) {
          alerts.push(`Alerta de Endereco: ${debtAtAddress} pessoa(s) no mesmo endereco com historico de inadimplencia`);
        } else {
          alerts.push(`Cruzamento de Endereco: ${addressMatches.length} cadastro(s) localizado(s) no mesmo endereco`);
        }
      }
      // ── FIM CRUZAMENTO DE ENDEREÇO ──────────────────────────────────────

      const consultorIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
        || req.socket.remoteAddress
        || "desconhecido";

      const result = {
        cpfCnpj: cleaned,
        searchType,
        notFound: allCustomerRecords.length === 0,
        score: finalScore,
        riskTier: risk.tier,
        riskLabel: risk.label,
        recommendation: risk.recommendation,
        decisionReco,
        providersFound: new Set(allCustomerRecords.map(c => c.providerId)).size,
        providerDetails,
        penalties: recalculated.penalties,
        bonuses: recalculated.bonuses,
        alerts,
        recommendedActions,
        creditsCost: cost,
        isOwnCustomer,
        addressMatches,
        consultorIp,
      };

      const customerIdForLog = allCustomerRecords.length > 0 ? allCustomerRecords[0].id : null;
      const consultation = await storage.createIspConsultation({
        providerId,
        userId: req.session.userId!,
        cpfCnpj: cleaned,
        searchType,
        result,
        score: finalScore,
        decisionReco,
        cost,
        approved: finalScore >= 50,
      });

      if (cost > 0) {
        await storage.updateProviderCredits(
          provider.id,
          provider.ispCredits - cost,
          provider.spcCredits,
        );
      }

      return res.json({ consultation, result });
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
