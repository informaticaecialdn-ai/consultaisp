import { Router, type Request, type Response } from "express";
import { requireAuth, requireProvider } from "../auth";
import { logger } from "../logger";
import { getSafeErrorMessage } from "../utils/safe-error";
import { maskName } from "../services/lgpd-masking";
import { lerAutomacaoChat, janelaDoChat } from "@shared/cobranca/automacao-chat";
import { ChatBullqStorage } from "../storage/chat-bullq.storage";
import { FaturasStorage } from "../storage/faturas.storage";

/**
 * INDICADORES DA COBRANCA — o que a automacao fez, e quanto a cobranca
 * recuperou (fase 3; recursos C6 e C8 do 2Safe).
 *
 * Duas perguntas que o operador faz todo dia e que o sistema nao respondia:
 *
 *   1. "o robo esta trabalhando?"  → quantos primeiros contatos SAIRAM hoje,
 *      contra o teto do dia, e o diario dos ultimos envios.
 *   2. "isso adiantou alguma coisa?" → quanto foi baixado no ERP depois de um
 *      contato, quebrado por origem (assistente ou operador) e por canal.
 *
 * REGRA DE OURO DESTE ARQUIVO (integridade do dado): quando a fonte nao existe,
 * a resposta traz `null` e o MOTIVO, e a tela desenha "—". Nunca zero, nunca um
 * numero de ontem apresentado como o de hoje. Cada `null` abaixo tem uma frase
 * dizendo por que ele e nulo.
 *
 * POR QUE O STORAGE E INSTANCIADO AQUI, e nao vem de `storage`: as leituras
 * novas moram em `faturas.storage.ts` e `chat-bullq.storage.ts`; a fachada
 * `server/storage/index.ts` esta sendo editada por outra frente neste mesmo
 * momento e declarar metodo la agora criaria conflito. As duas classes nao tem
 * estado, entao instanciar e barato e o comportamento e identico ao da fachada
 * (que so as proxia). Quando a IStorage declarar os dois metodos, estas duas
 * linhas viram `storage.` e nada mais muda.
 */
const chat = new ChatBullqStorage();
const faturas = new FaturasStorage();

export const API_AUTOMACAO = "/api/cobranca/indicadores/automacao";
export const API_RECUPERACAO = "/api/cobranca/indicadores/recuperacao";

/**
 * O teto por rodada e o intervalo dela sao do worker
 * (`server/services/chat/chat-primeiro-contato.service.ts`): `Math.min(5, ...)`
 * dentro de um `setInterval(..., 60_000)`. Nao sao configuraveis, e a tela os
 * AFIRMA para o provedor — por isso saem daqui e ha teste lendo o fonte do
 * servico para o dia em que alguem mudar um dos dois.
 */
export const CONTATOS_POR_RODADA = 5;
export const SEGUNDOS_ENTRE_RODADAS = 60;

const providerDaSessao = (req: Request): number => req.session.providerId as number;

function falha(res: Response, e: unknown) {
  return res.status(500).json({ message: getSafeErrorMessage(e) });
}

/**
 * Inteiro de query string dentro de uma faixa; qualquer lixo cai no padrao.
 *
 * A vazia (`?janela=`) e AUSENCIA, e nao zero: a barra de filtros manda o
 * parametro vazio ao limpar um campo, e `Number("")` e 0 — que cairia no minimo
 * da faixa e mudaria o indicador sem ninguem ter pedido.
 */
