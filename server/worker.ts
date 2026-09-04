/**
 * ERP Sync Worker — processo separado do HTTP server.
 *
 * Isola o sync do ERP para que:
 * - Crashes do sync nao derrubem a API
 * - Crashes da API nao interrompam sync em andamento
 * - Sync possa ser reiniciado independentemente
 * - Latencia da API nao seja afetada pelo sync pesado
 *
 * Executa o scheduler do ERP sync + LGPD retention/titular e a cadeia do mapa
 * — cobertura da base de enderecos e, atras dela, a plotagem (tambem background
 * jobs).
 */

import "dotenv/config";
import { preferirIPv4NaSaida } from "./rede-saida";

// O worker e QUEM FALA COM OS ERPs nas varreduras agendadas. Sem isto ele sai
// por IPv6 e um provedor que liberou nosso IPv4 recebe 403 de madrugada, com o
// corte automatico por tres falhas seguidas em cima. Ver rede-saida.ts.
preferirIPv4NaSaida();
import { validateEnv } from "./env";
import { pool } from "./db";
import { logger } from "./logger";

const esperar = (ms: number) => new Promise<void>(resolve => {
  const t = setTimeout(resolve, ms);
  // Sem `unref`, esta espera de 30 minutos seguraria o desligamento do worker.
  t.unref?.();
});

/**
 * A cadeia do mapa: primeiro a BASE de endereços, depois a PLOTAGEM.
 *
 * A ordem é a correção medida na Amplinet em 04/09/2026. A tela dizia "184
 * clientes esperam plotagem · carteira sem geocodificação", e a causa não era o
 * plotador: a base do IBGE carregada no servidor cobria 9 municípios do Paraná,
 * a região de outro provedor. Plotar antes de ter a base é gastar Nominatim —
 * uma consulta por segundo, e sem número de casa — para fazer pior o que a base
 * local faz melhor, e ainda deixar o cliente fora do mapa.
 *
 * A espera tem teto. Uma cidade que falhe já não derruba a passada (o serviço
 * trata cidade a cidade), mas um FTP do IBGE lento poderia segurar a plotagem
 * por horas; passado o teto, a plotagem sai e a carga continua ao fundo. As
 * duas têm travas próprias e distintas, então correr juntas é seguro.
 */
async function iniciarCadeiaDoMapa(): Promise<void> {
  try {
    const {
      rodarCargaDeCobertura, iniciarAgendaDeCobertura,
      ESPERA_MAXIMA_DA_PRIMEIRA_PASSADA_MS,
    } = await import("./services/cobertura-geo-agenda.service");

    logger.info("[Worker] Cobertura geo: medindo a carteira e carregando o que falta");
    // O `catch` não é decorativo: a passada não lança, mas a partir do Node 15
    // uma rejeição sem dono DERRUBA o processo, e este ramo continua correndo
    // sozinho quando o `Promise.race` abaixo sai pelo teto de espera.
    const primeira = rodarCargaDeCobertura()
      .then(e => {
        logger.info(
          { faltavam: e.faltavam, carregadas: e.carregadas, falhas: e.falhas },
          "[Worker] Cobertura geo: primeira passada terminou",
        );
      })
      .catch(err => logger.warn({ err }, "[Worker] Cobertura geo: primeira passada falhou"));
    await Promise.race([primeira, esperar(ESPERA_MAXIMA_DA_PRIMEIRA_PASSADA_MS)]);

    iniciarAgendaDeCobertura();
    logger.info("[Worker] Cobertura geo scheduler started");
  } catch (err) {
    // A cobertura falhando NÃO pode impedir a plotagem: sem base o plotador
    // ainda resolve pela rede, só que pior. Ficar sem plotar é o defeito maior.
    logger.warn({ err }, "[Worker] Cobertura geo failed to start");
  }

  try {
    const { startGeocodeBackfill } = await import("./services/geocode-backfill.service");
    startGeocodeBackfill();
    logger.info("[Worker] Geocode backfill scheduler started");
  } catch (err) {
    logger.warn({ err }, "[Worker] Geocode backfill failed to start");
  }
}

