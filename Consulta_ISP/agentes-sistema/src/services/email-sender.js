/**
 * Email sender via Resend API.
 * Requer: RESEND_API_KEY no .env
 */

const logger = require('../utils/logger');

class EmailSenderService {

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY;
    this.fromEmail = process.env.EMAIL_FROM || 'vendas@consultaisp.com.br';
  }

  isConfigured() {
    return !!this.apiKey;
  }

  async sendEmail(to, subject, body) {
    if (!this.apiKey) {
      return { success: false, error: 'RESEND_API_KEY nao configurado' };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: [to],
          subject,
          text: body,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Resend ${response.status}: ${text}` };
      }

      const data = await response.json();
      logger.info({ to, subject }, '[EMAIL] enviado');
      return { success: true, id: data.id };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailSenderService();
