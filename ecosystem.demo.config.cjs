/**
 * PM2 ecosystem — par de processos da INSTÂNCIA DE DEMONSTRAÇÃO.
 *
 * Espelha ecosystem.config.cjs (produção) com quatro diferenças, de propósito:
 *   1. Lê ".env.demo", não ".env" — sem o path explícito o pm2 leria o .env de
 *      produção e a demo subiria apontando para o banco real, exatamente o que
 *      a instância separada existe para impedir (docs/superpowers/specs/
 *      2026-09-11-demo-sandbox-design.md §3.1).
 *   2. Nomes de processo com sufixo "-demo", para nunca colidir com o par de
 *      produção no mesmo `pm2 list`/`pm2 save`.
 *   3. Arquivos de log com o mesmo sufixo.
 *   4. Teto de memória do worker em 512M, não 4G — o worker da demo só roda a
 *      limpeza de sandbox (server/demo/limpeza.service.ts) e a régua diária de
 *      cobrança; ele nunca carrega o índice de geocodificação do CNEFE, que é
 *      o que obriga o worker de produção a ter 4G (ver o comentário sobre isso
 *      em ecosystem.config.cjs). É a mitigação do risco #3 do design doc
 *      ("custo de um segundo par de processos na mesma VPS").
 *
 * O resto — exec_mode, kill_timeout, o padrão de env, os nomes dos arquivos de
 * script — é IDÊNTICO ao de produção. Mesmo binário, mesmo comportamento de
 * shutdown; só muda onde ele lê config e o teto de memória do worker.
 *
 * Deploy inicial e deploys seguintes: ver docs/demo-instancia-2026-09-12.md.
 * Reversão: `pm2 delete consulta-isp-demo consulta-isp-demo-worker`. Produção
 * não é tocada em nenhum passo — outro banco, outro processo, outro domínio.
 */

// O par da demo lê o .env DELA. Sem o path explicito o pm2 leria o .env de
// producao e a demo subiria apontando para o banco real — exatamente o que
// a instancia separada existe para impedir.
const dotenv = require("dotenv");
const env = dotenv.config({ path: ".env.demo" }).parsed || {};

module.exports = {
  apps: [
    {
      name: "consulta-isp-demo",
      script: "dist/index.cjs",
      exec_mode: "fork",
      max_memory_restart: "512M",
      // pm2 manda SIGKILL 1600ms depois do SIGTERM por padrao — curto demais
      // para qualquer encerramento ordenado (mesmo motivo do par de producao).
      kill_timeout: 35000,
      env: { ...env, NODE_ENV: "production" },
      error_file: "/root/.pm2/logs/consulta-isp-demo-error.log",
      out_file: "/root/.pm2/logs/consulta-isp-demo-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "consulta-isp-demo-worker",
      script: "dist/worker.cjs",
      exec_mode: "fork",
      // 512M, nao 4G: o worker da demo so roda a limpeza de sandbox e a regua
      // diaria de cobranca. Ele nao carrega o indice de geocodificacao do
      // CNEFE, que e o que obriga o worker de producao a ter 4G.
      max_memory_restart: "512M",
      // O worker drena trabalho em voo por ate 30s antes de fechar o pool
      // (server/worker.ts) — mesmo motivo do kill_timeout de producao.
      kill_timeout: 35000,
      // Restart com delay pra nao martelar em caso de crash loop.
      restart_delay: 10000,
      min_uptime: "60s",
      max_restarts: 5,
      env: { ...env, NODE_ENV: "production" },
      error_file: "/root/.pm2/logs/consulta-isp-demo-worker-error.log",
      out_file: "/root/.pm2/logs/consulta-isp-demo-worker-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
