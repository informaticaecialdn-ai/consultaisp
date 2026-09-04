/**
 * O PAINEL DO REVENDEDOR — `/api/revenda/*`.
 *
 * Quem entra aqui e um usuario `role: "revendedor"`, que nao tem provedor
 * nenhum: a ancora de tenant dele e a MARCA (`session.marcaId`), provada no
 * login pelo dominio proprio da marca (`hostPertenceAMarca`).
 *
 * ── A REGRA QUE VALE PARA TODA ROTA DESTE ARQUIVO ─────────────────────────
 *
 * O escopo e `req.session.marcaId`. SEMPRE. Nenhuma rota aqui aceita `marcaId`
 * do corpo, da query ou do caminho — nem para "conferir", porque conferir contra
 * a sessao e so uma forma mais longa de usar a sessao, com uma chance a mais de
 * alguem inverter a comparacao. Onde houver alvo `:id` de outra entidade (a
 * partir da fase 2), ele passa por pertencimento e a recusa e **404 uniforme**,
 * nunca 403: um 403 confirmaria que aquele provedor existe em outra marca.
 *
 * Toda recusa de escopo vai para o `logger` com `userId`. Recusa aqui nao e
 * engano de tela — a tela do revendedor nao sabe pedir o que ele nao pode ver —,
 * entao ela e sinal, e sinal se guarda.
 *
 * ── O QUE ESTA FASE ENTREGA ───────────────────────────────────────────────
 *
 * FASE 1: visao geral (so agregados), a propria marca (ler e editar), a propria
 * equipe e a trilha de auditoria. As rotas RESERVADAS no fim do arquivo
 * respondem 403 de proposito: elas existem para que o namespace tenha um dono
 * declarado e ninguem invente `/api/reseller/...` ou `/api/revenda/credito` mais
 * tarde, cada um com a sua propria ideia de escopo.
 *
 * NAO ESTA AQUI, e nao por esquecimento: lista e detalhe de provedores da marca
 * (fase 2), precos da marca (fase 3), comissao (fase 4), landing (fase 5). E
 * NUNCA estara aqui, em fase nenhuma: `customers`, consultas e resultados,
 * CPF/CNPJ de titular, alertas de anti-fraude, equipamentos, documentos de KYC
 * e threads de suporte. O revendedor e operador COMERCIAL; ele nao tem base
 * legal para ver dado de titular de ninguem.
 */
import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAuth, requireRevendedor } from "../auth";
import { hashPassword } from "../password";
import { logger } from "../logger";
import { getSafeErrorMessage } from "../utils/safe-error";
import { esquecerMarcas } from "../services/marca.service";
import { esquemaMarcaDoRevendedor, esquemaMarcaDoSuperadmin, primeiroErro } from "./marca.routes";
import { sendUsuarioDeEquipeEmail } from "../services/email";
import { corValida, paletaClara, paletaEscura } from "../utils/marca-cores";
/**
 * Os mesmos validadores que o superadmin usa, e nao gemeos.
 *
 * As duas rotas gravam a MESMA coluna, servida pelo mesmo `/api/marca/:id/logo`:
 * enquanto cada uma tinha a sua copia, um ajuste de limite num lado deixava o
 * outro aceitando o que o primeiro recusava.
 */
import { pngAceitavel, svgAceitavel } from "../utils/marca-arquivos";
import {
  listarEventosDaMarca,
  registrarEventoDaMarca,
} from "../services/marca-eventos.service";
import {
  atualizarMarcaDoRevendedor,
  criarMembroDaEquipe,
  equipeDaMarca,
  marcaDoRevendedor,
  membroDaEquipe,
  removerMembroDaEquipe,
  resumoDaMarca,
  type CamposEditaveisPeloRevendedor,
  type MarcaDoRevendedor,
} from "../storage/revenda.storage";

/**
 * O escopo da requisicao, ja provado por `requireRevendedor`.
 *
 * Existe para que nenhuma rota escreva `req.session.marcaId!` com a exclamacao:
 * o `!` do TypeScript e uma AFIRMACAO, e o dia em que alguem montar uma rota
 * daqui sem `requireRevendedor` ela vira mentira silenciosa — `undefined`
 * filtrando query. Aqui a ausencia e checada de novo e vira erro alto.
 */
