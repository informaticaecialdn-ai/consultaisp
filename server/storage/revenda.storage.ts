/**
 * Acesso a dados do PAINEL DO REVENDEDOR (`/api/revenda/*`).
 *
 * Modulo autonomo, importado direto por `server/routes/revenda.routes.ts`. NAO
 * entra no barril `server/storage/index.ts` — e o mesmo criterio de
 * `marca-eventos.service.ts`: o que mora no barril fica ao alcance de qualquer
 * rota do sistema por `storage.<metodo>`, e o ponto deste arquivo e o oposto.
 * Cada funcao aqui exige `marcaId` como PRIMEIRO argumento porque nenhuma delas
 * tem resposta correta sem ele.
 *
 * ── POR QUE NAO REAPROVEITAR O QUE JA EXISTE ──────────────────────────────
 *
 * A tentacao obvia era chamar `getAllProvidersWithStats()` e filtrar por marca
 * no JavaScript, ou `getAllUsers()` e filtrar por `marcaId`. As duas sao
 * proibidas pelo desenho, e por motivos diferentes:
 *
 *   · `getAllProvidersWithStats` devolve `erpToken` DESCRIPTOGRAFADO (ver
 *     server/storage/providers.storage.ts). Filtrar depois nao desfaz o
 *     `select`: a credencial do ERP de todo provedor da plataforma ja saiu do
 *     banco, e basta alguem esquecer uma linha do `map` para ela sair na
 *     resposta HTTP. O revendedor nao tem direito ao token nem do provedor dele
 *     (decisao do desenho: "erpSource/erpEnabled/lastSyncAt, SEM token").
 *   · `GET /api/admin/users` e global e devolve a linha inteira de `users`,
 *     com `password`, `verification_token` e `reset_token`.
 *
 * Dai a regra deste arquivo: **colunas nomeadas em todo `select`**, nunca
 * `select().from(tabela)`. Assim uma coluna nova em `users` ou `providers` —
 * um segredo, um dado de titular — nasce FORA da resposta do revendedor, e
 * inclui-la exige escrever o nome dela aqui.
 *
 * ── O QUE ESTE ARQUIVO AINDA NAO FAZ ──────────────────────────────────────
 * Lista e detalhe de provedores da marca sao a FASE 2; comissao e a fase 4.
 * A fase 1 precisa de tres coisas: o agregado da visao geral, a equipe da
 * propria marca e a leitura/escrita da propria marca.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { marcas, providers, users } from "@shared/schema";
import type { ConteudoDaLandingBruto } from "@shared/marca-landing";

/** O papel dos usuarios desta tabela que pertencem a uma marca. Ver `equipeDaMarca`. */
const PAPEL_DO_REVENDEDOR = "revendedor";

// ── Visao geral ────────────────────────────────────────────────────────────

export type ResumoDaMarca = {
  total: number;
  ativos: number;
  suspensos: number;
  cancelados: number;
  aguardandoAprovacao: number;
  novosNoMes: number;
};

/**
 * Contagem de provedores da marca, por status, numa varredura so.
 *
 * `count(*) filter (where ...)` em vez de cinco `select count(*)`: e uma
 * passada na tabela em lugar de cinco, e — o que importa mais — as cinco
 * contagens saem do MESMO instante. Somadas de consultas separadas, "ativos" e
 * "total" poderiam vir de fotos diferentes e a tela mostraria uma soma que nao
 * fecha, sem que nada esteja errado.
 *
 * As condicoes sao construidas com `eq()` do proprio Drizzle dentro do
 * template: o valor vai como PARAMETRO (`= $2`), nao interpolado no texto. Nao
 * ha entrada de usuario aqui, mas literal em SQL e um habito que so tem chance
 * de dar errado.
 *
 * `cancelados` entra mesmo sem a tela pedir: sem ele
 * `ativos + suspensos != total` para uma marca com provedor cancelado, e quem
 * olha a tela le isso como defeito de contagem.
 *
 * O corte de "novos no mes" e `date_trunc('month', now())`, avaliado no banco, e
 * nao uma data calculada aqui. `providers.created_at` e `timestamp` SEM fuso e
 * foi gravado por `now()` (`defaultNow()`); comparar com o relogio do processo
 * Node — que pode estar em outro fuso que o do Postgres — deslocaria a virada
 * do mes em algumas horas. Comparado com `now()` do proprio banco, o corte usa
 * exatamente o relogio que escreveu a coluna.
 */
