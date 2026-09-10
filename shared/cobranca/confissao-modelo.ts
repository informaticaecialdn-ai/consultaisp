/**
 * O modelo padrão da confissão de dívida — versão 1.0 (spec §7).
 *
 * Puro e determinístico: a mesma base canônica, o mesmo `geradoEm` e o mesmo
 * hash produzem o mesmo documento, em qualquer processo. O hash é do servidor
 * (SHA-256 de `serializarBase`), por isso ele entra aqui como argumento.
 *
 * Regra do texto: variável que falta SAI da frase — nunca "—", "null" ou "0".
 * Não existe número de contrato no sistema; `{{CONTRATO}}` não é variável.
 */
import { valorPorExtenso } from "./por-extenso";
import { AVISO_SANDBOX, AVISO_SEM_PARECER, ROTULO_CLASSE_DA_FATURA, type AmbienteDeAssinatura, type FaturaDoAnexo, type OrigemDaConfissao, type ParcelaConfessada } from "./confissao";

export const VERSAO_DO_MODELO = "1.0";

export interface Representante { nome: string; cpf: string }

export interface EntradaDoModelo {
  origem: OrigemDaConfissao;
  ambiente: AmbienteDeAssinatura;
  modeloRevisado: boolean;
  credor: { razaoSocial: string; cnpj: string; endereco: string | null; representante: Representante | null };
  devedor: { nome: string; documento: string; pessoaJuridica: boolean; representante: Representante | null; endereco: string | null; email: string | null; telefone: string | null };
  cadastroErp: string | null;
  plano: string | null;
  /** AAAA-MM-DD */
  inicioContrato: string | null;
  /** ISO — o instante da leitura ao vivo do ERP */
  erpLidoEm: string | null;
  valorTotal: number;
  valorOriginal: number | null;
  descontoPct: number | null;
  recebidoDoAcordo: number | null;
  parcelas: ParcelaConfessada[];
  meioDePagamento: string;
  encargos: { multaPct: number; jurosMesPct: number };
  anexo: FaturaDoAnexo[];
}

/** A entrada normalizada, com a versão do modelo e SEM data/hora — é o que o hash cobre. */
export interface BaseCanonica extends EntradaDoModelo { versao: string }

const centavos = (n: number) => Math.round(n * 100) / 100;
export const apenasDigitos = (s: string) => s.replace(/\D/g, "");

export function baseCanonica(e: EntradaDoModelo): BaseCanonica {
  const rep = (r: Representante | null) => (r ? { nome: r.nome.trim(), cpf: apenasDigitos(r.cpf) } : null);
  return {
    versao: VERSAO_DO_MODELO,
    origem: e.origem,
    ambiente: e.ambiente,
    modeloRevisado: e.modeloRevisado,
    credor: { razaoSocial: e.credor.razaoSocial.trim(), cnpj: apenasDigitos(e.credor.cnpj), endereco: e.credor.endereco, representante: rep(e.credor.representante) },
    devedor: { nome: e.devedor.nome.trim(), documento: apenasDigitos(e.devedor.documento), pessoaJuridica: e.devedor.pessoaJuridica, representante: rep(e.devedor.representante), endereco: e.devedor.endereco, email: e.devedor.email, telefone: e.devedor.telefone },
    cadastroErp: e.cadastroErp,
    plano: e.plano,
    inicioContrato: e.inicioContrato,
    erpLidoEm: e.erpLidoEm,
    valorTotal: centavos(e.valorTotal),
    valorOriginal: e.valorOriginal === null ? null : centavos(e.valorOriginal),
    descontoPct: e.descontoPct,
    recebidoDoAcordo: e.recebidoDoAcordo === null ? null : centavos(e.recebidoDoAcordo),
    parcelas: [...e.parcelas].sort((a, b) => a.n - b.n).map(p => ({ n: p.n, rotulo: p.rotulo, valor: centavos(p.valor), vencimento: p.vencimento })),
    meioDePagamento: e.meioDePagamento,
    encargos: { multaPct: e.encargos.multaPct, jurosMesPct: e.encargos.jurosMesPct },
    anexo: [...e.anexo].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.chave.localeCompare(b.chave))
      .map(f => ({ chave: f.chave, erpRef: f.erpRef, descricao: f.descricao, vencimento: f.vencimento, valor: centavos(f.valor), classe: f.classe, diasAtraso: f.diasAtraso, multa: centavos(f.multa), juros: centavos(f.juros) })),
  };
}

function ordenarChaves(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenarChaves);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map(k => [k, ordenarChaves(o[k])]));
  }
  return v;
}

