import type {
  Provider, InsertProvider,
  User, InsertUser,
  Customer, InsertCustomer,
  Contract, InsertContract,
  Invoice, InsertInvoice,
  Equipment, InsertEquipment,
  IspConsultation, InsertIspConsultation,
  SpcConsultation, InsertSpcConsultation,
  AntiFraudAlert, InsertAntiFraudAlert,
  SupportThread, InsertSupportMessage, SupportMessage,
  PlanChange, InsertPlanChange,
  ProviderInvoice, InsertProviderInvoice,
  CreditOrder, InsertCreditOrder,
  ProviderPartner, InsertProviderPartner,
  ProviderDocument, InsertProviderDocument,
  ErpIntegration, ErpSyncLog,
  ErpCatalog, InsertErpCatalog,
  VisitorChat, VisitorChatMessage,
  ProactiveAlert, InsertProactiveAlert,
} from "@shared/schema";
import type { AlertWithOwnership } from "./antifraude.storage";

import { UsersStorage } from "./users.storage";
import { ProvidersStorage, type ProviderWithStats } from "./providers.storage";
import { CustomersStorage } from "./customers.storage";
import { ConsultationsStorage } from "./consultations.storage";
import { AntifraudeStorage } from "./antifraude.storage";
import { FinancialStorage } from "./financial.storage";
import { EquipmentStorage } from "./equipment.storage";
import { ErpStorage } from "./erp.storage";
import { ChatStorage } from "./chat.storage";
import { DashboardStorage } from "./dashboard.storage";
import { AdminStorage } from "./admin.storage";
import { ImportStorage } from "./import.storage";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByPhone(phone: string): Promise<User | undefined>;
  getUserByVerificationToken(token: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  setEmailVerified(userId: number): Promise<void>;
  setVerificationToken(userId: number, token: string, expiresAt: Date): Promise<void>;
  getUsersByProvider(providerId: number): Promise<User[]>;
  deleteUser(id: number): Promise<void>;
  updateUserEmail(id: number, email: string): Promise<void>;

  getProvider(id: number): Promise<Provider | undefined>;
  getProviderByCnpj(cnpj: string): Promise<Provider | undefined>;
  getProviderBySubdomain(subdomain: string): Promise<Provider | undefined>;
  createProvider(provider: InsertProvider): Promise<Provider>;
  updateProvider(id: number, data: Partial<Pick<Provider, "name" | "contactEmail" | "contactPhone" | "website">>): Promise<Provider>;
  getAllProviders(): Promise<Provider[]>;
  updateProviderCredits(id: number, ispCredits: number, spcCredits: number): Promise<void>;
  debitIspCredits(id: number, cost: number): Promise<Provider | null>;
  debitSpcCredits(id: number, cost: number): Promise<Provider | null>;
  deleteProvider(id: number): Promise<void>;
  getAllProvidersWithStats(): Promise<ProviderWithStats[]>;

  getCustomersByProvider(providerId: number): Promise<Customer[]>;
  getCustomerByCpfCnpj(cpfCnpj: string): Promise<Customer[]>;
  getCustomersByExactAddress(address: string, city: string, state: string | null, cep: string | null, excludeCpfCnpj: string): Promise<Customer[]>;
  getCustomersByAddressHash(addressHash: string, excludeCpfCnpj?: string): Promise<Customer[]>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  upsertFromErp(data: Parameters<CustomersStorage["upsertFromErp"]>[0]): Promise<void>;
  getHeatmapByProvider(providerId: number): ReturnType<CustomersStorage["getHeatmapByProvider"]>;
  getHeatmapAll(): ReturnType<CustomersStorage["getHeatmapAll"]>;
  getCustomersByCepPrefix(cepPrefix: string, excludeProviderId?: number): Promise<Customer[]>;
  getCustomersByAddressForAlert(cep5: string, excludeCpfCnpj: string): ReturnType<CustomersStorage["getCustomersByAddressForAlert"]>;

  getContractsByCustomer(customerId: number): Promise<Contract[]>;
  getContractsByProvider(providerId: number): Promise<Contract[]>;
  createContract(contract: InsertContract): Promise<Contract>;

  getInvoicesByProvider(providerId: number): Promise<Invoice[]>;
  getInvoicesByCustomer(customerId: number): Promise<Invoice[]>;
  getOverdueInvoicesByProvider(providerId: number): Promise<Invoice[]>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;

  getEquipmentByProvider(providerId: number): Promise<Equipment[]>;
  getEquipmentByCustomer(customerId: number): Promise<Equipment[]>;
  createEquipment(equipment: InsertEquipment): Promise<Equipment>;

  getIspConsultationsByProvider(providerId: number): Promise<IspConsultation[]>;
  getIspConsultationsByProviderPaginated(providerId: number, page: number, limit: number): Promise<{ rows: IspConsultation[]; total: number }>;
  createIspConsultation(consultation: InsertIspConsultation): Promise<IspConsultation>;
  getIspConsultationCountToday(providerId: number): Promise<number>;
  getIspConsultationCountMonth(providerId: number): Promise<number>;
  getRecentConsultationsForDocument(cpfCnpj: string, days: number): Promise<IspConsultation[]>;
  getConsultationsByCepPrefix(cepPrefix: string, limitDays?: number): Promise<IspConsultation[]>;
  getConsultationTimeline(cpfCnpj: string, providerIds: number[], limit?: number): Promise<IspConsultation[]>;
  getRegionalScoreStats(providerIds: number[], days: number): Promise<{ avgScore: number; totalConsultations: number; belowThresholdCount: number }>;
  getRegionalAlertCount(providerIds: number[], days: number): Promise<number>;
  getTopRiskCeps(providerIds: number[], days: number, limit?: number): Promise<Array<{ cep: string; avgScore: number; count: number }>>;

  getSpcConsultationsByProvider(providerId: number): Promise<SpcConsultation[]>;
  createSpcConsultation(consultation: InsertSpcConsultation): Promise<SpcConsultation>;
  debitAndCreateSpcConsultation(providerId: number, cost: number, consultation: InsertSpcConsultation): Promise<{ provider: Provider; consultation: SpcConsultation } | null>;
  debitAndCreateIspConsultation(providerId: number, cost: number, consultation: InsertIspConsultation, alertRecord?: InsertAntiFraudAlert): Promise<{ provider: Provider; consultation: IspConsultation; alert?: AntiFraudAlert } | null>;
  getSpcConsultationCountToday(providerId: number): Promise<number>;
  getSpcConsultationCountMonth(providerId: number): Promise<number>;

  getAlertsByProvider(providerId: number): Promise<AlertWithOwnership[]>;
  createAlert(alert: InsertAntiFraudAlert): Promise<AntiFraudAlert>;
  updateAlertStatus(alertId: number, providerId: number, status: string): Promise<AlertWithOwnership | undefined>;
  getAlertsByCustomer(customerId: number): Promise<AntiFraudAlert[]>;

  getDashboardStats(providerId: number): Promise<any>;
  getDefaultersList(providerId: number): Promise<any[]>;
  getInadimplentes(providerId: number): Promise<any[]>;
  getDefaultersByProvider(providerId: number): Promise<any[]>;
  getHeatmapDataByProvider(providerId: number): Promise<any[]>;
  getHeatmapDataAllProviders(): Promise<any[]>;

  getAllUsers(): Promise<User[]>;
  adminUpdateProvider(id: number, data: Partial<Provider>): Promise<Provider>;
  adminDeactivateProvider(id: number): Promise<void>;
  updateProviderPlan(id: number, plan: string): Promise<Provider>;
  addCredits(providerId: number, ispCredits: number, spcCredits: number): Promise<Provider>;
  getSystemStats(): Promise<any>;

  getPlanChanges(providerId?: number): Promise<PlanChange[]>;
  createPlanChange(change: InsertPlanChange): Promise<PlanChange>;

  getOrCreateSupportThread(providerId: number): Promise<SupportThread>;
  getAllSupportThreads(): Promise<(SupportThread & { providerName: string; unreadCount: number })[]>;
  getSupportMessages(threadId: number): Promise<SupportMessage[]>;
  createSupportMessage(msg: InsertSupportMessage): Promise<SupportMessage>;
  markMessagesRead(threadId: number, isFromAdmin: boolean): Promise<void>;
  updateThreadStatus(threadId: number, status: string): Promise<void>;
  getUnreadCountForProvider(providerId: number): Promise<number>;

  getAllProviderInvoices(providerId?: number): Promise<(ProviderInvoice & { providerName: string })[]>;
  getProviderInvoice(id: number): Promise<(ProviderInvoice & { providerName: string; providerCnpj: string; providerSubdomain: string | null }) | undefined>;
  createProviderInvoice(invoice: InsertProviderInvoice): Promise<ProviderInvoice>;
  updateProviderInvoiceStatus(id: number, status: string, paidDate?: Date, paidAmount?: string): Promise<ProviderInvoice>;
  getNextInvoiceNumber(): Promise<string>;
  getFinancialSummary(): Promise<any>;

  getAllCreditOrders(providerId?: number): Promise<CreditOrder[]>;
  getCreditOrder(id: number): Promise<CreditOrder | undefined>;
  createCreditOrder(order: InsertCreditOrder): Promise<CreditOrder>;
  updateCreditOrder(id: number, data: Partial<CreditOrder>): Promise<CreditOrder>;
  releaseCreditOrder(id: number): Promise<CreditOrder>;
  getNextOrderNumber(): Promise<string>;

  getProviderPartners(providerId: number): Promise<ProviderPartner[]>;
  createProviderPartner(partner: InsertProviderPartner): Promise<ProviderPartner>;
  updateProviderPartner(id: number, providerId: number, data: Partial<ProviderPartner>): Promise<ProviderPartner>;
  deleteProviderPartner(id: number, providerId: number): Promise<void>;

  getProviderDocuments(providerId: number): Promise<ProviderDocument[]>;
  getProviderDocument(id: number): Promise<ProviderDocument | undefined>;
  createProviderDocument(doc: InsertProviderDocument): Promise<ProviderDocument>;
  deleteProviderDocument(id: number, providerId: number): Promise<void>;
  updateProviderDocumentStatus(id: number, status: string, reviewedById: number, reviewerName: string, rejectionReason?: string): Promise<ProviderDocument>;
  updateProviderProfile(id: number, data: Partial<Provider>): Promise<Provider>;

  getProviderWebhookToken(providerId: number): Promise<string>;
  regenerateWebhookToken(providerId: number): Promise<string>;
  getProviderByWebhookToken(token: string): Promise<Provider | undefined>;

  getErpIntegrations(providerId: number): Promise<ErpIntegration[]>;
  getAllEnabledErpIntegrationsWithCredentials(): Promise<Array<ErpIntegration & { providerName: string }>>;
  upsertErpIntegration(providerId: number, erpSource: string, data: Partial<ErpIntegration>): Promise<ErpIntegration>;
  incrementErpIntegrationCounters(providerId: number, erpSource: string, upserted: number, errors: number): Promise<void>;
  getErpSyncLogs(providerId: number, erpSource?: string, limit?: number): Promise<ErpSyncLog[]>;
  createErpSyncLog(log: Omit<ErpSyncLog, "id" | "syncedAt">): Promise<ErpSyncLog>;
  getErpIntegrationStats(providerId?: number): Promise<any>;

  getAllErpCatalog(): Promise<ErpCatalog[]>;
  getErpCatalogItem(id: number): Promise<ErpCatalog | undefined>;
  createErpCatalogItem(data: InsertErpCatalog): Promise<ErpCatalog>;
  updateErpCatalogItem(id: number, data: Partial<InsertErpCatalog>): Promise<ErpCatalog>;
  deleteErpCatalogItem(id: number): Promise<void>;

  createVisitorChat(name: string, email: string, phone: string | null): Promise<VisitorChat>;
  getVisitorChatByToken(token: string): Promise<VisitorChat | undefined>;
  getVisitorChatMessages(chatId: number): Promise<VisitorChatMessage[]>;
  createVisitorChatMessage(chatId: number, content: string, isFromAdmin: boolean, senderName: string): Promise<VisitorChatMessage>;
  getAllVisitorChats(): Promise<(VisitorChat & { unreadCount: number; lastMessage: string | null })[]>;
  markVisitorMessagesRead(chatId: number, isFromAdmin: boolean): Promise<void>;
  updateVisitorChatStatus(chatId: number, status: string): Promise<void>;
  getVisitorUnreadCount(chatId: number): Promise<number>;

  bulkImportCustomers(rows: Record<string, string>[], providerId: number): Promise<{ imported: number; errors: Array<{ row: number; message: string }> }>;
  bulkImportInvoices(rows: Record<string, string>[], providerId: number): Promise<{ imported: number; errors: Array<{ row: number; message: string }> }>;
  bulkImportEquipment(rows: Record<string, string>[], providerId: number): Promise<{ imported: number; errors: Array<{ row: number; message: string }> }>;

  // Proactive alerts
  getLastProactiveAlert(cpfCnpj: string, providerId: number): Promise<{ sentAt: Date } | undefined>;
  createProactiveAlert(data: InsertProactiveAlert): Promise<ProactiveAlert>;
  getProactiveAlertsByProvider(providerId: number, limit?: number): Promise<ProactiveAlert[]>;
  acknowledgeProactiveAlert(alertId: number, providerId: number): Promise<ProactiveAlert | undefined>;
}

