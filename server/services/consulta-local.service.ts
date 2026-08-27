/**
 * Consulta na base local, antes de ir aos ERPs.
 *
 * A consulta era "ao vivo sempre": toda pergunta abria N conexoes com os ERPs
 * da regiao e esperava ate 30s cada. Funciona, mas paga o preco integral toda
 * vez — inclusive quando o sync noturno acabou de gravar a mesma resposta — e
 * falha junto com o ERP mais lento da rede.
 *
 * Aqui a base local responde primeiro. Com uma condicao que e o coracao deste
 * arquivo: **so responde se for recente**. Uma base congelada num backup antigo
 * responderia na hora, com confianca, e com dado de meses atras — que e
 * exatamente o defeito que este servico existe para nao criar. Enquanto o sync
 * estiver quebrado, `estaFresca` da falso e a consulta cai no caminho ao vivo
 * de sempre; quando o sync volta, a consulta fica instantanea sozinha.
 *
 * O retorno tem a forma de `RealtimeQueryResult[]`, a mesma que os conectores
 * devolvem, para que mascaramento LGPD, score e relatorio nao saibam de onde o
 * dado veio.
 */
import type { Customer } from "@shared/schema";
import type { RealtimeQueryResult } from "./realtime-query.service";

/**
 * Idade maxima do dado local para ele poder responder sozinho.
 *
 * 36h e deliberado: o sync roda as 03:00, entao as 02:59 do dia seguinte o dado
 * tem ~24h e continua valendo. Uma noite inteira perdida passa de 36h e empurra
 * a consulta de volta para o ERP, em vez de servir dado de anteontem calado.
 */
export const IDADE_MAXIMA_HORAS = Number(process.env.CONSULTA_LOCAL_MAX_HORAS ?? 36);

export interface ConsultaLocal {
  /** Pronto para entrar no lugar do resultado dos conectores. */
  resultados: RealtimeQueryResult[];
  /** Sync mais recente entre as linhas encontradas. */
  sincronizadoEm: Date | null;
  idadeHoras: number | null;
  /** Achou alguem E o dado esta dentro da janela. */
  estaFresca: boolean;
  /** Por que nao serviu — vai para o log, e ajuda a explicar a lentidao. */
  motivo?: "sem-registro" | "sem-carimbo" | "vencida";
}

function idadeEmHoras(d: Date, agora: number): number {
  return (agora - d.getTime()) / 3_600_000;
}

function paraResultado(
  providerId: number,
  providerName: string,
  erpSource: string,
  linhas: Customer[],
): RealtimeQueryResult {
  return {
    providerId,
    providerName,
    erpSource,
    ok: true,
    latencyMs: 0,
    customers: linhas.map(c => ({
      cpfCnpj: c.cpfCnpj,
      name: c.name,
      email: c.email ?? undefined,
      phone: c.phone ?? undefined,
      address: c.address ?? undefined,
      addressNumber: (c as any).addressNumber ?? undefined,
      complement: (c as any).complement ?? undefined,
      neighborhood: (c as any).neighborhood ?? undefined,
      city: c.city ?? undefined,
      state: c.state ?? undefined,
      cep: c.cep ?? undefined,
      latitude: c.latitude ?? undefined,
      longitude: c.longitude ?? undefined,
      status: c.status ?? undefined,
      totalOverdueAmount: Number(c.totalOverdueAmount ?? 0),
      maxDaysOverdue: Number(c.maxDaysOverdue ?? 0),
      overdueInvoicesCount: Number(c.overdueInvoicesCount ?? 0),
      planName: (c as any).contractPlan ?? undefined,
      unreturnedEquipmentCount: Number((c as any).equipmentRetidoCount ?? 0) || undefined,
      hasUnreturnedEquipment: Number((c as any).equipmentRetidoCount ?? 0) > 0 || undefined,
    })),
  };
}

/**
 * Monta a resposta local a partir das linhas ja lidas de `customers`.
 *
 * Pura de proposito — a leitura fica na rota, e a decisao de servir ou nao fica
 * aqui, testavel sem banco.
 *
 * `linhas` deve vir JA filtrada pelos provedores que o consulente pode ver:
 * este servico nao aplica isolamento multi-tenant, ele confia no chamador.
 */
export function montarConsultaLocal(
  linhas: Customer[],
  nomePorProvider: Map<number, { nome: string; erpSource: string }>,
  agora: number = Date.now(),
): ConsultaLocal {
  if (linhas.length === 0) {
    return { resultados: [], sincronizadoEm: null, idadeHoras: null, estaFresca: false, motivo: "sem-registro" };
  }

  const carimbos = linhas
    .map(c => (c as any).lastSyncAt as Date | null)
    .filter((d): d is Date => d instanceof Date);

  // Sem carimbo = veio de import CSV ou de restauracao de backup, e nao de um
  // sync. Nao da para afirmar que e recente, entao nao serve.
  if (carimbos.length === 0) {
    return { resultados: [], sincronizadoEm: null, idadeHoras: null, estaFresca: false, motivo: "sem-carimbo" };
  }

  const maisRecente = new Date(Math.max(...carimbos.map(d => d.getTime())));
  const idade = idadeEmHoras(maisRecente, agora);
  if (idade > IDADE_MAXIMA_HORAS) {
    return { resultados: [], sincronizadoEm: maisRecente, idadeHoras: idade, estaFresca: false, motivo: "vencida" };
  }

  const porProvedor = new Map<number, Customer[]>();
  for (const c of linhas) {
    const lista = porProvedor.get(c.providerId) ?? [];
    lista.push(c);
    porProvedor.set(c.providerId, lista);
  }

  const resultados: RealtimeQueryResult[] = [];
  // Array.from e nao `of porProvedor`: o target do tsconfig deste projeto nao
  // permite iterar Map direto (mesmo motivo dos erros de Set ja existentes).
  for (const [providerId, lista] of Array.from(porProvedor.entries())) {
    const meta = nomePorProvider.get(providerId);
    resultados.push(paraResultado(
      providerId,
      meta?.nome ?? `Provedor ${providerId}`,
      meta?.erpSource ?? lista[0]?.erpSource ?? "local",
      lista,
    ));
  }

  return { resultados, sincronizadoEm: maisRecente, idadeHoras: idade, estaFresca: true };
}

/** Texto curto para a tela: "sincronizado hoje as 03:12". */
export function descreverIdade(sincronizadoEm: Date | null, agora: number = Date.now()): string {
  if (!sincronizadoEm) return "origem desconhecida";
  const horas = idadeEmHoras(sincronizadoEm, agora);
  const hora = sincronizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (horas < 1) return "sincronizado agora há pouco";
  if (horas < 24) return `sincronizado hoje às ${hora}`;
  if (horas < 48) return `sincronizado ontem às ${hora}`;
  return `sincronizado há ${Math.floor(horas / 24)} dias`;
}
