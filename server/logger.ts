import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  // V-07 LGPD: redact PII fields from structured log output
  redact: {
    paths: [
      "*.cpf", "*.cpfCnpj", "*.cpf_cnpj",
      "*.email", "*.phone", "*.telefone",
      "*.name", "*.nome", "*.customerName",
      "req.body.cpfCnpj", "req.body.email", "req.body.password",
    ],
    censor: "[REDACTED]",
  },
  ...(isProduction
    ? {} // JSON output in production for Docker log aggregation
    : { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } }
  ),
});
