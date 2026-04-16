/**
 * Instagram DM via Graph API.
 * Requer: META_PAGE_ACCESS_TOKEN, META_PAGE_ID no .env
 */

class InstagramService {

  constructor() {
    this.accessToken = process.env.META_PAGE_ACCESS_TOKEN;
    this.pageId = process.env.META_PAGE_ID;
    this.apiVersion = 'v21.0';
  }

  isConfigured() {
    return !!(this.accessToken && this.pageId);
  }

  /**
   * Envia DM para um usuario do Instagram
   * @param {string} recipientId - IGSID (Instagram-scoped ID)
   * @param {string} message - Texto da mensagem
   */
  async sendDM(recipientId, message) {
    if (!this.isConfigured()) {
      return { success: false, error: 'Instagram nao configurado (META_PAGE_ACCESS_TOKEN)' };
    }

    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${this.pageId}/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: message },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Instagram API ${response.status}: ${text}` };
      }

      console.log(`[INSTAGRAM] DM enviada para ${recipientId}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new InstagramService();