function escopoDa(req: Request): { marcaId: number; userId: number } {
  const { marcaId, userId } = req.session;
  if (!marcaId || marcaId <= 0 || !userId) {
    // Inalcancavel com `requireRevendedor` montado; se acontecer, o defeito e a
    // rota ter sido montada sem ele, e lancar e o unico jeito de isso aparecer.
    throw new Error("[revenda] rota montada sem requireRevendedor");
  }
  return { marcaId, userId };
}

/** Uma recusa de escopo, registrada e respondida em um lugar so. */
function recusar(
  req: Request,
  res: Response,
  status: number,
  message: string,
  motivo: string,
  extra: Record<string, unknown> = {},
) {
  logger.warn(
    {
      userId: req.session.userId,
      marcaId: req.session.marcaId,
      caminho: req.originalUrl,
      motivo,
      ...extra,
    },
    "[revenda] pedido recusado por escopo",
  );
  return res.status(status).json({ message });
}

// ── O que o revendedor pode editar na propria marca ─────────────────────────

/**
 * O QUE ESTE PAINEL RECUSA — derivado, nao digitado.
 *
 * `marca.routes.ts` parte o esquema da marca em duas metades exatamente para
 * isto: `esquemaMarcaDoRevendedor` e o que ele edita,
 * `esquemaMarcaDoSuperadmin` e o que so a plataforma escreve — slug, dominio,
 * `ativo`, os `responsavel*`, `revendaAtiva`, `statusComercial`,
 * `comissaoPercentual` e os quatro `repasse*`.
 *
 * O conjunto de recusados sai de `Object.keys` daquele esquema, e a
 * consequencia e a que importa: um campo comercial NOVO — um segundo dado de
 * repasse, um `asaasWalletId` — nasce recusado aqui no mesmo commit em que
 * nasce la, sem ninguem lembrar deste arquivo. Uma lista digitada a mao
 * divergiria, e o campo que ficasse de fora da copia seria justamente dinheiro.
 *
 * O mapa abaixo carrega so a FRASE de cada campo. Campo sem frase cai no texto
 * generico — pior de ler, nunca menos seguro.
 */
const CAMPOS_SO_DO_SUPERADMIN: ReadonlySet<string> = new Set(Object.keys(esquemaMarcaDoSuperadmin.shape));

const MOTIVO_DA_RECUSA: Record<string, string> = {
  slug: "O identificador da marca nao muda por aqui: ele aparece em links ja distribuidos. Fale com a plataforma.",
  dominio: "O dominio proprio e cadastrado pela plataforma, porque o certificado HTTPS e emitido no servidor.",
  ativo: "Ligar ou desligar a marca e da plataforma.",
  emailRemetente: "O remetente proprio so vale depois que o dominio for verificado no provedor de e-mail. Fale com a plataforma.",
  responsavelRazaoSocial: "Os dados do responsavel perante o titular (LGPD) sao alterados pela plataforma.",
  responsavelCnpj: "Os dados do responsavel perante o titular (LGPD) sao alterados pela plataforma.",
  revendaAtiva: "A condicao comercial da marca e definida pela plataforma.",
  statusComercial: "A condicao comercial da marca e definida pela plataforma.",
  comissaoPercentual: "O percentual de comissao e negociado com a plataforma e so ela altera.",
  repasseRazaoSocial: "Os dados de repasse sao tratados fora deste painel.",
  repasseCnpj: "Os dados de repasse sao tratados fora deste painel.",
  repasseChavePix: "Os dados de repasse sao tratados fora deste painel.",
  repasseEmail: "Os dados de repasse sao tratados fora deste painel.",
};

const MOTIVO_GENERICO = "Este campo e alterado pela plataforma, nao por este painel.";

/**
 * `dominioStatus` nao esta em nenhuma das duas metades — nem o superadmin o
 * escreve por PATCH: quem o move e `POST /api/admin/marcas/:id/dominio-ativo`,
 * depois de o certificado existir de verdade. Fica aqui para que a recusa
 * explique isso em vez de sair como "campo desconhecido", que mandaria o
 * revendedor procurar o nome certo do campo.
 */
const CAMPOS_EXTRA_RECUSADOS: Record<string, string> = {
  dominioStatus: "Quem confirma que o dominio esta no ar e a plataforma, depois de emitir o certificado.",
};

/**
 * Tentar gravar QUALQUER um destes e tentativa de mudar a propria condicao
 * comercial. Recusado igual aos outros, mas registrado com outro motivo: os
 * demais campos sao engano de formulario; estes sete, nao.
 */
const CAMPOS_COMERCIAIS = new Set([
  "revendaAtiva",
  "statusComercial",
  "comissaoPercentual",
  "repasseRazaoSocial",
  "repasseCnpj",
  "repasseChavePix",
  "repasseEmail",
]);

