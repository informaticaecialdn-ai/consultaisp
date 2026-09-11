/**
 * A base da confissão (spec §6.2): o servidor monta o que se confessa, sem
 * digitação. Duas origens:
 *  - ACORDO: negociação em `aceita`/`ativa`; entram só as parcelas de
 *    `cobranca_parcelas` em pendente/atrasada/conciliacao_pendente; a entrada
 *    (numero 0) como "entrada" se ainda não recebida; guarda valor original,
 *    desconto e o já recebido. O saldo do ERP ao vivo não pode ser menor.
 *  - SALDO INTEGRAL: o ERP AO VIVO (forçado), só com ok && encontrado &&
 *    !leituraParcial; Anexo I = faturas vencidas; multa/equipamento com valor
 *    lido da descrição viram linha própria (desmarcável); encargos da política
 *    só no serviço (decisão 2.2-1). Σ faturas tem de bater com `dividaAtual`.
 * Sem leitura ao vivo NÃO se emite — nunca cai para a base sincronizada.
 *
 * O hash é o SHA-256 do JSON canônico (sem data/hora): o GET devolve, o POST
 * devolve de volta, e o servidor recalcula — se mudou, "A dívida mudou".
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { storage } from "../../storage";
import { logger } from "../../logger";
import { snapshotAoVivoDoCliente, type SnapshotAoVivo } from "../cobranca/snapshot-ao-vivo.service";
import { carteiraDoStatusErp } from "../../storage/cobranca.storage";
import { estadoDaIntegracao } from "../chat/chat-ponte.service";
import { ErroDeConfissao } from "../../assinatura/erro";
import { parcelasDaDescricao } from "@shared/cobranca/multa";
import { POLITICA_PADRAO, ROTULO_ORIGEM_DA_COBRANCA, prescricaoPorAtraso, validarPolitica, valorAtualizado, type Encargos, type Politica } from "@shared/cobranca";
import {
  baseCanonica, renderizarConfissao, serializarBase, textoDaConfissao, variaveisDoModeloZapSign, VERSAO_DO_MODELO,
  type BaseCanonica, type EntradaDoModelo, type Representante,
} from "@shared/cobranca/confissao-modelo";
import {
  custoDaEmissao, PRAZO_MAXIMO_DO_VENCIMENTO_DIAS,
  type AmbienteDeAssinatura, type AuthModeDoCliente, type BaseDaConfissaoDto, type EstadoDaAssinatura, type FaturaDoAnexo, type OrigemDaConfissao, type ParcelaConfessada,
} from "@shared/cobranca/confissao";
import type { CobrancaCaso, Customer, Provider } from "@shared/schema";
import type { IntegracaoComCredencial } from "../../storage/assinatura.storage";
import type { NegociacaoComParcelas } from "../../storage/cobranca.storage";

export interface OpcoesDaBase {
  vencimento?: string | null;
  faturasExcluidas?: string[];
  email?: string | null;
  telefone?: string | null;
  representante?: Representante | null;
  hoje?: Date;
}

export interface BaseMontada {
  dto: BaseDaConfissaoDto;
  /** null quando há bloqueio de configuração/cadastro que impede montar o texto. */
  entrada: EntradaDoModelo | null;
  canonica: BaseCanonica | null;
  hash: string | null;
  cliente: Customer | null;
  provedor: Provider | null;
  caso: CobrancaCaso | null;
  negociacao: NegociacaoComParcelas | null;
  integracao: IntegracaoComCredencial | null;
  encargos: Encargos;
  contatoAlterado: boolean;
  contatoDoErp: { email: string | null; telefone: string | null };
  snapshot: SnapshotAoVivo | null;
}

const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
/** O MESMO validador do POST de emissão (`EmissaoSchema.clienteEmail`): o que a base aceita, a emissão aceita. */
const formatoDeEmail = z.string().email();
/** Nome com menos de 3 letras é o operador no meio da digitação — a mesma régua do POST (`representante.nome` min 3). */
const representanteInformado = (r: Representante | null | undefined): r is Representante => !!r && r.nome.trim().length >= 3;
const centavos = (n: number) => Math.round(n * 100) / 100;
const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const maisDias = (d: Date, dias: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias);
const diasEntre = (deIso: string, ate: Date) => Math.max(0, Math.round((new Date(ate.getFullYear(), ate.getMonth(), ate.getDate()).getTime() - new Date(`${deIso}T00:00:00`).getTime()) / 86_400_000));

