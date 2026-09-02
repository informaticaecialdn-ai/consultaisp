import { eq, and, or, gte, sql, ne } from "drizzle-orm";
import { db } from "../db";
import type { GeoPrecisao } from "@shared/geo-precisao";
import {
  customers,
  providers,
  type Customer, type InsertCustomer,
} from "@shared/schema";

export class CustomersStorage {
  async getCustomersByProvider(providerId: number): Promise<Customer[]> {
    return db.select().from(customers).where(eq(customers.providerId, providerId));
  }

  /**
   * Busca por documento comparando SO os digitos.
   *
   * Antes era igualdade crua: "123.283.950-74" nao encontrava "12328395074".
   * O ERP grava em um formato, o alerta em outro, e o lookup falhava em
   * silencio — quem chamava recebia lista vazia e concluia que o cliente nao
   * existia. No anti-fraude isso apagava o status do contrato e deixava passar
   * alerta de ex-cliente.
   *
   * A igualdade direta vem primeiro para aproveitar o indice quando o valor ja
   * esta limpo, que e o caso da maioria das linhas.
   */
  /**
   * Baixa a divida de quem QUITOU, na varredura da base local.
   *
   * `upsertFromErp` so roda para quem esta na lista de inadimplentes, entao quem
   * pagava nunca mais era tocado: o valor ficava parado no ultimo conhecido, e a
   * Localizacao seguia pintando de vermelho um bairro ja resolvido.
   *
   * O valor nao e inventado. A varredura acabou de ler do ERP a lista completa
   * de quem tem fatura vencida em aberto; quem esta na carteira e nao esta nessa
   * lista nao tem fatura vencida SEGUNDO O ERP. E leitura, nao deducao.
   *
   * Isto vale para a base da Localizacao e do mapa de calor. A decisao de
   * credito NAO passa por aqui: a consulta vai ao ERP ao vivo, por documento
   * (server/routes/consultas.routes.ts).
   *
   * Quatro travas para nao apagar dado bom:
   *  - lista vazia nao limpa nada. Lista vazia costuma ser fetch que falhou, e
   *    nao carteira inteira em dia;
   *  - so mexe em quem o ERP acabou de confirmar que existe (`last_sync_at >=`
   *    inicio da varredura), entao cliente que o ERP nao devolveu fica intocado;
   *  - so mexe em quem esta marcado como `overdue`;
   *  - quem o conector nao conseguiu ler entra na lista de "ainda devendo",
   *    entao um timeout nao vira baixa.
   *
   * ── EX-CLIENTE SEGUE A MESMA REGUA, E ISSO FOI MEDIDO ────────────────────
   *
   * Esta funcao ja isentou contrato cancelado. O argumento era bom no papel:
   * para quem tem contrato vigente, sumir da lista de pendentes significa que
   * pagou; para quem foi CORTADO, o provedor baixa ou escreve como perda a
   * fatura de quem ja foi embora, e ela some sem ninguem ter pago. Apagar por
   * ausencia destruiria o ativo do bureau.
   *
   * A medicao derrubou a premissa. Em 28/08/2026, cruzando a base da NsLink
   * com o que o MK lista AGORA como vencido: dos 1.255 ex-clientes com divida
   * (R$ 833.779), o MK ainda confirma 1.239 deles (R$ 827.868). A isencao
   * estava protegendo 16 clientes e R$ 5.911 — 0,7%. O ouro do bureau nao vem
   * da isencao; vem de o ERP continuar listando a divida, que e o esperado,
   * porque fatura de ex-cliente nao e baixada com a frequencia que se supunha.
   *
   * E o que a isencao guardava nao era divida preservada, era divida
   * FOSSILIZADA: entre os 16 estavam os 9 com "1 dia de atraso" que o proprio
   * codigo tinha inventado, sem nenhum caminho de correcao — ninguem some da
   * lista de pendentes por engano duas vezes.
   *
   * Decisao do dono do produto: o MK e a fonte da verdade. Se la nao consta,
   * ou se la foi atualizado, a base segue. As travas acima continuam impedindo
   * que leitura incompleta vire baixa — e sao elas, nao a isencao por status,
   * que protegem o dado bom.
   */
  async baixarDividaQuitada(
    providerId: number,
    docsAindaDevendo: string[],
    inicioDaVarredura: Date,
  ): Promise<number> {
    const docs = Array.from(new Set(
      docsAindaDevendo.map(d => (d || "").replace(/\D/g, "")).filter(Boolean),
    ));
    if (docs.length === 0) return 0;

    // `ALL(${docs})` nao funciona: o template do Drizzle expande um array JS
    // como lista de parametros, e o Postgres respondia "op ANY/ALL (array)
    // requires array on right side". Como o UPDATE inteiro estava num try/catch
    // que so logava, a baixa falhava em silencio a cada sync — divida quitada
    // continuava no bureau. Montar o ARRAY[] explicitamente resolve e mantem
    // cada documento como parametro ligado.
    const listaDocs = sql`ARRAY[${sql.join(docs.map(d => sql`${d}`), sql`, `)}]::text[]`;

    // O limiar vai como texto ISO, nao como Date.
    //
    // `last_sync_at` e `timestamp` SEM fuso e o Drizzle grava nele o
    // `toISOString()` — hora UTC. Ja um `Date` passado por `db.execute` cru e
    // serializado pelo node-postgres com o offset LOCAL. Em UTC-3 os dois
    // espacos ficam 3h defasados e a janela abre cedo demais, alcancando linhas
    // que a varredura desta rodada nao tocou — exatamente as que a trava existe
    // para proteger.
    const limiar = inicioDaVarredura.toISOString();

    const r = await db.execute(sql`
      UPDATE customers
         SET total_overdue_amount   = '0',
             max_days_overdue       = 0,
             overdue_invoices_count = 0,
             payment_status         = 'current'
       WHERE provider_id     = ${providerId}
         AND payment_status  = 'overdue'
         AND last_sync_at    >= ${limiar}::timestamp
         AND regexp_replace(cpf_cnpj, '[^0-9]', '', 'g') <> ALL(${listaDocs})
    `);
    return (r as any).rowCount ?? 0;
  }

