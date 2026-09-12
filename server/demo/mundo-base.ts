/**
 * O mundo base da demonstração pública: cinco provedores fictícios, cada um
 * com a carteira de um provedor real (medida pelo dono, 11/09/2026 — ver
 * `.superpowers/sdd/2026-09-11-demo-sandbox/task-3-brief.md`), e a sobreposição
 * de CPFs entre vizinhos que é o que faz a consulta na rede mostrar algo: sem
 * ela, toda consulta de demonstração voltaria "nada consta".
 *
 * Consome `pessoaFicticia`/`cpfFicticio` (Tarefa 2, `./pessoas-ficticias.ts`).
 * Grava direto por `db.insert(...)`, em blocos de 500 — 7.500 clientes mais
 * faturas e equipamentos são dezenas de milhares de linhas, e uma chamada de
 * storage por linha (`storage.createCustomer` etc.) seria uma dezena de
 * milhares de idas ao banco. Isso vale também para `providers` e
 * `erp_integrations` (só 5 linhas cada, onde o custo não importaria) — por
 * uniformidade: UM caminho de escrita só neste arquivo, sem a camada de
 * storage (que criptografa segredo de ERP de verdade, LGPD/e-mail, etc. —
 * nada disso existe para o conector "demo", que não tem credencial real).
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { providers, customers, invoices, equipment, erpIntegrations } from "@shared/schema";
import type { InsertProvider, InsertCustomer, InsertInvoice, InsertEquipment, InsertErpIntegration } from "@shared/schema";
import { pessoaFicticia, cpfFicticio } from "./pessoas-ficticias";

export interface ProvedorDaDemo {
  nome: string;
  subdomain: string;
  cidade: string;
}

/**
 * Nesta ordem: `PROVEDORES_DA_DEMO[0].subdomain` PRECISA ser "rede-1" — é o
 * que o guard de idempotência verifica, e o que os testes usam como âncora.
 * Ligados em LINHA (rede-1 — rede-2 — rede-3 — rede-4 — rede-5), não em anel:
 * as pontas (rede-1, rede-5) têm UM vizinho; o meio tem DOIS. É a mesma forma
 * que faz a consulta cruzada contar uma história — vizinho perto repete
 * cliente, provedor distante não.
 */
export const PROVEDORES_DA_DEMO: ProvedorDaDemo[] = [
  { nome: "Rede Norte Conecta", subdomain: "rede-1", cidade: "Londrina" },
  { nome: "Ibiporã Telecom", subdomain: "rede-2", cidade: "Ibiporã" },
  { nome: "Cambé NetSul", subdomain: "rede-3", cidade: "Cambé" },
  { nome: "Apucarana Wireless", subdomain: "rede-4", cidade: "Apucarana" },
  { nome: "Paraná Norte Internet", subdomain: "rede-5", cidade: "Londrina" },
];

// ── Volumes (medida do dono, forma de um provedor real — 11/09/2026) ───────
const CLIENTES_POR_PROVEDOR = 1500;
const INADIMPLENTES_POR_PROVEDOR = 225; // 15%
const CANCELADOS_POR_PROVEDOR = 150; // 10%
const COM_EQUIPAMENTO_POR_PROVEDOR = 120; // 8% — sempre um ex-cliente que não devolveu a ONU
const COMPARTILHADOS_POR_ARESTA = 150; // 10% de um portfólio, por vizinhança

/**
 * Dos CPFs compartilhados com um vizinho, quantos TAMBÉM entram como
 * inadimplentes (em vez de "em dia") — é o que dá à consulta cruzada algo
 * para mostrar: o cliente que o vizinho já tem como devedor. O resto do
 * compartilhamento fica em dia, para não inflar as contagens exatas de
 * inadimplente/cancelado que o teste verifica.
 */
const COMPARTILHADOS_INADIMPLENTES_POR_ARESTA = 40;

const TAMANHO_DO_BLOCO = 500;

/** Idades de vencimento representativas — as quatro que a régua de cobrança usa (10/45/120/300) primeiro, depois uma variedade realista. */
const IDADES_DE_VENCIMENTO_REPRESENTATIVAS = [10, 45, 120, 300, 5, 20, 35, 60, 75, 90, 150, 200, 250, 15, 25];

/** Mensalidades por faixa de plano — cíclico pelo índice da pessoa, só para variedade. */
const VALORES_DE_PLANO = [79.9, 99.9, 119.9, 149.9, 199.9];