/** SHA-256 do JSON canônico SEM a hora da leitura: `erpLidoEm` muda a cada leitura ao vivo e não é a dívida — o hash tem de sobreviver ao GET→POST. */
export function hashDaBase(canonica: BaseCanonica): string {
  return createHash("sha256").update(serializarBase({ ...canonica, erpLidoEm: null })).digest("hex");
}

/** A mesma leitura de `carregarPolitica` (cobranca.routes.ts), sem importar o router. */
export async function politicaDoProvedor(providerId: number): Promise<Politica> {
  const linha = await storage.getPoliticaDeCobranca(providerId);
  if (!linha) return POLITICA_PADRAO;
  const r = validarPolitica({ etapas: linha.etapas, negociacao: linha.negociacao, encargos: linha.encargos, janelaContato: linha.janelaContato, economia: linha.economia, acordo: linha.acordo, pausada: linha.pausada, pausadaMotivo: linha.pausadaMotivo });
  if (!r.ok) {
    logger.warn({ providerId, erros: r.erros }, "CONFISSAO politica gravada invalida; aplicando o padrao");
    return POLITICA_PADRAO;
  }
  return r.politica;
}

function enderecoDoCliente(c: Customer): string | null {
  const partes = [c.address, c.addressNumber, c.neighborhood, c.city && c.state ? `${c.city}/${c.state}` : c.city, c.cep].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}
function enderecoDoProvedor(p: Provider): string | null {
  const partes = [p.addressStreet, p.addressNumber, p.addressNeighborhood, p.addressCity && p.addressState ? `${p.addressCity}/${p.addressState}` : p.addressCity, p.addressZip].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}

/** As faturas vencidas do snapshot como linhas do Anexo I. */
function anexoDoSnapshot(snapshot: SnapshotAoVivo, hoje: Date, encargos: Encargos): { linhas: FaturaDoAnexo[]; indeterminadas: number } {
  const faturas = snapshot.cliente?.faturas ?? [];
  const hojeIso = isoDia(hoje);
  const linhas: FaturaDoAnexo[] = [];
  let indeterminadas = 0;
  for (const f of faturas) {
    if (!f.ref || f.vencimento >= hojeIso) continue;
    const valor = centavos(f.valor);
    const partes = parcelasDaDescricao(f.descricao, valor);
    const diasAtraso = diasEntre(f.vencimento, hoje);
    const saida = centavos(partes.multa + partes.equipamento);
    if (partes.indeterminada) {
      indeterminadas++;
      linhas.push({ chave: f.ref, erpRef: f.ref, descricao: f.descricao ?? null, vencimento: f.vencimento, valor, classe: "indeterminada", diasAtraso, multa: 0, juros: 0 });
      continue;
    }
    if (saida > 0 && saida >= valor) {
      const classe = partes.equipamento > partes.multa ? "equipamento" : "multa";
      linhas.push({ chave: f.ref, erpRef: f.ref, descricao: f.descricao ?? null, vencimento: f.vencimento, valor, classe, diasAtraso, multa: 0, juros: 0 });
      continue;
    }
    const servico = centavos(valor - saida);
    const enc = valorAtualizado(servico, diasAtraso, encargos);
    linhas.push({ chave: f.ref, erpRef: f.ref, descricao: f.descricao ?? null, vencimento: f.vencimento, valor: servico, classe: "servico", diasAtraso, multa: enc.multa, juros: enc.juros });
    if (partes.multa > 0) linhas.push({ chave: `${f.ref}#multa`, erpRef: f.ref, descricao: f.descricao ?? null, vencimento: f.vencimento, valor: centavos(partes.multa), classe: "multa", diasAtraso, multa: 0, juros: 0 });
    if (partes.equipamento > 0) linhas.push({ chave: `${f.ref}#equipamento`, erpRef: f.ref, descricao: f.descricao ?? null, vencimento: f.vencimento, valor: centavos(partes.equipamento), classe: "equipamento", diasAtraso, multa: 0, juros: 0 });
  }
  return { linhas, indeterminadas };
}

