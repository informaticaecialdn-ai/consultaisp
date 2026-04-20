// Asaas API wrapper — cobranca PIX/Boleto/Cartao.
// Auto-detect sandbox/prod pelo prefixo da key:
//   $aact_ -> producao
//   $aact_test_ -> sandbox
// Docs: https://docs.asaas.com/

const logger = require('../utils/logger');

const PROD_BASE = 'https://api.asaas.com/v3';
const SANDBOX_BASE = 'https://sandbox.asaas.com/api/v3';

class AsaasService {
  constructor() {
    this.apiKey = process.env.ASAAS_API_KEY || null;
    this.baseUrl = this.apiKey?.startsWith('$aact_test_') ? SANDBOX_BASE : PROD_BASE;
  }

  isConfigured() {
    return !!this.apiKey;
  }

  _headers() {
    if (!this.apiKey) throw new Error('ASAAS_API_KEY ausente no .env');
    return {
      'Content-Type': 'application/json',
      access_token: this.apiKey
    };
  }

  async _fetch(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const opts = { method, headers: this._headers() };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const errMsg = data?.errors?.[0]?.description || `HTTP ${r.status}`;
      const err = new Error(`[ASAAS] ${errMsg}`);
      err.status = r.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  // === Customers ===

  async findOrCreateCustomer({ name, cpfCnpj, email, phone }) {
    if (!cpfCnpj) throw new Error('cpfCnpj obrigatorio');
    const cleaned = String(cpfCnpj).replace(/\D/g, '');
    // 1. Busca por cpfCnpj
    try {
      const search = await this._fetch('GET', `/customers?cpfCnpj=${cleaned}`);
      if (search.data && search.data.length > 0) {
        return { id: search.data[0].id, existing: true, customer: search.data[0] };
      }
    } catch (err) { /* segue pra criar */ }

    // 2. Cria
    const created = await this._fetch('POST', '/customers', {
      name: name || 'Cliente',
      cpfCnpj: cleaned,
      email: email || undefined,
      mobilePhone: phone || undefined,
      notificationDisabled: false
    });
    logger.info({ customer_id: created.id }, '[ASAAS] cliente criado');
    return { id: created.id, existing: false, customer: created };
  }

  // === Payments ===

  // Cria cobranca PIX (mais rapida pra ISP cliente — boleto e mensal)
  async createPixPayment({ customerId, value, dueDate, description, externalReference }) {
    if (!customerId || !value || !dueDate) {
      throw new Error('customerId, value, dueDate obrigatorios');
    }
    const payment = await this._fetch('POST', '/payments', {
      customer: customerId,
      billingType: 'PIX',
      value: Number(value),
      dueDate, // YYYY-MM-DD
      description: description || 'Consulta ISP — Mensalidade',
      externalReference: externalReference || undefined
    });

    // Pega QRCode + payload PIX
    let pixPayload = null;
    let qrcodeUrl = null;
    try {
      const pixInfo = await this._fetch('GET', `/payments/${payment.id}/pixQrCode`);
      pixPayload = pixInfo.payload;
      qrcodeUrl = pixInfo.encodedImage; // base64 PNG
    } catch (err) {
      logger.warn({ err: err.message }, '[ASAAS] falha ao buscar PIX QRCode');
    }

    return {
      id: payment.id,
      status: payment.status,
      invoiceUrl: payment.invoiceUrl,
      bankSlipUrl: payment.bankSlipUrl,
      pixPayload,
      qrcodeUrl,
      raw: payment
    };
  }

  // Cria boleto (recorrente mensal e mais comum em ISP)
  async createBoletoPayment({ customerId, value, dueDate, description, externalReference }) {
    return this._fetch('POST', '/payments', {
      customer: customerId,
      billingType: 'BOLETO',
      value: Number(value),
      dueDate,
      description: description || 'Consulta ISP — Mensalidade',
      externalReference
    });
  }

  // Cria cobranca recorrente mensal (subscription)
  async createSubscription({ customerId, value, billingType = 'PIX', cycle = 'MONTHLY', nextDueDate, description }) {
    return this._fetch('POST', '/subscriptions', {
      customer: customerId,
      billingType,
      value: Number(value),
      cycle,
      nextDueDate, // YYYY-MM-DD primeira cobranca
      description: description || 'Consulta ISP — Mensalidade recorrente'
    });
  }

  async getPayment(paymentId) {
    return this._fetch('GET', `/payments/${paymentId}`);
  }

  async cancelPayment(paymentId) {
    return this._fetch('DELETE', `/payments/${paymentId}`);
  }
}

module.exports = new AsaasService();
