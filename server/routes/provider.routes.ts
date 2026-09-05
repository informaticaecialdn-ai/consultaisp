import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth, requireProvider } from "../auth";
import { storage } from "../storage";
import { hashPassword } from "../password";
import { getSafeErrorMessage } from "../utils/safe-error";
import { sanitizeFilename } from "../utils/filename-sanitizer";
import { logger } from "../logger";
import { anonymizeProvider } from "../utils/provider-anonymizer";
import { sendUsuarioAdicionadoEmail } from "../services/email";
import { contextoDeEmail } from "../services/email-destinatario";
import { consultarCnpjPublico, normalizarCnpj } from "../services/cnpj-publico.service";
import {
  aceita, dataDeAbertura, recusa, SEGMENTOS, site, TIPOS_SOCIETARIOS, umaDasOpcoes,
  type Veredito,
} from "@shared/cadastro-regras";
import crypto from "crypto";
import { z } from "zod";

/**
 * Avisa a PESSOA que acabou de ganhar acesso ao provedor.
 *
 * O destinatario e um endereco especifico — o do usuario criado — e por isso
 * `avisarProvedor` (que resolve o contato do provedor) nao serve. O que se
 * aproveita dele e a resolucao de marca e de endereco de entrada, via
 * `contextoDeEmail`: quem entra por uma marca revendedora precisa do link
 * daquela marca, senao cai numa tela onde o login dele e recusado.
 *
 * A SENHA NAO VAI NO E-MAIL — quem cria a entrega por outro canal, ou o novo
 * usuario define a dele por "Esqueci minha senha".
 *
 * Nao lanca: a conta ja esta criada quando este aviso sai. Envio de e-mail nao
 * derruba a operacao que o disparou.
 */
async function avisarUsuarioCriado(
  provedor: { id: number; name: string; contactEmail?: string | null; marcaId?: number | null; subdomain?: string | null },
  usuario: { name: string; email: string },
  quemAdicionou: string,
): Promise<void> {
  try {
    const ctx = await contextoDeEmail(provedor);
    await sendUsuarioAdicionadoEmail(
      usuario.email, usuario.name, provedor.name, quemAdicionou, usuario.email, ctx.marca, ctx.urlBase,
    );
  } catch (err: any) {
    logger.error(
      { providerId: provedor.id, rotulo: "usuario-adicionado", err: err?.message },
      "[email] Falha ao avisar o usuario criado",
    );
  }
}

/**
 * QUEM PODE ADMINISTRAR ESTE PROVEDOR.
 *
 * Dez rotas deste arquivo comparavam `req.session.role !== "admin"` na mao. A
 * comparacao esta certa para o operador — ele nao cria usuario, nao mexe em
 * socio, nao troca a configuracao — e errada para o SUPORTE: a personificacao
 * mantem `role` como "superadmin" de proposito (ver `PersonificacaoDeSuporte` em
 * server/auth.ts), para que a trilha, o log e a faixa vermelha consigam separar
 * um atendente de um admin de verdade. O preco dessa escolha caia exatamente
 * aqui: o suporte entrava na conta e era barrado nas dez telas de configuracao
 * que ele foi criado para arrumar. O escopo decidido pelo dono e "tudo que o
 * admin do provedor faz"; estas dez rotas nao cumpriam.
 *
 * A condicao tem tres partes, e cada uma existe por um motivo:
 *
 *   1. `role === "admin"` — o caso normal, inalterado. O operador (`user`)
 *      continua barrado, que e o ponto de nao enfraquecer a regra.
 *   2. `role === "superadmin"` E COM `session.suporte` — um superadmin fora de
 *      personificacao NAO administra provedor nenhum por aqui. Sem esta metade
 *      bastaria ser da plataforma para escrever na conta de qualquer tenant sem
 *      janela liberada, e a autorizacao do provedor viraria decoracao.
 *   3. `suporte.providerId === providerId` da sessao — a janela autoriza UM
 *      provedor. Sao sempre o mesmo valor hoje (`entrar` grava os dois juntos), e
 *      e por isso que a comparacao e barata: ela transforma um invariante que
 *      existe por convencao em um que o codigo confere.
 *
 * O que ela NAO faz e conferir se a janela continua valida — isso e
 * `travaDeAcessoDeSuporte`, que roda antes de toda rota e pergunta ao BANCO. Uma
 * segunda verificacao aqui daria duas respostas para a mesma pergunta.
 */
export function podeAdministrarOProvedor(session: Request["session"]): boolean {
  if (session.role === "admin") return true;
  if (session.role !== "superadmin") return false;
  const suporte = session.suporte;
  return suporte != null && suporte.providerId === session.providerId;
}