export async function resumoDaMarca(marcaId: number): Promise<ResumoDaMarca> {
  const [linha] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      ativos: sql<number>`count(*) filter (where ${eq(providers.status, "active")})`.mapWith(Number),
      suspensos: sql<number>`count(*) filter (where ${eq(providers.status, "suspended")})`.mapWith(Number),
      cancelados: sql<number>`count(*) filter (where ${eq(providers.status, "cancelled")})`.mapWith(Number),
      aguardandoAprovacao: sql<number>`count(*) filter (where ${eq(providers.verificationStatus, "pending")})`.mapWith(Number),
      novosNoMes: sql<number>`count(*) filter (where ${providers.createdAt} >= date_trunc('month', now()))`.mapWith(Number),
    })
    .from(providers)
    .where(eq(providers.marcaId, marcaId));

  // `count` sobre conjunto vazio devolve 0, entao a linha sempre existe. O
  // fallback existe so para o tipo: `[linha]` de um array vazio e `undefined`.
  return linha ?? { total: 0, ativos: 0, suspensos: 0, cancelados: 0, aguardandoAprovacao: 0, novosNoMes: 0 };
}

// ── Equipe da marca ────────────────────────────────────────────────────────

export type MembroDaEquipe = {
  id: number;
  name: string;
  email: string;
  role: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
  createdAt: Date | null;
};

/** As colunas de `users` que o revendedor pode ver da propria equipe. */
const COLUNAS_DO_MEMBRO = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  emailVerified: users.emailVerified,
  mustChangePassword: users.mustChangePassword,
  createdAt: users.createdAt,
} as const;

/**
 * O filtro de pertencimento da equipe.
 *
 * `marcaId` E o escopo; `role` e redundante HOJE, porque o CHECK
 * `users_papel_coerente` (migracao 0013) garante que quem tem `marca_id` e
 * revendedor. E redundancia de proposito: se o CHECK cair numa migracao futura
 * — ou se alguem inserir com ele desabilitado —, um `user` com `marca_id`
 * preenchido apareceria na equipe do revendedor e poderia ser apagado por ele.
 * Duas condicoes custam nada e a segunda e a que continua valendo se a primeira
 * garantia sumir.
 */
function daEquipe(marcaId: number) {
  return and(eq(users.marcaId, marcaId), eq(users.role, PAPEL_DO_REVENDEDOR));
}

export async function equipeDaMarca(marcaId: number): Promise<MembroDaEquipe[]> {
  return db.select(COLUNAS_DO_MEMBRO).from(users).where(daEquipe(marcaId)).orderBy(asc(users.name));
}

export async function membroDaEquipe(marcaId: number, userId: number): Promise<MembroDaEquipe | undefined> {
  const [m] = await db
    .select(COLUNAS_DO_MEMBRO)
    .from(users)
    .where(and(daEquipe(marcaId), eq(users.id, userId)));
  return m;
}

export type NovoMembro = {
  name: string;
  email: string;
  /** Hash scrypt, ja pronto. Este modulo nunca ve senha em texto. */
  passwordHash: string;
};

/**
 * Cria um membro da equipe da marca.
 *
 * `providerId: null` e `role: 'revendedor'` sao cravados aqui, e nao recebidos:
 * sao o que o CHECK do banco exige e o que define o papel. Recebe-los como
 * argumento abriria a porta para uma rota de revenda criar, por engano, um
 * `admin` de provedor.
 *
 * `emailVerified: true` porque quem cria e alguem que ja provou ser da marca —
 * nao ha e-mail de verificacao a mandar para um endereco escolhido por um
 * terceiro autenticado. `mustChangePassword: true` porque a senha inicial foi
 * digitada por OUTRA pessoa: enquanto ela valer, o autor do convite sabe a senha
 * do convidado.
 */
export async function criarMembroDaEquipe(marcaId: number, dados: NovoMembro): Promise<MembroDaEquipe> {
  const [criado] = await db
    .insert(users)
    .values({
      name: dados.name,
      email: dados.email,
      password: dados.passwordHash,
      role: PAPEL_DO_REVENDEDOR,
      marcaId,
      providerId: null,
      emailVerified: true,
      mustChangePassword: true,
    })
    .returning(COLUNAS_DO_MEMBRO);
  return criado;
}

export type ResultadoDaRemocao = "removido" | "ultimo" | "nao_encontrado";

