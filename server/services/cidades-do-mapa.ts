/**
 * Quais cidades da carteira entram no mapa — a regra, num lugar só.
 *
 * POR QUE ISTO EXISTE. A regra nasceu dentro de `localizacao.storage.ts`, que é
 * quem desenha o mapa e alimenta o KPI "Sem coordenada". Quando a medição de
 * cobertura (`cobertura-geo.service.ts`) passou a contar quem está fora do mapa
 * e a virar FILA DE DOWNLOAD do IBGE, as duas leituras da mesma tela passaram a
 * responder sobre universos diferentes:
 *
 *   · o KPI dizia "184 sem coordenada" contando só as cidades do mapa;
 *   · o bloco de cobertura logo abaixo contava TODA cidade da carteira, e
 *     colocava no topo da fila de download justamente a capital que o provedor
 *     tinha tirado do mapa de propósito — dezenas de MB e milhões de linhas
 *     para clientes que ninguém vai plotar.
 *
 * E havia uma promessa falsa: cidade abaixo do piso de massa não vai ao mapa
 * nem com a base carregada, então anunciar "N clientes esperam a base de X"
 * seria repetir, em escala menor, o defeito que originou esta tela — um número
 * verdadeiro levando à conclusão errada.
 *
 * Função pura, sem banco: as duas pontas passam a mesma contagem e a mesma
 * lista de exclusões e recebem a mesma resposta. É o que impede a divergência
 * de voltar em silêncio.
 */
import { normalizarCidade } from "./area-atendida";

/**
 * Cidade com menos clientes que isto não entra no mapa da carteira.
 *
 * Não é área de atuação — é endereço avulso: cliente que mudou de cidade,
 * cobrança com endereço de escritório, cadastro com a capital digitada por
 * engano. Plotar os 6 clientes espalhados por 37 cidades esticaria o mapa do
 * Paraná a Brasília e afundaria a praça real em zoom.
 */
export const MIN_CLIENTES_CIDADE = 20;

/**
 * As chaves (`normalizarCidade`) das cidades que vão ao mapa.
 *
 * `contagens` é cidade normalizada → clientes daquele provedor, sobre a
 * carteira INTEIRA — a mesma base sobre a qual `getLocalizacao` aplica o piso.
 * `excluidas` são os nomes como o provedor os gravou; normalizar aqui dentro
 * evita que uma ponta compare cru e a outra normalizado.
 *
 * A ESCOLHA DO PROVEDOR VENCE O CORTE AUTOMÁTICO: o piso de massa acerta na
 * maioria e erra num caso comum — o endereço de cobrança numa capital junta
 * dezenas de clientes, passa o piso e não é praça (na NsLink é Curitiba, com 43
 * clientes e zero inadimplentes).
 */
export function cidadesNoMapa(
  contagens: Iterable<[string, number]>,
  excluidas: Iterable<string | null | undefined> = [],
): Set<string> {
  const fora = new Set(
    Array.from(excluidas, c => normalizarCidade(c)).filter(Boolean),
  );
  const dentro = new Set<string>();
  for (const [chave, clientes] of contagens) {
    if (!chave) continue;
    if (clientes >= MIN_CLIENTES_CIDADE && !fora.has(chave)) dentro.add(chave);
  }
  return dentro;
}
