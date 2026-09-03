import { and, desc, eq, gte, inArray, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  customers,
  equipment,
  equipmentRecoveryCases,
  equipmentRecoveryEvents,
  providers,
  users,
  type Equipment,
  type EquipmentRecoveryCase,
  type EquipmentRecoveryEvent,
  type InsertEquipment,
  type InsertEquipmentRecoveryCase,
} from "@shared/schema";
import { decidirAcaoSync, type EquipamentoErp } from "../services/equipment-sync-rules";
import {
  casoEstaEncerrado,
  equipamentoTemRetiradaPendente,
  STATUS_EQUIPAMENTO_PENDENTE,
  validarSinalBureau,
  type RecoveryAttemptResult,
} from "../services/equipment-recovery-rules";
import type {
  EntradaCasoBoard,
  EntradaEquipamentoSemCasoBoard,
  EntradaTentativaBoard,
} from "../services/recovery-board.service";

/**
 * Colunas do cliente que o card do kanban mostra. Compartilhadas pelas duas
 * leituras do board (casos e equipamento sem caso) para o card sair igual
 * venha de onde vier.
 */
const colunasClienteBoard = {
  clienteId: customers.id,
  clienteNome: customers.name,
  clienteCpfCnpj: customers.cpfCnpj,
  clienteTelefone: customers.phone,
  clienteEndereco: customers.address,
  clienteNumero: customers.addressNumber,
  clienteBairro: customers.neighborhood,
  clienteCidade: customers.city,
  clienteUf: customers.state,
  clienteSituacao: customers.status,
  clienteDivida: customers.totalOverdueAmount,
  clienteDiasAtraso: customers.maxDaysOverdue,
};

const colunasEquipamentoBoard = {
  equipamentoId: equipment.id,
  equipamentoTipo: equipment.type,
  equipamentoMarca: equipment.brand,
  equipamentoModelo: equipment.model,
  equipamentoSerie: equipment.serialNumber,
  equipamentoMac: equipment.mac,
  equipamentoPatrimonio: equipment.assetTag,
  equipamentoValor: equipment.value,
  equipamentoStatus: equipment.status,
};

interface LinhaClienteBoard {
  clienteId: number;
  clienteNome: string;
  clienteCpfCnpj: string;
  clienteTelefone: string | null;
  clienteEndereco: string | null;
  clienteNumero: string | null;
  clienteBairro: string | null;
  clienteCidade: string | null;
  clienteUf: string | null;
  clienteSituacao: string;
  clienteDivida: string | null;
  clienteDiasAtraso: number | null;
}

interface LinhaEquipamentoBoard {
  equipamentoId: number;
  equipamentoTipo: string;
  equipamentoMarca: string | null;
  equipamentoModelo: string | null;
  equipamentoSerie: string | null;
  equipamentoMac: string | null;
  equipamentoPatrimonio: string | null;
  equipamentoValor: string | null;
  equipamentoStatus: string;
}

function montarClienteBoard(l: LinhaClienteBoard): EntradaCasoBoard["cliente"] {
  return {
    id: l.clienteId,
    nome: l.clienteNome,
    cpfCnpj: l.clienteCpfCnpj,
    telefone: l.clienteTelefone,
    endereco: l.clienteEndereco,
    numero: l.clienteNumero,
    bairro: l.clienteBairro,
    cidade: l.clienteCidade,
    uf: l.clienteUf,
    situacao: l.clienteSituacao,
    dividaEmAberto: l.clienteDivida,
    diasEmAtraso: l.clienteDiasAtraso,
  };
}

function montarEquipamentoBoard(l: LinhaEquipamentoBoard): EntradaCasoBoard["equipamento"] {
  return {
    id: l.equipamentoId,
    tipo: l.equipamentoTipo,
    marca: l.equipamentoMarca,
    modelo: l.equipamentoModelo,
    serie: l.equipamentoSerie,
    mac: l.equipamentoMac,
    patrimonio: l.equipamentoPatrimonio,
    valor: l.equipamentoValor,
    status: l.equipamentoStatus,
  };
}

