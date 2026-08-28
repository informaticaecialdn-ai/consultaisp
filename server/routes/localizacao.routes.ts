import { Router } from "express";
import { requireAuth, requireAdmin } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";
import { getBackfillStatus, runGeocodeBackfill, varreduraAtiva } from "../services/geocode-backfill.service";
import { bairrosDaRede, MIN_POR_BAIRRO } from "../services/rede-regional.service";
import { resolverAreaAtendida, normalizarCidade } from "../services/area-atendida";
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
   * Tira ou devolve uma cidade ao mapa da carteira.
   *
   * O corte automatico e por massa (20 clientes), e ele erra num caso comum: o
   * endereco de cobranca numa capital junta dezenas de clientes, passa o piso e
   * nao e praca. Aqui o provedor corrige na mao.
   *
   * Guarda o NOME como veio da tela, e a comparacao normaliza dos dois lados —
   * "Curitiba", "curitiba" e "Curitiba - PR" sao a mesma cidade. Guardar
   * normalizado faria a lista aparecer sem acento na tela de configuracao.
   */
  router.patch("/api/localizacao/cidades/:cidade", requireAuth, requireAdmin, async (req, res) => {
    try {
      const cidade = String(req.params.cidade || "").trim();
      if (!cidade) return res.status(400).json({ message: "Informe a cidade" });
      const excluir = req.body?.excluir === true;

      const providerId = req.session.providerId!;
      const provider = await storage.getProvider(providerId);
      const atual = provider?.cidadesExcluidasDoMapa ?? [];
      const alvo = normalizarCidade(cidade);

      const nova = excluir
        ? (atual.some(c => normalizarCidade(c) === alvo) ? atual : [...atual, cidade])
        : atual.filter(c => normalizarCidade(c) !== alvo);

      // updateProviderProfile e o caminho que a Regionalizacao ja usa para
      // gravar cidadesAtendidas; updateProvider e estreito de proposito.
      await storage.updateProviderProfile(providerId, { cidadesExcluidasDoMapa: nova } as any);
      return res.json({ cidade, excluida: excluir, cidadesExcluidasDoMapa: nova });
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
