/**
 * O relatório da consulta SPC como documento em blocos — o mesmo que a tela
 * mostra, montado a partir da LINHA gravada em `spc_consultations` (o
 * provedor pagou por ela; salvar em PDF nunca consulta o SPC de novo). O PDF
 * em si é o gerador genérico de `server/assinatura/pdf.ts`.
 *
 * O XML cru que a linha guarda para auditoria fica de fora, como na tela. Os
 * formatadores são os do modelo da confissão de dívida, que é também de onde
 * vem o tipo do documento em blocos.
 */
import type { SpcConsultation } from "@shared/schema";
import {
  dataBr, dataHoraBr, formatarDocumento, formatarReais,
  type BlocoDoDocumento, type DocumentoRenderizado,
} from "@shared/cobranca/confissao-modelo";
import type { SpcResult } from "./spc-parser";

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
const ou = (v: string | null | undefined, vazio = "—") => (v && String(v).trim()) || vazio;
const data = (iso: string | null | undefined) => (iso ? dataBr(iso) : "—");
const reais = (n: unknown) => formatarReais(Number(n) || 0);
const kv = (linhas: string[][]): BlocoDoDocumento => ({ tipo: "tabela", cabecalho: ["campo", "valor"], linhas });

export function documentoDaConsultaSpc({ consulta, provedor, geradoEm }: EntradaDoPdfSpc): DocumentoRenderizado {
  const r = (consulta.result ?? {}) as ResultadoGravado;
  const simulado = r.simulado === true;
  const cad = r.cadastralData;
  const pessoaJuridica = cad?.tipo === "PJ";
  const rotuloDoc = pessoaJuridica ? "CNPJ" : "CPF";
  const documento = formatarDocumento(consulta.cpfCnpj || cad?.cpfCnpj || "");
  const consultadoEm = r.consultadoEm ?? (consulta.createdAt ? new Date(consulta.createdAt).toISOString() : null);
  const geradoEmIso = geradoEm.toISOString();
  const restricoes = r.restrictions ?? [];
  const blocos: BlocoDoDocumento[] = [];

  blocos.push({ tipo: "titulo", texto: simulado ? "CONSULTA SPC BRASIL — SIMULADO" : "CONSULTA SPC BRASIL" });

  blocos.push({ tipo: "subtitulo", texto: "IDENTIFICAÇÃO DA CONSULTA" });
  blocos.push(kv([
    ["Documento consultado", `${rotuloDoc} ${documento}`],
    ["Código da consulta", ou(consulta.consultaId)],
    ["Protocolo SPC", ou(r.protocolo)],
    ["Consultado em", consultadoEm ? dataHoraBr(consultadoEm) : "—"],
    ["Consultado por", ou(provedor.name)],
    ["Créditos cobrados", r.creditosCobrados != null ? String(r.creditosCobrados) : "—"],
    ["Documento gerado em", dataHoraBr(geradoEmIso)],
  ]));

  blocos.push({ tipo: "subtitulo", texto: "DADOS CADASTRAIS" });
  const dataDeOrigem = cad?.dataNascimento || cad?.dataFundacao;
  const cadastro: string[][] = [
    ["Nome", ou(cad?.nome)],
    [rotuloDoc, formatarDocumento(cad?.cpfCnpj || consulta.cpfCnpj || "")],
    [pessoaJuridica ? "Fundação" : "Nascimento", data(dataDeOrigem)],
  ];
  if (cad?.nomeMae) cadastro.push(["Nome da mãe", cad.nomeMae]);
  cadastro.push(["Situação na Receita Federal", ou(cad?.situacaoRf, "Não informada")]);
  if (cad?.obitoRegistrado) cadastro.push(["Óbito", "Registrado"]);
  const endereco = [cad?.endereco, [cad?.cidade, cad?.uf].filter(Boolean).join("/")].filter(Boolean).join(" — ");
  if (endereco) cadastro.push(["Endereço", endereco]);
  if (cad?.telefone) cadastro.push(["Telefone", cad.telefone]);
  if (cad?.naturezaJuridica) cadastro.push(["Natureza jurídica", cad.naturezaJuridica]);
  if (cad?.atividadePrincipal) cadastro.push(["Atividade principal", cad.atividadePrincipal]);
  blocos.push(kv(cadastro));

  blocos.push({ tipo: "subtitulo", texto: "ANÁLISE DE CRÉDITO" });
  const analise: string[][] = [
    ["Score SPC", r.score != null ? `${r.score}/1000` : "O produto contratado não devolve score"],
    ["Faixa", ou(r.riskLabel)],
  ];
  if (r.scoreDetalhe?.indiceRisco) analise.push(["Índice SPC", r.scoreDetalhe.indiceRisco]);
  if (r.rendaPresumida != null) analise.push(["Renda presumida", reais(r.rendaPresumida)]);
  if (r.limiteCreditoSugerido != null) analise.push(["Limite de crédito sugerido", reais(r.limiteCreditoSugerido)]);
  analise.push(["Análise do Consulta ISP", ou(r.recommendation)]);
  analise.push(["Restrições", String(restricoes.length)]);
  analise.push(["Total em restrições", reais(r.totalRestrictions)]);
  blocos.push(kv(analise));

  if (restricoes.length > 0) {
    blocos.push({ tipo: "subtitulo", texto: `RESTRIÇÕES ENCONTRADAS (${restricoes.length})` });
    blocos.push({
      tipo: "tabela",
      cabecalho: ["tipo", "credor", "valor", "data", "contrato", "vencimento", "gravidade"],
      linhas: restricoes.map(x => [
        ou(x.type).replace(/_/g, " "), ou(x.creditor), reais(x.value), data(x.date), ou(x.contrato), data(x.vencimento), gravidade(x.severity),
      ]),
    });
    // Tudo que o SPC devolveu sobre o registro: é com isto que o operador
    // cobra ou confere com o cliente — como o "Detalhes do registro" da tela.
    restricoes.forEach((x, i) => {
      const partes = [x.description, ...(x.detalhes ?? []).map(d => `${d.rotulo}: ${d.valor}`)].filter(Boolean);
      if (partes.length) blocos.push({ tipo: "paragrafo", texto: `Registro ${i + 1} — ${ou(x.creditor)}${x.origin ? ` (${x.origin})` : ""}: ${partes.join(" · ")}` });
    });
    blocos.push({ tipo: "paragrafo", destaque: true, texto: `Total em restrições: ${reais(r.totalRestrictions)}` });
  } else {
    blocos.push({ tipo: "subtitulo", texto: "RESTRIÇÕES" });
    blocos.push({ tipo: "paragrafo", texto: "Nenhuma restrição foi retornada para este documento nesta consulta." });
  }

  const pendencias = r.pendenciasFinanceiras ?? [];
  if (pendencias.length > 0) {
    blocos.push({ tipo: "subtitulo", texto: `PENDÊNCIAS FINANCEIRAS — OUTRAS FONTES (${pendencias.length})` });
    blocos.push({
      tipo: "tabela",
      cabecalho: ["origem", "título", "contrato", "data", "valor", "cidade", "avalista"],
      linhas: pendencias.map(p => [ou(p.origem), ou(p.titulo), ou(p.contrato), data(p.data), reais(p.valor), ou(p.cidade), p.avalista ? "sim" : "não"]),
    });
  }

  const anteriores = r.previousConsultations;
  const dias = anteriores?.diasConsiderados ?? 90;
  blocos.push({ tipo: "subtitulo", texto: `QUEM CONSULTOU ESTE DOCUMENTO (ÚLTIMOS ${dias} DIAS): ${anteriores?.total ?? 0}` });
  const lista = anteriores?.lista ?? [];
  if (lista.length > 0) {
    blocos.push({
      tipo: "tabela",
      cabecalho: ["associado", "entidade", "cidade/UF", "data"],
      linhas: lista.map(c => [ou(c.associado), ou(c.entidade), [c.cidade, c.uf].filter(Boolean).join("/") || "—", data(c.data)]),
    });
  } else {
    blocos.push({ tipo: "paragrafo", texto: "Nenhuma consulta de outro associado no período." });
  }

  const alertas = r.alerts ?? [];
  if (alertas.length > 0) {
    blocos.push({ tipo: "subtitulo", texto: "ALERTAS ESPECIAIS" });
    for (const a of alertas) blocos.push({ tipo: "paragrafo", destaque: true, texto: `[gravidade ${gravidade(a.severity)}] ${ou(a.message)}` });
  }

  const inoperantes = r.basesInoperantes ?? [];
  if (inoperantes.length > 0) {
    blocos.push({ tipo: "paragrafo", texto: `Bases inoperantes no momento da consulta (a ausência de registro delas não significa ausência de ocorrência): ${inoperantes.join(", ")}.` });
  }

  const referencia = consulta.consultaId ? consulta.consultaId : `nº ${consulta.id}`;
  blocos.push({ tipo: "rodape", texto: `Consulta ISP · relatório da consulta SPC ${referencia} · gerado em ${dataHoraBr(geradoEmIso)} a partir do retorno do SPC Brasil${r.protocolo ? ` (protocolo ${r.protocolo})` : ""}.` });
  blocos.push({ tipo: "rodape", texto: "Dados pessoais de uso restrito à análise de crédito do provedor que consultou. Guarde este arquivo com o mesmo cuidado que o sistema." });
  const avisos: string[] = [];
  if (simulado) {
    avisos.push("DEMONSTRAÇÃO: dados fictícios gerados pelo Consulta ISP. Nenhuma consulta foi feita ao SPC Brasil.");
    for (const a of avisos) blocos.push({ tipo: "rodape", texto: a });
  }

  return { titulo: simulado ? "Consulta SPC Brasil — SIMULADO" : "Consulta SPC Brasil", blocos, avisos };
}
