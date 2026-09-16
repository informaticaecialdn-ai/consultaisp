import { Client } from "pg";
import { pool } from "../../db";
import { logger } from "../../logger";
import type { ModoWorkerChat } from "@shared/chat-operacao";

const PREFIXO = "consultaisp-chat:";
/** Conexão dedicada e consulta periódica: não cria tabela nem guarda dados de clientes. */
export async function conectarPresencaDoChat(modo: ModoWorkerChat) {
  const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: PREFIXO + modo, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  // O erro será observado no próximo pulso; não deixa erro de socket sem listener.
  let falha: Error | null = null;
  client.on("error", (err: Error) => { falha = err; });
  try { await client.connect(); }
  catch (err) {
    try { await client.end(); } catch { logger.warn({ modo }, "Falha ao liberar conexão de presença do chat"); }
    throw err;
  }
  return {
    async pulsar() { if (falha) throw falha; await client.query("select 1"); },
    async encerrar() { await client.end(); },
  };
}

/** Pulso de atividade do processo. Não executa agenda nem confirma entrega de mensagem. */
export async function iniciarPresencaDoChat(modo: ModoWorkerChat) {
  let presenca: Awaited<ReturnType<typeof conectarPresencaDoChat>> | null = null;
  let encerrando = false;
  let emCurso: Promise<void> | null = null;
  async function atualizar() {
    try {
      presenca ??= await conectarPresencaDoChat(modo);
      await presenca.pulsar();
    } catch {
      logger.warn({ modo }, "Presença do processo de chat indisponível; nova tentativa no próximo pulso");
      const anterior = presenca;
      presenca = null;
      try { await anterior?.encerrar(); } catch { logger.warn({ modo }, "Falha ao encerrar presença anterior do chat"); }
    }
  }
  await atualizar();
  const timer = setInterval(() => {
    if (encerrando || emCurso) return;
    emCurso = atualizar().finally(() => { emCurso = null; });
  }, 15_000);
  timer.unref();
  return {
    async encerrar() {
      if (encerrando) { await emCurso; return; }
      encerrando = true;
      clearInterval(timer);
      await emCurso;
      const atual = presenca;
      presenca = null;
      await atual?.encerrar();
    },
  };
}

export async function estadoDoProcessoChat() {
  const r = await pool.query<{ application_name: string; state_change: Date }>(
    `select application_name, state_change from pg_stat_activity
     where datname = current_database() and usename = current_user
       and application_name = any($1::text[]) and state_change > now() - interval '75 seconds'
     order by (application_name = $2) desc, state_change desc limit 1`,
    [[PREFIXO + "ensaio", PREFIXO + "envio"], PREFIXO + "envio"],
  );
  const p = r.rows[0];
  return { online: !!p, modo: p ? p.application_name.slice(PREFIXO.length) as ModoWorkerChat : null, verificadoEm: p?.state_change.toISOString() ?? null };
}