/** JSON com chaves em ordem estável: mesma base → mesma string → mesmo hash. */
export function serializarBase(base: BaseCanonica): string {
  return JSON.stringify(ordenarChaves(base));
}

/* ── Formatação (manual, para não depender do ICU de cada máquina) ───── */

export function formatarReais(n: number): string {
  const [inteiro, dec] = Math.abs(n).toFixed(2).split(".");
  const milhares = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "-" : ""}R$ ${milhares},${dec}`;
}

export function formatarDocumento(doc: string): string {
  const d = apenasDigitos(doc);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

/** AAAA-MM-DD → DD/MM/AAAA, sem passar por Date (sem fuso). */
export function dataBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Instante ISO → "DD/MM/AAAA às HH:MM" em Brasília (sem horário de verão desde 2019: UTC−3 fixo). */
export function dataHoraBr(iso: string): string {
  const t = new Date(iso).getTime() - 3 * 60 * 60 * 1000;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} às ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(".", ",")}%`;

/* ── Render ──────────────────────────────────────────────────────────── */

export type BlocoDoDocumento =
  | { tipo: "titulo"; texto: string }
  | { tipo: "subtitulo"; texto: string }
  | { tipo: "paragrafo"; texto: string; destaque?: boolean }
  | { tipo: "tabela"; cabecalho: string[]; linhas: string[][] }
  | { tipo: "rodape"; texto: string };

export interface DocumentoRenderizado { titulo: string; blocos: BlocoDoDocumento[]; avisos: string[] }

function parte(devedorOuCredor: "DEVEDOR" | "CREDOR", nome: string, documento: string, pessoaJuridica: boolean, representante: Representante | null, endereco: string | null, contato: string | null): string {
  const doc = `${documento.length === 14 ? "CNPJ" : "CPF"} ${formatarDocumento(documento)}`;
  const partes = [`${nome}, ${doc}`];
  // O CREDOR (o provedor) é "representado"; a DEVEDORA pessoa jurídica é "representada". Devedor PF nunca tem representante (a base bloqueia).
  const verbo = devedorOuCredor === "CREDOR" ? "representado" : pessoaJuridica ? "representada" : "representado";
  if (representante) partes.push(`${verbo} por ${representante.nome}, CPF ${formatarDocumento(representante.cpf)}`);
  if (endereco) partes.push(`com endereço em ${endereco}`);
  if (contato) partes.push(contato);
  return `${devedorOuCredor}: ${partes.join(", ")}.`;
}

function contatoDoDevedor(d: BaseCanonica["devedor"]): string | null {
  const itens: string[] = [];
  if (d.email) itens.push(`e-mail ${d.email}`);
  if (d.telefone) itens.push(`telefone ${d.telefone}`);
  return itens.length ? itens.join(" e ") : null;
}

function clausulaOrigem(b: BaseCanonica): string {
  const dentro: string[] = [];
  if (b.cadastroErp) dentro.push(`cadastro nº ${b.cadastroErp} no sistema de gestão do credor`);
  if (b.plano) dentro.push(`plano ${b.plano}`);
  if (b.inicioContrato) dentro.push(`iniciada em ${dataBr(b.inicioContrato)}`);
  const parenteses = dentro.length ? ` (${dentro.join(", ")})` : "";
  const lidas = b.erpLidoEm ? `, lidas do sistema de gestão do credor em ${dataHoraBr(b.erpLidoEm)}` : "";
  return `CLÁUSULA 1ª — DA ORIGEM. A dívida confessada tem origem na relação de prestação de serviços de internet mantida com o CREDOR${parenteses}, conforme as faturas relacionadas no Anexo I (mensalidades e, quando ali indicado, multa rescisória e valor de equipamento em comodato não devolvido)${lidas}.`;
}

const valorEExtenso = (n: number) => `${formatarReais(n)} (${valorPorExtenso(n)})`;

/** O desconto do acordo é `descontoPct` sobre o valor ORIGINAL — nunca "original − saldo", que misturaria o já recebido. */
function descontoDoAcordo(b: BaseCanonica): number | null {
  if (b.valorOriginal === null || b.descontoPct === null || b.descontoPct <= 0) return null;
  return centavos((b.valorOriginal * b.descontoPct) / 100);
}

