import { Router } from "express";
import { storage } from "../storage";
import { loginSchema, registerSchema } from "@shared/schema";
import { hashPassword, verifyPassword } from "../password";
import { sendVerificationEmail, sendWelcomeEmail, sendPasswordChangedEmail } from "../services/email";
import { ROTULO_DO_PLANO } from "../services/precos.service";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { getSafeErrorMessage } from "../utils/safe-error";
import { normalizarHost, extractSubdomainFromHost } from "../tenant";
import { hostPertenceAoProvider, hostPertenceAMarca, resolverMarcaPorId, urlDeEntrada } from "../services/marca.service";
import { MENSAGEM_PROVEDOR_SUSPENSO, encerrarPersonificacao } from "../auth";
import { validarCPF, validarCNPJ } from "../utils/cpf-cnpj-validator";
import crypto from "crypto";

/**
 * Avisa o DONO DA CONTA que a senha dela mudou.
 *
 * Nao passa por `avisarProvedor` de proposito: aquele resolve "quem fala pelo
 * provedor" (contato cadastrado, ou os administradores). Aqui o destinatario e
 * uma pessoa especifica — a dona do e-mail cuja senha acabou de ser trocada. Um
 * operador que teve a conta tomada precisa do aviso na propria caixa, nao na do
 * contato financeiro do provedor.
 *
 * E o unico sinal que ele tem: quem toma a conta troca a senha, e sem isso o
 * dono so descobre quando tenta entrar e nao consegue.
 *
 * A marca e o endereco continuam saindo do PROVEDOR — mesma regra do reenvio de
 * verificacao e do "esqueci minha senha".
 *
 * Nunca lanca. A senha JA mudou quando esta funcao e chamada; se o envio falhar,
 * o que se perde e o aviso, e isso vai para o log.
 */
async function avisarQueASenhaMudou(
  user: { email: string; name: string; providerId?: number | null },
  origem: string,
): Promise<void> {
  try {
    const provider = user.providerId ? await storage.getProvider(user.providerId) : null;
    const marca = await resolverMarcaPorId(provider?.marcaId);
    await sendPasswordChangedEmail(user.email, user.name, marca, urlDeEntrada(provider, marca));
  } catch (err: any) {
    console.error(`[email] Falha ao avisar troca de senha (${origem}):`, err?.message);
  }
}

/**
 * A MARCA que o revendedor recebe no login e no /me. Sete campos, escolhidos um
 * a um — e a lista do que NAO esta aqui importa tanto quanto a do que esta.
 *
 * FORA, e nao por esquecimento:
 *   · `logoSvg` / `logoPng` / `faviconSvg` / `ogImagePng` — sao imagens inteiras
 *     em base64 dentro de uma coluna de texto. O /me e o endpoint mais chamado
 *     do sistema (toda montagem de tela pede um); mandar centenas de KB de SVG
 *     em cada resposta troca uma tela rapida por uma lenta sem nenhum ganho, e
 *     as imagens ja sao servidas por URL (`/api/marca/:id/logo`), onde o
 *     navegador as cacheia e desliga script.
 *   · `repasseRazaoSocial` / `repasseCnpj` / `repasseChavePix` / `repasseEmail`
 *     — quem RECEBE o dinheiro da comissao. Decisao 6 do dono: so o superadmin
 *     le e escreve. Uma chave PIX de beneficiario nao tem por que atravessar a
 *     rede a cada carregamento de tela, e este payload vai para o log do
 *     navegador, para o histórico de rede e para qualquer extensao instalada.
 *
 * `comissaoPercentual` FICA: e o percentual que o proprio revendedor negociou e
 * que ele vai conferir contra o extrato dele. Esconder o numero de quem tem
 * direito a ele nao protege ninguem.
 */
export type MarcaDaSessao = {
  id: number;
  nomeProduto: string;
  slug: string;
  dominio: string | null;
  dominioStatus: string;
  revendaAtiva: boolean;
  comissaoPercentual: number;
};

/**
 * Projeta a linha de `marcas` nos sete campos acima.
 *
 * `Number(...)` no percentual: a coluna e `numeric(5,2)` e o driver a entrega
 * como STRING ("20.00"), o que na tela viraria "20.00%". A conversao e total —
 * a coluna e NOT NULL e tem CHECK de 0 a 50 no banco, entao nao ha texto fora de
 * formato a converter. Vale so para exibir; conta de dinheiro se faz no servidor.
 */
