/**
 * Focus NFe — NFS-e (Nota Fiscal de Servico Eletronica)
 *
 * API v2: https://focusnfe.com.br/doc/
 * Auth: Basic Auth (token como username, senha vazia)
 * Homologacao: https://homologacao.focusnfe.com.br
 * Producao: https://api.focusnfe.com.br
 */

const FOCUS_TOKEN = () => process.env.FOCUS_NFE_TOKEN || "";
const IS_PRODUCTION = () => (process.env.FOCUS_NFE_ENV || "homologacao") === "producao";
const BASE_URL = () => IS_PRODUCTION() ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br";

function authHeaders(): Record<string, string> {
  const token = FOCUS_TOKEN();
  const encoded = Buffer.from(`${token}:`).toString("base64");
  return {
    "Authorization": `Basic ${encoded}`,
    "Content-Type": "application/json",
  };
}

export interface NfseEmitInput {
  /** Referencia unica (ex: "nfse-provider4-2026-001") */
  ref: string;
  /** CNPJ do prestador (sem formatacao) */
  cnpjPrestador: string;
  /** Inscricao Municipal do prestador */
  inscricaoMunicipal: string;
  /** Dados do tomador (cliente) */
  tomador: {
    cnpjCpf: string;
    razaoSocial: string;
    email: string;
    telefone?: string;
    logradouro: string;
    numero: string;
    complemento?: string;
    bairro: string;
    codigoMunicipio: string;
    uf: string;
    cep: string;
  };
  /** Descricao do servico */
  descricao: string;
  /** Valor do servico em R$ */
  valor: number;
  /** Codigo do servico na lista ISS (ex: "01.07" para analise de sistemas) */
  codigoServico: string;
  /** Aliquota ISS em % (ex: 2.90) */
  aliquotaIss: number;
}

export interface NfseResult {
  status: "processing" | "authorized" | "cancelled" | "error";
  ref: string;
  numero?: string;
  codigoVerificacao?: string;
  linkNfse?: string;
  linkPdf?: string;
  dataAutorizacao?: string;
  mensagem?: string;
  erros?: Array<{ codigo?: string; mensagem: string }>;
}

/**
 * Emitir NFS-e via Focus NFe
 */
export async function emitirNfse(input: NfseEmitInput): Promise<NfseResult> {
  const url = `${BASE_URL()}/v2/nfse?ref=${encodeURIComponent(input.ref)}`;

  // Montar payload no formato Focus NFe
  const cleanCnpjCpf = input.tomador.cnpjCpf.replace(/\D/g, "");
  const isCnpj = cleanCnpjCpf.length === 14;

  const body: Record<string, any> = {
    data_emissao: new Date().toISOString(),
    natureza_operacao: "1",
    optante_simples_nacional: true,
    prestador: {
      cnpj: input.cnpjPrestador.replace(/\D/g, ""),
      inscricao_municipal: input.inscricaoMunicipal,
      codigo_municipio: "3550308",
    },
    tomador: {
      cnpj: isCnpj ? cleanCnpjCpf : undefined,
      cpf: !isCnpj ? cleanCnpjCpf : undefined,
      razao_social: input.tomador.razaoSocial,
      email: input.tomador.email,
      telefone: input.tomador.telefone?.replace(/\D/g, "") || undefined,
      endereco: {
        logradouro: input.tomador.logradouro,
        numero: input.tomador.numero,
        complemento: input.tomador.complemento || undefined,
        bairro: input.tomador.bairro,
        uf: input.tomador.uf,
        cep: input.tomador.cep.replace(/\D/g, ""),
      },
    },
    servico: {
      aliquota: input.aliquotaIss,
      discriminacao: input.descricao,
      iss_retido: false,
      item_lista_servico: input.codigoServico,
      codigo_tributario_municipio: input.codigoServico,
      valor_servicos: input.valor,
    },
  };

  console.log(`[FocusNFe] Emitindo NFS-e ref=${input.ref} valor=R$${input.valor} env=${IS_PRODUCTION() ? "PROD" : "HOMOLOG"}`);

  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  const data = await response.json();

  if (response.status === 202 || response.status === 200) {
    return {
      status: "processing",
      ref: input.ref,
      mensagem: data.mensagem || "NFS-e enviada para processamento",
    };
  }

  console.error(`[FocusNFe] Erro ao emitir NFS-e ref=${input.ref}:`, JSON.stringify(data).substring(0, 500));
  return {
    status: "error",
    ref: input.ref,
    mensagem: data.mensagem || `Erro HTTP ${response.status}`,
    erros: data.erros || [{ mensagem: data.mensagem || "Erro desconhecido" }],
  };
}

/**
 * Consultar status de NFS-e
 */
export async function consultarNfse(ref: string): Promise<NfseResult> {
  const url = `${BASE_URL()}/v2/nfse/${encodeURIComponent(ref)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
    signal: AbortSignal.timeout(15000),
  });

  const data = await response.json();

  if (!response.ok && response.status !== 200) {
    return {
      status: "error",
      ref,
      mensagem: data.mensagem || `Erro HTTP ${response.status}`,
      erros: data.erros,
    };
  }

  const status = data.status === "autorizado" || data.status === "authorized" ? "authorized"
    : data.status === "cancelado" || data.status === "cancelled" ? "cancelled"
    : data.status === "erro" || data.status === "error" ? "error"
    : "processing";

  return {
    status,
    ref,
    numero: data.numero || data.numero_nfse || undefined,
    codigoVerificacao: data.codigo_verificacao || undefined,
    linkNfse: data.url || data.url_danfse || data.link_nfse || undefined,
    linkPdf: data.caminho_xml_nota_fiscal || undefined,
    dataAutorizacao: data.data_emissao || undefined,
    mensagem: data.mensagem,
    erros: data.erros,
  };
}

/**
 * Cancelar NFS-e
 */
export async function cancelarNfse(ref: string, justificativa: string = "Erro na emissao"): Promise<NfseResult> {
  const url = `${BASE_URL()}/v2/nfse/${encodeURIComponent(ref)}`;

  console.log(`[FocusNFe] Cancelando NFS-e ref=${ref}`);

  const response = await fetch(url, {
    method: "DELETE",
    headers: authHeaders(),
    body: JSON.stringify({ justificativa }),
    signal: AbortSignal.timeout(15000),
  });

  const data = await response.json();

  if (response.ok) {
    return {
      status: "cancelled",
      ref,
      mensagem: data.mensagem || "NFS-e cancelada com sucesso",
    };
  }

  return {
    status: "error",
    ref,
    mensagem: data.mensagem || `Erro ao cancelar: HTTP ${response.status}`,
    erros: data.erros,
  };
}

/**
 * Verificar se a API Focus NFe esta configurada
 */
export function isFocusNfeConfigured(): boolean {
  return !!FOCUS_TOKEN();
}

export function getFocusNfeEnv(): string {
  return IS_PRODUCTION() ? "producao" : "homologacao";
}