/**
 * A recusa, com o verbo da acao no texto.
 *
 * A frase e por rota porque ela e o que o usuario le: "apenas administradores
 * podem remover socios" diz o que ele tentou fazer, e um texto unico para as dez
 * rotas obrigaria quem le a adivinhar qual das acoes da tela foi recusada.
 */
function exigirAdminDoProvedor(acao: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!podeAdministrarOProvedor(req.session)) {
      return res.status(403).json({ message: `Apenas administradores podem ${acao}` });
    }
    next();
  };
}

/**
 * A REGUA DO CADASTRO DO PROVEDOR — e por que ela so julga o que MUDOU.
 *
 * Ate 05/09/2026 o PATCH do perfil copiava dezesseis campos do corpo direto
 * para o `db.update().set()`, com uma lista de campos permitidos e mais nada.
 * E dele que saiu o lixo que o resto do sistema aprendeu a tolerar, medido em
 * producao: `opening_date` com "17/05/2017" numa coluna que todo o resto le
 * como ISO, `legal_type` com "206-2 - Sociedade Empresaria Limitada" num campo
 * de sete opcoes, e CNPJ mascarado numa coluna UNIQUE que o cadastro compara
 * por igualdade exata de string.
 *
 * A regra que organiza tudo aqui e uma so: **julgar so o campo cujo valor
 * mudou**. Nao e afrouxamento, e a unica forma de a regua nao virar uma tranca.
 * O painel manda os DEZESSEIS campos a cada clique em Salvar (a tela monta o
 * formulario com `provider.campo || ""` e reenvia o objeto inteiro), e o
 * conteudo que ela reenvia foi gravado por esta mesma rota, sem regua nenhuma.
 * Uma validacao que julgasse o cadastro inteiro trancaria o provedor 4 fora do
 * proprio cadastro: ele nao conseguiria corrigir o telefone sem antes arrumar
 * a data de abertura e a natureza juridica — dois campos que ele nao sabe que
 * estao errados, recusados por frases que nao explicam de onde vieram.
 *
 * Dai a divisao de trabalho entre o schema e as regras abaixo:
 *
 *   - O SCHEMA so da forma: recusa chave desconhecida, exige texto, apara o
 *     valor e transforma "" em null. Nada que ele faz pode reprovar um valor
 *     legado — nem tamanho, que tambem reprovaria ("Minas Gerais" num campo de
 *     dois caracteres e exatamente o caso que existe hoje).
 *   - As REGRAS julgam formato, e o handler so as aplica ao campo que difere do
 *     que ja esta gravado. O molde e o `EMAIL_DE_CONTATO_NOVO` da ficha do
 *     superadmin (server/routes/admin.routes.ts): recusar o que o servidor
 *     mesmo entregou nao e validacao, e uma tranca numa porta ja aberta.
 *
 * O que a regua canoniza, ela canoniza so no valor que o provedor esta
 * DIGITANDO AGORA (CEP para 8 digitos, UF para maiuscula). Consertar de passagem
 * o valor antigo seria reescrever em silencio o dado de outra pessoa, e um
 * conserto que so alcanca quem por acaso clicou em Salvar deixa a coluna
 * misturada para sempre — isso e trabalho de migracao, com uma passada so.
 */

/**
 * "" no corpo vira NULL na coluna — e o trim vem junto.
 *
 * Gemeo do helper de mesmo nome em admin.routes.ts, e a copia e deliberada:
 * importar de la arrastaria o modulo do superadmin inteiro (rate limiter,
 * registry de ERP, servico de e-mail) para dentro das rotas do provedor.
 *
 * "" custa caro de duas formas: no resto da aplicacao null ja e a forma de
 * dizer "nao informado" (`provider.website || "—"`), entao "" faz a tela
 * mostrar um campo preenchido com nada; e a comparacao com o valor gravado
 * ficaria dependendo de qual das duas formas do vazio esta de cada lado.
 * "   " tem o mesmo efeito de "" e nenhum significado a mais.
 */
const vazioVirouNulo = (valor: unknown) => {
  if (typeof valor !== "string") return valor;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
};

/** Campo do cadastro: ausente, null ou "" (que vira null). O FORMATO e o
 *  TAMANHO nao sao julgados aqui — ver `REGRAS_DO_PERFIL`. */
const campoDoPerfil = z.preprocess(vazioVirouNulo, z.string().nullable()).optional();

