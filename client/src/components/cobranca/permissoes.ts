/**
 * Quem pode configurar a cobrança.
 *
 * `admin` do provedor configura (política, régua, responsável das etapas,
 * atribuição de caso); `user` trabalha a fila. O superadmin dentro de uma
 * janela de suporte conta como admin — é a mesma regra do Painel do Provedor
 * (`painel-provedor.tsx`), e escrita duas vezes ela diverge no primeiro
 * ajuste. A recusa que vale é a do servidor; isto só esconde o que o servidor
 * recusaria.
 */
export interface UsuarioDaSessao {
  role: string;
}

export function podeAdministrarCobranca(
  user: UsuarioDaSessao | null | undefined,
  personificando = false,
): boolean {
  if (!user) return false;
  return user.role === "admin" || (user.role === "superadmin" && personificando);
}
