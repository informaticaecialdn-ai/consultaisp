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
 *   vizinho     — o trecho da rua onde o PRÓPRIO provedor já tem instalações
 *                 georreferenciadas: APROXIMAÇÃO
 *   bairro      — um endereço real do bairro, não a casa: APROXIMAÇÃO
 *
 * Nada pior que bairro é gravado. "Cidade" não é a localização de ninguém.
 *
 * ── Por que `vizinho` entrou aqui (04/09/2026) ────────────────────────────
 * O backfill passou a gravar esta string em `customers.geo_precisao` para o
 * cliente cuja rua nenhuma base pública conhece — 84% dos 86 clientes que
 * sobravam fora do mapa na Amplinet estão em rua que o censo do IBGE não
 * nomeia. O ponto vem de `server/services/vizinho-de-rua.service.ts`.
 *
 * A coluna é `text` sem união fechada, então o valor entraria no banco de
 * qualquer jeito e NADA quebraria — e era exatamente esse o perigo: enquanto
 * `geoAproximada()` não conhecesse "vizinho", o marcador sairia SÓLIDO e o mapa
 * afirmaria a casa que a guarda de dispersão existe para não afirmar. Falha
 * silenciosa, do tipo que só aparece quando alguém bate na porta errada.
 */
export type GeoPrecisao = "erp" | "endereco" | "logradouro" | "cep" | "vizinho" | "bairro";

export const GEO_PRECISAO_ROTULO: Record<GeoPrecisao, string> = {
  erp: "coordenada do ERP",
  endereco: "endereço",
  logradouro: "rua",
  cep: "CEP da rua",
  vizinho: "mesma rua · aproximado",
  bairro: "bairro · aproximado",
};

/**
 * Ponto que não afirma a casa — desenhado translúcido e dito no popup.
 *
 * `logradouro` e `cep` ficam de fora, e isso é DÍVIDA declarada, não decisão:
 * eles também são a rua e o trecho de rua, não a porta. Repintá-los mexe na
 * carteira histórica inteira e precisa de medição e do aval do dono; está
 * anotado em `client/src/components/maps/procedencia-ponto.ts`, que é quem
 * desenha.
 */
export function geoAproximada(p: string | null | undefined): boolean {
  return p === "bairro" || p === "vizinho";
}
