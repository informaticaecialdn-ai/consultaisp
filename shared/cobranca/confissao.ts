/**
 * CONFISSÃO DE DÍVIDA (CPC 784) — o vocabulário puro.
 *
 * Sem banco, sem React, sem I/O: o servidor e o cliente importam daqui o mesmo
 * nome para cada estado, origem, papel e custo. O que o ZapSign chama de
 * `auth_mode` vira uma lista fechada — `assinaturaTela` puro fica de fora de
 * propósito (assina sem prova de QUEM assinou; a spec §5.1 recusa).
 *
 * Spec: docs/superpowers/specs/2026-09-09-confissao-de-divida-zapsign-design.md
 */

export const STATUS_DE_CONFISSAO = ["rascunho", "enviada", "assinada", "cancelada", "expirada", "quitada", "substituida"] as const;
export type StatusDeConfissao = (typeof STATUS_DE_CONFISSAO)[number];

/** Viva = ainda pode virar título. Uma por cliente: índice parcial da migração 0037. */
export const STATUS_VIVOS_DE_CONFISSAO = ["rascunho", "enviada"] as const;

export const TRANSICOES_DE_CONFISSAO: Record<StatusDeConfissao, readonly StatusDeConfissao[]> = {
  rascunho: ["enviada", "cancelada"],
  enviada: ["assinada", "cancelada", "expirada"],
  assinada: ["quitada", "substituida"],
  cancelada: [],
  expirada: [],
  quitada: [],
  substituida: [],
};

export function transicaoDeConfissaoPermitida(de: StatusDeConfissao, para: StatusDeConfissao): boolean {
  return TRANSICOES_DE_CONFISSAO[de].includes(para);
}

export const ROTULO_STATUS_DE_CONFISSAO: Record<StatusDeConfissao, string> = {
  rascunho: "Rascunho",
  enviada: "Aguardando assinatura",
  assinada: "Assinada",
  cancelada: "Cancelada",
  expirada: "Expirada",
  quitada: "Quitada",
  substituida: "Substituída",
};

export function confissaoViva(c: { status: string }): boolean {
  return c.status === "rascunho" || c.status === "enviada";
}

/** "Assinada viva" (spec §6.6): a que acende o selo e interrompe a prescrição. */
export function confissaoAssinadaViva(c: { status: string }): boolean {
  return c.status === "assinada";
}

/**
 * Status que só existem DEPOIS da assinatura do devedor: `quitada` e
 * `substituida` nascem de `assinada` (TRANSICOES_DE_CONFISSAO). Em produção,
 * qualquer um deles prova que o cliente tem — ou teve — um título.
 */
export const STATUS_QUE_PROVAM_A_ASSINATURA: readonly StatusDeConfissao[] = ["assinada", "quitada", "substituida"];

const instante = (d: Date | string | null) => (d ? new Date(d).getTime() : 0);

/**
 * A confissão que acende o selo do cliente, entre as dele (spec §6.6 e §8) —
 * e, quando é de PRODUÇÃO, a data da interrupção da prescrição no 360.
 *
 * Só a assinada de produção tem efeito jurídico: ela ganha de qualquer outra,
 * seja qual for a data. A de sandbox — o selo "TESTE" — só aparece enquanto o
 * cliente nunca teve título de produção; depois que teve (mesmo quitado ou
 * substituído), o teste antigo não volta como "a confissão do cliente". Sem
 * esta regra, a leitura escolhia a assinada mais recente de QUALQUER ambiente:
 * o teste de sandbox feito num cliente real virava o selo e a data da
 * interrupção. Quitada e substituída não acendem o selo (não são viva).
 */
export function confissaoDoSelo<T extends { id: number; status: string; ambiente: string; assinadaEm: Date | string | null }>(confissoes: readonly T[]): T | null {
  const maisRecentePrimeiro = (a: T, b: T) => (instante(b.assinadaEm) - instante(a.assinadaEm)) || (b.id - a.id);
  const deProducao = confissoes.filter(c => c.ambiente === "producao");
  const tituloVivo = deProducao.filter(confissaoAssinadaViva).sort(maisRecentePrimeiro)[0];
  if (tituloVivo) return tituloVivo;
  if (deProducao.some(c => (STATUS_QUE_PROVAM_A_ASSINATURA as readonly string[]).includes(c.status))) return null;
  return confissoes.filter(c => c.ambiente === "sandbox" && confissaoAssinadaViva(c)).sort(maisRecentePrimeiro)[0] ?? null;
}

export const AMBIENTES_DE_ASSINATURA = ["sandbox", "producao"] as const;
export type AmbienteDeAssinatura = (typeof AMBIENTES_DE_ASSINATURA)[number];

export const ORIGENS_DA_CONFISSAO = ["acordo", "saldo_integral"] as const;
export type OrigemDaConfissao = (typeof ORIGENS_DA_CONFISSAO)[number];
export const ROTULO_ORIGEM_DA_CONFISSAO: Record<OrigemDaConfissao, string> = {
  acordo: "parcelas do acordo aceito",
  saldo_integral: "saldo integral lido do ERP",
};

