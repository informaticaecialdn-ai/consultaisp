/**
 * A limpeza periódica dos sandboxes da demonstração pública: de hora em hora,
 * apaga todo sandbox mais velho que `VIDA_DO_SANDBOX_MS` (24h) — a mesma
 * convenção de identidade que `sandbox.service.ts` usa (`subdomain` começando
 * por "sandbox-"), sem coluna nova, sem migração.
 *
 * Só RODA em modo demonstração. `server/worker.ts` decide SE chama
 * `iniciarLimpezaDaDemo()`, dentro de `if (emModoDemo())` — um timer que só
 * existe onde pode agir é mais fácil de raciocinar do que um que fica sempre
 * no ar e vira no-op fora da demo. Mesmo assim, `limparSandboxesExpirados()`
 * também confere `emModoDemo()` por conta própria (é a única leitura de
 * DEMO_MODE que este arquivo aceita — ver `modo-demo.ts`): chamada direta,
 * por engano ou por um teste, nunca apaga um provedor de produção.
 *
 * Falha em UM sandbox não impede os outros — o registro de cada um vai para
 * o log (com o id e o erro), e o fim da passada também loga o agregado
 * (quantos apagados, quantos pendentes): uma falha que se repete toda hora
 * fica visível ali, em vez de se perder atrás de um warn isolado que ninguém
 * correlaciona entre passadas.
 *
 * Molde de `server/services/chat/chat-primeiro-contato.service.ts`
 * (`iniciarPrimeirosContatos`/`pararPrimeirosContatos`, já ligado em
 * `server/worker.ts`): guarda de dupla partida, `passada` em voo que impede
 * sobreposição, `timer.unref()` para não segurar o desligamento do processo,
 * e parada ordenada que espera a passada corrente terminar.
 */
import { emModoDemo } from "./modo-demo";
import { sandboxesExpirados, apagarSandbox } from "./sandbox.service";
import { logger } from "../logger";

const UMA_HORA_MS = 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let passada: Promise<{ apagados: number }> | null = null;

/**
 * Uma passada da limpeza: acha os sandboxes expirados e apaga cada um.
 *
 * Fora do modo demo, não lê nem apaga nada — produção nunca perde provedor
 * por esta rotina, mesmo se algum chamador futuro invocar a função direto.
 */
export async function limparSandboxesExpirados(agora = new Date()): Promise<{ apagados: number }> {
  if (!emModoDemo()) return { apagados: 0 };

  const ids = await sandboxesExpirados(agora);
  let apagados = 0;
  const falhas: number[] = [];

  for (const id of ids) {
    try {
      await apagarSandbox(id);
      apagados++;
    } catch (err) {
      falhas.push(id);
      logger.warn({ providerId: id, err }, "demo: sandbox nao apagado");
    }
  }

  if (falhas.length > 0) {
    // Agregado da passada inteira — não só o aviso por sandbox acima. Uma
    // falha permanente (o mesmo id, toda hora) precisa ficar visível aqui,
    // junto do total que deu certo, ou se perde atrás de warns isolados que
    // ninguém correlaciona de uma passada para a outra.
    logger.warn(
      { encontrados: ids.length, apagados, falhas: falhas.length, providerIds: falhas },
      "demo: limpeza terminou com sandbox(es) pendente(s) — se repetir a cada hora, e falha permanente",
    );
  } else if (ids.length > 0) {
    logger.info({ apagados }, "demo: limpeza removeu os sandboxes expirados");
  }

  return { apagados };
}

/** Liga o timer de hora em hora. Chamar duas vezes é no-op — só o primeiro timer vale. */
export function iniciarLimpezaDaDemo(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (passada) return; // uma passada em voo nunca se sobrepõe a outra
    passada = limparSandboxesExpirados()
      .catch((err): { apagados: number } => {
        logger.error({ err }, "Falha na limpeza de sandboxes da demo");
        return { apagados: 0 };
      })
      .finally(() => {
        passada = null;
      });
  }, UMA_HORA_MS);
  timer.unref(); // não segura o desligamento do worker
}

/** Para o timer e espera a passada em voo terminar, se houver uma. */
export async function pararLimpezaDaDemo(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  await passada;
}
