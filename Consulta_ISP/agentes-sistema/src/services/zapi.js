const axios = require('axios');

class ZApiService {
  constructor() {
    this.baseUrl = process.env.ZAPI_BASE_URL || 'https://api.z-api.io';
    this.instanceId = process.env.ZAPI_INSTANCE_ID;
    this.token = process.env.ZAPI_TOKEN;
    this.clientToken = process.env.ZAPI_CLIENT_TOKEN;
  }

  get apiUrl() {
    return `${this.baseUrl}/instances/${this.instanceId}/token/${this.token}`;
  }

  get headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.clientToken) h['Client-Token'] = this.clientToken;
    return h;
  }

  // Formata numero para padrao WhatsApp Brasil
  formatPhone(phone) {
    let clean = phone.replace(/\D/g, '');
    if (clean.startsWith('0')) clean = clean.slice(1);
    if (!clean.startsWith('55')) clean = '55' + clean;
    return clean;
  }

  // Envia mensagem de texto
  async sendText(phone, message) {
    const formatted = this.formatPhone(phone);
    try {
      const response = await axios.post(
        `${this.apiUrl}/send-text`,
        { phone: formatted, message },
        { headers: this.headers }
      );
      console.log(`[Z-API] Mensagem enviada para ${formatted}`);
      return response.data;
    } catch (error) {
      console.error(`[Z-API] Erro ao enviar mensagem:`, error.response?.data || error.message);
      throw error;
    }
  }

  // Envia imagem com legenda
  async sendImage(phone, imageUrl, caption = '') {
    const formatted = this.formatPhone(phone);
    try {
      const response = await axios.post(
        `${this.apiUrl}/send-image`,
        { phone: formatted, image: imageUrl, caption },
        { headers: this.headers }
      );
      return response.data;
    } catch (error) {
      console.error(`[Z-API] Erro ao enviar imagem:`, error.response?.data || error.message);
      throw error;
    }
  }

  // Envia documento/PDF
  async sendDocument(phone, documentUrl, fileName) {
    const formatted = this.formatPhone(phone);
    try {
      const response = await axios.post(
        `${this.apiUrl}/send-document/${formatted}`,
        { document: documentUrl, fileName },
        { headers: this.headers }
      );
      return response.data;
    } catch (error) {
      console.error(`[Z-API] Erro ao enviar documento:`, error.response?.data || error.message);
      throw error;
    }
  }

  // Envia botoes (lista de opcoes)
  async sendButtons(phone, message, buttons) {
    const formatted = this.formatPhone(phone);
    try {
      const response = await axios.post(
        `${this.apiUrl}/send-button-list`,
        {
          phone: formatted,
          message,
          buttonList: {
            buttons: buttons.map(b => ({ label: b }))
          }
        },
        { headers: this.headers }
      );
      return response.data;
    } catch (error) {
      console.error(`[Z-API] Erro ao enviar botoes:`, error.response?.data || error.message);
      throw error;
    }
  }

  // Verifica se numero tem WhatsApp
  async checkNumber(phone) {
    const formatted = this.formatPhone(phone);
    try {
      const response = await axios.get(
        `${this.apiUrl}/phone-exists/${formatted}`,
        { headers: this.headers }
      );
      return response.data.exists;
    } catch (error) {
      return false;
    }
  }

  // Configura webhook (Sprint 2 / T2: inclui header HMAC via ZAPI_WEBHOOK_TOKEN)
  async setWebhook(webhookUrl) {
    try {
      const hmacToken = process.env.ZAPI_WEBHOOK_TOKEN;
      const body = { value: webhookUrl };
      // Z-API aceita headers customizados para autenticar o callback de volta
      if (hmacToken) {
        body.headers = [{ name: 'X-Z-API-Token', value: hmacToken }];
      }
      const response = await axios.put(
        `${this.apiUrl}/update-webhook-received`,
        body,
        { headers: this.headers }
      );
      console.log(`[Z-API] Webhook configurado: ${webhookUrl}${hmacToken ? ' (com HMAC)' : ''}`);
      return response.data;
    } catch (error) {
      console.error(`[Z-API] Erro ao configurar webhook:`, error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new ZApiService();
