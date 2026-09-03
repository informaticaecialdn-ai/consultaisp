import {
  CREDIT_PACKAGES,
  CUSTO_EM_CREDITOS,
  PLAN_CREDITS,
  PLAN_PRICES,
  formatarReais,
} from "@shared/planos";

/**
 * PRECO SE RESOLVE NO SERVIDOR, SEMPRE.
 *
 * Antes cada tela do client montava o proprio numero: `painel-provedor.tsx`
 * anunciava planos de R$ 199/399/799 que a fatura nunca cobrou, `invoice-view`
 * e `admin-financeiro` guardavam a propria copia dos creditos de plano, e
 * `admin-creditos` mandava comprar pacotes com id que o servidor ja nao
 * reconhecia. O provedor via um preco na tela e outro na fatura.
 *
 * Com o white label isso deixa de ser cosmetico: o preco passa a depender da
 * MARCA que o provedor veste, e uma copia no client nao tem como saber disso.
 *
 * TRES CAMADAS (desenho da fase 2 do white label):
 *   0. piso e teto em codigo — `shared/planos.ts`, `validarPrecoDaMarca`;
 *   1. `marca_precos`, editavel pelo revendedor dentro do piso/teto;
 *   2. a tabela padrao da plataforma, `shared/planos.ts`.
 *
 * NESTA FASE so a camada 2 existe: a tabela `marca_precos` entra na fase 3.
 * O ponto de extensao esta marcado abaixo, e a assinatura ja e assincrona de
 * proposito — quando a camada 1 chegar ela vai ao banco, e trocar a assinatura
 * depois obrigaria a mexer em toda chamada.
 */

export interface PacoteDeCredito {
  id: string;
  nome: string;
  creditos: number;
  precoCentavos: number;
  precoReais: number;
  precoLabel: string;
  precoUnitarioCentavos: number;
  precoUnitarioLabel: string;
  popular: boolean;
}

export interface PrecoDePlano {
  chave: string;
  rotulo: string;
  precoCentavos: number;
  precoReais: number;
  precoLabel: string;
  creditosInclusos: { isp: number; spc: number };
  /** Oferecido na landing e no cadastro. Os demais existem so por contrato vigente. */
  naVitrine: boolean;
  /**
   * O plano gera fatura mensal?
   *
   * Existe porque `creditosInclusos` NAO e um credito automatico: e o texto que
   * a fatura escreve. `POST /api/admin/invoices/generate-monthly` pula todo
   * provedor com preco zero (financeiro.routes.ts), entao no `free` nenhuma
   * fatura nasce e nenhum credito e somado — os 50 vem uma vez so, do default
   * da coluna `providers.isp_credits` no cadastro.
   *
   * Sem este campo o client so tinha `creditosInclusos` para exibir, e o card
   * de plano do painel anunciava "50 creditos inclusos por mes" para uma
   * recorrencia que nunca acontece. Quem decide se ha recorrencia e o servidor,
   * que e quem fatura.
   */
  recorrente: boolean;
}

export interface TabelaDePrecos {
  /** De onde saiu o numero. Hoje sempre "plataforma"; "marca" chega na fase 3. */
  origem: "plataforma" | "marca";
  marcaId: number | null;
  pacotes: PacoteDeCredito[];
  planos: PrecoDePlano[];
  /** Quantos creditos cada consulta consome. Nao varia por marca. */
  custoEmCreditos: Record<string, number>;
}

/**
 * Rotulo de cada plano em portugues.
 *
 * Vivia copiado em `invoice-view.tsx` ("Pro") e em `painel-provedor.tsx`
 * ("Profissional") — a mesma assinatura com dois nomes na mesma sessao.
 */
export const ROTULO_DO_PLANO: Record<string, string> = {
  free: "Gratuito",
  basic: "Básico",
  pro: "Profissional",
  enterprise: "Enterprise",
};

/**
 * O que a landing vende hoje. `basic` e `enterprise` continuam na tabela
 * porque ha provedores neles, mas nao sao oferecidos — ver o comentario de
 * PLAN_PRICES em shared/planos.ts.
 */
const PLANOS_NA_VITRINE = new Set(["free", "pro"]);

function montarPacote(pkg: (typeof CREDIT_PACKAGES)[number]): PacoteDeCredito {
  const unitario = Math.round(pkg.price / pkg.credits);
  return {
    id: pkg.id,
    nome: pkg.name,
    creditos: pkg.credits,
    precoCentavos: pkg.price,
    precoReais: pkg.price / 100,
    precoLabel: formatarReais(pkg.price),
    precoUnitarioCentavos: unitario,
    precoUnitarioLabel: `${formatarReais(unitario)}/crédito`,
    popular: Boolean((pkg as { popular?: boolean }).popular),
  };
}

function montarPlano(chave: string): PrecoDePlano {
  const reais = PLAN_PRICES[chave] ?? 0;
  const centavos = Math.round(reais * 100);
  return {
    chave,
    rotulo: ROTULO_DO_PLANO[chave] || chave,
    precoCentavos: centavos,
    precoReais: reais,
    precoLabel: formatarReais(centavos),
    creditosInclusos: PLAN_CREDITS[chave] || { isp: 0, spc: 0 },
    naVitrine: PLANOS_NA_VITRINE.has(chave),
    // Mesma condicao de generate-monthly: preco zero nao gera fatura.
    recorrente: centavos > 0,
  };
}

/**
 * A tabela que vale para esta marca. `null` = plataforma.
 */
export async function precosDaMarca(marcaId: number | null): Promise<TabelaDePrecos> {
  // PONTO DE EXTENSAO — FASE 3 DO WHITE LABEL.
  // Aqui entra a leitura de `marca_precos` (camada 1): com marcaId != null,
  // sobrescrever `precoCentavos` do pacote e do plano pelo valor da marca,
  // depois de passar por `validarPrecoDaMarca` na GRAVACAO (nunca na leitura —
  // clampar aqui esconderia uma linha invalida em vez de corrigi-la), e marcar
  // `origem: "marca"`. A tabela ainda nao existe, entao nada a fazer.

  return {
    origem: "plataforma",
    marcaId,
    pacotes: CREDIT_PACKAGES.map(montarPacote),
    planos: Object.keys(PLAN_PRICES).map(montarPlano),
    custoEmCreditos: { ...CUSTO_EM_CREDITOS },
  };
}