  async getCustomerByCpfCnpj(cpfCnpj: string): Promise<Customer[]> {
    const limpo = (cpfCnpj || "").replace(/\D/g, "");
    if (!limpo) return [];
    return db.select().from(customers).where(
      or(
        eq(customers.cpfCnpj, limpo),
        sql`regexp_replace(${customers.cpfCnpj}, '[^0-9]', '', 'g') = ${limpo}`,
      ),
    );
  }

  async getCustomersByAddressHash(addressHash: string, excludeCpfCnpj?: string): Promise<Customer[]> {
    const results = await db.select().from(customers)
      .where(eq(customers.addressHash, addressHash));
    if (excludeCpfCnpj) {
      const cleanExclude = excludeCpfCnpj.replace(/\D/g, "");
      return results.filter(c => c.cpfCnpj.replace(/\D/g, "") !== cleanExclude);
    }
    return results;
  }

  async getCustomersByExactAddress(address: string, city: string, state: string | null, cep: string | null, excludeCpfCnpj: string): Promise<Customer[]> {
    if (!address || !city) return [];
    const n = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const normalAddr = n(address);
    const normalCity = n(city);
    const normalState = state ? n(state) : null;
    const normalCep = cep ? cep.replace(/\D/g, "") : null;
    const all = await db.select().from(customers);
    return all.filter(c => {
      if (!c.address || !c.city) return false;
      if (n(c.address) !== normalAddr) return false;
      if (n(c.city) !== normalCity) return false;
      if (normalState && c.state && n(c.state) !== normalState) return false;
      if (normalCep && c.cep) {
        if (c.cep.replace(/\D/g, "") !== normalCep) return false;
      }
      if (c.cpfCnpj.replace(/\D/g, "") === excludeCpfCnpj) return false;
      return true;
    });
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    const [created] = await db.insert(customers).values(customer).returning();
    return created;
  }