class DatabaseStorage implements IStorage {
  private _users = new UsersStorage();
  private _providers = new ProvidersStorage();
  private _customers = new CustomersStorage();
  private _consultations = new ConsultationsStorage();
  private _antifraude = new AntifraudeStorage();
  private _financial = new FinancialStorage();
  private _equipment = new EquipmentStorage();
  private _erp = new ErpStorage();
  private _chat = new ChatStorage();
  private _dashboard = new DashboardStorage();
  private _admin = new AdminStorage();
  private _import = new ImportStorage();

  // Users
  getUser = (id: number) => this._users.getUser(id);
  getUserByEmail = (email: string) => this._users.getUserByEmail(email);
  getUserByPhone = (phone: string) => this._users.getUserByPhone(phone);
  getUserByVerificationToken = (token: string) => this._users.getUserByVerificationToken(token);
  createUser = (user: InsertUser) => this._users.createUser(user);
  setEmailVerified = (userId: number) => this._users.setEmailVerified(userId);
  setVerificationToken = (userId: number, token: string, expiresAt: Date) => this._users.setVerificationToken(userId, token, expiresAt);
  getUsersByProvider = (providerId: number) => this._users.getUsersByProvider(providerId);
  deleteUser = (id: number) => this._users.deleteUser(id);
  updateUserEmail = (id: number, email: string) => this._users.updateUserEmail(id, email);
  getAllUsers = () => this._users.getAllUsers();

