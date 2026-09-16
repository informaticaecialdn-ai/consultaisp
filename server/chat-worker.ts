import "dotenv/config";
import { pool } from "./db";
import { logger } from "./logger";
import { storage } from "./storage";
import { executarPrimeirosContatos } from "./services/chat/chat-primeiro-contato.service";
import { executarFilaAutonomia } from "./services/chat/chat-autonomia.service";
import { autonomiaStorage } from "./storage/chat-autonomia.storage";
import { conectarPresencaDoChat } from "./services/chat/chat-worker-presenca";
import { listarCandidatosDoChat } from "./services/chat/chat-elegibilidade.service";
import { executarComunicacoes } from "./services/cobranca/comunicacao.service";
import { executarReforcosMulticanal } from "./services/chat/chat-multicanal.service";

/** Processo dedicado ao chat. Ensaio não chama transportes nem consome a fila. */
async function main() {
  const modo = process.argv.includes("--enviar") ? "envio" : "ensaio";
  const tabelas = await autonomiaStorage.tabelasExistem();
  if (!tabelas.ok) throw new Error("Aplique as migrações da API antes de iniciar o motor de atendimento");
  const presenca = await conectarPresencaDoChat(modo);
  let encerrando = false;
  const parar = () => { encerrando = true; };
  process.once("SIGTERM", parar);
  process.once("SIGINT", parar);
  logger.info({ modo }, "Motor de atendimento iniciado");
  let proximaAgenda = 0;
  try {
    while (!encerrando) {
      try {
        if (Date.now() >= proximaAgenda) {
          if (modo === "envio") { await executarPrimeirosContatos(); await executarComunicacoes(); await executarReforcosMulticanal(); }
          else {
            // Apenas organizações com automação ligada; não provisiona nenhuma.
            for (const intg of await storage.integracoesComContatoAutomatico()) {
              const previa = await listarCandidatosDoChat(intg.providerId);
              logger.info({ providerId: intg.providerId, candidatos: previa.cobranca.length, limitado: previa.limitado }, "Ensaio de leitura da fila; nenhum envio");
            }
          }
          proximaAgenda = Date.now() + 60_000;
        }
        if (!encerrando && modo === "envio") await executarFilaAutonomia();
        await presenca.pulsar();
      } catch {
        logger.warn("Rodada do motor não concluída; confira os diagnósticos do provedor e o diário de envios");
      }
      if (!encerrando) await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } finally {
    await presenca.encerrar();
    await pool.end();
  }
}
main().catch(() => { logger.error("Motor de atendimento não iniciou; confira banco, migrações e configuração local"); process.exitCode = 1; pool.end().catch(() => { process.exitCode = 1; }); });
