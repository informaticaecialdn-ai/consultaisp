import { eq, sql, isNull, asc, and, ne, count } from "drizzle-orm";
import { db } from "../db";
import {
  marcas,
  providers,
  users,
  marcaEventos,
  marcaPrecos,
  comissaoLancamentos,
  comissaoFechamentos,
  creditOrders,
  providerInvoices,
  visitorChats,
  titularRequests,
  type Marca,
  type InsertMarca,
} from "@shared/schema";
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
 *    provedores primeiro, numa transacao — e RECUSA quando a marca ja tem
 *    revenda de verdade pendurada nela. Ver `VinculosDaMarca`.
 */

/**
 * Recusa por EQUIPE OU COMISSAO EM ABERTO. Acionavel: existe o que fazer na
 * tela antes de tentar de novo.
 */
export const CODIGO_MARCA_COM_REVENDA = "MARCA_COM_REVENDA";

/**
 * Recusa por REGISTRO QUE PRECISA SOBREVIVER A MARCA. Nao e acionavel pela
 * tela, e o texto do 409 nao pode fingir que e.
 */
export const CODIGO_MARCA_COM_HISTORICO = "MARCA_COM_HISTORICO";

/**
 * Tudo que aponta para uma marca e nao e desfeito pelo DELETE.
 *
 * Os dois grupos existem porque as respostas sao diferentes, e um 409 que
 * misturasse os dois mandaria o superadmin procurar um botao que nao existe.
 */
export type VinculosDaMarca = {
  /** Grupo 1 — o superadmin resolve pela tela e tenta de novo. */
  usuariosRevenda: number;
  lancamentosPendentes: number;
  fechamentosNaoPagos: number;
  /**
   * Grupo 2 — registros cuja razao de ser e durar mais que a marca. Nenhuma
   * tela os remove, e nenhuma deveria.
   */
  historico: {
    eventos: number;
    precos: number;
    lancamentos: number;
    fechamentos: number;
    pedidosDeCredito: number;
    faturas: number;
    conversasDeVisitante: number;
    pedidosDeTitular: number;
  };
};

/** Soma do grupo 2 — usada so para decidir se ele bloqueia. */
export function totalDoHistorico(v: VinculosDaMarca): number {
  return Object.values(v.historico).reduce((s, n) => s + n, 0);
}

/**
 * Apagar marca com revenda pendurada e RECUSADO.
 *
 * POR QUE RECUSAR EM VEZ DE APAGAR JUNTO — o mesmo argumento de
 * `ProvedorComTrilhaDeSuporteError` (providers.storage.ts), aplicado a outro
 * dado:
 *
 *   · `marca_eventos` e a unica prova de quem, sob esta marca, suspendeu um
 *     provedor, criou acesso para um estranho ou mexeu em preco. Apagar a marca
 *     junto com a trilha dela transforma "remover a equipe e sumir com a marca"
 *     no caminho mais curto para nunca ter havido nada. Trilha que some junto
 *     com o que audita nunca foi trilha.
 *   · `credit_orders.marca_id` e `provider_invoices.marca_id` sao a FOTO da
 *     venda (decisao 7 e a nota em shared/schema.ts): e sobre eles que a
 *     comissao ja paga foi calculada. Sumir com a marca reescreveria o passado
 *     de um dinheiro que ja mudou de mao.
 *   · `comissao_lancamentos` e `comissao_fechamentos` sao o extrato que o
 *     revendedor recebeu e a NF que ele emitiu.
 *
 * As duas saidas descartadas sao as de sempre: apagar em cascata (destroi a
 * prova) e soltar a FK deixando a linha orfa (troca "a marca X fez isso" por
 * "alguem fez isso", que nao responde nada — e as FKs da migracao 0013 sao
 * NOT NULL justamente para isso nao ser possivel).
 *
 * `codigo` e nao `instanceof`: o storage e trocado por duble em teste, e erro
 * que atravessa fronteira de modulo perde a classe antes de perder o campo.
 */
export class MarcaComVinculosError extends Error {
  readonly codigo: typeof CODIGO_MARCA_COM_REVENDA | typeof CODIGO_MARCA_COM_HISTORICO;

  constructor(readonly marcaId: number, readonly vinculos: VinculosDaMarca) {
    const acionavel =
      vinculos.usuariosRevenda > 0 ||
      vinculos.lancamentosPendentes > 0 ||
      vinculos.fechamentosNaoPagos > 0;
    super(`Marca ${marcaId} nao pode ser excluida: ainda ha vinculos apontando para ela.`);
    this.name = "MarcaComVinculosError";
    this.codigo = acionavel ? CODIGO_MARCA_COM_REVENDA : CODIGO_MARCA_COM_HISTORICO;
  }
}

/**
 * ── POR QUE AS TRES FUNCOES ABAIXO NAO SAO METODOS DA CLASSE ────────────────
 *
 * A razao ORIGINAL expirou e fica registrada porque a decisao nao mudou: a
 * classe so chega as rotas pelo barril `server/storage/index.ts`, e enquanto a
 * fase 1 corria em seis frentes paralelas aquele arquivo era territorio
 * compartilhado — duas frentes editando a mesma lista de delegacoes se
 * destroem sem conflito de merge. As frentes acabaram; a integracao reviu isso
 * e MANTEVE o import direto, por um motivo que continua valendo:
 *
 * o import direto e a convencao desta area, nao a excecao. `registrarEvento
 * DaMarca` (server/services/marca-eventos.service.ts) e o modulo inteiro de
 * `server/storage/revenda.storage.ts` sao consumidos assim. Passar so estas
 * tres pelo barril deixaria o vizinho maior como o unico fora do padrao, o que
 * e menos coerente do que esta agora.
 *
 * Nada nelas guarda estado; a unica coisa que o barril acrescentaria e uma
 * segunda porta para a mesma consulta.
 */

