/**
 * Storage da confissão de dívida e da integração de assinatura (spec §5).
 *
 * Regras que este arquivo carrega sozinho:
 * - `api_token` entra por `encryptField` e só sai decifrado em
 *   `getIntegracaoComCredencial` — a leitura do admin devolve os 4 últimos
 *   caracteres e nada mais.
 * - `webhook_secret` nasce aqui e é regenerado quando token ou ambiente mudam
 *   (o retorno do outro ambiente não pode autenticar neste).
 * - PDF: `base64` só é selecionado em `obterPdf`.
 * - Transição de status é UM update com `WHERE status = de`: webhook, worker e
 *   cancelar competem pela mesma linha e só quem recebe a linha de volta grava
 *   evento.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  assinaturaIntegracoes, cobrancaConfissoes, cobrancaConfissoesPdf,
  type AssinaturaIntegracao, type CobrancaConfissao,
} from "@shared/schema";
import { decryptField, encryptField } from "../utils/crypto";
import { ErroDeConfissao } from "../assinatura/erro";
import {
  transicaoDeConfissaoPermitida,
  type AmbienteDeAssinatura, type AuthModeDoCliente, type FaturaDoAnexo, type ModeloDaConfissao, type OrigemDaConfissao,
  type ParcelaConfessada, type SignatarioDaConfissao, type StatusDeConfissao,
} from "@shared/cobranca/confissao";

export const FORNECEDOR = "zapsign";

export interface DadosDaIntegracaoDeAssinatura {
  /** undefined, null ou "" = não mexe no token gravado (regra de `preservarSegredosVazios` do ERP). */
  apiToken?: string | null;
  ambiente?: AmbienteDeAssinatura;
  templateId?: string | null;
  signatarioNome?: string | null;
  signatarioCpf?: string | null;
  signatarioEmail?: string | null;
  signatarioTelefone?: string | null;
  provedorAssina?: boolean;
  authModeCliente?: AuthModeDoCliente;
  exigirSelfie?: boolean;
  prazoAssinaturaDias?: number;
  enviarArquivoAssinadoWhatsapp?: boolean;
}

export interface IntegracaoDeAssinaturaParaAdmin {
  configurada: boolean;
  apiTokenGravado: boolean;
  apiTokenIlegivel: boolean;
  apiTokenFinal: string | null;
  ambiente: AmbienteDeAssinatura;
  templateId: string | null;
  signatarioNome: string | null;
  signatarioCpf: string | null;
  signatarioEmail: string | null;
  signatarioTelefone: string | null;
  provedorAssina: boolean;
  authModeCliente: AuthModeDoCliente;
  exigirSelfie: boolean;
  prazoAssinaturaDias: number;
  enviarArquivoAssinadoWhatsapp: boolean;
  modeloRevisadoEm: string | null;
  isEnabled: boolean;
  ativadaEm: string | null;
  updatedAt: string | null;
}

export type IntegracaoComCredencial = Omit<AssinaturaIntegracao, "apiToken"> & { apiToken: string };

export interface NovaConfissao {
  customerId: number;
  casoId: number;
  negociacaoId: number | null;
  origem: OrigemDaConfissao;
  ambiente: AmbienteDeAssinatura;
  valorTotal: number;
  valorOriginal: number | null;
  descontoPct: number | null;
  parcelas: ParcelaConfessada[];
  erpSource: string | null;
  erpLidoEm: Date | null;
  erpFaturas: FaturaDoAnexo[];
  modelo: ModeloDaConfissao;
  modeloVersao: string;
  modeloRevisado: boolean;
  baseCanonica: unknown;
  textoHash: string;
  geradoEm: Date;
  clienteNome: string;
  clienteCpfCnpj: string;
  clienteEmail: string | null;
  clienteTelefone: string | null;
  clienteEmailErp: string | null;
  clienteTelefoneErp: string | null;
  contatoAlteradoPorUserId: number | null;
  representanteNome: string | null;
  representanteCpf: string | null;
  dataLimiteAssinatura: string;
  criadaPorUserId: number;
  aprovadaPorUserId: number | null;
  chaveIdempotencia: string | null;
}

