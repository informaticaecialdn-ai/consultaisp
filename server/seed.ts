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

  const provider3 = await storage.createProvider({
    name: "Speed Telecom",
    cnpj: "55667788000199",
    subdomain: "speed",
    plan: "basic",
    status: "active",
    ispCredits: 80,
    spcCredits: 20,
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

  await storage.createUser({
    email: "admin@speed.com",
    password: await hashPassword("123456"),
    name: "Ana Souza",
    role: "admin",
    providerId: provider3.id,
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
    latitude: "-23.5505",
    longitude: "-46.6340",
    status: "active",
    paymentStatus: "current",
    totalOverdueAmount: "0",
    maxDaysOverdue: 0,
    overdueInvoicesCount: 0,
    ispScore: 100,
    riskTier: "low",
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
    latitude: "-23.5631",
    longitude: "-46.6544",
    status: "inactive",
    paymentStatus: "90+",
    totalOverdueAmount: "449.70",
    maxDaysOverdue: 95,
    overdueInvoicesCount: 3,
    ispScore: 15,
    riskTier: "critical",
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
    latitude: "-22.9068",
    longitude: "-43.1729",
    status: "active",
    paymentStatus: "current",
    totalOverdueAmount: "0",
    maxDaysOverdue: 0,
    overdueInvoicesCount: 0,
    ispScore: 95,
    riskTier: "low",
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
    latitude: "-19.9167",
    longitude: "-43.9345",
    status: "inactive",
    paymentStatus: "90+",
    totalOverdueAmount: "299.70",
    maxDaysOverdue: 130,
    overdueInvoicesCount: 3,
    ispScore: 10,
    riskTier: "critical",
  });

  const cust2_p2 = await storage.createCustomer({
    providerId: provider2.id,
    name: "Joao Pereira Lima",
    cpfCnpj: "98765432100",
    email: "joao2@email.com",
    phone: "(11) 98765-0000",
    address: "Av. Paulista, 100",
    city: "Sao Paulo",
    state: "SP",
    cep: "04567891",
    latitude: "-23.5614",
    longitude: "-46.6560",
    status: "inactive",
    paymentStatus: "61-90",
    totalOverdueAmount: "200.00",
    maxDaysOverdue: 65,
    overdueInvoicesCount: 2,
    ispScore: 25,
    riskTier: "high",
  });

  const cust4_p3 = await storage.createCustomer({
    providerId: provider3.id,
    name: "Roberto Almeida Ferreira",
    cpfCnpj: "78912345600",
    email: "roberto2@email.com",
    phone: "(31) 96543-0000",
    address: "Av. Afonso Pena, 500",
    city: "Belo Horizonte",
    state: "MG",
    cep: "30100001",
    latitude: "-19.9191",
    longitude: "-43.9386",
    status: "inactive",
    paymentStatus: "31-60",
    totalOverdueAmount: "150.00",
    maxDaysOverdue: 45,
    overdueInvoicesCount: 1,
    ispScore: 40,
    riskTier: "high",
  });

  const cust5_p2 = await storage.createCustomer({
    providerId: provider2.id,
    name: "Ana Carolina Oliveira",
    cpfCnpj: "45678912300",
    email: "ana2@email.com",
    phone: "(21) 97654-0000",
    address: "Rua da Praia, 50",
    city: "Rio de Janeiro",
    state: "RJ",
    cep: "20000002",
    latitude: "-22.9110",
    longitude: "-43.1651",
    status: "active",
    paymentStatus: "current",
    totalOverdueAmount: "0",
    maxDaysOverdue: 0,
    overdueInvoicesCount: 0,
    ispScore: 90,
    riskTier: "low",
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
    status: "cancelled",
    startDate: new Date("2024-03-10"),
    endDate: new Date("2025-11-10"),
  });

  const ct3 = await storage.createContract({
    customerId: cust3.id,
    providerId: provider1.id,
    plan: "Fibra 300MB",
    value: "199.90",
    status: "active",
    startDate: new Date("2023-06-01"),
  });

  const ct4 = await storage.createContract({
    customerId: cust4.id,
    providerId: provider1.id,
    plan: "Fibra 100MB",
    value: "99.90",
    status: "suspended",
    startDate: new Date("2023-11-20"),
  });

  const ct2_p2 = await storage.createContract({
    customerId: cust2_p2.id,
    providerId: provider2.id,
    plan: "Fibra 50MB",
    value: "79.90",
    status: "cancelled",
    startDate: new Date("2025-06-01"),
    endDate: new Date("2025-12-15"),
  });

  const ct4_p3 = await storage.createContract({
    customerId: cust4_p3.id,
    providerId: provider3.id,
    plan: "Fibra 100MB",
    value: "89.90",
    status: "suspended",
    startDate: new Date("2025-09-01"),
  });

  const ct5_p2 = await storage.createContract({
    customerId: cust5_p2.id,
    providerId: provider2.id,
    plan: "Fibra 200MB",
    value: "129.90",
    status: "active",
    startDate: new Date("2023-01-01"),
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
    value: "149.90", dueDate: new Date("2025-11-25"), status: "overdue",
  });
  await storage.createInvoice({
    contractId: ct2.id, customerId: cust2.id, providerId: provider1.id,
    value: "149.90", dueDate: new Date("2025-12-25"), status: "overdue",
  });
  await storage.createInvoice({
    contractId: ct2.id, customerId: cust2.id, providerId: provider1.id,
    value: "149.90", dueDate: new Date("2026-01-25"), status: "overdue",
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

  await storage.createInvoice({
    contractId: ct2_p2.id, customerId: cust2_p2.id, providerId: provider2.id,
    value: "79.90", dueDate: new Date("2025-11-01"), status: "overdue",
  });
  await storage.createInvoice({
    contractId: ct2_p2.id, customerId: cust2_p2.id, providerId: provider2.id,
    value: "79.90", dueDate: new Date("2025-12-01"), status: "overdue",
  });

  await storage.createInvoice({
    contractId: ct4_p3.id, customerId: cust4_p3.id, providerId: provider3.id,
    value: "89.90", dueDate: new Date("2026-01-15"), status: "overdue",
  });

  await storage.createInvoice({
    contractId: ct5_p2.id, customerId: cust5_p2.id, providerId: provider2.id,
    value: "129.90", dueDate: new Date("2026-02-10"), status: "paid", paidDate: new Date("2026-02-10"),
  });

  await storage.createEquipment({
    customerId: cust1.id, providerId: provider1.id,
    type: "ONU", brand: "Huawei", model: "HG8245H", serialNumber: "HW001234",
    status: "installed", value: "280.00",
  });
  await storage.createEquipment({
    customerId: cust2.id, providerId: provider1.id,
    type: "Roteador", brand: "TP-Link", model: "Archer C6", serialNumber: "TP005678",
    status: "not_returned", value: "250.00", inRecoveryProcess: false,
  });
  await storage.createEquipment({
    customerId: cust2.id, providerId: provider1.id,
    type: "ONU", brand: "ZTE", model: "F670L", serialNumber: "ZTE111222",
    status: "not_returned", value: "280.00", inRecoveryProcess: true,
  });
  await storage.createEquipment({
    customerId: cust3.id, providerId: provider1.id,
    type: "ONU", brand: "ZTE", model: "F660", serialNumber: "ZTE009012",
    status: "installed", value: "250.00",
  });
  await storage.createEquipment({
    customerId: cust4.id, providerId: provider1.id,
    type: "ONU", brand: "Huawei", model: "HG8245H5", serialNumber: "HW005555",
    status: "not_returned", value: "280.00", inRecoveryProcess: false,
  });

  await storage.createEquipment({
    customerId: cust2_p2.id, providerId: provider2.id,
    type: "ONU", brand: "Huawei", model: "HG8245H", serialNumber: "HW009999",
    status: "not_returned", value: "280.00", inRecoveryProcess: false,
  });

  await storage.createEquipment({
    customerId: cust4_p3.id, providerId: provider3.id,
    type: "ONU", brand: "Fiberhome", model: "AN5506-04-F", serialNumber: "FH003333",
    status: "not_returned", value: "320.00", inRecoveryProcess: true,
  });

  await storage.createEquipment({
    customerId: cust5_p2.id, providerId: provider2.id,
    type: "ONU", brand: "ZTE", model: "F660", serialNumber: "ZTE777888",
    status: "installed", value: "250.00",
  });

  console.log("Seed data inserted successfully");
}

export async function seedSuperAdmin() {
  const existing = await storage.getUserByEmail("master@consultaisp.com.br");
  if (existing) return;
  await storage.createUser({
    name: "Administrador do Sistema",
    email: "master@consultaisp.com.br",
    password: await hashPassword("Master@2024"),
    role: "superadmin",
    emailVerified: true,
  });
  console.log("SuperAdmin criado: master@consultaisp.com.br / Master@2024");
}
