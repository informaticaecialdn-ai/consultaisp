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
 *   4. Teto de memória do worker em 512M, não 4G — o worker da demo roda os
 *      MESMOS agendadores que produção (sync de ERP, retenção e titular LGPD,
 *      régua diária, reconciliação de confissão, chat), mais a limpeza de
 *      sandbox (server/demo/limpeza.service.ts), que só existe aqui. Nenhum
 *      deles pesa: o sync de ERP não escreve nada (o único ERP configurado na
 *      demo é a fonte "demo", que `ehFonteDeDemonstracao` já pula no caminho
 *      de escrita — server/services/erp-sync.service.ts:905), e os que
 *      dependem de credencial paga (chat, confissão) ficam inertes sem ela.
 *      O que de fato NÃO roda — e é o que sustenta o teto menor — é a cadeia
 *      do mapa (`iniciarCadeiaDoMapa`, server/worker.ts), desligada em
 *      `emModoDemo()`: ela é quem baixa e carrega o índice de geocodificação
 *      do CNEFE, o que obriga o worker de produção a ter 4G (ver o comentário
 *      em ecosystem.config.cjs). Sem essa cadeia, o worker da demo nunca
 *      carrega um dataset grande na memória — só agendadores leves. É a
 *      mitigação do risco #3 do design doc ("custo de um segundo par de
 *      processos na mesma VPS").
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
//
// O path e ANCORADO NESTE ARQUIVO (`__dirname`), nao no cwd do processo que
// roda `pm2 start` — revisao final de seguranca antes da demonstracao
// publica (item 6). `path: ".env.demo"` sozinho resolve contra o cwd de QUEM
// CHAMA; iniciado de qualquer diretorio que nao seja a raiz do repo, o
// dotenv nao encontra nada, `.parsed` fica vazio, e o `|| {}` de entao fazia
// o par da demo herdar o env que o DAEMON do pm2 carrega — que nesta maquina
// foi o de PRODUCAO. E por isso que agora e ERRO FATAL, e nao um `|| {}`
// silencioso: sem `.env.demo`, subir mesmo assim e o cenario que a instancia
// separada existe para impedir, entao o processo nem tenta.
const path = require("path");
const dotenv = require("dotenv");
const ENV_DEMO_PATH = path.resolve(__dirname, ".env.demo");
const resultadoDoEnv = dotenv.config({ path: ENV_DEMO_PATH });
if (resultadoDoEnv.error) {
  throw new Error(
    `ecosystem.demo.config.cjs: nao encontrei ${ENV_DEMO_PATH} — a demo nao pode subir sem o .env dela ` +
    `(copie .env.demo.example para .env.demo e preencha). Erro original: ${resultadoDoEnv.error.message}`,
  );
}
const env = resultadoDoEnv.parsed;

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
      // 512M, nao 4G: o worker da demo roda os MESMOS agendadores que
      // producao (sync de ERP — que aqui nao escreve nada, so encontra a
      // fonte "demo" — retencao/titular LGPD, regua, confissao, chat), mais a
      // limpeza de sandbox, que so existe aqui. O que fica de fora — e o que
      // sustenta o teto menor — e iniciarCadeiaDoMapa() (server/worker.ts):
      // ela baixa o indice do CNEFE e obriga producao a 4G, e fica desligada
      // em emModoDemo().
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
