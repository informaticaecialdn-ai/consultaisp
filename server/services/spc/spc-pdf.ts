/**
 * O relatório da consulta SPC como documento em blocos — o MESMO modelo que a
 * tela mostra (`client/src/pages/consulta/consulta-spc.tsx`, seção do
 * resultado), na mesma ordem: faixa, identificação, dados cadastrais, score e
 * análise lado a lado, um cartão por restrição com todos os detalhes, total,
 * pendências, quem consultou, alertas e bases inoperantes. Montado a partir da
 * LINHA gravada em `spc_consultations` (o provedor pagou por ela; salvar em
 * PDF nunca consulta o SPC de novo). O PDF em si é o gerador genérico de
 * `server/assinatura/pdf.ts`: quem monta o documento não sabe de pdfkit.
 *
 * O XML cru que a linha guarda para auditoria fica de fora, como na tela. Os
 * formatadores são os do modelo da confissão de dívida, que é também de onde
 * vem o tipo do documento em blocos. Linha antiga (gravada antes de um campo
 * existir) sai com "—" no lugar, nunca "null"/"undefined".
 */
import type { SpcConsultation } from "@shared/schema";
import { formatarCreditos } from "@shared/planos";
import {
  dataBr, dataHoraBr, formatarDocumento, formatarReais,
  type BlocoDoDocumento, type CampoDaGrade, type DocumentoRenderizado, type TomDoBloco,
} from "@shared/cobranca/confissao-modelo";
import type { RestricaoSpc, SpcResult } from "./spc-parser";

/** A marca d'água do relatório de uma consulta simulada (instância de demonstração). */
export const MARCA_DAGUA_SIMULADO = "SIMULADO — DADOS FICTÍCIOS";

export interface EntradaDoPdfSpc {
  consulta: SpcConsultation;
  /** Quem consultou — vai no documento, para o arquivo dizer de quem é. */
  provedor: { name: string };
  geradoEm: Date;
}

/** O que a linha guarda em `result`: o `SpcResult` da tela mais o custo cobrado. */
type ResultadoGravado = Partial<SpcResult> & { creditosCobrados?: number };

/**
 * `consulta-spc-<código>.pdf`, ou o id da linha para as consultas anteriores
 * ao código. Nunca o documento consultado: arquivo circula.
 */
export function nomeDoArquivoDoPdfSpc(consulta: Pick<SpcConsultation, "id" | "consultaId">): string {
  const codigo = (consulta.consultaId ?? "").trim();
  const seguro = /^[A-Za-z0-9-]+$/.test(codigo) ? codigo : "";
  return `consulta-spc-${seguro || consulta.id}.pdf`;
}

const GRAVIDADE: Record<string, string> = { medium: "média", high: "alta", critical: "crítica" };
const gravidade = (s: string | undefined) => (s && GRAVIDADE[s]) || s || "—";
const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ou = (v: string | null | undefined, vazio = "—") => (v && String(v).trim()) || vazio;
const data = (iso: string | null | undefined) => (iso ? dataBr(iso) : "—");
const reais = (n: unknown) => formatarReais(Number(n) || 0);

/** Faixa de risco da tela → tom: baixo verde, médio dourado, alto e muito alto vermelho (`riskColors`). */
const TOM_DO_RISCO: Record<string, TomDoBloco> = { very_low: "ok", low: "ok", medium: "alerta", high: "perigo", very_high: "perigo" };
/** Gravidade da restrição → tom da etiqueta: média dourada, alta e crítica vermelhas (`severityColors`). */
const TOM_DA_GRAVIDADE: Record<string, TomDoBloco> = { medium: "alerta", high: "perigo", critical: "perigo" };
const tom = (mapa: Record<string, TomDoBloco>, chave: string | undefined): TomDoBloco => (chave && mapa[chave]) || "neutro";

const SEM_SCORE = "O produto contratado não devolve score. O veredito abaixo sai das restrições encontradas.";
const NENHUMA_RESTRICAO = "Nenhuma restrição foi retornada para este documento nesta consulta.";
const LGPD = "Dados pessoais de uso restrito à análise de crédito do provedor que consultou. Guarde este arquivo com o mesmo cuidado que o sistema.";

