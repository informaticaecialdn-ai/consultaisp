/**
 * Rotas das marcas white label.
 *
 * Duas metades bem diferentes:
 *
 *  - PUBLICA: serve logo e favicon. Precisa ser publica porque a tela de LOGIN
 *    ja mostra a marca, antes de existir sessao.
 *  - SUPERADMIN: cria, edita e vincula marcas a provedores.
 *
 * ── POR QUE O SVG E SERVIDO, E NUNCA EMBUTIDO NA PAGINA ────────────────────
 *
 * Um SVG e um documento: aceita <script>, <foreignObject> e atributos on*.
 * Embutido no HTML, o logo de um revendedor executaria script na origem da
 * aplicacao, no navegador dos clientes dele — e o CSP do projeto tem
 * `script-src 'unsafe-inline'`, entao nao barraria.
 *
 * A alternativa comum e escrever um sanitizador com allowlist. Sanitizador de
 * SVG feito a mao e notoriamente furado, e nao ha DOMPurify no projeto.
 *
 * Entao a garantia vem do NAVEGADOR, nao de codigo meu: SVG carregado por
 * <img src> tem script desligado por especificacao, em todos os navegadores.
 * Basta nunca embutir. O unico caminho que restaria e alguem ABRIR a URL do
 * logo direto, onde ele seria documento de novo — e para esse caso a resposta
 * leva `Content-Security-Policy: default-src 'none'`, que o deixa inerte.
 *
 * `nosniff` fecha a terceira porta: sem ele, um "SVG" que na verdade e HTML
 * poderia ser reinterpretado pelo navegador.
 *
 * NAO copiar o padrao de provider.routes.ts (upload de documentos): la o
 * Content-Type devolvido vem do cliente, e a rota so nao e XSS armazenado
 * porque manda `Content-Disposition: attachment`. Aqui o conteudo e servido
 * inline, entao essa protecao acidental nao existiria.
 */
import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireSuperAdmin } from "../auth";
import { esquecerMarcas } from "../services/marca.service";
import { corValida, paletaClara, paletaEscura } from "../utils/marca-cores";
import { normalizarHost, MAIN_DOMAIN } from "../tenant";
import { getSafeErrorMessage } from "../utils/safe-error";
import { logger } from "../logger";

/** Teto de tamanho. Logo de marca nao chega perto disso; e barreira de abuso. */
const LIMITE_SVG = 256 * 1024;
const LIMITE_PNG = 512 * 1024;

/**
 * Recusa o que claramente nao e SVG antes de gravar.
 *
 * Isto NAO e a defesa contra XSS — a defesa e servir por <img> (ver o topo do
 * arquivo). E higiene: impede guardar HTML no campo do logo e devolver um 500
 * confuso mais tarde.
 */
function svgAceitavel(svg: string): { ok: true } | { ok: false; motivo: string } {
  const t = svg.trim();
  if (t.length > LIMITE_SVG) return { ok: false, motivo: "SVG acima de 256 KB." };
  if (!t.startsWith("<") || !/<svg[\s>]/i.test(t)) return { ok: false, motivo: "Conteudo nao e um SVG." };
  if (!/<\/svg>\s*$/i.test(t)) return { ok: false, motivo: "SVG incompleto." };
  return { ok: true };
}

function pngAceitavel(dataUri: string): { ok: true } | { ok: false; motivo: string } {
  if (dataUri.length > LIMITE_PNG) return { ok: false, motivo: "PNG acima de 512 KB." };
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUri.trim());
  if (!m) return { ok: false, motivo: "Envie um PNG como data URI base64." };
  // Assinatura do formato: 89 50 4E 47. Extensao e cabecalho mentem; o byte nao.
  const cabecalho = Buffer.from(m[1].slice(0, 16), "base64");
  if (cabecalho.length < 4 || cabecalho[0] !== 0x89 || cabecalho[1] !== 0x50 ||
      cabecalho[2] !== 0x4e || cabecalho[3] !== 0x47) {
    return { ok: false, motivo: "O arquivo nao e um PNG de verdade." };
  }
  return { ok: true };
}

const esquemaMarca = z.object({
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, "Slug: minusculas, numeros e hifens."),
  nomeProduto: z.string().min(1).max(60),
  assinatura: z.string().max(120).nullish(),
  dominio: z.string().max(200).nullish(),
  logoSvg: z.string().nullish(),
  logoPng: z.string().nullish(),
  faviconSvg: z.string().nullish(),
  corBrand: z.string().refine(corValida, "Cor invalida: use #RRGGBB."),
  corBrandDark: z.string().refine(corValida, "Cor invalida: use #RRGGBB.").nullish(),
  emailRemetente: z.string().email().nullish(),
  emailNomeExibicao: z.string().max(60).nullish(),
  suporteEmail: z.string().email().nullish(),
  suporteWhatsapp: z.string().max(30).nullish(),
  site: z.string().url().nullish(),
  responsavelRazaoSocial: z.string().max(140).nullish(),
  responsavelCnpj: z.string().max(20).nullish(),
  ativo: z.boolean().optional(),
});