export interface PatchDeConfissao {
  erroUltimo?: string | null;
  reconciliarEm?: Date | null;
  chaveIdempotencia?: string | null;
  zapsignDocToken?: string | null;
  webhookZapsignId?: string | null;
  zapsignSigners?: SignatarioDaConfissao[];
  zapsignSandbox?: boolean | null;
  recusaInformadaEm?: Date | null;
  expiracaoInformadaEm?: Date | null;
  enviadaEm?: Date | null;
  assinadaEm?: Date | null;
  encerradaEm?: Date | null;
  pdfOriginalSha256?: string | null;
  pdfAssinadoSha256?: string | null;
  avisoProvedorEm?: Date | null;
}

export type TipoDePdf = "original" | "assinado";
export interface PdfDaConfissao { bytes: Buffer; sha256: string; tamanhoBytes: number }
export interface ConfissaoAssinadaViva { id: number; assinadaEm: Date | null; valorTotal: number; ambiente: AmbienteDeAssinatura }
export interface ConfissaoDoTitular { id: number; providerId: number; status: string; valorTotal: number; ambiente: string; assinadaEm: Date | null; createdAt: Date | null; dataLimiteAssinatura: string }

const decimal = (n: number | null) => (n === null ? null : n.toFixed(2));
const numero = (s: string | null) => (s === null ? 0 : Number(s));
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const novoSegredo = () => randomBytes(32).toString("base64url");

/** Select explícito: o teste responde na MESMA ordem destas chaves. */
const colunasDaIntegracao = {
  id: assinaturaIntegracoes.id,
  providerId: assinaturaIntegracoes.providerId,
  apiToken: assinaturaIntegracoes.apiToken,
  ambiente: assinaturaIntegracoes.ambiente,
  templateId: assinaturaIntegracoes.templateId,
  signatarioNome: assinaturaIntegracoes.signatarioNome,
  signatarioCpf: assinaturaIntegracoes.signatarioCpf,
  signatarioEmail: assinaturaIntegracoes.signatarioEmail,
  signatarioTelefone: assinaturaIntegracoes.signatarioTelefone,
  provedorAssina: assinaturaIntegracoes.provedorAssina,
  authModeCliente: assinaturaIntegracoes.authModeCliente,
  exigirSelfie: assinaturaIntegracoes.exigirSelfie,
  prazoAssinaturaDias: assinaturaIntegracoes.prazoAssinaturaDias,
  enviarArquivoAssinadoWhatsapp: assinaturaIntegracoes.enviarArquivoAssinadoWhatsapp,
  modeloRevisadoEm: assinaturaIntegracoes.modeloRevisadoEm,
  webhookSecret: assinaturaIntegracoes.webhookSecret,
  isEnabled: assinaturaIntegracoes.isEnabled,
  ativadaEm: assinaturaIntegracoes.ativadaEm,
  updatedAt: assinaturaIntegracoes.updatedAt,
};

export class AssinaturaStorage {
  private async _linhaDaIntegracao(providerId: number) {
    const [linha] = await db.select(colunasDaIntegracao).from(assinaturaIntegracoes)
      .where(and(eq(assinaturaIntegracoes.providerId, providerId), eq(assinaturaIntegracoes.fornecedor, FORNECEDOR)))
      .limit(1);
    return linha;
  }

