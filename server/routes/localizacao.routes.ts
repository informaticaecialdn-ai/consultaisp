import { Router } from "express";
import { requireAuth, requireAdmin, requireProvider } from "../auth";
import { storage } from "../storage";
import { getSafeErrorMessage } from "../utils/safe-error";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { getBackfillStatus, runGeocodeBackfill, varreduraAtiva } from "../services/geocode-backfill.service";
import { bairrosDaRede, MIN_POR_BAIRRO } from "../services/rede-regional.service";
import { resolverAreaAtendida, normalizarCidade } from "../services/area-atendida";
import { ehCamadaTerritorio, municipioDaCidade, pontosDoTerritorio } from "../services/territorio-pontos.service";
import { coberturaDaCarteira, type CidadeDaCarteira } from "../services/cobertura-geo.service";
import {
  cargaDeCoberturaAtiva, estadoDaCobertura, rodarCargaDeCobertura,
} from "../services/cobertura-geo-agenda.service";
import { logger } from "../logger";

/**
 * Uma cidade da carteira, como a tela a recebe.
 *
 * A forma é a MESMA de `CidadeDaCarteira` — município aninhado, e não achatado
 * em nome/uf/ibge. Achatar aqui criaria um segundo vocabulário para a mesma
 * coisa, e quem lê o cliente ao lado do serviço teria de traduzir de cabeça.
 * O município oficial é o que vai para a tela; as grafias são o que o provedor
 * procura no ERP quando precisa corrigir o cadastro.
 */
