import { eq, sql, inArray, and } from "drizzle-orm";
import { db } from "../db";
import { cnpjCru } from "@shared/cnpj";
import {
  providers, users, customers, contracts, invoices, equipment,
  ispConsultations, spcConsultations, antiFraudAlerts,
  supportThreads, supportMessages, planChanges, providerInvoices,
  creditOrders, providerDocuments, providerPartners,
  erpIntegrations, erpSyncLogs, acessosSuporte,
  type Provider, type InsertProvider, type ErpIntegration,
} from "@shared/schema";

/**
 * Sem nenhum campo de ERP, de proposito.
 *
 * Ate 03/09/2026 este tipo carregava `erpSource`, `erpUrl`, `erpEnabled` e um
 * `erpToken` no formato `usuario:token` — ja DECIFRADO. O objeto inteiro vai no
 * `res.json` de GET /api/admin/providers, que nao esta em SENSITIVE_ROUTES, e o
 * middleware de log grava o corpo: `sanitizeForLog` censura por NOME de chave e
 * nunca ouviu falar de "erpToken". Resultado: a credencial de ERP de todo
 * provedor com integracao ligada ficava legivel no log a cada abertura do painel
 * do superadmin. E o incidente de 27/08/2026 outra vez, sob outro nome de chave.
 *
 * A aba ERP do ProviderDrawer era o unico consumidor e saiu com a mudanca que
 * moveu a configuracao para /admin/provedor/:id. Quem precisa de ERP le
 * `erp_integrations` pelas rotas proprias — que decifram sob demanda, para um
 * unico provedor, e nao para a lista inteira.
 */
/**
 * Codigo da recusa, para quem chama distinguir "nao deu" de "nao pode".
 *
 * A rota do superadmin hoje converte qualquer excecao em 500 com
 * `getSafeErrorMessage`, que em producao devolve "Erro interno do servidor" — a
 * recusa chegaria ao superadmin com cara de defeito, e defeito e o tipo de coisa
 * que se tenta de novo. Nao e defeito, e decisao. O codigo fica exportado para a
 * rota poder mapea-lo em 409 com o texto certo quando alguem mexer nela.
 */
export const CODIGO_PROVEDOR_COM_TRILHA_DE_SUPORTE = "PROVEDOR_COM_TRILHA_DE_SUPORTE";

/**
 * Apagar um provedor que tem historico de acesso de suporte e RECUSADO.
 *
 * POR QUE RECUSAR, EM VEZ DE APAGAR JUNTO.
 *
 * `acessos_suporte` guarda a unica prova de que estranhos abriram o dado pessoal
 * de titulares que nunca ouviram falar do suporte: quem autorizou, quem entrou,
 * quando e por quanto tempo. Ela existe para responder a LGPD meses depois — e a
 * pergunta que chega meses depois nao e sobre o provedor, e sobre os TITULARES
 * cujo CPF, endereco e telefone foram vistos. Apagar o provedor apaga o sujeito
 * da pergunta; a pergunta continua de pe, feita por gente que nao tem nada a ver
 * com o fim do contrato entre a plataforma e o provedor. Uma trilha que some
 * junto com o que ela audita nunca foi trilha: bastaria excluir o provedor para
 * nunca ter havido acesso nenhum.
 *
 * As saidas descartadas:
 *
 *   · APAGAR a trilha junto — o conserto apressado que uma violacao de FK
 *     convida a escrever. Destroi exatamente a prova, e deixa o sistema
 *     PARECENDO auditado, que e pior do que nao ter auditoria.
 *   · ANONIMIZAR — nao ha o que anonimizar. A linha ja e so id de provedor, id
 *     de usuario e instantes; nenhum dado de titular mora nela. Zerar o
 *     `provider_id` para soltar a FK trocaria "quem olhou o dado de quem" por
 *     "alguem olhou o dado de alguem", que nao responde nada.
 *   · PRESERVAR a trilha orfa — a FK para `providers.id` nao deixa, e nao deixa
 *     de proposito (migrations/0018). Remove-la seria decidir de passagem que a
 *     trilha pode apontar para um provedor que ninguem mais consegue nomear.
 *
 * Sobra recusar, que e tambem a unica saida que um auditor aceitaria como
 * honesta: ela obriga uma PESSOA a decidir o que fazer com a prova antes de o
 * sujeito dela sumir — exportar, reter pelo prazo legal, comunicar — em vez de a
 * decisao acontecer sozinha, sem registro, dentro de um DELETE.
 */
