import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  providers, erpIntegrations, erpSyncLogs, erpCatalog,
  type ErpIntegration, type ErpSyncLog,
  type ErpCatalog, type InsertErpCatalog,
} from "@shared/schema";
import { encryptField, decryptField } from "../utils/crypto";
import { logger } from "../logger";

const SENSITIVE_FIELDS = ["apiToken", "apiUser", "clientSecret", "mkContraSenha"] as const;

function encryptSensitiveFields(data: Partial<ErpIntegration>): Partial<ErpIntegration> {
  const result = { ...data };
  for (const field of SENSITIVE_FIELDS) {
    if (field in result && typeof (result as any)[field] === "string") {
      (result as any)[field] = encryptField((result as any)[field]);
    }
  }
  return result;
}

function decryptIntegration(row: ErpIntegration): ErpIntegration {
  const result = { ...row };
  for (const field of SENSITIVE_FIELDS) {
    if (typeof (result as any)[field] === "string") {
      (result as any)[field] = decryptField((result as any)[field]);
    }
  }
  return result;
}

/**
 * Decifra sem deixar uma linha ruim derrubar as outras.
 *
 * A chave sai do SESSION_SECRET (ver server/utils/crypto.ts). Se ele mudar —
 * troca de servidor, restauracao de backup de outro ambiente — o AES-GCM nao
 * so devolve lixo: ele LANCA na verificacao da tag. Como a leitura era um
 * `rows.map(decryptIntegration)` cru, a primeira credencial ilegivel abortava a
 * lista inteira, e o sync de TODOS os provedores morria por causa de um.
 * Agora a linha problematica sai da lista e diz qual e, no log.
 */
function decryptIntegrationSafe(
  row: ErpIntegration,
): { ok: true; value: ErpIntegration } | { ok: false; motivo: string } {
  try {
    return { ok: true, value: decryptIntegration(row) };
  } catch (err: any) {
    return { ok: false, motivo: err?.message || "falha ao decifrar" };
  }
}

/**
 * O que o PROVEDOR pode ver de uma integracao: estado e contadores, nunca
 * credencial.
 *
 * Existe porque `getErpIntegrations` devolve a linha inteira ja DECIFRADA, e a
 * rota do painel jogava isso direto no `res.json()` — token, usuario, segredo
 * de OAuth e contra-senha do MK viajavam em texto claro ate o navegador de
 * qualquer operador. A configuracao passou a ser do superadmin; o provedor so
 * confere se esta integrado e se o ultimo sync deu certo.
 *
 * `syncIntervalHours` NAO entra aqui, embora a coluna exista e o superadmin
 * possa grava-la: nenhum agendador a le. A cadencia real vem de
 * server/services/erp-agenda.ts (seg/qua/sex as 03:00). Publicar "intervalo 12h"
 * seria publicar um numero que codigo nenhum honra, e o provedor ficaria
 * esperando um sync naquela hora.
 */
/**
 * A linha inteira, decifrada, mais a marca de credencial que nao abriu — o que
 * a tela de configuracao do superadmin precisa para dizer "redigite esta" em
 * vez de mostrar um campo vazio que parece nunca ter sido preenchido.
 */
export type IntegracaoAdminErp = ErpIntegration & { credencialIlegivel: boolean };

export interface ResumoErp {
  erpSource: string;
  isEnabled: boolean;
  configurado: boolean;
  status: string;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  totalSynced: number;
  totalErrors: number;
}

export class ErpStorage {
  /**
   * Resumo por provedor — sem decifrar nada.
   *
   * `apiUrl` e `apiToken` entram no SELECT so para responder "esta
   * configurado?", e morrem dentro desta funcao: o que sai e um booleano. E um
   * E logico, nunca OU — meia credencial nao conecta em ERP nenhum, e dizer
   * "integrado" com so um dos dois manda o provedor esperar um sync que nunca
   * vai acontecer.
   */
  async getErpIntegracoesResumo(providerId: number): Promise<ResumoErp[]> {
    const rows = await db.select({
      erpSource: erpIntegrations.erpSource,
      isEnabled: erpIntegrations.isEnabled,
      status: erpIntegrations.status,
      lastSyncAt: erpIntegrations.lastSyncAt,
      lastSyncStatus: erpIntegrations.lastSyncStatus,
      totalSynced: erpIntegrations.totalSynced,
      totalErrors: erpIntegrations.totalErrors,
      apiUrl: erpIntegrations.apiUrl,
      apiToken: erpIntegrations.apiToken,
    }).from(erpIntegrations)
      .where(eq(erpIntegrations.providerId, providerId))
      .orderBy(erpIntegrations.erpSource);

    return rows.map(({ apiUrl, apiToken, ...resto }) => ({
      ...resto,
      configurado: !!apiUrl && !!apiToken,
    }));
  }

