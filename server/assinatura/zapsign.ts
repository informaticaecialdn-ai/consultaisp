/**
 * Conector do ZapSign — HTTP puro, sem estado, no host do AMBIENTE pedido.
 *
 * Doc conferida em 09/09/2026 (docs.zapsign.com.br). Erros viram
 * `ErroDeConfissao` por status, SEM o corpo da resposta na mensagem: o corpo
 * do ZapSign pode ecoar dados do signatário e o nosso log de erro é lido por
 * gente. O que volta do ZapSign passa por Zod com `strip`: `liveness_photo_url`,
 * `geo_*`, `ip`, `answers` morrem aqui na borda (spec §6.3).
 */
import { z } from "zod";
import type { AmbienteDeAssinatura } from "@shared/cobranca/confissao";
import { ErroDeConfissao } from "./erro";

export const HOSTS_DO_ZAPSIGN: Record<AmbienteDeAssinatura, string> = {
  sandbox: "https://sandbox.api.zapsign.com.br/api/v1",
  producao: "https://api.zapsign.com.br/api/v1",
};

export interface SignatarioParaCriar {
  name: string;
  email?: string;
  phone_country?: string;
  phone_number?: string;
  auth_mode: string;
  cpf?: string;
  require_cpf?: boolean;
  validate_cpf?: boolean;
  require_selfie_photo?: boolean;
  send_automatic_email?: boolean;
  send_automatic_whatsapp?: boolean;
  send_automatic_whatsapp_signed_file?: boolean;
  lock_name?: boolean;
  lock_email?: boolean;
  lock_phone?: boolean;
  external_id?: string;
  order_group?: number;
  qualification?: string;
  custom_message?: string;
}

export interface DocumentoPorPdf {
  name: string;
  base64_pdf: string;
  signers: SignatarioParaCriar[];
  lang: "pt-br";
  external_id: string;
  folder_path: string;
  brand_name?: string;
  date_limit_to_sign: string;
  reminder_every_n_days: number;
  allow_refuse_signature: boolean;
  signature_order_active: boolean;
  disable_signer_emails?: boolean;
}

export interface DocumentoPorModelo {
  template_id: string;
  signer_name: string;
  signer_email?: string;
  signer_phone_country?: string;
  signer_phone_number?: string;
  data: Array<{ de: string; para: string }>;
  lang: "pt-br";
  external_id: string;
  folder_path: string;
  date_limit_to_sign: string;
  reminder_every_n_days: number;
  allow_refuse_signature: boolean;
  signature_order_active?: boolean;
  send_automatic_email?: boolean;
  send_automatic_whatsapp?: boolean;
}

const SignatarioSchema = z.object({
  token: z.string(),
  status: z.string().default("new"),
  sign_url: z.string().nullish().transform(v => v ?? null),
  signed_at: z.string().nullish().transform(v => v ?? null),
  auth_mode: z.string().nullish().transform(v => v ?? null),
  external_id: z.string().nullish().transform(v => v ?? null),
});
export type SignatarioDoZapSign = z.infer<typeof SignatarioSchema>;

const DocumentoSchema = z.object({
  token: z.string(),
  status: z.string(),
  signed_at: z.string().nullish().transform(v => v ?? null),
  signed_file: z.string().nullish().transform(v => v ?? null),
  original_file: z.string().nullish().transform(v => v ?? null),
  deleted: z.boolean().default(false),
  sandbox: z.boolean().default(false),
  signers: z.array(SignatarioSchema).default([]),
});
export type DocumentoDoZapSign = z.infer<typeof DocumentoSchema>;

export interface ClienteZapSign {
  criarDocumentoPorPdf(d: DocumentoPorPdf): Promise<DocumentoDoZapSign>;
  criarDocumentoPorModelo(d: DocumentoPorModelo): Promise<DocumentoDoZapSign>;
  adicionarSignatario(docToken: string, s: SignatarioParaCriar): Promise<SignatarioDoZapSign>;
  atualizarSignatario(signerToken: string, patch: Partial<SignatarioParaCriar>): Promise<SignatarioDoZapSign>;
  detalharDocumento(docToken: string): Promise<DocumentoDoZapSign>;
  excluirDocumento(docToken: string): Promise<void>;
  registrarWebhookDoDocumento(w: { url: string; docToken: string; cabecalho: { nome: string; valor: string } }): Promise<{ id: string }>;
  excluirWebhook(id: string): Promise<void>;
  reenviarNotificacoes(docToken: string): Promise<{ enviados: number; falhas: number }>;
  testarToken(): Promise<void>;
  baixarArquivo(url: string, maxBytes: number): Promise<Buffer>;
}