  async getIntegracaoParaAdmin(providerId: number): Promise<IntegracaoDeAssinaturaParaAdmin | undefined> {
    const l = await this._linhaDaIntegracao(providerId);
    if (!l) return undefined;
    let ilegivel = false;
    let final: string | null = null;
    if (l.apiToken) {
      try {
        const puro = decryptField(l.apiToken);
        final = puro ? puro.slice(-4) : null;
      } catch {
        ilegivel = true;
      }
    }
    return {
      configurada: !!l.apiToken,
      apiTokenGravado: !!l.apiToken,
      apiTokenIlegivel: ilegivel,
      apiTokenFinal: final,
      ambiente: l.ambiente as AmbienteDeAssinatura,
      templateId: l.templateId,
      signatarioNome: l.signatarioNome,
      signatarioCpf: l.signatarioCpf,
      signatarioEmail: l.signatarioEmail,
      signatarioTelefone: l.signatarioTelefone,
      provedorAssina: l.provedorAssina,
      authModeCliente: l.authModeCliente as AuthModeDoCliente,
      exigirSelfie: l.exigirSelfie,
      prazoAssinaturaDias: l.prazoAssinaturaDias,
      enviarArquivoAssinadoWhatsapp: l.enviarArquivoAssinadoWhatsapp,
      modeloRevisadoEm: iso(l.modeloRevisadoEm),
      isEnabled: l.isEnabled,
      ativadaEm: iso(l.ativadaEm),
      updatedAt: iso(l.updatedAt),
    };
  }

  async getIntegracaoComCredencial(providerId: number): Promise<IntegracaoComCredencial | undefined> {
    const l = await this._linhaDaIntegracao(providerId);
    if (!l || !l.apiToken) return undefined;
    let apiToken: string | null;
    try {
      apiToken = decryptField(l.apiToken);
    } catch {
      throw new ErroDeConfissao("CREDENCIAL_ILEGIVEL", "O token do ZapSign gravado não abre neste servidor — o superadmin precisa redigitá-lo", 409);
    }
    if (!apiToken) return undefined;
    return { ...l, fornecedor: FORNECEDOR, modeloRevisadoPorUserId: null, createdAt: null, apiToken } as IntegracaoComCredencial;
  }

  async salvarIntegracaoDeAssinatura(providerId: number, dados: DadosDaIntegracaoDeAssinatura): Promise<void> {
    const atual = await this._linhaDaIntegracao(providerId);
    const tokenNovo = typeof dados.apiToken === "string" && dados.apiToken.trim() ? dados.apiToken.trim() : null;
    const ambiente = dados.ambiente ?? (atual?.ambiente as AmbienteDeAssinatura | undefined) ?? "sandbox";
    const mudouSegredo = !atual || tokenNovo !== null || ambiente !== atual.ambiente;
    const patch: Partial<typeof assinaturaIntegracoes.$inferInsert> = { ambiente, updatedAt: new Date() };
    if (dados.templateId !== undefined) patch.templateId = dados.templateId || null;
    if (dados.signatarioNome !== undefined) patch.signatarioNome = dados.signatarioNome || null;
    if (dados.signatarioCpf !== undefined) patch.signatarioCpf = dados.signatarioCpf ? dados.signatarioCpf.replace(/\D/g, "") : null;
    if (dados.signatarioEmail !== undefined) patch.signatarioEmail = dados.signatarioEmail || null;
    if (dados.signatarioTelefone !== undefined) patch.signatarioTelefone = dados.signatarioTelefone ? dados.signatarioTelefone.replace(/\D/g, "") : null;
    if (dados.provedorAssina !== undefined) patch.provedorAssina = dados.provedorAssina;
    if (dados.authModeCliente !== undefined) patch.authModeCliente = dados.authModeCliente;
    if (dados.exigirSelfie !== undefined) patch.exigirSelfie = dados.exigirSelfie;
    if (dados.prazoAssinaturaDias !== undefined) patch.prazoAssinaturaDias = dados.prazoAssinaturaDias;
    if (dados.enviarArquivoAssinadoWhatsapp !== undefined) patch.enviarArquivoAssinadoWhatsapp = dados.enviarArquivoAssinadoWhatsapp;
    if (tokenNovo) patch.apiToken = encryptField(tokenNovo);
    if (mudouSegredo) {
      patch.webhookSecret = novoSegredo();
      patch.isEnabled = false;
      patch.ativadaEm = null;
    }
    if (!atual) {
      await db.insert(assinaturaIntegracoes).values({ ...patch, providerId, fornecedor: FORNECEDOR, ambiente });
      return;
    }
    await db.update(assinaturaIntegracoes).set(patch)
      .where(and(eq(assinaturaIntegracoes.id, atual.id), eq(assinaturaIntegracoes.providerId, providerId)));
  }