export function documentoDaConsultaSpc({ consulta, provedor, geradoEm }: EntradaDoPdfSpc): DocumentoRenderizado {
  const r = (consulta.result ?? {}) as ResultadoGravado;
  const simulado = r.simulado === true;
  const cad = r.cadastralData;
  const rotuloDoc = cad?.tipo === "PJ" ? "CNPJ" : "CPF";
  const documento = ou(formatarDocumento(consulta.cpfCnpj || cad?.cpfCnpj || ""));
  const consultadoEm = r.consultadoEm ?? (consulta.createdAt ? new Date(consulta.createdAt).toISOString() : null);
  const geradoEmIso = geradoEm.toISOString();
  const restricoes = r.restrictions ?? [];
  const comRestricoes = r.status === "restricted" || restricoes.length > 0;
  const blocos: BlocoDoDocumento[] = [];

  // Na demonstração o "SIMULADO" vai no selo (e na marca d'água que a rota põe): no título ele quebrava a faixa em duas linhas.
  const selos: Array<{ texto: string; tom: TomDoBloco }> = [comRestricoes ? { texto: "Com restrições", tom: "perigo" } : { texto: "Sem restrições", tom: "ok" }];
  if (simulado) selos.push({ texto: "SIMULADO · DADOS FICTÍCIOS", tom: "alerta" });
  blocos.push({
    tipo: "faixa",
    titulo: `Relatório SPC · ${rotuloDoc}: ${documento}`,
    subtitulo: consultadoEm ? `SPC Brasil · ${dataHoraBr(consultadoEm)}` : "SPC Brasil",
    selos,
  });

  // Como na tela: par sem valor não sai com um traço ao lado, para o operador
  // não achar que o sistema perdeu o número.
  const itens: Array<{ rotulo: string; valor: string; mono?: boolean }> = [];
  if (consulta.consultaId) itens.push({ rotulo: "IDENTIFICAÇÃO", valor: consulta.consultaId, mono: true });
  if (r.protocolo) itens.push({ rotulo: "PROTOCOLO EM SPC BRASIL", valor: r.protocolo, mono: true });
  if (provedor.name.trim()) itens.push({ rotulo: "CONSULTADO POR", valor: provedor.name.trim() });
  if (r.creditosCobrados != null) itens.push({ rotulo: "CRÉDITOS COBRADOS", valor: formatarCreditos(r.creditosCobrados) });
  itens.push({ rotulo: "DOCUMENTO GERADO EM", valor: dataHoraBr(geradoEmIso) });
  blocos.push({ tipo: "rotulos", itens });

  blocos.push({ tipo: "secao", titulo: "Dados Cadastrais" });
  blocos.push({ tipo: "grade", colunas: 3, campos: dadosCadastrais(cad, rotuloDoc, documento) });

  blocos.push({
    tipo: "painel",
    colunas: [
      { titulo: "Score de Crédito", blocos: scoreDeCredito(r) },
      {
        titulo: "Análise do Consulta ISP",
        blocos: [
          { tipo: "destaque", texto: ou(r.recommendation) },
          { tipo: "metricas", itens: [{ rotulo: "Restrições", valor: String(restricoes.length) }, { rotulo: "Total Dívidas", valor: reais(r.totalRestrictions) }] },
        ],
      },
    ],
  });

  if (restricoes.length > 0) {
    blocos.push({ tipo: "secao", titulo: `Restrições Encontradas: ${restricoes.length}`, tom: "perigo" });
    for (const x of restricoes) blocos.push(registro(x));
    blocos.push({ tipo: "total", rotulo: "Total em Restrições:", valor: reais(r.totalRestrictions), tom: "perigo" });
  } else if (comRestricoes) {
    // O próprio SPC sinalizou restrição (ex.: só pendência financeira) sem
    // registro detalhado: o cartão não pode ser verde ao lado do selo vermelho.
    blocos.push({ tipo: "aviso", texto: NENHUMA_RESTRICAO, tom: "alerta" });
  } else {
    blocos.push({ tipo: "aviso", titulo: "Sem restrições", texto: NENHUMA_RESTRICAO, tom: "ok" });
  }

  const pendencias = r.pendenciasFinanceiras ?? [];
  if (pendencias.length > 0) {
    blocos.push({ tipo: "secao", titulo: `Pendências financeiras — outras fontes (${pendencias.length})` });
    const cabecalho = ["Origem", "Título", "Contrato", "Data", "Valor", "Cidade", "Avalista"];
    const linhas = pendencias.map(p => [ou(p.origem), ou(p.titulo), ou(p.contrato), data(p.data), reais(p.valor), ou(p.cidade), p.avalista ? "sim" : "não"]);
    // Pesos fixos como as colunas da tela; o renderizador garante que nenhuma célula parte palavra, data ou valor ao meio.
    blocos.push({ tipo: "tabela", cabecalho, linhas, larguras: [22, 20, 16, 11, 11, 13, 7], alinhar: ["esq", "esq", "esq", "esq", "dir", "esq", "esq"], estilo: "grade" });
  }

  const anteriores = r.previousConsultations;
  const lista = anteriores?.lista ?? [];
  blocos.push({ tipo: "secao", titulo: `Quem consultou este documento (últimos ${anteriores?.diasConsiderados ?? 90} dias): ${anteriores?.total ?? 0}` });
  if (lista.length > 0) {
    blocos.push({
      tipo: "lista",
      linhas: lista.map(c => ({
        principal: ou(c.associado),
        secundario: [c.entidade, [c.cidade, c.uf].filter(Boolean).join(" / ")].filter(Boolean).join(" · ") || undefined,
        direita: data(c.data),
      })),
    });
  } else {
    blocos.push({ tipo: "aviso", texto: "Nenhuma consulta de outro associado no período.", tom: "neutro" });
  }

  const alertas = r.alerts ?? [];
  if (alertas.length > 0) {
    blocos.push({ tipo: "secao", titulo: "Alertas Especiais", tom: "alerta" });
    for (const a of alertas) blocos.push({ tipo: "aviso", texto: `[gravidade ${gravidade(a.severity)}] ${ou(a.message)}`, tom: a.severity === "critical" ? "perigo" : "alerta" });
  }

  const inoperantes = r.basesInoperantes ?? [];
  if (inoperantes.length > 0) {
    blocos.push({ tipo: "aviso", texto: `Bases inoperantes no momento da consulta (a ausência de registro delas não significa ausência de ocorrência): ${inoperantes.join(", ")}.`, tom: "neutro" });
  }

  const avisos: string[] = [];
  if (simulado) {
    avisos.push("DEMONSTRAÇÃO: dados fictícios gerados pelo Consulta ISP. Nenhuma consulta foi feita ao SPC Brasil.");
    for (const a of avisos) blocos.push({ tipo: "rodape", texto: a });
  }

  const referencia = consulta.consultaId ? consulta.consultaId : `nº ${consulta.id}`;
  return {
    titulo: simulado ? "Consulta SPC Brasil — SIMULADO" : "Consulta SPC Brasil",
    blocos,
    avisos,
    pagina: {
      cabecalho: ["Relatório SPC", `${rotuloDoc} ${documento}`, consulta.consultaId].filter(Boolean).join(" · "),
      rodapeEsquerda: `Consulta ISP · relatório da consulta SPC ${referencia} · gerado em ${dataHoraBr(geradoEmIso)}${r.protocolo ? ` (protocolo ${r.protocolo})` : ""}`,
      rodapeCentro: LGPD,
      numerar: true,
    },
  };
}