  /**
   * Corte automatico: 3 falhas seguidas pausam a integracao.
   *
   * Sem isto o provedor nao teria freio nenhum depois que a configuracao saiu
   * do painel dele — o ERP cai, o scheduler continua batendo de hora em hora, e
   * o historico enche de erro identico ate alguem reparar. `pausado_por_falhas`
   * e o unico status novo da coluna, e distingue "eu desliguei" de "o sistema
   * desligou por mim".
   */
  async pausarPorFalhas(providerId: number, erpSource: string): Promise<void> {
    await db.update(erpIntegrations)
      .set({ isEnabled: false, status: "pausado_por_falhas" })
      .where(and(eq(erpIntegrations.providerId, providerId), eq(erpIntegrations.erpSource, erpSource)));
  }

  async getErpIntegrations(providerId: number): Promise<ErpIntegration[]> {
    const rows = await db.select().from(erpIntegrations)
      .where(eq(erpIntegrations.providerId, providerId))
      .orderBy(erpIntegrations.erpSource);
    return rows.map(decryptIntegration);
  }

  /**
   * A leitura da tela de configuracao do superadmin — a unica em que uma
   * credencial ilegivel nao pode derrubar a lista.
   *
   * `getErpIntegrations` decifra com `decryptIntegration`, que LANCA quando a
   * chave nao abre. Uma unica linha assim fazia a aba de integracao responder
   * 500 por inteiro: nem as linhas sadias, nem o formulario. E justamente a
   * tela que existe para redigitar a credencial quebrada, entao o unico caminho
   * de conserto morria pelo defeito que ele conserta.
   *
   * A linha problematica volta com os segredos em branco e `credencialIlegivel`
   * ligado. Campo vazio sem marca seria pior que o 500: o operador salvaria por
   * cima achando que nunca houve nada, e como `preservarSegredosVazios` trata
   * segredo vazio como "nao mexe", o valor podre continuaria la. O texto
   * cifrado tampouco sobe — nao serve de nada no navegador e e segredo.
   */
  async getErpIntegracoesParaAdmin(providerId: number): Promise<IntegracaoAdminErp[]> {
    const rows = await db.select().from(erpIntegrations)
      .where(eq(erpIntegrations.providerId, providerId))
      .orderBy(erpIntegrations.erpSource);

    return rows.map(row => {
      const d = decryptIntegrationSafe(row);
      if (d.ok) return { ...d.value, credencialIlegivel: false };

      logger.error(
        { providerId, erpSource: row.erpSource, motivo: d.motivo },
        "[ERP] credencial ilegivel na tela do superadmin — precisa ser redigitada. A chave deriva do SESSION_SECRET e ele mudou desde que o token foi salvo.",
      );
      const semSegredos = { ...row } as any;
      for (const campo of SENSITIVE_FIELDS) semSegredos[campo] = null;
      return { ...semSegredos, credencialIlegivel: true } as IntegracaoAdminErp;
    });
  }

  async getAllEnabledErpIntegrationsWithCredentials(): Promise<Array<ErpIntegration & { providerName: string }>> {
    const rows = await db
      .select()
      .from(erpIntegrations)
      .innerJoin(providers, eq(erpIntegrations.providerId, providers.id))
      .where(
        and(
          eq(erpIntegrations.isEnabled, true),
          sql`${erpIntegrations.apiUrl} IS NOT NULL AND ${erpIntegrations.apiUrl} != ''`,
          sql`${erpIntegrations.apiToken} IS NOT NULL AND ${erpIntegrations.apiToken} != ''`,
        )
      )
      .orderBy(erpIntegrations.providerId, erpIntegrations.erpSource);

    const saida: Array<ErpIntegration & { providerName: string }> = [];
    for (const r of rows) {
      const d = decryptIntegrationSafe(r.erp_integrations);
      if (!d.ok) {
        logger.error(
          { providerId: r.erp_integrations.providerId, erpSource: r.erp_integrations.erpSource, motivo: d.motivo },
          "[ERP] credencial ilegivel — integracao ignorada. Reconfigure o token: a chave deriva do SESSION_SECRET e ele mudou desde que o token foi salvo.",
        );
        continue;
      }
      saida.push({ ...d.value, providerName: r.providers.name });
    }
    return saida;
  }