/**
 * O motivo da recusa deste campo, ou `null` se ele nao e um campo recusado.
 * Exportada para o teste que percorre as colunas de `marcas` e exige que cada
 * uma esteja de um lado ou do outro.
 */
export function motivoDeRecusa(campo: string): string | null {
  if (CAMPOS_EXTRA_RECUSADOS[campo]) return CAMPOS_EXTRA_RECUSADOS[campo];
  if (!CAMPOS_SO_DO_SUPERADMIN.has(campo)) return null;
  return MOTIVO_DA_RECUSA[campo] ?? MOTIVO_GENERICO;
}

/**
 * O QUE ELE PODE EDITAR — importado, nao reescrito.
 *
 * `esquemaMarcaDoRevendedor` vem de `marca.routes.ts` de proposito: e a MESMA
 * lista que o superadmin usa para a metade nao-comercial da marca. Uma segunda
 * copia aqui divergiria no primeiro campo novo, e o campo que ficasse do lado
 * errado da copia seria comissao ou repasse — que e exatamente como esse tipo
 * de vazamento acontece.
 *
 * `.partial()` por cima porque este e um PATCH: la o esquema serve tambem ao
 * POST de criacao, onde `nomeProduto` e obrigatorio. O `.strict()` sobrevive ao
 * `.partial()` (o zod carrega `unknownKeys` para o objeto derivado), e ha teste
 * cobrindo isso — se um dia deixar de sobreviver, o `.strict()` sumiria em
 * silencio e chave desconhecida voltaria a ser descartada com 200.
 *
 * O par "ausente mantem, `null` apaga" vem dos `.nullish()` de la; e o "PATCH
 * parcial de verdade" que o desenho pede. Sem essa distincao, "apagar a
 * assinatura" e "nao mexer na assinatura" seriam o mesmo pedido.
 */
const esquemaDoPatch = esquemaMarcaDoRevendedor.partial();

/** Os campos que o esquema acima aceita. Usado pelo teste de cobertura da tabela. */
export const CAMPOS_EDITAVEIS_PELO_REVENDEDOR = Object.keys(esquemaMarcaDoRevendedor.shape);

/**
 * Valida o que o zod nao alcanca — o CONTEUDO dos arquivos — e GRAVA A MESMA
 * FORMA QUE VALIDOU.
 *
 * O aparo nao e cosmetica, e a licao ja aprendida em `marca.routes.ts`: os dois
 * validadores conferem `dataUri.trim()`, mas quem SERVE o PNG faz
 * `logoPng.replace(/^data:image\/png;base64,/, "")`. Um data URI com um espaco
 * ou uma quebra de linha na frente — o que sai de qualquer copiar-e-colar —
 * passa na checagem, entra inteiro no banco, e na hora de servir o prefixo nao
 * casa: o `Buffer.from(...)` recebe a string com o cabecalho junto e devolve
 * bytes que nao sao PNG. O logo simplesmente nao aparece, sem erro em lugar
 * nenhum.
 *
 * `null` passa direto — apagar o logo e uma edicao legitima e nao ha bytes a
 * conferir.
 */
function conferirEAparar(dados: CamposEditaveisPeloRevendedor): string | null {
  for (const campo of ["logoSvg", "faviconSvg"] as const) {
    const valor = dados[campo];
    if (!valor) continue;
    const r = svgAceitavel(valor);
    if (!r.ok) return campo === "logoSvg" ? r.motivo : `Favicon: ${r.motivo}`;
    dados[campo] = valor.trim();
  }
  for (const campo of ["logoPng", "ogImagePng"] as const) {
    const valor = dados[campo];
    if (!valor) continue;
    const r = pngAceitavel(valor);
    if (!r.ok) return campo === "logoPng" ? r.motivo : `Imagem de compartilhamento: ${r.motivo}`;
    dados[campo] = valor.trim();
  }
  return null;
}

/**
 * O diff que vai para a trilha.
 *
 * Campo de ARQUIVO entra como rotulo ("alterado"/"removido"), nunca como
 * conteudo: sao ate 512 KB de base64 por campo, e a trilha e append-only —
 * gravar os bytes ali significaria carregar meio megabyte de imagem toda vez
 * que alguem abrisse a auditoria, para sempre. O que a auditoria precisa provar
 * e QUE o logo mudou e QUEM mudou, nao qual era o desenho.
 */
