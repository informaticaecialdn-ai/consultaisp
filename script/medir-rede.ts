/**
 * Mede o que o modo Rede da Localização vai mostrar a um provedor — direto
 * pelo serviço, sem sessão nem navegador.
 *
 *   npx tsx script/medir-rede.ts <providerId>
 *   ex.: npx tsx script/medir-rede.ts 1
 *
 * Imprime, por cidade da área declarada, o que `GET /api/localizacao/rede`
 * devolveria (ocorrências visíveis, abaixo do piso, do próprio provedor e
 * bairros sem caso dele) e o que da carteira dele a rede não cobre.
 *
 * Por que existe: os cards do modo Rede nasceram (09/09/2026) com números que
 * o SQL cru não reproduz — o agrupador de grafias junta "Jd. X" com "JARDIM X"
 * e o piso de 3 é aplicado depois disso. Número que vai para a tela tem de
 * ser medido pela MESMA função que a tela usa, não estimado.
 */
import "dotenv/config";
import { resolverAreaAtendida } from "../server/services/area-atendida";
import { bairrosDaRede } from "../server/services/rede-regional.service";

const providerId = Number(process.argv[2]);

(async () => {
  if (!Number.isInteger(providerId) || providerId <= 0) {
    console.error("uso: npx tsx script/medir-rede.ts <providerId>");
    process.exit(1);
  }
  const area = await resolverAreaAtendida(providerId);
  const cidades = area.cidades ?? [];
  console.log(`provedor ${providerId} · área: ${area.origem} · ${cidades.length} cidades`);
  if (cidades.length === 0) { console.log("sem área declarada — a rota responde semArea"); process.exit(0); }

  const r = await bairrosDaRede(cidades, providerId);
  const total = r.cidades.reduce((s, c) => s + c.ocorrencias + c.ocultas, 0);
  const seus = r.cidades.reduce((s, c) => s + c.doObservador, 0);
  console.log(`\nrede: ${total} ocorrências · ${r.bairros.length} bairros visíveis somam ${r.bairros.reduce((s, b) => s + b.ocorrencias, 0)} · ${r.ocultas} abaixo do piso · ${r.pontos.length} pontos · ${r.semPonto} sem ponto`);
  console.log(`seus na área: ${seus} · de outros: ${total - seus}`);
  console.log(`bairros sem caso seu: ${r.cidades.reduce((s, c) => s + c.bairrosSemObservador, 0)} de ${r.bairros.length}`);
  console.log(`cidades com caso: ${r.cidades.filter(c => c.ocorrencias + c.ocultas > 0).length} de ${r.cidades.length}`);
  console.log(`fora da área (seus): ${r.observador.foraDaArea}`, r.observador.cidadesForaDaArea);
  console.log("\npor cidade (só as com caso):");
  for (const c of r.cidades.filter(c => c.ocorrencias + c.ocultas > 0)) console.log("  ", c);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