/**
 * `.strict()` para recusar chave que nao e coluna, em vez de descartar em
 * silencio como fazia a lista de campos permitidos. "Salvo com sucesso" para um
 * campo que o servidor jogou fora e a pior das respostas.
 *
 * As dezesseis chaves sao exatamente as que `getEmpresa()` monta em
 * client/src/pages/provedor/painel-provedor.tsx. `subdomain`, plano, creditos e
 * status ficam de fora porque nunca estiveram: eles nao sao do provedor.
 */
const perfilDoProvedorSchema = z.object({
  name: campoDoPerfil,
  tradeName: campoDoPerfil,
  cnpj: campoDoPerfil,
  legalType: campoDoPerfil,
  openingDate: campoDoPerfil,
  businessSegment: campoDoPerfil,
  contactEmail: campoDoPerfil,
  contactPhone: campoDoPerfil,
  website: campoDoPerfil,
  addressZip: campoDoPerfil,
  addressStreet: campoDoPerfil,
  addressNumber: campoDoPerfil,
  addressComplement: campoDoPerfil,
  addressNeighborhood: campoDoPerfil,
  addressCity: campoDoPerfil,
  addressState: campoDoPerfil,
}).strict();

const UFS: readonly string[] = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

/**
 * `Veredito`, `aceita`, `recusa`, `umaDasOpcoes`, `dataDeAbertura`, `site` e as
 * duas listas de opcoes vem de `@shared/cadastro-regras`: sao exatamente as
 * regras que a ficha do superadmin tambem tem de aplicar, e enquanto elas eram
 * copia daqui a ficha de MAIOR privilegio continuou aceitando os dois valores
 * que esta rota passou a recusar. O que fica neste arquivo e o que so a ficha do
 * provedor cobra.
 */
const texto = (max: number, rotulo: string) => (valor: string | null): Veredito =>
  valor !== null && valor.length > max
    ? recusa(`${rotulo} deve ter no máximo ${max} caracteres.`)
    : aceita(valor);

/**
 * O e-mail e o ENDERECO DE ENTREGA do provedor: `destinatariosDoProvedor` manda
 * para ele quando existe e so cai nos administradores quando ele esta VAZIO. Um
 * valor preenchido e invalido e pior que nenhum, porque sombreia o resgate.
 *
 * Apagar continua valendo (null passa): sem contato, o aviso vai para os
 * administradores, que e o resgate funcionando.
 */
const EMAIL_DE_CONTATO_NOVO = z.string()
  .email("O e-mail de contato precisa ser um endereço só, no formato nome@empresa.com.br.")
  .max(254, "O e-mail de contato deve ter no máximo 254 caracteres.");

const emailDeContato = (valor: string | null): Veredito => {
  if (valor === null) return aceita(null);
  const julgado = EMAIL_DE_CONTATO_NOVO.safeParse(valor);
  return julgado.success ? aceita(valor) : recusa(julgado.error.issues[0].message);
};

/**
 * CEP em 8 digitos. A canonizacao vale a pena porque ha consumidor que usa o
 * valor CRU: `nfse-auto.ts` manda `provider.addressZip` para a prefeitura sem
 * limpar em um dos dois caminhos, e "35500-000" ali e um CEP invalido.
 */
const cep = (valor: string | null): Veredito => {
  if (valor === null) return aceita(null);
  const digitos = valor.replace(/\D/g, "");
  return digitos.length === 8
    ? aceita(digitos)
    : recusa("O CEP precisa ter 8 dígitos (ex.: 35500-000).");
};

/** A coluna tem dois caracteres: "Minas Gerais" nao cabe e nao e sigla. */
const uf = (valor: string | null): Veredito => {
  if (valor === null) return aceita(null);
  const sigla = valor.toUpperCase();
  return UFS.includes(sigla)
    ? aceita(sigla)
    : recusa("A UF precisa ser a sigla de dois caracteres do estado (ex.: MG), e não o nome por extenso.");
};

/**
 * A razao social e o nome do tenant em toda tela, e-mail e nota. Apagar nao e
 * uma escolha valida como apagar o complemento.
 */
const razaoSocial = (valor: string | null): Veredito =>
  valor === null ? recusa("Informe a razão social do provedor.") : texto(200, "A razão social")(valor);

/**
 * Uma regra por campo. `cnpj` NAO esta aqui de proposito — ele nao e alteravel
 * por esta rota; ver a decisao no handler.
 */
