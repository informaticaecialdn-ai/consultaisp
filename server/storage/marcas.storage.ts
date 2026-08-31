import { eq, sql, isNull, asc } from "drizzle-orm";
import { db } from "../db";
import { marcas, providers, type Marca, type InsertMarca } from "@shared/schema";
import { normalizarHost } from "../tenant";

/** Reexportado por compatibilidade: a implementacao vive em tenant.ts. */
export { normalizarHost };

/**
 * Acesso as marcas white label.
 *
 * Duas notas que valem mais que o codigo:
 *
 * 1. `getMarcaPorDominio` normaliza o host antes de comparar. O que chega em
 *    `req.hostname` vem de fora — com maiuscula, com ponto final, com porta —
 *    e um dominio que nao casa por causa de maiuscula devolve a marca ERRADA
 *    (a da plataforma) pro cliente de um revendedor.
 *
 * 2. Apagar marca NAO cascateia. Provedor com `marca_id` apontando para linha
 *    apagada quebraria a resolucao de host no login. `deleteMarca` desliga os
 *    provedores primeiro, numa transacao.
 */
export class MarcasStorage {
  async getMarca(id: number): Promise<Marca | undefined> {
    const [m] = await db.select().from(marcas).where(eq(marcas.id, id));
    return m;
  }

  async getMarcaPorSlug(slug: string): Promise<Marca | undefined> {
    const [m] = await db.select().from(marcas).where(eq(marcas.slug, slug.trim().toLowerCase()));
    return m;
  }

  /** `host` vem da requisicao: normaliza antes de comparar. Ver nota 1 da classe. */
  async getMarcaPorDominio(host: string): Promise<Marca | undefined> {
    const limpo = normalizarHost(host);
    if (!limpo) return undefined;
    const [m] = await db.select().from(marcas).where(eq(marcas.dominio, limpo));
    return m;
  }

  /**
   * Subdominio -> provedor -> marca, numa consulta so.
   *
   * Devolve undefined tanto quando o subdominio nao existe quanto quando o
   * provedor existe mas nao tem marca — nos dois casos a resposta certa e a
   * marca da plataforma, e quem chama nao precisa distinguir.
   */
  async getMarcaPorSubdominio(subdomain: string): Promise<Marca | undefined> {
    const [linha] = await db
      .select({ marca: marcas })
      .from(providers)
      .innerJoin(marcas, eq(providers.marcaId, marcas.id))
      .where(eq(providers.subdomain, subdomain.trim().toLowerCase()));
    return linha?.marca;
  }

  async getAllMarcas(): Promise<Marca[]> {
    return db.select().from(marcas).orderBy(asc(marcas.nomeProduto));
  }

  async createMarca(data: InsertMarca): Promise<Marca> {
    const [criada] = await db.insert(marcas).values(normalizar(data)).returning();
    return criada;
  }

  async updateMarca(id: number, data: Partial<InsertMarca>): Promise<Marca> {
    const [atualizada] = await db.update(marcas).set(normalizar(data)).where(eq(marcas.id, id)).returning();
    return atualizada;
  }

  /**
   * Marca o dominio como servindo HTTPS. So o operador chama, depois de
   * script/dominio-whitelabel.sh emitir o certificado — a aplicacao nao emite
   * certificado, entao ela nao pode afirmar sozinha que o dominio funciona.
   */
  async marcarDominioAtivo(id: number): Promise<Marca> {
    const [atualizada] = await db.update(marcas)
      .set({ dominioStatus: "ativo" }).where(eq(marcas.id, id)).returning();
    return atualizada;
  }

  async getProvidersPorMarca(marcaId: number) {
    return db.select({ id: providers.id, name: providers.name, subdomain: providers.subdomain })
      .from(providers).where(eq(providers.marcaId, marcaId));
  }

  /** Ver nota 2 da classe: desliga os provedores antes, na mesma transacao. */
  async deleteMarca(id: number): Promise<void> {
    await db.transaction(async tx => {
      await tx.update(providers).set({ marcaId: null }).where(eq(providers.marcaId, id));
      await tx.delete(marcas).where(eq(marcas.id, id));
    });
  }

  async setMarcaDoProvider(providerId: number, marcaId: number | null): Promise<void> {
    await db.update(providers).set({ marcaId }).where(eq(providers.id, providerId));
  }

  /** Provedores ainda sem marca — a lista que o painel oferece para vincular. */
  async getProvidersSemMarca() {
    return db.select({ id: providers.id, name: providers.name, subdomain: providers.subdomain })
      .from(providers).where(isNull(providers.marcaId));
  }
}


function normalizar<T extends Partial<InsertMarca>>(data: T): T {
  const saida: any = { ...data };
  if (typeof saida.slug === "string") saida.slug = saida.slug.trim().toLowerCase();
  if (typeof saida.dominio === "string") {
    const d = normalizarHost(saida.dominio);
    saida.dominio = d || null;   // string vazia viraria dominio "" e casaria errado
  }
  return saida;
}