  async ativarIntegracaoDeAssinatura(providerId: number): Promise<void> {
    await db.update(assinaturaIntegracoes).set({ isEnabled: true, ativadaEm: new Date(), updatedAt: new Date() })
      .where(and(eq(assinaturaIntegracoes.providerId, providerId), eq(assinaturaIntegracoes.fornecedor, FORNECEDOR)));
  }

  async marcarModeloRevisado(providerId: number, userId: number): Promise<void> {
    await db.update(assinaturaIntegracoes).set({ modeloRevisadoEm: new Date(), modeloRevisadoPorUserId: userId, updatedAt: new Date() })
      .where(and(eq(assinaturaIntegracoes.providerId, providerId), eq(assinaturaIntegracoes.fornecedor, FORNECEDOR)));
  }

  async webhookSecretDoProvedor(providerId: number): Promise<{ webhookSecret: string | null; isEnabled: boolean; ambiente: string } | undefined> {
    const [l] = await db.select({ webhookSecret: assinaturaIntegracoes.webhookSecret, isEnabled: assinaturaIntegracoes.isEnabled, ambiente: assinaturaIntegracoes.ambiente })
      .from(assinaturaIntegracoes)
      .where(and(eq(assinaturaIntegracoes.providerId, providerId), eq(assinaturaIntegracoes.fornecedor, FORNECEDOR)))
      .limit(1);
    return l;
  }

  /* ── confissões ─────────────────────────────────────────────────────── */

  async criarConfissao(providerId: number, d: NovaConfissao): Promise<CobrancaConfissao> {
    try {
      const [linha] = await db.insert(cobrancaConfissoes).values({
        providerId,
        customerId: d.customerId,
        casoId: d.casoId,
        negociacaoId: d.negociacaoId,
        origem: d.origem,
        ambiente: d.ambiente,
        valorTotal: d.valorTotal.toFixed(2),
        valorOriginal: decimal(d.valorOriginal),
        descontoPct: decimal(d.descontoPct),
        parcelas: d.parcelas,
        erpSource: d.erpSource,
        erpLidoEm: d.erpLidoEm,
        erpFaturas: d.erpFaturas,
        modelo: d.modelo,
        modeloVersao: d.modeloVersao,
        modeloRevisado: d.modeloRevisado,
        baseCanonica: d.baseCanonica,
        textoHash: d.textoHash,
        geradoEm: d.geradoEm,
        status: "rascunho",
        clienteNome: d.clienteNome,
        clienteCpfCnpj: d.clienteCpfCnpj,
        clienteEmail: d.clienteEmail,
        clienteTelefone: d.clienteTelefone,
        clienteEmailErp: d.clienteEmailErp,
        clienteTelefoneErp: d.clienteTelefoneErp,
        contatoAlteradoPorUserId: d.contatoAlteradoPorUserId,
        representanteNome: d.representanteNome,
        representanteCpf: d.representanteCpf,
        dataLimiteAssinatura: d.dataLimiteAssinatura,
        criadaPorUserId: d.criadaPorUserId,
        aprovadaPorUserId: d.aprovadaPorUserId,
        chaveIdempotencia: d.chaveIdempotencia,
      }).returning();
      return linha;
    } catch (e) {
      const erro = e as { code?: string; constraint?: string };
      if (erro.code === "23505" && erro.constraint === "cobranca_confissoes_viva_uq") {
        throw new ErroDeConfissao("CONFISSAO_VIVA", "Este cliente já tem uma confissão em andamento — cancele-a antes de emitir outra", 409);
      }
      throw e;
    }
  }

  private async _primeira(condicao: ReturnType<typeof and>, ordem: ReturnType<typeof desc>[] = []): Promise<CobrancaConfissao | undefined> {
    const [linha] = await db.select().from(cobrancaConfissoes).where(condicao).orderBy(...ordem).limit(1);
    return linha;
  }