const REGRAS_DO_PERFIL: Record<string, (valor: string | null) => Veredito> = {
  name: razaoSocial,
  tradeName: texto(200, "O nome fantasia"),
  legalType: umaDasOpcoes(TIPOS_SOCIETARIOS, "O tipo societário"),
  openingDate: dataDeAbertura,
  businessSegment: umaDasOpcoes(SEGMENTOS, "O segmento de atuação"),
  contactEmail: emailDeContato,
  contactPhone: texto(20, "O telefone de contato"),
  website: site,
  addressZip: cep,
  addressStreet: texto(200, "A rua"),
  addressNumber: texto(20, "O número"),
  addressComplement: texto(100, "O complemento"),
  addressNeighborhood: texto(100, "O bairro"),
  addressCity: texto(100, "A cidade"),
  addressState: uf,
};

/**
 * O valor gravado, na mesma forma em que o enviado chega — sem isso, um espaco
 * em volta do valor no banco faria um campo intocado parecer alteracao e cairia
 * na regua que existe justamente para nao julgar o que ninguem tocou.
 */
const gravadoComo = (valor: unknown): string | null =>
  typeof valor === "string" ? (valor.trim() || null) : null;

export function registerProviderRoutes(): Router {
  const router = Router();

  router.get("/api/tenant/resolve", async (req, res) => {
    const { subdomain } = req.query as { subdomain?: string };
    if (!subdomain) return res.status(400).json({ message: "Subdominio obrigatorio" });
    const provider = await storage.getProviderBySubdomain(subdomain);
    if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
    return res.json({
      id: provider.id,
      name: provider.tradeName || provider.name,
      subdomain: provider.subdomain,
      plan: provider.plan,
      status: provider.status,
    });
  });

  router.get("/api/provider/users", requireAuth, requireProvider, async (req, res) => {
    try {
      const providerUsers = await storage.getUsersByProvider(req.session.providerId!);
      const safe = providerUsers.map(u => ({
        id: u.id, name: u.name, email: u.email, role: u.role,
        emailVerified: u.emailVerified, createdAt: u.createdAt,
      }));
      return res.json(safe);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/provider/users", requireAuth, requireProvider, exigirAdminDoProvedor("convidar usuarios"), async (req, res) => {
    try {
      const { name, email, password, role } = req.body as { name: string; email: string; password: string; role: string };
      if (!name || !email || !password) {
        return res.status(400).json({ message: "Nome, email e senha sao obrigatorios" });
      }
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ message: "Email ja cadastrado" });

      const newUser = await storage.createUser({
        name, email,
        password: await hashPassword(password),
        role: role === "admin" ? "admin" : "user",
        providerId: req.session.providerId!,
        emailVerified: true,
      });

      // Quem foi adicionado nao recebia nada: descobria a conta quando alguem
      // avisava por fora. O aviso sai depois da criacao e nao pode derruba-la.
      const provedor = await storage.getProvider(req.session.providerId!).catch(() => null);
      if (provedor) {
        const autor = await storage.getUser(req.session.userId!).catch(() => null);
        await avisarUsuarioCriado(provedor, newUser, autor?.name || provedor.name);
      }

      return res.status(201).json({ id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/provider/users/:id", requireAuth, requireProvider, exigirAdminDoProvedor("remover usuarios"), async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      // 409, nao 400: o pedido esta bem formado: o que impede e o ESTADO. E a
      // exclusao e definitiva, entao as duas travas abaixo sao a unica coisa
      // entre um clique e um provedor sem ninguem que consiga administra-lo.
      if (userId === req.session.userId) {
        return res.status(409).json({ message: "Voce nao pode excluir a propria conta" });
      }
      const targetUser = await storage.getUser(userId);
      if (!targetUser || targetUser.providerId !== req.session.providerId) {
        return res.status(404).json({ message: "Usuario nao encontrado" });
      }
      if (targetUser.role === "admin") {
        const doProvedor = await storage.getUsersByProvider(req.session.providerId!);
        const admins = doProvedor.filter(u => u.role === "admin");
        if (admins.length <= 1) {
          return res.status(409).json({ message: "Este e o ultimo administrador do provedor. Promova outro antes de excluir." });
        }
      }
      try {
        await storage.deleteUser(userId);
      } catch (erro: any) {
        /**
         * 23503 = foreign_key_violation.
         *
         * `isp_consultations.user_id`, `spc_consultations.user_id`,
         * `bigdata_consultations.user_id` e `support_messages.sender_id` sao
         * NOT NULL e sem ON DELETE. Ou seja: o operador que ja rodou UMA
         * consulta — o uso normal da conta — nao pode ser apagado. Isso e
         * estado, nao falha do servidor, e virava 500 "Erro interno do
         * servidor": o admin clicava, via um erro sem causa e tentava de novo.
         */
        const codigo = erro?.code ?? erro?.cause?.code;
        if (codigo === "23503") {
          return res.status(409).json({
            message: "Este usuario ja tem historico no sistema (consultas ou mensagens de suporte) e por isso nao pode ser apagado — o historico e do provedor e nao pode ir junto.",
            code: "USUARIO_COM_HISTORICO",
          });
        }
        throw erro;
      }
      return res.json({ message: "Usuario removido com sucesso" });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/provider/settings", requireAuth, requireProvider, exigirAdminDoProvedor("alterar configuracoes"), async (req, res) => {
    try {
      const { updateProviderSchema } = await import("@shared/schema");
      const parsed = updateProviderSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Dados invalidos" });
      const updated = await storage.updateProvider(req.session.providerId!, parsed.data);
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/profile", requireAuth, requireProvider, async (req, res) => {
    try {
      const provider = await storage.getProvider(req.session.providerId!);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      const partners = await storage.getProviderPartners(req.session.providerId!);
      const documents = await storage.getProviderDocuments(req.session.providerId!);
      return res.json({ ...provider, partners, documents });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * O cadastro da PROPRIA empresa na Receita, para preencher a ficha.
   *
   * SEM PARAMETRO, de proposito. A rota irma do superadmin recebe o CNPJ no
   * caminho porque ele esta cadastrando um provedor que ainda nao existe; aqui
   * o CNPJ vem de `session.providerId`, e so dele. Aceitar um CNPJ do cliente
   * transformaria a conta de qualquer provedor num consultor gratuito de
   * cadastro de empresa alheia — o dado e publico, mas publicar um consultor
   * autenticado dele nao e o negocio desta rota, e o volume sairia da nossa
   * cota nas tres fontes.
   *
   * Antes disso a consulta era feita NO NAVEGADOR, direto na BrasilAPI: uma
   * fonte so, sem queda para as outras duas, e um segundo parser que divergia
   * do do servidor. Bastava a BrasilAPI recusar para a tela dizer "servico
   * indisponivel" e o provedor concluir que o sistema nao busca nada.
   *
   * `requireProvider` e nao `exigirAdminDoProvedor`: LER o cadastro publico da
   * propria empresa nao muda nada. Quem grava e o PATCH do perfil, e la a
   * exigencia de admin continua.
   */
  router.get("/api/provider/cnpj", requireAuth, requireProvider, async (req, res) => {
    try {
      const provider = await storage.getProvider(req.session.providerId!);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });

      const cnpj = normalizarCnpj(provider.cnpj);
      if (!cnpj) {
        return res.status(400).json({
          message: "Este provedor nao tem um CNPJ valido cadastrado, entao nao ha o que buscar na Receita.",
        });
      }

      const empresa = await consultarCnpjPublico(cnpj);
      if (!empresa) {
        // 502 e nao 404: as tres fontes sao de terceiros e recusam por cota tao
        // frequentemente quanto por CNPJ inexistente. Dizer "nao encontrado"
        // mandaria o provedor conferir um numero que costuma estar certo.
        return res.status(502).json({
          message: "Nao foi possivel consultar a Receita agora. As tres fontes publicas recusaram ou nao responderam — tente de novo em alguns minutos.",
        });
      }

      return res.json(empresa);
    } catch (error: any) {
      logger.error(
        { providerId: req.session.providerId, err: error?.message },
        "[provedor] falha ao consultar o proprio CNPJ",
      );
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/integration", requireAuth, requireProvider, async (req, res) => {
    try {
      const token = await storage.getProviderWebhookToken(req.session.providerId!);
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      return res.json({ token, webhookUrl: `${baseUrl}/api/webhooks/erp-sync` });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/provider/integration/regenerate-token", requireAuth, requireProvider, exigirAdminDoProvedor("gerar um token novo de integracao"), async (req, res) => {
    try {
      const token = await storage.regenerateWebhookToken(req.session.providerId!);
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      return res.json({ token, webhookUrl: `${baseUrl}/api/webhooks/erp-sync` });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  /**
   * O cadastro da empresa, alterado pelo PROPRIO provedor.
   *
   * `exigirAdminDoProvedor` continua: o operador (`user`) nao mexe no cadastro
   * da empresa, e a excecao do suporte personificado — que a funcao ja trata —
   * e o motivo de a comparacao nao ser `role !== "admin"` na mao.
   *
   * A regua e a de cima, e o handler e quem aplica "so o que mudou". A ordem
   * importa: forma (schema) -> corpo vazio -> linha anterior -> CNPJ ->
   * comparacao campo a campo -> recusas -> gravacao.
   */
  router.patch("/api/provider/profile", requireAuth, requireProvider, exigirAdminDoProvedor("alterar o perfil"), async (req, res) => {
    try {
      const parsed = perfilDoProvedorSchema.safeParse(req.body);
      if (!parsed.success) {
        /**
         * `errors` e o mapa campo -> frases, para a tela um dia imprimir debaixo
         * do campo. O que cai neste ramo e chave que nao existe ou valor que nao
         * e texto: defeito do cliente, e nao engano de quem preenche.
         *
         * E por isso mesmo a resposta precisava de `formErrors`. A recusa do
         * `.strict()` e um `unrecognized_keys`, que NAO pertence a campo nenhum
         * — o zod a poe em `formErrors`, e a resposta so mandava `fieldErrors`.
         * Medido: um PATCH com uma chave a mais respondia literalmente
         * {"message":"Dados invalidos","errors":{}} — 400 sem uma palavra sobre
         * o que estava errado, e o painel imprime so `message` num toast.
         *
         * A frase e NOSSA, e nao a do zod ("Unrecognized key(s) in object:
         * 'ispCredits'"): ela nomeia as chaves recusadas, diz que nada foi
         * salvo, e esta em portugues como todo o resto da tela.
         */
        const { fieldErrors, formErrors } = parsed.error.flatten();
        const desconhecidas = parsed.error.issues
          .filter(issue => issue.code === "unrecognized_keys")
          .flatMap(issue => (issue as z.ZodIssue & { keys: string[] }).keys);
        const frasesGerais = desconhecidas.length > 0
          ? [`Estes campos não fazem parte do cadastro da empresa e por isso nada foi salvo: ${desconhecidas.join(", ")}.`]
          : formErrors;
        return res.status(400).json({
          message: frasesGerais.length > 0 ? frasesGerais.join(" ") : "Dados invalidos",
          errors: fieldErrors,
          formErrors: frasesGerais,
        });
      }
      const enviado = parsed.data as Record<string, string | null>;

      /**
       * Corpo sem nenhuma chave conhecida: recusa antes de tocar no banco.
       * `db.update().set({})` nao e um no-op — o Drizzle se recusa a montar o
       * SET vazio, o erro cai no catch generico e o provedor le "Erro interno
       * do servidor", que o convida a clicar de novo.
       *
       * Isto e diferente de "nada mudou", tratado la embaixo: aqui NADA chegou,
       * o que so acontece com formulario quebrado deste lado de ca.
       */
      if (Object.keys(enviado).length === 0) {
        return res.status(400).json({ message: "Nenhum campo para alterar" });
      }

      const anterior = await storage.getProvider(req.session.providerId!);
      if (!anterior) return res.status(404).json({ message: "Provedor nao encontrado" });
      const linha = anterior as unknown as Record<string, unknown>;

      /**
       * DECISAO (05/09/2026): o CNPJ SAI do que o provedor pode alterar — mas o
       * eco do que ja esta gravado continua passando.
       *
       * Tres fatos decidem, e nenhum deles e "por seguranca":
       *
       * 1. A tela NUNCA deixou digitar aqui: o campo do painel e `readOnly` e
       *    so devolve o que o GET entregou. Manter `cnpj` na lista de campos
       *    alteraveis nao servia o provedor — servia so quem chegasse por curl.
       * 2. Trocar o CNPJ e trocar QUEM A EMPRESA E: e o documento da nota
       *    fiscal e a chave pela qual o bureau reconhece o tenant. E a coluna e
       *    UNIQUE sem conferencia nenhuma nesta rota, entao uma colisao virava
       *    23505 dentro do catch e "Erro interno do servidor" na tela.
       * 3. Quem digitou errado no cadastro tem caminho: a ficha do superadmin
       *    corrige CNPJ desde 04/09/2026, com conferencia de duplicidade e 409
       *    dizendo de quem e o numero. Um erro no documento da empresa e
       *    exatamente o tipo de correcao que deve deixar rastro de quem fez.
       *
       * O eco tem de passar porque o painel reenvia os dezesseis campos a cada
       * Salvar: recusar o valor que o servidor mesmo entregou trancaria o
       * provedor fora do cadastro inteiro por um campo que ele nem pode editar.
       * A comparacao e por DIGITOS — quatro das seis linhas de producao guardam
       * o CNPJ mascarado, e "23.864.873/0001-48" e o mesmo documento que
       * "23864873000148".
       *
       * 403 e nao 400: o pedido esta bem formado e o valor pode ser um CNPJ
       * perfeito; o que falta e permissao para mexer NESTE campo.
       */
      if ("cnpj" in enviado) {
        const pedido = (enviado.cnpj ?? "").replace(/\D/g, "");
        const atual = String(linha.cnpj ?? "").replace(/\D/g, "");
        if (pedido !== atual) {
          logger.warn(
            { providerId: req.session.providerId, userId: req.session.userId, cnpj: `${pedido.slice(0, 4)}***` },
            "[provedor] tentativa de alterar o CNPJ pelo painel do provedor",
          );
          const frase = "O CNPJ identifica a empresa na nota fiscal e no bureau: só o suporte pode alterá-lo. Fale com o suporte para corrigir.";
          return res.status(403).json({ message: frase, errors: { cnpj: [frase] } });
        }
      }

      const alteracoes: Record<string, string | null> = {};
      const recusas: Record<string, string[]> = {};

      for (const [campo, valor] of Object.entries(enviado)) {
        if (campo === "cnpj") continue;
        const gravado = gravadoComo(linha[campo]);
        // O CORACAO DA ROTA: valor igual ao gravado nao e alteracao, entao nao
        // ha o que julgar nem o que gravar. E o que mantem o provedor com
        // cadastro legado dono do proprio cadastro.
        if (valor === gravado) continue;

        const regra = REGRAS_DO_PERFIL[campo];
        if (!regra) {
          // Nao ha caminho para isto com o schema acima. A guarda existe para
          // que um campo novo no schema sem regra correspondente falhe alto, em
          // vez de entrar no banco sem regua nenhuma — que e como esta rota
          // passou a existir.
          recusas[campo] = ["Campo sem regra de validação no servidor."];
          continue;
        }

        const veredito = regra(valor);
        if (!veredito.ok) {
          recusas[campo] = [veredito.frase];
          continue;
        }
        // A canonizacao pode ter alcancado o valor gravado ("mg" -> "MG"): nesse
        // caso nao ha alteracao de verdade, e um UPDATE que grava o que ja esta
        // la so suja o rastro.
        if (veredito.valor === gravado) continue;
        alteracoes[campo] = veredito.valor;
      }

      /**
       * Recusa e do formulario INTEIRO: nada de gravacao parcial. Quem clica em
       * Salvar espera que a tela e a linha combinem depois — gravar metade
       * deixaria as duas em desacordo sem que ninguem visse.
       *
       * As frases vao juntas em `message` porque o painel imprime so ele no
       * toast; cada uma nomeia o proprio campo, entao duas frases leem como duas
       * instrucoes. `errors` fica no mesmo formato da ficha do superadmin, para
       * o dia em que esta tela imprimir o erro debaixo do campo.
       */
      const frases = Object.values(recusas).flat();
      if (frases.length > 0) {
        return res.status(400).json({ message: frases.join(" "), errors: recusas });
      }

      /**
       * Tudo que chegou era igual ao que ja esta gravado. Nao e erro: e o Salvar
       * clicado sem editar nada, que e comum numa tela que reenvia os dezesseis
       * campos. A resposta honesta e a linha como ela esta — o estado da tela e
       * o do banco ja combinam, e um 400 aqui pintaria de vermelho um clique que
       * nao tem nada de errado.
       */
      if (Object.keys(alteracoes).length === 0) {
        return res.json(anterior);
      }

      const updated = await storage.updateProviderProfile(req.session.providerId!, alteracoes as any);
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/partners", requireAuth, requireProvider, async (req, res) => {
    try {
      const partners = await storage.getProviderPartners(req.session.providerId!);
      return res.json(partners);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/provider/partners", requireAuth, requireProvider, exigirAdminDoProvedor("adicionar socios"), async (req, res) => {
    try {
      const { name, cpf, birthDate, email, phone, role, sharePercentage } = req.body;
      if (!name || !cpf) return res.status(400).json({ message: "Nome e CPF sao obrigatorios" });
      const partner = await storage.createProviderPartner({
        providerId: req.session.providerId!,
        name, cpf, birthDate, email, phone, role,
        sharePercentage: sharePercentage ? String(sharePercentage) : undefined,
      });
      return res.json(partner);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/provider/partners/:id", requireAuth, requireProvider, exigirAdminDoProvedor("editar socios"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, cpf, birthDate, email, phone, role, sharePercentage } = req.body;
      const updated = await storage.updateProviderPartner(id, req.session.providerId!, {
        name, cpf, birthDate, email, phone, role,
        sharePercentage: sharePercentage ? String(sharePercentage) : undefined,
      });
      return res.json(updated);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/provider/partners/:id", requireAuth, requireProvider, exigirAdminDoProvedor("remover socios"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteProviderPartner(id, req.session.providerId!);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/documents", requireAuth, requireProvider, async (req, res) => {
    try {
      const docs = await storage.getProviderDocuments(req.session.providerId!);
      const docsNoData = docs.map(({ fileData, ...rest }) => rest);
      return res.json(docsNoData);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/provider/documents", requireAuth, requireProvider, exigirAdminDoProvedor("enviar documentos"), async (req, res) => {
    try {
      const { documentType, documentName, documentMimeType, documentSize, fileData } = req.body;
      if (!documentType || !documentName || !fileData) {
        return res.status(400).json({ message: "Dados do documento incompletos" });
      }
      const doc = await storage.createProviderDocument({
        providerId: req.session.providerId!,
        documentType, documentName, documentMimeType, documentSize,
        fileData,
        status: "pending",
        uploadedById: req.session.providerId,
      });
      const { fileData: _, ...docNoData } = doc;
      return res.json(docNoData);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.delete("/api/provider/documents/:id", requireAuth, requireProvider, exigirAdminDoProvedor("remover documentos"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteProviderDocument(id, req.session.providerId!);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/provider/documents/:id/download", requireAuth, requireProvider, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const doc = await storage.getProviderDocument(id);
      if (!doc || doc.providerId !== req.session.providerId!) {
        return res.status(404).json({ message: "Documento nao encontrado" });
      }
      const buffer = Buffer.from(doc.fileData.split(",")[1] || doc.fileData, "base64");
      res.setHeader("Content-Type", doc.documentMimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(doc.documentName)}"`);
      return res.send(buffer);
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // ── Proactive Alert Settings ──────────────────────────────
  router.get("/api/providers/alert-settings", requireAuth, requireProvider, async (req, res) => {
    try {
      const provider = await storage.getProvider(req.session.providerId!);
      if (!provider) return res.status(404).json({ message: "Provedor nao encontrado" });
      return res.json({
        proactiveAlertsEnabled: provider.proactiveAlertsEnabled ?? true,
        webhookUrl: provider.proactiveAlertWebhookUrl || "",
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.put("/api/providers/alert-settings", requireAuth, requireProvider, async (req, res) => {
    try {
      const { proactiveAlertsEnabled, webhookUrl } = req.body;
      await storage.updateProviderProfile(req.session.providerId!, {
        proactiveAlertsEnabled: proactiveAlertsEnabled === true,
        proactiveAlertWebhookUrl: webhookUrl || null,
      });
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/providers/alert-settings/test-webhook", requireAuth, requireProvider, async (req, res) => {
    try {
      const { webhookUrl } = req.body;
      if (!webhookUrl) return res.status(400).json({ message: "URL do webhook obrigatoria" });

      const testPayload = {
        event: "test",
        provider: "Teste",
        maskedCpf: "123.***.***.45",
        maskedCustomerName: "Joao S***",
        message: "Este e um teste de webhook do Consulta ISP",
        timestamp: new Date().toISOString(),
      };

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(10_000),
      });

      return res.json({ success: response.ok, status: response.status });
    } catch (error: any) {
      logger.error({ err: error }, "Webhook test failed");
      return res.status(500).json({ message: "Falha ao testar webhook", error: error.message });
    }
  });

  // ── Proactive Alerts List ──────────────────────────────
  // O id cru do consulente nunca sai para o dono: ao lado do codigo pareado
  // ele desfazia a anonimizacao. Mesma mascara de GET /api/anti-fraud/alerts.
  router.get("/api/providers/proactive-alerts", requireAuth, requireProvider, async (req, res) => {
    try {
      const providerId = req.session.providerId!;
      const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
      const alerts = await storage.getProactiveAlertsByProvider(providerId, limit);
      return res.json(alerts.map(pa => ({
        ...pa,
        consultingProviderId: pa.consultingProviderId === providerId ? pa.consultingProviderId : null,
        consultingProviderName: anonymizeProvider(providerId, pa.consultingProviderId),
      })));
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.patch("/api/providers/proactive-alerts/:id/acknowledge", requireAuth, requireProvider, async (req, res) => {
    try {
      const alertId = parseInt(req.params.id);
      const updated = await storage.acknowledgeProactiveAlert(alertId, req.session.providerId!);
      if (!updated) return res.status(404).json({ message: "Alerta nao encontrado" });
      // So o que mudou: a linha inteira traz o id do consulente.
      return res.json({ id: updated.id, acknowledged: updated.acknowledged, acknowledgedAt: updated.acknowledgedAt });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