export const AUTH_MODES_DO_CLIENTE = [
  "assinaturaTela-tokenWhatsapp",
  "assinaturaTela-tokenEmail",
  "assinaturaTela-tokenSms",
  "tokenWhatsapp",
  "tokenEmail",
  "tokenSms",
  "certificadoDigital",
  "assinaturaTela-certificadoDigital",
] as const;
export type AuthModeDoCliente = (typeof AUTH_MODES_DO_CLIENTE)[number];
export const AUTH_MODE_PADRAO: AuthModeDoCliente = "assinaturaTela-tokenWhatsapp";

/** Tabela do ZapSign lida em 09/09/2026 (spec §3). 1 crédito = R$ 0,10. */
export const CREDITO_EM_REAIS = 0.1;
export const ENVIO_WHATSAPP_EM_REAIS = 0.5;
export const SELFIE_CREDITOS_MINIMO = 15;

export const CUSTO_DO_AUTH_MODE: Record<AuthModeDoCliente, { creditos: number; reais: number; rotulo: string; prova: string }> = {
  "assinaturaTela-tokenWhatsapp": { creditos: 5, reais: 0, rotulo: "Assinatura na tela + código por WhatsApp", prova: "código enviado ao WhatsApp do devedor" },
  "assinaturaTela-tokenEmail": { creditos: 0, reais: 0, rotulo: "Assinatura na tela + código por e-mail", prova: "código enviado ao e-mail do devedor" },
  "assinaturaTela-tokenSms": { creditos: 0, reais: 0.1, rotulo: "Assinatura na tela + código por SMS", prova: "código enviado por SMS ao devedor" },
  tokenWhatsapp: { creditos: 5, reais: 0, rotulo: "Código por WhatsApp", prova: "código enviado ao WhatsApp do devedor" },
  tokenEmail: { creditos: 0, reais: 0, rotulo: "Código por e-mail", prova: "código enviado ao e-mail do devedor" },
  tokenSms: { creditos: 0, reais: 0.1, rotulo: "Código por SMS", prova: "código enviado por SMS ao devedor" },
  certificadoDigital: { creditos: 5, reais: 0, rotulo: "Certificado digital (ICP-Brasil)", prova: "certificado digital do devedor" },
  "assinaturaTela-certificadoDigital": { creditos: 5, reais: 0, rotulo: "Assinatura na tela + certificado digital", prova: "certificado digital do devedor" },
};

export interface CustoDaEmissao { creditos: number; reais: number; texto: string }

const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

/** O custo DESTA emissão para a conta ZapSign do provedor — o diálogo mostra antes de emitir (spec §8). */
export function custoDaEmissao(i: { authMode: AuthModeDoCliente; ambiente: AmbienteDeAssinatura; enviarWhatsapp: boolean; exigirSelfie: boolean }): CustoDaEmissao {
  if (i.ambiente === "sandbox") return { creditos: 0, reais: 0, texto: "ambiente de testes — sem custo e sem envio ao cliente" };
  const base = CUSTO_DO_AUTH_MODE[i.authMode];
  const creditos = base.creditos + (i.exigirSelfie ? SELFIE_CREDITOS_MINIMO : 0);
  const valor = base.reais + (i.enviarWhatsapp ? ENVIO_WHATSAPP_EM_REAIS : 0);
  const partes = ["1 documento da cota do plano"];
  if (creditos > 0) partes.push(`${creditos} crédito${creditos === 1 ? "" : "s"} (${reais(creditos * CREDITO_EM_REAIS)})`);
  if (valor > 0) partes.push(reais(valor));
  return { creditos, reais: valor, texto: `${partes.join(" + ")} da conta ZapSign do provedor` };
}

/* ── O que a confissão guarda em JSON ────────────────────────────────── */

export type RotuloDaParcela = "entrada" | "parcela";
export interface ParcelaConfessada {
  n: number;
  rotulo: RotuloDaParcela;
  valor: number;
  /** AAAA-MM-DD */
  vencimento: string;
}

export const CLASSES_DE_FATURA = ["servico", "multa", "equipamento", "indeterminada"] as const;
export type ClasseDaFatura = (typeof CLASSES_DE_FATURA)[number];
export const ROTULO_CLASSE_DA_FATURA: Record<ClasseDaFatura, string> = {
  servico: "mensalidade",
  multa: "multa rescisória",
  equipamento: "equipamento em comodato",
  indeterminada: "mensalidade e multa sem valores separados",
};

/**
 * Uma linha do Anexo I: a fatura como o ERP a entregou ao vivo, mais os
 * encargos calculados até a leitura (decisão 2.2-1). Fatura que declara na
 * descrição uma multa ou um equipamento COM valor vira duas linhas (a parte de
 * serviço e a de saída), cada uma com a sua `chave` — é ela que o admin
 * desmarca. Encargos só na parte de serviço: multa sobre multa não se cobra.
 */