function clausulaConfissao(b: BaseCanonica): string {
  const desconto = descontoDoAcordo(b);
  if (b.valorOriginal !== null && desconto !== null) {
    const negociado = centavos(b.valorOriginal - desconto);
    const remanescente = b.recebidoDoAcordo
      ? ` O valor confessado corresponde ao saldo remanescente do acordo, já abatidos ${formatarReais(b.recebidoDoAcordo)} recebidos: ${valorEExtenso(b.valorTotal)}.`
      : ` O valor confessado é de ${valorEExtenso(b.valorTotal)}.`;
    return `CLÁUSULA 2ª — DA CONFISSÃO. O DEVEDOR reconhece e confessa dever ao CREDOR a quantia de ${valorEExtenso(b.valorOriginal)}. O CREDOR concede desconto de ${formatarReais(desconto)} (${pct(b.descontoPct!)}), condicionado ao pagamento integral e pontual das parcelas da Cláusula 3ª, resultando em ${valorEExtenso(negociado)}.${remanescente} O inadimplemento de qualquer parcela restabelece o valor original, abatidos os pagamentos efetuados.`;
  }
  const remanescente = b.origem === "acordo" && b.recebidoDoAcordo ? ` O valor corresponde ao saldo remanescente do acordo, já abatidos ${formatarReais(b.recebidoDoAcordo)} recebidos.` : "";
  return `CLÁUSULA 2ª — DA CONFISSÃO. O DEVEDOR reconhece e confessa dever ao CREDOR a quantia certa e determinada de ${valorEExtenso(b.valorTotal)}.${remanescente}`;
}

function linhaDaParcela(p: ParcelaConfessada): string {
  return `${p.n} — ${p.rotulo} — ${formatarReais(p.valor)} — ${dataBr(p.vencimento)}`;
}

function linhaDoAnexo(f: FaturaDoAnexo): string[] {
  return [f.erpRef, f.descricao ?? "", dataBr(f.vencimento), formatarReais(f.valor), ROTULO_CLASSE_DA_FATURA[f.classe], f.multa > 0 ? formatarReais(f.multa) : "", f.juros > 0 ? formatarReais(f.juros) : ""];
}

export function renderizarConfissao(b: BaseCanonica, geradoEm: string, hash: string): DocumentoRenderizado {
  const n = b.parcelas.length;
  const blocos: BlocoDoDocumento[] = [
    { tipo: "titulo", texto: "INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA" },
    { tipo: "subtitulo", texto: "DAS PARTES" },
    { tipo: "paragrafo", texto: parte("CREDOR", b.credor.razaoSocial, b.credor.cnpj, true, b.credor.representante, b.credor.endereco, null) },
    { tipo: "paragrafo", texto: parte("DEVEDOR", b.devedor.nome, b.devedor.documento, b.devedor.pessoaJuridica, b.devedor.representante, b.devedor.endereco, contatoDoDevedor(b.devedor)) },
    { tipo: "paragrafo", texto: "As partes acima qualificadas celebram o presente instrumento, que se rege pelas cláusulas seguintes." },
    { tipo: "paragrafo", texto: clausulaOrigem(b) },
    { tipo: "paragrafo", texto: clausulaConfissao(b) },
    { tipo: "paragrafo", texto: `CLÁUSULA 3ª — DO PAGAMENTO. O valor confessado será pago em ${n} parcela${n === 1 ? "" : "s"}, a saber, por ${b.meioDePagamento}:` },
    { tipo: "tabela", cabecalho: ["nº", "tipo", "valor", "vencimento"], linhas: b.parcelas.map(p => [String(p.n), p.rotulo, formatarReais(p.valor), dataBr(p.vencimento)]) },
    { tipo: "paragrafo", destaque: true, texto: `CLÁUSULA 4ª — DA MORA. O atraso no pagamento de qualquer parcela implica o vencimento antecipado do saldo, multa de ${pct(b.encargos.multaPct)} e juros de ${pct(b.encargos.jurosMesPct)} ao mês, com correção monetária pelo IPCA (Código Civil, art. 389, parágrafo único).` },
    { tipo: "paragrafo", destaque: true, texto: "CLÁUSULA 5ª — DO TÍTULO EXECUTIVO E DA ASSINATURA ELETRÔNICA. As partes declaram que este instrumento é constituído por meio eletrônico e assinado por assinatura eletrônica que ambas admitem como válida (MP 2.200-2/2001, art. 10, §2º), com integridade conferida pelo provedor de assinatura ZapSign (relatório de assinatura anexo), constituindo título executivo extrajudicial nos termos do art. 784, III e §4º, do Código de Processo Civil, dispensada a assinatura de testemunhas." },
    { tipo: "paragrafo", destaque: true, texto: "CLÁUSULA 6ª — DO FORO. Fica eleito o foro da comarca do domicílio do DEVEDOR, sem prejuízo do disposto no art. 781 do Código de Processo Civil." },
    { tipo: "subtitulo", texto: "ANEXO I — FATURAS DE ORIGEM DA DÍVIDA (lidas no sistema de gestão do credor)" },
    { tipo: "tabela", cabecalho: ["referência", "descrição", "vencimento", "valor", "natureza", "multa", "juros"], linhas: b.anexo.map(linhaDoAnexo) },
  ];
  const avisos: string[] = [];
  if (!b.modeloRevisado) avisos.push(AVISO_SEM_PARECER);
  if (b.ambiente === "sandbox") avisos.push(AVISO_SANDBOX);
  blocos.push({ tipo: "rodape", texto: `Consulta ISP · modelo padrão v${VERSAO_DO_MODELO} · gerado em ${dataHoraBr(geradoEm)} · hash ${hash.slice(0, 8)}` });
  for (const a of avisos) blocos.push({ tipo: "rodape", texto: a });
  return { titulo: "Instrumento particular de confissão de dívida", blocos, avisos };
}

