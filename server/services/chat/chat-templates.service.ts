import { CatalogoTemplatesDatafySchema, TemplatesDeAberturaSchema, type TemplatesDeAbertura } from "@shared/chat-whatsapp";
import { analisarTemplateDeAbertura, montarTemplateDeAbertura } from "@shared/chat-templates";
import type { TipoDeAgente } from "@shared/chat-agentes";
import { storage } from "../../storage";
import { clienteDoChat, ErroDaPonteDoChat } from "./chat-ponte.service";
import { comTravaDaConfiguracaoDoChat } from "./chat-agentes.service";

export function provedorWhatsapp(config: unknown): "ZAPPFY" | "UAZAPI" | "DATAFY" {
  const p = (config as { whatsapp?: { provider?: string } } | null)?.whatsapp?.provider;
  return p === "DATAFY" || p === "UAZAPI" ? p : "ZAPPFY";
}
async function lerCatalogoTemplatesWhatsapp(providerId: number) {
  const i = await storage.getIntegracaoDoChat(providerId);
  if (!i?.canalId || i.providerId !== providerId || provedorWhatsapp(i.agenteConfig) !== "DATAFY") throw new ErroDaPonteDoChat("SEM_CANAL", "Conecte um canal Datafy para consultar os templates");
  const c = clienteDoChat();
  if (!c) throw new ErroDaPonteDoChat("CHAT_DESLIGADO", "O serviço do chat não está configurado");
  const remoto = await c.listarTemplatesWhatsapp(i.organizationId, i.canalId).catch(() => {
    throw new ErroDaPonteDoChat("CHAT_FALHOU", "Não foi possível consultar os templates da Datafy. Confira a conexão do canal.");
  });
  if (!remoto.ok) throw new ErroDaPonteDoChat("CHAT_FALHOU", "Não foi possível consultar os templates da Datafy. Confira a conexão do canal.");
  const catalogo = CatalogoTemplatesDatafySchema.safeParse(remoto.valor);
  if (!catalogo.success) throw new ErroDaPonteDoChat("CHAT_FALHOU", "O catálogo de templates retornado é inválido");
  const config = TemplatesDeAberturaSchema.safeParse({ templates: (i.agenteConfig as { templatesDatafy?: unknown } | null)?.templatesDatafy ?? {} });
  return { data: catalogo.data.data, templates: config.success ? config.data.templates : {}, organizationId: i.organizationId, canalId: i.canalId };
}
export async function catalogoTemplatesWhatsapp(providerId: number) {
  const catalogo = await lerCatalogoTemplatesWhatsapp(providerId);
  return { data: catalogo.data, templates: catalogo.templates };
}
export async function salvarTemplatesWhatsapp(providerId: number, templates: TemplatesDeAbertura) {
  const parsed = TemplatesDeAberturaSchema.safeParse({ templates });
  if (!parsed.success) throw new ErroDaPonteDoChat("CONFLITO", "Informe templates e variáveis válidos para as carteiras de atendimento");
  templates = parsed.data.templates;
  return comTravaDaConfiguracaoDoChat(providerId, async () => {
    const catalogo = await lerCatalogoTemplatesWhatsapp(providerId);
    for (const config of Object.values(templates)) {
      const template = catalogo.data.find(t => t.name === config.nome && t.language === config.idioma);
      if (!template) throw new ErroDaPonteDoChat("CONFLITO", "Selecione um template do catálogo atual");
      const a = analisarTemplateDeAbertura(template);
      if (!a.compativel || a.variaveis !== config.variaveis.length) throw new ErroDaPonteDoChat("CONFLITO", a.motivo || "Associe cada variável do template a um dado do cliente ou provedor");
    }
    const i = await storage.getIntegracaoDoChat(providerId);
    if (!i || i.providerId !== providerId || i.organizationId !== catalogo.organizationId || i.canalId !== catalogo.canalId || provedorWhatsapp(i.agenteConfig) !== "DATAFY") throw new ErroDaPonteDoChat("CONFLITO", "O canal mudou durante a consulta. Atualize o catálogo e tente novamente.");
    await storage.guardarAgenteDoChat(providerId, { agenteConfig: { ...(i.agenteConfig as Record<string, unknown> ?? {}), templatesDatafy: templates } });
    return { templates };
  });
}
export async function prepararTemplateWhatsapp(providerId: number, tipo: TipoDeAgente, contexto: { nomeCliente: string; nomeProvedor: string }, escopo?: { organizationId: string; canalId: string }) {
  const catalogo = await lerCatalogoTemplatesWhatsapp(providerId);
  if (escopo && (escopo.organizationId !== catalogo.organizationId || escopo.canalId !== catalogo.canalId)) throw new ErroDaPonteDoChat("CONFLITO", "O canal mudou antes da preparação. Atualize a configuração e tente novamente.");
  const config = catalogo.templates[tipo];
  const template = config && catalogo.data.find(t => t.name === config.nome && t.language === config.idioma);
  if (!config || !template) throw new ErroDaPonteDoChat("CONFLITO", "Configure o template Datafy desta carteira no Painel do Provedor");
  try { return montarTemplateDeAbertura(template, config, contexto); }
  catch (e) { throw new ErroDaPonteDoChat("CONFLITO", e instanceof Error ? e.message : "Template incompatível"); }
}
