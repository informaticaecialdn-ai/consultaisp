/**
 * Z-API WhatsApp integration.
 * Envia e recebe mensagens via Z-API (api.z-api.io).
 *
 * Env vars:
 *   ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN,
 *   ZAPI_BASE_URL (default: https://api.z-api.io)
 */

function getConfig() {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const token = process.env.ZAPI_TOKEN;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN;
  const baseUrl = process.env.ZAPI_BASE_URL || "https://api.z-api.io";

  if (!instanceId || !token) {
    return null; // Z-API not configured
  }

  return {
    instanceId,
    token,
    clientToken,
    apiUrl: `${baseUrl}/instances/${instanceId}/token/${token}`,
  };
}

export function isZapiConfigured(): boolean {
  return getConfig() !== null;
}

/**
 * Format phone number for Z-API (Brazilian format: 55 + DDD + number)
 */
export function formatPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  // Remove leading 0
  if (cleaned.startsWith("0")) cleaned = cleaned.substring(1);
  // Add country code if missing
  if (!cleaned.startsWith("55")) cleaned = "55" + cleaned;
  return cleaned;
}

/**
 * Send a text message via WhatsApp
 */
export async function sendText(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
  const config = getConfig();
  if (!config) return { success: false, error: "Z-API nao configurado" };

  try {
    const response = await fetch(`${config.apiUrl}/send-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.clientToken ? { "Client-Token": config.clientToken } : {}),
      },
      body: JSON.stringify({
        phone: formatPhone(phone),
        message,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Z-API erro ${response.status}: ${text}` };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Send an image via WhatsApp
 */
export async function sendImage(
  phone: string,
  imageUrl: string,
  caption?: string
): Promise<{ success: boolean; error?: string }> {
  const config = getConfig();
  if (!config) return { success: false, error: "Z-API nao configurado" };

  try {
    const response = await fetch(`${config.apiUrl}/send-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.clientToken ? { "Client-Token": config.clientToken } : {}),
      },
      body: JSON.stringify({
        phone: formatPhone(phone),
        image: imageUrl,
        caption,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Z-API erro ${response.status}: ${text}` };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Check if a phone number has WhatsApp
 */
export async function checkNumber(phone: string): Promise<{ exists: boolean; error?: string }> {
  const config = getConfig();
  if (!config) return { exists: false, error: "Z-API nao configurado" };

  try {
    const formatted = formatPhone(phone);
    const response = await fetch(`${config.apiUrl}/phone-exists/${formatted}`, {
      method: "GET",
      headers: {
        ...(config.clientToken ? { "Client-Token": config.clientToken } : {}),
      },
    });

    if (!response.ok) {
      return { exists: false, error: `Z-API erro ${response.status}` };
    }

    const data = await response.json();
    return { exists: data.exists === true };
  } catch (error: any) {
    return { exists: false, error: error.message };
  }
}

/**
 * Configure Z-API webhook to receive messages
 */
export async function setWebhook(webhookUrl: string): Promise<{ success: boolean; error?: string }> {
  const config = getConfig();
  if (!config) return { success: false, error: "Z-API nao configurado" };

  try {
    const response = await fetch(`${config.apiUrl}/update-webhook-received`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(config.clientToken ? { "Client-Token": config.clientToken } : {}),
      },
      body: JSON.stringify({
        value: webhookUrl,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Z-API erro ${response.status}: ${text}` };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Validate incoming Z-API webhook request (check Client-Token header)
 */
export function validateWebhookToken(headerToken: string | undefined): boolean {
  const config = getConfig();
  if (!config || !config.clientToken) return true; // No token configured = allow all
  return headerToken === config.clientToken;
}

/**
 * Parse Z-API webhook payload to extract phone and message
 */
export function parseWebhookPayload(body: any): { phone: string; message: string } | null {
  // Z-API sends different formats; handle the most common ones
  const phone = body?.phone || body?.data?.phone || body?.from;
  const message = body?.text?.message || body?.data?.text?.message || body?.body || body?.message?.text;

  // Ignore messages sent by us (fromMe)
  if (body?.fromMe || body?.data?.fromMe) return null;

  if (!phone || !message) return null;

  return { phone: formatPhone(phone), message };
}
