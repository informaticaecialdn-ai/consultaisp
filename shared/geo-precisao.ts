/**
 * Procedência da coordenada de um cliente — de onde o ponto veio e quanto
 * ele afirma.
 *
 * O mesmo desenho do Provedor.ai (`geo_precisao`: mk · cnefe_endereco ·
 * cnefe_logradouro · cnefe_bairro), com as fontes daqui. Sem isto o mapa
 * tinha de escolher entre plotar aproximação como se fosse endereço exato ou
 * não plotar; com isto, o ponto aproximado aparece translúcido e o popup diz
 * o que ele é.
 *
 *   erp         — latitude/longitude que o ERP guarda no cadastro (instalação)
 *   endereco    — casa: rua e número batem (IBGE CNEFE ou geocoder)
 *   logradouro  — a rua, sem o número
 *   cep         — CEP de logradouro, um trecho de rua
 *   bairro      — um endereço real do bairro, não a casa: APROXIMAÇÃO
 *
 * Nada pior que bairro é gravado. "Cidade" não é a localização de ninguém.
 */
export type GeoPrecisao = "erp" | "endereco" | "logradouro" | "cep" | "bairro";

export const GEO_PRECISAO_ROTULO: Record<GeoPrecisao, string> = {
  erp: "coordenada do ERP",
  endereco: "endereço",
  logradouro: "rua",
  cep: "CEP da rua",
  bairro: "bairro · aproximado",
};

/** Ponto que não afirma a casa — desenhado translúcido e dito no popup. */
export function geoAproximada(p: string | null | undefined): boolean {
  return p === "bairro";
}
