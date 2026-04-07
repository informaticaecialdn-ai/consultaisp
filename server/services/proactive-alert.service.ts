import { storage } from "../storage";
import { sendProactiveAlertEmail } from "./email";
import { logger } from "../logger";

interface ProviderDetail {
  isSameProvider: boolean;
  providerName?: string;
  customerName?: string;
  cpfCnpj?: string;
  providerId?: number;
}

function maskCpfForAlert(cpf: string): string {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.***.***.${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.***.***/****-${digits.slice(12)}`;
  }
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

function maskNameForAlert(name: string): string {
  if (!name) return "Cliente";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2) + "***";
  }
  return parts[0] + " " + parts.slice(1).map(p => p.charAt(0) + "***").join(" ");
}

export async function notifyOwnerProviders(
  cpfCnpj: string,
  allCustomers: Array<{ providerId: number; providerName: string; isSameProvider: boolean; name?: string }>,
  consultingProviderId: number,
): Promise<void> {
  // Find providers that own this customer (isSameProvider = true from their perspective)
  // but are NOT the one doing the consultation
  const ownerCustomers = allCustomers.filter(
    c => c.providerId !== consultingProviderId
  );

  if (ownerCustomers.length === 0) {
    return;
  }

  // De-duplicate by providerId
  const seen = new Set<number>();
  const uniqueOwners = ownerCustomers.filter(c => {
    if (seen.has(c.providerId)) return false;
    seen.add(c.providerId);
    return true;
  });

  for (const ownerCustomer of uniqueOwners) {
    try {
      const ownerProvider = await storage.getProvider(ownerCustomer.providerId);
      if (!ownerProvider) continue;

      // Check if provider has proactive alerts enabled
      if (ownerProvider.proactiveAlertsEnabled === false) {
        logger.info({ providerId: ownerProvider.id }, "Proactive alerts disabled for provider, skipping");
        continue;
      }

      // Throttle check: max 1 alert per CPF per owner-provider per 24h
      const lastAlert = await storage.getLastProactiveAlert(cpfCnpj, ownerProvider.id);
      if (lastAlert) {
        logger.info(
          { providerId: ownerProvider.id, cpfCnpj: maskCpfForAlert(cpfCnpj) },
          "Proactive alert throttled (24h)",
        );
        continue;
      }

      const maskedCpf = maskCpfForAlert(cpfCnpj);
      const maskedName = maskNameForAlert(ownerCustomer.name || "Cliente");
      const webhookUrl = ownerProvider.proactiveAlertWebhookUrl;
      const hasWebhook = !!webhookUrl;
      const channel = hasWebhook ? "both" : "email";

      // Send email notification
      const contactEmail = ownerProvider.contactEmail;
      if (contactEmail) {
        try {
          await sendProactiveAlertEmail(contactEmail, ownerProvider.name, maskedCpf, maskedName);
          logger.info(
            { providerId: ownerProvider.id, channel: "email" },
            "Proactive alert email sent",
          );
        } catch (emailErr) {
          logger.error({ err: emailErr, providerId: ownerProvider.id }, "Failed to send proactive alert email");
        }
      } else {
        logger.warn({ providerId: ownerProvider.id }, "No contact email for proactive alert");
      }

      // Send webhook notification
      if (hasWebhook) {
        try {
          const webhookPayload = {
            event: "proactive_alert",
            provider: ownerProvider.name,
            maskedCpf,
            maskedCustomerName: maskedName,
            message: "Seu cliente foi consultado por outro provedor da rede ISP",
            timestamp: new Date().toISOString(),
          };

          const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(webhookPayload),
            signal: AbortSignal.timeout(10_000),
          });

          logger.info(
            { providerId: ownerProvider.id, channel: "webhook", status: response.status },
            "Proactive alert webhook sent",
          );
        } catch (webhookErr) {
          logger.error({ err: webhookErr, providerId: ownerProvider.id }, "Failed to send proactive alert webhook");
        }
      }

      // Record the alert
      await storage.createProactiveAlert({
        providerId: ownerProvider.id,
        cpfCnpj,
        consultingProviderId,
        channel,
        acknowledged: false,
      });

      logger.info(
        { providerId: ownerProvider.id, channel, cpfCnpj: maskedCpf },
        "Proactive alert recorded",
      );
    } catch (err) {
      logger.error({ err, providerId: ownerCustomer.providerId }, "Proactive alert processing error");
    }
  }
}