function leituraAoVivoServe(s: SnapshotAoVivo | null): s is SnapshotAoVivo & { cliente: NonNullable<SnapshotAoVivo["cliente"]> } {
  return !!s && s.ok && s.encontrado && !s.leituraParcial && !!s.cliente;
}

export async function montarBase(providerId: number, customerId: number, opcoes: OpcoesDaBase = {}): Promise<BaseMontada> {
  const hoje = opcoes.hoje ?? new Date();
  const bloqueios: string[] = [];
  const avisos: string[] = [];

  let integracao: IntegracaoComCredencial | null = null;
  try {
    integracao = (await storage.getIntegracaoComCredencial(providerId)) ?? null;
  } catch (e) {
    if (e instanceof ErroDeConfissao) bloqueios.push(e.message);
    else throw e;
  }
  if (!integracao && bloqueios.length === 0) bloqueios.push("assinatura eletrônica não configurada — o superadmin cadastra o ZapSign do provedor");
  else if (integracao && !integracao.isEnabled) bloqueios.push("a integração com o ZapSign está salva mas não ativada — o superadmin precisa clicar em Ativar");
  // E-mail para o ZapSign entregar o link; CPF para o documento dizer quem
  // assinou pelo credor. Com um dos dois faltando, o signatário do credor
  // assinaria um documento que não o identifica — a cláusula abaixo usa esta
  // mesma condição.
  const credorAssinaIdentificado = !!(integracao?.provedorAssina && integracao.signatarioNome && integracao.signatarioCpf && integracao.signatarioEmail);
  if (integracao?.provedorAssina && !credorAssinaIdentificado) {
    bloqueios.push("o provedor assina, mas o representante (nome, CPF e e-mail) não está cadastrado — o superadmin completa na ficha do provedor");
  }

  const [provedor, cliente, caso, politica] = await Promise.all([
    storage.getProvider(providerId),
    // UM cliente, pelo id E pelo provedor — a base é relida a cada escolha do diálogo.
    storage.obterCliente(providerId, customerId).then(c => c ?? null),
    storage.casoAbertoDoCliente(providerId, customerId),
    politicaDoProvedor(providerId),
  ]);
  const encargos = politica.encargos;
  const ambiente = (integracao?.ambiente as AmbienteDeAssinatura | undefined) ?? "sandbox";
  const authMode = (integracao?.authModeCliente as AuthModeDoCliente | undefined) ?? "assinaturaTela-tokenWhatsapp";
  const vazio = (origem: OrigemDaConfissao, extra: Partial<BaseDaConfissaoDto> = {}): BaseMontada => ({
    dto: {
      origem, casoId: caso?.id ?? null, negociacaoId: null,
      cliente: { nome: cliente?.name ?? "", documento: digitos(cliente?.cpfCnpj), pessoaJuridica: digitos(cliente?.cpfCnpj).length === 14, email: cliente?.email ?? null, telefone: cliente?.phone ?? null, endereco: cliente ? enderecoDoCliente(cliente) : null },
      valorTotal: 0, valorOriginal: null, descontoPct: null, recebidoDoAcordo: null, encargos: { multa: 0, juros: 0, multaPct: encargos.multaPct, jurosMesPct: encargos.jurosMesPct },
      parcelas: [], anexo: [], faturasIndeterminadas: 0, faturasDeSaida: [], erpSource: null, erpLidoEm: null, dividaAtualDoErp: null,
      vencimento: { minimo: isoDia(maisDias(hoje, (integracao?.prazoAssinaturaDias ?? 15) + 1)), maximo: isoDia(maisDias(hoje, PRAZO_MAXIMO_DO_VENCIMENTO_DIAS)), escolhido: opcoes.vencimento ?? null },
      bloqueios, avisos, prescrita: false, baseHash: null, previa: null,
      custo: custoDaEmissao({ authMode, ambiente, enviarWhatsapp: !!(opcoes.telefone ?? cliente?.phone), exigirSelfie: !!integracao?.exigirSelfie }),
      ambiente, modeloRevisado: !!integracao?.modeloRevisadoEm,
      ...extra,
    },
    entrada: null, canonica: null, hash: null, cliente, provedor: provedor ?? null, caso: caso ?? null, negociacao: null, integracao, encargos,
    contatoAlterado: false, contatoDoErp: { email: null, telefone: null }, snapshot: null,
  });

  if (!cliente || !provedor) {
    bloqueios.push("cliente não encontrado nesta carteira");
    return vazio("saldo_integral");
  }
  if (!caso) bloqueios.push("abra o caso antes — a confissão exige caso de cobrança vivo");
  const documento = digitos(cliente.cpfCnpj);
  const pessoaJuridica = documento.length === 14;
  if (!documento) bloqueios.push("cliente sem CPF/CNPJ no cadastro — não há quem confesse");
  if (pessoaJuridica && !representanteInformado(opcoes.representante)) bloqueios.push("devedor pessoa jurídica: informe nome e CPF do representante legal que assina");

  // O acordo, quando existe, manda; senão o saldo integral.
  const negociacoes = caso ? await storage.listarNegociacoesDoCaso(providerId, caso.id) : [];
  const negociacao = negociacoes.find(n => n.status === "aceita" || n.status === "ativa") ?? null;
  const origem: OrigemDaConfissao = negociacao ? "acordo" : "saldo_integral";

  // A leitura ao vivo é obrigatória nas duas origens: no saldo integral é a base; no acordo, a reconferência.
  const snapshot = documento ? await snapshotAoVivoDoCliente(providerId, documento, { forcar: true }) : null;
  const aoVivo = leituraAoVivoServe(snapshot);
  if (!aoVivo) bloqueios.push(`o ERP não respondeu — sem leitura ao vivo não se emite título${snapshot?.erro ? ` (${snapshot.erro})` : ""}`);
  const contatoDoErp = { email: (aoVivo && snapshot.cliente.email) || cliente.email || null, telefone: (aoVivo && snapshot.cliente.telefone) || cliente.phone || null };
  const email = opcoes.email !== undefined && opcoes.email !== null ? (opcoes.email.trim() || null) : contatoDoErp.email;
  const telefone = opcoes.telefone !== undefined && opcoes.telefone !== null ? (digitos(opcoes.telefone) || null) : contatoDoErp.telefone;
  const contatoAlterado = (email ?? null) !== (contatoDoErp.email ?? null) || digitos(telefone) !== digitos(contatoDoErp.telefone);
  if (!email && !telefone) bloqueios.push("cliente sem e-mail e sem telefone — informe um dos dois para o ZapSign entregar o documento");
  // O e-mail DIGITADO chega aqui a cada pausa do operador, pela metade inclusive:
  // formato inválido é bloqueio (o diálogo segue de pé), não 400 da rota.
  const emailDigitado = opcoes.email?.trim() || null;
  if (emailDigitado && !formatoDeEmail.safeParse(emailDigitado).success) bloqueios.push("e-mail do cliente inválido");
  if (contatoAlterado) avisos.push("contato diferente do cadastro do ERP: a emissão exige validação do CPF pelo ZapSign (validate_cpf)");

  const { linhas: anexoCompleto, indeterminadas } = aoVivo ? anexoDoSnapshot(snapshot, hoje, encargos) : { linhas: [], indeterminadas: 0 };
  const excluidas = new Set(opcoes.faturasExcluidas ?? []);
  let anexo = anexoCompleto.filter(l => !excluidas.has(l.chave));
  const faturasDeSaida = anexoCompleto.filter(l => l.classe === "multa" || l.classe === "equipamento").map(l => l.chave);
  if (indeterminadas > 0) avisos.push(`${indeterminadas} fatura${indeterminadas === 1 ? "" : "s"} mistura mensalidade e multa sem valores — confira no ERP`);
  const diasAtrasoMax = Math.max(0, ...anexoCompleto.map(l => l.diasAtraso), aoVivo ? snapshot.cliente.diasAtraso : 0);
  const prescricao = prescricaoPorAtraso(diasAtrasoMax, hoje);
  const prescrita = !!prescricao?.prescrita;
  if (prescrita) bloqueios.push("dívida prescrita — confessá-la renuncia à prescrição (CC art. 191); decisão do provedor com parecer jurídico");

  const prazo = integracao?.prazoAssinaturaDias ?? 15;
  const vencimentoMinimo = isoDia(maisDias(hoje, prazo + 1));
  const vencimentoMaximo = isoDia(maisDias(hoje, PRAZO_MAXIMO_DO_VENCIMENTO_DIAS));

  let parcelas: ParcelaConfessada[] = [];
  let valorTotal = 0;
  let valorOriginal: number | null = null;
  let descontoPct: number | null = null;
  let recebidoDoAcordo: number | null = null;
  let somaMulta = 0;
  let somaJuros = 0;

  if (negociacao) {
    // No acordo o anexo é a ORIGEM da dívida: valor de face, sem encargos de hoje — o que se confessa são as parcelas.
    anexo = anexo.map(l => ({ ...l, multa: 0, juros: 0 }));
    const abertas = negociacao.parcelamento.filter(p => p.status === "pendente" || p.status === "atrasada" || p.status === "conciliacao_pendente");
    parcelas = abertas.map(p => ({ n: p.numero, rotulo: p.numero === 0 ? "entrada" : "parcela", valor: Number(p.valor), vencimento: p.vencimento }));
    valorTotal = centavos(parcelas.reduce((s, p) => s + p.valor, 0));
    valorOriginal = Number(negociacao.valorOriginal);
    descontoPct = Number(negociacao.descontoPct) || null;
    recebidoDoAcordo = centavos(negociacao.parcelamento.filter(p => p.status === "paga").reduce((s, p) => s + Number(p.valorPago ?? p.valor), 0)) || null;
    if (parcelas.length === 0) bloqueios.push("o acordo não tem parcela em aberto — nada a formalizar");
    if (aoVivo && snapshot.cliente.dividaAtual < valorTotal) bloqueios.push(`o saldo no ERP (${reais(snapshot.cliente.dividaAtual)}) é menor que o do acordo (${reais(valorTotal)}) — confira antes de formalizar`);
  } else if (aoVivo) {
    const somaFaturas = centavos(anexoCompleto.reduce((s, l) => s + l.valor, 0));
    if (anexoCompleto.length === 0) bloqueios.push("nada a formalizar — sem fatura vencida na leitura ao vivo");
    else if (Math.abs(somaFaturas - snapshot.cliente.dividaAtual) > 0.01) bloqueios.push(`as faturas vencidas lidas somam ${reais(somaFaturas)} e o ERP informa ${reais(snapshot.cliente.dividaAtual)} de saldo — confira no ERP antes de emitir`);
    somaMulta = centavos(anexo.reduce((s, l) => s + l.multa, 0));
    somaJuros = centavos(anexo.reduce((s, l) => s + l.juros, 0));
    valorTotal = centavos(anexo.reduce((s, l) => s + l.valor + l.multa + l.juros, 0));
    if (anexo.length === 0 && anexoCompleto.length > 0) bloqueios.push("todas as faturas foram desmarcadas — nada a formalizar");
    const vencimento = opcoes.vencimento ?? null;
    if (vencimento && (vencimento < vencimentoMinimo || vencimento > vencimentoMaximo)) bloqueios.push(`o vencimento do saldo integral tem de ficar entre ${dataBr(vencimentoMinimo)} e ${dataBr(vencimentoMaximo)}`);
    parcelas = [{ n: 1, rotulo: "parcela", valor: valorTotal, vencimento: vencimento ?? vencimentoMinimo }];
  }

  const carteira = carteiraDoStatusErp(cliente.status);
  const origemDaCobranca = politica.acordo[carteira].origemDaCobranca;
  const meioDePagamento = origemDaCobranca === "nao_definida" ? "boleto ou PIX enviado pelo credor" : ROTULO_ORIGEM_DA_COBRANCA[origemDaCobranca].toLowerCase();

  const entrada: EntradaDoModelo = {
    origem,
    ambiente,
    modeloRevisado: !!integracao?.modeloRevisadoEm,
    credor: {
      razaoSocial: provedor.name,
      cnpj: provedor.cnpj,
      endereco: enderecoDoProvedor(provedor),
      representante: credorAssinaIdentificado && integracao?.signatarioNome && integracao.signatarioCpf ? { nome: integracao.signatarioNome, cpf: integracao.signatarioCpf } : null,
    },
    devedor: { nome: cliente.name, documento, pessoaJuridica, representante: pessoaJuridica ? (opcoes.representante ?? null) : null, endereco: enderecoDoCliente(cliente), email, telefone },
    cadastroErp: cliente.erpCustomerId ?? null,
    plano: (aoVivo && snapshot.cliente.plano) || cliente.contractPlan || null,
    inicioContrato: (aoVivo && snapshot.cliente.contractStartDate) || cliente.contractStartDate || null,
    erpLidoEm: aoVivo ? snapshot.lidoEm : null,
    valorTotal, valorOriginal, descontoPct, recebidoDoAcordo, parcelas, meioDePagamento,
    encargos: { multaPct: encargos.multaPct, jurosMesPct: encargos.jurosMesPct },
    anexo,
  };
  const canonica = baseCanonica(entrada);
  const hash = hashDaBase(canonica);
  const previa = integracao?.templateId
    ? { modelo: "zapsign" as const, templateId: integracao.templateId, variaveis: variaveisDoModeloZapSign(canonica, hoje.toISOString()) }
    : { modelo: "padrao" as const, titulo: "Instrumento particular de confissão de dívida", texto: textoDaConfissao(renderizarConfissao(canonica, hoje.toISOString(), hash)) };

  const esqueleto = vazio(origem);
  return {
    ...esqueleto,
    dto: {
      ...esqueleto.dto,
      negociacaoId: negociacao?.id ?? null,
      cliente: { nome: cliente.name, documento, pessoaJuridica, email, telefone, endereco: enderecoDoCliente(cliente) },
      valorTotal, valorOriginal, descontoPct, recebidoDoAcordo,
      encargos: { multa: somaMulta, juros: somaJuros, multaPct: encargos.multaPct, jurosMesPct: encargos.jurosMesPct },
      parcelas, anexo, faturasIndeterminadas: indeterminadas, faturasDeSaida,
      erpSource: snapshot?.erpSource ?? null, erpLidoEm: aoVivo ? snapshot.lidoEm : null, dividaAtualDoErp: aoVivo ? snapshot.cliente.dividaAtual : null,
      vencimento: { minimo: vencimentoMinimo, maximo: vencimentoMaximo, escolhido: opcoes.vencimento ?? null },
      bloqueios, avisos, prescrita, baseHash: hash, previa,
      custo: custoDaEmissao({ authMode, ambiente, enviarWhatsapp: !!telefone, exigirSelfie: !!integracao?.exigirSelfie }),
    },
    entrada, canonica, hash, negociacao, contatoAlterado, contatoDoErp, snapshot,
  };
}