/** Valida os campos que o zod nao alcanca e normaliza o dominio. */
function prepararMarca(dados: any): { erro: string } | { dados: any } {
  const saida = { ...dados };

  if (saida.logoSvg) {
    const r = svgAceitavel(saida.logoSvg);
    if (!r.ok) return { erro: r.motivo };
  }
  if (saida.faviconSvg) {
    const r = svgAceitavel(saida.faviconSvg);
    if (!r.ok) return { erro: `Favicon: ${r.motivo}` };
  }
  if (saida.logoPng) {
    const r = pngAceitavel(saida.logoPng);
    if (!r.ok) return { erro: r.motivo };
    // Gravar a MESMA forma que foi validada. Sem isto, um data URI com espaco
    // ou newline na frente passa na checagem e depois some do prefixo removido
    // na hora de servir — o logo sai como bytes que nao sao PNG.
    saida.logoPng = saida.logoPng.trim();
  }
  if (saida.dominio) {
    const d = normalizarHost(saida.dominio);
    // Dominio da marca nao pode ser dentro da plataforma: la quem manda e o
    // subdominio do provedor, e as duas regras brigariam.
    if (!d || !d.includes(".")) return { erro: "Dominio invalido." };
    // Contra MAIN_DOMAIN, nao contra a string literal: com o dominio da
    // plataforma vindo do ambiente, um literal aqui deixaria de proteger
    // silenciosamente no dia em que ele mudar.
    if (d === MAIN_DOMAIN || d.endsWith(`.${MAIN_DOMAIN}`)) {
      return { erro: "Use um dominio proprio; o subdominio da plataforma ja e automatico." };
    }
    saida.dominio = d;
  }
  return { dados: saida };
}

