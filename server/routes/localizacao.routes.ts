import { Router } from "express";
import { requireAuth, requireAdmin, requireProvider } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";
import { getBackfillStatus, runGeocodeBackfill, varreduraAtiva } from "../services/geocode-backfill.service";
import { bairrosDaRede, MIN_POR_BAIRRO } from "../services/rede-regional.service";
import { resolverAreaAtendida, normalizarCidade } from "../services/area-atendida";
import { ehCamadaTerritorio, municipioDaCidade, pontosDoTerritorio } from "../services/territorio-pontos.service";
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

  router.get("/api/localizacao", requireAuth, requireProvider, async (req, res) => {
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
  router.patch("/api/localizacao/cidades/:cidade", requireAuth, requireProvider, requireAdmin, async (req, res) => {
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
  router.get("/api/localizacao/rede", requireAuth, requireProvider, async (req, res) => {
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
  router.get("/api/localizacao/plotagem", requireAuth, requireProvider, async (_req, res) => {
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
  router.post("/api/localizacao/plotagem", requireAuth, requireProvider, requireAdmin, async (req, res) => {
    if (await varreduraAtiva()) {
      return res.json({ iniciado: false, mensagem: "A plotagem já está em andamento." });
    }
    // A carteira de quem clicou vem primeiro; o resto da base segue depois.
    runGeocodeBackfill(req.session.providerId ?? undefined)
      .catch(err => logger.error({ err }, "Plotagem manual falhou"));
    return res.json({ iniciado: true, mensagem: "Plotagem iniciada. Os pontos aparecem no mapa conforme forem resolvidos." });
  });

  /**
   * Camada fixa de fundo do mapa — endereços do IBGE ou UCs da ANEEL de uma
   * cidade, como Float32Array bruto [lat, lon, ...].
   *
   * Binário e não JSON porque são centenas de milhares de pontos que vão
   * direto para a GPU no cliente. O cache é longo e com ETag porque a base
   * não muda entre deploys: o navegador baixa uma vez por cidade e camada, e
   * trocar de cidade em foco só recombina o que já tem.
   *
   * É base pública — nada aqui é de cliente nem de provedor. Ainda assim
   * exige sessão: não é um asset estático, é uma rota da tela.
   *
   * O 400 e o 404 saem com `no-store`: o cliente pede com `force-cache`, que
   * serve qualquer entrada guardada, e um 404 é cacheável por heurística —
   * a base carregada hoje ficaria invisível até o operador limpar o cache.
   *
   * A UF desempata cidades homônimas. Vem de `?uf=` quando quem chama sabe;
   * senão, da área atendida do provedor — a tela não a conhece, o servidor sim.
   */
  router.get("/api/localizacao/territorio/:camada/:cidade", requireAuth, requireProvider, async (req, res) => {
    try {
      const camada = String(req.params.camada || "");
      if (!ehCamadaTerritorio(camada)) {
        res.set("Cache-Control", "no-store");
        return res.status(400).json({ message: "Camada desconhecida" });
      }
      const cidade = String(req.params.cidade || "").trim();
      if (!cidade) {
        res.set("Cache-Control", "no-store");
        return res.status(400).json({ message: "Informe a cidade" });
      }

      const ufQuery = String(req.query.uf ?? "").trim().toUpperCase();
      let uf: string | null = /^[A-Z]{2}$/.test(ufQuery) ? ufQuery : null;
      if (!uf && req.session.providerId) {
        uf = (await resolverAreaAtendida(req.session.providerId)).uf ?? null;
      }

      const municipio = await municipioDaCidade(cidade, uf);
      if (!municipio) {
        res.set("Cache-Control", "no-store");
        return res.status(404).json({ message: "Sem base para esta cidade" });
      }

      const r = await pontosDoTerritorio(camada, municipio);
      if (!r) {
        res.set("Cache-Control", "no-store");
        return res.status(404).json({ message: "Sem base para esta cidade" });
      }

      res.set({
        "Cache-Control": "private, max-age=604800, immutable",
        "ETag": r.etag,
        "Content-Type": "application/octet-stream",
        // O CNEFE "de banco" não é o mesmo recorte do .bin (ver o cabeçalho do
        // serviço); a tela troca o rótulo por este cabeçalho.
        "X-Territorio-Origem": r.origem,
      });
      if (req.headers["if-none-match"] === r.etag) return res.status(304).end();
      return res.send(Buffer.from(r.pontos.buffer, r.pontos.byteOffset, r.pontos.byteLength));
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
