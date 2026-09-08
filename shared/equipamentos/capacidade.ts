/**
 * De onde vêm os aparelhos da lista de equipamentos — e por que a lista pode
 * estar vazia mesmo com o ERP integrado e funcionando.
 *
 * Só IXC e SGP declaram `supportsEquipment`. Provedor em MK, Hubsoft, Voalle ou
 * RBX sincroniza cliente e fatura normalmente, mas NENHUM aparelho chega: a
 * tela fica vazia e o operador conclui que a integração quebrou. Não quebrou —
 * aquele ERP não expõe comodato.
 *
 * Era o Step 3 da Task 10 do plano de 21/08/2026, que morava na tela de
 * importação de equipamentos. Aquela tela acabou em 08/09/2026 com a importação
 * manual, e o aviso foi junto — mas o motivo dele não. Ele ficou MAIS
 * necessário: sem planilha, quando o ERP não traz aparelho o cadastro unitário
 * é a única porta, e é exatamente essa a decisão que o dono tomou no mesmo dia
 * ("mantém").
 *
 * Função pura porque a regra é de cruzamento e erra fácil: integração que
 * existe mas está desligada, conector que sumiu do registry, provedor sem
 * nenhum ERP. Cada um desses tem uma frase diferente, e nenhuma delas é
 * "carregando".
 */

/** O resumo que `GET /api/provider/erp-integrations` devolve (sem credencial). */
export interface IntegracaoDoProvedor {
  erpSource: string;
  isEnabled?: boolean | null;
  configurado?: boolean;
}

/** O catálogo que `GET /api/erp-connectors` devolve. */
export interface ConectorDoCatalogo {
  name: string;
  label?: string;
  supportsEquipment?: boolean;
  naoImplementado?: boolean;
}

export type OrigemDosAparelhos =
  /** Nenhum ERP ligado: a lista tem só o que for cadastrado aqui. */
  | "sem_erp"
  /** O ERP está ligado mas não expõe comodato. A lista vazia é esperada. */
  | "erp_sem_equipamento"
  /** O ERP traz os aparelhos; o cadastro manual soma ao que ele sincroniza. */
  | "erp_traz_equipamento";

export interface CapacidadeDeEquipamento {
  origem: OrigemDosAparelhos;
  /** Os ERPs ligados que TRAZEM aparelho, pelo rótulo de exibição. */
  comEquipamento: string[];
  /** Os ERPs ligados que NÃO trazem aparelho. */
  semEquipamento: string[];
  /** A frase pronta para a tela. Sempre presente — nunca cabe "—" aqui. */
  aviso: string;
}

/** O rótulo do conector; sem ele, o próprio `erpSource` em caixa alta. */
function rotulo(nome: string, catalogo: readonly ConectorDoCatalogo[]): string {
  return catalogo.find(c => c.name === nome)?.label || nome.toUpperCase();
}

function lista(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * Cruza as integrações do provedor com o catálogo de conectores.
 *
 * Conta só integração LIGADA E CONFIGURADA: uma linha desligada não sincroniza
 * nada, e dizer ao operador que "o ERP traz os aparelhos" nesse caso seria
 * prometer o que não vai acontecer. `configurado` ausente no payload é tratado
 * como configurado — a rota antiga não mandava o campo, e presumir o contrário
 * apagaria o aviso de quem tem ERP de verdade.
 */
export function capacidadeDeEquipamento(
  integracoes: readonly IntegracaoDoProvedor[],
  catalogo: readonly ConectorDoCatalogo[],
): CapacidadeDeEquipamento {
  const ativas = integracoes.filter(i => i.isEnabled !== false && i.configurado !== false);

  const comEquipamento: string[] = [];
  const semEquipamento: string[] = [];
  for (const i of ativas) {
    const conector = catalogo.find(c => c.name === i.erpSource);
    // Conector marcado `naoImplementado` é casca: não sincroniza nada, então
    // não entra em nenhuma das duas listas — nem promete, nem acusa.
    if (conector?.naoImplementado) continue;
    (conector?.supportsEquipment ? comEquipamento : semEquipamento).push(rotulo(i.erpSource, catalogo));
  }

  if (comEquipamento.length > 0) {
    return {
      origem: "erp_traz_equipamento",
      comEquipamento,
      semEquipamento,
      aviso: `${lista(comEquipamento)} ${comEquipamento.length > 1 ? "trazem" : "traz"} os aparelhos na sincronização. O que você cadastrar aqui soma ao que vem de lá.`,
    };
  }

  if (semEquipamento.length > 0) {
    return {
      origem: "erp_sem_equipamento",
      comEquipamento,
      semEquipamento,
      aviso: `${lista(semEquipamento)} não informa comodato: a sincronização traz cliente e fatura, mas nenhum aparelho. Esta lista tem só o que for cadastrado aqui.`,
    };
  }

  return {
    origem: "sem_erp",
    comEquipamento,
    semEquipamento,
    aviso: "Nenhum ERP integrado ainda. Esta lista tem só o que for cadastrado aqui.",
  };
}