export function registerMarcaRoutes(): Router {
  const router = Router();

  // ── Publico: os arquivos da marca ────────────────────────────────────────

  /** Cabecalhos que tornam o arquivo inerte mesmo se aberto direto. */
  function servirImagem(res: any, corpo: Buffer | string, tipo: string) {
    res.set({
      "Content-Type": tipo,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "Cache-Control": "public, max-age=300",
    });
    res.end(corpo);
  }

  router.get("/api/marca/:id/logo", async (req, res) => {
    try {
      const marca = await storage.getMarca(Number(req.params.id));
      if (!marca || !marca.ativo) return res.status(404).end();

      if (marca.logoSvg) return servirImagem(res, marca.logoSvg, "image/svg+xml");
      if (marca.logoPng) {
        const base64 = marca.logoPng.replace(/^data:image\/png;base64,/, "");
        return servirImagem(res, Buffer.from(base64, "base64"), "image/png");
      }
      return res.status(404).end();
    } catch (error: any) {
      logger.error({ err: error }, "falha ao servir logo da marca");
      return res.status(404).end();
    }
  });

  router.get("/api/marca/:id/favicon", async (req, res) => {
    try {
      const marca = await storage.getMarca(Number(req.params.id));
      if (!marca?.ativo || !marca.faviconSvg) return res.status(404).end();
      return servirImagem(res, marca.faviconSvg, "image/svg+xml");
    } catch {
      return res.status(404).end();
    }
  });

  // ── Superadmin: gestao ───────────────────────────────────────────────────

  router.get("/api/admin/marcas", requireSuperAdmin, async (_req, res) => {
    try {
      const marcas = await storage.getAllMarcas();
      // Sem os campos pesados: a listagem nao precisa carregar tres SVGs por linha.
      const enxuto = marcas.map(({ logoSvg, logoPng, faviconSvg, ...resto }) => ({
        ...resto,
        temLogo: Boolean(logoSvg || logoPng),
        logoEhPng: Boolean(!logoSvg && logoPng),
        temFavicon: Boolean(faviconSvg),
      }));
      return res.json(enxuto);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/marcas/:id", requireSuperAdmin, async (req, res) => {
    try {
      const marca = await storage.getMarca(Number(req.params.id));
      if (!marca) return res.status(404).json({ message: "Marca nao encontrada." });
      const provedores = await storage.getProvidersPorMarca(marca.id);
      return res.json({
        ...marca,
        provedores,
        // A previa deixa visivel o ajuste de contraste: o revendedor ve qual cor
        // vai realmente aparecer, em vez de descobrir depois no ar.
        previa: corValida(marca.corBrand)
          ? { claro: paletaClara(marca.corBrand), escuro: paletaEscura(marca.corBrand, marca.corBrandDark) }
          : null,
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/marcas", requireSuperAdmin, async (req, res) => {
    try {
      const parsed = esquemaMarca.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Dados invalidos." });
      }
      const preparado = prepararMarca(parsed.data);
      if ("erro" in preparado) return res.status(400).json({ message: preparado.erro });

      if (await storage.getMarcaPorSlug(preparado.dados.slug)) {
        return res.status(409).json({ message: "Ja existe marca com este identificador." });
      }
      if (preparado.dados.dominio && await storage.getMarcaPorDominio(preparado.dados.dominio)) {
        return res.status(409).json({ message: "Este dominio ja pertence a outra marca." });
      }

      const criada = await storage.createMarca(preparado.dados);
      esquecerMarcas();
      return res.status(201).json(criada);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/admin/marcas/:id", requireSuperAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const parsed = esquemaMarca.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Dados invalidos." });
      }
      const preparado = prepararMarca(parsed.data);
      if ("erro" in preparado) return res.status(400).json({ message: preparado.erro });

      const atual = await storage.getMarca(id);
      if (!atual) return res.status(404).json({ message: "Marca nao encontrada." });

      // O zod DESCARTA chave que nao esta no esquema, em silencio. Um PATCH so
      // com campo desconhecido — `{"dominioStatus":"ativo"}`, que e do operador
      // e nao do formulario — chega aqui como objeto vazio, e um UPDATE sem
      // coluna nenhuma faz o Drizzle lancar "No values to set": 500 com texto
      // generico, como se o servidor tivesse quebrado. Nao gravar nada e pedido
      // invalido, entao a resposta e 400 e diz o que aconteceu.
      if (Object.keys(preparado.dados).length === 0) {
        return res.status(400).json({ message: "Nada a alterar: nenhum campo editavel no corpo." });
      }

      // Colisao de slug precisa virar mensagem, nao erro de banco: sem isto o
      // operador via "Nao foi possivel salvar" com o texto cru do Postgres.
      if (preparado.dados.slug && preparado.dados.slug !== atual.slug) {
        const homonima = await storage.getMarcaPorSlug(preparado.dados.slug);
        if (homonima && homonima.id !== id) {
          return res.status(409).json({ message: "Ja existe marca com este identificador." });
        }
      }

      if (preparado.dados.dominio) {
        const dono = await storage.getMarcaPorDominio(preparado.dados.dominio);
        if (dono && dono.id !== id) {
          return res.status(409).json({ message: "Este dominio ja pertence a outra marca." });
        }
        // Trocar o dominio invalida o certificado emitido para o anterior.
        if (atual.dominio !== preparado.dados.dominio) {
          preparado.dados.dominioStatus = "pendente";
        }
      }

      const atualizada = await storage.updateMarca(id, preparado.dados);
      esquecerMarcas();
      return res.json(atualizada);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * Confirma que o certificado do dominio foi emitido.
   *
   * So o operador chama, depois de rodar script/dominio-whitelabel.sh. A
   * aplicacao nao emite certificado (exigiria root), entao ela tambem nao pode
   * afirmar sozinha que o dominio esta servindo HTTPS.
   */
  router.post("/api/admin/marcas/:id/dominio-ativo", requireSuperAdmin, async (req, res) => {
    try {
      const marca = await storage.getMarca(Number(req.params.id));
      if (!marca) return res.status(404).json({ message: "Marca nao encontrada." });
      if (!marca.dominio) return res.status(400).json({ message: "Esta marca nao tem dominio proprio." });
      const atualizada = await storage.marcarDominioAtivo(marca.id);
      esquecerMarcas();
      return res.json(atualizada);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/admin/marcas/:id", requireSuperAdmin, async (req, res) => {
    try {
      // deleteMarca desliga os provedores na mesma transacao: provedor apontando
      // para marca apagada quebraria a resolucao de host no login.
      await storage.deleteMarca(Number(req.params.id));
      esquecerMarcas();
      return res.json({ ok: true });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/admin/provedores-sem-marca", requireSuperAdmin, async (_req, res) => {
    try {
      return res.json(await storage.getProvidersSemMarca());
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  const vinculoSchema = z.object({
    providerId: z.number().int().positive(),
    marcaId: z.number().int().positive().nullable(),
  });

  router.post("/api/admin/marcas/vincular", requireSuperAdmin, async (req, res) => {
    try {
      const parsed = vinculoSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Dados invalidos." });

      const { providerId, marcaId } = parsed.data;
      if (marcaId !== null && !(await storage.getMarca(marcaId))) {
        return res.status(404).json({ message: "Marca nao encontrada." });
      }
      if (!(await storage.getProvider(providerId))) {
        return res.status(404).json({ message: "Provedor nao encontrado." });
      }

      await storage.setMarcaDoProvider(providerId, marcaId);
      esquecerMarcas();
      return res.json({ ok: true });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
