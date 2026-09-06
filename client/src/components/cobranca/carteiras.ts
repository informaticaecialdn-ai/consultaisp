import type { Carteira } from "@shared/cobranca";

/** A rota da carteira prevalece sobre parâmetros antigos de links compartilhados. */
export function carteiraDaNavegacao(caminho: string, search: string): Carteira {
  if (caminho === "/cobranca/ex-clientes") return "ex_cliente";
  if (caminho === "/cobranca/ativos") return "ativo";
  return new URLSearchParams(search).get("carteira") === "ex_cliente" ? "ex_cliente" : "ativo";
}

export function caminhoNaCarteira(caminho: string, carteira: Carteira): string {
  const [rota, consulta] = caminho.split("?");
  const params = new URLSearchParams(consulta);
  params.set("carteira", carteira);
  return `${rota}?${params.toString()}`;
}

export function retornoDaCarteira(carteira: Carteira): string {
  return carteira === "ex_cliente" ? "/cobranca/ex-clientes" : "/cobranca/ativos";
}

export const NOME_DA_CARTEIRA: Record<Carteira, string> = {
  ativo: "Clientes ativos",
  ex_cliente: "Ex-clientes",
};
