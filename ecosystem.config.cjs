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
 *
 *   # Dry run ANTES de qualquer delete (revisão de segurança 4): executa o
 *   # MESMO require que o pm2 faz para avaliar este arquivo, sem derrubar
 *   # nada. Se este arquivo ganhar um novo erro fatal no futuro (hoje só
 *   # DATABASE_URL ausente/vazio) e o `.env` de produção não satisfizer,
 *   # é aqui que isso aparece — ANTES do `pm2 delete` ter apagado o
 *   # processo que estava rodando.
 *   node -e "require('./ecosystem.config.cjs')" && echo BOOT-CONFIG-OK
 *
 *   pm2 delete consulta-isp 2>/dev/null
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * `pm2 save` não é opcional: nem `pm2 restart` nem `pm2 resurrect` releem
 * este arquivo. `resurrect` (o que roda no boot da VPS, via `pm2 startup`)
 * restaura a lista de processos e o ENV de que ela lembra do último `save` —
 * não reexecuta este `.cjs`. Sem `pm2 save` depois do `pm2 start` acima, um
 * reboot da VPS volta com o ambiente ANTIGO (ou nenhum), não com o
 * `DEMO_MODE: "false"` fixado logo abaixo.
 */

// O par de PRODUCAO le o .env DELE. Sem o path explicito, `dotenv.config()`
// resolve ".env" contra o CWD de quem chama `pm2 start` — nao contra este
// arquivo. Iniciado de qualquer diretorio que nao seja a raiz do repo (ou
// pelo daemon do pm2, que reusa o cwd do primeiro `pm2 start` da maquina),
// `.parsed` vem vazio e o antigo `|| {}` fazia este par herdar o env que o
// DAEMON do pm2 ja carregava em memoria — o mesmo defeito que
// `ecosystem.demo.config.cjs` corrigiu primeiro (revisao final de seguranca
// antes da demonstracao publica, item 4). Ali o risco era a demo herdar
// producao; aqui e o INVERSO e pior: se o daemon algum dia carregar o env da
// DEMO antes deste par subir, producao boota com `DEMO_MODE=true` —
// cadastro fechado, bureaus simulados, faixa de "dados ficticios" na tela de
// provedores pagantes, em silencio.
//
// Path ANCORADO em `__dirname`, e ausencia de `.env` e ERRO FATAL, nao um
// `{}` silencioso — mesma correcao, mesmo motivo.
const path = require("path");
const dotenv = require("dotenv");
const ENV_PATH = path.resolve(__dirname, ".env");
const resultadoDoEnv = dotenv.config({ path: ENV_PATH });
if (resultadoDoEnv.error) {
  throw new Error(
    `ecosystem.config.cjs: nao encontrei ${ENV_PATH} — a producao nao pode subir sem o .env dela ` +
    `(copie .env.example para .env e preencha). Erro original: ${resultadoDoEnv.error.message}`,
  );
}
const env = resultadoDoEnv.parsed;
// Revisao seguinte (item 4): um ".env" de ZERO BYTES (copia que parou pela
// metade, um ">" no lugar de um ">>") nao produz erro NENHUM do dotenv —
// `.parsed` vem `{}`, vazio mas "bem-sucedido" do ponto de vista dele, e o
// bloco acima nao pega isso. O processo subiria em silencio sem NENHUMA
// variavel de verdade, e so estouraria (se estourasse) na primeira tentativa
// de falar com o banco. DATABASE_URL e a prova mais direta de que o arquivo
// tem conteudo real: sem ela, nao ha producao para subir.
if (!env || !env.DATABASE_URL) {
  throw new Error(
    `ecosystem.config.cjs: ${ENV_PATH} existe mas nao tem DATABASE_URL (arquivo vazio ou corrompido?) — ` +
    `a producao nao pode subir sem banco configurado.`,
  );
}

module.exports = {
  apps: [
    {
      name: "consulta-isp",
      script: "dist/index.cjs",
      exec_mode: "fork",
      max_memory_restart: "512M",
      // pm2 manda SIGKILL 1600ms depois do SIGTERM por padrao — curto demais
      // para qualquer encerramento ordenado.
      kill_timeout: 35000,
      // `DEMO_MODE: "false"` primeiro, "...env" por cima (revisao seguinte,
      // item 3): `.env.example` nao lista DEMO_MODE, entao um `.env` de
      // producao tipico tambem nao a declara — e para QUALQUER chave que
      // `app.env` nao define, o pm2 cai para o ambiente do DAEMON (o processo
      // que rodou o primeiro `pm2 start` na maquina), nao para "ausente". Se
      // aquele ambiente um dia tiver DEMO_MODE=true (por exemplo, alguem
      // testando a demo no mesmo shell antes de subir producao), producao
      // herdaria isso em silencio — cadastro fechado, bureaus simulados, a
      // faixa de "dados ficticios" na tela de provedor pagante. O default
      // aqui fecha esse buraco sem depender de o `.env` nunca mencionar a
      // chave; se o `.env` mencionar (nunca deveria, em producao), `...env`
      // sobrescreve o default, porque `emModoDemo()` so aceita a string exata
      // "true" e essa precisao e o que vale preservar.
      env: { DEMO_MODE: "false", ...env, NODE_ENV: "production" },
      error_file: "/root/.pm2/logs/consulta-isp-error.log",
      out_file: "/root/.pm2/logs/consulta-isp-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "consulta-isp-worker",
      script: "dist/worker.cjs",
      exec_mode: "fork",
      /*
       * 4G, nao 1G. Medido em producao em 06/09/2026: o worker reiniciou 90
       * vezes seguidas, uma a cada ~8 minutos, sempre logo depois de
       * "Geocodificador local carregado" (6 municipios, 2.494.433 enderecos do
       * CNEFE) e do indice de logradouros da carteira. O pm2 mandava SIGINT ao
       * cruzar 1G e o backfill de geocodificacao NUNCA terminava — recomecava
       * do zero a cada ciclo, gastando CPU e rede sem plotar ninguem.
       * A VPS tem 32G, com 30G livres; 4G da folga para a base de enderecos e
       * ainda protege contra vazamento de verdade. Se o consumo passar disso, o
       * conserto e carregar o CNEFE sob demanda, nao subir o teto de novo.
       */
      max_memory_restart: "4G",
      // O worker drena o sync em voo por ate 30s antes de fechar o pool
      // (server/worker.ts). Sem esta linha o pm2 manda SIGKILL 1600ms depois do
      // SIGTERM e o dreno NUNCA transcorre: pool.end() nem chega a ser chamado
      // e as escritas em voo somem. Era o que produzia "Cannot use a pool after
      // calling end on the pool" no log — e o proprio dreno seria inerte.
      kill_timeout: 35000,
      // Restart com delay pra nao martelar ERPs em caso de crash loop
      restart_delay: 10000,
      min_uptime: "60s",
      max_restarts: 5,
      // Mesmo default explicito do app acima (item 3) — os dois processos
      // deste par precisam concordar sobre DEMO_MODE tanto quanto sobre
      // NODE_ENV; herdar do daemon por caminhos diferentes e como os dois
      // discordariam sem ninguem perceber.
      env: { DEMO_MODE: "false", ...env, NODE_ENV: "production" },
      error_file: "/root/.pm2/logs/consulta-isp-worker-error.log",
      out_file: "/root/.pm2/logs/consulta-isp-worker-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