  // Providers
  getProvider = (id: number) => this._providers.getProvider(id);
  getProviderByCnpj = (cnpj: string) => this._providers.getProviderByCnpj(cnpj);
  getProviderBySubdomain = (subdomain: string) => this._providers.getProviderBySubdomain(subdomain);
  createProvider = (provider: InsertProvider) => this._providers.createProvider(provider);
  updateProvider = (id: number, data: Partial<Pick<Provider, "name" | "contactEmail" | "contactPhone" | "website">>) => this._providers.updateProvider(id, data);
  getAllProviders = () => this._providers.getAllProviders();
  updateProviderCredits = (id: number, ispCredits: number, spcCredits: number) => this._providers.updateProviderCredits(id, ispCredits, spcCredits);
  debitIspCredits = (id: number, cost: number) => this._providers.debitIspCredits(id, cost);
  debitSpcCredits = (id: number, cost: number) => this._providers.debitSpcCredits(id, cost);
  deleteProvider = (id: number) => this._providers.deleteProvider(id);
  updateProviderProfile = (id: number, data: Partial<Provider>) => this._providers.updateProviderProfile(id, data);
  getProviderWebhookToken = (providerId: number) => this._providers.getProviderWebhookToken(providerId);
  regenerateWebhookToken = (providerId: number) => this._providers.regenerateWebhookToken(providerId);
  getProviderByWebhookToken = (token: string) => this._providers.getProviderByWebhookToken(token);
  getAllProvidersWithStats = () => this._providers.getAllProvidersWithStats();
  // Customers
  getCustomersByProvider = (providerId: number) => this._customers.getCustomersByProvider(providerId);
  getCustomerByCpfCnpj = (cpfCnpj: string) => this._customers.getCustomerByCpfCnpj(cpfCnpj);
  getCustomersByExactAddress = (address: string, city: string, state: string | null, cep: string | null, excludeCpfCnpj: string) => this._customers.getCustomersByExactAddress(address, city, state, cep, excludeCpfCnpj);
  getCustomersByAddressHash = (addressHash: string, excludeCpfCnpj?: string) => this._customers.getCustomersByAddressHash(addressHash, excludeCpfCnpj);
  createCustomer = (customer: InsertCustomer) => this._customers.createCustomer(customer);
  upsertFromErp = (data: Parameters<CustomersStorage["upsertFromErp"]>[0]) => this._customers.upsertFromErp(data);
  getHeatmapByProvider = (providerId: number) => this._customers.getHeatmapByProvider(providerId);
  getHeatmapAll = () => this._customers.getHeatmapAll();
  getCustomersByCepPrefix = (cepPrefix: string, excludeProviderId?: number) => this._customers.getCustomersByCepPrefix(cepPrefix, excludeProviderId);
  getCustomersByAddressForAlert = (cep5: string, excludeCpfCnpj: string) => this._customers.getCustomersByAddressForAlert(cep5, excludeCpfCnpj);