const CAMPOS_DE_ARQUIVO = new Set(["logoSvg", "logoPng", "faviconSvg", "ogImagePng"]);

function diffParaTrilha(dados: CamposEditaveisPeloRevendedor): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(dados)) {
    saida[chave] = CAMPOS_DE_ARQUIVO.has(chave) ? (valor === null ? "removido" : "alterado") : valor;
  }
  return saida;
}

/**
 * O destino do registro A que o revendedor precisa criar no DNS dele.
 *
 * Vem do ambiente (`SERVER_PUBLIC_IP`) e sai NULO quando o ambiente nao o
 * publica — nunca um IP de outro ambiente nem um valor de exemplo. Um registro
 * A apontando para o servidor errado nao produz erro visivel: produz a pagina
 * de outra pessoa no dominio do revendedor, e a tela sabe dizer "peca ao
 * suporte" quando o campo e nulo.
 *
 * A FRASE que acompanha o numero fica na tela, e nao aqui: ela e texto de
 * interface em portugues, muda com o passo do onboarding e nao tem por que
 * viajar pela rede.
 */
function ipDoServidor(): string | null {
  return (process.env.SERVER_PUBLIC_IP || "").trim() || null;
}

/**
 * A paleta que a cor gravada vai de fato produzir nos dois temas.
 *
 * Derivada no SERVIDOR, pelo mesmo `marca-cores.ts` que a aplicacao usa para
 * valer — e nao recalculada na tela. Uma segunda implementacao da derivacao no
 * client mostraria uma previa que nao e o que vai ao ar no dia em que as duas
 * divergirem, e o ajuste de contraste (que ESCURECE ou CLAREIA a cor escolhida
 * quando ela nao passa AA) e justamente a parte que surpreende quem escolheu.
 *
 * `null` quando a cor gravada e invalida: e o que a tela mostra como "sem
 * previa", em vez de inventar uma paleta a partir de lixo.
 */
function previaDasCores(corBrand: string, corBrandDark: string | null) {
  if (!corValida(corBrand)) return null;
  return { claro: paletaClara(corBrand), escuro: paletaEscura(corBrand, corBrandDark) };
}

/** A marca projetada mais o que a tela deriva a partir dela. */
function marcaParaATela(marca: MarcaDoRevendedor) {
  return {
    ...marca,
    dnsIp: ipDoServidor(),
    previa: previaDasCores(marca.corBrand, marca.corBrandDark),
  };
}

// ── Equipe ─────────────────────────────────────────────────────────────────

/**
 * O convite carrega NOME e E-MAIL. Senha nao entra: ver `senhaTemporaria`.
 * Os limites sao os que o cadastro de usuario do admin ja usa (200/254).
 */
const esquemaNovoMembro = z
  .object({
    name: z.string().trim().min(1, "Informe o nome.").max(200),
    email: z.string().trim().toLowerCase().email("E-mail invalido.").max(254),
  })
  .strict();

/**
 * Alfabeto SEM os simbolos que se confundem lidos em voz alta ou numa fonte
 * qualquer: sem I, L e O, sem 0 e 1. A senha vai ser ditada de uma pessoa para
 * outra pelo menos uma vez, e "l ou 1?" custa um chamado ao suporte.
 *
 * Sobram 31 simbolos — 23 letras e 8 digitos. E o numero importa: 31 NAO divide
 * 256, entao `byte % 31` seria enviesado (os 8 primeiros simbolos sairiam ~12%
 * mais que os outros). Dai a amostragem por rejeicao abaixo.
 */
const ALFABETO_DA_SENHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const TAMANHO_DA_SENHA = 16;

/**
 * Senha temporaria uniforme sobre o alfabeto acima.
 *
 * `byte % n` seria uma linha a menos e estaria errado: com 31 simbolos, os
 * bytes 248..255 sobram e reciclam o comeco do alfabeto. O corte descarta esses
 * bytes e sorteia de novo — cada simbolo passa a ter exatamente a mesma chance.
 * Sao 16 simbolos, ~79 bits, para uma senha que vale ate o primeiro acesso
 * (`mustChangePassword`).
 *
 * O laco termina: a chance de um byte ser descartado e 8/256, entao a de
 * precisar de outra rodada cai por um fator de 32 a cada tentativa.
 */
