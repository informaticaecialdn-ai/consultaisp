/**
 * Parser da resposta SOAP do WebService de Consulta do SPC Brasil
 * (`consultaWebService`, operacoes `consultar`, `listarProdutos` e
 * `detalharProduto`). Puro: XML entra, objeto sai. Nada de rede aqui — o
 * cliente HTTP mora em spc.service.ts.
 *
 * A resposta e `<ns2:resultado restricao="true|false" data="...">` com o
 * consumidor (PF ou PJ) e um bloco por INSUMO do produto: `<spc>`,
 * `<cheque-lojista>`, `<ccf>`, `<protesto>`, `<pendencia-financeira>`,
 * `<acao>`, `<consulta-realizada>`, `<alerta-documento>`, scores, renda
 * presumida... Cada bloco tem `<resumo quantidade-total valor-total
 * data-ultima-ocorrencia/>` e zero ou mais `<detalhe-xxx>` com os dados em
 * ATRIBUTOS. O manual e claro: "os elementos configurados em um produto
 * aparecem no retorno mesmo que nao exista informacao; nesses casos a
 * quantidade e 0" — entao bloco ausente e bloco com zero sao a mesma coisa
 * aqui, e insumo que o produto nao tem simplesmente nao aparece.
 *
 * Nomes de atributos e a hierarquia vieram dos exemplos oficiais da
 * documentacao v4.3 (produtos 325, 632, 634, 676, 679) e do XSD. Onde o
 * exemplo nao existia (spc-score-12-meses), os nomes vem do XSD.
 */
import { XMLParser } from "fast-xml-parser";

export type CategoriaErroSpc = "credencial" | "produto" | "documento" | "indisponivel" | "resposta";

export class SpcError extends Error {
  /**
   * Status HTTP de origem, quando houver. `withResilience` nao repete erro com
   * status 4xx — e credencial recusada nao melhora tentando de novo (e pode
   * bloquear o operador no SPC).
   */
  status?: number;

  constructor(message: string, readonly codigo?: string, readonly categoria: CategoriaErroSpc = "resposta", status?: number) {
    super(message);
    this.name = "SpcError";
    if (status != null) this.status = status;
  }
}

export type TipoRestricao =
  | "SPC" | "CHEQUE_LOJISTA" | "CCF" | "PROTESTO" | "ACAO_JUDICIAL" | "CHEQUE_SEM_FUNDO"
  /** contra-ordem, contra-ordem em documento diferente e contumacia: cheque sustado. */
  | "CHEQUE_SUSTADO"
  /** informacao-poder-judiciario: divida reconhecida em processo. */
  | "PODER_JUDICIARIO";

export interface RestricaoSpc {
  type: TipoRestricao;
  description: string;
  severity: "medium" | "high" | "critical";
  /** Quem registrou: associado, cartorio, banco... */
  creditor: string;
  /** Valor em reais, como string com duas casas (o client faz parseFloat). */
  value: string;
  /** ISO yyyy-mm-dd da ocorrencia/inclusao. */
  date: string;
  /** Cidade / UF de origem. */
  origin: string;
  contrato?: string;
  vencimento?: string;
  /** COMPRADOR, FIADOR ou AVALISTA no registro SPC. */
  papel?: string;
  /**
   * TODOS os dados que o SPC devolveu para esta ocorrencia, ja com rotulo
   * em portugues e valor formatado, na ordem em que fazem sentido na tela.
   * E o que o operador precisa para cobrar ou conferir com o cliente.
   */
  detalhes: Array<{ rotulo: string; valor: string }>;
}

export interface PendenciaFinanceira {
  origem: string;
  titulo: string;
  contrato?: string;
  data: string;
  valor: number;
  cidade?: string;
  avalista: boolean;
}

export interface ConsultaAnterior {
  associado: string;
  entidade?: string;
  cidade?: string;
  uf?: string;
  data: string;
}

export interface ResumoBloco {
  quantidade: number;
  valor: number;
  ultimaOcorrencia: string | null;
}

export interface SpcResult {
  cpfCnpj: string;
  protocolo: string | null;
  consultadoEm: string | null;
  /** O proprio SPC diz se algo do retorno representa restricao de credito. */
  restricao: boolean;
  cadastralData: {
    nome: string;
    cpfCnpj: string;
    dataNascimento?: string;
    dataFundacao?: string;
    nomeMae?: string;
    idade?: number;
    situacaoRf: string;
    obitoRegistrado: boolean;
    tipo: "PF" | "PJ";
    endereco?: string;
    cidade?: string;
    uf?: string;
    telefone?: string;
    naturezaJuridica?: string;
    atividadePrincipal?: string;
  };
  /**
   * Score 0-1000 SOMENTE quando o produto devolve um insumo de score. null
   * quando nao devolve — nunca um numero inventado a partir das restricoes.
   */
  score: number | null;
  scoreFonte?: "spc-score-12-meses" | "spc-score-3-meses" | "score-cadastro-positivo";
  scoreDetalhe?: { classe?: string; probabilidade?: number; indiceRisco?: string; tipoCliente?: string; mensagem?: string };
  riskLevel: "very_low" | "low" | "medium" | "high" | "very_high";
  riskLabel: string;
  recommendation: string;
  status: "clean" | "restricted";
  restrictions: RestricaoSpc[];
  /** Soma em reais de SPC + cheque lojista + protesto + acao. */
  totalRestrictions: number;
  resumo: {
    spc: ResumoBloco;
    chequeLojista: ResumoBloco;
    ccf: ResumoBloco;
    protesto: ResumoBloco;
    acao: ResumoBloco;
    pendenciaFinanceira: ResumoBloco;
    poderJudiciario: ResumoBloco;
  };
  /**
   * "Outras fontes de informacao" — costuma REPETIR os registros do SPC
   * (mesmos contratos). Fica separado para nao contar a divida duas vezes.
   */
  pendenciasFinanceiras: PendenciaFinanceira[];
  previousConsultations: {
    total: number;
    last90Days: number;
    diasConsiderados: number | null;
    bySegment: Record<string, number>;
    lista: ConsultaAnterior[];
  };
  alerts: { type: string; message: string; severity: "medium" | "high" | "critical" }[];
  rendaPresumida: number | null;
  limiteCreditoSugerido: number | null;
  basesInoperantes: string[];
  rawXml?: string;
}

