/**
 * As acoes destrutivas sobre um provedor, com o verbo HTTP e o texto que o
 * operador le no mesmo lugar.
 *
 * Existe por um defeito concreto: na lista de provedores o botao dizia
 * "Desativar", o confirm dizia so "Desativar NSLink?" e o toast dizia
 * "Provedor desativado" — mas o clique disparava
 * `DELETE /api/admin/providers/:id`, que apaga em cascata support_messages,
 * invoices, contracts, anti_fraud_alerts, equipment, customers, consultas,
 * logs e integracoes de ERP, faturas, pedidos de credito, documentos, socios,
 * usuarios e, por fim, o proprio provedor. Sem transacao e sem desfazer: o
 * unico caminho de volta era restaurar backup do banco.
 *
 * Separar "suspender" (PATCH de status, reversivel) de "excluir" (DELETE,
 * definitivo) num modulo puro deixa o par verbo/texto testavel — e quebra o
 * teste se alguem voltar a ligar um rotulo brando a um DELETE.
 */
export type AcaoProvedor = {
  /** O que o clique faz de fato. */
  metodo: "PATCH" | "DELETE";
  caminho: string;
  /** Corpo do PATCH; DELETE nao leva corpo. */
  corpo?: Record<string, unknown>;
  /** Texto do confirm(). `null` quando a acao nao destroi nem bloqueia nada. */
  confirmacao: string | null;
  /** Titulo do toast de sucesso. */
  sucesso: string;
  /** O provedor e os dados dele sobrevivem a acao. */
  reversivel: boolean;
};

/** Bloqueia o acesso do provedor. Nada e apagado; da para reativar. */
export function acaoSuspenderProvedor(id: number, nome: string): AcaoProvedor {
  return {
    metodo: "PATCH",
    caminho: `/api/admin/providers/${id}`,
    corpo: { status: "suspended" },
    confirmacao: `Suspender ${nome}?\n\nO acesso do provedor e dos usuarios dele fica bloqueado ate alguem reativar. Nenhum dado e apagado.`,
    sucesso: "Provedor suspenso",
    reversivel: true,
  };
}

/** Devolve o acesso a um provedor suspenso. */
export function acaoReativarProvedor(id: number, _nome: string): AcaoProvedor {
  return {
    metodo: "PATCH",
    caminho: `/api/admin/providers/${id}`,
    corpo: { status: "active" },
    confirmacao: null,
    sucesso: "Provedor reativado",
    reversivel: true,
  };
}

/** Apaga o provedor e tudo que pende dele. Nao ha desfazer. */
export function acaoExcluirProvedor(id: number, nome: string): AcaoProvedor {
  return {
    metodo: "DELETE",
    caminho: `/api/admin/providers/${id}`,
    confirmacao: `Excluir permanentemente o cadastro de "${nome}"?\n\nTodos os dados associados (usuarios, clientes, consultas, faturas, equipamentos etc.) serao removidos. Esta acao nao pode ser desfeita.`,
    sucesso: "Provedor excluido",
    reversivel: false,
  };
}

export const ACOES_PROVEDOR = [acaoSuspenderProvedor, acaoReativarProvedor, acaoExcluirProvedor];