/**
 * Status de `equipment` que entram na coluna "sem data" quando não há caso
 * aberto — a mesma lista que `equipamentoTemRetiradaPendente` usa em memória,
 * legados incluídos. Sem isso um `not_returned` importado aparece como
 * pendente na aba Recuperação e some do kanban.
 */
const STATUS_EQUIPAMENTO_RETIDO = STATUS_EQUIPAMENTO_PENDENTE;

export interface RecoveryCaseWithDetails extends EquipmentRecoveryCase {
  customerName: string;
  customerCpfCnpj: string;
  customerPhone: string | null;
  equipmentType: string;
  equipmentBrand: string | null;
  equipmentModel: string | null;
  equipmentSerialNumber: string | null;
  equipmentAssetTag: string | null;
  equipmentValue: string | null;
}

export interface ValidatedRecoverySignal {
  providerId: number;
  providerName: string;
  customerName: string;
  count: number;
  totalValue: number;
  categories: string[];
  terminationDate: Date;
  deadlineAt: Date;
}

export class EquipmentStorage {
  async getEquipmentByProvider(providerId: number): Promise<Equipment[]> {
    return db.select().from(equipment).where(eq(equipment.providerId, providerId));
  }

  async getEquipmentByCustomer(customerId: number, providerId: number): Promise<Equipment[]> {
    return db.select().from(equipment).where(and(
      eq(equipment.customerId, customerId),
      eq(equipment.providerId, providerId),
    ));
  }

  async createEquipment(eq_data: InsertEquipment): Promise<Equipment> {
    const [created] = await db.insert(equipment).values(eq_data).returning();
    return created;
  }

  /** providerId no WHERE e isolamento multi-tenant, nao conveniencia. */
  async getEquipmentById(id: number, providerId: number): Promise<Equipment | undefined> {
    const [found] = await db.select().from(equipment)
      .where(and(eq(equipment.id, id), eq(equipment.providerId, providerId)))
      .limit(1);
    return found;
  }

  async updateEquipment(
    id: number,
    providerId: number,
    data: Partial<InsertEquipment>,
  ): Promise<Equipment | undefined> {
    const [updated] = await db.update(equipment)
      .set(data)
      .where(and(eq(equipment.id, id), eq(equipment.providerId, providerId)))
      .returning();
    return updated;
  }

  async removeEquipment(id: number, providerId: number): Promise<boolean> {
    const removed = await db.delete(equipment)
      .where(and(eq(equipment.id, id), eq(equipment.providerId, providerId)))
      .returning();
    return removed.length > 0;
  }

  /**
   * Aplica o resultado do ERP sobre o equipamento de um cliente.
   * A decisao por aparelho vem de decidirAcaoSync (funcao pura, testada) —
   * aqui so executamos.
   */
  async syncEquipmentFromErp(
    providerId: number,
    customerId: number,
    detalhes: EquipamentoErp[],
  ): Promise<{ inseridos: number; devolvidos: number }> {
    if (detalhes.length === 0) return { inseridos: 0, devolvidos: 0 };

    const atuais = await db.select().from(equipment)
      .where(and(eq(equipment.providerId, providerId), eq(equipment.customerId, customerId)));

    const porSerie = new Map<string, typeof atuais[number]>();
    for (const a of atuais) {
      if (a.serialNumber) porSerie.set(a.serialNumber.trim().toLowerCase(), a);
    }

    let inseridos = 0;
    let devolvidos = 0;

    for (const d of detalhes) {
      const chave = d.serialNumber?.trim().toLowerCase() || "";
      const existente = chave ? porSerie.get(chave) : undefined;
      const acao = decidirAcaoSync(
        existente
          ? { id: existente.id, serialNumber: existente.serialNumber, status: existente.status }
          : undefined,
        d,
      );

      if (acao === "inserir") {
        await db.insert(equipment).values({
          providerId,
          customerId,
          type: d.type || "Equipamento",
          brand: d.brand || null,
          model: d.model || null,
          serialNumber: d.serialNumber,
          // O ERP que ja classifica o aparelho como pendente entra contando;
          // valor desconhecido fica nulo — nunca inventamos R$ para o bureau.
          status: equipamentoTemRetiradaPendente(d.status) || d.inRecoveryProcess
            ? "retirada_pendente"
            : "em_comodato",
          inRecoveryProcess: d.inRecoveryProcess,
          value: d.value || null,
          source: "erp",
        });
        inseridos++;
      } else if (acao === "marcar-devolvido" && existente) {
        await db.update(equipment)
          .set({ status: "recuperado_triagem", inRecoveryProcess: false, updatedAt: new Date() })
          .where(eq(equipment.id, existente.id));
        devolvidos++;
      }
    }

    return { inseridos, devolvidos };
  }

