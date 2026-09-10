/**
 * Um numero por provedor no Chat BullQ: remove no fork todo canal de WhatsApp
 * da organizacao do provedor que nao seja o canal atual da integracao.
 *
 *   npx tsx script/limpar-canais-do-chat.ts <providerId>
 *
 * Por que existe: ate 09/09/2026 cada "salvar canal" criava um canal novo no
 * fork e deixava o anterior vivo com o mesmo token. O fork entrega a mensagem
 * recebida ao PRIMEIRO canal ativo cujo token bate — a conversa caia no canal
 * que a ponte nao acompanha (NsLink: cinco canais). O salvar agora limpa os
 * antigos sozinho; este script faz a limpeza de quem ja estava assim.
 */
import "dotenv/config";
import { storage } from "../server/storage";
import { clienteDoChat, removerCanaisAntigosDeWhatsapp } from "../server/services/chat/chat-ponte.service";

const providerId = Number(process.argv[2]);
(async () => {
  if (!Number.isInteger(providerId) || providerId <= 0) { console.error("uso: npx tsx script/limpar-canais-do-chat.ts <providerId>"); process.exit(1); }
  const cliente = clienteDoChat();
  if (!cliente) { console.error("CHAT_BULLQ_URL/CHAT_BULLQ_PLATFORM_KEY ausentes: o chat esta desligado"); process.exit(1); }
  const intg = await storage.getIntegracaoDoChat(providerId);
  if (!intg?.organizationId || !intg.canalId) { console.error("provedor sem organizacao ou sem canal atual na integracao"); process.exit(1); }
  const antes = await cliente.listarCanais(intg.organizationId);
  if (!antes.ok) { console.error("nao foi possivel listar os canais:", antes.erro); process.exit(1); }
  console.log(`organizacao ${intg.organizationId} · canal atual ${intg.canalId} · ${antes.valor.length} canal(is) antes`);
  for (const c of antes.valor) console.log(`  ${c.id === intg.canalId ? "*" : " "} ${c.id} ${c.type} "${c.name}" ${c.isActive ? "ativo" : "inativo"}`);
  const r = await removerCanaisAntigosDeWhatsapp(cliente, providerId, intg.organizationId, intg.canalId);
  console.log(`>>> removidos ${r.removidos} · falhas ${r.falhas}`);
  process.exit(r.falhas > 0 ? 2 : 0);
})().catch(e => { console.error(">>> falhou:", e?.message ?? e); process.exit(1); });
