/**
 * Copiar um texto curto para a area de transferencia, dizendo se deu certo.
 *
 * Existia seis vezes espalhado pelo client como `navigator.clipboard.writeText(x)`
 * seguido de um "Copiado!" — sem `await` e sem `catch`. A promessa e rejeitada
 * de verdade em situacoes comuns: pagina servida fora de HTTPS, permissao de
 * clipboard negada no navegador, aba sem foco. Nesses casos a tela dizia
 * "copiado" e a area de transferencia continuava com o conteudo anterior. Com
 * um codigo de suporte isso e pior que inutil: o provedor cola OUTRA coisa no
 * chamado e o atendente procura por um codigo que nunca foi copiado.
 *
 * Aqui a funcao devolve `false` quando falha, e quem chama mostra o codigo para
 * o operador copiar a mao.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (!texto) return false;

  // `navigator` pode nem existir (render no servidor, teste sem DOM) e
  // `clipboard` some fora de contexto seguro. Checar antes evita transformar
  // uma indisponibilidade previsivel em excecao.
  const area = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!area?.writeText) return false;

  try {
    await area.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

export type EstadoDaCopia = "parado" | "copiado" | "falhou";

export interface RetornoDaCopia {
  /** O que o botão escreve ao lado do ícone; `null` no repouso. */
  dito: string | null;
  /** Token de cor do ícone e do texto. */
  cor: string;
  /** O `aria-label`, que muda com o estado — leitor de tela também precisa da resposta. */
  aria: string;
  /** Quanto o estado fica na tela antes de voltar ao repouso, em ms. */
  duracaoMs: number;
}

/**
 * O que o botão de copiar mostra em cada estado.
 *
 * Vive fora do componente porque é a regra que importa — "o botão não mente" —
 * e este projeto não tem ambiente de DOM nos testes: como função pura ela pode
 * ser verificada de verdade, em vez de ficar como intenção escrita num
 * comentário de JSX.
 *
 * A falha fica MAIS tempo na tela que o sucesso: o sucesso só confirma, a falha
 * exige do operador uma ação — selecionar o código e copiar à mão.
 */
export function retornoDaCopia(estado: EstadoDaCopia, rotulo: string): RetornoDaCopia {
  if (estado === "copiado") {
    return { dito: "copiado", cor: "var(--ok)", aria: `${rotulo} copiado`, duracaoMs: 2000 };
  }
  if (estado === "falhou") {
    return {
      dito: "copie a mão",
      cor: "var(--danger)",
      aria: `Não foi possível copiar o ${rotulo}. Selecione o código e copie à mão.`,
      duracaoMs: 4000,
    };
  }
  return { dito: null, cor: "var(--text-muted)", aria: `Copiar ${rotulo}`, duracaoMs: 0 };
}
