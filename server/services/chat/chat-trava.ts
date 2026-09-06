import { pool } from "../../db";

/** Trava compartilhada entre API e worker, sem manter transação financeira aberta. */
export async function comTravaDoChat<T>(
  chave: string,
  executar: () => Promise<T>,
): Promise<T | null> {
  const conexao = await pool.connect();
  let travada = false;
  let descartar = false;
  try {
    const r = await conexao.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(739106, hashtext($1)) as locked",
      [chave],
    );
    travada = r.rows[0]?.locked === true;
    return travada ? await executar() : null;
  } finally {
    if (travada) {
      try {
        await conexao.query("select pg_advisory_unlock(739106, hashtext($1))", [
          chave,
        ]);
      } catch {
        descartar = true;
      }
    }
    conexao.release(descartar);
  }
}
