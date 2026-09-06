/**
 * O que a instalação do Chat BullQ deste ambiente aceita, e o que falta para
 * um provedor ligar um número de WhatsApp.
 *
 *   npx tsx script/diagnostico-chat.ts <providerId>
 *   ex.: npx tsx script/diagnostico-chat.ts 1
 *
 * Por que existe: em 06/09/2026 a homologação do WhatsApp na conta do NsLink
 * parou duas vezes por falta desta leitura. Primeiro porque o fork da VPS não
 * tinha o patch de provedores (`GET /channels/capabilities` respondia 404 e
 * um token Uazapi acabaria no cliente do Zappfy); depois porque a chave da
 * OpenAI existia no `.env.api` com comprimento zero — o chat manual funciona
 * assim, o agente não. Nenhuma dessas duas coisas aparece na tela do
 * provedor; aparecem aqui.
 *
 * Só LEITURA: nada é criado, alterado ou enviado. Nenhum segredo é impresso.
 */
import "dotenv/config";
// Sai por IPv4 antes de qualquer rede, como a API e o worker (server/rede-saida.ts).
import { preferirIPv4NaSaida } from "../server/rede-saida";
preferirIPv4NaSaida();

import { clienteDoChat, estadoDaIntegracao } from "../server/services/chat/chat-ponte.service";
import { storage } from "../server/storage";

const SIM = "sim";
const NAO = "NAO";
const marca = (v: unknown) => (v === true ? SIM : v === false || v === undefined || v === null ? NAO : String(v));

(async () => {
  const providerId = Number(process.argv[2]);
  if (!Number.isInteger(providerId) || providerId <= 0) {
    console.error("uso: npx tsx script/diagnostico-chat.ts <providerId>");
    process.exit(1);
  }

  const cliente = clienteDoChat();
  if (!cliente) {
    console.error("O chat está desligado neste ambiente: falta CHAT_BULLQ_URL ou CHAT_BULLQ_PLATFORM_KEY no .env.");
    process.exit(2);
  }

  const provedor = await storage.getProvider(providerId);
  if (!provedor) {
    console.error(`provedor ${providerId} não existe`);
    process.exit(1);
  }
  console.log(`\n=== Chat BullQ — provedor ${providerId} (${provedor.tradeName || provedor.name}) ===\n`);

  const estado = await estadoDaIntegracao(providerId);
  console.log("A integração deste provedor");
  console.log(`  ligada no ambiente ......... ${marca(estado.ligado)}`);
  console.log(`  organização provisionada ... ${marca(estado.provisionado)}${estado.organizationId ? ` (${estado.organizationId})` : ""}`);
  console.log(`  número de WhatsApp ......... ${estado.canal ? `${estado.canal.nome ?? "sem nome"} · ${estado.canal.id}` : NAO}`);
  console.log(`  situação ................... ${estado.status ?? "—"}`);
  if (estado.ultimoErro) console.log(`  último erro ................ ${estado.ultimoErro}`);
  console.log(`  agente de cobrança ......... ${estado.agente ? `${estado.agente.nome ?? "sem nome"} · ${estado.agente.id}` : NAO}`);

  if (!estado.organizationId) {
    console.log("\nSem organização provisionada não dá para consultar o resto. Abra o Painel do Provedor › Chat e provisione.");
    process.exit(0);
  }

  const capacidades = await cliente.capacidadesDosCanais(estado.organizationId);
  console.log("\nO que ESTA instalação do Chat BullQ aceita");
  if (!capacidades.ok) {
    console.log(`  não foi possível consultar: ${capacidades.erro ?? "sem detalhe"}`);
    console.log("  (404 aqui = o fork está sem o patch 001 de provedores de WhatsApp — integrations/chat-bullq/patches)");
  } else {
    const c = capacidades.valor as Record<string, unknown>;
    console.log(`  WhatsApp não oficial (Zappfy/Uazapi) ... ${marca(c.whatsappUnofficial)}`);
    console.log(`  conectar por QR ....................... ${marca(c.instanceConnect)}`);
    console.log(`  ler o estado da instância ............. ${marca(c.instanceStatus)}`);
    for (const [chave, valor] of Object.entries(c)) {
      if (!["whatsappUnofficial", "instanceConnect", "instanceStatus"].includes(chave)) console.log(`  ${chave} ${".".repeat(Math.max(1, 38 - chave.length))} ${marca(valor)}`);
    }
  }

  const modelos = await cliente.listarModelosDePrimeiroContato(estado.organizationId).catch(() => null);
  console.log("\nModelos de IA que o Chat BullQ oferece");
  if (!modelos || !modelos.ok) {
    console.log("  não foi possível consultar (o agente não vai rodar até isso responder)");
  } else {
    const v = modelos.valor as { configured?: boolean; models?: Array<{ id?: string }> };
    console.log(`  credencial de IA configurada .......... ${marca(v.configured)}`);
    console.log(`  modelos ............................... ${v.models?.length ? v.models.map(m => m.id).join(", ") : "nenhum"}`);
    if (v.configured === false) console.log("  (falta OPENAI_API_KEY no .env.api do Chat BullQ — o chat manual funciona, o agente não)");
  }

  console.log("\nPara ligar um número, o provedor precisa de: instância pareada (token) + as capacidades acima em 'sim'.\n");
  process.exit(0);
})().catch(err => {
  console.error("diagnóstico falhou:", err instanceof Error ? err.message : err);
  process.exit(1);
});