  /** Upsert cliente do ERP — atualiza se cpfCnpj+providerId ja existe, senao insere */
  /** Agregado lido pela consulta em rede — evita join de equipamento por busca. */
  async updateCustomerEquipmentAggregate(
    providerId: number,
    customerId: number,
    count: number,
    value: string,
  ): Promise<void> {
    await db.update(customers)
      .set({ equipmentCount: count, equipmentEstimatedValue: value })
      .where(and(eq(customers.id, customerId), eq(customers.providerId, providerId)));
  }

  async upsertFromErp(data: {
    providerId: number;
    cpfCnpj: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    addressNumber?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    cep?: string;
    latitude?: string;
    longitude?: string;
    /** De onde a coordenada veio (shared/geo-precisao.ts). So e gravada junto com ela. */
    geoPrecisao?: GeoPrecisao;
    totalOverdueAmount: number;
    maxDaysOverdue: number;
    overdueInvoicesCount: number;
    /**
     * Status do contrato no ERP — "active" (vigente), "cancelled" (ex-cliente,
     * pode ter cobranca rescisoria), "suspended".
     *
     * Ausente significa "o conector nao sabe". Em cliente que ja existe, nada e
     * escrito; so na CRIACAO cai em "active". Nao confundir com "voltou a ser
     * ativo" — foi essa confusao que deixou 659 ex-clientes cortados por calote
     * marcados como ativos na NsLink.
     */
    status?: "active" | "cancelled" | "suspended";
    /** Plano do contrato ativo (ex "Combo 800MB + Deezer"). Opcional — armazenado em campo flexivel. */
    contractPlan?: string;
    erpSource: string;
    /**
     * Spec 012.5/fix atomicidade — quando true, SÓ atualiza identidade (nome,
     * endereço, telefone) e NÃO mexe em paymentStatus, totalOverdueAmount,
     * maxDaysOverdue, riskTier. Usado pelo passo 1 do sync (fetchCustomers
     * trazendo 3130 ativos) pra evitar zerar inadimplentes existentes caso
     * o passo 2 (fetchDelinquents) falhe. Se passo 2 falha, lista anterior
     * fica intacta — estado seguro.
     */
    skipPaymentStatus?: boolean;
  }): Promise<Customer> {
    /* ULTIMA PORTA: sem documento nao entra.
       A tabela e chaveada por (providerId, cpfCnpj) e todo o bureau — consulta,
       cruzamento por endereco, anti-fraude — pergunta por documento. Uma linha
       com documento vazio nao responde a nenhuma dessas perguntas, e ainda
       colide com a proxima que chegar igual, virando um cliente Frankenstein
       que soma a divida de varias pessoas.
       Os conectores ja descartam antes (`cleanCpfCnpj` devolve vazio para o que
       nao e documento), e `aggregateByCustomer` tambem. Esta guarda existe
       porque sao 31 pontos de chamada e um deles esquecer sai caro: em
       29/08/2026 a base tinha 8.705 linhas assim, R$ 3,58 milhoes de divida
       inexistente. */
    if (!data.cpfCnpj?.trim()) {
      throw new Error("upsertFromErp: cliente sem CPF/CNPJ — linha descartada");
    }

    const existing = await db.select().from(customers)
      .where(and(
        eq(customers.cpfCnpj, data.cpfCnpj),
        eq(customers.providerId, data.providerId),
      ))
      .limit(1);

    const now = new Date();
    const riskTier = data.maxDaysOverdue > 180 ? "critical" : data.maxDaysOverdue > 90 ? "high" : data.maxDaysOverdue > 60 ? "medium" : "low";
    /**
     * "active" e default de CRIACAO, nao de atualizacao.
     *
     * Cliente novo sem status informado nasce ativo — e o palpite razoavel para
     * quem acabou de aparecer no ERP. Ja num cliente que existe, ausencia de
     * status significa "o conector nao sabe", e nao "voltou a ser ativo": ver o
     * bloco de update adiante, que so escreve quando o valor vem.
     */
    const statusInicial = data.status ?? "active";

    if (existing.length > 0) {
      // skipPaymentStatus: passo 1 da sync (fetchCustomers) atualiza só identidade
      // pra evitar zerar paymentStatus de inadimplentes caso passo 2 falhe.
      const updateFields: Record<string, any> = {
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        complement: data.complement || null,
        erpSource: data.erpSource,
        lastSyncAt: now,
      };

      // ── Campos que só são ESCRITOS, nunca apagados ────────────────────────
      //
      // Antes todos eram `data.X || null`. Duas passadas do sync leem o mesmo
      // cliente por caminhos diferentes — o passo 1 varre a carteira, o passo 2
      // detalha os inadimplentes — e cada um parseia o endereço do payload do
      // ERP à sua maneira. Quando um deles não conseguia extrair o endereço,
      // gravava null por cima do que o outro tinha enriquecido. Cliente sem
      // endereço sai da fila de plotagem e nunca mais volta ao mapa por
      // caminho nenhum.
      //
      // Com a coordenada era pior ainda: um sync em que a geocodificação
      // falhou zerava o ponto que a plotagem tinha resolvido, e a carteira
      // saía do mapa a cada passada. Ausência de dado novo não é apagamento —
      // o dado antigo continua valendo até que outro o substitua.
      const preservar: Array<[string, string | undefined]> = [
        ["address", data.address],
        ["addressNumber", data.addressNumber],
        ["neighborhood", data.neighborhood],
        ["city", data.city],
        ["state", data.state],
        ["cep", data.cep],
      ];
      for (const [campo, valor] of preservar) {
        if (valor && String(valor).trim()) updateFields[campo] = valor;
      }
      if (data.latitude && data.longitude) {
        updateFields.latitude = data.latitude;
        updateFields.longitude = data.longitude;
        // A procedencia acompanha a coordenada: trocar o ponto sem trocar a
        // origem deixaria "bairro" escrito num ponto que veio do ERP.
        updateFields.geoPrecisao = data.geoPrecisao ?? null;
      }
      /*
       * STATUS DO CONTRATO SAI DE DENTRO DO BLOCO DA DIVIDA.
       *
       * Ele morava aqui dentro, junto de totalOverdueAmount e paymentStatus, e
       * o passo 1 do sync roda com skipPaymentStatus para nao zerar divida.
       * Consequencia: `status` so era escrito para quem a busca de
       * inadimplentes devolvia, e NINGUEM podia ser rebaixado. Cliente cortado
       * por calote cujas faturas o MK ja nao lista como pendentes ficava
       * marcado ativo indefinidamente — 659 de 870 na NsLink, medido em
       * 28/08/2026 contra o Gerenciador de Contratos do proprio MK.
       *
       * Divida e status sao coisas diferentes: uma e dinheiro, a outra e
       * vinculo. Proteger a primeira nunca deveria ter congelado a segunda.
       * Agora o status e escrito sempre que o conector o INFORMA, com ou sem
       * skipPaymentStatus — e nunca quando ele nao informa.
       */
      if (data.status) updateFields.status = data.status;

      if (!data.skipPaymentStatus) {
        updateFields.totalOverdueAmount = String(data.totalOverdueAmount);
        updateFields.maxDaysOverdue = data.maxDaysOverdue;
        updateFields.overdueInvoicesCount = data.overdueInvoicesCount;
        // equipmentCount/equipmentEstimatedValue NAO entram aqui. Antes o sync
        // reescrevia 1 e "290" a cada passada, apagando o agregado real que o
        // sync de equipamento acabara de calcular.
        updateFields.paymentStatus = data.totalOverdueAmount > 0 ? "overdue" : "current";
        updateFields.riskTier = riskTier;
      }
      const [atualizado] = await db.update(customers)
        .set(updateFields)
        .where(eq(customers.id, existing[0].id))
        .returning();
      return atualizado;
    } else {
      const [criado] = await db.insert(customers).values({
        providerId: data.providerId,
        cpfCnpj: data.cpfCnpj,
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        addressNumber: data.addressNumber || null,
        complement: data.complement || null,
        neighborhood: data.neighborhood || null,
        city: data.city || null,
        state: data.state || null,
        cep: data.cep || null,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        geoPrecisao: data.latitude && data.longitude ? (data.geoPrecisao ?? null) : null,
        totalOverdueAmount: String(data.totalOverdueAmount),
        maxDaysOverdue: data.maxDaysOverdue,
        overdueInvoicesCount: data.overdueInvoicesCount,
        // Sem equipamento conhecido nao se inventa um: o agregado real e escrito
        // depois, quando o conector traz equipmentDetails.
        status: statusInicial,
        paymentStatus: data.totalOverdueAmount > 0 ? "overdue" : "current",
        riskTier,
        erpSource: data.erpSource,
        lastSyncAt: now,
      }).returning();
      return criado;
    }
  }

