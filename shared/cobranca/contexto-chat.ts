import type { AutenticacaoCliente } from "../equipamentos/identificacao";
import type { PagamentoDoChat } from "./pagamento-chat";
export interface FaturaDoChat {
  ref: string;
  fonte: string | null;
  valor: number;
  /** AAAA-MM-DD quando o ERP devolveu um dia de calendário legível; qualquer outra coisa é exibida como traço e contada em `faturasSemData`. */
  vencimento: string;
  descricao: string | null;
  consultavel: boolean;
  pagamento: PagamentoDoChat | null;
}
export interface ContextoDoChat {
  cliente: {
    id: number;
    nome: string;
    documento: string;
    telefone: string | null;
    email: string | null;
    endereco: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
    statusContrato: string;
    clienteDesde: string | null;
    plano: string | null;
    mensalidade: number | null;
    /**
     * `customers.isp_score` só quando é CÁLCULO — nunca o DEFAULT 100 da coluna.
     * Mesma regra de `ispScoreReal` (server/routes/cobranca.routes.ts): sem
     * cálculo, null nos dois, e a ficha mostra traço. Não é score de bureau.
     */
    ispScore: number | null;
    risco: string | null;
    /** Null = ninguém leu o valor em aberto nesta consulta. Zero seria a afirmação "não deve nada". */
    divida: number | null;
    /** Null = ninguém leu os dias de atraso nesta consulta. */
    diasAtraso: number | null;
    sincronizadoEm: string | null;
  };
  pagamentos: { pagas: number; comData: number; pontualidade: number | null };
  /** Da mais antiga para a mais nova; as sem vencimento legível vão ao fim. */
  faturas: FaturaDoChat[];
  temMaisFaturas: boolean;
  /** Quantas das `faturas` exibidas vieram sem vencimento legível — a ordem por vencimento não vale para elas. */
  faturasSemData: number;
  conexoes: AutenticacaoCliente[];
  ordens: Array<{ id: number; status: string; agendadoEm: string | null }>;
  erp: {
    fonte: string | null;
    /** Quando o ERP foi consultado nesta chamada — não é a data do valor exibido. Para isso, `lidoEm`. */
    atualizadoEm: string;
    status: "disponivel" | "parcial" | "indisponivel";
    mensagem: string | null;
    /**
     * `true` só quando `cliente.divida`, `cliente.diasAtraso` e `faturas` saíram
     * da leitura AO VIVO desta consulta.
     *
     * `status: "disponivel"` NÃO garante isso: o ERP responde e mesmo assim não
     * devolve fatura nenhuma quando o cliente pagou tudo (o MK devolve
     * `faturasAbertas: undefined`). Nesse caso os valores caem para a varredura
     * das 03:00, e quem for FALAR um número precisa saber disso — falar o saldo
     * antigo é cobrar quem já pagou.
     */
    financeiroAoVivo: boolean;
    /** De onde vieram os valores financeiros exibidos. */
    valoresDe: "ao_vivo" | "base_sincronizada";
    /**
     * Data do VALOR exibido: o instante da leitura ao vivo, ou o
     * `customers.last_sync_at` da varredura que gravou o valor da base.
     * `null` quando ninguém mediu — a tela mostra traço, nunca zero.
     */
    lidoEm: string | null;
  };
}
