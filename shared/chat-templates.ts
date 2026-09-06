import { TemplateDeAberturaSchema, type TemplateDatafy, type TemplateDeAbertura } from "./chat-whatsapp";

/** Abertura suporta texto com parâmetros posicionais no corpo e botões estáticos. */
export function analisarTemplateDeAbertura(template: TemplateDatafy): { compativel: boolean; motivo: string | null; texto: string; variaveis: number } {
  const body = template.components.find(c => c.type === "BODY");
  const texto = typeof body?.text === "string" ? body.text : "";
  const campos = [...texto.matchAll(/{{(.*?)}}/g)].map(m => m[1]);
  const numeros = [...new Set(campos.map(Number))].sort((a, b) => a - b);
  const foraDosParametros = texto.replace(/{{[1-9]\d*}}/g, "");
  let motivo: string | null = null;
  if (template.status !== "APPROVED") motivo = "O template ainda não está aprovado";
  else if (!texto || template.components.filter(c => c.type === "BODY").length !== 1) motivo = "O template precisa de um corpo de texto";
  else if (foraDosParametros.includes("{{") || foraDosParametros.includes("}}") || campos.some(c => !/^[1-9]\d*$/.test(c)) || numeros.some((n, i) => n !== i + 1) || numeros.length > 10) motivo = "Use parâmetros posicionais consecutivos, como {{1}} e {{2}}";
  else for (const componente of template.components) {
    if (componente.type === "BODY") continue;
    if (componente.type === "HEADER" && componente.format !== "TEXT") { motivo = "Cabeçalhos de mídia precisam de envio específico"; break; }
    if (!["HEADER", "FOOTER", "BUTTONS"].includes(String(componente.type)) || JSON.stringify(componente).includes("{{")) { motivo = "Use cabeçalho e botões sem parâmetros dinâmicos"; break; }
    if (componente.type === "BUTTONS" && (!Array.isArray(componente.buttons) || componente.buttons.some((b: unknown) => !b || typeof b !== "object" || !["URL", "PHONE_NUMBER", "QUICK_REPLY"].includes(String((b as Record<string, unknown>).type))))) { motivo = "Este tipo de botão não é suportado na abertura"; break; }
  }
  return { compativel: motivo === null, motivo, texto, variaveis: numeros.length };
}

export function montarTemplateDeAbertura(template: TemplateDatafy, config: TemplateDeAbertura, contexto: { nomeCliente: string; nomeProvedor: string }) {
  const validacao = TemplateDeAberturaSchema.safeParse(config);
  if (!validacao.success) throw new Error("As variáveis da configuração do template são inválidas");
  config = validacao.data;
  const analise = analisarTemplateDeAbertura(template);
  if (!analise.compativel || template.name !== config.nome || template.language !== config.idioma || analise.variaveis !== config.variaveis.length) throw new Error(analise.motivo || "As variáveis não correspondem ao template aprovado");
  const parameters = config.variaveis.map(v => ({ type: "text", text: typeof contexto?.[v] === "string" ? contexto[v].replace(/[\r\n\t]+/g, " ").trim().slice(0, 160) : "" }));
  if (parameters.some(p => !p.text)) throw new Error("Informe o nome do cliente e do provedor para este template");
  return { name: config.nome, language: { code: config.idioma }, ...(parameters.length ? { components: [{ type: "body", parameters }] } : {}) };
}