export async function estadoDaAssinatura(providerId: number): Promise<EstadoDaAssinatura> {
  let integracao: IntegracaoComCredencial | null = null;
  let motivo: string | null = null;
  try {
    integracao = (await storage.getIntegracaoComCredencial(providerId)) ?? null;
  } catch (e) {
    if (e instanceof ErroDeConfissao) motivo = e.message;
    else throw e;
  }
  if (!integracao && !motivo) motivo = "assinatura eletrônica não configurada — o superadmin cadastra o ZapSign do provedor";
  else if (integracao && !integracao.isEnabled) motivo = "integração com o ZapSign salva mas não ativada — o superadmin precisa clicar em Ativar";
  const chat = await estadoDaIntegracao(providerId).catch(() => null);
  const ambiente = (integracao?.ambiente as AmbienteDeAssinatura | undefined) ?? null;
  const authMode = (integracao?.authModeCliente as AuthModeDoCliente | undefined) ?? null;
  return {
    configurada: !!integracao,
    ativa: !!integracao?.isEnabled,
    ambiente,
    modelo: integracao?.templateId ? "zapsign" : "padrao",
    modeloRevisado: !!integracao?.modeloRevisadoEm,
    provedorAssina: !!integracao?.provedorAssina,
    authMode,
    custo: ambiente && authMode ? custoDaEmissao({ authMode, ambiente, enviarWhatsapp: true, exigirSelfie: !!integracao?.exigirSelfie }) : null,
    prazoAssinaturaDias: integracao?.prazoAssinaturaDias ?? null,
    chatDisponivel: !!chat?.ligado && !!chat?.canal && ambiente === "producao",
    motivo,
  };
}

export { VERSAO_DO_MODELO };
