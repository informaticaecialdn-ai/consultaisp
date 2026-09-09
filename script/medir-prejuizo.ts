/**
 * Mede o card "Prejuízo acumulado" de um provedor — direto pela mesma soma
 * que a rota usa, sem sessão nem navegador.
 *
 *   npx tsx script/medir-prejuizo.ts <providerId> [periodo]
 *   ex.: npx tsx script/medir-prejuizo.ts 1 2026-T3
 *
 * Imprime, para as duas carteiras: devedores no período, avaliados, o
 * prejuízo somado, a dívida real do recorte, o balde "sem data" e os motivos
 * de quem ficou de fora. Por que existe: número que vai para a tela tem de
 * ser medido pela função que a tela usa, nunca estimado por SQL na mão.
 */
import "dotenv/config";
import { storage } from "../server/storage";
// A MESMA leitura da politica que a rota usa (validacao e defaults incluidos):
// medir com outra leitura seria medir outro numero.
import { carregarPolitica } from "../server/routes/cobranca.routes";
import { agregarPrejuizo } from "../shared/cobranca/prejuizo";
import { formatarPeriodo, parsePeriodo, periodoDaData, rotuloDoPeriodo } from "../shared/cobranca/periodo";

const providerId = Number(process.argv[2]);
const hoje = new Date();
const periodo = parsePeriodo(process.argv[3]) ?? periodoDaData(hoje, "mes");

(async () => {
  if (!Number.isInteger(providerId) || providerId <= 0) {
    console.error("uso: npx tsx script/medir-prejuizo.ts <providerId> [AAAA-MM|AAAA-Tn|AAAA-Sn|AAAA]");
    process.exit(1);
  }
  const { politica } = await carregarPolitica(providerId);
  const base = await storage.baseDeFaturas(providerId);
  console.log(`provedor ${providerId} · período ${formatarPeriodo(periodo)} (${rotuloDoPeriodo(periodo)}) · base de faturas: ${base.total} · custos confirmados: ${politica.economia.confirmado}`);

  for (const carteira of ["ativo", "ex_cliente"] as const) {
    const devedores = await storage.devedoresComVencimento(providerId, carteira, hoje);
    const mensalidades = await storage.mensalidadesDoProvedor(providerId, devedores.map(d => d.id));
    const r = agregarPrejuizo({ devedores, mensalidades, economia: politica.economia, hoje, periodo, carteira });
    const s = r.resumo;
    console.log(`\n[${carteira}] carteira: ${s.devedoresDaCarteira} devedores · R$ ${s.dividaDaCarteira.toFixed(2)} · sem data: ${s.semData.clientes} (R$ ${s.semData.divida.toFixed(2)})`);
    console.log(`  no período: ${s.devedores} devedores · dívida do recorte R$ ${s.dividaDoRecorte.toFixed(2)} (${s.fatiaDaCarteira ?? "—"}% da carteira)`);
    console.log(`  avaliados: ${s.avaliados} · no prejuízo: ${s.noPrejuizo} · prejuízo: ${s.prejuizo === null ? "—" : "R$ " + s.prejuizo.toFixed(2)} · dívida avaliada R$ ${s.dividaAvaliada.toFixed(2)} · instalação ${s.instalacaoNaoRecuperada === null ? "—" : "R$ " + s.instalacaoNaoRecuperada.toFixed(2)} · abatida R$ ${s.abatida.toFixed(2)}`);
    for (const m of s.motivosDoTraco) console.log(`  fora: ${m.clientes} · R$ ${m.divida.toFixed(2)} · ${m.motivo}`);
    console.log(`  série: ${r.serie.map(x => `${x.mes}=${x.devedores}${x.prejuizo === null ? "" : `/R$${x.prejuizo.toFixed(0)}`}`).join(" · ")}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
