/**
 * Derivações do relatório cadastral — as contas que a tela e o PDF fazem igual.
 *
 * Mesmo princípio de `relatorio-dados.ts` no lado ISP: o desenho fica no
 * componente, a conta fica aqui. Quando o PDF tinha a própria cópia dessas
 * regras, o papel saía dizendo uma coisa e a tela outra.
 */
import type { Tone } from "./report-ui";
import type { ResultadoCadastral, EnderecoCadastro, TelefoneCadastro } from "./cadastral-tipos";

/**
 * O que o score de `financial_risk` realmente mede — e por que o relatório não
 * o chama de "risco".
 *
 * Medido em 28/08/2026: o CPF com R$ 10.103 em aberto e 2.745 dias de atraso no
 * provedor voltou com 1000 aqui, o máximo da escala, patrimônio "1 A 5MM" e
 * renda de 10 a 15 salários. Não é defeito da BigData — ela mede crédito
 * formal, e dívida de provedor de internet não entra em bureau nenhum. É
 * exatamente o buraco que o Consulta ISP existe para tapar.
 */
export const LEGENDA_CAPACIDADE =
  "Mede vínculo formal e crédito de mercado. Não enxerga dívida de provedor: "
  + "para isso, a Consulta ISP é a fonte.";

export const fmtBrl = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Data sem passar por fuso. A BigData devolve tanto "2026-03-18" quanto
 * "2026-03-18T00:00:00Z"; `new Date()` lê os dois como meia-noite UTC e o
 * Brasil (UTC-3) renderizava o dia anterior.
 */
export function fmtData(s?: string | null): string {
  if (!s) return "—";
  // Sentinelas da API para "sem data". Exibir 01/01/0001 é pior que um traço.
  if (/^0001-01-01/.test(s) || /^9999-12-31/.test(s)) return "—";
  const soData = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (soData) return `${soData[3]}/${soData[2]}/${soData[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

export function fmtDoc(doc: string): string {
  const n = String(doc ?? "").replace(/\D/g, "");
  if (n.length === 14) return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (n.length === 11) return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return doc;
}

export function fmtTelefone(t: TelefoneCadastro): string {
  const n = t.numero.replace(/\D/g, "");
  const corpo = n.length >= 9 ? `${n.slice(0, n.length - 4)}-${n.slice(-4)}` : n;
  return t.ddd ? `(${t.ddd}) ${corpo}` : corpo;
}

export function enderecoEmLinha(e: EnderecoCadastro): string {
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ");
  const resto = [e.complemento, e.bairro].filter(Boolean).join(" · ");
  const cidade = [e.cidade, e.uf].filter(Boolean).join("/");
  return [rua, resto, cidade].filter(Boolean).join(" — ");
}

export interface DecisaoCadastral {
  curto: string;
  titulo: string;
  tom: Tone;
}

/** Rótulo e tom do veredito. O motivo vem pronto do servidor. */
export function decisaoCadastral(r: ResultadoCadastral): DecisaoCadastral {
  const ehEmpresa = r.tipoDocumento === "cnpj";
  switch (r.veredito) {
    case "APROVAR":
      return { curto: "Aprovar", tom: "ok", titulo: "Cadastro sem restrição" };
    case "RECUSAR":
      return {
        curto: "Rejeitar", tom: "danger",
        titulo: ehEmpresa ? "CNPJ impedido na Receita" : "CPF impedido na Receita",
      };
    case "NAO_ENCONTRADO":
      return {
        curto: "Analisar", tom: "neutral",
        titulo: ehEmpresa ? "CNPJ sem registro" : "CPF sem registro",
      };
    default:
      return { curto: "Analisar", tom: "gated", titulo: "Exigir garantias" };
  }
}

export interface SinalCadastral {
  valor: string;
  rotulo: string;
  ruim: boolean;
  /** true = número mono grande; false = texto de dinheiro, um corpo menor. */
  grande: boolean;
}

/**
 * Os quatro números do rodapé da sugestão. Diferentes por tipo de documento:
 * empresa não tem homônimo nem domicílio, pessoa não tem sócio nem idade de
 * CNPJ. Sempre quatro — a grade do card é fixa em quatro colunas.
 */
export function sinaisCadastrais(r: ResultadoCadastral): SinalCadastral[] {
  const inad = r.inadimplencia;

  if (r.tipoDocumento === "cnpj") {
    const atuais = (r.empresa?.socios ?? []).filter(s => s.atual).length;
    return [
      { valor: String(r.empresa?.idadeAnos ?? "—"), rotulo: "Anos de atividade", ruim: (r.empresa?.idadeAnos ?? 99) < 1, grande: true },
      { valor: String(atuais), rotulo: "Sócios no quadro", ruim: atuais === 0, grande: true },
      { valor: String(inad.processosComoReu), rotulo: "Processos como réu", ruim: inad.processosComoReu > 0, grande: true },
      { valor: fmtBrl(inad.dividaAtiva), rotulo: "Dívida ativa União", ruim: inad.dividaAtiva > 0, grande: false },
    ];
  }

  return [
    { valor: String(inad.cobrancas365d), rotulo: "Cobranças 12 meses", ruim: inad.cobrancas365d > 0, grande: true },
    { valor: String(inad.processosComoReu), rotulo: "Processos como réu", ruim: inad.processosComoReu > 0, grande: true },
    { valor: String(r.rastro?.consultas30d ?? 0), rotulo: "Consultas 30 dias", ruim: (r.rastro?.consultas30d ?? 0) > 10, grande: true },
    { valor: fmtBrl(inad.dividaAtiva), rotulo: "Dívida ativa União", ruim: inad.dividaAtiva > 0, grande: false },
  ];
}

/**
 * Rótulo da faixa em linguagem de CAPACIDADE, não de risco.
 *
 * `faixaDoScore` fala "Risco alto" / "Excelente" porque foi escrita para o
 * score ISP, que de fato mede risco de calote. Aqui a régua é outra: mede
 * vínculo formal e crédito de mercado. Reaproveitar a palavra faria a tela
 * dizer "risco baixo" para o devedor de R$ 10.103 que tira 1000 — que é
 * exatamente o erro que a legenda desta seção existe para evitar.
 *
 * As fronteiras são as mesmas de `faixaDoScore`, de propósito: uma régua com
 * dois conjuntos de cortes acabaria medindo diferente da barra que a desenha.
 */
export function faixaCapacidade(score: number): string {
  if (score <= 300) return "capacidade mínima";
  if (score <= 500) return "capacidade baixa";
  if (score <= 700) return "capacidade média";
  if (score <= 850) return "capacidade boa";
  return "capacidade alta";
}
