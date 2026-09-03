/**
 * A logica da busca do suporte pelo codigo da consulta, fora do componente.
 *
 * Mora aqui porque e o que precisa de teste: o codigo chega colado do
 * WhatsApp, do e-mail ou ditado por telefone, e a caixa de busca nao pode
 * exigir que quem atende acerte a digitacao de um codigo que ninguem escolheu.
 * O componente so desenha; a decisao de o que fazer com o texto e desta
 * unidade, e ela e testavel sem DOM.
 *
 * A VALIDACAO do formato continua sendo do servidor — ele e quem conhece o
 * alfabeto e devolve a mensagem que ensina. Aqui so se prepara o texto para
 * caber num pedaco de URL sem quebrar o roteamento.
 */

/** O que o servidor devolve em GET /api/admin/consultas/:consultaId. */
export interface FichaDeConsulta {
  consultaId: string;
  tipo: "isp" | "spc" | "cadastral";
  linhaId: number;
  criadaEm: string | null;
  provedor: { id: number; nome: string | null };
  usuario: { id: number; nome: string | null };
  /** Mascarado no servidor: `123.***.***-**`. Nunca chega inteiro. */
  documento: string;
  custoCreditos: number;
  custoOrigem: "gravado" | "tabela";
  desfecho: {
    score: number | null;
    decisao: string | null;
    veredito: string | null;
    tipoDeBusca: string | null;
    datasets: string[] | null;
  };
  protocoloDaOrigem: { origem: string; protocolo: string } | null;
}

/**
 * O texto digitado virando um pedaco de URL.
 *
 * Descarta tudo que nao for letra, digito ou traco: quem cola um link inteiro
 * traz `/` e `?` junto, e uma barra no meio do caminho faz o Express casar
 * outra rota (ou nenhuma) e responder um 404 mudo, em vez do 400 que explica o
 * formato. Espaco e ponto tambem somem — o normalizador do servidor os aceita,
 * mas o percent-encoding deles no caminho e ruido a toa.
 *
 * NAO corrige caractere parecido (`0` por `O`): o alfabeto do codigo nao tem
 * nenhum dos dois, entao um codigo com eles esta errado de verdade, e dizer
 * isso e melhor que adivinhar e mostrar a consulta de outra pessoa.
 *
 * Devolve `null` quando nao sobra nada — nao ha o que buscar.
 */
export function codigoParaUrl(texto: string): string | null {
  const limpo = texto.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  return limpo || null;
}

export const ROTULO_DO_TIPO: Record<FichaDeConsulta["tipo"], string> = {
  isp: "Consulta ISP",
  spc: "SPC Brasil",
  cadastral: "Consulta cadastral",
};

/**
 * `decisionReco` esta gravado em ingles ("Accept"/"Review"/"Reject") desde
 * antes deste trabalho, e a coluna nao se mexe por causa de um rotulo. A
 * traducao fica na borda, que e onde alguem le.
 */
const ROTULO_DA_DECISAO: Record<string, string> = {
  Accept: "Aprovar",
  Review: "Revisar",
  Reject: "Rejeitar",
};

/** O veredito da cadastral e gravado em caixa alta e sem acento. */
const ROTULO_DO_VEREDITO: Record<string, string> = {
  APROVAR: "Aprovar",
  ATENCAO: "Atenção",
  RECUSAR: "Recusar",
  NAO_ENCONTRADO: "Não encontrado",
};

/** "cpf" e "cep" saem do `searchType` da consulta ISP. */
const ROTULO_DA_BUSCA: Record<string, string> = {
  cpf: "por CPF/CNPJ",
  cnpj: "por CPF/CNPJ",
  cep: "por endereço",
};

/**
 * O tom do desfecho, para a tela pintar sem inventar uma escala nova.
 * `neutro` quando a consulta nao decidiu nada — e o caso da SPC, que devolve
 * score e deixa a decisao com o provedor.
 */
export type TomDoDesfecho = "ok" | "atencao" | "recusa" | "neutro";

