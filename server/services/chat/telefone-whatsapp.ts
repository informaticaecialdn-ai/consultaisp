/**
 * Equivalência de telefones brasileiros no WhatsApp.
 *
 * O WhatsApp registra celulares antigos SEM o nono dígito (55 43 8821-9420) e
 * a Evolution devolve o contato como o WhatsApp o conhece; o cadastro do ERP
 * traz o 9 (43 9 8821-9420). São o MESMO número. Comparar os dois normalizados
 * (`normalizarTelefoneParaChat`) dizia "telefones diferentes": a busca por
 * telefone não achava a conversa e o assistente transferia ao humano com
 * "vínculo de identificação exige conferência" (16/09/2026, cliente 42472 da
 * NsLink, na primeira resposta real de um cliente pelo WhatsApp da plataforma).
 *
 * A chave é DDD + o número local sem o nono dígito: o 9 na frente dos oito do
 * celular não distingue ninguém. Um local de 9 dígitos que NÃO começa por 9
 * (não existe no plano brasileiro) fica inteiro — não colide com nada e dois
 * cadastros iguais continuam iguais.
 */
export function chaveDoTelefoneWhatsapp(telefone: string | null | undefined): string | null {
  let digitos = String(telefone ?? "").replace(/\D/g, "");
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length !== 10 && digitos.length !== 11) return null;
  const ddd = digitos.slice(0, 2);
  let local = digitos.slice(2);
  if (local.length === 9 && local.startsWith("9")) local = local.slice(1);
  return `${ddd}${local}`;
}

/** Os dois telefones são o mesmo número no WhatsApp (com ou sem DDI 55, com ou sem o nono dígito). */
export function mesmoTelefoneWhatsapp(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = chaveDoTelefoneWhatsapp(a);
  return x !== null && x === chaveDoTelefoneWhatsapp(b);
}