export class ProvedorComTrilhaDeSuporteError extends Error {
  readonly codigo = CODIGO_PROVEDOR_COM_TRILHA_DE_SUPORTE;

  constructor(readonly providerId: number, readonly acessos: number) {
    super(
      `Provedor ${providerId} nao pode ser excluido: a trilha de auditoria tem ${acessos} registro(s) de acesso de suporte. ` +
      `Ela prova quem abriu o dado pessoal dos clientes deste provedor e precisa sobreviver a exclusao. ` +
      `Trate o historico primeiro (exportar e reter pelo prazo legal) e so entao remova o provedor.`,
    );
    this.name = "ProvedorComTrilhaDeSuporteError";
  }
}

export interface ProviderWithStats extends Provider {
  userCount: number;
  adminEmailVerified: boolean;
}

/**
 * A forma canonica do CNPJ: so os digitos.
 *
 * `providers.cnpj` guardava DUAS formas do mesmo dado — medido em producao em
 * 05/09/2026, quatro das seis linhas mascaradas ("23.864.873/0001-48") e duas
 * cruas ("22759562000156"). A migracao 0020 canonizou a coluna; esta funcao e o
 * outro lado do mesmo conserto, e as duas precisam existir juntas: normalizar
 * so a busca nao acharia as linhas mascaradas, e normalizar so a coluna nao
 * ajudaria quem procura digitando a mascara.
 *
 * Aguenta nulo e indefinido porque o valor vem de `req.body` em mais de um
 * caminho: o TypeScript promete `string`, o corpo de um POST nao promete nada.
 * Sem isso, um `undefined` que escape de uma rota vira TypeError dentro do
 * storage, que a rota converte em 500 — quando a resposta certa e simplesmente
 * "nao achei". Quem garante isso hoje e `cnpjCru`, em shared/cnpj.ts.
 */
export function cnpjCanonico(cnpj: string): string {
  /**
   * DELEGA para `shared/cnpj`, e não repete o `replace`.
   *
   * Esta função nasceu com um `.replace(/\D/g,"")` próprio, SEM o
   * `.slice(0, 14)` que a peça única aplica — e as duas só concordavam por
   * acidente, porque todo chamador validava 14 dígitos antes de chegar aqui.
   * No dia em que alguém consultasse com um valor não pré-validado de mais de
   * 14 dígitos, `cnpjCru` truncaria e acharia a linha, esta aqui não acharia, e
   * o cadastro concluiria "empresa nova" — que é, por outra porta, exatamente
   * o defeito que este conserto inteiro existe para fechar.
   *
   * Fica como função, em vez de os chamadores importarem `cnpjCru` direto, só
   * pelo nome: "canônico" é o que se quer dizer quando se COMPARA, e "cru" é o
   * que se quer dizer quando se GUARDA. Mesma régua, duas leituras.
   */
  return cnpjCru(cnpj);
}

