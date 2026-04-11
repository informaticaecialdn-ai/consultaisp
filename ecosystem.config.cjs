/**
 * PM2 ecosystem — 2 processos separados:
 * - consulta-isp: HTTP server (Express), mantem baixa latencia, pouco uso de memoria
 * - consulta-isp-worker: ERP sync + LGPD background jobs, pode consumir mais CPU/memoria
 *
 * Vantagens:
 * - Crash do sync nao derruba API
 * - Restart do API nao interrompe sync em andamento
 * - Logs separados em /root/.pm2/logs/{name}-out.log e -error.log
 *
 * Deploy na VPS:
 *   cd /var/www/consulta-isp && git pull && npm run build
 *   pm2 delete consulta-isp 2>/dev/null
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 */

// Carrega .env e injeta nos dois processos (mesmo pattern do ecosystem antigo).
const dotenv = require("dotenv");
const env = dotenv.config().parsed || {};

module.exports = {
  apps: [
    {
      name: "consulta-isp",
      script: "dist/index.cjs",
      exec_mode: "fork",
      max_memory_restart: "512M",
      env: { ...env, NODE_ENV: "production" },
      error_file: "/root/.pm2/logs/consulta-isp-error.log",
      out_file: "/root/.pm2/logs/consulta-isp-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "consulta-isp-worker",
      script: "dist/worker.cjs",
      exec_mode: "fork",
      max_memory_restart: "1G",
      // Restart com delay pra nao martelar ERPs em caso de crash loop
      restart_delay: 10000,
      min_uptime: "60s",
      max_restarts: 5,
      env: { ...env, NODE_ENV: "production" },
      error_file: "/root/.pm2/logs/consulta-isp-worker-error.log",
      out_file: "/root/.pm2/logs/consulta-isp-worker-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