/** Estados "retido" reais do módulo de recuperação — ver `server/services/equipment-recovery-rules.ts` (`STATUS_EQUIPAMENTO_PENDENTE`). */
const STATUS_DE_EQUIPAMENTO_RETIDO = ["retido", "retirada_pendente", "nao_localizado", "em_cobranca", "not_returned"] as const;
const MARCAS_DE_EQUIPAMENTO = ["Fiberhome", "Huawei", "ZTE", "Nokia", "TP-Link", "Intelbras"] as const;
const MODELOS_POR_MARCA: Record<(typeof MARCAS_DE_EQUIPAMENTO)[number], string[]> = {
  Fiberhome: ["AN5506-04-F", "HG6145F3"],
  Huawei: ["EG8145V5", "HG8245Q2"],
  ZTE: ["F670L", "F609"],
  Nokia: ["G-140W-C", "G-240W-A"],
  "TP-Link": ["Archer VR2100", "XC220-G3v"],
  Intelbras: ["ONU 121", "ONU 132"],
};

// ── Índices de pessoa fictícia: faixas disjuntas de propósito ──────────────
// Únicos: BASE_UNICO + provedor*PASSO_UNICO + cursor (0..9999 de folga por
// provedor — o maior uso real é 1350). Arestas (compartilhamento): bem acima,
// BASE_ARESTA + aresta*PASSO_ARESTA (0..149 por aresta) — nunca colide com a
// faixa única de nenhum provedor.
const BASE_UNICO = 0;
const PASSO_UNICO = 10_000;
const BASE_ARESTA = 500_000;
const PASSO_ARESTA = 1_000;

function indicesDaAresta(aresta: number): number[] {
  const base = BASE_ARESTA + aresta * PASSO_ARESTA;
  return Array.from({ length: COMPARTILHADOS_POR_ARESTA }, (_, k) => base + k);
}

/** As arestas (0..3) que tocam este provedor — linha, não anel: ponta tem uma, meio tem duas. */
function arestasDoProvedor(indiceProvedor: number): number[] {
  const arestas: number[] = [];
  if (indiceProvedor - 1 >= 0) arestas.push(indiceProvedor - 1);
  if (indiceProvedor <= PROVEDORES_DA_DEMO.length - 2) arestas.push(indiceProvedor);
  return arestas;
}

/** Os CPFs que se repetem entre vizinhos — as 4 arestas da linha, achatadas. */
export const CPFS_COMPARTILHADOS: string[] = Array.from(
  { length: PROVEDORES_DA_DEMO.length - 1 },
  (_, aresta) => indicesDaAresta(aresta),
)
  .flat()
  .map(cpfFicticio);

type Categoria = "inadimplente" | "cancelado" | "em_dia";

interface EntradaDoPlano {
  personaIndex: number;
  categoria: Categoria;
  /** Posição dentro da própria categoria (0-based) — usada para ciclar idade, valor e equipamento. */
  posicaoNaCategoria: number;
}

/**
 * Monta os 1.500 clientes de um provedor: quem é inadimplente, quem é
 * cancelado (dos quais os primeiros 120 também levam equipamento retido) e
 * quem está em dia — e, dentro disso, QUAIS índices vêm de uma aresta
 * compartilhada com um vizinho em vez da faixa exclusiva do provedor.
 */
function planoDeIndices(indiceProvedor: number): EntradaDoPlano[] {
  const arestas = arestasDoProvedor(indiceProvedor);
  const compartilhados = arestas.flatMap(indicesDaAresta);
  const compartilhadosInadimplentes = compartilhados.slice(0, COMPARTILHADOS_INADIMPLENTES_POR_ARESTA * arestas.length);
  const compartilhadosEmDia = compartilhados.slice(COMPARTILHADOS_INADIMPLENTES_POR_ARESTA * arestas.length);

  const entradas: EntradaDoPlano[] = [];
  let cursorUnico = 0;
  const proximoIndiceUnico = () => BASE_UNICO + indiceProvedor * PASSO_UNICO + cursorUnico++;

  let posInadimplente = 0;
  for (const personaIndex of compartilhadosInadimplentes) {
    entradas.push({ personaIndex, categoria: "inadimplente", posicaoNaCategoria: posInadimplente++ });
  }
  while (posInadimplente < INADIMPLENTES_POR_PROVEDOR) {
    entradas.push({ personaIndex: proximoIndiceUnico(), categoria: "inadimplente", posicaoNaCategoria: posInadimplente++ });
  }

  for (let k = 0; k < CANCELADOS_POR_PROVEDOR; k++) {
    entradas.push({ personaIndex: proximoIndiceUnico(), categoria: "cancelado", posicaoNaCategoria: k });
  }

  let posEmDia = 0;
  for (const personaIndex of compartilhadosEmDia) {
    entradas.push({ personaIndex, categoria: "em_dia", posicaoNaCategoria: posEmDia++ });
  }
  while (entradas.length < CLIENTES_POR_PROVEDOR) {
    entradas.push({ personaIndex: proximoIndiceUnico(), categoria: "em_dia", posicaoNaCategoria: posEmDia++ });
  }

  return entradas;
}

