/**
 * Emitir a confissão (spec §6.2, passos 2–4).
 *
 * Sob trava `confissao:{providerId}:{customerId}` (pg_try_advisory_lock, o
 * mesmo `comTravaDoChat` do chat): recalcula a base e compara o hash; a
 * chave de idempotência devolve o que já existe; grava o RASCUNHO com a foto
 * completa e o PDF original; e só então, fora de qualquer transação, fala com
 * o ZapSign — criar documento, registrar o webhook DAQUELE documento com o
 * cabeçalho secreto. Sucesso = `enviada` + evento + follow-up. Falha em
 * qualquer chamada encerra o rascunho como `cancelada`, grava `erro_ultimo` e
 * libera a chave de idempotência; documento criado sem webhook é apagado para
 * não ficar órfão.
 */
import { storage } from "../../storage";
import { logger } from "../../logger";
import { comTravaDoChat } from "../chat/chat-trava";
import { clienteZapSign, type ClienteZapSign, type SignatarioParaCriar } from "../../assinatura/zapsign";
import { gerarPdfDaConfissao } from "../../assinatura/pdf";
import { ErroDeConfissao } from "../../assinatura/erro";
import { montarBase } from "./confissao-base.service";
import { renderizarConfissao, variaveisDoModeloZapSign, VERSAO_DO_MODELO, type Representante } from "@shared/cobranca/confissao-modelo";
import { LEMBRETE_A_CADA_DIAS, type OrigemDaConfissao, type SignatarioDaConfissao, type StatusDeConfissao, type StatusDoSignatario } from "@shared/cobranca/confissao";
import { casoFechado } from "@shared/cobranca";
import type { CobrancaConfissao } from "@shared/schema";
import type { SignatarioDoZapSign } from "../../assinatura/zapsign";

export const CABECALHO_DO_WEBHOOK = "X-Consulta-ISP-Assinatura";

export interface CorpoDaEmissao {
  origem: OrigemDaConfissao;
  vencimento?: string | null;
  faturasExcluidas?: string[];
  clienteEmail?: string | null;
  clienteTelefone?: string | null;
  representante?: Representante | null;
  baseHash: string;
  chaveIdempotencia: string;
  confirmoTeste?: boolean;
  confirmoPrescricao?: boolean;
}

export function urlDoWebhookDeAssinatura(providerId: number): string {
  const base = (process.env.ASSINATURA_WEBHOOK_URL || "https://consultaisp.com.br/api/webhooks/zapsign").replace(/\/+$/, "");
  return `${base}/${providerId}`;
}

const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
/** DDD + número, sem o 55: o ZapSign recebe o país em `phone_country`. */
const telefoneNacional = (s: string | null) => {
  const d = digitos(s);
  return d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
};
const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const maisDias = (d: Date, dias: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias);

function statusDoSignatario(s: string): StatusDoSignatario {
  return s === "signed" ? "signed" : s === "link-opened" ? "link-opened" : "new";
}

export function signatariosGravaveis(signers: SignatarioDoZapSign[], papelPorToken: Map<string, "cliente" | "provedor">): SignatarioDaConfissao[] {
  return signers.map(s => ({
    papel: papelPorToken.get(s.token) ?? (s.external_id === "provedor" ? "provedor" : "cliente"),
    token: s.token,
    signUrl: s.sign_url,
    status: statusDoSignatario(s.status),
    signedAt: s.signed_at,
    authMode: s.auth_mode,
  }));
}

/** Evento `confissao` no caso, quando o caso ainda está vivo. */
export async function registrarEventoDaConfissao(providerId: number, confissao: Pick<CobrancaConfissao, "id" | "casoId" | "valorTotal" | "ambiente">, status: StatusDeConfissao | "recusa_informada" | "expiracao_informada" | "aguardando_provedor", userId: number | null, notas: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  const caso = await storage.obterCasoDeCobranca(providerId, confissao.casoId);
  if (!caso || casoFechado(caso.status)) {
    logger.info({ providerId, confissaoId: confissao.id, casoId: confissao.casoId, status }, "CONFISSAO caso fechado — evento não gravado");
    return false;
  }
  await storage.registrarEventoDeCobranca(providerId, {
    casoId: confissao.casoId,
    userId,
    tipo: "confissao",
    canal: "sistema",
    notas,
    metadata: { confissaoId: confissao.id, status, valor: Number(confissao.valorTotal), ambiente: confissao.ambiente, ...extra },
  });
  return true;
}

