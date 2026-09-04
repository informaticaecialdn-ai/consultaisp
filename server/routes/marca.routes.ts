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
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { esquecerEstadoDaMarca, requireSuperAdmin } from "../auth";
import { hashPassword } from "../password";
import { esquecerMarcas } from "../services/marca.service";
import { corValida, paletaClara, paletaEscura } from "../utils/marca-cores";
import { validarCNPJ } from "../utils/cpf-cnpj-validator";
import { normalizarHost, MAIN_DOMAIN } from "../tenant";
import { getSafeErrorMessage } from "../utils/safe-error";
import { logger } from "../logger";
import { esquemaLandingDaMarca } from "@shared/marca-landing";
import { listarEventosDaMarca, registrarEventoDaMarca } from "../services/marca-eventos.service";
import { sendBoasVindasRevendedorEmail } from "../services/email";
import { pngAceitavel, svgAceitavel } from "../utils/marca-arquivos";
import {
  CODIGO_MARCA_COM_HISTORICO,
  CODIGO_MARCA_COM_REVENDA,
  contarRevendedoresDaMarca,
  getUsuariosDaMarca,
  type VinculosDaMarca,
} from "../storage/marcas.storage";


/**
 * CNPJ com digito verificador conferido.
 *
 * O desenho pede a checagem so em `responsavelCnpj`, mas ela vale igual em
 * `repasseCnpj`, e por um motivo mais concreto: aquele nomeia o controlador na
 * tela de LGPD, e este e a pessoa juridica para quem a NF de comissao vai ser
 * emitida. Um digito trocado no primeiro publica um controlador que nao existe;
 * no segundo, a nota sai para um CNPJ que a Receita recusa — e isso so aparece
 * no dia do pagamento.
 *
 * A pontuacao e gravada COMO FOI DIGITADA, sem normalizar para so digitos: as
 * linhas ja existentes tem mascara, e normalizar so as novas deixaria a coluna
 * com dois formatos sem que nada passasse a depender disso. Nenhuma consulta
 * procura marca por CNPJ.
 */
const cnpjComDigito = (campo: string) =>
  z
    .string()
    .trim()
    .max(20)
    // String vazia e "limpar o campo", nao CNPJ invalido: a tela manda `null`,
    // mas quem chama por fora manda `""` e a intencao e a mesma.
    .refine(v => v === "" || validarCNPJ(v), `${campo}: CNPJ invalido — o digito verificador nao fecha.`)
    .transform(v => (v === "" ? null : v))
    .nullish();

/**
 * Percentual de comissao — 0 a 50, gravado como STRING de duas casas.
 *
 * A coluna e `numeric(5,2)` e o driver a entrega como string; devolver um float
 * daqui obrigaria o Drizzle a converter e reintroduziria o arredondamento que a
 * coluna existe para evitar.
 *
 * `z.coerce.number()` seria mais curto e estaria errado: `Number(null)` e 0, e
 * um `{"comissaoPercentual": null}` gravaria 0% em silencio numa marca que
 * negociou 20 — a uniao abaixo recusa o null, que e o que uma coluna NOT NULL
 * merece.
 */
const percentualDeComissao = z
  .union([
    z.number(),
    z.string().trim().regex(/^\d{1,2}([.,]\d{1,2})?$/, "Comissao: use um numero como 20 ou 17,5."),
  ])
  .transform(v => (typeof v === "number" ? v : Number(v.replace(",", "."))))
  .refine(v => Number.isFinite(v) && v >= 0 && v <= 50, "Comissao: o percentual vai de 0 a 50.")
  /**
   * Terceira casa e RECUSADA, e nao arredondada.
   *
   * Sem esta linha os dois ramos da uniao discordavam sobre o mesmo valor: a
   * regex ja recusava `"17,555"`, mas o numero `17.555` passava e o `toFixed`
   * abaixo o gravava como 17,56 sem dizer nada. A coluna e `numeric(5,2)` e
   * arredondaria de qualquer jeito — o problema nao e o arredondamento, e ele
   * acontecer em silencio num campo que multiplica dinheiro todo mes.
   *
   * A comparacao passa pelo `toFixed` de proposito: `v * 100 === Math.round(v * 100)`
   * seria o teste obvio e esta errado — `17.55 * 100` da 1754.9999999999998 em
   * ponto flutuante, e um percentual perfeitamente valido seria recusado.
   */
  .refine(v => Number(v.toFixed(2)) === v, "Comissao: use no maximo duas casas decimais.")
  // Duas casas sempre, para o CHECK `marcas_comissao_faixa` e a leitura da tela
  // verem o mesmo formato que o banco guarda.
  .transform(v => v.toFixed(2));