/** Uma pessoa da equipe revendedora, como a tela do superadmin a mostra. */
export type UsuarioDaMarca = {
  id: number;
  name: string;
  email: string;
  role: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
  createdAt: Date | null;
};

/**
 * A equipe da marca.
 *
 * Colunas NOMEADAS, nunca `select()` inteiro: a linha de `users` carrega o hash
 * da senha, o token de verificacao e o de reset, e um `...resto` distraido em
 * qualquer rota futura publicaria os tres. E a razao pela qual o invariante da
 * spec proibe reaproveitar `GET /api/admin/users` aqui.
 */
export async function getUsuariosDaMarca(marcaId: number): Promise<UsuarioDaMarca[]> {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      emailVerified: users.emailVerified,
      mustChangePassword: users.mustChangePassword,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.marcaId, marcaId))
    .orderBy(asc(users.id));
}

/**
 * Quantos revendedores a marca ainda tem SEM contar um deles.
 *
 * `exceto` existe para a pergunta que a rota de remocao faz de verdade — "sobra
 * alguem depois que eu tirar este?" —, e ela precisa ser respondida no banco.
 * Contar todos e subtrair um na aplicacao daria a mesma resposta so enquanto
 * ninguem removesse dois ao mesmo tempo.
 */
export async function contarRevendedoresDaMarca(marcaId: number, exceto?: number): Promise<number> {
  const filtro = exceto === undefined
    ? and(eq(users.marcaId, marcaId), eq(users.role, "revendedor"))
    : and(eq(users.marcaId, marcaId), eq(users.role, "revendedor"), ne(users.id, exceto));
  const [linha] = await db.select({ n: count() }).from(users).where(filtro);
  return Number(linha?.n ?? 0);
}

/**
 * O que aponta para a marca hoje.
 *
 * As contagens saem do pool, e nao da transacao do DELETE: sao dez consultas
 * independentes, e em transacao elas teriam de ser sequenciais na mesma conexao
 * sem ganhar nada — a corrida que sobra (alguem cria um usuario entre a
 * contagem e o DELETE) e fechada pela propria chave estrangeira, que aborta a
 * transacao. Por isso quem chama tambem traduz o 23503.
 */
export async function contarVinculosDaMarca(marcaId: number): Promise<VinculosDaMarca> {
  const quantos = async (tabela: any, coluna: any, extra?: any) => {
    const [linha] = await db
      .select({ n: count() })
      .from(tabela)
      .where(extra ? and(eq(coluna, marcaId), extra) : eq(coluna, marcaId));
    return Number(linha?.n ?? 0);
  };

  const [
    usuariosRevenda,
    lancamentosPendentes,
    fechamentosNaoPagos,
    eventos,
    precos,
    lancamentos,
    fechamentos,
    pedidosDeCredito,
    faturas,
    conversasDeVisitante,
    pedidosDeTitular,
  ] = await Promise.all([
    contarRevendedoresDaMarca(marcaId),
    quantos(comissaoLancamentos, comissaoLancamentos.marcaId, eq(comissaoLancamentos.status, "pendente")),
    // "nao pago" e o complemento de `pago`, e nao uma lista de status. Um status
    // novo criado na fase 4 entra como bloqueio por padrao — o lado seguro.
    quantos(comissaoFechamentos, comissaoFechamentos.marcaId, ne(comissaoFechamentos.status, "pago")),
    quantos(marcaEventos, marcaEventos.marcaId),
    quantos(marcaPrecos, marcaPrecos.marcaId),
    quantos(comissaoLancamentos, comissaoLancamentos.marcaId),
    quantos(comissaoFechamentos, comissaoFechamentos.marcaId),
    quantos(creditOrders, creditOrders.marcaId),
    quantos(providerInvoices, providerInvoices.marcaId),
    quantos(visitorChats, visitorChats.marcaId),
    quantos(titularRequests, titularRequests.marcaId),
  ]);

  return {
    usuariosRevenda,
    lancamentosPendentes,
    fechamentosNaoPagos,
    historico: {
      eventos,
      precos,
      lancamentos,
      fechamentos,
      pedidosDeCredito,
      faturas,
      conversasDeVisitante,
      pedidosDeTitular,
    },
  };
}

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

  /**
   * Ver nota 2 da classe: desliga os provedores antes, na mesma transacao — e
   * so depois de conferir que nao ha revenda nem historico pendurados.
   *
   * A pergunta vem ANTES do primeiro comando, pelo mesmo motivo de
   * `deleteProvider`: o UPDATE que desvincula os provedores roda primeiro, e
   * numa violacao de FK no DELETE seguinte a transacao inteira volta atras —
   * mas o superadmin leria "Erro interno do servidor" sobre uma recusa que e
   * decisao, nao defeito. Defeito e o que se tenta de novo.
   */
  async deleteMarca(id: number): Promise<void> {
    const vinculos = await contarVinculosDaMarca(id);
    if (
      vinculos.usuariosRevenda > 0 ||
      vinculos.lancamentosPendentes > 0 ||
      vinculos.fechamentosNaoPagos > 0 ||
      totalDoHistorico(vinculos) > 0
    ) {
      throw new MarcaComVinculosError(id, vinculos);
    }

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