export interface FaturaDoAnexo {
  /** `erpRef`, ou `erpRef#multa` / `erpRef#equipamento` quando a fatura foi dividida. */
  chave: string;
  erpRef: string;
  descricao: string | null;
  vencimento: string;
  valor: number;
  classe: ClasseDaFatura;
  diasAtraso: number;
  multa: number;
  juros: number;
}

export type PapelDoSignatario = "cliente" | "provedor";
export const STATUS_DO_SIGNATARIO = ["new", "link-opened", "signed"] as const;
export type StatusDoSignatario = (typeof STATUS_DO_SIGNATARIO)[number];
export interface SignatarioDaConfissao {
  papel: PapelDoSignatario;
  token: string;
  signUrl: string | null;
  status: StatusDoSignatario;
  signedAt: string | null;
  authMode: string | null;
}
export const ROTULO_STATUS_DO_SIGNATARIO: Record<StatusDoSignatario, string> = {
  new: "não abriu o link",
  "link-opened": "abriu o link",
  signed: "assinou",
};

export const PRAZO_MAXIMO_DO_VENCIMENTO_DIAS = 90;
export const PRAZO_PADRAO_DE_ASSINATURA_DIAS = 15;
export const LEMBRETE_A_CADA_DIAS = 3;

export const SELO_SANDBOX = "TESTE — sem validade jurídica";
export const SELO_ASSINADA = "título executivo assinado";
export const AVISO_SEM_PARECER = "MODELO PADRÃO SEM PARECER JURÍDICO — o provedor é responsável por revisar este texto";
export const AVISO_SANDBOX = "AMBIENTE DE TESTES — SEM VALIDADE JURÍDICA";

/* ── O contrato da API (rotas → telas) ───────────────────────────────── */

export type ModeloDaConfissao = "padrao" | "zapsign";

export interface ConfissaoResumo {
  id: number;
  customerId: number;
  casoId: number;
  negociacaoId: number | null;
  status: StatusDeConfissao;
  origem: OrigemDaConfissao;
  ambiente: AmbienteDeAssinatura;
  zapsignSandbox: boolean | null;
  valorTotal: number;
  valorOriginal: number | null;
  descontoPct: number | null;
  parcelas: ParcelaConfessada[];
  anexo: FaturaDoAnexo[];
  modelo: ModeloDaConfissao;
  modeloVersao: string;
  modeloRevisado: boolean;
  dataLimiteAssinatura: string;
  enviadaEm: string | null;
  assinadaEm: string | null;
  encerradaEm: string | null;
  recusaInformadaEm: string | null;
  expiracaoInformadaEm: string | null;
  erroUltimo: string | null;
  signatarios: SignatarioDaConfissao[];
  signUrlCliente: string | null;
  contatoAlterado: boolean;
  criadaPor: string | null;
  criadaEm: string;
  pdf: { original: boolean; assinado: boolean };
}

export interface EstadoDaAssinatura {
  configurada: boolean;
  ativa: boolean;
  ambiente: AmbienteDeAssinatura | null;
  modelo: ModeloDaConfissao;
  modeloRevisado: boolean;
  provedorAssina: boolean;
  authMode: AuthModeDoCliente | null;
  custo: CustoDaEmissao | null;
  prazoAssinaturaDias: number | null;
  chatDisponivel: boolean;
  /** Por que não dá para emitir hoje (null = pode). */
  motivo: string | null;
}

export interface PreviaDoModeloPadrao { modelo: "padrao"; titulo: string; texto: string }
export interface PreviaDoModeloZapSign { modelo: "zapsign"; templateId: string; variaveis: Array<{ de: string; para: string }> }

export interface BaseDaConfissaoDto {
  origem: OrigemDaConfissao;
  casoId: number | null;
  negociacaoId: number | null;
  cliente: { nome: string; documento: string; pessoaJuridica: boolean; email: string | null; telefone: string | null; endereco: string | null };
  valorTotal: number;
  valorOriginal: number | null;
  descontoPct: number | null;
  recebidoDoAcordo: number | null;
  encargos: { multa: number; juros: number; multaPct: number; jurosMesPct: number };
  parcelas: ParcelaConfessada[];
  anexo: FaturaDoAnexo[];
  faturasIndeterminadas: number;
  /** `erpRef` das faturas de saída (multa/equipamento) — o admin pode desmarcá-las. */
  faturasDeSaida: string[];
  erpSource: string | null;
  erpLidoEm: string | null;
  dividaAtualDoErp: number | null;
  vencimento: { minimo: string; maximo: string; escolhido: string | null };
  bloqueios: string[];
  avisos: string[];
  prescrita: boolean;
  baseHash: string | null;
  previa: PreviaDoModeloPadrao | PreviaDoModeloZapSign | null;
  custo: CustoDaEmissao;
  ambiente: AmbienteDeAssinatura;
  modeloRevisado: boolean;
}