/**
 * ── O ESQUEMA EM DUAS METADES ───────────────────────────────────────────────
 *
 * A metade de cima e o que o REVENDEDOR edita na propria marca
 * (`PATCH /api/revenda/marca`, fase 2); a de baixo e o acrescimo que so o
 * superadmin escreve. As duas juntas sao o esquema desta rota.
 *
 * A divisao existe para que a rota do revendedor nao precise repetir a lista —
 * lista repetida diverge no primeiro campo novo, e o campo que ficar de fora da
 * copia errada e comissao, repasse ou `revenda_ativa`. Aqui a unica forma de um
 * campo chegar ao revendedor e ele estar escrito na metade de cima.
 *
 * `.strict()` nas duas, e isso MUDA o comportamento antigo de proposito: antes
 * o zod descartava chave desconhecida em silencio e respondia 200. Para o
 * superadmin isso era so ruido; para o revendedor seria uma armadilha — ele
 * mandaria `{"comissaoPercentual": 50}`, receberia 200, leria o valor antigo na
 * tela e tentaria de novo. Recusar dizendo o nome do campo e a unica resposta
 * que nao mente.
 */
export const esquemaMarcaDoRevendedor = z.object({
  nomeProduto: z.string().min(1).max(60),
  assinatura: z.string().max(120).nullish(),
  logoSvg: z.string().nullish(),
  logoPng: z.string().nullish(),
  faviconSvg: z.string().nullish(),
  corBrand: z.string().refine(corValida, "Cor invalida: use #RRGGBB."),
  corBrandDark: z.string().refine(corValida, "Cor invalida: use #RRGGBB.").nullish(),
  emailNomeExibicao: z.string().max(60).nullish(),
  suporteEmail: z.string().email().nullish(),
  suporteWhatsapp: z.string().max(30).nullish(),
  site: z.string().url().nullish(),
  cadastroAberto: z.boolean().optional(),
  landingAtiva: z.boolean().optional(),
  /**
   * O JSONB inteiro, substituido de uma vez — nao ha merge de campo solto.
   * Sem `.nullish()`: a coluna e NOT NULL com default `{}`, e "apagar a landing"
   * se escreve mandando `{}`, que o esquema aceita e completa com os padroes.
   */
  landing: esquemaLandingDaMarca.optional(),
  ogImagePng: z.string().nullish(),
}).strict();

/**
 * So o superadmin. Cada campo aqui e dinheiro, identidade juridica ou endereco:
 * `slug` e `dominio` decidem por onde a marca e alcancada, `revendaAtiva` e
 * `statusComercial` decidem se ela comissiona, `comissaoPercentual` e o
 * percentual negociado, e os `repasse*` sao para onde o dinheiro vai.
 */
export const esquemaMarcaDoSuperadmin = z.object({
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, "Slug: minusculas, numeros e hifens."),
  dominio: z.string().max(200).nullish(),
  ativo: z.boolean().optional(),
  emailRemetente: z.string().email().nullish(),
  responsavelRazaoSocial: z.string().max(140).nullish(),
  responsavelCnpj: cnpjComDigito("Responsavel"),
  revendaAtiva: z.boolean().optional(),
  statusComercial: z.enum(["ativo", "suspenso"], {
    errorMap: () => ({ message: "Status comercial: use 'ativo' ou 'suspenso'." }),
  }).optional(),
  /**
   * Mudar o percentual vale do proximo lancamento em diante e NAO reescreve
   * nenhum ja gravado: `comissao_lancamentos.percentual` guarda o vigente no
   * instante da entrada de dinheiro justamente para que uma renegociacao nao
   * refaca meses ja pagos. Esta rota nao encosta naquela tabela, e o teste
   * "alterar o percentual nao escreve em mais nada" existe para que continue
   * assim.
   */
  comissaoPercentual: percentualDeComissao.optional(),
  repasseRazaoSocial: z.string().max(140).nullish(),
  repasseCnpj: cnpjComDigito("Repasse"),
  repasseChavePix: z.string().max(140).nullish(),
  repasseEmail: z.string().email().nullish(),
}).strict();

const esquemaMarca = esquemaMarcaDoRevendedor.merge(esquemaMarcaDoSuperadmin);

/**
 * A primeira falha do zod, em portugues e apontando o campo.
 *
 * O caso que motivou: com `.strict()`, chave desconhecida sai como
 * "Unrecognized key(s) in object: 'comissaoPercentual'" — em ingles e sem dizer
 * que a recusa e de PERMISSAO, nao de formato. Quem le e o operador, e a
 * diferenca entre "campo invalido" e "este campo nao e seu" e a diferenca entre
 * corrigir o valor e parar de tentar.
 *
 * Exportada junto do esquema porque a rota do revendedor precisa exatamente
 * desta traducao: ela nasceu la como copia (`server/routes/revenda.routes.ts`),
 * e duas copias da mesma mensagem divergem no primeiro ajuste de texto — do
 * mesmo jeito que duas copias da lista de campos divergiriam.
 */