  // Consultations
  getIspConsultationsByProvider = (providerId: number) => this._consultations.getIspConsultationsByProvider(providerId);
  getIspConsultationsByProviderPaginated = (providerId: number, page: number, limit: number) => this._consultations.getIspConsultationsByProviderPaginated(providerId, page, limit);
  createIspConsultation = (consultation: InsertIspConsultation) => this._consultations.createIspConsultation(consultation);
  getIspConsultationCountToday = (providerId: number) => this._consultations.getIspConsultationCountToday(providerId);
  getIspConsultationCountMonth = (providerId: number) => this._consultations.getIspConsultationCountMonth(providerId);
  getRecentConsultationsForDocument = (cpfCnpj: string, days: number) => this._consultations.getRecentConsultationsForDocument(cpfCnpj, days);
  getConsultationsByCepPrefix = (cepPrefix: string, limitDays?: number) => this._consultations.getConsultationsByCepPrefix(cepPrefix, limitDays);
  getConsultationTimeline = (cpfCnpj: string, providerIds: number[], limit?: number) => this._consultations.getConsultationTimeline(cpfCnpj, providerIds, limit);
  getRegionalScoreStats = (providerIds: number[], days: number) => this._consultations.getRegionalScoreStats(providerIds, days);
  getRegionalAlertCount = (providerIds: number[], days: number) => this._consultations.getRegionalAlertCount(providerIds, days);
  getTopRiskCeps = (providerIds: number[], days: number, limit?: number) => this._consultations.getTopRiskCeps(providerIds, days, limit);
  getSpcConsultationsByProvider = (providerId: number) => this._consultations.getSpcConsultationsByProvider(providerId);
  createSpcConsultation = (consultation: InsertSpcConsultation) => this._consultations.createSpcConsultation(consultation);
  debitAndCreateSpcConsultation = (providerId: number, cost: number, consultation: InsertSpcConsultation) => this._consultations.debitAndCreateSpcConsultation(providerId, cost, consultation);
  debitAndCreateIspConsultation = (providerId: number, cost: number, consultation: InsertIspConsultation, alertRecord?: InsertAntiFraudAlert) => this._consultations.debitAndCreateIspConsultation(providerId, cost, consultation, alertRecord);
  getSpcConsultationCountToday = (providerId: number) => this._consultations.getSpcConsultationCountToday(providerId);
  getSpcConsultationCountMonth = (providerId: number) => this._consultations.getSpcConsultationCountMonth(providerId);

