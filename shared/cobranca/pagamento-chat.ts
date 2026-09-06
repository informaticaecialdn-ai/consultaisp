/** Dados de um instrumento existente no ERP. Não emite cobrança nem inventa link. */
export interface PagamentoDoChat {
  link: string | null;
  pix: string | null;
  linhaDigitavel: string | null;
  valor: number | null;
  vencimento: string | null;
}
export function linkDePagamentoSeguro(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      return null;
    // Credenciais da API nunca são um link de pagamento do assinante.
    if (
      [...u.searchParams.keys()].some((k) =>
        /^(token|api_?key|password|senha|app|authorization)$/i.test(k),
      )
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
export function normalizarPagamento(d: {
  link?: unknown;
  pix?: unknown;
  linhaDigitavel?: unknown;
  valor?: unknown;
  vencimento?: unknown;
}): PagamentoDoChat {
  const codigo = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const bruto =
    typeof d.valor === "number" || typeof d.valor === "string"
      ? String(d.valor).trim()
      : "";
  const decimal = /^\d+(\.\d+)?$/.test(bruto)
    ? bruto
    : /^(\d+|\d{1,3}(\.\d{3})+),\d{1,2}$/.test(bruto)
      ? bruto.replace(/\./g, "").replace(",", ".")
      : null;
  const valor = decimal === null ? null : Number(decimal);
  return {
    link: linkDePagamentoSeguro(d.link),
    pix: codigo(d.pix),
    linhaDigitavel: codigo(d.linhaDigitavel),
    valor:
      valor !== null && Number.isFinite(valor) && valor >= 0 ? valor : null,
    vencimento:
      typeof d.vencimento === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(d.vencimento)
        ? d.vencimento
        : null,
  };
}
export function mensagemDePagamento(d: PagamentoDoChat): string {
  if (!d.link && !d.pix && !d.linhaDigitavel)
    throw new Error(
      "O ERP não informou PIX, boleto ou linha digitável desta fatura.",
    );
  const valor =
    d.valor === null
      ? ""
      : ` no valor de ${d.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`;
  const vencimento = d.vencimento
    ? `, com vencimento em ${d.vencimento.split("-").reverse().join("/")}`
    : "";
  const texto = [
    `Segue a segunda via da sua fatura${valor}${vencimento}.`,
    d.link && `Boleto / pagamento:\n${d.link}`,
    d.pix && `PIX copia e cola:\n${d.pix}`,
    d.linhaDigitavel && `Linha digitável:\n${d.linhaDigitavel}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (texto.length > 2000)
    throw new Error(
      "Os dados excedem o tamanho da mensagem. Copie o link ou código e envie separadamente.",
    );
  return texto;
}