  obterConfissao(providerId: number, id: number) {
    return this._primeira(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.id, id)));
  }
  obterConfissaoPorToken(providerId: number, docToken: string) {
    return this._primeira(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.zapsignDocToken, docToken)));
  }
  obterConfissaoPorChave(providerId: number, chave: string) {
    return this._primeira(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.chaveIdempotencia, chave)));
  }
  confissaoVivaDoCliente(providerId: number, customerId: number) {
    return this._primeira(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.customerId, customerId), inArray(cobrancaConfissoes.status, ["rascunho", "enviada"])), [desc(cobrancaConfissoes.id)]);
  }
  confissaoAssinadaVivaDoCliente(providerId: number, customerId: number) {
    return this._primeira(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.customerId, customerId), eq(cobrancaConfissoes.status, "assinada")), [desc(cobrancaConfissoes.assinadaEm), desc(cobrancaConfissoes.id)]);
  }
  confissaoEnviadaDaNegociacao(providerId: number, negociacaoId: number) {
    return this._primeira(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.negociacaoId, negociacaoId), eq(cobrancaConfissoes.status, "enviada")));
  }

  async listarConfissoesDoCliente(providerId: number, customerId: number): Promise<CobrancaConfissao[]> {
    return db.select().from(cobrancaConfissoes)
      .where(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.customerId, customerId)))
      .orderBy(desc(cobrancaConfissoes.createdAt), desc(cobrancaConfissoes.id));
  }

  async confissoesAssinadasVivasPorCliente(providerId: number, customerIds: number[]): Promise<Map<number, ConfissaoAssinadaViva>> {
    const mapa = new Map<number, ConfissaoAssinadaViva>();
    if (customerIds.length === 0) return mapa;
    const linhas = await db.select({
      id: cobrancaConfissoes.id, customerId: cobrancaConfissoes.customerId, assinadaEm: cobrancaConfissoes.assinadaEm,
      valorTotal: cobrancaConfissoes.valorTotal, ambiente: cobrancaConfissoes.ambiente,
    }).from(cobrancaConfissoes)
      .where(and(eq(cobrancaConfissoes.providerId, providerId), inArray(cobrancaConfissoes.customerId, customerIds), eq(cobrancaConfissoes.status, "assinada")))
      .orderBy(asc(cobrancaConfissoes.assinadaEm));
    for (const l of linhas) mapa.set(l.customerId, { id: l.id, assinadaEm: l.assinadaEm, valorTotal: numero(l.valorTotal), ambiente: l.ambiente as AmbienteDeAssinatura });
    return mapa;
  }

  async atualizarConfissao(providerId: number, id: number, patch: PatchDeConfissao): Promise<CobrancaConfissao | undefined> {
    const [linha] = await db.update(cobrancaConfissoes).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(cobrancaConfissoes.id, id), eq(cobrancaConfissoes.providerId, providerId)))
      .returning();
    return linha;
  }

  /** UM update com `WHERE status = de`: quem recebe a linha de volta é o único que aplicou. */
  async transicionarConfissao(providerId: number, id: number, de: StatusDeConfissao, para: StatusDeConfissao, patch: PatchDeConfissao = {}): Promise<CobrancaConfissao | undefined> {
    if (!transicaoDeConfissaoPermitida(de, para)) {
      throw new ErroDeConfissao("ESTADO_INVALIDO", `Uma confissão ${de} não pode passar a ${para}`, 409);
    }
    const [linha] = await db.update(cobrancaConfissoes).set({ ...patch, status: para, updatedAt: new Date() })
      .where(and(eq(cobrancaConfissoes.id, id), eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.status, de)))
      .returning();
    return linha;
  }

  /**
   * A assinada nova substitui a anterior do cliente — no MESMO ambiente. Sem o
   * filtro, assinar um teste de sandbox (sem validade jurídica) rebaixava o
   * título de produção do mesmo cliente para `substituida`.
   */
  async marcarSubstituidas(providerId: number, customerId: number, novaId: number, ambiente: AmbienteDeAssinatura): Promise<number> {
    const linhas = await db.update(cobrancaConfissoes).set({ status: "substituida", encerradaEm: new Date(), updatedAt: new Date() })
      .where(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.customerId, customerId), eq(cobrancaConfissoes.status, "assinada"), ne(cobrancaConfissoes.id, novaId), eq(cobrancaConfissoes.ambiente, ambiente)))
      .returning({ id: cobrancaConfissoes.id });
    return linhas.length;
  }

  /* ── PDFs ───────────────────────────────────────────────────────────── */

  async guardarPdf(providerId: number, confissaoId: number, tipo: TipoDePdf, bytes: Buffer): Promise<{ sha256: string; tamanhoBytes: number }> {
    // O PDF só entra ligado a uma confissão DESTE provedor: o insert não tem WHERE para se proteger sozinho.
    const [dona] = await db.select({ id: cobrancaConfissoes.id }).from(cobrancaConfissoes)
      .where(and(eq(cobrancaConfissoes.id, confissaoId), eq(cobrancaConfissoes.providerId, providerId)))
      .limit(1);
    if (!dona) throw new ErroDeConfissao("NAO_ENCONTRADA", "Confissão não encontrada neste provedor", 404);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const tamanhoBytes = bytes.length;
    const base64 = bytes.toString("base64");
    await db.insert(cobrancaConfissoesPdf).values({ confissaoId, providerId, tipo, sha256, tamanhoBytes, base64 })
      .onConflictDoUpdate({ target: [cobrancaConfissoesPdf.confissaoId, cobrancaConfissoesPdf.tipo], set: { sha256, tamanhoBytes, base64 } });
    await db.update(cobrancaConfissoes)
      .set(tipo === "original" ? { pdfOriginalSha256: sha256, updatedAt: new Date() } : { pdfAssinadoSha256: sha256, updatedAt: new Date() })
      .where(and(eq(cobrancaConfissoes.id, confissaoId), eq(cobrancaConfissoes.providerId, providerId)));
    return { sha256, tamanhoBytes };
  }

  async obterPdf(providerId: number, confissaoId: number, tipo: TipoDePdf, opcoes: { registrarDownload?: boolean } = {}): Promise<PdfDaConfissao | undefined> {
    const [l] = await db.select({ base64: cobrancaConfissoesPdf.base64, sha256: cobrancaConfissoesPdf.sha256, tamanhoBytes: cobrancaConfissoesPdf.tamanhoBytes })
      .from(cobrancaConfissoesPdf)
      .where(and(eq(cobrancaConfissoesPdf.confissaoId, confissaoId), eq(cobrancaConfissoesPdf.providerId, providerId), eq(cobrancaConfissoesPdf.tipo, tipo)))
      .limit(1);
    if (!l) return undefined;
    if (opcoes.registrarDownload) {
      await db.update(cobrancaConfissoesPdf).set({ baixadoEm: new Date() })
        .where(and(eq(cobrancaConfissoesPdf.confissaoId, confissaoId), eq(cobrancaConfissoesPdf.providerId, providerId), eq(cobrancaConfissoesPdf.tipo, tipo)));
    }
    return { bytes: Buffer.from(l.base64, "base64"), sha256: l.sha256, tamanhoBytes: l.tamanhoBytes };
  }

  async apagarPdfs(providerId: number, confissaoId: number): Promise<void> {
    await db.delete(cobrancaConfissoesPdf)
      .where(and(eq(cobrancaConfissoesPdf.confissaoId, confissaoId), eq(cobrancaConfissoesPdf.providerId, providerId)));
  }

  /* ── worker e LGPD (varrem todos os provedores) ─────────────────────── */

  /** `enviadasHaMaisDeMs = null` = só as com `reconciliar_em` vencido (a passada curta). */
  async confissoesParaReconciliar(agora: Date, enviadasHaMaisDeMs: number | null): Promise<CobrancaConfissao[]> {
    const porPrazo = lte(cobrancaConfissoes.reconciliarEm, agora);
    const condicao = enviadasHaMaisDeMs === null
      ? porPrazo
      : or(porPrazo, lte(cobrancaConfissoes.enviadaEm, new Date(agora.getTime() - enviadasHaMaisDeMs)));
    return db.select().from(cobrancaConfissoes)
      .where(and(eq(cobrancaConfissoes.status, "enviada"), condicao))
      .orderBy(asc(cobrancaConfissoes.reconciliarEm), asc(cobrancaConfissoes.id))
      .limit(500);
  }

  /**
   * A janela GIRA: primeiro as nunca conferidas, depois a conferida há mais
   * tempo. Ordenar por `assinada_em` prendia a varredura nas mais antigas — um
   * título que nunca quita (pagamento parcial, abandonado) ficava na frente para
   * sempre, e com `maximo` deles a assinada nova nunca mais era avaliada.
   */
  async confissoesAssinadasParaQuitacao(maximo = 500): Promise<CobrancaConfissao[]> {
    return db.select().from(cobrancaConfissoes)
      .where(eq(cobrancaConfissoes.status, "assinada"))
      .orderBy(sql`${cobrancaConfissoes.quitacaoVerificadaEm} asc nulls first`, asc(cobrancaConfissoes.id))
      .limit(maximo);
  }

  /** Carimba a conferência de quitação SEM tocar em `updated_at` — que é "última alteração" para a tela, e de onde a retenção de 90 dias conta. */
  async marcarQuitacaoVerificada(providerId: number, id: number, quando: Date): Promise<void> {
    await db.update(cobrancaConfissoes).set({ quitacaoVerificadaEm: quando })
      .where(and(eq(cobrancaConfissoes.id, id), eq(cobrancaConfissoes.providerId, providerId)));
  }

  async confissoesParaExpirar(hoje: string): Promise<CobrancaConfissao[]> {
    return db.select().from(cobrancaConfissoes)
      .where(and(eq(cobrancaConfissoes.status, "enviada"), lt(cobrancaConfissoes.dataLimiteAssinatura, hoje)))
      .limit(500);
  }

  /** O que NÃO é título e já passou do prazo: rascunho, cancelada, expirada e qualquer linha de sandbox. */
  async confissoesParaRetencao(limite: Date, maximo = 200): Promise<Array<{ id: number; providerId: number }>> {
    return db.select({ id: cobrancaConfissoes.id, providerId: cobrancaConfissoes.providerId }).from(cobrancaConfissoes)
      .where(and(
        or(inArray(cobrancaConfissoes.status, ["rascunho", "cancelada", "expirada"]), sql`${cobrancaConfissoes.ambiente} = 'sandbox'`),
        lt(cobrancaConfissoes.updatedAt, limite),
        isNotNull(cobrancaConfissoes.clienteCpfCnpj),
      ))
      .limit(maximo);
  }

  async anonimizarConfissao(providerId: number, id: number): Promise<void> {
    await this.apagarPdfs(providerId, id);
    await db.update(cobrancaConfissoes).set({
      clienteNome: null, clienteCpfCnpj: null, clienteEmail: null, clienteTelefone: null, clienteEmailErp: null, clienteTelefoneErp: null,
      representanteNome: null, representanteCpf: null,
      parcelas: [], erpFaturas: [], zapsignSigners: [], baseCanonica: { anonimizada: true },
      updatedAt: new Date(),
    }).where(and(eq(cobrancaConfissoes.id, id), eq(cobrancaConfissoes.providerId, providerId)));
  }

  async confissoesDoTitular(cpfCnpj: string): Promise<ConfissaoDoTitular[]> {
    const digitos = cpfCnpj.replace(/\D/g, "");
    if (!digitos) return [];
    const linhas = await db.select({
      id: cobrancaConfissoes.id, providerId: cobrancaConfissoes.providerId, status: cobrancaConfissoes.status, valorTotal: cobrancaConfissoes.valorTotal,
      ambiente: cobrancaConfissoes.ambiente, assinadaEm: cobrancaConfissoes.assinadaEm, createdAt: cobrancaConfissoes.createdAt, dataLimiteAssinatura: cobrancaConfissoes.dataLimiteAssinatura,
    }).from(cobrancaConfissoes).where(eq(cobrancaConfissoes.clienteCpfCnpj, digitos));
    return linhas.map(l => ({ ...l, valorTotal: numero(l.valorTotal) }));
  }
}