export function desfechoDaFicha(ficha: FichaDeConsulta): { texto: string; tom: TomDoDesfecho } {
  const { decisao, veredito } = ficha.desfecho;

  if (decisao) {
    const tom: TomDoDesfecho =
      decisao === "Accept" ? "ok" : decisao === "Reject" ? "recusa" : "atencao";
    return { texto: ROTULO_DA_DECISAO[decisao] ?? decisao, tom };
  }
  if (veredito) {
    const tom: TomDoDesfecho =
      veredito === "APROVAR" ? "ok" : veredito === "RECUSAR" ? "recusa" :
      veredito === "NAO_ENCONTRADO" ? "neutro" : "atencao";
    return { texto: ROTULO_DO_VEREDITO[veredito] ?? veredito, tom };
  }
  return { texto: "Sem decisão registrada", tom: "neutro" };
}

/** Uma linha da ficha. `mono` marca dado — vai em IBM Plex Mono, tabular. */
export interface LinhaDaFicha {
  rotulo: string;
  valor: string;
  mono?: boolean;
  /** Explicacao curta ao lado do valor, quando ele sozinho enganaria. */
  nota?: string;
}

function dataPorExtenso(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * A ficha virando as linhas que a tela desenha, na ordem em que o chamado
 * costuma andar: quando, quem, quanto, e a quem escalar.
 *
 * Campo que nao se aplica ao tipo simplesmente nao vira linha — mostrar
 * "Veredito: —" numa consulta ISP sugere que faltou dado, quando na verdade
 * aquela consulta nunca teve veredito.
 */
export function linhasDaFicha(ficha: FichaDeConsulta): LinhaDaFicha[] {
  const linhas: LinhaDaFicha[] = [
    { rotulo: "tipo", valor: ROTULO_DO_TIPO[ficha.tipo] ?? ficha.tipo },
    { rotulo: "data", valor: dataPorExtenso(ficha.criadaEm), mono: true },
    { rotulo: "provedor", valor: `${ficha.provedor.nome ?? "(provedor removido)"} · #${ficha.provedor.id}` },
    { rotulo: "operador", valor: `${ficha.usuario.nome ?? "(usuário removido)"} · #${ficha.usuario.id}` },
    { rotulo: "documento", valor: ficha.documento, mono: true, nota: "mascarado" },
  ];

  if (ficha.desfecho.tipoDeBusca) {
    linhas.push({
      rotulo: "busca",
      valor: ROTULO_DA_BUSCA[ficha.desfecho.tipoDeBusca] ?? ficha.desfecho.tipoDeBusca,
    });
  }
  if (ficha.desfecho.score !== null) {
    linhas.push({ rotulo: "score", valor: String(ficha.desfecho.score), mono: true });
  }
  linhas.push({
    rotulo: "custo",
    valor: `${ficha.custoCreditos} crédito${ficha.custoCreditos === 1 ? "" : "s"}`,
    mono: true,
    // Sem esta nota o suporte estorna pelo preco de hoje uma consulta antiga.
    nota: ficha.custoOrigem === "gravado" ? undefined : "preço de tabela; não gravado na linha",
  });
  if (ficha.desfecho.datasets?.length) {
    linhas.push({ rotulo: "datasets", valor: ficha.desfecho.datasets.join(", "), mono: true });
  }
  if (ficha.protocoloDaOrigem) {
    linhas.push({
      rotulo: `protocolo ${ficha.protocoloDaOrigem.origem}`,
      valor: ficha.protocoloDaOrigem.protocolo,
      mono: true,
      nota: "apresente este número ao suporte da origem",
    });
  }
  linhas.push({ rotulo: "linha no banco", valor: `#${ficha.linhaId}`, mono: true });

  return linhas;
}

/**
 * A mensagem de erro do `apiRequest` virando o texto que quem atende le.
 *
 * O `queryClient` monta "404: {json}" ao levantar o erro, entao o corpo chega
 * aqui como texto. Sem desembrulhar, a tela mostraria a chave e a chave da
 * chave — e a mensagem do 404 e justamente a que ensina onde procurar.
 */
export function mensagemDoErro(erro: unknown): string {
  const cru = erro instanceof Error ? erro.message : String(erro ?? "");
  const corpo = cru.replace(/^\d{3}:\s*/, "");
  try {
    const json = JSON.parse(corpo);
    if (json && typeof json.message === "string") return json.message;
  } catch {
    // Nao era JSON: o proprio texto ja e a melhor mensagem que existe.
  }
  return corpo || "Não foi possível buscar a consulta.";
}
