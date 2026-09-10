/**
 * O erro da confissão de dívida: código estável para a tela e o HTTP que a
 * rota devolve. Lançado por storage, conector e serviços; mapeado UMA vez em
 * `confissao.routes.ts` (`responderErro`).
 */
export type CodigoDeErroDeConfissao =
  | "NAO_CONFIGURADA"        // 409 — sem integração ativa
  | "CREDENCIAL_ILEGIVEL"    // 409 — token gravado não abre (SESSION_SECRET mudou)
  | "EM_ANDAMENTO"           // 409 — trava ocupada
  | "BASE_MUDOU"             // 409 — baseHash divergente
  | "CONFISSAO_VIVA"         // 409 — já existe rascunho/enviada
  | "BLOQUEADA"              // 422 — bloqueios da base (detalhes.bloqueios)
  | "ESTADO_INVALIDO"        // 409 — transição não permitida
  | "JA_ASSINADA"            // 409 — cancelar depois de assinada
  | "NAO_ENCONTRADA"         // 404
  | "REENVIO_CEDO"           // 429 — reenvio dentro da janela
  | "AMBIENTE_DIVERGENTE"    // 409 — sandbox do ZapSign ≠ ambiente da linha
  | "ARQUIVO_GRANDE"         // 422 — signed_file > 8 MB
  | "ZAPSIGN_CREDENCIAL"     // 422
  | "ZAPSIGN_CREDITOS"       // 422
  | "ZAPSIGN_LIMITE"         // 429
  | "ZAPSIGN_RECUSOU"        // 422
  | "ZAPSIGN_INDISPONIVEL";  // 502

export class ErroDeConfissao extends Error {
  constructor(
    readonly codigo: CodigoDeErroDeConfissao,
    mensagem: string,
    readonly http: number = 409,
    readonly detalhes?: Record<string, unknown>,
  ) {
    super(mensagem);
    this.name = "ErroDeConfissao";
  }
}