  /**
   * Contagem e valor de equipamento NAO devolvido, para N clientes numa query.
   * A consulta em rede usa isso; fazer N+1 aqui derrubaria o tempo de resposta.
   */
  async contarEquipamentoRetido(
    providerId: number,
    customerIds: number[],
  ): Promise<Map<number, { count: number; value: number }>> {
    const mapa = new Map<number, { count: number; value: number }>();
    if (customerIds.length === 0) return mapa;

    const linhas = await db.select({
      customerId: equipment.customerId,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${equipment.value}), 0)::float`,
    })
      .from(equipment)
      .where(and(
        eq(equipment.providerId, providerId),
        inArray(equipment.customerId, customerIds),
        sql`lower(${equipment.status}) in ('retirada_pendente', 'nao_localizado', 'retido', 'em_cobranca', 'not_returned')`,
      ))
      .groupBy(equipment.customerId);

    for (const l of linhas) {
      if (l.customerId != null) mapa.set(l.customerId, { count: l.count, value: l.total });
    }
    return mapa;
  }

  async recalculateCustomerEquipmentAggregate(providerId: number, customerId: number): Promise<void> {
    const result = await this.contarEquipamentoRetido(providerId, [customerId]);
    const current = result.get(customerId);
    await db.update(customers)
      .set({
        equipmentCount: current?.count ?? 0,
        equipmentEstimatedValue: String(current?.value ?? 0),
      })
      .where(and(eq(customers.id, customerId), eq(customers.providerId, providerId)));
  }

  async getRecoveryCases(providerId: number): Promise<RecoveryCaseWithDetails[]> {
    return db.select({
      id: equipmentRecoveryCases.id,
      providerId: equipmentRecoveryCases.providerId,
      equipmentId: equipmentRecoveryCases.equipmentId,
      customerId: equipmentRecoveryCases.customerId,
      status: equipmentRecoveryCases.status,
      priority: equipmentRecoveryCases.priority,
      terminationDate: equipmentRecoveryCases.terminationDate,
      deadlineAt: equipmentRecoveryCases.deadlineAt,
      scheduledAt: equipmentRecoveryCases.scheduledAt,
      collectionMethod: equipmentRecoveryCases.collectionMethod,
      assignedToUserId: equipmentRecoveryCases.assignedToUserId,
      proofReference: equipmentRecoveryCases.proofReference,
      customerNotifiedAt: equipmentRecoveryCases.customerNotifiedAt,
      notificationProtocol: equipmentRecoveryCases.notificationProtocol,
      evidenceValidatedAt: equipmentRecoveryCases.evidenceValidatedAt,
      evidenceValidatedById: equipmentRecoveryCases.evidenceValidatedById,
      bureauStatus: equipmentRecoveryCases.bureauStatus,
      disputedAt: equipmentRecoveryCases.disputedAt,
      disputeReason: equipmentRecoveryCases.disputeReason,
      closedAt: equipmentRecoveryCases.closedAt,
      notes: equipmentRecoveryCases.notes,
      createdById: equipmentRecoveryCases.createdById,
      createdAt: equipmentRecoveryCases.createdAt,
      updatedAt: equipmentRecoveryCases.updatedAt,
      customerName: customers.name,
      customerCpfCnpj: customers.cpfCnpj,
      customerPhone: customers.phone,
      equipmentType: equipment.type,
      equipmentBrand: equipment.brand,
      equipmentModel: equipment.model,
      equipmentSerialNumber: equipment.serialNumber,
      equipmentAssetTag: equipment.assetTag,
      equipmentValue: equipment.value,
    }).from(equipmentRecoveryCases)
      .innerJoin(customers, and(
        eq(customers.id, equipmentRecoveryCases.customerId),
        eq(customers.providerId, equipmentRecoveryCases.providerId),
      ))
      .innerJoin(equipment, and(
        eq(equipment.id, equipmentRecoveryCases.equipmentId),
        eq(equipment.providerId, equipmentRecoveryCases.providerId),
      ))
      .where(eq(equipmentRecoveryCases.providerId, providerId))
      .orderBy(desc(equipmentRecoveryCases.createdAt));
  }

  async getRecoveryCaseById(id: number, providerId: number): Promise<EquipmentRecoveryCase | undefined> {
    const [found] = await db.select().from(equipmentRecoveryCases).where(and(
      eq(equipmentRecoveryCases.id, id),
      eq(equipmentRecoveryCases.providerId, providerId),
    )).limit(1);
    return found;
  }

  async getRecoveryEvents(caseId: number, providerId: number): Promise<EquipmentRecoveryEvent[]> {
    return db.select().from(equipmentRecoveryEvents).where(and(
      eq(equipmentRecoveryEvents.caseId, caseId),
      eq(equipmentRecoveryEvents.providerId, providerId),
    )).orderBy(desc(equipmentRecoveryEvents.occurredAt));
  }

  async createRecoveryCase(data: InsertEquipmentRecoveryCase): Promise<EquipmentRecoveryCase> {
    return db.transaction(async tx => {
      const [ownedEquipment] = await tx.select().from(equipment).where(and(
        eq(equipment.id, data.equipmentId),
        eq(equipment.providerId, data.providerId),
        eq(equipment.customerId, data.customerId),
      )).limit(1);
      if (!ownedEquipment) throw new Error("EQUIPMENT_OWNERSHIP_INVALID");

      const [openCase] = await tx.select({ id: equipmentRecoveryCases.id })
        .from(equipmentRecoveryCases)
        .where(and(
          eq(equipmentRecoveryCases.providerId, data.providerId),
          eq(equipmentRecoveryCases.equipmentId, data.equipmentId),
          isNull(equipmentRecoveryCases.closedAt),
        )).limit(1);
      if (openCase) throw new Error("RECOVERY_CASE_ALREADY_OPEN");

      const [created] = await tx.insert(equipmentRecoveryCases).values(data).returning();
      await tx.update(equipment)
        .set({ status: "retirada_pendente", inRecoveryProcess: true, updatedAt: new Date() })
        .where(and(eq(equipment.id, data.equipmentId), eq(equipment.providerId, data.providerId)));
      await tx.insert(equipmentRecoveryEvents).values({
        providerId: data.providerId,
        caseId: created.id,
        userId: data.createdById,
        type: "caso_criado",
        toStatus: created.status,
        occurredAt: created.createdAt ?? new Date(),
      });
      return created;
    });
  }

  async updateRecoveryCase(
    id: number,
    providerId: number,
    userId: number,
    data: Partial<InsertEquipmentRecoveryCase>,
  ): Promise<EquipmentRecoveryCase | undefined> {
    return db.transaction(async tx => {
      const [current] = await tx.select().from(equipmentRecoveryCases).where(and(
        eq(equipmentRecoveryCases.id, id),
        eq(equipmentRecoveryCases.providerId, providerId),
      )).limit(1);
      if (!current) return undefined;

      const nextStatus = data.status ?? current.status;
      const closing = casoEstaEncerrado(nextStatus);
      const bureauStatus = nextStatus === "contestado"
        ? "contestado_bloqueado"
        : closing
          ? (nextStatus === "prazo_expirado" ? "expirado" : "resolvido")
          : current.bureauStatus;
      const [updated] = await tx.update(equipmentRecoveryCases).set({
        ...data,
        bureauStatus,
        disputedAt: nextStatus === "contestado" ? (data.disputedAt ?? new Date()) : current.disputedAt,
        closedAt: closing ? (data.closedAt ?? new Date()) : current.closedAt,
        updatedAt: new Date(),
      }).where(and(
        eq(equipmentRecoveryCases.id, id),
        eq(equipmentRecoveryCases.providerId, providerId),
      )).returning();

      const equipmentUpdate = nextStatus === "concluido"
        ? { status: "recuperado_triagem", inRecoveryProcess: false }
        : closing
          ? { status: "baixado", inRecoveryProcess: false }
          : { status: "retirada_pendente", inRecoveryProcess: true };
      await tx.update(equipment).set({ ...equipmentUpdate, updatedAt: new Date() }).where(and(
        eq(equipment.id, current.equipmentId),
        eq(equipment.providerId, providerId),
      ));
      await tx.insert(equipmentRecoveryEvents).values({
        providerId,
        caseId: id,
        userId,
        type: current.status === nextStatus ? "caso_atualizado" : "status_alterado",
        fromStatus: current.status,
        toStatus: nextStatus,
        notes: data.notes,
      });
      return updated;
    });
  }

  async addRecoveryAttempt(input: {
    providerId: number;
    caseId: number;
    userId: number;
    channel: string;
    result: RecoveryAttemptResult;
    occurredAt: Date;
    notes?: string;
  }): Promise<EquipmentRecoveryEvent | undefined> {
    const recoveryCase = await this.getRecoveryCaseById(input.caseId, input.providerId);
    if (!recoveryCase || recoveryCase.closedAt) return undefined;
    const [created] = await db.insert(equipmentRecoveryEvents).values({
      providerId: input.providerId,
      caseId: input.caseId,
      userId: input.userId,
      type: "tentativa",
      channel: input.channel,
      result: input.result,
      notes: input.notes,
      occurredAt: input.occurredAt,
    }).returning();
    return created;
  }

  async validateRecoverySignal(input: {
    id: number;
    providerId: number;
    userId: number;
    proofReference: string;
    customerNotifiedAt: Date;
    notificationProtocol?: string;
  }): Promise<{ case?: EquipmentRecoveryCase; message?: string }> {
    return db.transaction(async tx => {
      const [current] = await tx.select().from(equipmentRecoveryCases).where(and(
        eq(equipmentRecoveryCases.id, input.id),
        eq(equipmentRecoveryCases.providerId, input.providerId),
      )).limit(1);
      if (!current) return { message: "Caso de recuperação não encontrado" };
      if (current.closedAt) return { message: "Casos encerrados não podem ser publicados" };

      const attempts = await tx.select({ result: equipmentRecoveryEvents.result })
        .from(equipmentRecoveryEvents).where(and(
          eq(equipmentRecoveryEvents.providerId, input.providerId),
          eq(equipmentRecoveryEvents.caseId, input.id),
          eq(equipmentRecoveryEvents.type, "tentativa"),
        ));
      const validation = validarSinalBureau({
        deadlineAt: current.deadlineAt,
        proofReference: input.proofReference,
        customerNotifiedAt: input.customerNotifiedAt,
        disputedAt: current.disputedAt,
        attemptResults: attempts.map(attempt => attempt.result),
      });
      if (!validation.ok) return { message: validation.message };

      const now = new Date();
      const [updated] = await tx.update(equipmentRecoveryCases).set({
        proofReference: input.proofReference,
        customerNotifiedAt: input.customerNotifiedAt,
        notificationProtocol: input.notificationProtocol,
        evidenceValidatedAt: now,
        evidenceValidatedById: input.userId,
        bureauStatus: "ativo_validado",
        updatedAt: now,
      }).where(and(
        eq(equipmentRecoveryCases.id, input.id),
        eq(equipmentRecoveryCases.providerId, input.providerId),
      )).returning();
      await tx.insert(equipmentRecoveryEvents).values({
        providerId: input.providerId,
        caseId: input.id,
        userId: input.userId,
        type: "sinal_validado",
        metadata: { notificationProtocol: input.notificationProtocol || null },
      });
      return { case: updated };
    });
  }

  async expireRecoveryCases(providerId: number): Promise<number> {
    const affectedCustomerIds = new Set<number>();
    const total = await db.transaction(async tx => {
      const expired = await tx.select().from(equipmentRecoveryCases).where(and(
        eq(equipmentRecoveryCases.providerId, providerId),
        isNull(equipmentRecoveryCases.closedAt),
        lt(equipmentRecoveryCases.deadlineAt, new Date()),
      ));
      if (expired.length === 0) return 0;
      const now = new Date();
      for (const recoveryCase of expired) {
        affectedCustomerIds.add(recoveryCase.customerId);
        await tx.update(equipmentRecoveryCases).set({
          status: "prazo_expirado",
          bureauStatus: "expirado",
          closedAt: now,
          updatedAt: now,
        }).where(eq(equipmentRecoveryCases.id, recoveryCase.id));
        await tx.update(equipment).set({
          status: "baixado",
          inRecoveryProcess: false,
          updatedAt: now,
        }).where(and(
          eq(equipment.id, recoveryCase.equipmentId),
          eq(equipment.providerId, providerId),
        ));
        await tx.insert(equipmentRecoveryEvents).values({
          providerId,
          caseId: recoveryCase.id,
          type: "prazo_expirado",
          fromStatus: recoveryCase.status,
          toStatus: "prazo_expirado",
          occurredAt: now,
        });
      }
      return expired.length;
    });
    // Fora da transacao: o agregado alimenta dashboard e antifraude, e um caso
    // expirado deixa de contar como pendencia.
    for (const customerId of Array.from(affectedCustomerIds)) {
      await this.recalculateCustomerEquipmentAggregate(providerId, customerId);
    }
    return total;
  }

  async getValidatedRecoverySignals(
    cpfCnpj: string,
    providerIds: number[],
  ): Promise<ValidatedRecoverySignal[]> {
    if (providerIds.length === 0) return [];
    const cleaned = cpfCnpj.replace(/\D/g, "");
    const rows = await db.select({
      providerId: equipmentRecoveryCases.providerId,
      providerName: providers.name,
      customerName: customers.name,
      equipmentType: equipment.type,
      equipmentValue: equipment.value,
      terminationDate: equipmentRecoveryCases.terminationDate,
      deadlineAt: equipmentRecoveryCases.deadlineAt,
    }).from(equipmentRecoveryCases)
      .innerJoin(customers, and(
        eq(customers.id, equipmentRecoveryCases.customerId),
        eq(customers.providerId, equipmentRecoveryCases.providerId),
      ))
      .innerJoin(equipment, and(
        eq(equipment.id, equipmentRecoveryCases.equipmentId),
        eq(equipment.providerId, equipmentRecoveryCases.providerId),
      ))
      .innerJoin(providers, eq(providers.id, equipmentRecoveryCases.providerId))
      .where(and(
        inArray(equipmentRecoveryCases.providerId, providerIds),
        eq(equipmentRecoveryCases.bureauStatus, "ativo_validado"),
        isNull(equipmentRecoveryCases.closedAt),
        isNull(equipmentRecoveryCases.disputedAt),
        gte(equipmentRecoveryCases.deadlineAt, new Date()),
        sql`regexp_replace(${customers.cpfCnpj}, '[^0-9]', '', 'g') = ${cleaned}`,
      ));

    const grouped = new Map<number, ValidatedRecoverySignal>();
    for (const row of rows) {
      const current = grouped.get(row.providerId);
      if (!current) {
        grouped.set(row.providerId, {
          providerId: row.providerId,
          providerName: row.providerName,
          customerName: row.customerName,
          count: 1,
          totalValue: Number(row.equipmentValue || 0),
          categories: [row.equipmentType],
          terminationDate: row.terminationDate,
          deadlineAt: row.deadlineAt,
        });
        continue;
      }
      current.count += 1;
      current.totalValue += Number(row.equipmentValue || 0);
      if (!current.categories.includes(row.equipmentType)) current.categories.push(row.equipmentType);
      if (row.terminationDate < current.terminationDate) current.terminationDate = row.terminationDate;
      if (row.deadlineAt < current.deadlineAt) current.deadlineAt = row.deadlineAt;
    }
    return Array.from(grouped.values());
  }

  /**
   * Casos do kanban numa ida só: caso + equipamento + cliente + nome do
   * responsável (left join — caso sem dono continua aparecendo).
   *
   * Encerrado só entra se fechou há até 90 dias; o corte aqui é por hora
   * crua e um dia folgado, para o índice trabalhar. Quem decide a janela
   * exata, em dia civil, é o serviço puro (montarBoard) — o banco só evita
   * carregar anos de histórico que a tela nunca mostra.
   */
  async getRecoveryBoardCases(providerId: number, agora = new Date()): Promise<EntradaCasoBoard[]> {
    const corte = new Date(agora.getTime() - 91 * 24 * 60 * 60 * 1000);
    const linhas = await db.select({
      id: equipmentRecoveryCases.id,
      status: equipmentRecoveryCases.status,
      prioridade: equipmentRecoveryCases.priority,
      rescisaoEm: equipmentRecoveryCases.terminationDate,
      prazoAt: equipmentRecoveryCases.deadlineAt,
      agendadoEm: equipmentRecoveryCases.scheduledAt,
      metodo: equipmentRecoveryCases.collectionMethod,
      responsavelId: equipmentRecoveryCases.assignedToUserId,
      responsavelNome: users.name,
      notificadoEm: equipmentRecoveryCases.customerNotifiedAt,
      bureauStatus: equipmentRecoveryCases.bureauStatus,
      contestadoEm: equipmentRecoveryCases.disputedAt,
      encerradoEm: equipmentRecoveryCases.closedAt,
      notas: equipmentRecoveryCases.notes,
      ...colunasEquipamentoBoard,
      ...colunasClienteBoard,
    }).from(equipmentRecoveryCases)
      .innerJoin(customers, and(
        eq(customers.id, equipmentRecoveryCases.customerId),
        eq(customers.providerId, equipmentRecoveryCases.providerId),
      ))
      .innerJoin(equipment, and(
        eq(equipment.id, equipmentRecoveryCases.equipmentId),
        eq(equipment.providerId, equipmentRecoveryCases.providerId),
      ))
      // O responsável tem que ser do mesmo provedor: um id apontado para
      // usuário de outro tenant não pode vazar nome pelo join.
      .leftJoin(users, and(
        eq(users.id, equipmentRecoveryCases.assignedToUserId),
        eq(users.providerId, equipmentRecoveryCases.providerId),
      ))
      .where(and(
        eq(equipmentRecoveryCases.providerId, providerId),
        or(
          isNull(equipmentRecoveryCases.closedAt),
          gte(equipmentRecoveryCases.closedAt, corte),
        ),
      ))
      .orderBy(desc(equipmentRecoveryCases.createdAt));

    return linhas.map(l => ({
      id: l.id,
      status: l.status,
      prioridade: l.prioridade,
      rescisaoEm: l.rescisaoEm,
      prazoAt: l.prazoAt,
      agendadoEm: l.agendadoEm,
      metodo: l.metodo,
      responsavelId: l.responsavelId,
      responsavelNome: l.responsavelNome,
      notificadoEm: l.notificadoEm,
      bureauStatus: l.bureauStatus,
      contestadoEm: l.contestadoEm,
      encerradoEm: l.encerradoEm,
      notas: l.notas,
      equipamento: montarEquipamentoBoard(l),
      cliente: montarClienteBoard(l),
    }));
  }

  /**
   * Equipamento retido (retirada pendente, não localizado ou marcado em
   * processo de recuperação) que NÃO tem caso aberto — a coluna "sem data".
   * Sem cliente não vira card (inner join): não há a quem cobrar.
   */
  async getRetainedEquipmentWithoutOpenCase(providerId: number): Promise<EntradaEquipamentoSemCasoBoard[]> {
    const casoAberto = db.select({ id: equipmentRecoveryCases.id })
      .from(equipmentRecoveryCases)
      .where(and(
        eq(equipmentRecoveryCases.equipmentId, equipment.id),
        eq(equipmentRecoveryCases.providerId, equipment.providerId),
        isNull(equipmentRecoveryCases.closedAt),
      ));

    const linhas = await db.select({
      ...colunasEquipamentoBoard,
      ...colunasClienteBoard,
    }).from(equipment)
      .innerJoin(customers, and(
        eq(customers.id, equipment.customerId),
        eq(customers.providerId, equipment.providerId),
      ))
      .where(and(
        eq(equipment.providerId, providerId),
        or(
          inArray(equipment.status, [...STATUS_EQUIPAMENTO_RETIDO]),
          eq(equipment.inRecoveryProcess, true),
        ),
        notExists(casoAberto),
      ))
      .orderBy(equipment.id);

    return linhas.map(l => ({
      equipamento: montarEquipamentoBoard(l),
      cliente: montarClienteBoard(l),
    }));
  }

  /**
   * Total de tentativas e a última, por caso, numa query: DISTINCT ON pega
   * a mais recente e a janela conta o total antes do DISTINCT recortar.
   * Fazer isso caso a caso seria N+1 no carregamento do board.
   */
  async getRecoveryAttemptSummaries(providerId: number, caseIds: number[]): Promise<EntradaTentativaBoard[]> {
    if (caseIds.length === 0) return [];
    const linhas = await db.selectDistinctOn([equipmentRecoveryEvents.caseId], {
      caseId: equipmentRecoveryEvents.caseId,
      total: sql<number>`count(*) over (partition by ${equipmentRecoveryEvents.caseId})::int`,
      canal: equipmentRecoveryEvents.channel,
      resultado: equipmentRecoveryEvents.result,
      em: equipmentRecoveryEvents.occurredAt,
    }).from(equipmentRecoveryEvents)
      .where(and(
        eq(equipmentRecoveryEvents.providerId, providerId),
        eq(equipmentRecoveryEvents.type, "tentativa"),
        inArray(equipmentRecoveryEvents.caseId, caseIds),
      ))
      .orderBy(
        equipmentRecoveryEvents.caseId,
        desc(equipmentRecoveryEvents.occurredAt),
        desc(equipmentRecoveryEvents.id),
      );

    return linhas.map(l => ({
      caseId: l.caseId,
      total: l.total,
      canal: l.canal,
      resultado: l.resultado,
      // occurredAt tem default now() no banco; nulo só em linha gravada à mão.
      em: l.em ?? new Date(0),
    }));
  }
}
