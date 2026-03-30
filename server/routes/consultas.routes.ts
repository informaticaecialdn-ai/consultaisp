import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { calculateIspScore, getRiskTier, getDecisionReco, getOverdueAmountRange, getRecommendedActions } from "./utils";

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
      let searchType = "cpf";
      if (cleaned.length === 14) searchType = "cnpj";
      else if (cleaned.length === 8) searchType = "cep";

      const providerId = req.session.providerId!;
      const provider = await storage.getProvider(providerId);
      if (!provider) {
        return res.status(400).json({ message: "Provedor nao encontrado" });
      }

      // ── N8N CENTRAL QUERY ────────────────────────────────────────────
      // Builds integrations array from all N8N-enabled providers and calls the
      // single central N8N endpoint which orchestrates ERP queries internally.
      const n8nProviders = await storage.getAllProvidersWithN8n();

      if (n8nProviders.length > 0) {
        // Build integrations array for the central N8N endpoint.
        // Each provider contributes their ERP credentials stored in the N8N config fields:
        //   n8nWebhookUrl → api_url (strip protocol prefix)
        //   n8nAuthToken  → api_key
        //   n8nErpProvider → erp
        const integrations = n8nProviders.map(prov => ({
          provider_id: String(prov.id),
          provider_name: prov.name,
          erp: prov.n8nErpProvider || "ixc",
          api_url: (prov.n8nWebhookUrl || "").replace(/^https?:\/\//, ""),
          api_key: prov.n8nAuthToken || "",
        }));

        const CENTRAL_N8N_URL = "https://n8n.aluisiocunha.com.br/webhook/isp-consult";
        const CENTRAL_N8N_AUTH = "Basic aXNwX2FuYWxpenplOmlzcGFuYWxpenplMTIzMTIz";

        // When searching by CEP (8 digits) use N8N address search mode
        const isCepSearch = searchType === "cep";
        const extPayload = isCepSearch ? {
          document: null,
          searchType: "address",
          addressQuery: { zipcode: cleaned },
          integrations,
        } : {
          document: cleaned,
          searchType: "document",
          addressQuery: null,
          integrations,
        };

        console.log(`[ISP-N8N] Chamando N8N central com ${integrations.length} integracoes:`, JSON.stringify(extPayload, null, 2));

        let extRaw: any;
        try {
          const extRes = await fetch(CENTRAL_N8N_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": CENTRAL_N8N_AUTH,
            },
            body: JSON.stringify(extPayload),
            signal: AbortSignal.timeout(25000),
          });

          let errBody = "";
          if (!extRes.ok) {
            try { errBody = await extRes.text(); } catch {}
            let errJson: any = null;
            try { errJson = JSON.parse(errBody); } catch {}
            const isNoItems = errJson?.message === "No item to return was found" || errJson?.code === 0;
            if (isNoItems) {
              console.log("[ISP-N8N] N8N retornou sem itens — resultado: nao encontrado");
              extRaw = null;
            } else {
              console.error(`[ISP-N8N] HTTP ${extRes.status}:`, errBody);
              return res.status(502).json({ message: `Erro na API ISP: HTTP ${extRes.status}`, detail: errBody });
            }
          } else {
            extRaw = await extRes.json();
          }
        } catch (extErr: any) {
          if (extErr.name === "AbortError" || extErr.name === "TimeoutError") {
            return res.status(504).json({ message: "Timeout ao conectar com a API ISP (25s). Verifique sua conexao." });
          }
          return res.status(502).json({ message: `Erro ao chamar API ISP: ${extErr.message}` });
        }

        // Response can be [{data:{customers:[...]}}] or {data:{customers:[...]}} or {customers:[...]}
        const responseObj = Array.isArray(extRaw) ? extRaw[0] : extRaw;
        const customers: any[] = responseObj?.data?.customers || responseObj?.customers || [];

        // Debug: log full N8N response for CEP searches (always) and first customer for document searches
        if (isCepSearch) {
          console.log(`[ISP-N8N-CEP] CEP ${cleaned} → raw N8N response:`, JSON.stringify(extRaw));
          console.log(`[ISP-N8N-CEP] Clientes encontrados: ${customers.length}`);
        } else if (customers.length > 0) {
          console.log("[ISP-N8N] Full sample customer (keys):", Object.keys(customers[0]).join(", "));
          console.log("[ISP-N8N] Full sample customer:", JSON.stringify(customers[0]));
        }

        // Build a quick lookup: provider_id → provider info
        const providerMap = new Map(n8nProviders.map(p => [String(p.id), p]));

        // ── VIACEP CITY LOOKUP ───────────────────────────────────────────
        // IXC ERP returns internal numeric IDs in city/state fields (e.g. "4101", "3").
        // We use the zipcode (CEP) to resolve readable city/state via ViaCEP API.
        // Results are cached in-request to avoid duplicate calls.
        const zipCityCache = new Map<string, { city: string; state: string }>();
        {
          const uniqueZips = Array.from(new Set(
            customers
              .map((c: any) => ((c.zipcode || c.zip_code || c.cep || "")).replace(/\D/g, ""))
              .filter((z: string) => z.length === 8),
          ));
          await Promise.all(uniqueZips.map(async (zip: string) => {
            try {
              const r = await fetch(`https://viacep.com.br/ws/${zip}/json/`, {
                signal: AbortSignal.timeout(4000),
              });
              if (r.ok) {
                const d = await r.json();
                if (d.localidade && d.uf && !d.erro) {
                  zipCityCache.set(zip, { city: d.localidade, state: d.uf });
                }
              }
            } catch {
              // ViaCEP unavailable — continue without city data
            }
          }));
        }

        // ── ADDRESS CROSS-REFERENCE (document search only) ──────────────
        // For each unique address found in document search, do a secondary
        // N8N address query to find other customers at the same location.
        let n8nAddressMatches: any[] = [];
        if (!isCepSearch && customers.length > 0) {
          const seenAddrKeys = new Set<string>();
          const addressQueries: any[] = [];
          for (const c of customers) {
            if (!c.city) continue;
            const key = [c.cep || "", c.city, c.address || ""].join("|");
            if (seenAddrKeys.has(key)) continue;
            seenAddrKeys.add(key);
            const addrQ: any = {};
            if (c.address) addrQ.street = c.address;
            if (c.cep) addrQ.zipcode = c.cep.replace(/\D/g, "");
            if (c.city) addrQ.city = c.city;
            if (c.state) addrQ.state = c.state;
            if (c.neighborhood) addrQ.neighborhood = c.neighborhood;
            addressQueries.push(addrQ);
          }
          for (const addrQ of addressQueries.slice(0, 3)) {
            try {
              const addrRes = await fetch(CENTRAL_N8N_URL, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": CENTRAL_N8N_AUTH,
                },
                body: JSON.stringify({
                  document: null,
                  searchType: "address",
                  addressQuery: addrQ,
                  integrations,
                }),
                signal: AbortSignal.timeout(10000),
              });
              if (addrRes.ok) {
                const addrRaw = await addrRes.json();
                const addrObj = Array.isArray(addrRaw) ? addrRaw[0] : addrRaw;
                const addrCustomers: any[] = addrObj?.data?.customers || addrObj?.customers || [];
                for (const ac of addrCustomers) {
                  // Skip anyone already in main results (same document or same provider record)
                  const alreadyFound = customers.find(
                    (c: any) => c.document && ac.document && c.document === ac.document,
                  );
                  if (!alreadyFound) {
                    const acProviderId = ac.provider_id ? Number(ac.provider_id) : null;
                    const acIsSame = !!(ac.provider_name && ac.provider_name === provider.name);
                    const acFullName = (ac.full_name || "Desconhecido").trim();
                    const acNameParts = acFullName.split(/\s+/);
                    const acMaskedName = acIsSame
                      ? acFullName
                      : acNameParts.length > 1 ? `${acNameParts[0]} ***` : acFullName;
                    n8nAddressMatches.push({
                      customerName: acMaskedName,
                      cpfCnpj: acIsSame ? (ac.document || "") : "***",
                      address: [addrQ.street, addrQ.city, addrQ.state].filter(Boolean).join(", "),
                      city: addrQ.city || "",
                      state: addrQ.state || "",
                      providerName: ac.provider_name || (acProviderId ? providerMap.get(String(acProviderId))?.name : null) || "Outro provedor",
                      isSameProvider: acIsSame,
                      status: ac.payment_status || "unknown",
                      daysOverdue: Number(ac.payment_summary?.max_days_overdue || 0),
                      totalOverdue: acIsSame ? Number(ac.payment_summary?.open_overdue_amount || 0) : undefined,
                      hasDebt: Number(ac.payment_summary?.max_days_overdue || 0) > 0,
                    });
                  }
                }
              }
            } catch (addrErr: any) {
              console.warn("[ISP-N8N] Address cross-ref failed:", addrErr.message);
            }
          }
        }

        const notFound = customers.length === 0;

        const computeScore = (c: any): number => {
          const ps = (c.payment_status || "").toLowerCase();
          if (ps === "current") return 90;
          if (ps === "cancelled") return 40;
          if (ps === "suspended") return 35;
          const days = c.payment_summary?.max_days_overdue || 0;
          if (days > 90) return 15;
          if (days > 60) return 30;
          if (days > 30) return 50;
          if (days > 0) return 65;
          return 75;
        };

        const scores = customers.map(computeScore);
        const finalScore = notFound ? 100 : Math.min(...scores);
        const risk = getRiskTier(finalScore);
        const decisionReco = getDecisionReco(finalScore);
        const recommendedActions = getRecommendedActions(finalScore, false);

        const paymentStatusMap: Record<string, string> = {
          "current": "Em dia",
          "overdue": "Inadimplente",
          "cancelled": "Cancelado",
          "suspended": "Suspenso",
        };

        const providerDetails = customers.map((c: any) => {
          const ps = (c.payment_status || "").toLowerCase();
          const ps2 = c.payment_status || "";
          const overdueAmount = Number(c.payment_summary?.open_overdue_amount || 0);
          const maxDays = Number(c.payment_summary?.max_days_overdue || 0);
          const overdueCount = Number(c.payment_summary?.open_overdue_count || 0);
          const serviceAgeMonths = Number(c.service_age_months || 0);

          const customerProviderId = c.provider_id ? Number(c.provider_id) : null;
          // N8N echoes back the provider_name we sent in the integrations array.
          // IXC uses its own internal numeric provider_id (e.g. 21600) which differs
          // from our database provider ID. So match by provider_name instead of provider_id.
          const customerProviderName = c.provider_name
            || (customerProviderId ? providerMap.get(String(customerProviderId))?.name : null)
            || "Outro provedor";
          // isSame: use provider_name match (provider_id from IXC is its internal ID, not our DB ID)
          const isSame = !!(c.provider_name && c.provider_name === provider.name);

          // ── ADDRESS FIELDS ───────────────────────────────────────────────
          // N8N returns separate fields: address (street), address_number, address_complement,
          // neighborhood, zipcode (CEP), city/state (may be ERP internal IDs on IXC).

          // 1. CEP: prefer zipcode field; fallback to zip_code, then cep, then regex from address
          const rawCepBase = (
            c.zipcode || c.zip_code || c.cep || ""
          ).replace(/\D/g, "");
          // Fallback: try to find CEP pattern in any address-like field
          const cepFallback = !rawCepBase
            ? ((c.address || "").match(/\b(\d{5})-?(\d{3})\b/) || [])[0] || ""
            : "";
          const rawCep = rawCepBase || cepFallback.replace(/\D/g, "");
          const maskedCep = rawCep.length >= 5
            ? rawCep.replace(/^(\d{5})(\d*)$/, "$1-***")
            : null;
          const fullCep = rawCep.length === 8
            ? `${rawCep.slice(0, 5)}-${rawCep.slice(5)}`
            : (rawCep || null);

          // 2. City/State: prefer ViaCEP lookup (resolves IXC numeric IDs via zipcode),
          //    fallback to ERP fields if alphabetic, fallback to address string parsing.
          const viaCepResult = rawCep.length === 8 ? zipCityCache.get(rawCep) : null;

          const cityFromViaCep = viaCepResult?.city || null;
          const stateFromViaCep = viaCepResult?.state || null;

          const cityFromField = !cityFromViaCep && c.city && /[a-zA-ZÀ-ÿ]/.test(c.city)
            ? (c.city as string).trim() : null;
          const stateFromField = !stateFromViaCep && c.state && /^[A-Z]{2}$/i.test((c.state as string).trim())
            ? (c.state as string).trim().toUpperCase() : null;

          let cityFromAddr: string | null = null;
          let stateFromAddr: string | null = null;
          if (!cityFromViaCep && !cityFromField && c.address) {
            const m1 = (c.address as string).match(/,\s*([^,\d][^,]+?)\s*[-–]\s*([A-Z]{2})\s*(?:,.*)?$/i);
            if (m1) { cityFromAddr = m1[1].trim(); stateFromAddr = m1[2].toUpperCase(); }
          }

          const cityReadable = cityFromViaCep || cityFromField || cityFromAddr;
          const stateReadable = stateFromViaCep || stateFromField || stateFromAddr;

          // 3. Street name: N8N may return street only in `address`; number in `address_number`
          const streetBase = (c.address as string | undefined)?.replace(/[,\s]*\d.*$/, "").trim() || null;

          // Full address for own provider: street + number + complement + neighborhood + city + state
          const addrFullParts: string[] = [];
          if (streetBase) {
            const streetWithNum = [streetBase, c.address_number, c.address_complement]
              .filter(Boolean).join(", ");
            addrFullParts.push(streetWithNum);
          }
          if (c.neighborhood && /[a-zA-ZÀ-ÿ]/.test(c.neighborhood)) addrFullParts.push(c.neighborhood);
          if (cityReadable) addrFullParts.push(cityReadable);
          if (stateReadable) addrFullParts.push(stateReadable);
          if (fullCep) addrFullParts.push(fullCep);
          const addrFull = addrFullParts.filter(Boolean).join(", ");

          // Restricted: "Rua das Flores, *** — Londrina/PR"
          // Shows street name + hidden number, and city/state from ViaCEP
          const cityStateDisplay = cityReadable && stateReadable
            ? `${cityReadable}/${stateReadable}`
            : cityReadable || null;
          const addrRestricted = [
            streetBase ? `${streetBase}, ***` : null,
            cityStateDisplay,
          ].filter(Boolean).join(" — ") || undefined;

          return {
            providerName: customerProviderName,
            isSameProvider: isSame,
            customerName: (() => {
              const fn = (c.full_name || "Desconhecido").trim();
              if (isSame) return fn;
              const parts = fn.split(/\s+/);
              return parts.length > 1 ? `${parts[0]} ***` : fn;
            })(),
            status: paymentStatusMap[ps] || ps2 || "Em dia",
            daysOverdue: maxDays,
            overdueAmount: isSame ? overdueAmount : undefined,
            overdueAmountRange: isSame ? undefined : (overdueAmount > 0
              ? `R$ ${Math.floor(overdueAmount / 100) * 100} - R$ ${(Math.floor(overdueAmount / 100) + 1) * 100}`
              : undefined),
            overdueInvoicesCount: overdueCount,
            contractStartDate: serviceAgeMonths > 0
              ? new Date(Date.now() - serviceAgeMonths * 30 * 86400000).toISOString()
              : new Date().toISOString(),
            contractAgeDays: serviceAgeMonths * 30,
            hasUnreturnedEquipment: false,
            unreturnedEquipmentCount: 0,
            planName: isSame ? c.plan_name : undefined,
            phone: isSame ? c.phone : undefined,
            email: isSame ? c.email : undefined,
            address: isSame ? addrFull : addrRestricted,
            cep: isSame ? fullCep : maskedCep,
            addressCity: c.city || undefined,
            addressState: c.state || undefined,
            lastPaymentDate: isSame ? c.payment_summary?.last_payment_date : undefined,
            lastPaymentValue: isSame ? c.payment_summary?.last_payment_value : undefined,
            openAmountTotal: isSame ? c.payment_summary?.open_amount_total : undefined,
            openItems: isSame ? (c.payment_summary?.open_items || []) : [],
          };
        });

        const alerts: string[] = [];
        for (const c of customers) {
          const ps = (c.payment_status || "").toLowerCase();
          if (ps === "overdue" || ps === "inadimplente") {
            const days = c.payment_summary?.max_days_overdue || 0;
            const amount = c.payment_summary?.open_overdue_amount || 0;
            const cProviderName = c.provider_name || provider.name;
            alerts.push(`[${cProviderName}] Cliente inadimplente: ${days} dias em atraso, R$ ${Number(amount).toFixed(2)} em aberto`);
          }
        }

        // Count providers by provider_name (N8N echoes back our sent provider_name).
        // Do NOT use provider_id — IXC returns its own internal numeric ID, not our DB ID.
        const externalProviderIds = new Set(
          customers
            .filter((c: any) => c.provider_name && c.provider_name !== provider.name)
            .map((c: any) => c.provider_name)
        );
        const ownProviderIds = new Set(
          customers
            .filter((c: any) => c.provider_name && c.provider_name === provider.name)
            .map((_: any) => provider.name)
        );
        const uniqueProviderIds = new Set([...Array.from(externalProviderIds), ...Array.from(ownProviderIds)]);
        const isOwnCustomer = ownProviderIds.size > 0;

        // Charge 1 ISP credit per external provider found
        const externalProvidersFound = externalProviderIds.size;
        const creditsCost = externalProvidersFound;

        // Refresh provider for latest credit balance
        const freshProvider = await storage.getProvider(providerId);
        if (!freshProvider) {
          return res.status(400).json({ message: "Provedor nao encontrado" });
        }
        if (creditsCost > 0 && freshProvider.ispCredits < creditsCost) {
          return res.status(402).json({
            message: `Creditos insuficientes. Esta consulta requer ${creditsCost} credito(s) ISP. Voce tem ${freshProvider.ispCredits}.`,
          });
        }
        if (creditsCost > 0) {
          await storage.updateProviderCredits(
            providerId,
            freshProvider.ispCredits - creditsCost,
            freshProvider.spcCredits,
          );
        }

        // ── CEP FALLBACK: busca histórico de consultas por prefixo de CEP ──
        // Se N8N address search retornar vazio, buscar no histórico de consultas
        // armazenadas que tenham clientes com aquele CEP (5 primeiros dígitos).
        let cepFallbackDetails: any[] = [];
        if (isCepSearch && customers.length === 0) {
          const cepPrefix = cleaned.replace(/^(\d{5})(\d{3})$/, "$1-"); // "86671-"
          console.log(`[ISP-CEP-FALLBACK] Buscando histórico por prefixo "${cepPrefix}"`);
          const historicConsultations = await storage.getConsultationsByCepPrefix(cepPrefix, 90);
          console.log(`[ISP-CEP-FALLBACK] Encontrou ${historicConsultations.length} consultas no histórico`);
          for (const hist of historicConsultations) {
            const histResult = hist.result as any;
            const histDetails: any[] = histResult?.providerDetails || [];
            for (const hd of histDetails) {
              // Only include details where the cep matches the prefix
              if (!hd.cep || !String(hd.cep).startsWith(cepPrefix)) continue;
              // Re-apply isSameProvider based on current provider name
              const hdIsSame = hd.providerName === provider.name;
              cepFallbackDetails.push({
                ...hd,
                isSameProvider: hdIsSame,
                // Re-mask name if needed
                customerName: hdIsSame
                  ? hd.customerName
                  : (() => {
                    const name = (hd.customerName || "").replace(/ \*\*\*$/, "").split(/\s+/);
                    return name.length > 1 ? `${name[0]} ***` : name[0] || "***";
                  })(),
                // Re-mask address / cep for non-own provider
                address: hdIsSame ? (hd.address || hd.addressRestricted || undefined) : (hd.address || undefined),
                cep: hdIsSame ? hd.cep : (hd.cep ? String(hd.cep).replace(/^(\d{5}|[0-9]{5}).*/, "$1-***") : undefined),
                // Don't show financial details for external providers
                overdueAmount: hdIsSame ? hd.overdueAmount : undefined,
                overdueAmountRange: hdIsSame ? undefined : (hd.overdueAmount != null && hd.overdueAmount > 0
                  ? `R$ ${Math.floor(hd.overdueAmount / 100) * 100} - R$ ${(Math.floor(hd.overdueAmount / 100) + 1) * 100}`
                  : hd.overdueAmountRange),
                isFromHistory: true,
              });
            }
          }
          // De-duplicate by customerName+cep
          const seenKey = new Set<string>();
          cepFallbackDetails = cepFallbackDetails.filter(d => {
            const k = `${d.customerName}|${d.providerName}|${d.cep}`;
            if (seenKey.has(k)) return false;
            seenKey.add(k);
            return true;
          });
          console.log(`[ISP-CEP-FALLBACK] Detalhes encontrados no histórico: ${cepFallbackDetails.length}`);
        }

        const finalProviderDetails = providerDetails.length > 0 ? providerDetails : cepFallbackDetails;
        const finalNotFound = finalProviderDetails.length === 0;

        const result = {
          cpfCnpj: cleaned,
          searchType,
          notFound: finalNotFound,
          score: finalScore,
          riskTier: risk.tier,
          riskLabel: risk.label,
          recommendation: risk.recommendation,
          decisionReco,
          providersFound: uniqueProviderIds.size,
          providerDetails: finalProviderDetails,
          penalties: [],
          bonuses: [],
          alerts,
          recommendedActions,
          creditsCost,
          isOwnCustomer,
          addressMatches: n8nAddressMatches,
          source: providerDetails.length > 0 ? "n8n_central" : (cepFallbackDetails.length > 0 ? "history_fallback" : "n8n_central"),
          isHistoryResult: cepFallbackDetails.length > 0 && providerDetails.length === 0,
        };

        const consultation = await storage.createIspConsultation({
          providerId,
          userId: req.session.userId!,
          cpfCnpj: cleaned,
          searchType,
          result,
          score: finalScore,
          decisionReco,
          cost: creditsCost,
          approved: finalScore >= 50,
        });

        return res.json({ consultation, result });
      }
      // ── FIM N8N CENTRAL ───────────────────────────────────────────────

      // ── N8N INTEGRATION (LEGACY — fallback for current provider only) ─
      const n8nCfg = await storage.getN8nConfig(providerId);
      if (n8nCfg.n8nEnabled && n8nCfg.n8nWebhookUrl) {
        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (n8nCfg.n8nAuthToken) {
            headers["Authorization"] = `Basic ${n8nCfg.n8nAuthToken}`;
          }
          const n8nPayload = {
            searchType: "document",
            document: cleaned,
            providerId: String(providerId),
          };

          const n8nRes = await fetch(n8nCfg.n8nWebhookUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(n8nPayload),
            signal: AbortSignal.timeout(15000),
          });

          if (n8nRes.status === 401) {
            return res.status(502).json({ message: "Erro de autenticacao com a API N8N (401). Verifique o token Basic Auth nas configuracoes de integracao." });
          }

          const n8nData: any = await n8nRes.json();

          if (!n8nRes.ok || n8nData.success === false) {
            return res.status(502).json({ message: n8nData.error || n8nData.message || `Erro N8N HTTP ${n8nRes.status}` });
          }

          const customers: any[] = Array.isArray(n8nData.customers) ? n8nData.customers : [];
          const notFound = customers.length === 0;
          const isOwnCustomer = customers.some((c: any) => c.isOwnProvider === true);

          // Derive score: use lowest ispScore if multiple customers, 100 if not found
          const scores = customers.map((c: any) => typeof c.ispScore === "number" ? c.ispScore : 100);
          const finalScore = notFound ? 100 : Math.min(...scores);

          const risk = getRiskTier(finalScore);
          const decisionReco = getDecisionReco(finalScore);
          const recommendedActions = getRecommendedActions(finalScore, customers.some((c: any) => Array.isArray(c.notReturnedEquipment) && c.notReturnedEquipment.length > 0));

          // Map N8N customers to providerDetails format
          const providerDetails = customers.map((c: any) => {
            const serviceAgeDays = typeof c.serviceAge === "number" ? c.serviceAge * 30 : 0;
            const paymentStatusMap: Record<string, string> = {
              "Current": "Em dia",
              "Overdue": "Inadimplente",
              "Cancelled": "Cancelado",
              "Suspended": "Suspenso",
            };
            return {
              providerName: c.providerName || "Provedor desconhecido",
              isSameProvider: !!c.isOwnProvider,
              customerName: c.customerName || "Desconhecido",
              status: paymentStatusMap[c.paymentStatus] || c.paymentStatus || "Em dia",
              daysOverdue: 0,
              overdueAmount: c.isOwnProvider ? 0 : undefined,
              overdueAmountRange: c.isOwnProvider ? undefined : "N/A",
              overdueInvoicesCount: 0,
              contractStartDate: new Date(Date.now() - serviceAgeDays * 86400000).toISOString(),
              contractAgeDays: serviceAgeDays,
              hasUnreturnedEquipment: Array.isArray(c.notReturnedEquipment) && c.notReturnedEquipment.length > 0,
              unreturnedEquipmentCount: Array.isArray(c.notReturnedEquipment) ? c.notReturnedEquipment.length : 0,
              equipmentDetails: c.isOwnProvider && Array.isArray(c.notReturnedEquipment) ? c.notReturnedEquipment : undefined,
              planName: c.planName,
              monthlyRevenue: c.monthlyRevenue,
              appliedRules: c.appliedRules,
            };
          });

          const alerts: string[] = [];
          for (const c of customers) {
            if (Array.isArray(c.riskFactors)) {
              alerts.push(...c.riskFactors);
            }
          }

          const cost = customers.reduce((sum: number, c: any) => sum + (typeof c.cost === "number" ? c.cost : 0), 0);

          const result = {
            cpfCnpj: cleaned,
            searchType,
            notFound,
            score: finalScore,
            riskTier: risk.tier,
            riskLabel: risk.label,
            recommendation: risk.recommendation,
            decisionReco,
            providersFound: new Set(customers.map((c: any) => c.providerName)).size,
            providerDetails,
            penalties: [],
            bonuses: [],
            alerts,
            recommendedActions,
            creditsCost: cost,
            isOwnCustomer,
            source: "n8n",
          };

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
            await storage.updateProviderCredits(provider.id, provider.ispCredits - cost, provider.spcCredits);
          }

          return res.json({ consultation, result });
        } catch (n8nErr: any) {
          if (n8nErr.name === "AbortError" || n8nErr.name === "TimeoutError") {
            return res.status(504).json({ message: "Timeout ao conectar com a API N8N (15s). Verifique a URL e o status do servidor N8N." });
          }
          return res.status(502).json({ message: `Erro ao chamar API N8N: ${n8nErr.message}` });
        }
      }
      // ── FIM N8N INTEGRATION ──────────────────────────────────────────

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

        const detail: any = {
          providerName: customerProvider?.name || "Provedor desconhecido",
          isSameProvider,
          customerName: customer.name,
          status: paymentStatusLabel,
          daysOverdue: maxDays,
          overdueAmount: isSameProvider ? totalOverdue : undefined,
          overdueAmountRange: isSameProvider ? undefined : getOverdueAmountRange(totalOverdue),
          overdueInvoicesCount: overdueCount,
          contractStartDate: oldestContract.toISOString(),
          contractAgeDays,
          contractStatus,
          hasUnreturnedEquipment: unreturnedCount > 0,
          unreturnedEquipmentCount: unreturnedCount,
        };

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

          const nameParts = mc.name.trim().split(/\s+/);
          const maskedName = isSameProvider
            ? mc.name
            : nameParts.length > 1 ? `${nameParts[0]} ***` : mc.name;

          const rawCpf = mc.cpfCnpj.replace(/\D/g, "");
          const maskedDoc = isSameProvider
            ? mc.cpfCnpj
            : rawCpf.length === 14
              ? `${rawCpf.substring(0, 2)}.***.***/${rawCpf.substring(8, 12)}-**`
              : `${rawCpf.substring(0, 3)}.***.***-**`;

          addressMatches.push({
            customerName: maskedName,
            cpfCnpj: maskedDoc,
            address: mc.address,
            city: mc.city,
            state: mc.state,
            providerName: isSameProvider ? (mcProvider?.name || "Seu provedor") : "Outro provedor da rede",
            isSameProvider,
            status: maxDays === 0 ? "Em dia" : `Inadimplente (${maxDays}d)`,
            daysOverdue: maxDays,
            totalOverdue: isSameProvider ? totalOverdue : undefined,
            hasDebt: maxDays > 0 || totalOverdue > 0,
          });
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
