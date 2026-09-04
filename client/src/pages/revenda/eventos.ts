/**
 * A trilha da marca (`marca_eventos`) virando linha de tela.
 *
 * A tabela é append-only e guarda o verbo cru — `suspender`, `editar_marca` —
 * porque é o que o servidor escreve e o que uma auditoria precisa reler daqui a
 * um ano. Quem traduz para português é esta camada.
 *
 * ── POR QUE O CATÁLOGO É COPIADO E NÃO IMPORTADO ───────────────────────────
 *
 * A lista de ações vive em `server/services/marca-eventos.service.ts`, que
 * importa o banco: o client não pode importá-lo. A cópia aqui é só de RÓTULO —
 * quem valida o verbo continua sendo o serviço, que recusa o que não conhece.
 *
 * E é por isso que ação sem rótulo NÃO some da lista: `rotuloDaAcao` devolve o
 * verbo cru. Uma linha feia numa trilha de auditoria é um problema de estilo;
 * uma linha ausente é a auditoria mentindo que nada aconteceu.
 */

/** Uma linha de `marca_eventos` como a rota devolve. */
export type EventoNaTela = {
  id: number;
  acao: string;
  /** O papel de quem agiu NO MOMENTO do ato — `revendedor` ou `superadmin`. */
  atorRole: string;
  /** Provedor alvo, quando a ação tem um. */
  providerId: number | null;
  detalhe: Record<string, unknown> | null;
  createdAt: string | null;
  /**
   * Enriquecimento opcional da rota. Sem eles a linha continua legível — por
   * isso são opcionais e não obrigatórios: `providerId` sozinho não diz nada a
   * quem lê, e um id numérico cru na tela é pior do que a sua ausência.
   */
  provedorNome?: string | null;
  atorNome?: string | null;
};

/**
 * O verbo gravado → a frase que o revendedor lê.
 *
 * Frase no passado, e não substantivo: a trilha conta o que ACONTECEU. É a
 * exceção declarada ao rótulo-substantivo da seção 8 do DESIGN_SYSTEM, que fala
 * de rótulo de campo e de coluna, não de registro de acontecimento.
 */
const ROTULOS: Record<string, string> = {
  criar_provedor: "Provedor criado",
  editar_provedor: "Cadastro do provedor editado",
  suspender: "Provedor suspenso",
  reativar: "Provedor reativado",
  criar_usuario_provedor: "Usuário do provedor criado",
  remover_usuario_provedor: "Usuário do provedor removido",
  vincular_por_convite: "Provedor vinculado por convite",
  editar_marca: "Marca editada",
  editar_preco: "Preço alterado",
  criar_usuario_revenda: "Pessoa adicionada à equipe",
  remover_usuario_revenda: "Pessoa removida da equipe",
  alterar_comissao: "Percentual de comissão alterado",
  fechar_fechamento: "Competência fechada",
  aprovar_fechamento: "Fechamento aprovado",
  pagar_fechamento: "Fechamento pago",
  cancelar_fechamento: "Fechamento cancelado",
  ajuste_comissao: "Ajuste de comissão lançado",
  cadastro_publico: "Cadastro feito pelo site da marca",
};

export function rotuloDaAcao(acao: string): string {
  return ROTULOS[acao] ?? acao;
}

/**
 * Quem agiu, na única forma que a tela pode afirmar sem enriquecimento.
 *
 * O papel importa mais do que o nome nesta lista, e é a pergunta que o
 * revendedor faz olhando para ela: "isso fui eu ou foi a plataforma?". Um id de
 * usuário não responde; o papel responde.
 */
export function quemFez(atorRole: string, atorNome?: string | null): string {
  const papel = atorRole === "superadmin" ? "plataforma" : "sua equipe";
  return atorNome ? `${atorNome} · ${papel}` : papel;
}

/**
 * A segunda linha do evento, quando existe.
 *
 * Só dois campos do `detalhe` são lidos, e os dois estão no desenho da fase 2:
 * o nome do provedor alvo e o `motivo` (obrigatório na suspensão, ≥ 8
 * caracteres). O resto do JSONB fica de fora de propósito — o formato dele
 * muda por ação, e despejar chave crua na tela é ruído com aparência de dado.
 */
export function complementoDoEvento(evento: EventoNaTela): string {
  const partes: string[] = [];
  if (evento.provedorNome) partes.push(evento.provedorNome);
  const motivo = evento.detalhe?.motivo;
  if (typeof motivo === "string" && motivo.trim()) partes.push(motivo.trim());
  return partes.join(" — ");
}

/**
 * Data e hora do registro, em mono na tela.
 *
 * Absoluta, e não relativa ("há 2 horas"): numa trilha de auditoria a pergunta
 * é sempre "quando exatamente", e o relativo obriga quem lê a fazer a conta de
 * cabeça para comparar com um e-mail ou um extrato.
 */
export function dataHoraDoEvento(quando: string | null | undefined): string {
  if (!quando) return "—";
  const d = new Date(quando);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
