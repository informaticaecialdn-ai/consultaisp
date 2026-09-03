import { logger } from "./logger";

const REQUIRED_VARS = ["DATABASE_URL", "SESSION_SECRET"] as const;

export function validateEnv(): void {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logger.fatal({ missing }, "Missing required environment variables");
    process.exit(1);
  }
  // LGPD compliance warnings
  if (!process.env.NETWORK_CPF_SALT) {
    logger.warn("NETWORK_CPF_SALT not set — CPF hashing disabled. Set a 32+ char salt for LGPD compliance.");
  }
  const partnerSecret = (process.env.PARTNER_CODE_SECRET || "").trim();
  if (!partnerSecret) {
    logger.warn("PARTNER_CODE_SECRET not set — partner codes derive from SESSION_SECRET; rotating SESSION_SECRET rotates every partner code. Set a 32+ char secret.");
  } else if (partnerSecret.length < 32) {
    // Falhar aqui, nao na primeira consulta com parceiro — que viraria 500
    // em toda consulta, listagem de alertas e timeline.
    logger.fatal({ length: partnerSecret.length }, "PARTNER_CODE_SECRET must have at least 32 characters");
    process.exit(1);
  }
  const webhook = verificarWebhookAsaas(process.env.ASAAS_WEBHOOK_TOKEN, process.env.NODE_ENV);
  if (webhook.nivel === "fatal") {
    logger.fatal(webhook.mensagem);
    process.exit(1);
  } else if (webhook.nivel === "aviso") {
    logger.warn(webhook.mensagem);
  }

  avisarLgpdSemIdentificacao();
  logger.info("Environment validated");
}

/**
 * O webhook do Asaas e o unico caminho pelo qual credito entra no saldo sem
 * ninguem clicar. Sem `ASAAS_WEBHOOK_TOKEN` a rota aceita qualquer POST: um
 * pedido inventado libera credito de graca. Em producao isso e motivo para o
 * processo nao subir — o pm2 congela o .env no start, entao a variavel faltando
 * so apareceria quando o dinheiro ja tivesse escapado.
 *
 * Fora de producao vira aviso: quem roda local nao tem o token e ainda precisa
 * conseguir testar o fluxo.
 */
export function verificarWebhookAsaas(
  token: string | undefined,
  nodeEnv: string | undefined,
): { nivel: "ok" | "aviso" | "fatal"; mensagem: string } {
  if (token?.trim()) return { nivel: "ok", mensagem: "" };
  if (nodeEnv === "production") {
    return {
      nivel: "fatal",
      mensagem:
        "ASAAS_WEBHOOK_TOKEN nao configurado. Em producao o webhook do Asaas libera credito, " +
        "e sem o token qualquer POST forjado creditaria um pedido. Defina a variavel no .env " +
        "(o mesmo valor cadastrado no painel do Asaas) e suba o processo de novo.",
    };
  }
  return {
    nivel: "aviso",
    mensagem:
      "ASAAS_WEBHOOK_TOKEN nao configurado — o webhook do Asaas fica sem protecao. " +
      "Tolerado fora de producao; em producao o processo nao sobe assim.",
  };
}

export function getAsaasWebhookToken(): string | undefined {
  return process.env.ASAAS_WEBHOOK_TOKEN?.trim() || undefined;
}

/** O CNPJ de exemplo que o codigo publica quando LGPD_CNPJ nao esta definido. */
const CNPJ_PLACEHOLDER = "00.000.000/0000-00";

/**
 * Avisa, no boot de producao, que a politica publica esta sem quem responde
 * por ela.
 *
 * `GET /api/public/lgpd-info` cai num nome e num CNPJ de exemplo quando estas
 * variaveis faltam — e /lgpd e um documento com efeito juridico, nomeando o
 * CONTROLADOR perante o titular. Publicar "00.000.000/0000-00" ali nao
 * identifica ninguem, e a falha e silenciosa: a pagina responde 200 e parece
 * pronta.
 *
 * So aviso, nunca falha. Derrubar o boot por causa disto deixaria o bureau
 * inteiro fora do ar por um campo de texto — e o dono ainda precisa informar a
 * razao social e o CNPJ reais da plataforma.
 */
export function avisarLgpdSemIdentificacao(): void {
  if (process.env.NODE_ENV !== "production") return;

  const cnpj = (process.env.LGPD_CNPJ || "").trim();
  const empresa = (process.env.LGPD_EMPRESA || "").trim();
  const faltando: string[] = [];
  if (!cnpj || cnpj === CNPJ_PLACEHOLDER) faltando.push("LGPD_CNPJ");
  if (!empresa) faltando.push("LGPD_EMPRESA");
  if (faltando.length === 0) return;

  logger.warn(
    { faltando },
    "Politica publica /lgpd sem identificacao real do controlador — ela vai publicar o CNPJ de exemplo. Defina os valores no .env (pm2 congela o .env: delete + start pelo ecosystem).",
  );
}