function erroPorStatus(status: number, aguardar: string | null): ErroDeConfissao {
  if (status === 401 || status === 403) return new ErroDeConfissao("ZAPSIGN_CREDENCIAL", "O ZapSign recusou o token da conta do provedor — confira em Configurações > Integrações > API ZapSign", 422);
  if (status === 402) return new ErroDeConfissao("ZAPSIGN_CREDITOS", "A conta ZapSign do provedor está sem créditos ou sem cota de documentos", 422);
  if (status === 404) return new ErroDeConfissao("NAO_ENCONTRADA", "O documento não existe no ZapSign", 404);
  if (status === 429) {
    const segundos = aguardar ? Number.parseInt(aguardar, 10) : NaN;
    return new ErroDeConfissao("ZAPSIGN_LIMITE", "O ZapSign pediu para aguardar antes de repetir", 429, Number.isFinite(segundos) ? { aguardarSegundos: segundos } : undefined);
  }
  if (status >= 500) return new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", `O ZapSign não respondeu (HTTP ${status})`, 502);
  return new ErroDeConfissao("ZAPSIGN_RECUSOU", `O ZapSign recusou a requisição (HTTP ${status})`, 422);
}

export function clienteZapSign(config: { apiToken: string; ambiente: AmbienteDeAssinatura; fetchImpl?: typeof fetch; timeoutMs?: number }): ClienteZapSign {
  const base = HOSTS_DO_ZAPSIGN[config.ambiente];
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 20_000;

  async function chamar<T>(metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown, schema?: z.ZodType<T>): Promise<T> {
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), timeoutMs);
    let resposta: Response;
    try {
      resposta = await fetchImpl(`${base}${caminho}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json", Accept: "application/json" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controlador.signal,
      });
    } catch {
      throw new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "O ZapSign não respondeu (rede ou tempo esgotado)", 502);
    } finally {
      clearTimeout(timer);
    }
    if (!resposta.ok) throw erroPorStatus(resposta.status, resposta.headers.get("retry-after"));
    if (!schema) return undefined as T;
    const json = await resposta.json().catch(() => ({}));
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ErroDeConfissao("ZAPSIGN_RECUSOU", "O ZapSign respondeu num formato que o Consulta ISP não reconhece", 502);
    return parsed.data;
  }

  return {
    criarDocumentoPorPdf: d => chamar("POST", "/docs/", d, DocumentoSchema),
    criarDocumentoPorModelo: d => chamar("POST", "/models/create-doc/", d, DocumentoSchema),
    adicionarSignatario: (docToken, s) => chamar("POST", `/docs/${encodeURIComponent(docToken)}/add-signer/`, s, SignatarioSchema),
    atualizarSignatario: (signerToken, patch) => chamar("POST", `/signers/${encodeURIComponent(signerToken)}/`, patch, SignatarioSchema),
    detalharDocumento: docToken => chamar("GET", `/docs/${encodeURIComponent(docToken)}/`, undefined, DocumentoSchema),
    excluirDocumento: docToken => chamar("DELETE", `/docs/${encodeURIComponent(docToken)}/`),
    registrarWebhookDoDocumento: async w => {
      const r = await chamar("POST", "/user/company/webhook/", { url: w.url, type: "", doc_token: w.docToken, headers: [{ name: w.cabecalho.nome, value: w.cabecalho.valor }] }, z.object({ id: z.union([z.string(), z.number()]) }));
      return { id: String(r.id) };
    },
    excluirWebhook: id => chamar("DELETE", "/user/company/webhook/delete/", { id }),
    reenviarNotificacoes: async docToken => {
      const r = await chamar("POST", `/docs/${encodeURIComponent(docToken)}/resend-notifications-bulk/`, {}, z.object({ sent_count: z.number().default(0), failed_count: z.number().default(0) }));
      return { enviados: r.sent_count, falhas: r.failed_count };
    },
    testarToken: async () => { await chamar("GET", "/docs/?page=1", undefined, z.unknown()); },
    baixarArquivo: async (url, maxBytes) => {
      let resposta: Response;
      try {
        resposta = await fetchImpl(url);
      } catch {
        throw new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "Não foi possível baixar o arquivo do ZapSign", 502);
      }
      if (!resposta.ok) throw erroPorStatus(resposta.status, null);
      const declarado = Number(resposta.headers.get("content-length") ?? 0);
      if (declarado > maxBytes) throw new ErroDeConfissao("ARQUIVO_GRANDE", `O arquivo assinado passa de ${Math.round(maxBytes / 1024 / 1024)} MB`, 422);
      const bytes = Buffer.from(await resposta.arrayBuffer());
      if (bytes.length > maxBytes) throw new ErroDeConfissao("ARQUIVO_GRANDE", `O arquivo assinado passa de ${Math.round(maxBytes / 1024 / 1024)} MB`, 422);
      return bytes;
    },
  };
}