  // Anti-fraud
  getAlertsByProvider = (providerId: number) => this._antifraude.getAlertsByProvider(providerId);
  createAlert = (alert: InsertAntiFraudAlert) => this._antifraude.createAlert(alert);
  updateAlertStatus = (alertId: number, providerId: number, status: string) => this._antifraude.updateAlertStatus(alertId, providerId, status);
  getAlertsByCustomer = (customerId: number) => this._antifraude.getAlertsByCustomer(customerId);

  // Financial
  getContractsByCustomer = (customerId: number) => this._financial.getContractsByCustomer(customerId);
  getContractsByProvider = (providerId: number) => this._financial.getContractsByProvider(providerId);
  createContract = (contract: InsertContract) => this._financial.createContract(contract);
  getInvoicesByProvider = (providerId: number) => this._financial.getInvoicesByProvider(providerId);
  getInvoicesByCustomer = (customerId: number) => this._financial.getInvoicesByCustomer(customerId);
  getOverdueInvoicesByProvider = (providerId: number) => this._financial.getOverdueInvoicesByProvider(providerId);
  createInvoice = (invoice: InsertInvoice) => this._financial.createInvoice(invoice);
  getNextInvoiceNumber = () => this._financial.getNextInvoiceNumber();
  getAllProviderInvoices = (providerId?: number) => this._financial.getAllProviderInvoices(providerId);
  getProviderInvoice = (id: number) => this._financial.getProviderInvoice(id);
  createProviderInvoice = (invoice: InsertProviderInvoice) => this._financial.createProviderInvoice(invoice);
  updateProviderInvoiceStatus = (id: number, status: string, paidDate?: Date, paidAmount?: string) => this._financial.updateProviderInvoiceStatus(id, status, paidDate, paidAmount);
  updateProviderInvoiceAsaas = (id: number, asaasData: Parameters<FinancialStorage["updateProviderInvoiceAsaas"]>[1]) => this._financial.updateProviderInvoiceAsaas(id, asaasData);
  getFinancialSummary = () => this._financial.getFinancialSummary();
  getAllCreditOrders = (providerId?: number) => this._financial.getAllCreditOrders(providerId);
  getCreditOrder = (id: number) => this._financial.getCreditOrder(id);
  createCreditOrder = (order: InsertCreditOrder) => this._financial.createCreditOrder(order);
  updateCreditOrder = (id: number, data: Partial<CreditOrder>) => this._financial.updateCreditOrder(id, data);
  releaseCreditOrder = (id: number) => this._financial.releaseCreditOrder(id);
  getNextOrderNumber = () => this._financial.getNextOrderNumber();
  getProviderPartners = (providerId: number) => this._financial.getProviderPartners(providerId);
  createProviderPartner = (partner: InsertProviderPartner) => this._financial.createProviderPartner(partner);
  updateProviderPartner = (id: number, providerId: number, data: Partial<ProviderPartner>) => this._financial.updateProviderPartner(id, providerId, data);
  deleteProviderPartner = (id: number, providerId: number) => this._financial.deleteProviderPartner(id, providerId);
  getProviderDocuments = (providerId: number) => this._financial.getProviderDocuments(providerId);
  getProviderDocument = (id: number) => this._financial.getProviderDocument(id);
  createProviderDocument = (doc: InsertProviderDocument) => this._financial.createProviderDocument(doc);
  deleteProviderDocument = (id: number, providerId: number) => this._financial.deleteProviderDocument(id, providerId);
  updateProviderDocumentStatus = (id: number, status: string, reviewedById: number, reviewerName: string, rejectionReason?: string) => this._financial.updateProviderDocumentStatus(id, status, reviewedById, reviewerName, rejectionReason);

