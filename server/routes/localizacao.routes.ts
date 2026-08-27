import { Router } from "express";
import { requireAuth, requireAdmin } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";
import { getBackfillStatus, runGeocodeBackfill, varreduraAtiva } from "../services/geocode-backfill.service";
import { bairrosDaRede, MIN_POR_BAIRRO } from "../services/rede-regional.service";
import { resolverAreaAtendida } from "../services/area-atendida";
import { logger } from "../logger";

/**
 * Endpoint unico da tela de Localizacao.
 *
 * Devolve pontos, bairros, cidades e a contagem sem coordenada numa chamada —
 * os quatro conjuntos saem da mesma varredura, entao dividir em quatro rotas
 * custaria quatro varreduras.
 */
export function registerLocalizacaoRoutes(): Router {
  const router = Router();

  router.get("/api/localizacao", requireAuth, async (req, res) => {
    try {
      const data = await storage.getLocalizacao(req.session.providerId!);
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * Mapa da rede — ex-clientes com divida de TODOS os provedores, nas cidades
   * que este provedor atende.
   *
   * E a pergunta que so o bureau responde, e por isso e a que mais exige
   * cuidado: o mascaramento (deslocamento da coordenada, faixa em vez de valor,
   * k-anonimato por celula, zero identificacao de cliente ou de provedor) esta
   * inteiro em rede-regional.service.ts, e e la que ele deve ficar — nunca no
   * cliente, que qualquer um inspeciona.
   */
  router.get("/api/localizacao/rede", requireAuth, async (req, res) => {
    try {
      const area = await resolverAreaAtendida(req.session.providerId!);
      const cidades = area.cidades ?? [];
      if (cidades.length === 0) {
        // Sem area declarada nao ha recorte, e varrer o Brasil inteiro nao e
        // "a rede na cidade" — e a base toda.
        return res.json({ bairros: [], pontos: [], ocultas: 0, semArea: true, minPorBairro: MIN_POR_BAIRRO });
      }
      const r = await bairrosDaRede(cidades);
      return res.json({ ...r, semArea: false, minPorBairro: MIN_POR_BAIRRO });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * Situacao da plotagem automatica — so o ESTADO do trabalho.
   *
   * Quantos clientes faltam e responsabilidade de GET /api/localizacao, que ja
   * varre a carteira com o recorte territorial da tela. Contar de novo aqui,
   * com outro filtro, punha dois numeros discordantes na mesma pagina.
   */
  router.get("/api/localizacao/plotagem", requireAuth, async (_req, res) => {
    try {
      const job = getBackfillStatus();
      const rodando = await varreduraAtiva();
      return res.json({
        emAndamento: rodando,
        // A varredura cobre a base toda, entao o motivo cru (mensagem do
        // Google, host, IP do servidor) e detalhe de infraestrutura: nao vai
        // para a tela de um provedor. O texto completo fica no log.
        geocoderIndisponivel: job.geocoderIndisponivel,
        terminadoEm: job.terminadoEm,
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * Dispara a plotagem agora, sem esperar a passada de 6h do worker.
   *
   * Roda solto: a varredura leva minutos e a resposta HTTP nao pode ficar
   * pendurada nela. A trava de banco impede colisao com a passada do worker —
   * e a resposta diz qual dos dois casos aconteceu, em vez de afirmar
   * "iniciada" quando o disparo virou no-op.
   */
  router.post("/api/localizacao/plotagem", requireAuth, requireAdmin, async (req, res) => {
    if (await varreduraAtiva()) {
      return res.json({ iniciado: false, mensagem: "A plotagem já está em andamento." });
    }
    // A carteira de quem clicou vem primeiro; o resto da base segue depois.
    runGeocodeBackfill(req.session.providerId ?? undefined)
      .catch(err => logger.error({ err }, "Plotagem manual falhou"));
    return res.json({ iniciado: true, mensagem: "Plotagem iniciada. Os pontos aparecem no mapa conforme forem resolvidos." });
  });

  return router;
}
