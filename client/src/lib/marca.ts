/**
 * A marca vigente nesta aba.
 *
 * O servidor resolve pelo host e escreve `window.__MARCA__` dentro do HTML,
 * antes de o React montar (server/marca-html.ts). Por isso aqui nao ha estado,
 * contexto nem requisicao: o valor ja esta pronto no primeiro render e nao muda
 * enquanto a pagina viver.
 *
 * Buscar isto por fetch seria pior de um jeito que nao se conserta com spinner:
 * a tela pintaria com a marca da plataforma e trocaria depois. Mostrar por um
 * instante a marca de um concorrente na tela de login de um revendedor nao e
 * lentidao, e erro.
 */

export type MarcaCliente = {
  /**
   * "tenant" = este endereco pertence a um provedor ou revendedor; sem sessao,
   * a tela certa e o LOGIN. "plataforma" = a landing publica.
   *
   * Vem do servidor porque o cliente nao consegue decidir: em dominio proprio
   * (app.crednet.com.br) nao ha subdominio nenhum para inspecionar.
   */
  contexto: "plataforma" | "tenant";
  marcaId: number | null;
  nomeProduto: string;
  assinatura: string | null;
  /** Nulo = desenhar o simbolo vetorial da plataforma. */
  logoUrl: string | null;
  suporteEmail: string | null;
  suporteWhatsapp: string | null;
  site: string | null;
  /** Quem responde pelo tratamento de dados perante o titular. Ver LGPD. */
  responsavelRazaoSocial: string | null;
  responsavelCnpj: string | null;
  /**
   * A paleta CLARA da marca, em hex. Só para quem não vive dentro do CSS da
   * página — hoje, o relatório impresso, que abre num documento novo e sempre
   * em fundo branco.
   */
  paletaClara: { brand: string; ink: string; soft: string } | null;
};

/**
 * Usado quando `window.__MARCA__` nao existe — build antigo, teste, ou HTML
 * servido sem passar pela injecao. Espelha client/index.html.
 */
const PADRAO: MarcaCliente = {
  contexto: "plataforma",
  marcaId: null,
  nomeProduto: "Consulta ISP",
  assinatura: "Base colaborativa de crédito",
  logoUrl: null,
  suporteEmail: null,
  suporteWhatsapp: null,
  site: null,
  responsavelRazaoSocial: null,
  responsavelCnpj: null,
  paletaClara: null,
};

declare global {
  interface Window {
    __MARCA__?: Partial<MarcaCliente>;
  }
}

let memoria: MarcaCliente | null = null;

export function marcaAtual(): MarcaCliente {
  if (memoria) return memoria;
  const injetada = typeof window !== "undefined" ? window.__MARCA__ : undefined;
  // Campo a campo, e nao spread cru: um `nomeProduto: null` vindo do servidor
  // apagaria o padrao e a interface ficaria sem nome nenhum.
  memoria = {
    contexto: injetada?.contexto === "tenant" ? "tenant" : PADRAO.contexto,
    marcaId: injetada?.marcaId ?? PADRAO.marcaId,
    nomeProduto: injetada?.nomeProduto || PADRAO.nomeProduto,
    assinatura: injetada?.assinatura ?? PADRAO.assinatura,
    logoUrl: injetada?.logoUrl ?? PADRAO.logoUrl,
    suporteEmail: injetada?.suporteEmail ?? PADRAO.suporteEmail,
    suporteWhatsapp: injetada?.suporteWhatsapp ?? PADRAO.suporteWhatsapp,
    site: injetada?.site ?? PADRAO.site,
    responsavelRazaoSocial: injetada?.responsavelRazaoSocial ?? PADRAO.responsavelRazaoSocial,
    responsavelCnpj: injetada?.responsavelCnpj ?? PADRAO.responsavelCnpj,
    paletaClara: injetada?.paletaClara ?? PADRAO.paletaClara,
  };
  return memoria;
}

/** Acucar para componentes. Nao dispara re-render porque o valor e imutavel. */
export function useMarca(): MarcaCliente {
  return marcaAtual();
}

/** True quando o sistema esta vestindo a marca de um revendedor. */
export function ehWhiteLabel(): boolean {
  return marcaAtual().marcaId !== null;
}

/** Só para os testes, que precisam reavaliar `window.__MARCA__`. */
export function esquecerMarcaMemorizada(): void {
  memoria = null;
}
