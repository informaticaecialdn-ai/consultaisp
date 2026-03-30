import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";

export function registerImportRoutes(): Router {
  const router = Router();

  router.post("/api/import/customers", requireAuth, async (req, res) => {
    try {
      const { rows } = req.body as { rows: Record<string, string>[] };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "Nenhuma linha enviada" });
      }
      const providerId = req.session.providerId!;
      let imported = 0;
      const errors: { row: number; message: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const cpfCnpj = (r.cpf_cnpj || r.cpfCnpj || "").replace(/\D/g, "");
        const name = (r.nome || r.name || "").trim();
        if (!name) { errors.push({ row: i + 1, message: "Nome obrigatorio" }); continue; }
        if (!cpfCnpj) { errors.push({ row: i + 1, message: "CPF/CNPJ obrigatorio" }); continue; }
        try {
          const existing = await storage.getCustomerByCpfCnpj(cpfCnpj);
          const alreadyExists = existing.some(c => c.providerId === providerId);
          if (alreadyExists) { errors.push({ row: i + 1, message: `CPF/CNPJ ${r.cpf_cnpj || cpfCnpj} ja cadastrado` }); continue; }
          await storage.createCustomer({
            providerId,
            name,
            cpfCnpj,
            email: r.email || null,
            phone: r.telefone || r.phone || null,
            address: r.endereco || r.address || null,
            city: r.cidade || r.city || null,
            state: r.estado || r.state || null,
            cep: r.cep || null,
            status: (r.status || "active") as string,
            erpSource: "import",
          });
          imported++;
        } catch (e: any) {
          errors.push({ row: i + 1, message: e.message });
        }
      }
      return res.json({ imported, errors });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/import/invoices", requireAuth, async (req, res) => {
    try {
      const { rows } = req.body as { rows: Record<string, string>[] };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "Nenhuma linha enviada" });
      }
      const providerId = req.session.providerId!;
      let imported = 0;
      const errors: { row: number; message: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const cpfCnpj = (r.cpf_cnpj || r.cpfCnpj || "").replace(/\D/g, "");
        const valorStr = (r.valor || r.value || "0").replace(",", ".");
        const valor = parseFloat(valorStr);
        const dueDateStr = r.data_vencimento || r.dueDate || r.due_date || "";
        if (!dueDateStr) { errors.push({ row: i + 1, message: "Data de vencimento obrigatoria" }); continue; }
        if (isNaN(valor) || valor <= 0) { errors.push({ row: i + 1, message: "Valor invalido" }); continue; }
        if (!cpfCnpj) { errors.push({ row: i + 1, message: "CPF/CNPJ obrigatorio" }); continue; }

        try {
          // Find or create customer
          let customer;
          const existing = await storage.getCustomerByCpfCnpj(cpfCnpj);
          const providerCustomers = existing.filter(c => c.providerId === providerId);
          if (providerCustomers.length > 0) {
            customer = providerCustomers[0];
          } else {
            const name = (r.nome_cliente || r.customerName || cpfCnpj).trim();
            customer = await storage.createCustomer({
              providerId,
              name,
              cpfCnpj,
              erpSource: "import",
              status: "active",
            });
          }

          // Find or create contract
          const contracts = await storage.getContractsByCustomer(customer.id);
          let contract;
          if (contracts.length > 0) {
            contract = contracts[0];
          } else {
            contract = await storage.createContract({
              customerId: customer.id,
              providerId,
              plan: "Importado",
              value: String(valor),
              status: "active",
            });
          }

          // Parse due date (dd/mm/yyyy or yyyy-mm-dd)
          let dueDate: Date;
          if (dueDateStr.includes("/")) {
            const [d, m, y] = dueDateStr.split("/");
            dueDate = new Date(`${y}-${m}-${d}`);
          } else {
            dueDate = new Date(dueDateStr);
          }
          if (isNaN(dueDate.getTime())) { errors.push({ row: i + 1, message: "Formato de data invalido (use dd/mm/aaaa)" }); continue; }

          const status = (r.status || "pending") as string;
          await storage.createInvoice({
            contractId: contract.id,
            customerId: customer.id,
            providerId,
            value: String(valor),
            dueDate,
            status,
            paidDate: status === "paid" ? new Date() : undefined,
          });
          imported++;
        } catch (e: any) {
          errors.push({ row: i + 1, message: e.message });
        }
      }
      return res.json({ imported, errors });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  router.post("/api/import/equipment", requireAuth, async (req, res) => {
    try {
      const { rows } = req.body as { rows: Record<string, string>[] };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "Nenhuma linha enviada" });
      }
      const providerId = req.session.providerId!;
      let imported = 0;
      const errors: { row: number; message: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const tipo = (r.tipo || r.type || "").trim();
        if (!tipo) { errors.push({ row: i + 1, message: "Tipo de equipamento obrigatorio" }); continue; }

        let customerId: number | null = null;
        const cpfCnpj = (r.cpf_cnpj || r.cpfCnpj || "").replace(/\D/g, "");
        if (cpfCnpj) {
          const existing = await storage.getCustomerByCpfCnpj(cpfCnpj);
          const providerCustomers = existing.filter(c => c.providerId === providerId);
          if (providerCustomers.length > 0) {
            customerId = providerCustomers[0].id;
          } else {
            const name = (r.nome_cliente || r.customerName || cpfCnpj).trim();
            const created = await storage.createCustomer({ providerId, name, cpfCnpj, erpSource: "import", status: "active" });
            customerId = created.id;
          }
        }

        try {
          const valorStr = (r.valor || r.value || "").replace(",", ".");
          const valor = parseFloat(valorStr) || undefined;
          await storage.createEquipment({
            providerId,
            customerId: customerId ?? undefined,
            type: tipo,
            brand: r.marca || r.brand || null,
            model: r.modelo || r.model || null,
            serialNumber: r.numero_serie || r.serialNumber || null,
            mac: r.mac || null,
            status: (r.status || "installed") as string,
            value: valor ? String(valor) : null,
          });
          imported++;
        } catch (e: any) {
          errors.push({ row: i + 1, message: e.message });
        }
      }
      return res.json({ imported, errors });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  return router;
}