const cidadeParaTela = (c: CidadeDaCarteira) => ({
  municipio: c.municipio,
  clientes: c.clientes,
  semCoordenada: c.semCoordenada,
  grafias: c.grafias,
  chaves: c.chaves,
});

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
   * Cobertura da base de endereços para a carteira DESTE provedor.
   *
   * É a resposta à pergunta que a tela não sabia fazer. Medido na Amplinet em
   * 04/09/2026: "184 clientes esperam plotagem · carteira sem geocodificação",
   * lido pelo dono como "o sistema não plota". Não era — a base do IBGE
   * carregada cobria 9 municípios do Paraná, a região de outro provedor, e nada
   * na tela dizia isso. Agora diz, e diz separando as três causas, porque a
   * correção de cada uma é de gente diferente: falta baixar a base (nosso),
   * o cadastro não tem UF e a cidade fica ambígua (do provedor, no ERP), e a
   * grafia não é cidade nenhuma — "EMBU GAUCU", "PARQUE JANDAIA" (do provedor).
   *
   * SÓ AGREGADO. Nenhum CPF, nenhum nome de cliente: o que sai daqui são nomes
   * de município, as grafias que o próprio ERP do provedor gravou e contagens.
   */
  router.get("/api/localizacao/cobertura", requireAuth, requireProvider, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const c = await coberturaDaCarteira(providerId);
      const carga = estadoDaCobertura();
      // A trava é GLOBAL — o recurso disputado (o FTP do IBGE e as tabelas de
      // endereço) é um só para toda a plataforma —, e é ela que responde por
      // qualquer processo: a passada do worker acontece no outro. É o mesmo
      // remendo que `varreduraAtiva` faz na plotagem, logo acima.
      const ocupado = await cargaDeCoberturaAtiva();
      // A passada do worker cobre a base INTEIRA, e as cidades que falharam
      // nela são de outros provedores. Dizer "falhou Londrina" a quem atende
      // São Paulo entregaria a praça de um tenant a outro — o que este produto
      // não faz nem com o id numérico. Detalhe só quando a passada foi desta
      // carteira; o "servidor ocupado" não identifica ninguém e pode aparecer.
      const minha = carga.alvo === providerId;

      // Campo a campo, e não `...c`: o dia em que o serviço ganhar um campo
      // novo, ele não vai para a rede sem alguém decidir que pode.
      return res.json({
        cidades: c.cidades,
        clientes: c.clientes,
        semCoordenada: c.semCoordenada,
        comBase: c.comBase.map(cidadeParaTela),
        semBase: c.semBase.map(cidadeParaTela),
        semMunicipio: c.semMunicipio.map(s => ({
          chave: s.chave,
          grafias: s.grafias,
          clientes: s.clientes,
          semCoordenada: s.semCoordenada,
          motivo: s.motivo,
        })),
        carga: {
          /**
           * DOIS FATOS DIFERENTES, e misturá-los congelava a tela de todo mundo.
           *
           * `emAndamento` é "a carga DESTA carteira está rodando" — é o que
           * autoriza a tela a dizer "leva alguns minutos, pode sair desta tela"
           * e a repetir a leitura de 10 em 10 segundos. `ocupado` é "o servidor
           * está carregando alguma base", que também impede o disparo (a trava é
           * global) mas não promete nada a quem está olhando.
           *
           * Com um campo só, a passada do worker — base inteira, todo boot e a
           * cada 24h, podendo durar horas — punha TODO provedor com a tela
           * aberta num botão desabilitado, com uma frase falsa e um poll a cada
           * 10s, para uma carga em que nenhuma cidade dele estava sendo baixada.
           */
          emAndamento: minha && carga.emAndamento,
          ocupado,
          cidade: minha ? carga.cidadeAtual : null,
          concluidas: minha ? carga.carregadas + carga.falhas : null,
          total: minha ? carga.aCarregar : null,
          terminadaEm: minha ? carga.terminadoEm : null,
          carregadas: minha ? carga.carregadas : null,
          falhas: minha ? carga.falhas : null,
          cidadesComFalha: minha ? carga.ultimasFalhas : [],
        },
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * Baixa do IBGE e carrega a base das cidades da carteira que ainda não têm.
   *
   * QUEM PODE: o ADMIN DO PROVEDOR, e não só o superadmin. A carga é cara — é
   * o FTP do IBGE e dezenas de MB por município —, mas exigir superadmin
   * devolveria o problema ao estado que o dono recusou: uma rotina que só existe
   * para quem tem acesso ao servidor. Quem está olhando a tela e vendo a própria
   * carteira fora do mapa é o provedor. É também a mesma régua do botão vizinho
   * na mesma tela ("Plotar agora", que gasta a quota de geocodificação da
   * plataforma): duas réguas diferentes para dois botões lado a lado seria uma
   * armadilha. O recorte é sempre a carteira da SESSÃO — um provedor não manda
   * baixar a praça de outro.
   *
   * 202 IMEDIATO. A carga leva minutos e o nginx corta em 60s
   * (`proxy_read_timeout`): segurar a requisição faria a tela dizer "erro" para
   * uma carga que ia terminar bem, e convidaria a clicar de novo. O resultado
   * aparece em GET /api/localizacao/cobertura, que é a mesma tela.
   */
  // Depois das guardas, de propósito: a chave do limite é o providerId (ver
  // `chaveDoLimite`), então um operador sem permissão que insistisse na rota
  // esgotaria a cota do admin do próprio provedor.
  const limiteCargaDeBase = createRateLimiter({ windowMs: 3_600_000, maxRequests: 6 });

  /**
   * MESMO CAMINHO DO GET, como em `/api/localizacao/plotagem` logo acima: o
   * express despacha por método, e o botão vizinho da mesma tela já é assim.
   *
   * Não é preferência de estilo. A rota nasceu em `/cobertura/carregar` e o
   * client fazia POST em `/cobertura`: o botão que é a razão de ser desta
   * entrega não funcionava, e nenhum teste segurava — o teste batia no caminho
   * do servidor. Em desenvolvimento o sintoma nem era 404: o catch-all da SPA
   * (`app.use("/{*path}")` em vite.ts) responde a qualquer método com 200 e o
   * index.html, `throwIfResNotOk` deixava passar e o `.json()` estourava num
   * toast vermelho de erro de parser de JavaScript. Um caminho só, e um teste
   * batendo exatamente onde o client bate, é o que impede a repetição.
   */
  router.post(
    "/api/localizacao/cobertura",
    requireAuth, requireProvider, requireAdmin, limiteCargaDeBase,
    async (req, res) => {
      try {
        const providerId = req.session.providerId!;

        // A trava é GLOBAL, e não por provedor: o recurso disputado é o FTP do
        // IBGE e as tabelas de endereço, que são uma só para todos os tenants.
        // `cargaDeCoberturaAtiva` enxerga o outro processo (o worker); a
        // segunda metade da condição fecha a janela DESTE, e entre ela e o
        // disparo não há await — dois cliques não viram duas passadas.
        if (await cargaDeCoberturaAtiva() || estadoDaCobertura().emAndamento) {
          return res.status(202).json({
            iniciado: false,
            mensagem: "Já existe uma carga de base em andamento. O resultado aparece nesta tela quando terminar.",
          });
        }

        rodarCargaDeCobertura(providerId)
          .then(estado => {
            // Carregada a base, quem esperava por ela é exatamente a fila de
            // plotagem — sem isto o provedor veria "base carregada" com o mapa
            // ainda vazio até a passada de 6h. Só quando ALGUMA base entrou:
            // sem base nova, plotar de novo repete a passada que já falhou.
            if (estado.carregadas > 0) return runGeocodeBackfill(providerId);
          })
          .catch(err => logger.error({ err }, "Carga de base de endereços falhou"));

        return res.status(202).json({
          iniciado: true,
          mensagem: "Buscando a base de endereços do IBGE. Leva alguns minutos; o progresso aparece nesta tela.",
        });
      } catch (error: any) {
        return res.status(500).json({ message: getSafeErrorMessage(error) });
      }
    },
  );

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