/** A grade "Dados Cadastrais" da tela: só os campos que existem; Situação RF verde quando regular/ativa, vermelha caso contrário. */
function dadosCadastrais(cad: ResultadoGravado["cadastralData"], rotuloDoc: string, documento: string): CampoDaGrade[] {
  const regular = /^(regular|ativa)$/i.test(cad?.situacaoRf ?? "");
  const campos: CampoDaGrade[] = [
    { rotulo: "Nome", valor: ou(cad?.nome), destaque: true },
    { rotulo: rotuloDoc, valor: ou(formatarDocumento(cad?.cpfCnpj || ""), documento) },
    { rotulo: cad?.tipo === "PJ" ? "Fundação" : "Nascimento", valor: data(cad?.dataNascimento || cad?.dataFundacao) },
  ];
  if (cad?.nomeMae) campos.push({ rotulo: "Nome da Mãe", valor: cad.nomeMae });
  campos.push({ rotulo: "Situação RF", valor: regular ? "Regular" : ou(cad?.situacaoRf, "Não informada"), tom: regular ? "ok" : "perigo" });
  if (cad?.obitoRegistrado) campos.push({ rotulo: "Óbito", valor: "Registrado", tom: "perigo", destaque: true });
  const endereco = [cad?.endereco, [cad?.cidade, cad?.uf].filter(Boolean).join("/")].filter(Boolean).join(" — ");
  if (endereco) campos.push({ rotulo: "Endereço", valor: endereco });
  if (cad?.telefone) campos.push({ rotulo: "Telefone", valor: cad.telefone });
  if (cad?.naturezaJuridica) campos.push({ rotulo: "Natureza jurídica", valor: cad.naturezaJuridica });
  if (cad?.atividadePrincipal) campos.push({ rotulo: "Atividade principal", valor: cad.atividadePrincipal });
  return campos;
}