  // Equipment
  getEquipmentByProvider = (providerId: number) => this._equipment.getEquipmentByProvider(providerId);
  getEquipmentByCustomer = (customerId: number) => this._equipment.getEquipmentByCustomer(customerId);
  createEquipment = (eq_data: InsertEquipment) => this._equipment.createEquipment(eq_data);

  // ERP
  getErpIntegrations = (providerId: number) => this._erp.getErpIntegrations(providerId);
  getAllEnabledErpIntegrationsWithCredentials = () => this._erp.getAllEnabledErpIntegrationsWithCredentials();
  upsertErpIntegration = (providerId: number, erpSource: string, data: Partial<ErpIntegration>) => this._erp.upsertErpIntegration(providerId, erpSource, data);
  incrementErpIntegrationCounters = (providerId: number, erpSource: string, upserted: number, errors: number) => this._erp.incrementErpIntegrationCounters(providerId, erpSource, upserted, errors);
  getErpSyncLogs = (providerId: number, erpSource?: string, limit?: number) => this._erp.getErpSyncLogs(providerId, erpSource, limit);
  createErpSyncLog = (log: Omit<ErpSyncLog, "id" | "syncedAt">) => this._erp.createErpSyncLog(log);
  getErpIntegrationStats = (providerId?: number) => this._erp.getErpIntegrationStats(providerId);
  getAllErpCatalog = () => this._erp.getAllErpCatalog();
  getErpCatalogItem = (id: number) => this._erp.getErpCatalogItem(id);
  createErpCatalogItem = (data: InsertErpCatalog) => this._erp.createErpCatalogItem(data);
  updateErpCatalogItem = (id: number, data: Partial<InsertErpCatalog>) => this._erp.updateErpCatalogItem(id, data);
  deleteErpCatalogItem = (id: number) => this._erp.deleteErpCatalogItem(id);

