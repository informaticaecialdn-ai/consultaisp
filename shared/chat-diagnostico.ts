/** Estado de transporte, sem telefone, IDs internos ou credenciais do canal. */
export interface DiagnosticoDoChat {
  codigo: "CHAT_DESLIGADO" | "SEM_CONFIGURACAO" | "SERVICO_INDISPONIVEL" | "ACESSO_RECUSADO" | "RESPOSTA_INVALIDA" | "SEM_CANAL" | "CANAL_INATIVO" | "CONEXAO_NAO_CONFIRMADA" | "AGUARDANDO_CONEXAO" | "PRONTO";
  mensagem: string;
  servicoDisponivel: boolean | null;
  canalConfigurado: boolean;
  estadoCanal: "connected" | "connecting" | "disconnected" | "unknown" | null;
}
