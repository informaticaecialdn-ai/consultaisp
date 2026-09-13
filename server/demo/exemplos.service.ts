/**
 * Os três CPFs de exemplo da demonstração pública (item 1 do plano de
 * 2026-09-11, `.superpowers/sdd/2026-09-11-demo-sandbox/`).
 *
 * A tela de Consulta ISP promete um clique por história: um CPF limpo, um
 * "devendo na rede" (em dia com o próprio sandbox, mas inadimplente em outro
 * provedor da rede) e um migrador serial (saiu devendo de um provedor e
 * contratou outro há pouco). Sem eles o visitante digita um CPF que inventou,
 * recebe "nada consta" e conclui que o produto não faz nada.
 *
 * A derivação nasceu como uma função PRIVADA de teste
 * (`cpfsDeExemplo` em `server/demo/sandbox.service.test.ts`) — nunca virou
 * rota, nunca teve export. Este módulo é a mesma ideia, promovida a código de
 * produção: dedução por PROPRIEDADE sobre a própria carteira do sandbox
 * (nunca por fórmula de índice reconstruída às cegas), e o migrador de
 * exemplo é sempre o par fixo que `semearParMigradorDeExemplo`
 * (`server/demo/mundo-base.ts`) grava no mundo base.
 *
 * "Devendo na rede" usa `CPFS_COMPARTILHADOS` (exportado de `mundo-base.ts`,
 * puramente calculado — sem consulta ao banco) em vez de reconstruir a
 * carteira dos cinco provedores da rede: mais barato, e o mesmo conjunto que
 * `server/demo/sandbox.service.ts` usa para sobrepor 150 CPFs do sandbox aos
 * da rede.
 */
import { storage } from "../storage";
import { CPFS_COMPARTILHADOS, INDICE_MIGRADOR_DE_EXEMPLO } from "./mundo-base";
import { cpfFicticio } from "./pessoas-ficticias";

export type SituacaoDeExemplo = "limpo" | "devendo_na_rede" | "migrador_serial";

export interface CpfDeExemplo {
  situacao: SituacaoDeExemplo;
  cpf: string;
  /** O que o chip mostra fechado — curto, para caber num botão. */
  rotulo: string;
  /** O que o chip promete demonstrar — abre a explicação para quem passa o mouse ou lê antes de clicar. */
  descricao: string;
}

const CPFS_DA_REDE = new Set(CPFS_COMPARTILHADOS);
const POSICAO_NA_REDE = new Map(CPFS_COMPARTILHADOS.map((cpf, i) => [cpf, i]));

/**
 * Um CPF de cada situação, para a Consulta ISP sugerir o que testar num
 * clique só. Lança se a carteira do sandbox não tiver o que a demonstração
 * promete — melhor um 500 alto e visível do que uma tela sem chip nenhum,
 * silenciosamente.
 */
export async function cpfsDeExemplo(providerId: number): Promise<CpfDeExemplo[]> {
  const clientes = await storage.getCustomersByProvider(providerId);

  // `equipmentCount` é o agregado de aparelho NÃO devolvido
  // (`recalculateCustomerEquipmentAggregate`, pelo critério de
  // `equipamentoTemRetiradaPendente`): quem tem retirada pendente não é a
  // história do "limpo" — a consulta mostraria a ocorrência patrimonial. A ONU
  // em comodato de quem está em dia não entra nessa conta e não afasta ninguém.
  const limpo = clientes.find(
    (c) =>
      c.paymentStatus === "current" &&
      c.status === "active" &&
      !CPFS_DA_REDE.has(c.cpfCnpj) &&
      (c.equipmentCount ?? 0) === 0,
  );
  // Em dia AQUI, e o primeiro CPF da rede (`CPFS_COMPARTILHADOS[0]`, devedor em
  // dois provedores parceiros): o sandbox também tem inadimplentes e quem pagou
  // nos últimos 30 dias com CPF da rede (os alertas do Anti-Fraude nascem de
  // consultas da rede sobre eles), e a ordem da leitura do banco não é garantida.
  const devendoNaRede = clientes
    .filter((c) => c.paymentStatus === "current" && c.status === "active" && CPFS_DA_REDE.has(c.cpfCnpj))
    .sort((a, b) => POSICAO_NA_REDE.get(a.cpfCnpj)! - POSICAO_NA_REDE.get(b.cpfCnpj)!)[0];

  if (!limpo || !devendoNaRede) {
    throw new Error(
      `cpfsDeExemplo: sandbox ${providerId} sem a carteira esperada ` +
      `(limpo=${limpo ? "ok" : "faltando"}, devendoNaRede=${devendoNaRede ? "ok" : "faltando"})`,
    );
  }

  return [
    {
      situacao: "limpo",
      cpf: limpo.cpfCnpj,
      rotulo: "CPF limpo",
      descricao: "Cliente em dia, sem nenhuma ocorrência na rede de provedores.",
    },
    {
      situacao: "devendo_na_rede",
      cpf: devendoNaRede.cpfCnpj,
      rotulo: "Devendo na rede",
      descricao: "Em dia com você, mas inadimplente em outros provedores parceiros.",
    },
    {
      situacao: "migrador_serial",
      cpf: cpfFicticio(INDICE_MIGRADOR_DE_EXEMPLO),
      rotulo: "Migrador serial",
      descricao: "Saiu devendo de um provedor e contratou outro há pouco tempo.",
    },
  ];
}
