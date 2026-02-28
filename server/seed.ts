import { storage } from "./storage";
import { db } from "./db";
import { users, providers, customers, contracts, invoices, equipment } from "@shared/schema";
import { count } from "drizzle-orm";
import { hashPassword } from "./password";

export async function seedDatabase() {
  const [existingProviders] = await db.select({ count: count() }).from(providers);
  if (existingProviders.count > 0) return;

  const provider1 = await storage.createProvider({
    name: "NsLink Provedor",
    cnpj: "22735562000156",
    subdomain: "nslink",
    plan: "enterprise",
    status: "active",
    ispCredits: 104,
    spcCredits: 77,
  });

  const provider2 = await storage.createProvider({
    name: "Vertical Fibra",
    cnpj: "33445566000188",
    subdomain: "vertical",
    plan: "basic",
    status: "active",
    ispCredits: 50,
    spcCredits: 30,
  });

  await storage.createUser({
    email: "admin@ispanalizze.com",
    password: await hashPassword("123456"),
    name: "Emerson Queiroz",
    role: "admin",
    providerId: provider1.id,
  });

  await storage.createUser({
    email: "carlos@vertical.com",
    password: await hashPassword("123456"),
    name: "Carlos Silva",
    role: "admin",
    providerId: provider2.id,
  });

  const cust1 = await storage.createCustomer({
    providerId: provider1.id,
    name: "Maria da Silva Santos",
    cpfCnpj: "12345678901",
    email: "maria@email.com",
    phone: "(11) 99999-1234",
    address: "Rua das Flores, 123",
    city: "Sao Paulo",
    state: "SP",
    cep: "01234567",
    status: "active",
  });

  const cust2 = await storage.createCustomer({
    providerId: provider1.id,
    name: "Joao Pereira Lima",
    cpfCnpj: "98765432100",
    email: "joao@email.com",
    phone: "(11) 98765-4321",
    address: "Av. Brasil, 456",
    city: "Sao Paulo",
    state: "SP",
    cep: "04567890",
    status: "inactive",
  });

  const cust3 = await storage.createCustomer({
    providerId: provider1.id,
    name: "Ana Carolina Oliveira",
    cpfCnpj: "45678912300",
    email: "ana@email.com",
    phone: "(21) 97654-3210",
    address: "Rua do Comercio, 789",
    city: "Rio de Janeiro",
    state: "RJ",
    cep: "20000001",
    status: "active",
  });

  const cust4 = await storage.createCustomer({
    providerId: provider1.id,
    name: "Roberto Almeida Ferreira",
    cpfCnpj: "78912345600",
    email: "roberto@email.com",
    phone: "(31) 96543-2109",
    address: "Rua Minas Gerais, 321",
    city: "Belo Horizonte",
    state: "MG",
    cep: "30100000",
    status: "inactive",
  });

  const ct1 = await storage.createContract({
    customerId: cust1.id,
    providerId: provider1.id,
    plan: "Fibra 100MB",
    value: "99.90",
    status: "active",
    startDate: new Date("2024-01-15"),
  });

  const ct2 = await storage.createContract({
    customerId: cust2.id,
    providerId: provider1.id,
    plan: "Fibra 200MB",
    value: "149.90",
    status: "active",
    startDate: new Date("2024-03-10"),
  });

  const ct3 = await storage.createContract({
    customerId: cust3.id,
    providerId: provider1.id,
    plan: "Fibra 300MB",
    value: "199.90",
    status: "active",
    startDate: new Date("2024-06-01"),
  });

  const ct4 = await storage.createContract({
    customerId: cust4.id,
    providerId: provider1.id,
    plan: "Fibra 100MB",
    value: "99.90",
    status: "suspended",
    startDate: new Date("2023-11-20"),
  });

  await storage.createInvoice({
    contractId: ct1.id, customerId: cust1.id, providerId: provider1.id,
    value: "99.90", dueDate: new Date("2026-02-10"), status: "paid", paidDate: new Date("2026-02-08"),
  });
  await storage.createInvoice({
    contractId: ct1.id, customerId: cust1.id, providerId: provider1.id,
    value: "99.90", dueDate: new Date("2026-03-10"), status: "pending",
  });

  await storage.createInvoice({
    contractId: ct2.id, customerId: cust2.id, providerId: provider1.id,
    value: "149.90", dueDate: new Date("2025-12-10"), status: "overdue",
  });
  await storage.createInvoice({
    contractId: ct2.id, customerId: cust2.id, providerId: provider1.id,
    value: "149.90", dueDate: new Date("2026-01-10"), status: "overdue",
  });
  await storage.createInvoice({
    contractId: ct2.id, customerId: cust2.id, providerId: provider1.id,
    value: "149.90", dueDate: new Date("2026-02-10"), status: "overdue",
  });

  await storage.createInvoice({
    contractId: ct3.id, customerId: cust3.id, providerId: provider1.id,
    value: "199.90", dueDate: new Date("2026-02-10"), status: "paid", paidDate: new Date("2026-02-09"),
  });

  await storage.createInvoice({
    contractId: ct4.id, customerId: cust4.id, providerId: provider1.id,
    value: "99.90", dueDate: new Date("2025-10-20"), status: "overdue",
  });
  await storage.createInvoice({
    contractId: ct4.id, customerId: cust4.id, providerId: provider1.id,
    value: "99.90", dueDate: new Date("2025-11-20"), status: "overdue",
  });
  await storage.createInvoice({
    contractId: ct4.id, customerId: cust4.id, providerId: provider1.id,
    value: "99.90", dueDate: new Date("2025-12-20"), status: "overdue",
  });

  await storage.createEquipment({
    customerId: cust1.id, providerId: provider1.id,
    type: "ONU", brand: "Huawei", model: "HG8245H", serialNumber: "HW001234",
    status: "in_use", value: "280.00",
  });
  await storage.createEquipment({
    customerId: cust2.id, providerId: provider1.id,
    type: "Roteador", brand: "TP-Link", model: "Archer C6", serialNumber: "TP005678",
    status: "in_use", value: "250.00",
  });
  await storage.createEquipment({
    customerId: cust3.id, providerId: provider1.id,
    type: "ONU", brand: "ZTE", model: "F660", serialNumber: "ZTE009012",
    status: "in_use", value: "250.00",
  });

  console.log("Seed data inserted successfully");
}