export function primeiroErro(erro: z.ZodError): string {
  const falha = erro.errors[0];
  if (!falha) return "Dados invalidos.";
  if (falha.code === "unrecognized_keys") {
    return `Campo que esta rota nao edita: ${falha.keys.join(", ")}.`;
  }
  const caminho = falha.path.join(".");
  return caminho ? `${caminho}: ${falha.message}` : falha.message;
}

/** Valida os campos que o zod nao alcanca e normaliza o dominio. */
function prepararMarca(dados: any): { erro: string } | { dados: any } {
  const saida = { ...dados };

  /**
   * GRAVAR A MESMA FORMA QUE FOI VALIDADA, nos quatro campos.
   *
   * Os validadores aparam antes de olhar. Gravar o valor original depois disso
   * ja mordeu nos PNG: um data URI com espaco ou newline na frente — o que sai
   * de qualquer copiar-e-colar — passa na checagem, entra inteiro no banco, e
   * na hora de servir o `replace(/^data:image\/png;base64,/,"")` nao casa; o
   * `Buffer.from` recebe o cabecalho junto e devolve bytes que nao sao PNG. O
   * logo some sem erro em lugar nenhum.
   *
   * Os dois SVG estavam de fora dessa correcao e entram agora pelo mesmo
   * argumento, nao por simetria: espaco antes do prologo torna o documento XML
   * invalido, e quem serve o campo manda `image/svg+xml` com `nosniff`.
   */
  for (const [campo, rotulo, tipo] of [
    ["logoSvg", "", "svg"],
    ["faviconSvg", "Favicon: ", "svg"],
    ["logoPng", "", "png"],
    ["ogImagePng", "Imagem de compartilhamento: ", "png"],
  ] as const) {
    const valor = saida[campo];
    if (!valor) continue;
    const aparado = String(valor).trim();
    const r = tipo === "svg" ? svgAceitavel(aparado) : pngAceitavel(aparado);
    if (!r.ok) return { erro: `${rotulo}${r.motivo}` };
    saida[campo] = aparado;
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

/**
 * O `:id` da rota, ou null.
 *
 * `Number("abc")` e NaN, e NaN chegando ao Drizzle vira erro de sintaxe do
 * Postgres — 500 com "Erro interno do servidor" para o que e simplesmente um
 * endereco que nao existe.
 */
function idDaRota(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Senha temporaria de acesso novo.
 *
 * `randomInt` e nao `randomBytes[i] % alfabeto.length`: 256 nao e multiplo de
 * 56, entao o resto favorece o comeco do alfabeto. Aqui o vies quase nao muda a
 * entropia, mas o dia em que alguem copiar este trecho para gerar um token de
 * convite ele muda.
 *
 * O alfabeto nao tem O/0 nem I/l/1: esta senha e ditada por telefone ou colada
 * de um bilhete, e "a pessoa nao consegue entrar" custa mais caro que os dois
 * bits que os caracteres removidos valiam.
 */
const ALFABETO_DA_SENHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function gerarSenhaTemporaria(tamanho = 14): string {
  let saida = "";
  for (let i = 0; i < tamanho; i++) saida += ALFABETO_DA_SENHA[crypto.randomInt(ALFABETO_DA_SENHA.length)];
  return saida;
}

/**
 * Campos cujo VALOR nao entra na trilha — so a presenca.
 *
 * Um logo pode ter 256 KB, e o `detalhe` do evento e JSONB numa tabela
 * append-only: gravar o antes e o depois de dois SVGs em cada edicao faria a
 * trilha crescer em megabytes por marca, e a pergunta que ela responde ("o logo
 * mudou nesta edicao?") e respondida por "presente → presente" do mesmo jeito.
 */
const CAMPOS_VOLUMOSOS = new Set(["logoSvg", "logoPng", "faviconSvg", "ogImagePng"]);

/** O antes/depois de uma edicao, no formato que a trilha guarda. */
function diffDaEdicao(anterior: Record<string, any> | undefined, novos: Record<string, unknown>) {
  const campos: Record<string, unknown> = {};
  for (const [campo, depois] of Object.entries(novos)) {
    if (CAMPOS_VOLUMOSOS.has(campo)) {
      campos[campo] = { de: anterior?.[campo] ? "presente" : "ausente", para: depois ? "presente" : "ausente" };
      continue;
    }
    campos[campo] = { de: anterior?.[campo] ?? null, para: depois };
  }
  return campos;
}

/** "3 registro(s) na trilha de auditoria, 2 pedido(s) de credito" — so o que existe. */
function descreverHistorico(h: VinculosDaMarca["historico"]): string {
  const rotulos: Array<[number, string]> = [
    [h.eventos, "registro(s) na trilha de auditoria"],
    [h.lancamentos, "lançamento(s) de comissão"],
    [h.fechamentos, "fechamento(s) de comissão"],
    [h.pedidosDeCredito, "pedido(s) de crédito"],
    [h.faturas, "fatura(s)"],
    [h.precos, "preço(s) próprio(s)"],
    [h.conversasDeVisitante, "conversa(s) de visitante"],
    [h.pedidosDeTitular, "pedido(s) de titular (LGPD)"],
  ];
  return rotulos.filter(([n]) => n > 0).map(([n, r]) => `${n} ${r}`).join(", ");
}

/**
 * Quem esta agindo, no formato que a trilha pede.
 *
 * `requireSuperAdmin` ja recusou tudo que nao tem sessao, mas o tipo de
 * `express-session` mantem `userId` opcional. A conversao acontece AQUI, uma
 * vez, e nao em cada ponto de chamada: `marca_eventos.user_id` e NOT NULL com
 * FK para `users.id`, entao um `?? 0` para calar o compilador trocaria o
 * impossivel por um INSERT que falha em silencio (o servico e best-effort) e por
 * uma trilha com um buraco.
 */
function atorDaSessao(req: { session: { userId?: number } }, marcaId: number) {
  return { marcaId, userId: req.session.userId as number, atorRole: "superadmin" as const };
}

/**
 * Grava na trilha sem nunca derrubar a resposta.
 *
 * `registrarEventoDaMarca` ja promete engolir a propria falha, e a promessa
 * dele nao esta em duvida. O que esta em duvida e o CAMINHO: as chamadas vivem
 * dentro do `try` da rota, DEPOIS da gravacao ja ter acontecido. Qualquer
 * excecao que escape de la — o modulo que falha ao carregar, um refactor que
 * troque o `catch` interno por um `throw` — vira 500 para uma alteracao que ja
 * esta no banco, e o operador clica de novo numa acao que ja surtiu efeito.
 *
 * O `catch` local e a mesma repeticao deliberada de `requireRevendedor` provando
 * o host que `requireAuth` ja provou: duas barreiras dizendo a mesma coisa nao
 * se contradizem, e a de fora e a que continua valendo se a de dentro sair.
 */
function trilha(evento: Parameters<typeof registrarEventoDaMarca>[0]) {
  return registrarEventoDaMarca(evento).catch((err) => {
    logger.error(
      { err, marcaId: evento.marcaId, acao: evento.acao },
      "marca_eventos: a rota seguiu sem o registro",
    );
  });
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
        return res.status(400).json({ message: primeiroErro(parsed.error) });
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
      const id = idDaRota(req.params.id);
      if (id === null) return res.status(404).json({ message: "Marca nao encontrada." });
      const parsed = esquemaMarca.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: primeiroErro(parsed.error) });
      }
      const preparado = prepararMarca(parsed.data);
      if ("erro" in preparado) return res.status(400).json({ message: preparado.erro });

      const atual = await storage.getMarca(id);
      if (!atual) return res.status(404).json({ message: "Marca nao encontrada." });

      // Um UPDATE sem coluna nenhuma faz o Drizzle lancar "No values to set":
      // 500 com texto generico, como se o servidor tivesse quebrado. Nao
      // gravar nada e pedido invalido, entao a resposta e 400 e diz o que
      // aconteceu.
      //
      // O que chega aqui vazio e so o `{}` literal. Ate o `.strict()` das duas
      // metades do esquema, um PATCH so com campo desconhecido —
      // `{"dominioStatus":"ativo"}` — tambem chegava, porque o zod descartava a
      // chave em silencio; hoje ele e recusado 20 linhas acima, no `safeParse`,
      // com 400 e o nome do campo.
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

      /**
       * A colisao so faz sentido com dominio de verdade; o reajuste do status
       * vale tambem para `null`, e por isso ele esta FORA deste `if`.
       *
       * Enquanto o reajuste morava aqui dentro, apagar o dominio deixava
       * `dominioStatus` em "ativo" apontando para nada — e era esse estado que
       * fazia `POST /usuarios` criar um acesso que nunca consegue entrar. O
       * certificado do dominio anterior deixa de valer nos dois casos: quando
       * o dominio muda e quando ele some.
       */
      if (preparado.dados.dominio) {
        const dono = await storage.getMarcaPorDominio(preparado.dados.dominio);
        if (dono && dono.id !== id) {
          return res.status(409).json({ message: "Este dominio ja pertence a outra marca." });
        }
      }
      if ("dominio" in preparado.dados && (preparado.dados.dominio ?? null) !== (atual.dominio ?? null)) {
        preparado.dados.dominioStatus = "pendente";
      }

      const atualizada = await storage.updateMarca(id, preparado.dados);
      esquecerMarcas();
      /**
       * `requireRevendedor` guarda por 30s o veredito "esta marca esta ligada"
       * (server/auth.ts). O cache e assimetrico — negativo nunca entra —, entao
       * DESLIGAR ja alcanca a sessao aberta em ate 30s sozinho. Esta linha e
       * para o outro sentido: RELIGAR passa a valer na requisicao seguinte, sem
       * o revendedor ficar meio minuto levando 403 numa marca que o superadmin
       * acabou de reabrir na frente dele.
       */
      if ("ativo" in preparado.dados) esquecerEstadoDaMarca(id);

      /**
       * A trilha vem DEPOIS da gravacao e nunca a derruba (o servico engole a
       * falha com log): o evento registra o que aconteceu, e um evento que
       * impedisse a acao registraria o contrario.
       *
       * `alterar_comissao` sai ALEM de `editar_marca`, com o mesmo dado, e a
       * duplicacao e o ponto: quem audita comissao filtra por um verbo, nao le
       * o diff de toda edicao de marca procurando um campo. A comparacao e
       * numerica porque a coluna e `numeric` e "20" e "20.00" sao o mesmo
       * percentual — comparar as strings inventaria uma alteracao a cada
       * gravacao que reenviasse o valor de sempre.
       */
      const ator = atorDaSessao(req, id);
      await trilha({ ...ator, acao: "editar_marca", detalhe: { campos: diffDaEdicao(atual, preparado.dados) } });

      if (preparado.dados.comissaoPercentual !== undefined
        && Number(atual.comissaoPercentual) !== Number(preparado.dados.comissaoPercentual)) {
        await trilha({
          ...ator,
          acao: "alterar_comissao",
          detalhe: { de: atual.comissaoPercentual, para: preparado.dados.comissaoPercentual },
        });
      }

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
      const id = idDaRota(req.params.id);
      if (id === null) return res.status(404).json({ message: "Marca nao encontrada." });
      // deleteMarca desliga os provedores na mesma transacao: provedor apontando
      // para marca apagada quebraria a resolucao de host no login.
      await storage.deleteMarca(id);
      esquecerMarcas();
      return res.json({ ok: true });
    } catch (error: any) {
      /**
       * As duas recusas de `deleteMarca` sao DECISAO, e nao defeito — e defeito
       * e o que se tenta de novo. Caindo no 500 generico abaixo, o superadmin
       * lia "Erro interno do servidor" e clicava outra vez.
       *
       * Os dois textos sao diferentes porque as saidas sao diferentes: no
       * primeiro ha o que fazer, no segundo nao ha, e prometer um botao que a
       * tela nao tem e pior do que nao dizer nada — o operador procura o botao
       * antes de acreditar que ele nao existe.
       */
      const vinculos: VinculosDaMarca | undefined = error?.vinculos;

      if (error?.codigo === CODIGO_MARCA_COM_REVENDA && vinculos) {
        const partes = [
          vinculos.usuariosRevenda > 0 && `${vinculos.usuariosRevenda} acesso(s) da equipe revendedora`,
          vinculos.lancamentosPendentes > 0 && `${vinculos.lancamentosPendentes} lançamento(s) de comissão pendente(s)`,
          vinculos.fechamentosNaoPagos > 0 && `${vinculos.fechamentosNaoPagos} fechamento(s) de comissão ainda não pago(s)`,
        ].filter(Boolean).join(", ");
        return res.status(409).json({
          message:
            `Esta marca não pode ser excluída: ainda há ${partes} apontando para ela. ` +
            `Remova os acessos da equipe desta marca primeiro; comissão pendente precisa ser fechada e paga antes de a marca sair, ` +
            `porque é ela que prova quanto o revendedor tinha a receber.`,
          code: CODIGO_MARCA_COM_REVENDA,
          vinculos,
        });
      }

      if (error?.codigo === CODIGO_MARCA_COM_HISTORICO && vinculos) {
        return res.status(409).json({
          message:
            `Esta marca não pode ser excluída: existem ${descreverHistorico(vinculos.historico)} que precisam continuar existindo depois dela. ` +
            `A trilha de auditoria prova quem fez o quê sob esta marca, e o pedido de crédito e a fatura guardam a foto da venda sobre a qual a comissão foi calculada — ` +
            `apagar a marca junto reescreveria dinheiro que já mudou de mão. ` +
            /**
             * A alternativa so pode ser oferecida porque ela EXISTE na tela.
             * Ate agora esta frase terminava em "precisa ser feita por quem
             * administra o banco", e terminava assim de proposito: nao havia
             * controle nenhum para `ativo` em /admin/marcas — so o selo
             * "Inativa" —, entao sugerir "desligue a marca" mandaria o operador
             * procurar um botao inexistente. O interruptor "Marca no ar" entrou
             * na aba Comercial; se ele sair de la, esta frase volta a mentir.
             */
            `Para tirá-la do ar sem apagar nada, desligue "Marca no ar" na aba Comercial: ` +
            `o domínio para de responder e o painel do revendedor cai, e o histórico continua de pé. ` +
            `A exclusão definitiva precisa ser feita por quem administra o banco.`,
          code: CODIGO_MARCA_COM_HISTORICO,
          vinculos,
        });
      }

      /**
       * Rede para a corrida: as contagens de `deleteMarca` saem do pool, entao
       * uma linha criada entre a contagem e o DELETE chega aqui como violacao de
       * FK. O estado nao mudou (a transacao voltou atras), e a resposta certa
       * continua sendo 409, nao 500.
       */
      const codigoPg = error?.code ?? error?.cause?.code;
      if (codigoPg === "23503") {
        return res.status(409).json({
          message:
            "Esta marca não pôde ser excluída: surgiu um registro apontando para ela enquanto a exclusão acontecia. Recarregue a lista e veja o que ficou vinculado.",
          code: CODIGO_MARCA_COM_HISTORICO,
        });
      }

      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ── Superadmin: a equipe revendedora ─────────────────────────────────────
  //
  // Quem cria e remove acesso de revendedor e SO o superadmin — o revendedor
  // administra a equipe dele em `/api/revenda/usuarios` (fase 2), dentro da
  // propria marca. Estas rotas sao a porta de entrada do onboarding, e a ordem
  // dele e do dono (decisao 10): dominio com HTTPS emitido, depois revenda
  // ativa, depois o primeiro acesso.

  const esquemaUsuarioDaMarca = z.object({
    name: z.string().trim().min(2, "Nome: informe pelo menos 2 caracteres.").max(120),
    email: z.string().trim().toLowerCase().email("E-mail invalido."),
    phone: z.string().trim().max(30).nullish(),
  }).strict();

  router.get("/api/admin/marcas/:id/usuarios", requireSuperAdmin, async (req, res) => {
    try {
      const id = idDaRota(req.params.id);
      if (id === null) return res.status(404).json({ message: "Marca nao encontrada." });
      if (!(await storage.getMarca(id))) return res.status(404).json({ message: "Marca nao encontrada." });
      return res.json(await getUsuariosDaMarca(id));
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/admin/marcas/:id/usuarios", requireSuperAdmin, async (req, res) => {
    try {
      const id = idDaRota(req.params.id);
      if (id === null) return res.status(404).json({ message: "Marca nao encontrada." });
      const parsed = esquemaUsuarioDaMarca.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: primeiroErro(parsed.error) });

      const marca = await storage.getMarca(id);
      if (!marca) return res.status(404).json({ message: "Marca nao encontrada." });

      /**
       * 422 e nao 400: o corpo esta correto e a permissao existe — o que impede
       * e o ESTADO da marca, e ele muda sozinho quando o passo anterior do
       * onboarding for feito.
       *
       * A ordem importa e e a do dono: o revendedor so entra pelo dominio
       * PROPRIO da marca (`hostPertenceAMarca`, em server/routes/auth.routes.ts
       * recusa a raiz da plataforma e ate o subdominio de um provedor dele).
       * Criar o acesso antes do certificado entrega uma conta sem porta: a
       * pessoa recebe e-mail e senha e leva "Email ou senha incorretos" em todo
       * endereco que tentar, porque a recusa por host e generica de proposito.
       */
      /**
       * `!marca.dominio` entra JUNTO de `dominioStatus`, e nao e detalhe.
       *
       * Quem decide se o login passa e `hostPertenceAMarca`, e ela exige que
       * `resolverMarcaPorHost` devolva origem "dominio-proprio" — o que so
       * acontece com um dominio gravado E casando. Conferindo so o status,
       * uma marca com `dominio: null` e `dominioStatus: "ativo"` (estado
       * alcancavel pela tela: o campo esta no formulario e o PATCH aceita
       * `null`) passava por aqui com 201, e a pessoa levava "Email ou senha
       * incorretos" em todo endereco que tentasse, para sempre.
       */
      if (!marca.dominio || marca.dominioStatus !== "ativo") {
        return res.status(422).json({
          message:
            "Esta marca ainda não tem domínio próprio com HTTPS ativo, e o revendedor só entra por ele. " +
            "Aponte o DNS, rode o script de certificado e confirme o domínio antes de criar o primeiro acesso.",
          code: "MARCA_SEM_DOMINIO_ATIVO",
        });
      }
      /**
       * Marca desligada tambem nao resolve host: `resolverMarcaPorHost` filtra
       * por `ativo`. Mesmo desfecho — acesso criado e login recusado sem
       * explicacao —, entao mesmo tratamento, com codigo proprio para a tela
       * saber qual passo falta.
       */
      if (!marca.ativo) {
        return res.status(422).json({
          message:
            "Esta marca está desligada, e uma marca desligada não responde no domínio dela. " +
            "Religue a marca antes de criar o acesso — sem isso o login é recusado em qualquer endereço.",
          code: "MARCA_DESLIGADA",
        });
      }
      /**
       * Segundo degrau da mesma ordem. Uma marca com `revendaAtiva` falsa e a
       * "so pele" — o ISP que quis a propria cara e nao revende nada. Um acesso
       * de revendedor nela abriria um painel comercial sem funcao comercial.
       */
      if (!marca.revendaAtiva) {
        return res.status(422).json({
          message:
            "A revenda desta marca está desligada. Ligue a revenda (campo \"revenda ativa\") antes de criar acesso de revendedor — " +
            "sem ela a marca é apenas a pele visual de um provedor, e não há painel de revenda para a pessoa usar.",
          code: "MARCA_SEM_REVENDA_ATIVA",
        });
      }

      const { name, email, phone } = parsed.data;
      if (await storage.getUserByEmail(email)) {
        return res.status(409).json({ message: "Este e-mail já está em uso por outro acesso." });
      }

      /**
       * `emailVerified: true` porque nao ha caminho de verificacao para ele: o
       * login exige o e-mail verificado, e o reenvio de verificacao resolve a
       * marca pelo PROVEDOR — que o revendedor nao tem. Criado pelo superadmin,
       * o e-mail ja foi conferido fora do sistema.
       *
       * `providerId: null` e obrigatorio pelo CHECK `users_papel_coerente` da
       * migracao 0013 (revendedor tem marca e nao tem provedor) — o banco
       * recusaria o INSERT, mas escrever explicito diz ao leitor que o 0 da
       * sessao dele nao e um provedor de id 0.
       */
      const senha = gerarSenhaTemporaria();
      const criado = await storage.createUser({
        name,
        email,
        phone: phone ?? null,
        password: await hashPassword(senha),
        role: "revendedor",
        marcaId: marca.id,
        providerId: null,
        emailVerified: true,
        mustChangePassword: true,
      });

      await trilha({
        ...atorDaSessao(req, marca.id),
        acao: "criar_usuario_revenda",
        detalhe: { usuarioId: criado.id, email: criado.email, nome: criado.name },
      });

      /**
       * O e-mail diz ONDE entrar; a senha vai na resposta, para quem cria.
       *
       * A divisao e deliberada e esta explicada em `blocoDaCredencial`
       * (server/services/email.ts): a senha nao viaja por e-mail, porque quem
       * cria ja a tem em maos — e a tela a mostra para copiar. O que so o
       * e-mail entrega e o ENDERECO em que o login do revendedor e aceito, e
       * isso quem recebe nao tem de outro jeito: o login e recusado em
       * qualquer outro host, com mensagem generica de proposito.
       *
       * Best-effort, como todo aviso deste repositorio (ver `avisarProvedor`):
       * o usuario ja foi criado quando o envio sai, e derrubar a resposta aqui
       * faria o operador clicar de novo numa acao que ja surtiu efeito — e o
       * segundo clique levaria 409 de e-mail em uso. `sendBoasVindasRevendedor
       * Email` LANCA quando a marca nao tem dominio proprio ativo; o 422 acima
       * ja impede esse caso, e o catch e a rede embaixo.
       */
      let emailEnviado = true;
      try {
        await sendBoasVindasRevendedorEmail(criado.email, {
          nome: criado.name,
          emailDeAcesso: criado.email,
        }, marca.id);
      } catch (erroDeEnvio: any) {
        emailEnviado = false;
        logger.error(
          { err: erroDeEnvio, marcaId: marca.id, usuarioId: criado.id },
          "[marca] acesso de revendedor criado, mas o e-mail de boas-vindas nao saiu",
        );
      }

      /**
       * `emailEnviado` sai no corpo para a TELA nao prometer o que nao
       * aconteceu. Sem ele, o painel teria de escolher uma frase fixa sobre
       * e-mail e ela estaria errada metade das vezes — que foi exatamente o
       * defeito da primeira versao desta tela.
       *
       * A senha nao e gravada em lugar nenhum: no banco fica so o hash, e na
       * trilha a chave `senhaTemporaria` cairia na redacao do servico. No log
       * do servidor ela tambem nao entra — esta rota esta em
       * `ROTAS_SEM_CORPO_NO_LOG` e a chave em `CHAVES_SENSIVEIS`.
       */
      const { password: _senhaHash, verificationToken: _t, resetToken: _r, ...semSegredo } = criado;
      return res.status(201).json({ usuario: semSegredo, senhaTemporaria: senha, emailEnviado });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/admin/marcas/:id/usuarios/:userId", requireSuperAdmin, async (req, res) => {
    try {
      const id = idDaRota(req.params.id);
      const userId = idDaRota(req.params.userId);
      if (id === null || userId === null) return res.status(404).json({ message: "Acesso nao encontrado." });

      const marca = await storage.getMarca(id);
      if (!marca) return res.status(404).json({ message: "Marca nao encontrada." });

      /**
       * 404 UNIFORME, e nao 403: usuario que nao existe e usuario que existe sob
       * outra marca respondem igual. Um 403 aqui transformaria a rota num
       * oraculo — o superadmin nao precisa dele, mas o formato da resposta e o
       * mesmo que a rota espelhada do revendedor vai usar, onde ele seria
       * vazamento entre concorrentes.
       *
       * A comparacao por `marcaId` ja exclui superadmin e usuario de provedor: o
       * CHECK `users_papel_coerente` so deixa `marca_id` preenchido para
       * revendedor. A conferencia de `role` logo abaixo e o que mantem isso
       * verdadeiro se um dia o CHECK sair.
       */
      const alvo = await storage.getUser(userId);
      if (!alvo || alvo.marcaId !== marca.id || alvo.role !== "revendedor") {
        return res.status(404).json({ message: "Acesso nao encontrado nesta marca." });
      }

      /**
       * Nao remover a si mesmo. Hoje o CHECK torna isto inalcancavel — um
       * superadmin nao tem `marca_id`, entao ele nunca e alvo desta rota. A
       * linha fica porque a regra e da ACAO, nao do papel de quem a executa: a
       * rota do revendedor (fase 2) e o espelho desta, e la o proprio usuario e
       * um alvo possivel todo dia.
       */
      if (alvo.id === req.session.userId) {
        return res.status(409).json({ message: "Você não pode remover o próprio acesso." });
      }

      /**
       * Nunca o ultimo. A marca ficaria com painel de revenda ligado e ninguem
       * para entrar nele; o conserto seria criar outro acesso — que e
       * exatamente o que a remocao acabou de tornar necessario, sem avisar.
       */
      if (await contarRevendedoresDaMarca(marca.id, alvo.id) === 0) {
        return res.status(409).json({
          message:
            "Este é o último acesso de revendedor desta marca. Crie o substituto antes de remover este, " +
            "senão a marca fica com a revenda ligada e ninguém para operá-la.",
          code: "ULTIMO_REVENDEDOR",
        });
      }

      try {
        await storage.deleteUser(alvo.id);
      } catch (erro: any) {
        /**
         * `marca_eventos.user_id` e NOT NULL e aponta para `users.id`: quem ja
         * agiu sob a marca esta na trilha, e a trilha nao pode ser reescrita
         * para soltar a linha. `deleteUser` nao traduz FK de proposito ("quem
         * chama e que sabe o que responder"), e sem esta traducao a recusa
         * chegava como 500.
         *
         * A frase nao promete botao nenhum, porque nao ha: a tela nao tem
         * "desativar usuario", e inventar a instrucao seria mandar o operador
         * procurar o que nao existe.
         */
        const codigoPg = erro?.code ?? erro?.cause?.code;
        if (codigoPg === "23503") {
          return res.status(409).json({
            message:
              "Este acesso não pode ser removido: a pessoa já agiu sob esta marca e está na trilha de auditoria, que prova quem fez o quê e precisa continuar existindo. " +
              "A remoção definitiva precisa ser feita por quem administra o banco.",
            code: "USUARIO_COM_TRILHA",
          });
        }
        throw erro;
      }

      await trilha({
        ...atorDaSessao(req, marca.id),
        acao: "remover_usuario_revenda",
        detalhe: { usuarioId: alvo.id, email: alvo.email, nome: alvo.name },
      });

      return res.json({ ok: true });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * A trilha da marca. Leitura pura — `listarEventosDaMarca` PROPAGA erro de
   * banco de proposito: uma tela de auditoria que devolve lista vazia quando a
   * consulta falha diz "ninguem mexeu em nada", que e a mentira mais cara que
   * esta tabela poderia contar.
   */
  router.get("/api/admin/marcas/:id/eventos", requireSuperAdmin, async (req, res) => {
    try {
      const id = idDaRota(req.params.id);
      if (id === null) return res.status(404).json({ message: "Marca nao encontrada." });
      if (!(await storage.getMarca(id))) return res.status(404).json({ message: "Marca nao encontrada." });
      // O servico apara o limite (1..200) e trata o que nao for numero; um
      // `?limite=999999` nao arrasta a tabela inteira.
      return res.json(await listarEventosDaMarca(id, Number(req.query.limite)));
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