/** Rascunho que nunca chegou ao ZapSign (falha ou processo caído): encerra como cancelada, guarda o motivo e LIBERA a chave de idempotência — a próxima tentativa nasce limpa. Os índices únicos (uma viva por cliente; provedor+chave) fariam de um rascunho falho vivo um beco sem saída. */
async function encerrarRascunhoFalho(providerId: number, rascunhoId: number, motivo: string): Promise<void> {
  await storage.transicionarConfissao(providerId, rascunhoId, "rascunho", "cancelada", { erroUltimo: motivo, encerradaEm: new Date(), chaveIdempotencia: null });
}

export async function emitirConfissao(providerId: number, customerId: number, userId: number, corpo: CorpoDaEmissao): Promise<CobrancaConfissao> {
  // Fora da trava só se LÊ: o que já não é rascunho volta como está (idempotência barata).
  const existente = await storage.obterConfissaoPorChave(providerId, corpo.chaveIdempotencia);
  if (existente && existente.status !== "rascunho") return existente;

  const resultado = await comTravaDoChat(`confissao:${providerId}:${customerId}`, async () => {
    // Sob a trava a releitura é a verdade: um rascunho com esta chave só pode ser
    // de um processo que caiu ou de uma tentativa que falhou — quem estivesse
    // emitindo agora seguraria a trava. Fora da trava, encerrá-lo mataria a
    // emissão em voo de outro pedido com a mesma chave.
    const pelaChave = await storage.obterConfissaoPorChave(providerId, corpo.chaveIdempotencia);
    if (pelaChave && pelaChave.status !== "rascunho") return pelaChave;
    if (pelaChave && pelaChave.customerId !== customerId) throw new ErroDeConfissao("BASE_MUDOU", "Esta chave de idempotência pertence a outra emissão — recarregue", 409);
    if (pelaChave) await encerrarRascunhoFalho(providerId, pelaChave.id, pelaChave.erroUltimo ?? "emissão interrompida antes do envio");

    const base = await montarBase(providerId, customerId, {
      vencimento: corpo.vencimento ?? null,
      faturasExcluidas: corpo.faturasExcluidas ?? [],
      email: corpo.clienteEmail ?? null,
      telefone: corpo.clienteTelefone ?? null,
      representante: corpo.representante ?? null,
    });
    if (base.dto.bloqueios.length > 0) throw new ErroDeConfissao("BLOQUEADA", base.dto.bloqueios[0], 422, { bloqueios: base.dto.bloqueios });
    if (!base.entrada || !base.canonica || !base.hash || !base.cliente || !base.provedor || !base.caso || !base.integracao) {
      throw new ErroDeConfissao("BLOQUEADA", "A base da confissão não pôde ser montada", 422, { bloqueios: base.dto.bloqueios });
    }
    if (base.dto.origem !== corpo.origem || base.hash !== corpo.baseHash) throw new ErroDeConfissao("BASE_MUDOU", "A dívida mudou desde a prévia. Recarregue e confira antes de emitir.", 409);
    if (base.dto.ambiente === "sandbox" && !corpo.confirmoTeste) throw new ErroDeConfissao("BLOQUEADA", "Ambiente de testes: confirme que esta emissão é um TESTE sem validade jurídica", 422, { bloqueios: ["confirme o teste"] });

    const viva = await storage.confissaoVivaDoCliente(providerId, customerId);
    if (viva && viva.status === "rascunho" && !viva.zapsignDocToken) {
      await encerrarRascunhoFalho(providerId, viva.id, viva.erroUltimo ?? "emissão interrompida antes do envio");
    } else if (viva) {
      throw new ErroDeConfissao("CONFISSAO_VIVA", "Este cliente já tem uma confissão em andamento — cancele-a antes de emitir outra", 409, { confissaoId: viva.id });
    }

    const { integracao, cliente, provedor, caso, canonica } = base;
    const agora = new Date();
    const ambiente = base.dto.ambiente;
    const producao = ambiente === "producao";
    const dataLimite = isoDia(maisDias(agora, integracao.prazoAssinaturaDias));
    const modeloZapSign = !!integracao.templateId;
    const documento = modeloZapSign ? null : renderizarConfissao(canonica, agora.toISOString(), base.hash);
    const pdf = documento ? await gerarPdfDaConfissao(documento) : null;

    const cpfDoSignatario = base.dto.cliente.pessoaJuridica ? digitos(corpo.representante?.cpf) : base.dto.cliente.documento;
    const signatarioCliente: SignatarioParaCriar = {
      name: base.dto.cliente.pessoaJuridica && corpo.representante ? corpo.representante.nome : cliente.name,
      email: base.dto.cliente.email ?? undefined,
      phone_country: "55",
      phone_number: telefoneNacional(base.dto.cliente.telefone) || undefined,
      auth_mode: integracao.authModeCliente,
      cpf: cpfDoSignatario || undefined,
      require_cpf: true,
      validate_cpf: base.contatoAlterado,
      require_selfie_photo: integracao.exigirSelfie,
      send_automatic_email: producao && !!base.dto.cliente.email,
      send_automatic_whatsapp: producao && !!base.dto.cliente.telefone,
      send_automatic_whatsapp_signed_file: producao && integracao.enviarArquivoAssinadoWhatsapp && !!base.dto.cliente.telefone,
      lock_name: true,
      external_id: "cliente",
      qualification: "Devedor",
      order_group: integracao.provedorAssina ? 2 : undefined,
    };
    const signatarioProvedor: SignatarioParaCriar | null = integracao.provedorAssina && integracao.signatarioNome && integracao.signatarioEmail ? {
      name: integracao.signatarioNome, email: integracao.signatarioEmail, auth_mode: "assinaturaTela-tokenEmail", cpf: integracao.signatarioCpf ?? undefined,
      send_automatic_email: producao, send_automatic_whatsapp: false, lock_name: true, external_id: "provedor", qualification: "Credor", order_group: 1,
    } : null;
    if (integracao.provedorAssina && !signatarioProvedor) throw new ErroDeConfissao("BLOQUEADA", "O provedor assina, mas o representante (nome e e-mail) não está cadastrado — o superadmin completa na ficha do provedor", 422, { bloqueios: ["representante do provedor não cadastrado"] });

    const rascunho = await storage.criarConfissao(providerId, {
      customerId, casoId: caso.id, negociacaoId: base.dto.negociacaoId, origem: base.dto.origem, ambiente,
      valorTotal: base.dto.valorTotal, valorOriginal: base.dto.valorOriginal, descontoPct: base.dto.descontoPct,
      parcelas: base.dto.parcelas, erpSource: base.dto.erpSource, erpLidoEm: base.dto.erpLidoEm ? new Date(base.dto.erpLidoEm) : null, erpFaturas: base.dto.anexo,
      modelo: modeloZapSign ? "zapsign" : "padrao", modeloVersao: integracao.templateId ?? VERSAO_DO_MODELO, modeloRevisado: base.dto.modeloRevisado,
      baseCanonica: canonica, textoHash: base.hash, geradoEm: agora,
      clienteNome: cliente.name, clienteCpfCnpj: base.dto.cliente.documento, clienteEmail: base.dto.cliente.email, clienteTelefone: base.dto.cliente.telefone,
      clienteEmailErp: base.contatoDoErp.email, clienteTelefoneErp: base.contatoDoErp.telefone, contatoAlteradoPorUserId: base.contatoAlterado ? userId : null,
      representanteNome: corpo.representante?.nome ?? null, representanteCpf: corpo.representante ? digitos(corpo.representante.cpf) : null,
      dataLimiteAssinatura: dataLimite, criadaPorUserId: userId, aprovadaPorUserId: userId, chaveIdempotencia: corpo.chaveIdempotencia,
    });
    if (pdf) await storage.guardarPdf(providerId, rascunho.id, "original", pdf);

    const zap: ClienteZapSign = clienteZapSign({ apiToken: integracao.apiToken, ambiente });

    let docToken: string | null = null;
    let webhookId: string | null = null;
    try {
      const papelPorToken = new Map<string, "cliente" | "provedor">();
      let doc;
      if (!modeloZapSign && pdf) {
        doc = await zap.criarDocumentoPorPdf({
          name: `Confissão de dívida — ${cliente.name} — ${provedor.tradeName || provedor.name}`,
          base64_pdf: pdf.toString("base64"),
          signers: signatarioProvedor ? [signatarioProvedor, signatarioCliente] : [signatarioCliente],
          lang: "pt-br",
          external_id: `confissao:${rascunho.id}`,
          folder_path: `consulta-isp/${providerId}`,
          brand_name: provedor.tradeName || provedor.name,
          date_limit_to_sign: dataLimite,
          reminder_every_n_days: LEMBRETE_A_CADA_DIAS,
          allow_refuse_signature: true,
          signature_order_active: !!signatarioProvedor,
        });
        docToken = doc.token;
        doc.signers.forEach(s => papelPorToken.set(s.token, s.external_id === "provedor" ? "provedor" : "cliente"));
      } else {
        doc = await zap.criarDocumentoPorModelo({
          template_id: integracao.templateId!,
          signer_name: signatarioCliente.name,
          signer_email: signatarioCliente.email,
          signer_phone_country: "55",
          signer_phone_number: signatarioCliente.phone_number,
          data: variaveisDoModeloZapSign(canonica, agora.toISOString()),
          lang: "pt-br",
          external_id: `confissao:${rascunho.id}`,
          folder_path: `consulta-isp/${providerId}`,
          date_limit_to_sign: dataLimite,
          reminder_every_n_days: LEMBRETE_A_CADA_DIAS,
          allow_refuse_signature: true,
          signature_order_active: !!signatarioProvedor,
          send_automatic_email: signatarioCliente.send_automatic_email,
          send_automatic_whatsapp: signatarioCliente.send_automatic_whatsapp,
        });
        docToken = doc.token;
        const primeiro = doc.signers[0];
        if (primeiro) {
          const atualizado = await zap.atualizarSignatario(primeiro.token, { auth_mode: signatarioCliente.auth_mode, cpf: signatarioCliente.cpf, require_cpf: true, validate_cpf: signatarioCliente.validate_cpf, require_selfie_photo: signatarioCliente.require_selfie_photo });
          doc = { ...doc, signers: [atualizado, ...doc.signers.slice(1)] };
          papelPorToken.set(primeiro.token, "cliente");
        }
        if (signatarioProvedor) {
          const prov = await zap.adicionarSignatario(doc.token, signatarioProvedor);
          doc = { ...doc, signers: [...doc.signers, prov] };
          papelPorToken.set(prov.token, "provedor");
        }
      }
      const webhook = await zap.registrarWebhookDoDocumento({ url: urlDoWebhookDeAssinatura(providerId), docToken: doc.token, cabecalho: { nome: CABECALHO_DO_WEBHOOK, valor: integracao.webhookSecret ?? "" } });
      webhookId = webhook.id;

      const enviada = await storage.transicionarConfissao(providerId, rascunho.id, "rascunho", "enviada", {
        zapsignDocToken: doc.token,
        webhookZapsignId: webhook.id,
        zapsignSigners: signatariosGravaveis(doc.signers, papelPorToken),
        zapsignSandbox: doc.sandbox,
        enviadaEm: agora,
        erroUltimo: null,
      });
      if (!enviada) throw new ErroDeConfissao("ESTADO_INVALIDO", "A confissão deixou de ser rascunho durante a emissão", 409);

      await registrarEventoDaConfissao(providerId, enviada, "enviada", userId, `Confissão de dívida enviada para assinatura eletrônica (R$ ${base.dto.valorTotal.toFixed(2).replace(".", ",")}) — ${ambiente === "sandbox" ? "TESTE, sem validade jurídica" : "ZapSign, produção"}`, { contatoAlterado: base.contatoAlterado, prescricaoRenunciada: corpo.confirmoPrescricao === true });
      await storage.atualizarCasoDeCobranca(providerId, caso.id, { proximaAcao: "aguardar assinatura da confissão de dívida", proximoContatoEm: maisDias(agora, LEMBRETE_A_CADA_DIAS) }, userId);
      return enviada;
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      logger.warn({ providerId, confissaoId: rascunho.id, docToken, erro: mensagem }, "CONFISSAO emissão falhou depois do rascunho");
      if (docToken) {
        if (webhookId) await zap.excluirWebhook(webhookId).catch(() => undefined);
        await zap.excluirDocumento(docToken).catch(err => logger.error({ providerId, docToken, err }, "CONFISSAO documento órfão não pôde ser apagado no ZapSign"));
      }
      await encerrarRascunhoFalho(providerId, rascunho.id, mensagem);
      throw e;
    }
  });
  if (resultado === null) throw new ErroDeConfissao("EM_ANDAMENTO", "Já há uma emissão em andamento para este cliente — aguarde", 409);
  return resultado;
}