  /** Buscar todos os inadimplentes de todos os provedores (mapa regional) — max 365 dias */
  async getHeatmapAll(): Promise<{
    lat: number; lng: number; city: string; totalOverdueAmount: number;
    maxDaysOverdue: number; overdueCount: number; providerId: number;
  }[]> {
    const rows = await db.select().from(customers).where(and(
      eq(customers.paymentStatus, "overdue"),
      gte(customers.maxDaysOverdue, 1),
    ));
    return rows
      .filter(r => r.latitude && r.longitude && (r.maxDaysOverdue || 0) <= 365)
      .map(r => ({
        lat: parseFloat(r.latitude!),
        lng: parseFloat(r.longitude!),
        city: r.city || "",
        totalOverdueAmount: parseFloat(r.totalOverdueAmount || "0"),
        maxDaysOverdue: r.maxDaysOverdue || 0,
        overdueCount: r.overdueInvoicesCount || 1,
        providerId: r.providerId!,
      }));
  }

  /** Buscar clientes por CEP prefix (consulta endereco cross-provider) */
  async getCustomersByCepPrefix(cepPrefix: string, excludeProviderId?: number): Promise<Customer[]> {
    const all = await db.select().from(customers).where(
      eq(customers.paymentStatus, "overdue"),
    );
    const prefix = cepPrefix.replace(/\D/g, "").slice(0, 5);
    return all.filter(c => {
      if (!c.cep) return false;
      if (!c.cep.replace(/\D/g, "").startsWith(prefix)) return false;
      if (excludeProviderId && c.providerId === excludeProviderId) return false;
      return true;
    });
  }