function senhaTemporaria(): string {
  const n = ALFABETO_DA_SENHA.length;
  const teto = Math.floor(256 / n) * n; // 248: o maior multiplo de n que cabe em um byte
  let senha = "";
  while (senha.length < TAMANHO_DA_SENHA) {
    // Laco por indice, e nao `for..of`: o `target` deste tsconfig e anterior a
    // ES2015, onde iterar um Buffer exige `downlevelIteration`. Mudar a opcao
    // do projeto para escrever esta linha mais bonita seria trocar a compilacao
    // inteira por acucar sintatico.
    const bytes = randomBytes(TAMANHO_DA_SENHA);
    for (let i = 0; i < bytes.length && senha.length < TAMANHO_DA_SENHA; i++) {
      if (bytes[i] >= teto) continue;
      senha += ALFABETO_DA_SENHA[bytes[i] % n];
    }
  }
  return senha;
}

/**
 * Responde JSON SEM deixar o corpo cair na linha de log.
 *
 * NAO EXISTE MAIS, e o registro fica porque o motivo dela pode voltar.
 *
 * O middleware de log de `server/index.ts` captura a resposta trocando
 * `res.json` por uma versao que guarda o objeto e depois o imprime por
 * `sanitizeForLog`, que censura por nome EXATO de chave. `senhaTemporaria` nao
 * estava em `CHAVES_SENSIVEIS`, e `senha`/`password`, que estavam, nao casam
 * com ela: a senha de todo membro de equipe criado ia parar no log em texto
 * puro. O contorno era responder por `res.send`, que aquele middleware nao
 * intercepta.
 *
 * A correcao definitiva entrou em `server/utils/sanitize-log.ts`:
 * `/api/revenda/usuarios` esta em `ROTAS_SEM_CORPO_NO_LOG` (por prefixo, o que
 * cobre tambem o GET da equipe, que e nome e e-mail de cada pessoa) e
 * `senhaTemporaria` esta em `CHAVES_SENSIVEIS`. Com as duas redes no lugar,
 * `res.json` voltou — e o teste que pinava o contorno virou o teste que pina a
 * redacao.
 */

