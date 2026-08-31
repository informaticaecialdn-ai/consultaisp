/**
 * ERP Connector Engine — Normalization Utilities
 *
 * Shared helpers for cleaning and normalizing data from ERP APIs.
 * Used by all connector implementations to produce NormalizedErpCustomer records.
 */

import { validarCPF, validarCNPJ } from "../utils/cpf-cnpj-validator.js";
import type { NormalizedErpCustomer } from "./types.js";

/** Strip all non-digit characters from a CPF or CNPJ string */
export function cleanCpfCnpj(raw: string): string {
  const d = (raw ?? "").replace(/\D/g, "");

  /* ZERO A ESQUERDA PERDIDO. ERP que guarda documento como numero come o zero
     inicial: "04117982940" volta como "4117982940". Ate dois zeros e o caso
     normal, entao 9-10 viram CPF e 12-13 viram CNPJ. */
  const candidato =
    d.length === 11 || d.length === 14 ? d
    : d.length === 9 || d.length === 10 ? d.padStart(11, "0")
    : d.length === 12 || d.length === 13 ? d.padStart(14, "0")
    : "";

  /* O DIGITO VERIFICADOR TAMBEM E CONFERIDO.
     Tamanho certo nao faz um documento: "12345678901" tem 11 digitos e nao
     existe. Num bureau um documento que nao fecha nao identifica ninguem — e
     pior, o mesmo humano pode acabar na base duas vezes, uma com o CPF certo e
     outra com o errado, dobrando a divida dele. Foi o que aconteceu com uma
     cliente de Mandaguari, gravada como "887712059" e "00887712059", R$ 480,60
     em cada linha.
     `validarCPF`/`validarCNPJ` de proposito, e nao `validarCpfCnpj`: esta
     ultima aceita 8 digitos como CEP, que e justamente o tamanho dos numeros de
     boleto que criaram o problema abaixo. */
  if (candidato.length === 11) return validarCPF(candidato) ? candidato : "";
  if (candidato.length === 14) return validarCNPJ(candidato) ? candidato : "";

  /* NAO E DOCUMENTO. Devolver vazio faz quem chama descartar a linha, que e o
     comportamento que todos os conectores ja tem para documento ausente.
     A funcao so tirava os nao-digitos e devolvia qualquer coisa. No IXC o
     encadeamento e `row.cpf_cnpj || row.cnpj_cpf || row.documento`, e em
     `fn_areceber` o campo `documento` e o numero do BOLETO — entao fatura sem
     CPF virava um "cliente" identificado pelo numero do titulo. Medido na base
     em 29/08/2026: 8.693 linhas de `customers` com 4 a 9 digitos no campo do
     documento, todas do IXC, todas marcadas inadimplentes, 8.692 sem nome.
     Num bureau isso e grave duas vezes: sao devedores fantasma que ninguem
     consegue identificar, e eles poluem o cruzamento por endereco — tres
     faturas de R$ 122,68 do mesmo imovel apareciam como tres inadimplentes
     diferentes, virando "possivel fraude por troca de documento". */
  return "";
}

/** Strip non-digits from a CEP and pad to 8 characters */
export function cleanCep(raw: string): string {
  return raw.replace(/\D/g, "").padStart(8, "0");
}

/** Strip non-digits from a phone number */
export function cleanPhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Monta uma data local, devolvendo `null` se os numeros nao formarem esse dia.
 *
 * `new Date(2026, 12, 32)` nao falha: rola para 01/02/2027. Um vencimento
 * corrompido viraria uma data futura valida e a fatura sumiria da cobranca
 * como se estivesse no prazo.
 */
function dataLocal(ano: number, mes: number, dia: number): Date | null {
  const d = new Date(ano, mes - 1, dia);
  const bate = d.getFullYear() === ano && d.getMonth() === mes - 1 && d.getDate() === dia;
  return bate ? d : null;
}

/**
 * Dias decorridos desde o vencimento, COM SINAL — e `null` quando nao da para
 * saber (data ausente ou ilegivel).
 *
 * Existe porque `calculateDaysOverdue` colapsa tres coisas diferentes em `0`:
 * vence hoje, vence daqui a um mes, e nao sei quando vence. Quem so quer
 * medir atraso pode viver com isso; quem precisa DECIDIR se ha atraso, nao —
 * e foi assim que fatura a vencer virou inadimplencia de "1 dia".
 */