/**
 * Remove um membro da equipe — e a regra do "ultimo" mora AQUI, nao na rota.
 *
 * Ela parece regra de negocio no lugar errado, e seria, se pudesse ser
 * verificada fora da transacao. Nao pode: dois pedidos simultaneos de remocao,
 * cada um lendo "ha 2 na equipe", apagariam os dois e deixariam a marca sem
 * ninguem que consiga entrar — e nao ha cadastro publico de revendedor para
 * refazer o acesso; so o superadmin. A contagem tem de acontecer sob o mesmo
 * lock do DELETE, e lock e coisa deste arquivo.
 *
 * O `for update` na PROPRIA equipe e o que serializa: o segundo pedido bloqueia
 * ate o primeiro terminar e, no READ COMMITTED do Postgres, reavalia as linhas
 * depois do lock — ele nao ve mais o membro que acabou de ser apagado, conta 1 e
 * recusa. Travar a linha da marca tambem funcionaria, mas travaria a edicao do
 * logo junto com a remocao de usuario, que nao tem relacao nenhuma.
 *
 * O DELETE repete `marca_id` e `role` em vez de confiar na leitura anterior:
 * entre a checagem e a escrita nada garante que a linha continua sendo a mesma,
 * e uma remocao com escopo na condicao nao tem janela entre conferir e agir.
 *
 * As SESSOES abertas do removido caem junto, na mesma transacao. Sem isso o
 * `requireAuth` — que so olha `req.session` — continuaria deixando ele navegar
 * ate o cookie vencer, 48h depois. SQL cru para a tabela `session` e a mesma
 * excecao ja documentada em `users.storage.ts:deleteUser`: ela e criada e
 * mantida pelo connect-pg-simple, nao esta em `shared/schema.ts` e por isso nao
 * existe tabela Drizzle para consultar. O id vai como parametro.
 */
export async function removerMembroDaEquipe(marcaId: number, userId: number): Promise<ResultadoDaRemocao> {
  return db.transaction(async (tx) => {
    const equipe = await tx
      .select({ id: users.id })
      .from(users)
      .where(daEquipe(marcaId))
      .for("update");

    if (!equipe.some((m) => m.id === userId)) return "nao_encontrado";
    if (equipe.length <= 1) return "ultimo";

    const apagados = await tx
      .delete(users)
      .where(and(daEquipe(marcaId), eq(users.id, userId)))
      .returning({ id: users.id });

    if (apagados.length === 0) return "nao_encontrado";

    // `->>` devolve texto e funciona tanto em `json` quanto em `jsonb`, que e o
    // que muda entre bancos criados por versoes diferentes do store.
    await tx.execute(sql`DELETE FROM "session" WHERE sess ->> 'userId' = ${String(userId)}`);
    return "removido";
  });
}

// ── A propria marca ────────────────────────────────────────────────────────

/**
 * A marca como o REVENDEDOR a enxerga.
 *
 * A lista e por extenso, e o que nao esta nela e a parte importante:
 *
 *   · `repasseRazaoSocial` / `repasseCnpj` / `repasseChavePix` / `repasseEmail`
 *     — quem recebe o dinheiro da comissao. Decisao 6 do dono: so o superadmin
 *     le e escreve. Nao sai daqui nem em leitura.
 *   · `logoSvg` / `logoPng` / `faviconSvg` / `ogImagePng` — sao arquivos
 *     inteiros em base64 numa coluna de texto. A tela precisa saber se EXISTE
 *     logo, nao carregar o logo: a imagem e servida por `/api/marca/:id/logo`,
 *     onde o navegador a cacheia e desliga script (ver marca.routes.ts). Os
 *     booleanos `temLogo`/`temFavicon`/`temOgImage` sao derivados no `select`,
 *     pelo banco, para que os bytes nao atravessem nem a conexao.
 *   · `comissaoPercentual` / `revendaAtiva` / `statusComercial` — o revendedor
 *     tem direito a esses numeros, e ele JA os recebe: eles vao no `marca` do
 *     `POST /api/auth/login` e do `GET /api/auth/me` (ver `MarcaDaSessao` em
 *     auth.routes.ts). Repetir aqui criaria uma SEGUNDA fonte para o mesmo fato,
 *     e duas fontes divergem no primeiro cache.
 *
 * `responsavelRazaoSocial` e `responsavelCnpj` ENTRAM, e nao se confundem com
 * os `repasse*`: aqueles dizem para onde vai o dinheiro da comissao; estes
 * dizem quem responde ao TITULAR pela LGPD — e e o nome que a politica publica
 * da propria marca estampa. O revendedor precisa ver o que esta publicado em
 * nome dele. Sao leitura: o `PATCH` os recusa (sao da metade do superadmin).
 */
export type MarcaDoRevendedor = {
  id: number;
  slug: string;
  ativo: boolean;
  nomeProduto: string;
  assinatura: string | null;
  dominio: string | null;
  dominioStatus: string;
  corBrand: string;
  corBrandDark: string | null;
  emailRemetente: string | null;
  emailNomeExibicao: string | null;
  suporteEmail: string | null;
  suporteWhatsapp: string | null;
  site: string | null;
  responsavelRazaoSocial: string | null;
  responsavelCnpj: string | null;
  cadastroAberto: boolean;
  landingAtiva: boolean;
  landing: unknown;
  temLogo: boolean;
  logoEhPng: boolean;
  temFavicon: boolean;
  temOgImage: boolean;
};