async function marcaDaSessao(marcaId: number | null | undefined): Promise<MarcaDaSessao | null> {
  if (!marcaId || marcaId <= 0) return null;
  const marca = await storage.getMarca(marcaId);
  if (!marca) return null;
  return {
    id: marca.id,
    nomeProduto: marca.nomeProduto,
    slug: marca.slug,
    dominio: marca.dominio ?? null,
    dominioStatus: marca.dominioStatus,
    revendaAtiva: marca.revendaAtiva,
    comissaoPercentual: Number(marca.comissaoPercentual),
  };
}

export function registerAuthRoutes(): Router {
  const router = Router();

  const loginLimiter = createRateLimiter({ windowMs: 900_000, maxRequests: 5 });
  const registerLimiter = createRateLimiter({ windowMs: 3_600_000, maxRequests: 3 });
  const resendLimiter = createRateLimiter({ windowMs: 900_000, maxRequests: 3 });

  /**
   * O fluxo de senha tambem tem limite. Ele era o unico de fora.
   *
   * `forgot-password` MANDA E-MAIL para um endereco que quem chama digitou, e
   * responde a mesma coisa para conta que existe e para conta que nao existe.
   * Sem limite, e uma maquina de despejar mensagem assinada com a marca de um
   * provedor na caixa de terceiros — e a reputacao do dominio de envio e do
   * provedor, nao de quem abusou. Mesma cota do reenvio de verificacao
   * (3/15min): sao o mesmo gesto, "me manda de novo aquele e-mail".
   *
   * `reset-password` ADIVINHA um token de 32 bytes. Sozinho o token e forte,
   * mas sem limite a tentativa nao custa nada e a janela fica aberta a hora
   * inteira de validade dele. Cota do login (5/15min), que e o outro lugar
   * onde se acerta ou nao um segredo: sobra folga para quem erra a confirmacao
   * da senha duas ou tres vezes e nao serve para varredura.
   *
   * Os dois entram sem sessao, entao a chave e o IP — ver `chaveDoLimite`.
   */
  const forgotLimiter = createRateLimiter({ windowMs: 900_000, maxRequests: 3 });
  const resetLimiter = createRateLimiter({ windowMs: 900_000, maxRequests: 5 });
  const trocaDeSenhaLimiter = createRateLimiter({ windowMs: 900_000, maxRequests: 10 });
  // Trocar a senha logado tambem dispara e-mail desde 03/09/2026. Sem limite,
  // uma sessao aberta vira maquina de despejar aviso na caixa do dono. O balde
  // e maior que o do reset porque aqui quem chama ja provou quem e.

  router.post("/api/auth/login", loginLimiter, async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos" });
      }
      const { email, password } = parsed.data;
      const user = await storage.getUserByEmail(email);
      const valid = user ? await verifyPassword(password, user.password) : false;
      if (!user || !valid) {
        return res.status(401).json({ message: "Email ou senha incorretos" });
      }
      if (!user.emailVerified) {
        return res.status(403).json({ message: "Email nao verificado. Verifique sua caixa de entrada.", code: "EMAIL_NOT_VERIFIED", email: user.email });
      }
      const provider = user.providerId ? await storage.getProvider(user.providerId) : null;

      // Isolamento de tenant. O host precisa PROVAR que este provedor pertence
      // aqui: subdominio dele, ou dominio da marca white label dele. Qualquer
      // outra coisa recusa — inclusive host desconhecido.
      //
      // A regra anterior so agia quando conseguia extrair um subdominio, o que
      // a tornava fail-OPEN: em host de dois rotulos ela era pulada inteira.
      // Superadmin e da plataforma e entra por qualquer host, por desenho.
      //
      // O `&& user.providerId` que existia aqui reabria a mesma porta em outro
      // eixo: usuario sem provedor pulava a prova inteira e entrava por
      // qualquer host. Agora a ausencia de provedor RECUSA — e recusa com a
      // mensagem generica, para nao contar que a conta existe.
      /**
       * REVENDEDOR — a prova e outra, e mais estreita.
       *
       * Ele nao tem provedor: quem responde por ele e a marca. `hostPertenceAMarca`
       * aceita UM caminho so — o dominio proprio da marca, ativo e com HTTPS
       * emitido — e recusa o resto com motivo proprio: dominio de outra marca
       * (cross-tenant, o caso grave), marca desligada, dominio ainda pendente de
       * certificado, a raiz da plataforma e ate o subdominio de um provedor DA
       * PROPRIA marca. Este ultimo e uma decisao, nao um efeito colateral: a
       * sessao de quem revende nao nasce presa ao endereco de um cliente dele.
       *
       * A recusa e o MESMO 401 generico dos outros ramos. Um texto especifico
       * aqui — "essa conta e de outra marca" — transformaria a tela de login de
       * qualquer dominio white label num oraculo que confirma que um e-mail
       * existe e em qual concorrente ele trabalha.
       */
      if (user.role === "revendedor") {
        if (!await hostPertenceAMarca(req.hostname, user.marcaId)) {
          return res.status(401).json({ message: "Email ou senha incorretos" });
        }
      } else if (user.role !== "superadmin") {
        const pertence = user.providerId && provider
          ? await hostPertenceAoProvider(req.hostname, {
              subdomain: provider.subdomain ?? null,
              marcaId: provider.marcaId ?? null,
            })
          : false;
        if (!pertence) {
          // Generica de proposito: nao revela se a conta existe, nem qual seria
          // o endereco certo.
          return res.status(401).json({ message: "Email ou senha incorretos" });
        }
      }

      /**
       * Provedor suspenso nao entra.
       *
       * O confirm da aba Provedores promete que suspender "bloqueia o acesso do
       * provedor e dos usuarios dele", e nada no servidor lia
       * `providers.status`. O superadmin suspendia por inadimplencia e o
       * operador logava em seguida, abria o dashboard e gastava credito.
       *
       * Fica DEPOIS da senha e DEPOIS da prova de host de proposito: quem erra
       * a senha, ou tenta pelo endereco errado, continua ouvindo a mensagem
       * generica. Assim este texto — que confirma que a conta existe — so
       * aparece para quem ja provou ser dono dela.
       */
      if (user.role !== "superadmin" && provider && provider.status !== "active") {
        return res.status(403).json({
          message: MENSAGEM_PROVEDOR_SUSPENSO,
          code: "PROVIDER_SUSPENDED",
        });
      }

      /**
       * A SESSAO TROCA DE DONO AQUI — e a personificacao de suporte nao pode
       * atravessar essa troca.
       *
       * O login sobrescrevia `userId`, `providerId` e `role` e deixava
       * `session.suporte` no lugar, orfa: uma sessao de suporte conectada ao
       * provedor A na qual alguem faz login continuaria carregando a janela de
       * A. `travaDeAcessoDeSuporte` seguiria validando aquela janela a cada
       * requisicao e CARIMBANDO USO nela com o `userId` de quem acabou de
       * entrar — a trilha do provedor A passaria a acusar acesso de uma pessoa
       * que nunca entrou nele. E se o provedor A revogasse, quem esta logado
       * como outra pessoa levaria um 403 de uma liberacao que nao e dele.
       *
       * Vem ANTES das atribuicoes de proposito: `encerrarPersonificacao` zera
       * `providerId` junto, e as linhas abaixo gravam o valor certo por cima.
       * Chamar a funcao de `server/auth.ts`, e nao um `delete` local, mantem um
       * lugar so decidindo o que "sair da personificacao" significa.
       */
      /**
       * `marca` sai SO para o revendedor, e a ausencia dela para os outros e
       * deliberada: o payload de quem ja usava o sistema fica identico ao de
       * ontem. Provedor e superadmin nao precisam dela — a pele que o provedor
       * veste ja chega pelo `window.__MARCA__` injetado no HTML
       * (server/marca-html.ts), resolvido por host e sem custar consulta por login.
       *
       * Para o revendedor `provider` e null porque ele nao tem provedor nenhum:
       * a coluna e nula por CHECK no banco (`users_papel_coerente`).
       *
       * Lida ANTES de mexer na sessao: tudo o que a resposta precisa e resolvido
       * primeiro, e so entao a sessao e alterada e gravada. Uma leitura que
       * falhasse depois do `save` deixaria a pessoa autenticada olhando um 500.
       */
      const marca = user.role === "revendedor" ? await marcaDaSessao(user.marcaId) : undefined;

      encerrarPersonificacao(req.session);

      req.session.userId = user.id;
      req.session.providerId = user.providerId || 0;
      req.session.role = user.role;
      // O host inteiro, normalizado, e o que requireAuth compara depois — ver a
      // nota de seguranca em server/auth.ts.
      req.session.hostLogin = normalizarHost(req.hostname);
      req.session.subdomain = extractSubdomainFromHost(req.hostname) || undefined;
      /**
       * Para o revendedor a marca vem do USUARIO; para os demais, do provedor.
       *
       * A linha era so `provider?.marcaId`, e para um revendedor `provider` e
       * null — a sessao nasceria com `marcaId` nulo, `providerId` 0 e nenhum
       * tenant. `requireRevendedor` a recusaria em tudo, e a pessoa que acabou
       * de acertar a senha e o dominio ficaria trancada do lado de dentro.
       */
      req.session.marcaId = user.role === "revendedor"
        ? user.marcaId ?? null
        : provider?.marcaId ?? null;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => err ? reject(err) : resolve());
      });
      return res.json({
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        provider,
        // A chave existe para o revendedor mesmo quando o valor e null — "sou
        // revendedor e a marca sumiu" e uma resposta, e a ausencia da chave nao
        // e. Para os demais papeis ela nao aparece.
        ...(marca !== undefined ? { marca } : {}),
        mustChangePassword: user.mustChangePassword || false,
      });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  const subdomainLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });

  router.get("/api/auth/check-subdomain", subdomainLimiter, async (req, res) => {
    const { subdomain } = req.query as { subdomain?: string };
    if (!subdomain) return res.status(400).json({ message: "Subdominio obrigatorio" });
    const existing = await storage.getProviderBySubdomain(subdomain);
    return res.json({ available: !existing });
  });

  router.post("/api/auth/register", registerLimiter, async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dados invalidos: " + parsed.error.errors.map(e => e.message).join(", ") });
      }
      const { email, password, name, phone, responsavelCpf, providerName, cnpj, subdomain } = parsed.data;

      /**
       * Digito verificador do CPF e do CNPJ.
       *
       * O zod so confere tamanho, e a tela pode ter caido no preenchimento
       * manual — sem isso, "11111111111" entrava no cadastro de socios como se
       * fosse gente. Um bureau que aceita documento invalido na propria porta
       * de entrada nao tem como cobrar dado bom de ninguem.
       */
      const cpfLimpo = responsavelCpf.replace(/\D/g, "");
      if (!validarCPF(cpfLimpo)) {
        return res.status(400).json({ message: "CPF do responsavel invalido. Confira os numeros." });
      }
      if (!validarCNPJ(cnpj.replace(/\D/g, ""))) {
        return res.status(400).json({ message: "CNPJ invalido. Confira os numeros." });
      }

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Dados ja cadastrados. Verifique email, telefone, CNPJ ou subdominio." });
      }

      const existingPhone = await storage.getUserByPhone(phone);
      if (existingPhone) {
        return res.status(409).json({ message: "Dados ja cadastrados. Verifique email, telefone, CNPJ ou subdominio." });
      }

      const existingProvider = await storage.getProviderByCnpj(cnpj);
      if (existingProvider) {
        return res.status(409).json({ message: "Dados ja cadastrados. Verifique email, telefone, CNPJ ou subdominio." });
      }

      const existingSubdomain = await storage.getProviderBySubdomain(subdomain);
      if (existingSubdomain) {
        return res.status(409).json({ message: "Dados ja cadastrados. Verifique email, telefone, CNPJ ou subdominio." });
      }

      const provider = await storage.createProvider({
        name: providerName, cnpj, subdomain, plan: "free", status: "active",
        // O WhatsApp do responsavel tambem vira contato do provedor: e o unico
        // canal que continua funcionando quando o e-mail nao chega.
        contactEmail: email,
        contactPhone: phone,
      });
      const user = await storage.createUser({
        email,
        password: await hashPassword(password),
        name,
        phone,
        role: "admin",
        providerId: provider.id,
        emailVerified: false,
        lgpdAcceptedAt: new Date(),
      });

      /**
       * O responsavel entra como socio do provedor.
       *
       * Antes o CPF de quem abria a conta simplesmente nao era guardado — a
       * aba de socios do painel nascia vazia e a aprovacao do provedor pelo
       * superadmin nao tinha contra quem conferir o CNPJ.
       * Nao derruba o cadastro se falhar: a conta ja existe, e o socio pode ser
       * lancado depois pelo painel.
       */
      await storage.createProviderPartner({
        providerId: provider.id,
        name,
        cpf: cpfLimpo,
        email,
        phone,
        role: "Responsavel pelo cadastro",
      }).catch(err => console.error("[cadastro] socio responsavel nao gravado:", err?.message));

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await storage.setVerificationToken(user.id, token, expiresAt);

      try {
        /**
         * Mesma regra do reenvio e do "esqueci minha senha": marca e endereco
         * saem do PROVEDOR, nao do host de onde o cadastro veio.
         *
         * Com a marca do host, sem dominio de marca ativo, o link caia na RAIZ
         * da plataforma — e a raiz e exatamente onde `hostPertenceAoProvider`
         * recusa o login de todo usuario nao-superadmin. Quem se cadastrava
         * pela landing confirmava o e-mail, era mandado para /login no mesmo
         * host e ouvia "Email ou senha incorretos" sem entender por que.
         *
         * O provedor acabou de ser inserido acima, ainda sem marca (vincular
         * marca no cadastro e assunto da fase 1), entao `urlDeEntrada` cai no
         * subdominio dele — o unico endereco onde ele consegue entrar hoje.
         */
        const marca = await resolverMarcaPorId(provider.marcaId);
        await sendVerificationEmail(email, name, token, marca, urlDeEntrada(provider, marca));
      } catch (emailError: any) {
        console.error("[email] Falha ao enviar email de verificacao:", emailError.message);
      }

      return res.status(201).json({ needsVerification: true, email });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/auth/verify-email", async (req, res) => {
    try {
      const { token } = req.query as { token?: string };
      if (!token) {
        return res.status(400).json({ message: "Token ausente" });
      }
      const user = await storage.getUserByVerificationToken(token);
      if (!user) {
        return res.status(400).json({ message: "Este link de confirmação não vale mais: ou já foi usado, ou não é o link que enviamos." });
      }
      if (user.verificationTokenExpiresAt && new Date() > user.verificationTokenExpiresAt) {
        return res.status(400).json({ message: "Token expirado. Solicite um novo email de verificacao.", code: "TOKEN_EXPIRED" });
      }
      const provider = user.providerId ? await storage.getProvider(user.providerId) : null;
      const marca = await resolverMarcaPorId(provider?.marcaId);
      const entrada = urlDeEntrada(provider, marca);

      /**
       * A conta so fica ATIVA aqui — e e aqui que as boas-vindas saem.
       *
       * Mandar no cadastro seria prometer um acesso que ainda nao existe: entre
       * criar e confirmar, o login e recusado por e-mail nao verificado.
       *
       * UMA VEZ SO. A trava de verdade e `setEmailVerified` zerar o token: o
       * segundo clique no mesmo link nem encontra usuario e morre no 400 acima.
       * O `if` abaixo e o cinto para a linha que chegar aqui ja verificada e
       * ainda com token — ela recebe sucesso e nenhum e-mail.
       */
      if (!user.emailVerified) {
        await storage.setEmailVerified(user.id);
        if (provider) {
          try {
            await sendWelcomeEmail(
              user.email,
              {
                nome: user.name,
                provedor: provider.name,
                cnpj: provider.cnpj,
                // Rotulo em portugues, nunca a chave crua ("pro") na tela. Os
                // quatro planos do sistema estao no mapa; um valor fora dele e
                // dado corrompido, e ai mostrar o que esta gravado e mais
                // honesto do que inventar um plano que o provedor nao tem.
                plano: ROTULO_DO_PLANO[provider.plan] ?? provider.plan,
                creditos: provider.ispCredits ?? 0,
                emailDeAcesso: user.email,
              },
              marca,
              entrada,
            );
          } catch (emailError: any) {
            // A conta ja esta ativa. O que se perde e o aviso.
            console.error("[email] Falha ao enviar boas-vindas:", emailError?.message);
          }
        } else {
          // O e-mail inteiro fala do provedor (nome, CNPJ, plano, creditos).
          // Sem provedor nao ha o que dizer, e inventar seria pior.
          console.warn(`[email] Usuario ${user.id} verificado sem provedor: boas-vindas nao enviadas.`);
        }
      }

      /**
       * Sem login automatico no GET. Mas o endereco de entrada vai junto.
       *
       * A tela mandava para `/login` NO HOST ATUAL. Quem abriu o link pelo
       * dominio da plataforma — e o link chega por e-mail, ele abre onde a
       * pessoa clicar — caia numa tela onde `hostPertenceAoProvider` recusa o
       * login por desenho, e lia "Email ou senha incorretos" sem ter errado
       * nada. So o servidor sabe se este provedor entra pelo subdominio ou pelo
       * dominio da marca, entao e o servidor que responde.
       */
      return res.json({ verified: true, email: user.email, urlDeEntrada: entrada });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.post("/api/auth/resend-verification", resendLimiter, async (req, res) => {
    try {
      const { email } = req.body as { email?: string };
      if (!email) {
        return res.status(400).json({ message: "Email obrigatorio" });
      }
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.json({ message: "Se esse email existir, um novo link foi enviado." });
      }
      if (user.emailVerified) {
        return res.json({ message: "Email ja verificado. Faca o login normalmente." });
      }
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await storage.setVerificationToken(user.id, token, expiresAt);
      try {
        /**
         * A marca sai do PROVEDOR do usuario, nao do host de onde o pedido veio.
         *
         * Sao coisas diferentes, e a diferenca aparece: quem pede reenvio pelo
         * dominio da plataforma, ou por um dominio de marca que nao e a dele,
         * recebia um e-mail com a cara errada — e com um link para um endereco
         * onde o login dele e recusado. Pelo provedor, a marca e sempre a que
         * ele contratou.
         */
        const provider = user.providerId ? await storage.getProvider(user.providerId) : null;
        const marca = await resolverMarcaPorId(provider?.marcaId);
        await sendVerificationEmail(email, user.name, token, marca, urlDeEntrada(provider, marca));
      } catch (emailError: any) {
        console.error("[email] Falha ao reenviar email:", emailError.message);
      }
      return res.json({ message: "Novo link de verificacao enviado. Verifique sua caixa de entrada." });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // O logout nao precisa de `encerrarPersonificacao`: `destroy` apaga a linha
  // inteira da sessao, `suporte` incluido. Vale a nota porque a assimetria com o
  // login logo acima parece esquecimento e nao e — o que sobrevive a um login e
  // justamente o que nao sobrevive a um destroy.
  router.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Deslogado com sucesso" });
    });
  });

  // Esqueci minha senha
  router.post("/api/auth/forgot-password", forgotLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email obrigatorio" });

      // Sempre retorna sucesso (nao revela se email existe)
      const user = await storage.getUserByEmail(email);
      if (user) {
        const crypto = await import("crypto");
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
        const { users } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const { db } = await import("../db");
        await db.update(users).set({ resetToken: token, resetTokenExpiresAt: expiresAt }).where(eq(users.id, user.id));
        const { sendPasswordResetEmail } = await import("../services/email");
        // Mesma regra do reenvio de verificacao: a marca e o endereco saem do
        // PROVEDOR do usuario. Um link de redefinicao para a raiz da plataforma
        // termina numa tela que recusa o login sem explicar por que.
        const provider = user.providerId ? await storage.getProvider(user.providerId) : null;
        const marca = await resolverMarcaPorId(provider?.marcaId);
        await sendPasswordResetEmail(
          user.email, user.name, token, marca, urlDeEntrada(provider, marca),
        ).catch(err =>
          console.warn(`[auth] Erro ao enviar email de reset: ${err.message}`)
        );
      }
      return res.json({ message: "Se o email estiver cadastrado, voce recebera instrucoes para redefinir sua senha." });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  // Redefinir senha com token
  router.post("/api/auth/reset-password", resetLimiter, async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) return res.status(400).json({ message: "Token e nova senha obrigatorios" });
      if (newPassword.length < 6) return res.status(400).json({ message: "Senha deve ter no minimo 6 caracteres" });

      const { users } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { db } = await import("../db");

      const [user] = await db.select().from(users).where(eq(users.resetToken, token)).limit(1);
      if (!user) return res.status(400).json({ message: "Link invalido ou expirado" });
      if (user.resetTokenExpiresAt && new Date(user.resetTokenExpiresAt) < new Date()) {
        return res.status(400).json({ message: "Link expirado. Solicite uma nova redefinicao." });
      }

      const { hashPassword } = await import("../password");
      const hashed = await hashPassword(newPassword);
      await db.update(users).set({
        password: hashed,
        resetToken: null,
        resetTokenExpiresAt: null,
        mustChangePassword: false,
      }).where(eq(users.id, user.id));

      await avisarQueASenhaMudou(user, "reset-password");

      return res.json({ message: "Senha alterada com sucesso. Faca login com a nova senha." });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  router.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Nao autenticado" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "Nao autenticado" });
    }
    /**
     * O TENANT DESTA REQUISICAO E O DA SESSAO, nao o da coluna `users.provider_id`.
     *
     * Resolver por `user.providerId` respondia certo por acidente: para todo
     * mundo os dois valores coincidem, porque o login grava um a partir do
     * outro. Durante um acesso de suporte eles divergem de proposito — o
     * superadmin tem a coluna nula e a sessao apontando para o provedor que
     * liberou a janela — e o /me devolvia `provider: null`, deixando as telas do
     * provedor sem o unico contexto que elas tem (nome, plano, creditos, marca).
     * Todo o resto do servidor isola por `req.session.providerId`; aqui passa a
     * valer a mesma fonte.
     *
     * O fallback para a coluna preserva a resposta de quem nao esta
     * personificando, inclusive numa sessao gravada antes de `providerId`
     * existir: sem ele, uma sessao antiga perderia o provedor de repente.
     */
    const providerIdDaSessao = req.session.providerId && req.session.providerId > 0
      ? req.session.providerId
      : user.providerId;
    const provider = providerIdDaSessao ? await storage.getProvider(providerIdDaSessao) : null;
    // "Seu codigo": o codigo proprio, para o suporte. Nao e o que os parceiros
    // veem para este provedor (cada um ve o codigo pareado) — identifica o
    // provedor so para a plataforma.
    const partnerCode = provider ? (await import("../utils/provider-anonymizer.js")).generateOwnCode(provider.id) : null;
    /**
     * "Esta sessao esta dentro de um tenant que nao e o dono dela?"
     *
     * A interface precisa dessa resposta e nao consegue deduzi-la: `role`
     * continua "superadmin" de proposito (server/auth.ts), e `provider` agora
     * vem preenchido nos dois casos. `session.suporte` so existe enquanto uma
     * janela de acesso autoriza a personificacao — a trava a reconfere a cada
     * requisicao — entao ele e o sinal exato, e nao uma heuristica sobre a
     * coluna do usuario.
     *
     * Nao e autorizacao: nada aqui abre porta nenhuma. So diz de qual dos dois
     * produtos a navegacao e.
     */
    const personificando = !!req.session.suporte;
    /**
     * A MARCA, so para o revendedor — e pela mesma doutrina do `provider` acima:
     * a fonte e a SESSAO, com a coluna como reserva.
     *
     * Para quem nao e revendedor a chave nem aparece, e isso e uma promessa: a
     * resposta do admin de provedor e a do superadmin saem identicas as de
     * antes da fase 1. O white label ja chega a essas telas pelo
     * `window.__MARCA__` do HTML, resolvido por host, e duplicar aqui so criaria
     * uma segunda fonte para a mesma pergunta — duas fontes divergem.
     */
    const marcaIdDaSessao = req.session.marcaId && req.session.marcaId > 0
      ? req.session.marcaId
      : user.marcaId;
    const marca = user.role === "revendedor" ? await marcaDaSessao(marcaIdDaSessao) : undefined;
    return res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      provider,
      partnerCode,
      personificando,
      ...(marca !== undefined ? { marca } : {}),
      mustChangePassword: user.mustChangePassword || false,
    });
  });

  router.post("/api/auth/change-password", trocaDeSenhaLimiter, async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Nao autenticado" });
    }
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: "Senha deve ter no minimo 6 caracteres" });
    }
    try {
      const { hashPassword } = await import("../password");
      const hashed = await hashPassword(newPassword);
      const { users } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { db } = await import("../db");
      await db.update(users).set({ password: hashed, mustChangePassword: false }).where(eq(users.id, req.session.userId));

      // Le depois de gravar: a troca ja aconteceu, e o que falta e so contar.
      const dono = await storage.getUser(req.session.userId).catch(() => undefined);
      if (dono) await avisarQueASenhaMudou(dono, "change-password");

      return res.json({ message: "Senha alterada com sucesso" });
    } catch (error: any) {
      return res.status(500).json({ message: getSafeErrorMessage(error) });
    }
  });

  return router;
}