export function diasDesdeVencimento(dueDate: string | Date | null | undefined): number | null {
  if (!dueDate) return null;

  let due: Date;
  if (typeof dueDate === "string") {
    // Duas formas de data-so-dia chegam dos ERPs: DD/MM/AAAA (MK e a maioria
    // dos brasileiros) e AAAA-MM-DD. Ambas sao montadas como meia-noite LOCAL.
    //
    // A ISO precisa disso tanto quanto a BR: `new Date("2026-08-27")` e
    // meia-noite UTC, que em Brasilia ja e dia 26 — a fatura nascia com um dia
    // de atraso a mais. Sem regex de proposito: partir na barra e no traco le
    // melhor e nao esconde escape.
    // Componente de hora e cortado antes de partir. O ramo ISO ja tolerava o
    // sufixo (`new Date` cuida dele), mas o ramo BR exigia ano de 4 digitos
    // no ultimo pedaco, entao "20/08/2026 14:30" caia em `new Date(...)` e
    // virava Invalid Date. Enquanto o codigo transformava data ilegivel em
    // "1 dia de atraso" isso passava despercebido; agora ilegivel e
    // DESCARTADO, e a fatura do inadimplente sumiria da conta.
    const soData = dueDate.trim().split("T")[0].split(" ")[0];
    const barra = soData.split("/");
    const traco = soData.split("-");
    let montada: Date | null;
    if (barra.length === 3 && barra[0].length === 2 && barra[2].length === 4) {
      montada = dataLocal(Number(barra[2]), Number(barra[1]), Number(barra[0]));
    } else if (traco.length === 3 && traco[0].length === 4) {
      montada = dataLocal(Number(traco[0]), Number(traco[1]), Number(traco[2].slice(0, 2)));
    } else {
      montada = new Date(dueDate);  // formato desconhecido: entrega ao motor do V8
    }
    if (!montada) return null;
    due = montada;
  } else {
    due = dueDate;
  }
  if (isNaN(due.getTime())) return null;

  // Comparacao por DIA, nao por instante: uma fatura que vence hoje as 00:00
  // nao esta "ha algumas horas em atraso".
  const meiaNoite = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const dif = meiaNoite(new Date()) - meiaNoite(due);
  return Math.round(dif / 86_400_000);
}

/**
 * Calculate days overdue from a due date to now.
 * Returns 0 if due date is in the future or invalid.
 */
export function calculateDaysOverdue(dueDate: string | Date | null): number {
  return Math.max(0, diasDesdeVencimento(dueDate) ?? 0);
}

/**
 * Aggregate invoice-level rows into per-customer summaries.
 *
 * Groups by cpfCnpj, summing overdue amounts and taking the max days overdue.
 * The first occurrence of each customer provides name/contact fields.
 */
export function aggregateByCustomer(
  invoices: Array<{
    cpfCnpj: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    addressNumber?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    cep?: string;
    latitude?: string;
    longitude?: string;
    amount: number;
    daysOverdue: number;
    erpSource: string;
  }>,
): NormalizedErpCustomer[] {
  const map = new Map<string, NormalizedErpCustomer>();

  for (const inv of invoices) {
    const key = inv.cpfCnpj;
    const existing = map.get(key);

    if (existing) {
      existing.totalOverdueAmount += inv.amount;
      existing.maxDaysOverdue = Math.max(existing.maxDaysOverdue, inv.daysOverdue);
      existing.overdueInvoicesCount = (existing.overdueInvoicesCount ?? 0) + 1;
      // Nem toda fatura do mesmo cliente carrega a coordenada da instalacao.
      // A primeira que carregar vale — descartar por chegar na segunda linha
      // deixaria o cliente fora do mapa por acidente de ordenacao.
      if (!existing.latitude && inv.latitude && inv.longitude) {
        existing.latitude = inv.latitude;
        existing.longitude = inv.longitude;
      }
    } else {
      map.set(key, {
        cpfCnpj: inv.cpfCnpj,
        name: inv.name,
        email: inv.email,
        phone: inv.phone,
        address: inv.address,
        addressNumber: inv.addressNumber,
        neighborhood: inv.neighborhood,
        city: inv.city,
        state: inv.state,
        cep: inv.cep,
        latitude: inv.latitude,
        longitude: inv.longitude,
        totalOverdueAmount: inv.amount,
        maxDaysOverdue: inv.daysOverdue,
        overdueInvoicesCount: 1,
        erpSource: inv.erpSource,
      });
    }
  }

  return Array.from(map.values());
}