/**
 * Booleano vindo de EXPRESSAO SQL, e nao de coluna `boolean`.
 *
 * `Boolean(v)` seria a escolha obvia e e a errada: para o driver que devolvesse
 * o valor como texto — o que muda por versao de `pg` e por tipo derivado, nao
 * por decisao nossa — `Boolean("false")` da `true`, e "esta marca tem logo"
 * responderia sim para todo mundo, em silencio. Aqui o unico caminho para
 * `true` e um valor que significa verdadeiro.
 */
function comoBooleano(v: unknown): boolean {
  return v === true || v === "t" || v === "true";
}

const COLUNAS_DA_MARCA = {
  id: marcas.id,
  slug: marcas.slug,
  ativo: marcas.ativo,
  nomeProduto: marcas.nomeProduto,
  assinatura: marcas.assinatura,
  dominio: marcas.dominio,
  dominioStatus: marcas.dominioStatus,
  corBrand: marcas.corBrand,
  corBrandDark: marcas.corBrandDark,
  emailRemetente: marcas.emailRemetente,
  emailNomeExibicao: marcas.emailNomeExibicao,
  suporteEmail: marcas.suporteEmail,
  suporteWhatsapp: marcas.suporteWhatsapp,
  site: marcas.site,
  responsavelRazaoSocial: marcas.responsavelRazaoSocial,
  responsavelCnpj: marcas.responsavelCnpj,
  cadastroAberto: marcas.cadastroAberto,
  landingAtiva: marcas.landingAtiva,
  landing: marcas.landing,
  temLogo: sql<boolean>`(${marcas.logoSvg} is not null or ${marcas.logoPng} is not null)`.mapWith(comoBooleano),
  logoEhPng: sql<boolean>`(${marcas.logoSvg} is null and ${marcas.logoPng} is not null)`.mapWith(comoBooleano),
  temFavicon: sql<boolean>`(${marcas.faviconSvg} is not null)`.mapWith(comoBooleano),
  temOgImage: sql<boolean>`(${marcas.ogImagePng} is not null)`.mapWith(comoBooleano),
} as const;

export async function marcaDoRevendedor(marcaId: number): Promise<MarcaDoRevendedor | undefined> {
  const [m] = await db.select(COLUNAS_DA_MARCA).from(marcas).where(eq(marcas.id, marcaId));
  return m;
}

/**
 * Exatamente o que o revendedor pode GRAVAR na propria marca.
 *
 * Este tipo e a segunda barreira, e ela e de COMPILACAO. A primeira e o zod
 * `.strict()` da rota, que recusa chave desconhecida em tempo de execucao; se
 * um dia alguem passar o corpo do PATCH adiante sem parsear — o jeito classico
 * de o buraco aparecer —, o `tsc` recusa o objeto por causa deste tipo.
 *
 * Por isso `atualizarMarcaDoRevendedor` NAO aceita `Partial<InsertMarca>`, que
 * e o que `storage.updateMarca` aceita: aquele tipo admite `repasseChavePix`,
 * `comissaoPercentual`, `dominio` e `slug`, e a diferenca entre uma rota segura
 * e um vazamento seria uma linha de `...spread`.
 */
export type CamposEditaveisPeloRevendedor = Partial<{
  nomeProduto: string;
  assinatura: string | null;
  corBrand: string;
  corBrandDark: string | null;
  emailNomeExibicao: string | null;
  suporteEmail: string | null;
  suporteWhatsapp: string | null;
  site: string | null;
  cadastroAberto: boolean;
  landingAtiva: boolean;
  landing: ConteudoDaLandingBruto;
  logoSvg: string | null;
  logoPng: string | null;
  faviconSvg: string | null;
  ogImagePng: string | null;
}>;

/**
 * Grava e devolve a marca ja projetada.
 *
 * `where` pelo id da SESSAO, sempre. Nao ha versao desta funcao que receba o id
 * do corpo do pedido.
 *
 * Quem chama e obrigado a chamar `esquecerMarcas()` depois: a resolucao
 * host -> marca e cacheada por 5 minutos e e prova de login (ver
 * `hostPertenceAMarca`). Nao chamo aqui de proposito — o cache e do
 * `marca.service`, e um modulo de dados que invalida cache de servico esconde a
 * dependencia de quem le a rota.
 */
export async function atualizarMarcaDoRevendedor(
  marcaId: number,
  dados: CamposEditaveisPeloRevendedor,
): Promise<MarcaDoRevendedor | undefined> {
  const [m] = await db
    .update(marcas)
    .set(dados)
    .where(eq(marcas.id, marcaId))
    .returning(COLUNAS_DA_MARCA);
  return m;
}