export class ProvidersStorage {
  async getProvider(id: number): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.id, id));
    return provider;
  }

  /**
   * A conferencia de "esta empresa ja existe?" — a unica que impede dois
   * tenants para o mesmo CNPJ.
   *
   * Ela comparava por igualdade exata contra o que o operador digitou. Quem se
   * cadastrasse com "23864873000148" nao casava com a linha gravada como
   * "23.864.873/0001-48": a conferencia passava, o indice UNIQUE tambem nao
   * barrava (para o Postgres sao duas strings diferentes) e nascia um SEGUNDO
   * provedor para a mesma empresa — com carteira, credito e alerta de
   * anti-fraude proprios, cada metade cega para a outra.
   *
   * A normalizacao fica no ARGUMENTO, nao na coluna. `regexp_replace` no SQL
   * casaria os dois formatos sem depender da migracao, mas ao preco de duas
   * coisas: o indice de `cnpj` deixa de ser usado (a comparacao passa a ser
   * sobre uma expressao, e o scan e sequencial), e — pior — dado sujo que
   * voltasse a entrar continuaria sendo encontrado, entao ninguem descobriria
   * que voltou. Depois da migracao 0020 a coluna e canonica, entao a igualdade
   * exata volta a ser a comparacao CERTA, e nao apenas a mais rapida.
   */
  async getProviderByCnpj(cnpj: string): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.cnpj, cnpjCanonico(cnpj)));
    return provider;
  }

  async getProviderBySubdomain(subdomain: string): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.subdomain, subdomain));
    return provider;
  }

  async createProvider(provider: InsertProvider): Promise<Provider> {
    const [created] = await db.insert(providers).values(provider).returning();
    return created;
  }

  async updateProvider(id: number, data: Partial<Pick<Provider, "name" | "contactEmail" | "contactPhone" | "website">>): Promise<Provider> {
    const [updated] = await db.update(providers).set(data).where(eq(providers.id, id)).returning();
    return updated;
  }

  async getAllProviders(): Promise<Provider[]> {
    return db.select().from(providers);
  }

  async updateProviderCredits(id: number, ispCredits: number, spcCredits: number): Promise<void> {
    await db.update(providers).set({ ispCredits, spcCredits }).where(eq(providers.id, id));
  }

  /**
   * A pergunta vem ANTES do primeiro DELETE, e isso e metade do conserto.
   *
   * A sequencia abaixo nao esta em transacao: sao dezessete comandos soltos. Sem
   * esta guarda, um provedor com trilha percorria a lista inteira apagando
   * clientes, faturas, equipamentos e consultas, e so estourava a violacao de FK
   * no penultimo comando — `users`, por causa de `liberado_por`. O resultado nao
   * seria "nao apagou": seria um provedor esvaziado, ainda vivo, com um 500 na
   * tela e o dado ja perdido. Perguntar primeiro custa uma consulta e deixa o
   * provedor exatamente como estava.
   */
  async deleteProvider(id: number): Promise<void> {
    const [trilha] = await db
      .select({ acessos: sql<number>`count(*)::int` })
      .from(acessosSuporte)
      .where(eq(acessosSuporte.providerId, id));

    // `count(*)` volta como string em driver de Postgres quando o ::int se
    // perde; o Number() e a rede para o caso em que "0" verdadeiro viraria um
    // valor considerado positivo por comparacao frouxa.
    const acessos = Number(trilha?.acessos ?? 0);
    if (acessos > 0) {
      throw new ProvedorComTrilhaDeSuporteError(id, acessos);
    }

    const threads = await db.select({ id: supportThreads.id }).from(supportThreads).where(eq(supportThreads.providerId, id));
    if (threads.length > 0) {
      const threadIds = threads.map(t => t.id);
      await db.delete(supportMessages).where(inArray(supportMessages.threadId, threadIds));
    }
    await db.delete(supportThreads).where(eq(supportThreads.providerId, id));
    await db.delete(invoices).where(eq(invoices.providerId, id));
    await db.delete(contracts).where(eq(contracts.providerId, id));
    await db.delete(antiFraudAlerts).where(eq(antiFraudAlerts.providerId, id));
    await db.delete(equipment).where(eq(equipment.providerId, id));
    await db.delete(customers).where(eq(customers.providerId, id));
    await db.delete(ispConsultations).where(eq(ispConsultations.providerId, id));
    await db.delete(spcConsultations).where(eq(spcConsultations.providerId, id));
    await db.delete(erpSyncLogs).where(eq(erpSyncLogs.providerId, id));
    await db.delete(erpIntegrations).where(eq(erpIntegrations.providerId, id));
    await db.delete(planChanges).where(eq(planChanges.providerId, id));
    await db.delete(providerInvoices).where(eq(providerInvoices.providerId, id));
    await db.delete(creditOrders).where(eq(creditOrders.providerId, id));
    await db.delete(providerDocuments).where(eq(providerDocuments.providerId, id));
    await db.delete(providerPartners).where(eq(providerPartners.providerId, id));
    await db.delete(users).where(eq(users.providerId, id));
    await db.delete(providers).where(eq(providers.id, id));
  }

  /**
   * SEM guarda de payload vazio aqui, DE PROPOSITO — decisao de 05/09/2026,
   * registrada para nao virarem duas guardas (nem nenhuma).
   *
   * O risco e real: `db.update().set({})` nao e um no-op, o Drizzle recusa o SET
   * vazio ("No values to set") e a rota converte a excecao em 500 — o provedor
   * clica em salvar e le "erro interno do servidor". O Drizzle descarta chave
   * com valor `undefined` antes de montar o SET, entao `{ name: undefined }`
   * chega tao vazio quanto `{}`.
   *
   * A guarda mora na ROTA (`PATCH /api/provider/profile`, que separa "nao chegou
   * nada" -> 400 de "nada mudou" -> devolve a linha atual). Duas razoes:
   *
   *   · So ela pode receber payload vazio. Sao cinco chamadores; os outros
   *     quatro (anti-fraude, regionalizacao, localizacao, alert-settings) montam
   *     o objeto no codigo, com chave sempre presente e valor sempre definido —
   *     `webhookUrl || null` e `enabled === true` nunca produzem `undefined`,
   *     conferido um por um. Para eles, `{}` seria erro de programacao, e erro
   *     de programacao deve estourar, nao virar um no-op que responde "salvo".
   *   · So a rota consegue distinguir os dois vazios. Daqui, "nao chegou nada"
   *     e "nada mudou" sao o mesmo objeto, e responder a ambos com a linha atual
   *     esconderia um formulario quebrado atras de um 200.
   *
   * Se aquela guarda sair da rota, esta decisao muda junto: sem ela, o caminho
   * volta a terminar em 500.
   */
  async updateProviderProfile(id: number, data: Partial<Provider>): Promise<Provider> {
    const [updated] = await db.update(providers).set(data as any).where(eq(providers.id, id)).returning();
    return updated;
  }

  async getProviderWebhookToken(providerId: number): Promise<string> {
    const [provider] = await db.select({ webhookToken: providers.webhookToken }).from(providers).where(eq(providers.id, providerId));
    if (provider?.webhookToken) return provider.webhookToken;
    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    await db.update(providers).set({ webhookToken: token } as any).where(eq(providers.id, providerId));
    return token;
  }

  async regenerateWebhookToken(providerId: number): Promise<string> {
    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    await db.update(providers).set({ webhookToken: token } as any).where(eq(providers.id, providerId));
    return token;
  }

  async getProviderByWebhookToken(token: string): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(sql`${providers.webhookToken} = ${token}`);
    return provider;
  }

  async debitIspCredits(id: number, cost: number): Promise<Provider | null> {
    const result = await db.execute(sql`UPDATE providers SET isp_credits = isp_credits - ${cost} WHERE id = ${id} AND isp_credits >= ${cost} RETURNING *`);
    const rows = result.rows as Provider[];
    return rows.length > 0 ? rows[0] : null;
  }

  async debitSpcCredits(id: number, cost: number): Promise<Provider | null> {
    // Sistema unificado: SPC consome de isp_credits (4 creditos por consulta)
    const result = await db.execute(sql`UPDATE providers SET isp_credits = isp_credits - ${cost} WHERE id = ${id} AND isp_credits >= ${cost} RETURNING *`);
    const rows = result.rows as Provider[];
    return rows.length > 0 ? rows[0] : null;
  }

  async getAllProvidersWithStats(): Promise<ProviderWithStats[]> {
    // Query 1: all providers
    const allProviders = await db.select().from(providers);

    // Query 2: user counts and admin email verification per provider
    const userStats = await db.execute(sql`
      SELECT
        provider_id,
        COUNT(*)::int AS user_count,
        MAX(CASE WHEN role = 'admin' THEN CASE WHEN email_verified THEN 1 ELSE 0 END END) AS admin_email_verified
      FROM users
      WHERE provider_id IS NOT NULL
      GROUP BY provider_id
    `);
    const userStatsMap = new Map<number, { userCount: number; adminEmailVerified: boolean }>();
    for (const row of userStats.rows as any[]) {
      userStatsMap.set(row.provider_id, {
        userCount: row.user_count || 0,
        adminEmailVerified: row.admin_email_verified === 1,
      });
    }

    // `erp_integrations` NAO e lida aqui: nenhum campo dela sobrevive no
    // retorno, e decifrar credencial que ninguem consome e so risco.
    return allProviders.map(p => {
      const stats = userStatsMap.get(p.id);
      return {
        ...p,
        userCount: stats?.userCount || 0,
        adminEmailVerified: stats?.adminEmailVerified || false,
      };
    });
  }

}