function idadeRepresentativa(posicao: number): number {
  return IDADES_DE_VENCIMENTO_REPRESENTATIVAS[posicao % IDADES_DE_VENCIMENTO_REPRESENTATIVAS.length];
}

function valorMensalidade(personaIndex: number): number {
  return VALORES_DE_PLANO[personaIndex % VALORES_DE_PLANO.length];
}

function linhaDoCliente(providerId: number, entrada: EntradaDoPlano): InsertCustomer {
  const pessoa = pessoaFicticia(entrada.personaIndex);
  const base = {
    providerId,
    name: pessoa.nome,
    cpfCnpj: pessoa.cpf,
    email: pessoa.email,
    phone: pessoa.telefone,
    address: pessoa.logradouro,
    addressNumber: pessoa.numero,
    neighborhood: pessoa.bairro,
    city: pessoa.cidade,
    state: pessoa.uf,
    cep: pessoa.cep,
    latitude: pessoa.latitude,
    longitude: pessoa.longitude,
  };

  if (entrada.categoria === "inadimplente") {
    return {
      ...base,
      status: "active",
      paymentStatus: "overdue",
      totalOverdueAmount: valorMensalidade(entrada.personaIndex).toFixed(2),
      maxDaysOverdue: idadeRepresentativa(entrada.posicaoNaCategoria),
    };
  }
  if (entrada.categoria === "cancelado") {
    return { ...base, status: "cancelled", paymentStatus: "current", totalOverdueAmount: "0.00", maxDaysOverdue: 0 };
  }
  return { ...base, status: "active", paymentStatus: "current", totalOverdueAmount: "0.00", maxDaysOverdue: 0 };
}

function linhaDaFatura(providerId: number, customerId: number, entrada: EntradaDoPlano, agora: Date): InsertInvoice {
  const idadeDias = idadeRepresentativa(entrada.posicaoNaCategoria);
  const vencimento = new Date(agora.getTime() - idadeDias * 86_400_000);
  return {
    customerId,
    providerId,
    value: valorMensalidade(entrada.personaIndex).toFixed(2),
    dueDate: vencimento,
    status: "overdue",
  };
}

/** MAC determinístico a partir do índice — só para o campo não ficar vazio. */
function macFicticio(indice: number): string {
  const hex = Math.trunc(Math.abs(indice)).toString(16).padStart(8, "0").slice(-8);
  return `9C:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}:FF`.toUpperCase();
}

function linhaDoEquipamento(providerId: number, customerId: number, entrada: EntradaDoPlano): InsertEquipment {
  const posicao = entrada.posicaoNaCategoria;
  const marca = MARCAS_DE_EQUIPAMENTO[posicao % MARCAS_DE_EQUIPAMENTO.length];
  const modelos = MODELOS_POR_MARCA[marca];
  const modelo = modelos[posicao % modelos.length];
  const status = STATUS_DE_EQUIPAMENTO_RETIDO[posicao % STATUS_DE_EQUIPAMENTO_RETIDO.length];
  return {
    customerId,
    providerId,
    type: "ONU",
    brand: marca,
    model: modelo,
    serialNumber: `SN${String(entrada.personaIndex).padStart(8, "0")}`,
    mac: macFicticio(entrada.personaIndex),
    status,
    value: "290.00",
  };
}

/**
 * CNPJ fictício determinístico para os 5 provedores — mesma ideia do
 * `cpfFicticio` da Tarefa 2 (dígito verificador válido pelo algoritmo da
 * Receita), com raiz "40" + índice do provedor + filial "0001". CNPJ não tem
 * uma faixa reservada como o "999" do CPF, mas isso não importa aqui: a
 * demonstração roda num banco isolado, que nunca chama SPC/cadastral de
 * verdade (`DEMO_MODE`) — 5 CNPJs fictícios não colidem com nada que este
 * banco algum dia consulte.
 */