  /**
   * Campo de segredo em branco significa "nao mexe", nunca "apaga".
   *
   * A tela renderiza os segredos em campo `type=password`. Quando um deles chega
   * vazio — porque o valor estava guardado sob outro nome, porque o navegador
   * nao preencheu, ou porque o operador so queria trocar o campo ao lado — o
   * Salvar mandava string vazia e zerava a credencial que estava funcionando.
   * O estrago aparece so no proximo sync, horas depois, como falha de
   * autenticacao sem causa aparente.
   *
   * Para limpar uma credencial de proposito, desabilite a integracao.
   */
  private preservarSegredosVazios(
    data: Partial<ErpIntegration>,
    atual: ErpIntegration,
  ): Partial<ErpIntegration> {
    const saida = { ...data };
    for (const campo of SENSITIVE_FIELDS) {
      const novo = (saida as any)[campo];
      const tinha = (atual as any)[campo];
      if (campo in saida && (novo === "" || novo === null) && tinha) {
        delete (saida as any)[campo];
      }
    }
    return saida;
  }

  async upsertErpIntegration(providerId: number, erpSource: string, data: Partial<ErpIntegration>): Promise<ErpIntegration> {
    const existing = await db.select().from(erpIntegrations)
      .where(and(eq(erpIntegrations.providerId, providerId), eq(erpIntegrations.erpSource, erpSource)))
      .limit(1);
    if (existing.length > 0) {
      const encrypted = encryptSensitiveFields(
        this.preservarSegredosVazios(data, existing[0]),
      );
      const [updated] = await db.update(erpIntegrations)
        .set(encrypted as any)
        .where(and(eq(erpIntegrations.providerId, providerId), eq(erpIntegrations.erpSource, erpSource)))
        .returning();
      return decryptIntegration(updated);
    }
    const [created] = await db.insert(erpIntegrations)
      .values({ providerId, erpSource, ...encryptSensitiveFields(data) } as any)
      .returning();
    return decryptIntegration(created);
  }

  async incrementErpIntegrationCounters(providerId: number, erpSource: string, upserted: number, errors: number): Promise<void> {
    await db.execute(sql`
      UPDATE erp_integrations
      SET total_synced = total_synced + ${upserted},
          total_errors = total_errors + ${errors}
      WHERE provider_id = ${providerId} AND erp_source = ${erpSource}
    `);
  }

  /**
   * Grava o desfecho de UMA sincronizacao: carimba a integracao e deixa a linha
   * no historico, numa transacao so.
   *
   * Existe porque ate aqui nada registrava sync nenhum — `erp_sync_logs` e os
   * contadores de `erp_integrations` estavam no schema e sem um unico chamador.
   * A tela mostrava "0 registros · Nunca" por construcao, entao um sync que
   * falhava todo dia era indistinguivel de um sync que nunca tinha sido
   * configurado. Sem isto nao ha como responder "o ERP atualizou hoje?".
   */
  async registrarResultadoSync(
    providerId: number,
    erpSource: string,
    r: {
      status: "success" | "partial" | "error";
      upserted: number;
      errors: number;
      recordsProcessed?: number;
      syncType?: "auto" | "manual";
      mensagem?: string;
      duracaoMs?: number;
    },
  ): Promise<void> {
    await db.transaction(async (tx) => {
      // `status` e o ESTADO da integracao; `last_sync_status` e o DESFECHO da
      // ultima varredura. Colapsar os dois foi o que apagou a unica marca que
      // separa "o sistema cortou" de "alguem desligou": `pausarPorFalhas`
      // escrevia `pausado_por_falhas` em `status` e a varredura seguinte —
      // qualquer uma, ate a que falhou — reescrevia por cima com 'error'/'idle'.
      // O desfecho continua sendo gravado sempre; so a marca de corte e
      // preservada, e quem a limpa e a religada do superadmin.
      await tx.execute(sql`
        UPDATE erp_integrations
           SET total_synced     = total_synced + ${r.upserted},
               total_errors     = total_errors + ${r.errors},
               last_sync_at     = NOW(),
               last_sync_status = ${r.status},
               status           = CASE WHEN status = 'pausado_por_falhas'
                                       THEN status
                                       ELSE ${r.status === "error" ? "error" : "idle"}
                                  END
         WHERE provider_id = ${providerId} AND erp_source = ${erpSource}
      `);
      await tx.insert(erpSyncLogs).values({
        providerId,
        erpSource,
        // `syncedAt` explicito, e nao o defaultNow() da coluna.
        //
        // As colunas sao `timestamp` SEM fuso. O Drizzle serializa um Date de JS
        // como hora UTC e rele como UTC — fecha certo. Ja o defaultNow() grava a
        // hora LOCAL do Postgres (America/Sao_Paulo), que o Drizzle depois
        // interpreta como UTC: o valor volta 3 horas no passado.
        //
        // Medido na VPS em 27/08/2026, a mesma linha pelos dois caminhos:
        //   drizzle (defaultNow): 2026-08-27T16:43:16Z -> "ha 3.05h"
        //   pg cru              : 2026-08-27T19:43:16Z -> "ha 0.05h"
        // Um sync recem-terminado aparecia com 3h de idade, e a janela de 12h
        // do `precisaSincronizarNoBoot` valia 9h na pratica.
        //
        // customers.lastSyncAt nao tem o problema porque e escrito por JS
        // (`lastSyncAt: now`). Escrever igual aqui alinha os dois.
        syncedAt: new Date(),
        status: r.status,
        upserted: r.upserted,
        errors: r.errors,
        recordsProcessed: r.recordsProcessed ?? r.upserted + r.errors,
        recordsFailed: r.errors,
        syncType: r.syncType ?? "auto",
        payload: { mensagem: r.mensagem ?? null, duracaoMs: r.duracaoMs ?? null },
      } as any);
    });
  }

