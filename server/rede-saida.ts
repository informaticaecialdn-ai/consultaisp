/**
 * Por qual endereco este servidor SAI para a internet.
 *
 * O SERVIDOR TEM DOIS: um IPv4 (187.127.7.168, o que esta no DNS, nos runbooks
 * e em toda instrucao que damos a provedor) e um IPv6 que a hospedagem atribui
 * sozinha e que nao aparece em lugar nenhum da nossa documentacao.
 *
 * O Node 17+ resolve nome com `verbatim`: usa os enderecos na ordem em que o
 * resolvedor devolve, e o resolvedor do Linux poe o IPv6 na frente quando o
 * destino tem AAAA. Resultado: falamos com metade da internet por um endereco
 * que ninguem sabe que e nosso.
 *
 * ISSO QUEBRA TODA INTEGRACAO COM LISTA DE IP PERMITIDO, e quebrou uma de
 * verdade. Amplinet, 04/09/2026, integracao SGP, tres dias de investigacao:
 *
 *   amplisinal.sgp.net.br   A 177.52.36.133   AAAA 2804:7438:2:c1::36:133
 *   nosso socket saia como  2a02:4780:6e:afa::1  ->  2804:7438:2:c1::36:133
 *   a lista do token tinha  187.127.7.168
 *
 *   resolucao padrao      -> 403 "As credenciais de autenticacao nao foram fornecidas."
 *   com ipv4first         -> 200, cliente lido
 *
 * A mesma credencial, o mesmo codigo, o mesmo servidor. So mudou a familia do
 * endereco de origem. E o provedor passou dois dias trocando token e mexendo em
 * permissao de usuario porque a mensagem do SGP nao distingue "host nao
 * autorizado" de qualquer outra recusa de autenticador.
 *
 * O demo do SGP funcionava o tempo todo — `demo.sgp.net.br` nao tem AAAA, entao
 * aquele ia por IPv4. Foi o que fez a hipotese demorar: o codigo estava provado
 * contra um servidor que, por acaso, nao tinha o problema.
 *
 * `ipv4first` REORDENA, nao filtra: um destino que so tenha AAAA continua sendo
 * alcancado por IPv6. Ou seja, isto nao fecha porta nenhuma — so garante que,
 * havendo escolha, saiamos pelo endereco que dissemos ao mundo que e o nosso.
 *
 * Vale para o processo inteiro (Asaas, Resend, OpenAI, SPC, todos os ERPs), e e
 * proposital: o SPC tambem trabalha com IP liberado, e a proxima integracao com
 * allowlist nao deveria descobrir isto de novo do zero.
 *
 * Chame ANTES de qualquer requisicao de saida — na primeira linha de cada
 * entrada de processo (server/index.ts e server/worker.ts).
 */
import dns from "node:dns";
import { logger } from "./logger";

export function preferirIPv4NaSaida(): void {
  const anterior = dns.getDefaultResultOrder();
  if (anterior === "ipv4first") return;

  dns.setDefaultResultOrder("ipv4first");
  logger.info(
    { anterior, agora: "ipv4first" },
    "[rede] saida preferindo IPv4 — o IPv4 e o endereco que os parceiros liberam na lista deles",
  );
}
