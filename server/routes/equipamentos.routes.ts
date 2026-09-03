import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth, requireProvider } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";
import {
  EQUIPMENT_STATUSES,
  RECOVERY_ATTEMPT_RESULTS,
  RECOVERY_CASE_STATUSES,
  calcularPrazoRetirada,
  podeTransicionarCaso,
} from "../services/equipment-recovery-rules";
import { consultationCache } from "../services/consultation-cache.service";
import { montarBoard } from "../services/recovery-board.service";

const equipamentoSchema = z.object({
  customerId: z.number({ required_error: "Selecione o cliente responsável" }).int().positive(),
  assetTag: z.string().trim().max(80).optional(),
  type: z.string({ required_error: "Informe o tipo do equipamento" }).trim().min(1, "Informe o tipo do equipamento"),
  brand: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  serialNumber: z.string().trim().max(120).optional(),
  mac: z.string().trim().max(40).optional(),
  status: z.enum(EQUIPMENT_STATUSES).default("em_comodato"),
  inRecoveryProcess: z.boolean().default(false),
  value: z.string().regex(/^\d+(?:[.,]\d{1,2})?$/, "Informe um valor válido").optional(),
});

const casoSchema = z.object({
  equipmentId: z.number().int().positive(),
  terminationDate: z.coerce.date(),
  priority: z.enum(["critica", "alta", "normal", "baixa"]).default("normal"),
  scheduledAt: z.coerce.date().optional(),
  collectionMethod: z.enum(["retirada", "entrega_loja", "logistica_reversa"]).optional(),
  assignedToUserId: z.number().int().positive().optional(),
  proofReference: z.string().trim().max(180).optional(),
  customerNotifiedAt: z.coerce.date().optional(),
  notificationProtocol: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const atualizarCasoSchema = z.object({
  status: z.enum(RECOVERY_CASE_STATUSES).optional(),
  priority: z.enum(["critica", "alta", "normal", "baixa"]).optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  collectionMethod: z.enum(["retirada", "entrega_loja", "logistica_reversa"]).nullable().optional(),
  assignedToUserId: z.number().int().positive().nullable().optional(),
  proofReference: z.string().trim().max(180).optional(),
  customerNotifiedAt: z.coerce.date().optional(),
  notificationProtocol: z.string().trim().max(120).optional(),
  disputeReason: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const tentativaSchema = z.object({
  channel: z.enum(["whatsapp", "telefone", "email", "visita", "loja", "logistica_reversa"]),
  result: z.enum(RECOVERY_ATTEMPT_RESULTS),
  occurredAt: z.coerce.date().default(() => new Date()),
  notes: z.string().trim().max(1000).optional(),
});

const validarSinalSchema = z.object({
  proofReference: z.string().trim().min(3, "Informe a referência da prova de comodato").max(180),
  customerNotifiedAt: z.coerce.date(),
  notificationProtocol: z.string().trim().max(120).optional(),
});

function cleanOptionalFields<T extends Record<string, unknown>>(data: T): T {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    typeof value === "string" && value.trim() === "" ? undefined : value,
  ])) as T;
}

export function registerEquipamentosRoutes(): Router {
  const router = Router();

  router.get("/api/equipment", requireAuth, requireProvider, async (req, res) => {
    try {
      return res.json(await storage.getEquipmentByProvider(req.session.providerId!));
    } catch (error: unknown) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/equipment", requireAuth, requireProvider, async (req, res) => {
    try {
      const parsed = equipamentoSchema.safeParse(cleanOptionalFields(req.body));
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
      const providerId = req.session.providerId!;
      const customer = (await storage.getCustomersByProvider(providerId)).find(item => item.id === parsed.data.customerId);
      if (!customer) return res.status(400).json({ message: "Cliente não pertence ao seu provedor" });

      const serial = parsed.data.serialNumber?.toLowerCase();
      if (serial) {
        const duplicate = (await storage.getEquipmentByProvider(providerId))
          .some(item => item.serialNumber?.trim().toLowerCase() === serial);
        if (duplicate) return res.status(409).json({ message: "Já existe um equipamento com este número de série" });
      }

      const criado = await storage.createEquipment({
        ...parsed.data,
        value: parsed.data.value?.replace(",", "."),
        providerId,
        source: "manual",
      });
      await storage.recalculateCustomerEquipmentAggregate(providerId, parsed.data.customerId);
      return res.status(201).json(criado);
    } catch (error: unknown) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/equipment/:id", requireAuth, requireProvider, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Id inválido" });
      const parsed = equipamentoSchema.partial().safeParse(cleanOptionalFields(req.body));
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });

      const providerId = req.session.providerId!;
      const current = await storage.getEquipmentById(id, providerId);
      if (!current) return res.status(404).json({ message: "Equipamento não encontrado" });
      if (parsed.data.customerId) {
        const customer = (await storage.getCustomersByProvider(providerId)).find(item => item.id === parsed.data.customerId);
        if (!customer) return res.status(400).json({ message: "Cliente não pertence ao seu provedor" });
      }

      const atualizado = await storage.updateEquipment(id, providerId, {
        ...parsed.data,
        value: parsed.data.value?.replace(",", "."),
        updatedAt: new Date(),
      });
      if (current.customerId) await storage.recalculateCustomerEquipmentAggregate(providerId, current.customerId);
      if (atualizado?.customerId && atualizado.customerId !== current.customerId) {
        await storage.recalculateCustomerEquipmentAggregate(providerId, atualizado.customerId);
      }
      return res.json(atualizado);
    } catch (error: unknown) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/equipment/:id", requireAuth, requireProvider, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Id inválido" });
      const providerId = req.session.providerId!;
      const current = await storage.getEquipmentById(id, providerId);
      if (!current) return res.status(404).json({ message: "Equipamento não encontrado" });
      const hasHistory = (await storage.getRecoveryCases(providerId)).some(item => item.equipmentId === id);
      if (hasHistory) {
        return res.status(409).json({ message: "Equipamentos com histórico de recuperação não podem ser excluídos; use Baixado" });
      }
      await storage.removeEquipment(id, providerId);
      if (current.customerId) await storage.recalculateCustomerEquipmentAggregate(providerId, current.customerId);
      return res.status(204).end();
    } catch (error: unknown) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/equipment/recovery-cases", requireAuth, requireProvider, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      await storage.expireRecoveryCases(providerId);
      return res.json(await storage.getRecoveryCases(providerId));
    } catch (error: unknown) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * Kanban de recuperação (spec 2026-09-02). Três leituras agregadas + o
   * serviço puro que classifica por idade da rescisão. Expira os casos
   * vencidos antes, como a lista faz, para as duas telas contarem o mesmo.
   */
  router.get("/api/equipment/recovery-board", requireAuth, requireProvider, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const agora = new Date();
      await storage.expireRecoveryCases(providerId);
      const [casos, equipamentosSemCaso, usuarios] = await Promise.all([
        storage.getRecoveryBoardCases(providerId, agora),
        storage.getRetainedEquipmentWithoutOpenCase(providerId),
        storage.getUsersByProvider(providerId),
      ]);
      const tentativas = await storage.getRecoveryAttemptSummaries(providerId, casos.map(c => c.id));
      return res.json(montarBoard({
        casos,
        equipamentosSemCaso,
        tentativas,
        // Só id e nome: o registro de usuário carrega hash de senha e token,
        // que não têm por que sair num payload de tela.
        usuarios: usuarios.map(u => ({ id: u.id, nome: u.name })),
      }, agora));
    } catch (error: unknown) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/equipment/recovery-cases/:id/events", requireAuth, requireProvider, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Id inválido" });
      const recoveryCase = await storage.getRecoveryCaseById(id, req.session.providerId!);
      if (!recoveryCase) return res.status(404).json({ message: "Caso de recuperação não encontrado" });
      return res.json(await storage.getRecoveryEvents(id, req.session.providerId!));
    } catch (error: unknown) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/equipment/recovery-cases", requireAuth, requireProvider, async (req, res) => {
    try {
      const parsed = casoSchema.safeParse(cleanOptionalFields(req.body));
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
      if (parsed.data.terminationDate > new Date()) {
        return res.status(400).json({ message: "A data de rescisão não pode estar no futuro" });
      }
      const deadlineAt = calcularPrazoRetirada(parsed.data.terminationDate);
      if (deadlineAt <= new Date()) {
        return res.status(400).json({ message: "O prazo regulatório de 60 dias já expirou para esta rescisão" });
      }

      const providerId = req.session.providerId!;
      const ownedEquipment = await storage.getEquipmentById(parsed.data.equipmentId, providerId);
      if (!ownedEquipment?.customerId) {
        return res.status(400).json({ message: "O equipamento precisa estar vinculado a um cliente do seu provedor" });
      }
      const created = await storage.createRecoveryCase({
        providerId,
        equipmentId: ownedEquipment.id,
        customerId: ownedEquipment.customerId,
        status: "pre_recuperacao",
        priority: parsed.data.priority,
        terminationDate: parsed.data.terminationDate,
        deadlineAt,
        scheduledAt: parsed.data.scheduledAt,
        collectionMethod: parsed.data.collectionMethod,
        assignedToUserId: parsed.data.assignedToUserId,
        proofReference: parsed.data.proofReference,
        customerNotifiedAt: parsed.data.customerNotifiedAt,
        notificationProtocol: parsed.data.notificationProtocol,
        notes: parsed.data.notes,
        createdById: req.session.userId!,
      });
      await storage.recalculateCustomerEquipmentAggregate(providerId, ownedEquipment.customerId);
      return res.status(201).json(created);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "RECOVERY_CASE_ALREADY_OPEN") {
        return res.status(409).json({ message: "Este equipamento já possui um caso de recuperação aberto" });
      }
      if (error instanceof Error && error.message === "EQUIPMENT_OWNERSHIP_INVALID") {
        return res.status(400).json({ message: "Equipamento e cliente não pertencem ao mesmo provedor" });
      }
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/equipment/recovery-cases/:id", requireAuth, requireProvider, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Id inválido" });
      const parsed = atualizarCasoSchema.safeParse(cleanOptionalFields(req.body));
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
      const providerId = req.session.providerId!;
      const current = await storage.getRecoveryCaseById(id, providerId);
      if (!current) return res.status(404).json({ message: "Caso de recuperação não encontrado" });
      if (parsed.data.status && !podeTransicionarCaso(current.status, parsed.data.status)) {
        return res.status(409).json({ message: "Um caso encerrado não pode voltar para a fila de recuperação" });
      }
      if (parsed.data.status === "contestado" && !parsed.data.disputeReason?.trim()) {
        return res.status(400).json({ message: "Informe o motivo da contestação" });
      }
      const updated = await storage.updateRecoveryCase(id, providerId, req.session.userId!, {
        ...parsed.data,
        disputedAt: parsed.data.status === "contestado" ? new Date() : undefined,
      });
      await storage.recalculateCustomerEquipmentAggregate(providerId, current.customerId);
      consultationCache.invalidateAll();
      return res.json(updated);
    } catch (error: unknown) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/equipment/recovery-cases/:id/attempts", requireAuth, requireProvider, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Id inválido" });
      const parsed = tentativaSchema.safeParse(cleanOptionalFields(req.body));
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
      if (parsed.data.occurredAt > new Date()) {
        return res.status(400).json({ message: "A tentativa não pode estar no futuro" });
      }
      const created = await storage.addRecoveryAttempt({
        providerId: req.session.providerId!,
        caseId: id,
        userId: req.session.userId!,
        ...parsed.data,
      });
      if (!created) return res.status(404).json({ message: "Caso aberto não encontrado" });
      return res.status(201).json(created);
    } catch (error: unknown) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/equipment/recovery-cases/:id/validate-signal", requireProvider, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Id inválido" });
      const parsed = validarSinalSchema.safeParse(cleanOptionalFields(req.body));
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
      const result = await storage.validateRecoverySignal({
        id,
        providerId: req.session.providerId!,
        userId: req.session.userId!,
        ...parsed.data,
      });
      if (!result.case) return res.status(409).json({ message: result.message });
      consultationCache.invalidateAll();
      return res.json(result.case);
    } catch (error: unknown) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