  /**
   * Buscar inadimplentes no mesmo endereco para alerta de risco.
   * Match inteligente:
   * - CEP especifico (nao termina em 000): match por CEP + numero
   * - CEP generico (termina em 000): match por rua normalizada + numero + cidade
   */
  async getCustomersByAddressForAlert(params: {
    cep?: string;
    address?: string;
    addressNumber?: string;
    city?: string;
    excludeCpfCnpj: string;
  }): Promise<{
    cpfMasked: string;
    nomeMascarado: string;
    overdueRange: string;
    maxDaysOverdue: number;
    status: string;
    matchType: "cep_numero" | "endereco_completo";
  }[]> {
    const { cep, address, addressNumber, city, excludeCpfCnpj } = params;
    if (!addressNumber) return []; // sem numero, nao tem como identificar imovel

    const cleanExclude = excludeCpfCnpj.replace(/\D/g, "");
    const cleanCep = cep?.replace(/\D/g, "") || "";
    const isGenericCep = cleanCep.endsWith("000") || cleanCep.length < 8;

    const rows = await db.select().from(customers).where(
      eq(customers.paymentStatus, "overdue"),
    );

    const normalizeStreet = (s: string): string => {
      return s
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
        .replace(/\br\.?\s*/g, "rua ")
        .replace(/\bav\.?\s*/g, "avenida ")
        .replace(/\btv\.?\s*/g, "travessa ")
        .replace(/\bpca?\.?\s*/g, "praca ")
        .replace(/\bal\.?\s*/g, "alameda ")
        .replace(/\brod\.?\s*/g, "rodovia ")
        .replace(/\s+/g, " ")
        .trim();
    };

    const normalNum = (n: string): string => n.replace(/\D/g, "").replace(/^0+/, "");
    const queryNum = normalNum(addressNumber);
    if (!queryNum) return [];

    const matches = rows.filter(c => {
      // So conta como ocorrencia quem TEM documento.
      //
      // `cleanCpfCnpj` nao validava tamanho, e no IXC o encadeamento cai em
      // `row.documento` — que em `fn_areceber` e o numero do BOLETO. Resultado:
      // 8.693 linhas cujo "CPF" tem de 4 a 9 digitos, sem nome, todas marcadas
      // inadimplentes. Tres faturas do mesmo imovel viravam tres inadimplentes
      // distintos e o endereco saia como "possivel fraude por troca de
      // documento". A raiz esta corrigida em erp/normalize.ts, mas as linhas
      // ja gravadas so somem na proxima varredura — e ate la nao podem valer
      // como prova contra ninguem.
      const doc = c.cpfCnpj.replace(/[^0-9]/g, "");
      if (doc.length !== 11 && doc.length !== 14) return false;
      if (doc === cleanExclude) return false;
      if (!c.addressNumber) return false;
      if (normalNum(c.addressNumber) !== queryNum) return false;

      if (!isGenericCep && cleanCep.length >= 8 && c.cep) {
        // CEP especifico: match por CEP completo + numero
        return c.cep.replace(/\D/g, "") === cleanCep;
      } else {
        // CEP generico ou sem CEP: match por rua normalizada + numero + cidade
        if (!address || !city || !c.address || !c.city) return false;
        const normalAddr = normalizeStreet(address);
        const normalCAddr = normalizeStreet(c.address);
        const normalCity = city.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const normalCCity = (c.city || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        return normalAddr === normalCAddr && normalCity === normalCCity;
      }
    });

    /* Tres iniciais bastam para o provedor reconhecer o vizinho de porta sem
       receber o nome de alguem que nao e cliente dele. E menos do que a
       mascara de nome padrao do bureau, que devolve o primeiro nome inteiro. */
    const maskNome = (nome: string): string => {
      const limpo = (nome ?? "").trim();
      if (!limpo) return "Sem nome no cadastro";
      return limpo.slice(0, 3).toUpperCase() + "***";
    };

    const maskCpf = (cpf: string): string => {
      const clean = cpf.replace(/\D/g, "");
      if (clean.length === 11) return `***.${clean.slice(3, 6)}.${clean.slice(6, 9)}-**`;
      if (clean.length === 14) return `**.***.${clean.slice(5, 8)}/${clean.slice(8, 12)}-**`;
      return "***";
    };

    const overdueRange = (val: number): string => {
      if (val <= 200) return "R$ 0-200";
      if (val <= 500) return "R$ 200-500";
      if (val <= 1000) return "R$ 500-1.000";
      if (val <= 2000) return "R$ 1.000-2.000";
      return "R$ 2.000+";
    };

    return matches.map(c => ({
      cpfMasked: maskCpf(c.cpfCnpj),
      nomeMascarado: maskNome(c.name),
      overdueRange: overdueRange(parseFloat(c.totalOverdueAmount || "0")),
      maxDaysOverdue: c.maxDaysOverdue || 0,
      status: c.status === "cancelled" ? "inativo" : "inadimplente",
      matchType: (!isGenericCep && cleanCep.length >= 8) ? "cep_numero" as const : "endereco_completo" as const,
    }));
  }

  /** Tendencia — inadimplentes por mes do provedor (ultimos 6 meses) */
  async getTrend(providerId: number): Promise<{ month: string; count: number; totalOverdue: number }[]> {
    const rows = await db.select().from(customers).where(
      and(
        eq(customers.providerId, providerId),
        eq(customers.paymentStatus, "overdue"),
      ),
    );

    const now = new Date();
    const months: { month: string; count: number; totalOverdue: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
      const daysFromMonth = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      const count = rows.filter(r => (r.maxDaysOverdue || 0) >= daysFromMonth).length;
      const totalOverdue = rows
        .filter(r => (r.maxDaysOverdue || 0) >= daysFromMonth)
        .reduce((s, r) => s + parseFloat(r.totalOverdueAmount || "0"), 0);

      months.push({ month: label, count, totalOverdue });
    }

    return months;
  }

  /** Pontos para mapa de risco — agrupados por bairro+cidade, filtrado por UF do provedor.
   * Cada ponto = 1 bairro com coordenada media e tamanho proporcional a qtd de inadimplentes. */
  async getMapPoints(providerId: number): Promise<{
    lat: number; lng: number; cep5: string; city: string; count: number; totalOverdue: number; riskLevel: string;
  }[]> {
    const provRows = await db.select({ state: providers.addressState }).from(providers).where(eq(providers.id, providerId)).limit(1);
    const providerState = provRows[0]?.state?.toUpperCase() || null;

    const allRows = await db.select().from(customers).where(
      and(
        eq(customers.providerId, providerId),
        eq(customers.paymentStatus, "overdue"),
      ),
    );
    const rows = providerState
      ? allRows.filter(r => r.state && r.state.toUpperCase() === providerState)
      : allRows;

    const bairroMap = new Map<string, { lats: number[]; lngs: number[]; city: string; neighborhood: string; count: number; totalOverdue: number; totalDays: number }>();
    for (const r of rows) {
      if (!r.latitude || !r.longitude) continue;
      const lat = parseFloat(r.latitude);
      const lng = parseFloat(r.longitude);
      if (isNaN(lat) || isNaN(lng)) continue;

      const city = (r.city || "").trim();
      const neighborhood = (r.neighborhood || "").trim();
      const key = `${city.toUpperCase()}||${neighborhood.toUpperCase() || "SEM_BAIRRO"}`;

      const existing = bairroMap.get(key);
      const overdue = parseFloat(r.totalOverdueAmount || "0");
      const days = r.maxDaysOverdue || 0;
      if (existing) {
        existing.lats.push(lat);
        existing.lngs.push(lng);
        existing.count++;
        existing.totalOverdue += overdue;
        existing.totalDays += days;
      } else {
        bairroMap.set(key, { lats: [lat], lngs: [lng], city, neighborhood: neighborhood || "Sem bairro", count: 1, totalOverdue: overdue, totalDays: days });
      }
    }

    // Filtrar cidades com menos de 28 clientes no mapa
    const cityMapTotals = new Map<string, number>();
    for (const d of Array.from(bairroMap.values())) {
      const ck = d.city.toUpperCase();
      cityMapTotals.set(ck, (cityMapTotals.get(ck) || 0) + d.count);
    }

    return Array.from(bairroMap.values())
      .filter(d => (cityMapTotals.get(d.city.toUpperCase()) || 0) >= 28)
      .map(data => ({
        lat: data.lats.reduce((s, v) => s + v, 0) / data.lats.length,
        lng: data.lngs.reduce((s, v) => s + v, 0) / data.lngs.length,
        cep5: data.neighborhood,
        city: data.city,
        count: data.count,
        totalOverdue: data.totalOverdue,
        riskLevel: data.count >= 50 ? "critico" : data.count >= 20 ? "alto" : data.count >= 5 ? "medio" : "baixo",
      }));
  }

}
