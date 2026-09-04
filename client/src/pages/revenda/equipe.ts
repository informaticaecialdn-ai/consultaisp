/**
 * As regras da tela de Equipe do revendedor.
 *
 * Duas remoções são proibidas, e a proibição existe no SERVIDOR — a tela só
 * chega na frente para explicar. Desabilitar sem dizer por quê deixa o operador
 * clicando num botão morto; e um botão que só o servidor recusa transforma a
 * regra em toast de erro depois do clique.
 *
 * ── POR QUE AS DUAS REGRAS ─────────────────────────────────────────────────
 *
 * 1. NINGUÉM SE REMOVE. Removida a própria conta, a sessão continua de pé até
 *    o próximo request e a pessoa descobre o que fez ao ser deslogada. Pior:
 *    numa equipe de um, essa é também a regra 2.
 * 2. NUNCA A ÚLTIMA. Marca sem nenhum usuário revendedor é marca sem dono: o
 *    login pelo domínio próprio deixa de aceitar qualquer pessoa, e só o
 *    superadmin consegue criar a primeira conta de volta (a rota de criação de
 *    equipe é dele, `POST /api/admin/marcas/:id/usuarios`). O prejuízo é uma
 *    ligação para o suporte para desfazer um clique.
 */

export type PessoaDaEquipe = {
  id: number;
  name: string;
  email: string;
  createdAt: string | null;
  /**
   * Senha ainda provisória: a pessoa foi criada por terceiro e não trocou a
   * senha. É o sinal de "esta conta ainda não foi usada", e vale mostrar —
   * senão o revendedor não sabe se o convite chegou.
   */
  mustChangePassword?: boolean;
};

/**
 * Por que esta pessoa não pode ser removida agora. `null` = pode.
 *
 * A ordem dos casos não é arbitrária: quando a equipe tem uma pessoa só, ela é
 * necessariamente você, e as duas regras batem ao mesmo tempo. A frase que
 * serve nesse caso é a que diz o que FAZER — adicionar outra pessoa —, não a
 * que repete que você é você.
 */
export function motivoParaNaoRemover(args: {
  alvoId: number;
  meuId: number | null;
  totalDaEquipe: number;
}): string | null {
  const { alvoId, meuId, totalDaEquipe } = args;

  if (totalDaEquipe <= 1) {
    return "Esta é a única pessoa com acesso à marca. Adicione outra antes de remover esta conta.";
  }
  if (meuId !== null && alvoId === meuId) {
    return "Você não pode remover a própria conta. Peça a outra pessoa da equipe.";
  }
  return null;
}

/**
 * O que impede criar a pessoa, por campo. Objeto vazio = pode enviar.
 *
 * Os limites são os da tabela `users` (`name` e `email` são text, mas o
 * cadastro de usuário do admin já usa 200/254) e a regra de e-mail é a mesma
 * frouxidão de sempre: separar "tem cara de e-mail" de "não tem", porque quem
 * decide de verdade é o `z.string().email()` da rota.
 */
export function problemasDoConvite(dados: { nome: string; email: string }): Record<string, string> {
  const p: Record<string, string> = {};
  const nome = dados.nome.trim();
  const email = dados.email.trim();

  if (!nome) p.nome = "Informe o nome da pessoa.";
  else if (nome.length > 200) p.nome = "Máximo de 200 caracteres.";

  if (!email) p.email = "Informe o e-mail de acesso.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) p.email = "Informe um e-mail válido.";
  else if (email.length > 254) p.email = "Máximo de 254 caracteres.";

  return p;
}

/** Data de entrada, curta. Hora não acrescenta nada numa lista de equipe. */
export function dataDeEntrada(quando: string | null | undefined): string {
  if (!quando) return "—";
  const d = new Date(quando);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}