function digitoVerificadorCnpj(digitos: number[], pesos: number[]): number {
  const soma = digitos.reduce((acc, d, idx) => acc + d * pesos[idx], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cnpjFicticio(indiceProvedor: number): string {
  const raiz = `40${String(indiceProvedor).padStart(6, "0")}0001`; // 12 dígitos: raiz (8) + filial (4)
  const digitos = raiz.split("").map(Number);
  const d1 = digitoVerificadorCnpj(digitos, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoVerificadorCnpj([...digitos, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${raiz}${d1}${d2}`;
}

function linhaDoProvedor(indice: number, p: ProvedorDaDemo): InsertProvider {
  return {
    name: p.nome,
    cnpj: cnpjFicticio(indice),
    subdomain: p.subdomain,
    plan: "enterprise",
    status: "active",
    verificationStatus: "approved",
    ispCredits: 999_999,
    spcCredits: 999_999,
    addressCity: p.cidade,
    addressState: "PR",
    contactEmail: `contato@${p.subdomain}.demo.consultaisp.com.br`,
  };
}

function linhaDaIntegracao(providerId: number): InsertErpIntegration {
  return { providerId, erpSource: "demo", isEnabled: true, status: "idle" };
}

async function inserirClientesEmBlocos(linhas: InsertCustomer[]): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < linhas.length; i += TAMANHO_DO_BLOCO) {
    const bloco = linhas.slice(i, i + TAMANHO_DO_BLOCO);
    const inseridos = await db.insert(customers).values(bloco).returning({ id: customers.id });
    ids.push(...inseridos.map((r) => r.id));
  }
  return ids;
}

async function inserirFaturasEmBlocos(linhas: InsertInvoice[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += TAMANHO_DO_BLOCO) {
    await db.insert(invoices).values(linhas.slice(i, i + TAMANHO_DO_BLOCO));
  }
}

async function inserirEquipamentosEmBlocos(linhas: InsertEquipment[]): Promise<void> {
  for (let i = 0; i < linhas.length; i += TAMANHO_DO_BLOCO) {
    await db.insert(equipment).values(linhas.slice(i, i + TAMANHO_DO_BLOCO));
  }
}

/**
 * Semeia os cinco provedores da demonstração, a carteira de cada um e a
 * sobreposição de CPFs entre vizinhos. Idempotente: se "rede-1" já existe,
 * não grava nada de novo — só devolve o estado atual.
 *
 * `agora` é injetável (nunca `new Date()` espalhado pela função) para que a
 * idade de vencimento de cada fatura seja um deslocamento estável a partir de
 * UM só instante, e não de vários `new Date()` tirados em momentos diferentes
 * da varredura.
 */
export async function semearMundoBase(agora: Date = new Date()): Promise<{ provedores: number[]; clientes: number }> {
  const primeiroSubdomain = PROVEDORES_DA_DEMO[0].subdomain;
  const jaSemeado = await db.select({ id: providers.id }).from(providers).where(eq(providers.subdomain, primeiroSubdomain));

  if (jaSemeado.length > 0) {
    const idsExistentes: number[] = [];
    for (const p of PROVEDORES_DA_DEMO) {
      const [linha] = await db.select({ id: providers.id }).from(providers).where(eq(providers.subdomain, p.subdomain));
      if (linha) idsExistentes.push(linha.id);
    }
    return { provedores: idsExistentes, clientes: idsExistentes.length * CLIENTES_POR_PROVEDOR };
  }

  const idsDosProvedores: number[] = [];
  let totalDeClientes = 0;

  for (let i = 0; i < PROVEDORES_DA_DEMO.length; i++) {
    const provedor = PROVEDORES_DA_DEMO[i];
    const [criado] = await db.insert(providers).values(linhaDoProvedor(i, provedor)).returning({ id: providers.id });
    const providerId = criado.id;
    idsDosProvedores.push(providerId);

    await db.insert(erpIntegrations).values(linhaDaIntegracao(providerId));

    const entradas = planoDeIndices(i);
    const linhasClientes = entradas.map((e) => linhaDoCliente(providerId, e));
    const idsClientes = await inserirClientesEmBlocos(linhasClientes);

    const linhasFaturas: InsertInvoice[] = [];
    const linhasEquipamentos: InsertEquipment[] = [];
    for (let k = 0; k < entradas.length; k++) {
      const entrada = entradas[k];
      const customerId = idsClientes[k];
      if (entrada.categoria === "inadimplente") {
        linhasFaturas.push(linhaDaFatura(providerId, customerId, entrada, agora));
      } else if (entrada.categoria === "cancelado" && entrada.posicaoNaCategoria < COM_EQUIPAMENTO_POR_PROVEDOR) {
        linhasEquipamentos.push(linhaDoEquipamento(providerId, customerId, entrada));
      }
    }

    await inserirFaturasEmBlocos(linhasFaturas);
    await inserirEquipamentosEmBlocos(linhasEquipamentos);

    totalDeClientes += linhasClientes.length;
  }

  return { provedores: idsDosProvedores, clientes: totalDeClientes };
}