  /**
   * Falhas CONSECUTIVAS de uma integracao — quantas vezes seguidas, contando da
   * mais recente para tras, o sync terminou em erro. Uma falha isolada e ruido
   * de rede; trinta seguidas e uma integracao morta que ninguem viu, porque
   * cada log e igual ao anterior e some no meio dos outros.
   */
  async contarFalhasConsecutivas(providerId: number, erpSource: string): Promise<number> {
    const linhas = await db.select({ status: erpSyncLogs.status })
      .from(erpSyncLogs)
      .where(and(eq(erpSyncLogs.providerId, providerId), eq(erpSyncLogs.erpSource, erpSource)))
      .orderBy(desc(erpSyncLogs.syncedAt))
      .limit(100);
    let n = 0;
    for (const l of linhas) {
      if (l.status !== "error") break;
      n++;
    }
    return n;
  }

  /**
   * Marca no historico que o superadmin religou a integracao.
   *
   * Existe para ZERAR a contagem de falhas, nao para enfeitar o log:
   * `contarFalhasConsecutivas` anda do mais recente para tras e para na primeira
   * linha que nao e 'error'. Sem uma linha de parada, as tres falhas que
   * causaram o corte continuam no topo do historico — a integracao religada
   * cairia de novo na PRIMEIRA falha seguinte, e a tolerancia de 3 viraria 1
   * para sempre depois do primeiro corte. De brinde fica o rastro de quando
   * alguem religou.
   *
   * `syncType` e 'manual' porque foi gente que fez. E por isso que
   * `contarFalhasConsecutivas` nao pode filtrar por syncType: a linha de parada
   * e justamente uma linha manual.
   */
  async registrarReativacao(providerId: number, erpSource: string): Promise<void> {
    await db.insert(erpSyncLogs).values({
      providerId,
      erpSource,
      // Explicito, e nao o defaultNow() da coluna — mesmo motivo detalhado em
      // `registrarResultadoSync`: defaultNow() grava hora local e o Drizzle rele
      // como UTC, jogando a linha 3h para tras. Uma reativacao com carimbo
      // antigo pode ficar ABAIXO das falhas que ela deveria interromper.
      syncedAt: new Date(),
      status: "reativado",
      upserted: 0,
      errors: 0,
      recordsProcessed: 0,
      recordsFailed: 0,
      syncType: "manual",
      payload: { mensagem: "Integracao reativada pelo superadmin" },
    } as any);
  }