/**
 * O cartão "Score de Crédito": o número grande com o selo da faixa e as linhas
 * menores (na grafia da tela: "índice SPC: B", "renda presumida"); sem score,
 * o aviso da tela e a faixa (com o que mais houver) numa grade.
 */
function scoreDeCredito(r: ResultadoGravado): BlocoDoDocumento[] {
  const faixa = { texto: ou(r.riskLabel), tom: tom(TOM_DO_RISCO, r.riskLevel) };
  const extras: CampoDaGrade[] = [];
  if (r.scoreDetalhe?.indiceRisco) extras.push({ rotulo: "índice SPC", valor: r.scoreDetalhe.indiceRisco });
  if (r.rendaPresumida != null) extras.push({ rotulo: "renda presumida", valor: reais(r.rendaPresumida) });
  if (r.limiteCreditoSugerido != null) extras.push({ rotulo: "limite de crédito sugerido", valor: reais(r.limiteCreditoSugerido) });
  if (r.score != null) {
    return [{ tipo: "indicador", valor: String(r.score), sufixo: "/1000", selo: faixa, linhas: extras.map(c => `${c.rotulo}: ${c.valor}`) }];
  }
  return [
    { tipo: "aviso", texto: SEM_SCORE, tom: "info" },
    { tipo: "grade", colunas: 2, campos: [{ rotulo: "Faixa de risco", valor: faixa.texto, tom: faixa.tom, destaque: true }, ...extras.map(c => ({ ...c, rotulo: capitalizar(c.rotulo) }))] },
  ];
}

/**
 * O cartão de uma restrição, como o da tela: etiqueta do tipo, credor,
 * descrição, valor/data/gravidade à direita e TODOS os detalhes que o SPC
 * devolveu — é com isto que o operador cobra ou confere com o cliente.
 */
function registro(x: Partial<RestricaoSpc>): BlocoDoDocumento {
  const campos: CampoDaGrade[] = (x.detalhes ?? []).map(d => ({ rotulo: ou(d.rotulo), valor: ou(d.valor) }));
  if (campos.length === 0) {
    // Linha gravada antes do parser trazer `detalhes`: cai para o que ela tem.
    if (x.contrato) campos.push({ rotulo: "Contrato", valor: x.contrato });
    if (x.vencimento) campos.push({ rotulo: "Vencimento", valor: dataBr(x.vencimento) });
    if (x.origin) campos.push({ rotulo: "Origem", valor: x.origin });
  }
  return {
    tipo: "registro",
    etiqueta: ou(x.type).replace(/_/g, " "),
    tomEtiqueta: tom(TOM_DA_GRAVIDADE, x.severity),
    titulo: ou(x.creditor),
    subtitulo: x.description || undefined,
    direita: { valor: reais(x.value), data: data(x.date), chip: capitalizar(gravidade(x.severity)) },
    campos,
    tomBorda: "perigo",
  };
}