function inteiro(valor: unknown, padrao: number, min: number, max: number): number {
  if (valor === undefined || valor === null || valor === "") return padrao;
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

export function registerCobrancaIndicadoresRoutes(): Router {
  const router = Router();

  /**
   * GET /api/cobranca/indicadores/automacao
   *
   * O contador honesto do primeiro contato automatico. `hoje` e EXATAMENTE o
   * numero que o worker usa para decidir se ainda pode contatar
   * (`contatosIniciadosNoDia`), sobre a mesma virada de dia (fuso de Sao Paulo,
   * `janelaDoChat`): se a tela mostrasse outra conta, o provedor veria "3 de 10"
   * e o robo pararia por achar que ja fez 10.
   *
   * O que esse numero conta, e o texto da tela precisa dizer: CONTATO QUE SAIU,
   * pelo whatsapp — o da rodada automatica e o do botao "Enviar p/ cobranca".
   * Conversa reaproveitada nao entra (nenhuma mensagem saiu) e nao gasta cota.
   * O banco NAO separa a rodada automatica do clique do operador: os dois
   * gravam o mesmo evento, com o mesmo formato. Prometer essa separacao seria
   * inventar dado.
   *
   * Sem integracao provisionada, `hoje` e `limiteDiario` vem nulos com motivo:
   * nao existe automacao para contar, e zero seria uma afirmacao falsa.
   */
  router.get(API_AUTOMACAO, requireAuth, requireProvider, async (req, res) => {
    const providerId = providerDaSessao(req);
    try {
      const integracao = await chat.getIntegracaoDoChat(providerId);
      const { dia, inicioDoDia } = janelaDoChat(new Date(), undefined, []);
      if (!integracao) {
        return res.json({
          provisionado: false,
          ligada: false,
          dia,
          hoje: null,
          limiteDiario: null,
          motivo: "O chat ainda nao foi provisionado para este provedor; nao ha automacao para contar.",
          porRodada: CONTATOS_POR_RODADA,
          segundosEntreRodadas: SEGUNDOS_ENTRE_RODADAS,
          envios: [],
        });
      }
      const config = (integracao.agenteConfig ?? {}) as Record<string, unknown>;
      const automacao = lerAutomacaoChat(config.primeiroContato);
      const [hoje, envios] = await Promise.all([
        chat.contatosIniciadosNoDia(providerId, inicioDoDia),
        chat.ultimosPrimeirosContatos(providerId, 20),
      ]);
      res.json({
        provisionado: true,
        ligada: automacao.ligada,
        dia,
        hoje,
        limiteDiario: automacao.limiteDiario,
        motivo: null,
        porRodada: CONTATOS_POR_RODADA,
        segundosEntreRodadas: SEGUNDOS_ENTRE_RODADAS,
        // O cliente e do proprio provedor, mas o painel e um relatorio de
        // maquina: nome parcial basta para reconhecer a linha (LGPD, minimo
        // necessario). Quem precisa da ficha inteira abre o 360.
        envios: envios.map(e => ({
          em: e.em.toISOString(),
          origem: e.origem,
          canal: e.canal,
          cliente: maskName(e.clienteNome ?? "", false),
          clienteId: e.clienteId,
          resultado: e.resultado,
        })),
      });
    } catch (e) {
      logger.error({ err: e, providerId }, "COBRANCA indicadores: automacao nao carregou");
      falha(res, e);
    }
  });

  /**
   * GET /api/cobranca/indicadores/recuperacao?dias=30&janela=7
   *
   * Quanto foi baixado no ERP depois de um contato — ver
   * `FaturasStorage.recuperacaoAposContato` para a regra inteira (so varredura
   * completa baixa fatura; atribuicao de ultimo toque; o que "assistente"
   * significa e o que ele NAO significa).
   *
   * `base: false` devolve valores nulos com motivo — provedor sem fatura vinda
   * do ERP nao recuperou R$ 0,00, ele nao tem como saber.
   */
  router.get(API_RECUPERACAO, requireAuth, requireProvider, async (req, res) => {
    const providerId = providerDaSessao(req);
    const dias = inteiro(req.query.dias, 30, 1, 365);
    const janelaDias = inteiro(req.query.janela, 7, 1, 90);
    try {
      const r = await faturas.recuperacaoAposContato(providerId, { dias, janelaDias });
      res.json({
        ...r,
        desde: r.desde.toISOString(),
        ate: r.ate.toISOString(),
      });
    } catch (e) {
      logger.error({ err: e, providerId }, "COBRANCA indicadores: recuperacao nao carregou");
      falha(res, e);
    }
  });

  return router;
}