export interface ProdutoSpc {
  codigo: number;
  nome: string;
  parametros: Array<{ nome: string; obrigatorio: boolean }>;
  insumosRetorno: Array<{ nome: string; codigo: number; opcional: boolean }>;
  insumosOpcionais: Array<{ nome: string; codigo: number }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

const lista = (x: unknown): any[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const attr = (o: any, nome: string): string | undefined => {
  const v = o?.[`@_${nome}`];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
};
const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
/** "2024-03-12T00:00:00-03:00" -> "2024-03-12". Devolve "" quando nao ha data. */
const data = (v: unknown): string => {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
};
const dinheiro = (n: number): string => n.toFixed(2);
const limpar = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();
/** "2024-03-12" -> "12/03/2024", sem passar por Date (fuso nao entra). */
const dataBr = (iso: string): string => (iso ? iso.split("-").reverse().join("/") : "");
const reais = (n: number): string => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Monta a lista de detalhes pulando o que veio vazio. */
function detalhesDe(pares: Array<[string, string | number | undefined | null]>): Array<{ rotulo: string; valor: string }> {
  return pares
    .map(([rotulo, v]) => ({ rotulo, valor: limpar(v == null ? "" : String(v)) }))
    .filter(d => d.valor !== "" && d.valor !== "undefined");
}

function telefoneAssociado(d: any): string {
  const t = d?.["telefone-associado"];
  const ddd = attr(t, "numero-ddd"), n = attr(t, "numero");
  // DDD "0" e como o SPC devolve 0800/4004: sai so o numero.
  return n ? (ddd && ddd !== "0" ? `(${ddd}) ${n}` : String(n)) : "";
}

function cidadeUf(no: any): { cidade?: string; uf?: string } {
  const c = no?.cidade ?? no;
  return { cidade: attr(c, "nome"), uf: attr(c?.estado, "sigla-uf") };
}

function resumoDe(bloco: any): ResumoBloco {
  const r = bloco?.resumo;
  return {
    quantidade: num(attr(r, "quantidade-total")),
    valor: num(attr(r, "valor-total")),
    ultimaOcorrencia: data(attr(r, "data-ultima-ocorrencia")) || null,
  };
}

const VAZIO: ResumoBloco = { quantidade: 0, valor: 0, ultimaOcorrencia: null };

function severidadePorValor(valor: number, piso: RestricaoSpc["severity"] = "medium"): RestricaoSpc["severity"] {
  const porValor: RestricaoSpc["severity"] = valor >= 1000 ? "critical" : valor >= 200 ? "high" : "medium";
  const ordem = { medium: 0, high: 1, critical: 2 };
  return ordem[porValor] >= ordem[piso] ? porValor : piso;
}

/** O envelope SOAP, ja sem prefixos, ou um SpcError se vier Fault. */
function corpo(xml: string): any {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new SpcError("Resposta do SPC nao e um XML valido", "XML", "resposta");
  }
  // <S:Body/> vazio vira "" no parser: e envelope valido, so sem conteudo.
  const body = doc?.Envelope?.Body;
  if (body == null) throw new SpcError("Resposta do SPC sem envelope SOAP", "SOAP", "resposta");
  const fault = body?.Fault;
  if (fault) {
    // faultstring pode vir com atributo (xml:lang): o parser o entrega como objeto.
    const txt = (v: any): string | undefined => (v && typeof v === "object" ? v["#text"] : v);
    const texto = limpar(String(txt(fault.faultstring) ?? txt(fault.Reason?.Text) ?? "Falha no SPC"));
    throw classificarFault(texto, limpar(String(txt(fault.faultcode) ?? "")));
  }
  return body;
}

/**
 * Os codigos vem do arquivo "CODIGOS DE ERRO DO SISTEMA WS" da documentacao:
 * CN_INT005.E2.3 operador e senha invalidos · E3 sem acesso · E4 sem acesso ao
 * produto · E8.2 CPF/CNPJ invalido · E8.3/E8.4 tipo de documento errado para
 * o produto · CN_GER001 erro interno.
 */
export function classificarFault(texto: string, faultcode = ""): SpcError {
  const t = texto.toUpperCase();
  const cod = (t.match(/CN_[A-Z]+\d+\.E[\d.]*\d/) || [])[0] || faultcode || undefined;
  if (/E2\.3|SENHA|OPERADOR N[AÃ]O POSSUI ACESSO AO SISTEMA|N[AÃ]O EXISTE/.test(t)) {
    return new SpcError(`SPC recusou o operador: ${texto}`, cod, "credencial");
  }
  if (/E4\b|ACESSO AO PRODUTO|PRODUTO INVALIDO|PRODUTO N[AÃ]O/.test(t)) {
    return new SpcError(`Produto nao liberado para este operador no SPC: ${texto}`, cod, "produto");
  }
  if (/E8\.\d|CPF\/CNPJ|DOCUMENTO/.test(t)) {
    return new SpcError(`SPC recusou o documento: ${texto}`, cod, "documento");
  }
  if (/INOPERANTE|INDISPON|TIMEOUT|CN_GER001/.test(t)) {
    return new SpcError(`SPC indisponivel no momento: ${texto}`, cod, "indisponivel");
  }
  return new SpcError(`SPC devolveu erro: ${texto}`, cod, "resposta");
}

// ── Consumidor ───────────────────────────────────────────────────────────────

function enderecoEmLinha(e: any): { endereco?: string; cidade?: string; uf?: string } {
  if (!e) return {};
  const partes = [attr(e, "logradouro"), attr(e, "numero"), attr(e, "complemento"), attr(e, "bairro")].filter(Boolean);
  const cep = attr(e, "cep");
  const { cidade, uf } = cidadeUf(e);
  return {
    endereco: [partes.join(", "), cep ? `CEP ${cep.padStart(8, "0")}` : ""].filter(Boolean).join(" · ") || undefined,
    cidade, uf,
  };
}

function telefoneEmLinha(t: any): string | undefined {
  const ddd = attr(t, "numero-ddd"), n = attr(t, "numero");
  return n ? `(${ddd ?? ""}) ${n}` : undefined;
}

function consumidor(resultado: any, doc: string): SpcResult["cadastralData"] {
  const c = resultado?.consumidor ?? {};
  const pf = c["consumidor-pessoa-fisica"];
  const pj = c["consumidor-pessoa-juridica"];

  if (pj) {
    const end = enderecoEmLinha(pj.endereco);
    return {
      tipo: "PJ",
      nome: limpar(attr(pj, "razao-social") ?? attr(pj, "nome-comercial") ?? "") || "Razão social não informada",
      cpfCnpj: attr(pj.cnpj, "numero") ?? doc,
      dataFundacao: data(attr(pj, "data-fundacao")) || undefined,
      situacaoRf: attr(pj["situacao-cnpj"], "descricao-situacao") ?? "Não informada",
      obitoRegistrado: false,
      naturezaJuridica: attr(pj["natureza-juridica"], "descricao"),
      atividadePrincipal: attr(pj["atividade-economica-principal"], "descricao"),
      telefone: telefoneEmLinha(pj.telefone),
      ...end,
    };
  }

  const end = enderecoEmLinha(pf?.endereco);
  const idade = attr(pf, "idade");
  return {
    tipo: "PF",
    nome: limpar(attr(pf, "nome") ?? "") || "Nome não informado",
    cpfCnpj: attr(pf?.cpf, "numero") ?? doc,
    dataNascimento: data(attr(pf, "data-nascimento")) || undefined,
    nomeMae: attr(pf, "nome-mae"),
    idade: idade ? Number(idade) : undefined,
    situacaoRf: attr(pf?.["situacao-cpf"], "descricao-situacao") ?? "Não informada",
    obitoRegistrado: false,
    telefone: telefoneEmLinha(pf?.["telefone-celular"]) ?? telefoneEmLinha(pf?.["telefone-residencial"]),
    ...end,
  };
}

// ── Blocos de restricao ──────────────────────────────────────────────────────

function restricoesSpc(bloco: any): RestricaoSpc[] {
  return lista(bloco?.["detalhe-spc"]).map(d => {
    const valor = num(attr(d, "valor"));
    const { cidade, uf } = cidadeUf(d["cidade-associado"]);
    const papel = attr(d, "comprador-fiador-avalista");
    const inclusao = data(attr(d, "data-inclusao"));
    const vencimento = data(attr(d, "data-vencimento"));
    const instituicao = attr(d, "registro-instituicao-financeira");
    return {
      type: "SPC",
      description: [
        "Registro de inadimplência",
        papel && papel !== "COMPRADOR" ? `como ${papel.toLowerCase()}` : "",
        instituicao === "SIM" ? "· instituição financeira" : "",
      ].filter(Boolean).join(" "),
      severity: severidadePorValor(valor),
      creditor: limpar(attr(d, "nome-associado") ?? "Associado não informado"),
      value: dinheiro(valor),
      date: inclusao,
      origin: [cidade, uf].filter(Boolean).join(" / ") || limpar(attr(d, "nome-entidade") ?? ""),
      contrato: attr(d, "contrato"),
      vencimento: vencimento || undefined,
      papel,
      detalhes: detalhesDe([
        ["Credor (associado)", attr(d, "nome-associado")],
        ["Entidade", attr(d, "nome-entidade")],
        ["Cidade", [cidade, uf].filter(Boolean).join(" / ")],
        ["Telefone do credor", telefoneAssociado(d)],
        ["Contrato", attr(d, "contrato")],
        ["Valor", reais(valor)],
        ["Vencimento", dataBr(vencimento)],
        ["Inclusão no SPC", dataBr(inclusao)],
        ["Papel do consultado", papel],
        ["Instituição financeira", instituicao === "SIM" ? "sim" : instituicao === "NAO" ? "não" : instituicao],
        ["Código da entidade", attr(d, "codigo-entidade")],
      ]),
    };
  });
}

function restricoesChequeLojista(bloco: any): RestricaoSpc[] {
  return lista(bloco?.["detalhe-cheque-lojista"]).map(d => {
    const ini = d["cheque-inicial"];
    const fim = d["cheque-final"];
    const valor = num(attr(ini, "valor"));
    const banco = attr(ini?.["dados-bancarios"]?.banco, "nome");
    const codBanco = attr(ini?.["dados-bancarios"]?.banco, "codigo");
    const agencia = attr(ini?.["dados-bancarios"], "numero-agencia");
    const alineaCod = attr(d.alinea, "codigo");
    const alinea = attr(d.alinea, "descricao") ?? (alineaCod ? `alínea ${alineaCod}` : "");
    const { cidade, uf } = cidadeUf(d["cidade-associado"]);
    const inclusao = data(attr(d, "data-inclusao"));
    const numero = [attr(ini, "numero"), attr(ini, "digito")].filter(Boolean).join("-");
    const numeroFinal = attr(fim, "numero");
    return {
      type: "CHEQUE_LOJISTA",
      description: ["Cheque devolvido", alinea, banco ? `· ${limpar(banco)}` : ""].filter(Boolean).join(" "),
      severity: severidadePorValor(valor),
      creditor: limpar(attr(d, "nome-associado") ?? "Associado não informado"),
      value: dinheiro(valor),
      date: inclusao || data(attr(ini, "data-emissao")),
      origin: [cidade, uf].filter(Boolean).join(" / "),
      detalhes: detalhesDe([
        ["Credor (associado)", attr(d, "nome-associado")],
        ["Entidade", attr(d, "nome-entidade")],
        ["Cidade", [cidade, uf].filter(Boolean).join(" / ")],
        ["Telefone do credor", telefoneAssociado(d)],
        ["Alínea", [alineaCod, attr(d.alinea, "descricao")].filter(Boolean).join(" · ")],
        ["Cheque", numeroFinal && numeroFinal !== attr(ini, "numero") ? `${numero} a ${numeroFinal}` : numero],
        ["Banco", [codBanco, banco].filter(Boolean).join(" · ")],
        ["Agência", agencia],
        ["Emissão", dataBr(data(attr(ini, "data-emissao")))],
        ["Valor", reais(valor)],
        ["Inclusão", dataBr(inclusao)],
      ]),
    };
  });
}

function restricoesCcf(bloco: any): RestricaoSpc[] {
  return lista(bloco?.["detalhe-ccf"]).map(d => {
    const qtd = num(attr(d, "quantidade")) || 1;
    const dados = d["ultimo-cheque"]?.["dados-bancarios"];
    const banco = attr(dados?.banco, "nome");
    const motivo = attr(d.motivo, "descricao") ?? "";
    const ultimo = data(attr(d, "data-ultimo-cheque"));
    return {
      type: "CCF",
      description: `${qtd} cheque${qtd === 1 ? "" : "s"} sem fundo${motivo ? ` · ${motivo}` : ""}${banco ? ` · ${limpar(banco)}` : ""}`,
      severity: qtd >= 3 ? "critical" : "high",
      creditor: limpar(attr(d, "origem") ?? "Banco Central do Brasil"),
      value: dinheiro(0),
      date: ultimo,
      origin: "",
      detalhes: detalhesDe([
        ["Origem", attr(d, "origem")],
        ["Quantidade de cheques", qtd],
        ["Motivo", [attr(d.motivo, "codigo"), motivo].filter(Boolean).join(" · ")],
        ["Último cheque", dataBr(ultimo)],
        ["Banco", [attr(dados?.banco, "codigo"), banco].filter(Boolean).join(" · ")],
        ["Agência", attr(dados, "numero-agencia")],
      ]),
    };
  });
}

function restricoesProtesto(bloco: any): RestricaoSpc[] {
  return lista(bloco?.["detalhe-protesto"]).map(d => {
    const valor = num(attr(d, "valor"));
    const { cidade, uf } = cidadeUf(d.cartorio);
    const cartorio = attr(d.cartorio, "nome");
    const quando = data(attr(d, "data-protesto"));
    return {
      type: "PROTESTO",
      description: `Protesto em cartório${cartorio ? ` ${cartorio}` : ""}`,
      severity: severidadePorValor(valor, "high"),
      creditor: limpar(attr(d, "requerente-credor") ?? (cartorio ? `Cartório ${cartorio}` : "Cartório")),
      value: dinheiro(valor),
      date: quando,
      origin: [cidade, uf].filter(Boolean).join(" / "),
      detalhes: detalhesDe([
        ["Credor", attr(d, "requerente-credor")],
        ["Cartório", cartorio],
        ["Cidade", [cidade, uf].filter(Boolean).join(" / ")],
        ["Número do protesto", attr(d, "numero-protesto")],
        ["Data do protesto", dataBr(quando)],
        ["Valor", reais(valor)],
      ]),
    };
  });
}

function restricoesAcao(bloco: any): RestricaoSpc[] {
  return lista(bloco?.["detalhe-acao"]).map(d => {
    const valor = num(attr(d, "valor-acao"));
    const comarca = d.vara?.comarca;
    const { uf } = cidadeUf(comarca);
    const tipo = attr(d["tipo-acao"], "descricao") ?? "Ação judicial";
    const quando = data(attr(d, "data-acao"));
    return {
      type: "ACAO_JUDICIAL",
      description: limpar(tipo),
      severity: severidadePorValor(valor, "high"),
      creditor: limpar(attr(d, "nome-autor") ?? `Vara ${attr(d.vara, "nome") ?? ""}`),
      value: dinheiro(valor),
      date: quando,
      origin: [limpar(attr(comarca, "nome") ?? ""), uf].filter(Boolean).join(" / "),
      detalhes: detalhesDe([
        ["Tipo de ação", tipo],
        ["Autor", attr(d, "nome-autor")],
        ["Vara", attr(d.vara, "nome")],
        ["Comarca", [limpar(attr(comarca, "nome") ?? ""), uf].filter(Boolean).join(" / ")],
        ["Distrito", attr(d, "distrito")],
        ["Data", dataBr(quando)],
        ["Valor", reais(valor)],
      ]),
    };
  });
}

function restricoesChequeSemFundoVarejo(bloco: any): RestricaoSpc[] {
  // XSD Insumo-Cheque-Sem-Fundo-Varejo: quantidade-cheques,
  // data-ocorrencia-mais-recente, origem-ocorrencia-mais-recente, numero-loja,
  // dados-bancarios e cidade-ocorrencia. O insumo nao traz valor.
  return lista(bloco?.["detalhe-cheque-sem-fundo-varejo"]).map(d => {
    const qtd = num(attr(d, "quantidade-cheques")) || 1;
    const dados = d?.["dados-bancarios"];
    const banco = attr(dados?.banco, "nome");
    const { cidade, uf } = cidadeUf(d?.["cidade-ocorrencia"]);
    const quando = data(attr(d, "data-ocorrencia-mais-recente"));
    const origem = attr(d, "origem-ocorrencia-mais-recente");
    return {
      type: "CHEQUE_SEM_FUNDO",
      description: `${qtd} cheque${qtd === 1 ? "" : "s"} sem fundo no varejo${banco ? ` · ${limpar(banco)}` : ""}`,
      severity: qtd >= 3 ? "critical" : "high",
      creditor: limpar(origem ?? "Comércio"),
      value: dinheiro(0),
      date: quando,
      origin: [cidade, uf].filter(Boolean).join(" / "),
      detalhes: detalhesDe([
        ["Quantidade de cheques", qtd],
        ["Ocorrência mais recente", dataBr(quando)],
        ["Origem da ocorrência", origem],
        ["Cidade", [cidade, uf].filter(Boolean).join(" / ")],
        ["Banco", [attr(dados?.banco, "codigo"), banco].filter(Boolean).join(" · ")],
        ["Agência", attr(dados, "numero-agencia")],
        ["Conta", [attr(dados, "numero-conta-corrente"), attr(dados, "digito-conta-corrente")].filter(Boolean).join("-")],
        ["Loja", attr(d, "numero-loja")],
      ]),
    };
  });
}

/**
 * contra-ordem, contra-ordem-documento-diferente e contumacia tem a mesma
 * estrutura (XSD Insumo-Contra-Ordem; Insumo-Contumacia a estende): motivo,
 * cheque-inicial com dados bancarios, cheque-final, datas, origem e
 * informante. Contumacia e a sustacao reiterada — pesa mais. Todos vem no
 * retorno padrao do produto 257.
 */
function restricoesChequeSustado(bloco: any, chave: string, rotulo: string, piso: RestricaoSpc["severity"]): RestricaoSpc[] {
  return lista(bloco?.[chave]).map(d => {
    const ini = d?.["cheque-inicial"];
    const fim = d?.["cheque-final"];
    const dados = ini?.["dados-bancarios"];
    const banco = attr(dados?.banco, "nome");
    const motivo = attr(d?.motivo, "descricao");
    const valor = num(attr(ini, "valor"));
    const ocorrencia = data(attr(d, "data-ocorrencia"));
    const inclusao = data(attr(d, "data-inclusao"));
    const numeroIni = [attr(ini, "numero"), attr(ini, "digito")].filter(Boolean).join("-");
    const numeroFim = attr(fim, "numero");
    const faixa = numeroFim && numeroFim !== attr(ini, "numero") ? `${numeroIni} a ${numeroFim}` : numeroIni;
    return {
      type: "CHEQUE_SUSTADO",
      description: [rotulo, motivo ? `· ${limpar(motivo)}` : "", banco ? `· ${limpar(banco)}` : ""].filter(Boolean).join(" "),
      severity: severidadePorValor(valor, piso),
      creditor: limpar(attr(d, "informante") ?? banco ?? "Banco não informado"),
      value: dinheiro(valor),
      date: ocorrencia || inclusao,
      origin: limpar(attr(d, "origem") ?? ""),
      detalhes: detalhesDe([
        ["Motivo", [attr(d?.motivo, "codigo"), motivo].filter(Boolean).join(" · ")],
        ["Cheque", faixa],
        ["Banco", [attr(dados?.banco, "codigo"), banco].filter(Boolean).join(" · ")],
        ["Agência", attr(dados, "numero-agencia")],
        ["Conta", [attr(dados, "numero-conta-corrente"), attr(dados, "digito-conta-corrente")].filter(Boolean).join("-")],
        ["Valor", valor ? reais(valor) : undefined],
        ["Ocorrência", dataBr(ocorrencia)],
        ["Inclusão", dataBr(inclusao)],
        ["Origem", attr(d, "origem")],
        ["Informante", attr(d, "informante")],
        ["Documento no registro", attr(d, "documento")],
      ]),
    };
  });
}

/** XSD Insumo-Informacao-Poder-Judiciario: valor, processo, entidade de origem, vara e comarca. */
function restricoesPoderJudiciario(bloco: any): RestricaoSpc[] {
  return lista(bloco?.["detalhe-informacao-poder-judiciario"]).map(d => {
    const valor = num(attr(d, "valor"));
    const comarca = d?.vara?.comarca;
    const { uf } = cidadeUf(comarca);
    const documento = data(attr(d, "data-documento"));
    const inclusao = data(attr(d, "data-inclusao"));
    const processo = attr(d, "numero-processo");
    return {
      type: "PODER_JUDICIARIO",
      description: `Informação do Poder Judiciário${processo ? ` · processo ${processo}` : ""}`,
      severity: severidadePorValor(valor, "high"),
      creditor: limpar(attr(d, "entidade-origem") ?? attr(d?.vara, "nome") ?? "Poder Judiciário"),
      value: dinheiro(valor),
      date: documento || inclusao,
      origin: [limpar(attr(comarca, "nome") ?? ""), uf].filter(Boolean).join(" / "),
      detalhes: detalhesDe([
        ["Número do processo", processo],
        ["Entidade de origem", attr(d, "entidade-origem")],
        ["Vara", attr(d?.vara, "nome")],
        ["Comarca", [limpar(attr(comarca, "nome") ?? ""), uf].filter(Boolean).join(" / ")],
        ["Valor", reais(valor)],
        ["Data do documento", dataBr(documento)],
        ["Vencimento", dataBr(data(attr(d, "data-vencimento")))],
        ["Inclusão", dataBr(inclusao)],
      ]),
    };
  });
}

function pendencias(bloco: any): PendenciaFinanceira[] {
  return lista(bloco?.["detalhe-pendencia-financeira"]).map(d => ({
    origem: limpar(attr(d, "origem") ?? ""),
    titulo: limpar(attr(d, "titulo-ocorrencia") ?? ""),
    contrato: attr(d, "contrato"),
    data: data(attr(d, "data-ocorrencia")),
    valor: num(attr(d, "valor-pendencia")),
    cidade: [cidadeUf(d.cidade).cidade, cidadeUf(d.cidade).uf].filter(Boolean).join(" / ") || undefined,
    avalista: attr(d, "avalista") === "true",
  }));
}

function consultasAnteriores(bloco: any): SpcResult["previousConsultations"] {
  const itens = lista(bloco?.["detalhe-consulta-realizada"]).map(d => {
    const { cidade, uf } = cidadeUf(d["origem-associado"]);
    return {
      associado: limpar(attr(d, "nome-associado") ?? ""),
      entidade: attr(d, "nome-entidade-origem"),
      cidade, uf,
      data: data(attr(d, "data-consulta")),
    };
  });
  const dias = attr(bloco, "quantidade-dias-consultados");
  const total = num(attr(bloco?.resumo, "quantidade-total")) || itens.length;
  return {
    total,
    // O SPC devolve a janela do produto (normalmente 90 dias): o total JA e o
    // dos ultimos N dias. Nao ha janela menor na resposta.
    last90Days: total,
    diasConsiderados: dias ? Number(dias) : null,
    bySegment: {},
    lista: itens,
  };
}

function alertasDocumento(bloco: any): SpcResult["alerts"] {
  return lista(bloco?.["detalhe-alerta-documento"]).map(d => {
    const tipoDoc = attr(d["tipo-documento-alerta"], "nome");
    const motivo = attr(d, "motivo");
    const obs = attr(d, "observacao");
    const quando = data(attr(d, "data-ocorrencia") ?? attr(d, "data-inclusao"));
    const cabeca = [`Alerta de documento${tipoDoc ? ` (${tipoDoc})` : ""}`, motivo ? `— ${motivo}` : ""].filter(Boolean).join(" ");
    return {
      type: "ALERTA_DOCUMENTO",
      message: `${cabeca}${obs ? `: ${limpar(obs)}` : ""}${quando ? ` (${quando.split("-").reverse().join("/")})` : ""}`,
      severity: /roubo|furto|fraude/i.test(`${motivo} ${obs}`) ? "critical" : "high",
    };
  });
}

// ── Score ────────────────────────────────────────────────────────────────────

function detalheDe(bloco: any): any {
  if (!bloco || typeof bloco !== "object") return undefined;
  const chave = Object.keys(bloco).find(k => k.startsWith("detalhe-"));
  return chave ? lista(bloco[chave])[0] : undefined;
}

function lerScore(resultado: any): Pick<SpcResult, "score" | "scoreFonte" | "scoreDetalhe"> {
  for (const fonte of ["spc-score-12-meses", "spc-score-3-meses"] as const) {
    const bloco = resultado?.[fonte];
    if (!bloco) continue;
    const d = detalheDe(bloco);
    // Sem <detalhe>, o resumo com quantidade-total="0" significa "sem
    // informacao" (manual: insumo configurado aparece com 0), nao score zero.
    const score = attr(d, "score") ?? (d ? attr(bloco?.resumo, "quantidade-total") : undefined);
    if (score == null) continue;
    return {
      score: Math.max(0, Math.min(1000, Math.round(num(score)))),
      scoreFonte: fonte,
      scoreDetalhe: {
        classe: attr(d, "classe"),
        probabilidade: attr(d, "probabilidade") != null ? num(attr(d, "probabilidade")) : undefined,
        tipoCliente: attr(d, "tipo-cliente-score"),
        mensagem: attr(d, "mesagem-interpretativa-score") ?? attr(d, "mensagem-interpretativa-score"),
      },
    };
  }
  const cp = resultado?.["score-cadastro-positivo"];
  if (cp) {
    const d = detalheDe(cp);
    const score = attr(d, "score") ?? (d ? attr(cp.resumo, "quantidade-total") : undefined);
    if (score != null) {
      return {
        score: Math.max(0, Math.min(1000, Math.round(num(score)))),
        scoreFonte: "score-cadastro-positivo",
        scoreDetalhe: { indiceRisco: attr(d, "indice-risco-credito-score"), mensagem: attr(d, "mensagem") },
      };
    }
  }
  return { score: null };
}

// ── Veredito ─────────────────────────────────────────────────────────────────

function risco(score: number | null, restricao: boolean, restricoes: RestricaoSpc[], total: number)
  : Pick<SpcResult, "riskLevel" | "riskLabel" | "recommendation"> {
  if (score != null) {
    if (score >= 701) return { riskLevel: restricao ? "medium" : "low", riskLabel: restricao ? "Score bom, com restrição" : "Risco baixo", recommendation: restricao ? "Analisar as restrições" : "Aprovar" };
    if (score >= 501) return { riskLevel: "medium", riskLabel: "Risco médio", recommendation: "Aprovar com ressalvas" };
    if (score >= 301) return { riskLevel: "high", riskLabel: "Risco alto", recommendation: "Analisar com cautela" };
    return { riskLevel: "very_high", riskLabel: "Risco muito alto", recommendation: "Recusar" };
  }
  if (!restricao && restricoes.length === 0) {
    return { riskLevel: "very_low", riskLabel: "Nada consta", recommendation: "Aprovar" };
  }
  if (restricoes.length <= 2 && total < 500) {
    return { riskLevel: "high", riskLabel: "Risco alto", recommendation: "Analisar com cautela" };
  }
  return { riskLevel: "very_high", riskLabel: "Risco muito alto", recommendation: "Recusar" };
}

// ── API ──────────────────────────────────────────────────────────────────────

export function parseRespostaConsulta(xml: string, documento: string, opcoes: { guardarXml?: boolean } = {}): SpcResult {
  const body = corpo(xml);
  const resultado = body.resultado;
  // <resultado xsi:nil="true"/> e nillable no XSD: retorno nulo do servidor,
  // nao consulta limpa. Sem protocolo tambem nao houve consulta.
  if (!resultado || typeof resultado !== "object" || attr(resultado, "nil") === "true" || !resultado.protocolo) {
    throw new SpcError("Resposta do SPC sem resultado (nula ou sem protocolo)", "SEM_RESULTADO", "resposta");
  }

  const doc = documento.replace(/\D/g, "");
  const cadastral = consumidor(resultado, doc);

  // Obito: dois insumos possiveis, e qualquer um com conteudo vale.
  const obito = resultado["spc-obito"] ?? resultado["alerta-obito"] ?? resultado.obito;
  if (obito && (num(attr(obito.resumo, "quantidade-total")) > 0 || attr(obito, "msg-obito") || attr(detalheDe(obito), "msg-obito") || attr(detalheDe(obito), "data-obito"))) {
    cadastral.obitoRegistrado = true;
  }

  const restrictions: RestricaoSpc[] = [
    ...restricoesSpc(resultado.spc),
    ...restricoesChequeLojista(resultado["cheque-lojista"]),
    ...restricoesCcf(resultado.ccf),
    ...restricoesProtesto(resultado.protesto),
    ...restricoesAcao(resultado.acao),
    ...restricoesChequeSemFundoVarejo(resultado["cheque-sem-fundo-varejo"]),
    ...restricoesChequeSustado(resultado["contra-ordem"], "detalhe-contra-ordem", "Cheque sustado (contra-ordem)", "medium"),
    ...restricoesChequeSustado(resultado["contra-ordem-documento-diferente"], "detalhe-contra-ordem-documento-diferente", "Cheque sustado em documento diferente", "medium"),
    ...restricoesChequeSustado(resultado.contumacia, "detalhe-contumacia", "Sustação por contumácia", "high"),
    ...restricoesPoderJudiciario(resultado["informacao-poder-judiciario"]),
  ].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const resumo = {
    spc: resultado.spc ? resumoDe(resultado.spc) : VAZIO,
    chequeLojista: resultado["cheque-lojista"] ? resumoDe(resultado["cheque-lojista"]) : VAZIO,
    ccf: resultado.ccf ? resumoDe(resultado.ccf) : VAZIO,
    protesto: resultado.protesto ? resumoDe(resultado.protesto) : VAZIO,
    acao: resultado.acao ? resumoDe(resultado.acao) : VAZIO,
    pendenciaFinanceira: resultado["pendencia-financeira"] ? resumoDe(resultado["pendencia-financeira"]) : VAZIO,
    poderJudiciario: resultado["informacao-poder-judiciario"] ? resumoDe(resultado["informacao-poder-judiciario"]) : VAZIO,
  };

  // Total pelo resumo de cada bloco quando ele existe (e a soma oficial do
  // SPC); pela lista quando o resumo nao traz valor.
  const somaLista = (tipo: TipoRestricao) => restrictions.filter(r => r.type === tipo).reduce((s, r) => s + parseFloat(r.value), 0);
  const total =
    (resumo.spc.valor || somaLista("SPC")) +
    (resumo.chequeLojista.valor || somaLista("CHEQUE_LOJISTA")) +
    (resumo.protesto.valor || somaLista("PROTESTO")) +
    (resumo.acao.valor || somaLista("ACAO_JUDICIAL")) +
    (resumo.poderJudiciario.valor || somaLista("PODER_JUDICIARIO")) +
    somaLista("CHEQUE_SEM_FUNDO") +
    somaLista("CHEQUE_SUSTADO");

  const restricao = String(attr(resultado, "restricao") ?? "").toLowerCase() === "true";
  const { score, scoreFonte, scoreDetalhe } = lerScore(resultado);

  const alerts = alertasDocumento(resultado["alerta-documento"]);
  if (cadastral.obitoRegistrado) alerts.unshift({ type: "OBITO", message: "Há registro de óbito para este documento", severity: "critical" });
  const basesInoperantes = lista(resultado["base-inoperante"]).map(b => limpar(typeof b === "string" ? b : b?.["#text"] ?? attr(b, "nome") ?? "")).filter(Boolean);
  for (const m of lista(resultado["mensagem-base-externa"])) {
    // XSD mensagemBaseExterna: atributos origem-base-externa e mensagem-base-externa.
    const origem = attr(m, "origem-base-externa");
    const msg = typeof m === "string" ? m : attr(m, "mensagem-base-externa") ?? m?.["#text"] ?? attr(m, "mensagem") ?? "";
    const texto = limpar([origem, msg].filter(Boolean).join(": "));
    if (texto) alerts.push({ type: "BASE_EXTERNA", message: texto, severity: "medium" });
  }
  if (basesInoperantes.length > 0) {
    alerts.push({ type: "BASE_INOPERANTE", message: `Base fora do ar na hora da consulta: ${basesInoperantes.join(", ")}. O resultado pode estar incompleto.`, severity: "high" });
  }

  const rendaPresumida = resultado["renda-presumida-spc"] ? num(attr(detalheDe(resultado["renda-presumida-spc"]), "mediana") || attr(resultado["renda-presumida-spc"].resumo, "valor-total")) || null : null;
  const limite = resultado["limite-credito-sugerido"] ? num(attr(detalheDe(resultado["limite-credito-sugerido"]), "limite-sugerido") || attr(resultado["limite-credito-sugerido"].resumo, "valor-total")) || null : null;

  const protocolo = resultado.protocolo ? [attr(resultado.protocolo, "numero"), attr(resultado.protocolo, "digito")].filter(Boolean).join("-") : null;

  return {
    cpfCnpj: doc,
    protocolo,
    consultadoEm: attr(resultado, "data") ?? null,
    restricao,
    cadastralData: cadastral,
    score, scoreFonte, scoreDetalhe,
    ...risco(score, restricao, restrictions, total),
    status: restricao || restrictions.length > 0 ? "restricted" : "clean",
    restrictions,
    totalRestrictions: Math.round(total * 100) / 100,
    resumo,
    pendenciasFinanceiras: pendencias(resultado["pendencia-financeira"]),
    previousConsultations: consultasAnteriores(resultado["consulta-realizada"]),
    alerts,
    rendaPresumida,
    limiteCreditoSugerido: limite,
    basesInoperantes,
    ...(opcoes.guardarXml ? { rawXml: xml } : {}),
  };
}

/** Resposta de listarProdutos (varios <produto>) ou detalharProduto (um). */
export function parseProdutos(xml: string): ProdutoSpc[] {
  const body = corpo(xml);
  const brutos = lista(body.produto ?? body.produtos?.produto ?? body["lista-produto"]?.produto);
  return brutos.map(p => ({
    codigo: num(p.codigo),
    nome: limpar(p.nome ?? ""),
    parametros: lista(p.parametro).map(x => ({ nome: attr(x, "nome") ?? "", obrigatorio: attr(x, "obrigatorio") === "true" })),
    insumosRetorno: lista(p["insumo-retorno"]).map(x => ({ nome: attr(x, "nome") ?? "", codigo: num(attr(x, "codigo")), opcional: attr(x, "opcional") === "true" })),
    insumosOpcionais: lista(p["insumo-opcional"]).map(x => ({ nome: attr(x, "nome") ?? "", codigo: num(attr(x, "codigo")) })),
  })).filter(p => p.codigo > 0);
}
