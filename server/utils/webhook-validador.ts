/**
 * Validação do webhook de alerta de fuga que o PROVEDOR cadastra
 * (`providers.proactive_alert_webhook_url`) — a ÚNICA função para isso.
 *
 * Revisão final de segurança antes da demonstração pública: a validação
 * nasceu presa ao fecho de `provider.routes.ts` (`PUT/POST .../alert-settings*`),
 * que NÃO TEM CONSUMIDOR no client. A tela de verdade — aba Anti-Fraude do
 * Painel do Provedor, `PUT /api/anti-fraud/rules`
 * (`server/routes/antifraude.routes.ts`) — gravava o MESMO campo por um
 * schema Zod que admitia `http://` e qualquer host, sem checagem nenhuma de
 * endereço interno. E mesmo com todo escritor validando, linhas GRAVADAS
 * ANTES desta função existir continuam na base — por isso o DISPARO
 * (`server/services/proactive-alert.service.ts`) revalida na hora de chamar,
 * e não confia em quem gravou.
 *
 * A regra: protege a COLUNA, não a rota. Todo escritor de
 * `proactiveAlertWebhookUrl` e o único leitor que faz `fetch()` nela chamam
 * `validarWebhookExterno` — nunca reimplementam a checagem.
 *
 * `ehEnderecoPrivado` (`shared/chat-console.ts`, reusada pela allowlist do
 * console de agentes) só julga a FORMA do hostname — não resolve nome
 * nenhum. Um hostname público que RESOLVE para loopback
 * (`https://127.0.0.1.nip.io/`, serviço público de DNS que resolve qualquer
 * IP embutido no próprio nome) passa por ela sem ser pego, porque
 * "127.0.0.1.nip.io" não É um endereço IP nem cai em nenhum dos padrões que
 * ela reconhece. Por isso esta função RESOLVE o host e confere TODOS os
 * endereços devolvidos — não só o primeiro, e não só por padrão de texto.
 */
import dns from "node:dns";
import { ehEnderecoPrivado } from "@shared/chat-console";

/**
 * Uma mensagem só, para toda recusa de FORMATO/DESTINO.
 *
 * Distinguir "não é https" de "é endereço interno" de "não resolve" não
 * vaza nada sobre um SERVIDOR de terceiro — o provedor só está lendo de
 * volta o que ele mesmo digitou. O que não pode vazar é o resultado da
 * TENTATIVA DE CONEXÃO (ver `MOTIVO_TESTE_FALHOU` mais abaixo, usado só na
 * rota de teste) — ali sim `error.message` distingue porta fechada de TLS
 * ruim, e vira oráculo de porta contra a rede interna da VPS.
 */
export const MOTIVO_WEBHOOK_INVALIDO =
  "Endereço inválido ou não permitido. Use uma URL pública, começando com https://.";

/** A mesma mensagem fixa para toda falha de CONEXÃO no teste manual — nunca `error.message` cru (item 2). */
export const MOTIVO_TESTE_FALHOU = "Não foi possível conectar a esse endereço.";

export type VeredictoWebhook = { ok: true } | { ok: false; motivo: string };

/**
 * `dns.lookup` do Node aceita literal IP e devolve na hora, sem rede
 * nenhuma (é o `getaddrinfo` do SO reconhecendo um endereço numérico) — por
 * isso chamar para 127.0.0.1/169.254.169.254/etc. não bate em rede, só
 * confirma o que `ehEnderecoPrivado` já teria recusado antes de chegar aqui.
 */
function resolverTodosOsEnderecos(host: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dns.lookup(host, { all: true, verbatim: true }, (err, enderecos) => {
      if (err) return reject(err);
      resolve(enderecos.map((e) => e.address));
    });
  });
}

/**
 * https + host publicado (forma) + host RESOLVIDO (todos os endereços).
 *
 * Chamada em TODO escritor da coluna (`PUT /api/anti-fraud/rules`,
 * `PUT /api/providers/alert-settings`, `POST .../test-webhook`) e no
 * DISPARO (`proactive-alert.service.ts`), antes de qualquer `fetch()` contra
 * o valor que o provedor digitou.
 */
export async function validarWebhookExterno(url: string): Promise<VeredictoWebhook> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO };
  }
  if (u.protocol !== "https:") {
    return { ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO };
  }

  const host = u.hostname.toLowerCase();
  if (ehEnderecoPrivado(host)) {
    return { ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO };
  }

  let enderecos: string[];
  try {
    enderecos = await resolverTodosOsEnderecos(host);
  } catch {
    // Não resolve (ENOTFOUND) ou o resolvedor falhou: nem um destino real
    // temos para chamar. Recusa — nunca "ok" por falta de prova.
    return { ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO };
  }
  if (enderecos.length === 0 || enderecos.some((endereco) => ehEnderecoPrivado(endereco))) {
    return { ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO };
  }

  return { ok: true };
}