  // Chat
  getOrCreateSupportThread = (providerId: number) => this._chat.getOrCreateSupportThread(providerId);
  getAllSupportThreads = () => this._chat.getAllSupportThreads();
  getSupportMessages = (threadId: number) => this._chat.getSupportMessages(threadId);
  createSupportMessage = (msg: InsertSupportMessage) => this._chat.createSupportMessage(msg);
  markMessagesRead = (threadId: number, isFromAdmin: boolean) => this._chat.markMessagesRead(threadId, isFromAdmin);
  updateThreadStatus = (threadId: number, status: string) => this._chat.updateThreadStatus(threadId, status);
  getUnreadCountForProvider = (providerId: number) => this._chat.getUnreadCountForProvider(providerId);
  createVisitorChat = (name: string, email: string, phone: string | null) => this._chat.createVisitorChat(name, email, phone);
  getVisitorChatByToken = (token: string) => this._chat.getVisitorChatByToken(token);
  getVisitorChatMessages = (chatId: number) => this._chat.getVisitorChatMessages(chatId);
  createVisitorChatMessage = (chatId: number, content: string, isFromAdmin: boolean, senderName: string) => this._chat.createVisitorChatMessage(chatId, content, isFromAdmin, senderName);
  getAllVisitorChats = () => this._chat.getAllVisitorChats();
  markVisitorMessagesRead = (chatId: number, isFromAdmin: boolean) => this._chat.markVisitorMessagesRead(chatId, isFromAdmin);
  updateVisitorChatStatus = (chatId: number, status: string) => this._chat.updateVisitorChatStatus(chatId, status);
  getVisitorUnreadCount = (chatId: number) => this._chat.getVisitorUnreadCount(chatId);

  // Dashboard
  getDashboardStats = (providerId: number) => this._dashboard.getDashboardStats(providerId);
  getDefaultersList = (providerId: number) => this._dashboard.getDefaultersList(providerId);
  getInadimplentes = (providerId: number) => this._dashboard.getInadimplentes(providerId);
  getDefaultersByProvider = (providerId: number) => this._dashboard.getDefaultersByProvider(providerId);
  getHeatmapDataByProvider = (providerId: number) => this._dashboard.getHeatmapDataByProvider(providerId);
  getHeatmapDataAllProviders = () => this._dashboard.getHeatmapDataAllProviders();

  // Admin
  adminUpdateProvider = (id: number, data: Partial<Provider>) => this._admin.adminUpdateProvider(id, data);
  adminDeactivateProvider = (id: number) => this._admin.adminDeactivateProvider(id);
  updateProviderPlan = (id: number, plan: string) => this._admin.updateProviderPlan(id, plan);
  addCredits = (providerId: number, ispCredits: number, spcCredits: number) => this._admin.addCredits(providerId, ispCredits, spcCredits);
  getSystemStats = () => this._admin.getSystemStats();
  getPlanChanges = (providerId?: number) => this._admin.getPlanChanges(providerId);
  createPlanChange = (change: InsertPlanChange) => this._admin.createPlanChange(change);
  getSaasMetrics = () => this._admin.getSaasMetrics();

  // Proactive alerts
  getLastProactiveAlert = (cpfCnpj: string, providerId: number) => this._consultations.getLastProactiveAlert(cpfCnpj, providerId);
  createProactiveAlert = (data: InsertProactiveAlert) => this._consultations.createProactiveAlert(data);
  getProactiveAlertsByProvider = (providerId: number, limit?: number) => this._consultations.getProactiveAlertsByProvider(providerId, limit);
  acknowledgeProactiveAlert = (alertId: number, providerId: number) => this._consultations.acknowledgeProactiveAlert(alertId, providerId);

  // Import
  bulkImportCustomers = (rows: Record<string, string>[], providerId: number) => this._import.bulkImportCustomers(rows, providerId);
  bulkImportInvoices = (rows: Record<string, string>[], providerId: number) => this._import.bulkImportInvoices(rows, providerId);
  bulkImportEquipment = (rows: Record<string, string>[], providerId: number) => this._import.bulkImportEquipment(rows, providerId);
}

export const storage = new DatabaseStorage();
