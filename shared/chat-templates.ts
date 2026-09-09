import { TemplateDeAberturaSchema, type TemplateDatafy, type TemplateDeAbertura } from "./chat-whatsapp";

type NomesDaAbertura = { nomeCliente: string; nomeProvedor: string };
const normalizar = (v: string) => v.normalize("NFKC").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, "").replace(/\s+/g, " ").trim();
const assuntoRestrito = /\b(divida|saldo|fatura|boleto|pix|pagamento|cobranca|contrato|cpf|cnpj|documento|senha|bancario|vencid|pendencia|debito|reais|real)\w*/i;
const semAcentos = (v: string) => v.normalize("NFD").replace(/\p{M}/gu, "");
export function nomesSegurosDaAbertura(contexto: NomesDaAbertura): NomesDaAbertura {
  const primeiro = normalizar(contexto.nomeCliente ?? "").split(" ")[0];
  const provedor = normalizar(contexto.nomeProvedor ?? "");
  return {
    nomeCliente: /^[\p{L}\p{M}'’-]{1,40}$/u.test(primeiro) && !assuntoRestrito.test(semAcentos(primeiro)) ? primeiro : "você",
    nomeProvedor: /^[\p{L}\p{M}\d &.'’-]{1,80}$/u.test(provedor) && !/\d{5}|\.[\p{L}]{2,}/u.test(provedor) && !assuntoRestrito.test(semAcentos(provedor)) ? provedor : "seu provedor",
  };
}

/** Abertura não depende do modelo nem de orientações que possam conter valores. */
export function textoDeAberturaControlada(contexto: NomesDaAbertura): string {
  const nomes = nomesSegurosDaAbertura(contexto);
  return `Olá, sou o assistente virtual de ${nomes.nomeProvedor}. Posso falar com ${nomes.nomeCliente}?`;
}

// Vocabulário fechado de saudação/identificação. Provedor e primeiro nome entram
// apenas como parâmetros: aprovação da Meta não autoriza expor dívida ao contato.
const PALAVRAS_DA_ABERTURA = new Set("ola oi bom boa dia tarde noite aqui e sou somos o a os as um uma assistente virtual de da do seu sua provedor atendimento atendente tudo bem posso podemos falar fala com voce confirmar se este contato pertence ao por favor obrigado obrigada sim nao continuar encerrar eu estou esta nome pessoa indicada ou deseja conversar conosco".split(" "));
export function textoNeutroAntesDaIdentificacao(texto: string, contexto?: NomesDaAbertura): boolean {
  let corpo = normalizar(texto);
  if (!corpo || corpo.length > 1000) return false;
  if (contexto) for (const nome of Object.values(nomesSegurosDaAbertura(contexto))) {
    const literal = nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    corpo = corpo.replace(new RegExp(`(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`, "giu"), " ");
  }
  corpo = corpo.replace(/{{[1-9]\d*}}/g, " ");
  if (/[^\p{L}\p{M}\s.!?,;:()’'-]/u.test(corpo)) return false;
  const portugues = semAcentos(corpo).toLowerCase();
  if (/[^a-z\s.!?,;:()’'-]/.test(portugues)) return false;
  return (portugues.match(/[a-z]+/g) ?? []).every(p => PALAVRAS_DA_ABERTURA.has(p));
}
const MOTIVO_ABERTURA = "Antes da identificação, use apenas saudação, nome e identificação do provedor; dados financeiros, documentos e links não são permitidos";

/** Abertura suporta texto com parâmetros posicionais no corpo e botões estáticos. */
export function analisarTemplateDeAbertura(template: TemplateDatafy, exigirTextoNeutro = true): { compativel: boolean; motivo: string | null; texto: string; variaveis: number } {
  const body = template.components.find(c => c.type === "BODY");
  const texto = typeof body?.text === "string" ? body.text : "";
  const campos = [...texto.matchAll(/{{(.*?)}}/g)].map(m => m[1]);
  const numeros = [...new Set(campos.map(Number))].sort((a, b) => a - b);
  const foraDosParametros = texto.replace(/{{[1-9]\d*}}/g, "");
  let motivo: string | null = null;
  if (template.status !== "APPROVED") motivo = "O template ainda não está aprovado";
  else if (!texto || template.components.filter(c => c.type === "BODY").length !== 1) motivo = "O template precisa de um corpo de texto";
  else if (foraDosParametros.includes("{{") || foraDosParametros.includes("}}") || campos.some(c => !/^[1-9]\d*$/.test(c)) || numeros.some((n, i) => n !== i + 1) || numeros.length > 10) motivo = "Use parâmetros posicionais consecutivos, como {{1}} e {{2}}";
  else if (exigirTextoNeutro && !textoNeutroAntesDaIdentificacao(texto)) motivo = MOTIVO_ABERTURA;
  else for (const componente of template.components) {
    if (componente.type === "BODY") continue;
    if (componente.type === "HEADER" && componente.format !== "TEXT") { motivo = "Cabeçalhos de mídia precisam de envio específico"; break; }
    if (!["HEADER", "FOOTER", "BUTTONS"].includes(String(componente.type)) || JSON.stringify(componente).includes("{{")) { motivo = "Use cabeçalho e botões sem parâmetros dinâmicos"; break; }
    if (exigirTextoNeutro && ["HEADER", "FOOTER"].includes(String(componente.type)) && (typeof componente.text !== "string" || !textoNeutroAntesDaIdentificacao(componente.text))) { motivo = MOTIVO_ABERTURA; break; }
    if (componente.type === "BUTTONS" && (!Array.isArray(componente.buttons) || componente.buttons.some((b: unknown) => {
      if (!b || typeof b !== "object") return true;
      const botao = b as Record<string, unknown>;
      if (!exigirTextoNeutro) return !["URL", "PHONE_NUMBER", "QUICK_REPLY"].includes(String(botao.type));
      return botao.type !== "QUICK_REPLY" || typeof botao.text !== "string" || !textoNeutroAntesDaIdentificacao(botao.text) || "url" in botao || "phone_number" in botao;
    }))) { motivo = "Na abertura use somente respostas rápidas neutras, sem links ou números de telefone"; break; }
  }
  return { compativel: motivo === null, motivo, texto, variaveis: numeros.length };
}

export function montarTemplateDeAbertura(template: TemplateDatafy, config: TemplateDeAbertura, contexto: { nomeCliente: string; nomeProvedor: string }, exigirTextoNeutro = true) {
  const validacao = TemplateDeAberturaSchema.safeParse(config);
  if (!validacao.success) throw new Error("As variáveis da configuração do template são inválidas");
  config = validacao.data;
  const analise = analisarTemplateDeAbertura(template, exigirTextoNeutro);
  if (!analise.compativel || template.name !== config.nome || template.language !== config.idioma || analise.variaveis !== config.variaveis.length) throw new Error(analise.motivo || "As variáveis não correspondem ao template aprovado");
  if (config.variaveis.some(v => typeof contexto?.[v] !== "string" || !contexto[v].trim())) throw new Error("Informe o nome do cliente e do provedor para este template");
  const nomes = exigirTextoNeutro ? nomesSegurosDaAbertura(contexto) : { nomeCliente: normalizar(contexto.nomeCliente).slice(0, 160), nomeProvedor: normalizar(contexto.nomeProvedor).slice(0, 160) };
  const parameters = config.variaveis.map(v => ({ type: "text", text: nomes[v] }));
  if (parameters.some(p => !p.text)) throw new Error("Informe o nome do cliente e do provedor para este template");
  return { name: config.nome, language: { code: config.idioma }, ...(parameters.length ? { components: [{ type: "body", parameters }] } : {}) };
}