(async () => {
  validateEnv();
  logger.info("[Worker] ERP sync worker starting");

  try {
    const { startErpSyncScheduler } = await import("./services/erp-sync.service");
    startErpSyncScheduler();
    logger.info("[Worker] ERP sync scheduler started");
  } catch (err) {
    logger.error({ err }, "[Worker] ERP sync scheduler failed to start");
    process.exit(1);
  }

  try {
    const { startRetentionScheduler } = await import("./services/lgpd-retention");
    startRetentionScheduler();
    logger.info("[Worker] LGPD retention scheduler started");
  } catch (err) {
    logger.warn({ err }, "[Worker] LGPD retention scheduler failed to start");
  }

  try {
    const { startTitularProcessor } = await import("./services/lgpd-titular.service");
    startTitularProcessor();
    logger.info("[Worker] LGPD titular processor started");
  } catch (err) {
    logger.warn({ err }, "[Worker] LGPD titular processor failed to start");
  }

  /**
   * Espera o sync em voo antes de fechar o pool.
   *
   * Sem isto o restart do pm2 fechava a conexao no meio da varredura e o log
   * enchia de "Erro ao upsert <cpf>: Cannot use a pool after calling end on the
   * pool" — cada linha um cliente cuja atualizacao foi perdida. Como cada
   * restart tambem disparava um sync novo, a janela para isso acontecer era
   * grande. Trinta segundos cobre o upsert corrente com folga; passar disso, o
   * sync e abandonado de proposito, porque segurar o desligamento indefinidamente
   * faria o pm2 matar o processo do mesmo jeito, so que mais tarde.
   */
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "[Worker] Shutdown signal received");
    try {
      const { isSyncing } = await import("./services/erp-sync.service");
      const limite = Date.now() + 30_000;
      if (isSyncing()) logger.info("[Worker] Sync em andamento — aguardando ate 30s");
      while (isSyncing() && Date.now() < limite) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (isSyncing()) logger.warn("[Worker] Sync ainda rodando apos 30s — encerrando mesmo assim");
    } catch (err) {
      logger.warn({ err }, "[Worker] Nao consegui verificar o sync em andamento");
    }

    /**
     * A carga da base de enderecos tambem e drenada — e por um motivo que nao
     * e "ficar bonito no log".
     *
     * `carregarCnefeDoConteudo` grava em DUAS transacoes: primeiro os bairros
     * em `geo_hps_bairro`, depois os milhoes de enderecos em `geo_endereco`.
     * Morto entre os dois commits, o municipio ficava marcado como coberto e
     * vazio, some da lista do que falta e nunca mais e tentado. O deploy manual
     * do pm2 e um `delete/start`, entao a janela aparece em todo deploy.
     *
     * Trinta segundos NAO cobrem Sao Paulo capital — cobrem a cidade media, que
     * e a maioria. A garantia de verdade e outra e esta do lado da leitura:
     * `municipiosComBase` so considera coberto quem tem endereco em
     * `geo_endereco`, entao uma carga pela metade volta sozinha para a fila.
     */
    try {
      const { estadoDaCobertura } = await import("./services/cobertura-geo-agenda.service");
      const limite = Date.now() + 30_000;
      if (estadoDaCobertura().emAndamento) {
        logger.info("[Worker] Carga de base de enderecos em andamento — aguardando ate 30s");
      }
      while (estadoDaCobertura().emAndamento && Date.now() < limite) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (estadoDaCobertura().emAndamento) {
        logger.warn("[Worker] Carga de base ainda rodando apos 30s — a cidade incompleta volta a fila na proxima passada");
      }
    } catch (err) {
      logger.warn({ err }, "[Worker] Nao consegui verificar a carga de base em andamento");
    }
    // `pool.end()` espera TODO cliente ser devolvido, e a varredura em voo
    // segura um: a trava do sync e um advisory lock preso a uma conexao, que
    // so e liberada no `finally`. Depois dos 30s de dreno, esperar por ela
    // indefinidamente entrega o desligamento ao SIGKILL do pm2 — que fecha o
    // socket do mesmo jeito, so que sem log e sem ordem.
    await Promise.race([
      pool.end().catch(() => {}),
      new Promise(r => setTimeout(r, 3_000)),
    ]);
    logger.info("[Worker] Database pool closed");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  /**
   * Solta, e DEPOIS dos handlers de sinal.
   *
   * A primeira passada de cobertura espera o download do IBGE e pode levar
   * minutos; com um `await` aqui em cima, o worker passaria esses minutos sem
   * `SIGTERM` registrado, e um restart do pm2 no meio da carga cairia no
   * encerramento bruto — sem o dreno do sync que o `shutdown` faz logo acima.
   */
  iniciarCadeiaDoMapa().catch(err =>
    logger.warn({ err }, "[Worker] Cadeia do mapa falhou ao iniciar"));

  logger.info("[Worker] Ready — background jobs running");
})();