/** O documento como texto corrido — para a prévia, os testes e o log. */
export function textoDaConfissao(doc: DocumentoRenderizado): string {
  return doc.blocos.map(bl => {
    if (bl.tipo === "tabela") return [bl.cabecalho.join(" | "), ...bl.linhas.map(l => l.join(" | "))].join("\n");
    return bl.texto;
  }).join("\n\n");
}

/* ── Modelo do próprio ZapSign ───────────────────────────────────────── */

export const VARIAVEIS_DO_MODELO_ZAPSIGN = [
  "{{CREDOR_RAZAO_SOCIAL}}", "{{CREDOR_CNPJ}}", "{{CREDOR_ENDERECO}}", "{{DEVEDOR_NOME}}", "{{DEVEDOR_CPF_CNPJ}}",
  "{{DEVEDOR_REPRESENTANTE}}", "{{DEVEDOR_ENDERECO}}", "{{VALOR_TOTAL}}", "{{VALOR_POR_EXTENSO}}", "{{VALOR_ORIGINAL}}",
  "{{DESCONTO}}", "{{PARCELAS}}", "{{CADASTRO_ERP}}", "{{PLANO}}", "{{INICIO_CONTRATO}}", "{{ANEXO_FATURAS}}",
  "{{ERP_LIDO_EM}}", "{{MULTA_PCT}}", "{{JUROS_PCT}}", "{{DATA}}",
] as const;

export function variaveisDoModeloZapSign(b: BaseCanonica, geradoEm: string): Array<{ de: string; para: string }> {
  const valorDoDesconto = descontoDoAcordo(b);
  const desconto = valorDoDesconto !== null ? `${formatarReais(valorDoDesconto)} (${pct(b.descontoPct!)})` : "";
  const valores: Record<(typeof VARIAVEIS_DO_MODELO_ZAPSIGN)[number], string> = {
    "{{CREDOR_RAZAO_SOCIAL}}": b.credor.razaoSocial,
    "{{CREDOR_CNPJ}}": formatarDocumento(b.credor.cnpj),
    "{{CREDOR_ENDERECO}}": b.credor.endereco ?? "",
    "{{DEVEDOR_NOME}}": b.devedor.nome,
    "{{DEVEDOR_CPF_CNPJ}}": formatarDocumento(b.devedor.documento),
    "{{DEVEDOR_REPRESENTANTE}}": b.devedor.representante ? `${b.devedor.representante.nome}, CPF ${formatarDocumento(b.devedor.representante.cpf)}` : "",
    "{{DEVEDOR_ENDERECO}}": b.devedor.endereco ?? "",
    "{{VALOR_TOTAL}}": formatarReais(b.valorTotal),
    "{{VALOR_POR_EXTENSO}}": valorPorExtenso(b.valorTotal),
    "{{VALOR_ORIGINAL}}": b.valorOriginal === null ? "" : formatarReais(b.valorOriginal),
    "{{DESCONTO}}": desconto,
    "{{PARCELAS}}": b.parcelas.map(linhaDaParcela).join("\n"),
    "{{CADASTRO_ERP}}": b.cadastroErp ?? "",
    "{{PLANO}}": b.plano ?? "",
    "{{INICIO_CONTRATO}}": b.inicioContrato ? dataBr(b.inicioContrato) : "",
    "{{ANEXO_FATURAS}}": b.anexo.map(f => linhaDoAnexo(f).filter(Boolean).join(" — ")).join("\n"),
    "{{ERP_LIDO_EM}}": b.erpLidoEm ? dataHoraBr(b.erpLidoEm) : "",
    "{{MULTA_PCT}}": pct(b.encargos.multaPct),
    "{{JUROS_PCT}}": pct(b.encargos.jurosMesPct),
    "{{DATA}}": dataHoraBr(geradoEm),
  };
  return VARIAVEIS_DO_MODELO_ZAPSIGN.map(de => ({ de, para: valores[de] }));
}
