import { logger } from "../logger";

export function getSafeErrorMessage(error: unknown): string {
  const rawMessage = (error as any)?.message || "Erro interno do servidor";

  logger.error({ err: error }, rawMessage);

  if (process.env.NODE_ENV === "production") {
    return "Erro interno do servidor";
  }

  return rawMessage;
}
