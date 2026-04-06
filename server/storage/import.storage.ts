import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  customers, contracts, invoices, equipment,
  type InsertCustomer, type InsertContract, type InsertInvoice, type InsertEquipment,
} from "@shared/schema";

type ValidationError = { row: number; message: string };
type ImportResult = { imported: number; errors: ValidationError[] };

export class ImportStorage {
  async bulkImportCustomers(
    rows: Record<string, string>[],
    providerId: number,
  ): Promise<ImportResult> {
    // ── Phase 1: Validate all rows before touching the database ──
    const validationErrors: ValidationError[] = [];
    const validRows: Array<{ index: number; name: string; cpfCnpj: string; raw: Record<string, string> }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const cpfCnpj = (r.cpf_cnpj || r.cpfCnpj || "").replace(/\D/g, "");
      const name = (r.nome || r.name || "").trim();
      if (!name) { validationErrors.push({ row: i + 1, message: "Nome obrigatorio" }); continue; }
      if (!cpfCnpj) { validationErrors.push({ row: i + 1, message: "CPF/CNPJ obrigatorio" }); continue; }
      validRows.push({ index: i, name, cpfCnpj, raw: r });
    }

    // If any validation errors, reject the entire batch
    if (validationErrors.length > 0) {
      return { imported: 0, errors: validationErrors };
    }

