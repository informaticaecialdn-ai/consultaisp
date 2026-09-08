/**
 * O console de agentes no client — endereços e utilitários de uma linha.
 *
 * Tudo bate em `/api/chat-bullq/console/*`, que resolve a organização do Chat
 * BullQ pelo provedor da sessão. O client nunca manda organização nem token.
 */
import { queryClient } from "@/lib/queryClient";

export const API_CONSOLE = "/api/chat-bullq/console";
export const API_AGENTES = `${API_CONSOLE}/agentes`;
export const API_SKILLS = `${API_CONSOLE}/skills`;
export const API_TOOLS = `${API_CONSOLE}/tools`;
export const API_EXECUCOES = `${API_CONSOLE}/execucoes`;
export const API_RESUMO = `${API_CONSOLE}/resumo`;

/**
 * O console e uma ABA do Painel do Provedor desde 07/09/2026 — o `?tab=` e do
 * painel e o `?aba=` e do console, entao quem acrescenta a sub-aba usa `&`,
 * nunca `?`. O endereco antigo (`/agentes`) redireciona para ca.
 */
export const ROTA_AGENTES = "/painel-provedor?tab=agentes";

export const ABAS_DO_CONSOLE = [
  { chave: "resumo", rotulo: "Visão geral" },
  { chave: "agentes", rotulo: "Agentes" },
  { chave: "skills", rotulo: "Skills" },
  { chave: "conexoes", rotulo: "Conexões" },
  { chave: "execucoes", rotulo: "Execuções" },
] as const;
export type AbaDoConsole = (typeof ABAS_DO_CONSOLE)[number]["chave"];

export function abaValida(valor: string | null | undefined): AbaDoConsole {
  const achou = ABAS_DO_CONSOLE.find(a => a.chave === valor);
  return achou ? achou.chave : "resumo";
}

/** Depois de qualquer escrita: agentes, skills e conexões se referenciam. */
export function invalidarConsole() {
  void queryClient.invalidateQueries({ queryKey: [API_AGENTES] });
  void queryClient.invalidateQueries({ queryKey: [API_SKILLS] });
  void queryClient.invalidateQueries({ queryKey: [API_TOOLS] });
}

/** Dólar com quatro casas: uma execução custa centavos de centavo e arredondar para 2 zera tudo. */
export function textoDeDolar(valor: number): string {
  if (!Number.isFinite(valor) || valor === 0) return "US$ 0,0000";
  return `US$ ${valor.toFixed(4).replace(".", ",")}`;
}

export function textoDeDuracao(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

export function textoDeMilhar(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

/** Data curta com hora — o feed de execuções é lido por ordem, não por data completa. */
export function textoDeQuando(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * O exemplo de JSON Schema que a caixa de parâmetros mostra vazia. Não é
 * enfeite: sem um ponto de partida, o operador escreve `{"cpf":"string"}` —
 * que é JSON válido e JSON Schema errado, e o modelo nunca chama a função.
 */
export const EXEMPLO_DE_PARAMETROS = `{
  "type": "object",
  "properties": {
    "telefone": { "type": "string", "description": "Telefone do cliente com DDD" }
  },
  "required": ["telefone"]
}`;
