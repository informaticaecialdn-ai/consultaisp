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
  const webhook = verificarWebhookAsaas(
    process.env.ASAAS_WEBHOOK_TOKEN,
    process.env.NODE_ENV,
    process.env.ASAAS_API_KEY,
  );
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
 * MAS a queda depende de o Asaas estar realmente ligado. `validateEnv` roda no
 * servidor E no worker; derrubar os dois por uma variavel de cobranca numa
 * instalacao que nem chave de API tem poe o bureau inteiro fora do ar (pm2 em
 * laco de restart) para trancar uma porta que ja esta trancada por outro
 * motivo: sem `ASAAS_API_KEY`, `conferirPagamento` recusa toda liberacao,
 * porque nao tem como reconsultar a cobranca. Foi exatamente o caso da VPS em
 * 03/09/2026 — nenhuma das duas variaveis existia la.
 *
 * Entao: com o Asaas configurado e sem token, em producao, o processo nao sobe.
 * Sem chave de API, e aviso — e o aviso vira fatal no dia em que alguem
 * cadastrar a chave sem o token.
 *
 * Fora de producao e sempre aviso: quem roda local nao tem o token e ainda
 * precisa conseguir testar o fluxo.
 */
export function verificarWebhookAsaas(
  token: string | undefined,
  nodeEnv: string | undefined,
  chaveAsaas?: string | undefined,
): { nivel: "ok" | "aviso" | "fatal"; mensagem: string } {
  if (token?.trim()) return { nivel: "ok", mensagem: "" };

  // Mesmo criterio de isAsaasConfigured() em services/asaas.ts: chave curta
  // demais nao autentica em lugar nenhum.
  const asaasLigado = (chaveAsaas ?? "").trim().length > 10;

  if (nodeEnv === "production" && asaasLigado) {
    return {
      nivel: "fatal",
      mensagem:
        "ASAAS_WEBHOOK_TOKEN nao configurado. Em producao o webhook do Asaas libera credito, " +
        "e sem o token qualquer POST forjado creditaria um pedido. Defina a variavel no .env " +
        "(o mesmo valor cadastrado no painel do Asaas) e suba o processo de novo.",
    };
  }

  if (nodeEnv === "production") {
    return {
      nivel: "aviso",
      mensagem:
        "ASAAS_WEBHOOK_TOKEN e ASAAS_API_KEY nao configurados — cobranca desligada nesta instalacao. " +
        "O webhook nao libera nada sem a chave (nao consegue reconsultar a cobranca). " +
        "Ao cadastrar ASAAS_API_KEY, cadastre o token junto: sem ele o processo nao sobe.",
    };
  }

  return {
    nivel: "aviso",
    mensagem:
      "ASAAS_WEBHOOK_TOKEN nao configurado — o webhook do Asaas fica sem protecao. " +
      "Tolerado fora de producao; em producao, com a chave do Asaas cadastrada, o processo nao sobe assim.",
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
