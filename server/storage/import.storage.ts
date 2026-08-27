import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  customers, contracts, invoices, equipment,
  type InsertCustomer, type InsertContract, type InsertInvoice, type InsertEquipment,
} from "@shared/schema";

import { EquipmentStorage } from "./equipment.storage";
import { CustomersStorage } from "./customers.storage";

type ValidationError = { row: number; message: string };
type ImportResult = { imported: number; errors: ValidationError[] };

export class ImportStorage {
  private _equipment = new EquipmentStorage();
  private _customers = new CustomersStorage();

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
    const validRows: Array<{ index: number; tipo: string; cpfCnpj: string; status: string; raw: Record<string, string> }> = [];
    const seriesNoArquivo = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const tipo = (r.tipo || r.type || "").trim();
      if (!tipo) { validationErrors.push({ row: i + 1, message: "Tipo de equipamento obrigatorio" }); continue; }
      const cpfCnpj = (r.cpf_cnpj || r.cpfCnpj || "").replace(/\D/g, "");
      if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
        validationErrors.push({ row: i + 1, message: "CPF/CNPJ obrigatorio e invalido" });
        continue;
      }
      const statusOriginal = (r.status || "em_comodato").trim().toLowerCase();
      const statusMap: Record<string, string> = {
        installed: "em_comodato",
        em_comodato: "em_comodato",
        returned: "recuperado_triagem",
        devolvido: "recuperado_triagem",
        recuperado: "recuperado_triagem",
        recuperado_triagem: "recuperado_triagem",
        lost: "retirada_pendente",
        not_returned: "retirada_pendente",
        retido: "retirada_pendente",
        em_cobranca: "retirada_pendente",
        retirada_pendente: "retirada_pendente",
        baixado: "baixado",
      };
      const status = statusMap[statusOriginal];
      if (!status) {
        validationErrors.push({ row: i + 1, message: `Status de equipamento invalido: ${statusOriginal}` });
        continue;
      }
      const serie = (r.numero_serie || r.serialNumber || "").trim().toLowerCase();
      if (serie && seriesNoArquivo.has(serie)) {
        validationErrors.push({ row: i + 1, message: "Numero de serie duplicado no arquivo" });
        continue;
      }
      if (serie) seriesNoArquivo.add(serie);
      const valorStr = (r.valor || r.value || "").replace(",", ".");
      const valor = valorStr ? Number(valorStr) : 0;
      if (!Number.isFinite(valor) || valor < 0) {
        validationErrors.push({ row: i + 1, message: "Valor do equipamento invalido" });
        continue;
      }
      validRows.push({ index: i, tipo, cpfCnpj, status, raw: r });
    }

    // If any validation errors, reject the entire batch
    if (validationErrors.length > 0) {
      return { imported: 0, errors: validationErrors };
    }

    // ── Phase 2: Atomic transaction — any DB error rolls back everything ──
    const clientesAfetados = new Set<number>();

    const resultado = await db.transaction(async (tx) => {
      let imported = 0;

      for (const { tipo, cpfCnpj, status, raw: r } of validRows) {
        let customerId: number | null = null;
        if (cpfCnpj) {
          const existing = await tx.select().from(customers).where(and(
            eq(customers.cpfCnpj, cpfCnpj),
            eq(customers.providerId, providerId),
          ));
          if (existing.length > 0) {
            customerId = existing[0].id;
          } else {
            const name = (r.nome_cliente || r.customerName || cpfCnpj).trim();
            const [created] = await tx.insert(customers).values({
              providerId, name, cpfCnpj, erpSource: "import", status: "active",
            } as InsertCustomer).returning();
            customerId = created.id;
          }
          if (customerId) clientesAfetados.add(customerId);
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
          status,
          value: valor ? String(valor) : null,
          source: "import",
        } as InsertEquipment);
        imported++;
      }
      return { imported, errors: [] };
    });

    // A consulta em rede le o agregado em customers, nao a tabela de equipamento.
    // Sem este recalculo, equipamento importado por planilha nao apareceria la.
    // Fora da transacao de proposito: segurar o lock durante o recalculo
    // bloquearia a tabela por toda a duracao de uma planilha grande.
    if (clientesAfetados.size > 0) {
      const ids = Array.from(clientesAfetados);
      const agregado = await this._equipment.contarEquipamentoRetido(providerId, ids);
      for (const id of ids) {
        const a = agregado.get(id);
        await this._customers.updateCustomerEquipmentAggregate(
          providerId, id, a?.count ?? 0, String(a?.value ?? 0),
        );
      }
    }

    return resultado;
  }
}