    // ── Phase 2: Atomic transaction — any DB error rolls back everything ──
    return db.transaction(async (tx) => {
      let imported = 0;
      for (const { name, cpfCnpj, raw: r } of validRows) {
        const existing = await tx.select().from(customers).where(eq(customers.cpfCnpj, cpfCnpj));
        const alreadyExists = existing.some(c => c.providerId === providerId);
        if (alreadyExists) {
          throw new Error(`CPF/CNPJ ${r.cpf_cnpj || cpfCnpj} ja cadastrado (linha ${validRows.indexOf(validRows.find(v => v.cpfCnpj === cpfCnpj)!) + 1})`);
        }
        await tx.insert(customers).values({
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
        } as InsertCustomer);
        imported++;
      }
      return { imported, errors: [] };
    });
  }

  async bulkImportInvoices(
    rows: Record<string, string>[],
    providerId: number,
  ): Promise<ImportResult> {
    // ── Phase 1: Validate all rows before touching the database ──
    const validationErrors: ValidationError[] = [];
    const validRows: Array<{ index: number; cpfCnpj: string; valor: number; dueDateStr: string; raw: Record<string, string> }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const cpfCnpj = (r.cpf_cnpj || r.cpfCnpj || "").replace(/\D/g, "");
      const valorStr = (r.valor || r.value || "0").replace(",", ".");
      const valor = parseFloat(valorStr);
      const dueDateStr = r.data_vencimento || r.dueDate || r.due_date || "";
      if (!dueDateStr) { validationErrors.push({ row: i + 1, message: "Data de vencimento obrigatoria" }); continue; }
      if (isNaN(valor) || valor <= 0) { validationErrors.push({ row: i + 1, message: "Valor invalido" }); continue; }
      if (!cpfCnpj) { validationErrors.push({ row: i + 1, message: "CPF/CNPJ obrigatorio" }); continue; }

      // Validate date format before transaction
      let dueDate: Date;
      if (dueDateStr.includes("/")) {
        const [d, m, y] = dueDateStr.split("/");
        dueDate = new Date(`${y}-${m}-${d}`);
      } else {
        dueDate = new Date(dueDateStr);
      }
      if (isNaN(dueDate.getTime())) { validationErrors.push({ row: i + 1, message: "Formato de data invalido (use dd/mm/aaaa)" }); continue; }

      validRows.push({ index: i, cpfCnpj, valor, dueDateStr, raw: r });
    }

    // If any validation errors, reject the entire batch
    if (validationErrors.length > 0) {
      return { imported: 0, errors: validationErrors };
    }

    // ── Phase 2: Atomic transaction — any DB error rolls back everything ──
    return db.transaction(async (tx) => {
      let imported = 0;

      for (const { cpfCnpj, valor, dueDateStr, raw: r } of validRows) {
        // Find or create customer
        let customer;
        const existing = await tx.select().from(customers).where(eq(customers.cpfCnpj, cpfCnpj));
        const providerCustomers = existing.filter(c => c.providerId === providerId);
        if (providerCustomers.length > 0) {
          customer = providerCustomers[0];
        } else {
          const name = (r.nome_cliente || r.customerName || cpfCnpj).trim();
          const [created] = await tx.insert(customers).values({
            providerId,
            name,
            cpfCnpj,
            erpSource: "import",
            status: "active",
          } as InsertCustomer).returning();
          customer = created;
        }

        // Find or create contract
        const existingContracts = await tx.select().from(contracts).where(eq(contracts.customerId, customer.id));
        let contract;
        if (existingContracts.length > 0) {
          contract = existingContracts[0];
        } else {
          const [created] = await tx.insert(contracts).values({
            customerId: customer.id,
            providerId,
            plan: "Importado",
            value: String(valor),
            status: "active",
          } as InsertContract).returning();
          contract = created;
        }

        // Parse due date
        let dueDate: Date;
        if (dueDateStr.includes("/")) {
          const [d, m, y] = dueDateStr.split("/");
          dueDate = new Date(`${y}-${m}-${d}`);
        } else {
          dueDate = new Date(dueDateStr);
        }

        const status = (r.status || "pending") as string;
        await tx.insert(invoices).values({
          contractId: contract.id,
          customerId: customer.id,
          providerId,
          value: String(valor),
          dueDate,
          status,
          paidDate: status === "paid" ? new Date() : undefined,
        } as InsertInvoice);
        imported++;
      }
      return { imported, errors: [] };
    });
  }

  async bulkImportEquipment(
    rows: Record<string, string>[],
    providerId: number,
  ): Promise<ImportResult> {
    // ── Phase 1: Validate all rows before touching the database ──
    const validationErrors: ValidationError[] = [];
    const validRows: Array<{ index: number; tipo: string; cpfCnpj: string; raw: Record<string, string> }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const tipo = (r.tipo || r.type || "").trim();
      if (!tipo) { validationErrors.push({ row: i + 1, message: "Tipo de equipamento obrigatorio" }); continue; }
      const cpfCnpj = (r.cpf_cnpj || r.cpfCnpj || "").replace(/\D/g, "");
      validRows.push({ index: i, tipo, cpfCnpj, raw: r });
    }

    // If any validation errors, reject the entire batch
    if (validationErrors.length > 0) {
      return { imported: 0, errors: validationErrors };
    }

    // ── Phase 2: Atomic transaction — any DB error rolls back everything ──
    return db.transaction(async (tx) => {
      let imported = 0;

      for (const { tipo, cpfCnpj, raw: r } of validRows) {
        let customerId: number | null = null;
        if (cpfCnpj) {
          const existing = await tx.select().from(customers).where(eq(customers.cpfCnpj, cpfCnpj));
          const providerCustomers = existing.filter(c => c.providerId === providerId);
          if (providerCustomers.length > 0) {
            customerId = providerCustomers[0].id;
          } else {
            const name = (r.nome_cliente || r.customerName || cpfCnpj).trim();
            const [created] = await tx.insert(customers).values({
              providerId, name, cpfCnpj, erpSource: "import", status: "active",
            } as InsertCustomer).returning();
            customerId = created.id;
          }
        }

        const valorStr = (r.valor || r.value || "").replace(",", ".");
        const valor = parseFloat(valorStr) || undefined;
        await tx.insert(equipment).values({
          providerId,
          customerId: customerId ?? undefined,
          type: tipo,
          brand: r.marca || r.brand || null,
          model: r.modelo || r.model || null,
          serialNumber: r.numero_serie || r.serialNumber || null,
          mac: r.mac || null,
          status: (r.status || "installed") as string,
          value: valor ? String(valor) : null,
        } as InsertEquipment);
        imported++;
      }
      return { imported, errors: [] };
    });
  }
}
