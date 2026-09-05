import { eq, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  users,
  type User, type InsertUser,
} from "@shared/schema";

/**
 * A forma canonica de um e-mail de conta: sem espaco nas pontas, em minusculas.
 *
 * A parte local de um e-mail e, pela RFC, sensivel a caixa — mas nenhum
 * provedor de caixa postal em uso trata `Joao@` e `joao@` como pessoas
 * diferentes, e um sistema de login que trate e o que fabrica a segunda conta.
 * Exportada para ser conferivel em teste, junto com o filtro de telefone.
 */
export function emailCanonico(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

/**
 * `users.phone` comparado por digitos, dentro do banco.
 *
 * A coluna guarda o telefone com mascara (4 de 4 em producao em 05/09/2026), e
 * quem procura manda so digitos. Sem tirar a pontuacao dos DOIS lados, a
 * conferencia de duplicidade do cadastro passava por qualquer diferenca de
 * formatacao — e a versao anterior resolvia isso carregando a tabela inteira
 * para filtrar em memoria.
 */
export function filtroPorTelefone(digits: string) {
  return sql`regexp_replace(${users.phone}, '[^0-9]', '', 'g') = ${digits}`;
}

export class UsersStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  /**
   * E-MAIL E CHAVE DE IDENTIDADE — e chave de identidade se compara canonica.
   *
   * `users.email` e UNIQUE e e por ela que se faz login. A comparacao era
   * igualdade exata de string: "Joao@X.com" gravado no cadastro e
   * "joao@x.com" digitado no login eram duas contas diferentes para o banco —
   * a mesma classe de defeito que deixou o CNPJ do provedor em duas formas
   * (ver `cnpjCanonico` em providers.storage.ts). Medido em 05/09/2026: as 7
   * contas estao canonicas, entao o defeito era latente — e e por isso que se
   * fecha agora, antes de a primeira mista entrar.
   *
   * Normaliza-se o ARGUMENTO e a ESCRITA (`createUser`, `updateUserEmail`),
   * nunca a coluna na consulta: `lower(email)` no WHERE mataria o indice unico
   * e mascararia dado sujo que voltasse a entrar.
   */
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, emailCanonico(email)));
    return user;
  }

  /**
   * Compara por DIGITOS, no banco — e nao carregando a tabela inteira.
   *
   * A versao anterior fazia `select * from users` e filtrava em memoria: com 7
   * usuarios e invisivel, com 7 mil e um scan completo a cada cadastro novo.
   * `users.phone` e gravado com mascara (4 de 4 em producao), entao a
   * comparacao tem de tirar a pontuacao dos dois lados; nao ha indice em
   * `phone`, logo a expressao no WHERE nao perde nada que existisse.
   */
  async getUserByPhone(phone: string): Promise<User | undefined> {
    const digits = phone.replace(/\D/g, "");
    if (!digits) return undefined;
    const [user] = await db.select().from(users).where(filtroPorTelefone(digits)).limit(1);
    return user;
  }

  async getUserByVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.verificationToken, token));
    return user;
  }

  async setEmailVerified(userId: number): Promise<void> {
    await db.update(users)
      .set({ emailVerified: true, verificationToken: null, verificationTokenExpiresAt: null })
      .where(eq(users.id, userId));
  }

  async setVerificationToken(userId: number, token: string, expiresAt: Date): Promise<void> {
    await db.update(users)
      .set({ verificationToken: token, verificationTokenExpiresAt: expiresAt })
      .where(eq(users.id, userId));
  }

  async createUser(user: InsertUser): Promise<User> {
    // Um ponto so de escrita para os cinco caminhos que criam conta (cadastro
    // publico, superadmin, painel do provedor, revenda, wizard): nenhum deles
    // normalizava, e bastaria um para a chave de login nascer em duas formas.
    const [created] = await db.insert(users).values({ ...user, email: emailCanonico(user.email) }).returning();
    return created;
  }

  async getUsersByProvider(providerId: number): Promise<User[]> {
    return db.select().from(users).where(eq(users.providerId, providerId));
  }

  /**
   * Apaga o usuario E as sessoes abertas dele, na mesma transacao.
   *
   * A tela promete que "o acesso e perdido na hora" e isso era falso:
   * `requireAuth` so olha `req.session`, e a linha da sessao vive na tabela do
   * connect-pg-simple, que ninguem tocava. O excluido continuava navegando e
   * consultando ate o cookie vencer — 48h depois.
   *
   * SQL cru aqui e deliberado e e a excecao a regra do projeto: a tabela
   * `session` e criada e mantida pelo connect-pg-simple (ver server/auth.ts),
   * nao esta em shared/schema.ts e por isso nao existe tabela Drizzle para
   * consultar. O id vai como parametro, nunca interpolado.
   *
   * Nao trata a violacao de chave estrangeira: quem chama e que sabe o que
   * responder — ver DELETE /api/provider/users/:id.
   */
  async deleteUser(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(users).where(eq(users.id, id));
      // `->>` devolve texto e funciona tanto em `json` quanto em `jsonb`, que e
      // o que muda entre bancos criados por versoes diferentes do store.
      await tx.execute(sql`DELETE FROM "session" WHERE sess ->> 'userId' = ${String(id)}`);
    });
  }

  async updateUserEmail(id: number, email: string): Promise<void> {
    await db.update(users).set({ email: emailCanonico(email) }).where(eq(users.id, id));
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }
}