  /**
   * Quando alguem sincronizou com sucesso pela ultima vez, em toda a plataforma.
   *
   * Serve ao scheduler para nao repetir a varredura completa a cada restart do
   * worker, e — pelo mesmo criterio, de graca — para recuperar a noite em que o
   * processo estava fora do ar as 03:00: nesse caso o ultimo sucesso tem mais de
   * 24h e o boot sincroniza.
   *
   * "partial" conta como sucesso: gravou a maior parte da carteira, e repetir a
   * varredura inteira por causa de algumas linhas custa mais do que corrige.
   *
   * O filtro e uma LISTA BRANCA, e e o que segura 'reativado' fora daqui: uma
   * reativacao nao leu um unico registro do ERP. Se ela contasse como sucesso, o
   * boot logo depois de religar concluiria que a plataforma acabou de
   * sincronizar e pularia a varredura — deixando a integracao recem-religada sem
   * dado novo ate a proxima janela.
   */
  async ultimoSyncBemSucedido(): Promise<Date | null> {
    const [linha] = await db.select({ quando: erpSyncLogs.syncedAt })
      .from(erpSyncLogs)
      .where(sql`${erpSyncLogs.status} IN ('success','partial')`)
      .orderBy(desc(erpSyncLogs.syncedAt))
      .limit(1);
    return linha?.quando ?? null;
  }

  async getErpSyncLogs(providerId: number, erpSource?: string, limit = 50): Promise<ErpSyncLog[]> {
    const conditions = [eq(erpSyncLogs.providerId, providerId)];
    if (erpSource) conditions.push(eq(erpSyncLogs.erpSource, erpSource));
    return db.select().from(erpSyncLogs)
      .where(and(...conditions))
      .orderBy(desc(erpSyncLogs.syncedAt))
      .limit(limit);
  }

  async createErpSyncLog(log: Omit<ErpSyncLog, "id" | "syncedAt">): Promise<ErpSyncLog> {
    const [created] = await db.insert(erpSyncLogs).values(log as any).returning();
    return created;
  }

  /**
   * Agregado. Sem `providerId` soma a plataforma inteira — e assim que o painel
   * do superadmin le, e o comportamento fica.
   *
   * O array `integrations` saiu daqui. Ele vinha de um `db.select()` cru, com o
   * token CIFRADO junto, e ia inteiro para o navegador pela rota
   * GET /api/provider/erp-integration-stats. Era a segunda porta de vazamento de
   * credencial, e a mais facil de esquecer: o nome da funcao diz "stats", nao
   * "credenciais". Quem precisa da lista chama `getErpIntegracoesResumo`.
   */
  async getErpIntegrationStats(providerId?: number): Promise<any> {
    const conditions = providerId ? [eq(erpIntegrations.providerId, providerId)] : [];
    const integrations = await db.select({
      isEnabled: erpIntegrations.isEnabled,
      totalSynced: erpIntegrations.totalSynced,
      totalErrors: erpIntegrations.totalErrors,
      lastSyncAt: erpIntegrations.lastSyncAt,
    }).from(erpIntegrations)
      .where(conditions.length ? and(...conditions) : undefined);
    const totalEnabled = integrations.filter(i => i.isEnabled).length;
    const totalSynced = integrations.reduce((s, i) => s + (i.totalSynced ?? 0), 0);
    const totalErrors = integrations.reduce((s, i) => s + (i.totalErrors ?? 0), 0);
    const lastSync = integrations.reduce((latest, i) => {
      if (!i.lastSyncAt) return latest;
      if (!latest) return i.lastSyncAt;
      return i.lastSyncAt > latest ? i.lastSyncAt : latest;
    }, null as Date | null);
    return { totalEnabled, totalSynced, totalErrors, lastSync };
  }

  async getAllErpCatalog(): Promise<ErpCatalog[]> {
    return db.select().from(erpCatalog).orderBy(erpCatalog.name);
  }

  async getErpCatalogItem(id: number): Promise<ErpCatalog | undefined> {
    const [item] = await db.select().from(erpCatalog).where(eq(erpCatalog.id, id));
    return item;
  }

  async createErpCatalogItem(data: InsertErpCatalog): Promise<ErpCatalog> {
    const [item] = await db.insert(erpCatalog).values(data).returning();
    return item;
  }

  async updateErpCatalogItem(id: number, data: Partial<InsertErpCatalog>): Promise<ErpCatalog> {
    const [item] = await db.update(erpCatalog).set(data).where(eq(erpCatalog.id, id)).returning();
    return item;
  }

  async deleteErpCatalogItem(id: number): Promise<void> {
    await db.delete(erpCatalog).where(eq(erpCatalog.id, id));
  }
}