export function registerRevendaRoutes(): Router {
  const router = Router();

  /**
   * Os dois middlewares, nesta ordem, em TODA rota do arquivo.
   *
   * `requireAuth` ja recusa o revendedor fora dos prefixos liberados e ja
   * confere o host; `requireRevendedor` confere papel, marca e host de novo.
   * A repeticao e deliberada e esta explicada em server/auth.ts: sao duas
   * barreiras dizendo a mesma coisa, e a de fora e a que continua valendo se a
   * de dentro for esquecida numa rota nova.
   *
   * Aplicados por `router.use` com prefixo, e nao rota a rota: rota nova neste
   * arquivo nasce protegida sem que ninguem precise lembrar. E o mesmo motivo
   * pelo qual `PREFIXOS_LIBERADOS_AO_REVENDEDOR` e lista branca.
   */
  router.use("/api/revenda", requireAuth, requireRevendedor);

  // ── Visao geral ──────────────────────────────────────────────────────────

  /**
   * Os agregados da marca. So numeros, nenhuma linha de provedor.
   *
   * ── POR QUE COMISSAO E CONSUMO NAO APARECEM AQUI ─────────────────────────
   *
   * O desenho preve, para a visao geral completa: creditos vendidos no mes,
   * consumo do mes e comissao pendente/fechada/paga. Nada disso e apurado ainda
   * — a foto da marca no pedido e a fase 3, e o lancamento de comissao e a
   * fase 4.
   *
   * A alternativa era devolver `comissaoPendente: 0`. Escolhi OMITIR, e a
   * diferenca importa: um zero e um NUMERO, e o revendedor nao tem como
   * distinguir "a plataforma ainda nao apura isso" de "voce nao vendeu nada
   * este mes". Ele leria a segunda coisa — e e a leitura mais cara possivel,
   * porque ela e sobre o dinheiro dele. Chave ausente a tela sabe tratar; zero
   * mentiroso, nao. E a mesma regra de integridade do dado que vale no resto do
   * produto: so dado real e verificavel.
   *
   * As fases 3 e 4 acrescentam as chaves aqui.
   */
  router.get("/api/revenda/visao-geral", async (req, res) => {
    try {
      const { marcaId } = escopoDa(req);
      const provedores = await resumoDaMarca(marcaId);
      return res.json({ provedores });
    } catch (error: any) {
      logger.error({ err: error, userId: req.session.userId }, "[revenda] falha na visao geral");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ── A propria marca ──────────────────────────────────────────────────────

  router.get("/api/revenda/marca", async (req, res) => {
    try {
      const { marcaId } = escopoDa(req);
      const marca = await marcaDoRevendedor(marcaId);
      if (!marca) {
        // A sessao aponta para uma marca que nao existe mais. Nao e "nao
        // encontrado" comum: e sessao viva de marca apagada, e vale registro.
        return recusar(req, res, 404, "Marca nao encontrada.", "marca_da_sessao_inexistente");
      }
      return res.json(marcaParaATela(marca));
    } catch (error: any) {
      logger.error({ err: error, userId: req.session.userId }, "[revenda] falha ao ler a marca");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/revenda/marca", async (req, res) => {
    try {
      const { marcaId, userId } = escopoDa(req);
      const corpo = (req.body ?? {}) as Record<string, unknown>;

      // Campo proibido ANTES do zod: o `.strict()` diria apenas "chave
      // desconhecida", e a diferenca entre "esse campo nao existe" e "esse
      // campo existe e nao e seu" e a resposta que a pessoa precisa.
      for (const chave of Object.keys(corpo)) {
        const motivo = motivoDeRecusa(chave);
        if (!motivo) continue;
        return recusar(
          req, res, 400, motivo,
          CAMPOS_COMERCIAIS.has(chave) ? "tentou_alterar_condicao_comercial" : "campo_nao_editavel",
          { campo: chave },
        );
      }

      const parsed = esquemaDoPatch.safeParse(corpo);
      if (!parsed.success) {
        return res.status(400).json({ message: primeiroErro(parsed.error) });
      }
      // Anotacao de tipo, e nao `as`: e ela que faz o `tsc` conferir que o que
      // o zod aceita cabe no que o storage grava. Um `as` aqui calaria
      // exatamente a divergencia entre as duas listas que este arquivo tenta
      // impedir.
      const dados: CamposEditaveisPeloRevendedor = parsed.data;

      // Um UPDATE sem coluna nenhuma faz o Drizzle lancar "No values to set" —
      // 500 com texto generico, como se o servidor tivesse quebrado. Mesmo
      // tratamento que `PATCH /api/admin/marcas/:id` ja da.
      if (Object.keys(dados).length === 0) {
        return res.status(400).json({ message: "Nada a alterar: nenhum campo editavel no corpo." });
      }

      const problema = conferirEAparar(dados);
      if (problema) return res.status(400).json({ message: problema });

      const atualizada = await atualizarMarcaDoRevendedor(marcaId, dados);
      if (!atualizada) {
        return recusar(req, res, 404, "Marca nao encontrada.", "marca_da_sessao_inexistente");
      }

      // A resolucao host -> marca e cacheada por 5 minutos e e prova de login.
      // Sem esta linha, o revendedor salvaria o nome novo e continuaria vendo o
      // antigo por ate cinco minutos, no proprio dominio dele.
      esquecerMarcas();

      await registrarEventoDaMarca({
        marcaId,
        userId,
        atorRole: "revendedor",
        acao: "editar_marca",
        detalhe: diffParaTrilha(dados),
      });

      return res.json(marcaParaATela(atualizada));
    } catch (error: any) {
      logger.error({ err: error, userId: req.session.userId }, "[revenda] falha ao editar a marca");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ── Equipe da marca ──────────────────────────────────────────────────────

  router.get("/api/revenda/usuarios", async (req, res) => {
    try {
      const { marcaId } = escopoDa(req);
      return res.json(await equipeDaMarca(marcaId));
    } catch (error: any) {
      logger.error({ err: error, userId: req.session.userId }, "[revenda] falha ao listar a equipe");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * Cria um membro da equipe da marca.
   *
   * A SENHA E GERADA AQUI, e nao recebida. Pedi-la a quem convida produz a
   * senha que a pessoa consegue lembrar para ditar por telefone; gerada, ela
   * tem 80 bits e vale ate o primeiro acesso (`mustChangePassword`). Sai UMA
   * vez, no corpo desta resposta, para quem convidou copiar e entregar.
   *
   * O e-mail SAI, e nao leva a senha. `montarUsuarioDeEquipe` existe desde a
   * fase 1 e diz o que so ele pode dizer a quem recebe: o endereco em que
   * aquele login e aceito, e o NOME de quem convidou — que e o unico jeito de
   * desconfiar de um convite que ninguem esperava. A senha continua no corpo
   * desta resposta pelo motivo explicado em `blocoDaCredencial`.
   */
  router.post("/api/revenda/usuarios", async (req, res) => {
    try {
      const { marcaId, userId } = escopoDa(req);
      const parsed = esquemaNovoMembro.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: primeiroErro(parsed.error) });
      }
      const { name, email } = parsed.data;

      const marca = await marcaDoRevendedor(marcaId);
      if (!marca) {
        return recusar(req, res, 404, "Marca nao encontrada.", "marca_da_sessao_inexistente");
      }

      const senha = senhaTemporaria();
      let criado;
      try {
        criado = await criarMembroDaEquipe(marcaId, { name, email, passwordHash: await hashPassword(senha) });
      } catch (erro: any) {
        // 23505 = unique_violation. O e-mail e unico em TODA a tabela `users`,
        // entao o conflito tanto pode ser com a equipe desta marca quanto com
        // um usuario de outro tenant — e a resposta e a MESMA nos dois casos,
        // de proposito: distinguir transformaria este endpoint num oraculo de
        // "esse e-mail ja tem conta na plataforma".
        if ((erro?.code ?? erro?.cause?.code) === "23505") {
          return res.status(409).json({ message: "Este e-mail ja esta em uso." });
        }
        throw erro;
      }

      await registrarEventoDaMarca({
        marcaId,
        userId,
        atorRole: "revendedor",
        acao: "criar_usuario_revenda",
        detalhe: { usuarioId: criado.id, email: criado.email, nome: criado.name },
      });

      /**
       * O convite por e-mail: o endereco de entrada e QUEM convidou.
       *
       * Nao leva a senha — ela ja saiu para quem convidou, no corpo desta
       * resposta, e a razao esta em `blocoDaCredencial`. O que este e-mail
       * entrega e o que a resposta HTTP nao tem como entregar a quem recebe:
       * em qual host o login dele e aceito (a raiz da plataforma e o
       * subdominio de qualquer provedor recusam, com mensagem generica).
       *
       * Best-effort: o membro ja existe quando o envio sai, e a regra deste
       * repositorio e que falha de Resend nao derruba o ato que terminou.
       * `quemConvidou` cai para "Um administrador da marca" se a propria linha
       * de quem esta logado sumir entre o login e agora — o texto cita o nome
       * duas vezes e uma frase com "undefined" seria pior que uma generica.
       */
      let emailEnviado = true;
      try {
        const quemConvidou = await membroDaEquipe(marcaId, userId);
        await sendUsuarioDeEquipeEmail(criado.email, {
          nome: criado.name,
          quemAdicionou: quemConvidou?.name || "Um administrador da marca",
          emailDeAcesso: criado.email,
        }, marcaId);
      } catch (erroDeEnvio: any) {
        emailEnviado = false;
        logger.error(
          { err: erroDeEnvio, marcaId, usuarioId: criado.id },
          "[revenda] membro criado, mas o e-mail de convite nao saiu",
        );
      }

      return res.status(201).json({
        usuario: criado,
        senhaTemporaria: senha,
        emailEnviado,
        urlDeAcesso: marca.dominio && marca.dominioStatus === "ativo" ? `https://${marca.dominio}/login` : null,
      });
    } catch (error: any) {
      logger.error({ err: error, userId: req.session.userId }, "[revenda] falha ao criar membro da equipe");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * Remove um membro da equipe.
   *
   * As duas travas — nao remover a si mesmo, nao remover o ultimo — respondem
   * 409, e nao 400: o pedido esta bem formado; o que impede e o ESTADO. E a
   * exclusao e definitiva, sem cadastro publico de revendedor para refazer o
   * acesso: so o superadmin cria o primeiro.
   *
   * "Nao remover a si mesmo" e checado aqui porque e sobre a SESSAO; "nao
   * remover o ultimo" e checado no storage porque tem de acontecer sob o mesmo
   * lock do DELETE (ver `removerMembroDaEquipe`).
   */
  router.delete("/api/revenda/usuarios/:userId", async (req, res) => {
    try {
      const { marcaId, userId } = escopoDa(req);
      const alvo = Number(String(req.params.userId));
      if (!Number.isInteger(alvo) || alvo <= 0) {
        return res.status(400).json({ message: "Usuario invalido." });
      }
      if (alvo === userId) {
        return res.status(409).json({ message: "Voce nao pode remover a propria conta." });
      }

      // Lido ANTES para que a trilha guarde de quem era o acesso removido: com
      // a linha ja apagada, `usuarioId: 12` nao diz a ninguem quem era 12.
      const antes = await membroDaEquipe(marcaId, alvo);

      let resultado;
      try {
        resultado = await removerMembroDaEquipe(marcaId, alvo);
      } catch (erro: any) {
        // 23503 = foreign_key_violation. Um revendedor nao consulta nem abre
        // thread de suporte, entao hoje ele nao tem dependente — mas as chaves
        // que impedem apagar um operador (`isp_consultations.user_id` e
        // companhia) sao NOT NULL e sem ON DELETE, e o dia em que uma acao de
        // revenda passar a gravar `user_id` isto viraria 500 sem causa.
        if ((erro?.code ?? erro?.cause?.code) === "23503") {
          return res.status(409).json({
            message: "Este usuario ja tem historico no sistema e por isso nao pode ser apagado.",
            code: "USUARIO_COM_HISTORICO",
          });
        }
        throw erro;
      }

      if (resultado === "nao_encontrado") {
        // 404 UNIFORME. O alvo pode nao existir, ou existir e ser de outra
        // marca, ou ser um provedor: a resposta e a mesma nos tres casos, senao
        // este endpoint viraria uma sonda de "que ids existem no sistema".
        return recusar(req, res, 404, "Usuario nao encontrado.", "alvo_fora_da_marca", { alvo });
      }
      if (resultado === "ultimo") {
        return res.status(409).json({
          message: "Este e o ultimo acesso da marca. Crie outro antes de remover este.",
        });
      }

      await registrarEventoDaMarca({
        marcaId,
        userId,
        atorRole: "revendedor",
        acao: "remover_usuario_revenda",
        detalhe: { usuarioId: alvo, email: antes?.email ?? null, nome: antes?.name ?? null },
      });

      return res.json({ message: "Acesso removido." });
    } catch (error: any) {
      logger.error({ err: error, userId: req.session.userId }, "[revenda] falha ao remover membro da equipe");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ── Trilha de auditoria ──────────────────────────────────────────────────

  /**
   * Os eventos da PROPRIA marca. O superadmin tambem grava aqui, e o revendedor
   * ve esses registros: e o ponto da trilha — "quem suspendeu meu provedor as 3
   * da manha" tem de ter resposta inclusive quando a resposta e "a plataforma".
   */
  router.get("/api/revenda/eventos", async (req, res) => {
    try {
      const { marcaId } = escopoDa(req);
      // O teto de 200 e o padrao de 50 sao do proprio servico; aqui so se
      // converte o texto da query. `Number("abc")` e NaN e cai no padrao la.
      const limite = Number(req.query.limite);
      return res.json(await listarEventosDaMarca(marcaId, Number.isFinite(limite) ? limite : undefined));
    } catch (error: any) {
      logger.error({ err: error, userId: req.session.userId }, "[revenda] falha ao listar eventos");
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ── Reservadas ───────────────────────────────────────────────────────────

  /**
   * Caminhos que EXISTEM e recusam, em vez de dar 404.
   *
   * Um 404 aqui seria a resposta honesta — a funcionalidade nao existe —, e e
   * exatamente por isso que ele nao serve: 404 diz "nao ha nada neste
   * endereco", e o proximo a implementar creditos por revenda escolheria outro
   * endereco, com outra ideia de escopo e outro middleware. Estes quatro
   * caminhos sao a reserva do desenho: o de creditos e o de plano pertencem ao
   * modelo de ATACADO, que o dono nao escolheu (decisao 2 — a plataforma
   * continua a unica que cobra o provedor); o chat, ao suporte, que a
   * plataforma continua atendendo em nome da marca (decisao 13).
   *
   * Elas ficam DEPOIS das rotas reais e dentro do mesmo `router.use`: quem nao
   * for revendedor leva 403 dos middlewares antes de chegar aqui, e a frase que
   * ele ve nao revela nada sobre o que a plataforma pretende construir.
   */
  const RESERVADA = { message: "Indisponivel nesta versao", code: "RESERVADO" } as const;

  router.post("/api/revenda/provedores/:id/creditos", (_req, res) => res.status(403).json(RESERVADA));
  router.post("/api/revenda/provedores/:id/plano", (_req, res) => res.status(403).json(RESERVADA));
  // Wildcard nomeado: e a sintaxe do path-to-regexp 8, que o Express 5 usa. O
  // grupo opcional faz `/api/revenda/chat` casar junto com tudo abaixo dele.
  router.get("/api/revenda/chat{/*resto}", (_req, res) => res.status(403).json(RESERVADA));
  router.post("/api/revenda/chat{/*resto}", (_req, res) => res.status(403).json(RESERVADA));

  return router;
}
