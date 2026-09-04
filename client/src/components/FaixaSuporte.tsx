/**
 * A faixa de sessão de suporte — o aviso que não sai da tela enquanto alguém da
 * plataforma está dentro da conta de um provedor.
 *
 * POR QUE ELA EXISTE
 * Isto não é "modo admin": é personificação de conta num bureau de crédito sob
 * LGPD. Conectado, o suporte vê o dado pessoal completo dos clientes de OUTRA
 * empresa — CPF, nome, endereço, telefone, consultas, alertas — e as telas são,
 * pixel por pixel, as mesmas que o provedor vê. `server/auth.ts` mantém `role`
 * como "superadmin" de propósito, mas nada disso aparece na interface: sem um
 * sinal permanente, nada distingue "minha conta" de "a conta de um terceiro", e
 * a pessoa do suporte esquece — não por má-fé, por hábito. A faixa existe para
 * que esse esquecimento seja impossível, e por isso ela é vermelha, fica no topo
 * e não tem botão de fechar.
 *
 * VERMELHO É EXCEÇÃO DEFENDIDA, NÃO DECORAÇÃO
 * A seção 3 do DESIGN_SYSTEM reserva saturação para risco. Uma janela em que o
 * isolamento por `providerId` — a invariante central do produto — está
 * deliberadamente atravessada é exatamente isso. O resto do sistema continua
 * valendo: sem gradiente, sem sombra, canto seco, número em mono tabular.
 *
 * DE ONDE VEM O QUE ELA MOSTRA
 * De `GET /api/provider/acesso-suporte` (server/routes/suporte-acesso.routes.ts),
 * a rota que a própria frente do servidor apontou como a que "alimenta a faixa
 * vermelha". Ela responde com a janela vigente do provedor cujo `providerId`
 * está NA SESSÃO — e é isso que a torna um sinal de personificação e não uma
 * consulta qualquer:
 *
 *   · superadmin personificando → 200, `liberado: true`, com `expiraEm`,
 *     `providerId` e `providerNome`;
 *   · superadmin fora de personificação → 403 em `requireProvider`, porque a
 *     sessão dele não tem `providerId`;
 *   · admin ou operador do provedor → 200 também, e por isso a pergunta só é
 *     feita quando `role` é "superadmin": uma janela aberta com ninguém dentro
 *     não é motivo para pintar a tela do dono de vermelho.
 *
 * E, dentro do superadmin, só quando há motivo — ver o bloco do lembrete de
 * personificação. Perguntar em toda montagem gastava uma viagem e uma recusa no
 * log para a resposta que já se sabia.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, ShieldAlert } from "lucide-react";
import { apiRequest, type ErroDaApi } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { ALVO_CONTROLE, DESABILITAVEL } from "@/components/painel/ui";

/** A janela vigente da sessão atual. Ver `EstadoDoAcesso` em suporte-acesso.routes.ts. */
export const ROTA_ESTADO_DO_ACESSO = "/api/provider/acesso-suporte";

/** Desfaz a personificação e devolve o superadmin à própria conta. Idempotente. */
export const ROTA_SAIR_DA_SESSAO_DE_SUPORTE = "/api/admin/acesso-suporte/sair";

/**
 * Os dois códigos que a trava de acesso devolve. São cópias literais de
 * `CODIGO_SUPORTE_ENCERRADO` e `CODIGO_SUPORTE_NAO_VERIFICADO`
 * (server/auth.ts) — o client não importa do servidor, então as strings vivem
 * nos dois lados e precisam concordar.
 *
 * A distinção entre eles é a razão de a faixa lê-los. `ENDED` (403) é o fim: a
 * liberação expirou ou o provedor revogou, e a personificação já foi desfeita
 * no servidor. `UNVERIFIED` (503) é o contrário — o banco não respondeu, a
 * requisição foi recusada por precaução e a sessão continua de pé. Tratar os
 * dois como "acabou" mandaria o suporte embora por causa de um soluço de rede;
 * tratar os dois como "instabilidade" deixaria a faixa mentindo depois do fim.
 */
export const CODIGO_SUPORTE_ENCERRADO = "SUPPORT_ACCESS_ENDED";
export const CODIGO_SUPORTE_NAO_VERIFICADO = "SUPPORT_ACCESS_UNVERIFIED";

/** O corpo de `GET /api/provider/acesso-suporte`, na parte que a faixa usa. */
export type EstadoDoAcesso = {
  liberado: boolean;
  /** ISO. Nasce do relógio do Postgres (ver server/storage/suporte.storage.ts). */
  expiraEm?: string;
  /**
   * Quem é o dono do dado que está na tela. OPCIONAIS porque hoje o servidor
   * ainda não os envia — ver a nota "O NOME DO PROVEDOR" no fim do arquivo.
   */
  providerId?: number;
  providerNome?: string;
};

/** A sessão de suporte em curso, como a faixa e o `App` precisam dela. */
export type SessaoDeSuporte = {
  expiraEm: string;
  providerId?: number;
  providerNome?: string;
};

/* ==================================================================== */
/* O lembrete de personificação                                         */
/* ==================================================================== */

/**
 * COMO A FAIXA SABE QUE PRECISA PERGUNTAR — sem perguntar.
 *
 * A pergunta "há personificação em curso?" só tem uma resposta autorizada, a do
 * banco, e nada aqui muda isso. O que muda é QUANDO ela é feita. Antes, todo
 * superadmin perguntava em toda montagem do app, e para quem não estava
 * personificando — a esmagadora maioria das aberturas de tela — a rota respondia
 * 403 em `requireProvider`, porque a sessão dele não tem `providerId`. Uma
 * viagem e uma linha de log de recusa por carregamento, para uma resposta que já
 * era conhecida.
 *
 * O detalhe é que ela É conhecida: a personificação não começa sozinha, começa
 * num clique — o "Entrar no sistema do provedor" da aba do superadmin
 * (client/src/pages/admin/admin-provedor.tsx). Quem clicou pode deixar um
 * bilhete para si mesmo, e é isso que este lembrete é.
 *
 * O que ele NÃO é: autorização. Ninguém entra por causa dele e ninguém fica
 * dentro por causa dele — a sessão é do servidor, a janela é do banco, e a
 * trava reconfere a cada requisição. O lembrete só decide se vale a pena
 * perguntar.
 *
 * POR QUE ELE PODE FALTAR, E POR QUE ISSO NÃO ESCONDE A FAIXA:
 *   · armazenamento bloqueado (janela privativa, política do navegador) —
 *     `devePerguntarPelaSessao` volta ao comportamento antigo e pergunta
 *     sempre. Sem onde lembrar, não há economia possível, e o aviso vale mais
 *     do que a requisição poupada;
 *   · alguém limpou o armazenamento no meio da sessão — aí a faixa não pergunta,
 *     `App.tsx` trata o superadmin como "sem suporte" e o desvia das telas de
 *     provedor para /admin-sistema. A falha derruba o acesso, nunca a faixa: o
 *     que não pode existir é tela de provedor SEM aviso, e esse par não acontece;
 *   · sessão aberta antes desta mudança — mesmo caso do anterior: o suporte
 *     volta ao painel da plataforma e entra de novo pela aba, que é um clique.
 *
 * Fica em `localStorage`, e não em `sessionStorage`, porque a sessão de suporte
 * é do NAVEGADOR (o cookie é), não da aba: uma segunda aba aberta durante o
 * atendimento precisa desenhar a faixa igual.
 */
export type LembreteDePersonificacao = {
  providerId: number;
  providerNome?: string;
};

export const CHAVE_DO_LEMBRETE = "consultaisp.suporte.personificacao";

/**
 * O primeiro armazenamento que de fato aceita escrita, ou nada.
 *
 * A prova é uma escrita real porque `typeof localStorage !== "undefined"` mente:
 * em janela privativa e sob política de bloqueio o objeto existe e o `setItem`
 * é que estoura. Saber disso é o que separa "não há personificação" de "não
 * consigo lembrar" — e as duas respostas levam a caminhos opostos.
 */
function cofreDoLembrete(): Storage | null {
  for (const nome of ["localStorage", "sessionStorage"] as const) {
    try {
      const alvo = (globalThis as { [k: string]: unknown })[nome] as Storage | undefined;
      if (!alvo) continue;
      const prova = `${CHAVE_DO_LEMBRETE}.prova`;
      alvo.setItem(prova, "1");
      alvo.removeItem(prova);
      return alvo;
    } catch {
      // Armazenamento bloqueado. Tenta o próximo; se nenhum servir, `null`.
    }
  }
  return null;
}

/**
 * O texto guardado vira lembrete — ou nada, sem estourar.
 *
 * Conteúdo de armazenamento é dado de fora: pode ter sido escrito por uma versão
 * anterior, truncado pelo navegador ou adulterado à mão. `providerId` que não
 * seja inteiro positivo é descartado inteiro, porque um lembrete pela metade
 * pediria a rota e nomearia a conta errada.
 */
export function interpretarLembrete(bruto: string | null | undefined): LembreteDePersonificacao | null {
  if (!bruto) return null;
  try {
    const cru = JSON.parse(bruto) as { providerId?: unknown; providerNome?: unknown };
    const providerId = Number(cru?.providerId);
    if (!Number.isInteger(providerId) || providerId <= 0) return null;
    const nome =
      typeof cru?.providerNome === "string" && cru.providerNome.trim() ? cru.providerNome.trim() : undefined;
    return { providerId, providerNome: nome };
  } catch {
    return null;
  }
}

/** O lembrete guardado neste navegador, se houver. */
export function lembreteDePersonificacao(): LembreteDePersonificacao | null {
  const cofre = cofreDoLembrete();
  if (!cofre) return null;
  try {
    return interpretarLembrete(cofre.getItem(CHAVE_DO_LEMBRETE));
  } catch {
    return null;
  }
}

/** Há onde guardar o bilhete? Ver a terceira nota do bloco acima. */
export function haOndeLembrar(): boolean {
  return cofreDoLembrete() !== null;
}

/** Anota a personificação que acaba de começar. Chamado por quem clicou em entrar. */
export function lembrarPersonificacao(lembrete: LembreteDePersonificacao): void {
  const cofre = cofreDoLembrete();
  if (!cofre) return;
  try {
    cofre.setItem(CHAVE_DO_LEMBRETE, JSON.stringify(lembrete));
  } catch {
    // Sem lembrete, a faixa pergunta sempre — que é o comportamento antigo.
  }
}

/** Apaga o bilhete: a personificação acabou, ou nunca existiu. */
export function esquecerPersonificacao(): void {
  for (const nome of ["localStorage", "sessionStorage"] as const) {
    try {
      ((globalThis as { [k: string]: unknown })[nome] as Storage | undefined)?.removeItem(CHAVE_DO_LEMBRETE);
    } catch {
      // Nada a limpar num armazenamento que não abre.
    }
  }
}

/** Vale a pena gastar a requisição? Ver o bloco do lembrete. */
export function devePerguntarPelaSessao(args: {
  ehSuperadmin: boolean;
  lembrete: LembreteDePersonificacao | null;
  haOndeLembrar: boolean;
}): boolean {
  // Só o superadmin personifica: para o provedor a mesma rota responde 200 e a
  // faixa nasceria vermelha na conta do próprio dono, que não está sendo
  // personificado por ninguém.
  if (!args.ehSuperadmin) return false;
  return args.lembrete !== null || !args.haOndeLembrar;
}

/**
 * O erro que autoriza esquecer o lembrete.
 *
 * 403 aqui só sai de `requireProvider` (sessão sem `providerId`, ou seja, não há
 * personificação) ou do fim da liberação. Qualquer outra falha — rede caída,
 * 500, o 503 de banco não confirmado — não diz nada sobre a personificação, e
 * apagar o bilhete por causa dela faria a faixa parar de perguntar no próximo
 * carregamento enquanto o suporte ainda está dentro.
 */
export function ehRecusaDefinitiva(erro: unknown): boolean {
  if (!(erro instanceof Error)) return false;
  const { status, codigo } = erro as Partial<ErroDaApi>;
  if (status === 403 || codigo === CODIGO_SUPORTE_ENCERRADO) return true;
  // A leitura antiga, por substring: `throwIfResNotOk` agora carimba `status` e
  // `codigo` no erro, mas nem todo erro que chega aqui passou por ele — um
  // `TypeError` de rede, por exemplo, ou um throw de outra camada. Manter a
  // leitura de texto custa uma linha e evita que a faixa deixe de reconhecer o
  // fim da janela por causa de quem lançou o erro.
  return erro.message.startsWith("403:") || erro.message.includes(CODIGO_SUPORTE_ENCERRADO);
}

/**
 * A leitura do corpo: há personificação em curso?
 *
 * `liberado` sozinho não basta. Uma janela sem `expiraEm` deixaria a faixa sem
 * contagem — e sem contagem ela vira um adesivo permanente, que é o começo de
 * ser ignorada. Ausência de prazo é resposta malformada, e a faixa prefere não
 * afirmar nada a afirmar sem saber até quando.
 *
 * O lembrete entra só como SUPLENTE da identidade. Quem manda é o servidor: se
 * ele nomeia o provedor, é o nome dele que vai à tela. O bilhete cobre o caso em
 * que a leitura do provedor falhou no servidor (`nomeDoProvedor` engole o erro
 * de propósito) — e só quando os dois falam do MESMO provedor, porque nomear a
 * conta errada é pior do que não nomear.
 */
export function sessaoDaResposta(
  estado?: EstadoDoAcesso,
  lembrete?: LembreteDePersonificacao | null,
): SessaoDeSuporte | null {
  if (!estado?.liberado || !estado.expiraEm) return null;
  const mesmoProvedor =
    lembrete != null && (estado.providerId == null || estado.providerId === lembrete.providerId);
  return {
    expiraEm: estado.expiraEm,
    providerId: estado.providerId ?? (mesmoProvedor ? lembrete!.providerId : undefined),
    providerNome: estado.providerNome ?? (mesmoProvedor ? lembrete!.providerNome : undefined),
  };
}

/**
 * Quanto falta, em milissegundos, com piso em zero.
 *
 * Sem o piso a faixa mostraria uma contagem NEGATIVA correndo para trás depois
 * do vencimento. Prazo ilegível devolve zero pelo mesmo motivo que o piso
 * existe: `NaN` atravessaria a formatação e apagaria o número da tela justamente
 * na hora em que ele mais importa.
 */
export function restanteDaSessao(expiraEm: string, agora: number): number {
  const fim = Date.parse(expiraEm);
  if (!Number.isFinite(fim)) return 0;
  return Math.max(0, fim - agora);
}

/**
 * O que o código de erro do servidor manda a faixa fazer.
 *
 * Separar os dois é o ponto: `SUPPORT_ACCESS_ENDED` desfaz a personificação e
 * `SUPPORT_ACCESS_UNVERIFIED` a preserva. Confundi-los mandaria o suporte embora
 * por causa de um soluço de banco, ou deixaria a faixa dizendo "conectado"
 * depois de o provedor ter revogado. Erro de qualquer outra rota — 404, 500, um
 * ERP fora do ar — não diz nada sobre a janela e não pode mexer na faixa.
 */
export function leituraDoCodigo(erro: unknown): "encerrada" | "nao-verificado" | null {
  if (!(erro instanceof Error)) return null;
  const { codigo } = erro as Partial<ErroDaApi>;
  if (codigo === CODIGO_SUPORTE_ENCERRADO) return "encerrada";
  if (codigo === CODIGO_SUPORTE_NAO_VERIFICADO) return "nao-verificado";
  // Fallback de texto pelo mesmo motivo de `ehRecusaDefinitiva`.
  if (erro.message.includes(CODIGO_SUPORTE_ENCERRADO)) return "encerrada";
  if (erro.message.includes(CODIGO_SUPORTE_NAO_VERIFICADO)) return "nao-verificado";
  return null;
}

/**
 * De quem é a conta, na frase que a faixa consegue afirmar com o que tem.
 *
 * A escada é deliberada: nome, senão o número do provedor, senão a frase sem
 * identificação — ver a nota "O NOME DO PROVEDOR" no fim do arquivo. O que ela
 * nunca faz é omitir a informação de que se está na conta de outra pessoa, que
 * é a única parte inegociável.
 */
export function descricaoDoDono(sessao: SessaoDeSuporte): string {
  if (sessao.providerNome) return `na conta de ${sessao.providerNome}`;
  if (sessao.providerId) return `na conta do provedor #${sessao.providerId}`;
  return "dentro da conta de um provedor";
}

/**
 * Estamos dentro da conta de outra pessoa? — null quando a sessão é normal.
 *
 * `carregando` existe porque quem chama precisa distinguir "não é sessão de
 * suporte" de "ainda não sei": em `App.tsx` a diferença decide se o superadmin é
 * redirecionado para fora das telas de provedor. Tratar "ainda não sei" como
 * "não é" mandaria todo acesso de suporte direto para `/admin-sistema`.
 *
 * A sondagem de 60s é deliberada: o provedor pode revogar a qualquer instante e
 * o resto do app roda com `staleTime: Infinity`. Uma requisição por minuto é
 * barata perto do que se perde ao continuar exibindo dado de titular alheio
 * depois de a autorização ter sido retirada. Ela para sozinha quando não há
 * (ou não há mais) janela: fora da personificação a rota responde 403, e
 * insistir de minuto em minuto seria ruído no log de todo superadmin.
 *
 * A pergunta só é feita quando há motivo — ver o bloco do lembrete de
 * personificação. O motivo é lido UMA VEZ, na montagem: enquanto esta tela vive,
 * quem manda é a resposta do servidor, e apagar o bilhete no meio (ao fim da
 * janela) não pode desligar a consulta que acabou de contar esse fim.
 */
export function useSessaoDeSuporte(): {
  sessao: SessaoDeSuporte | null;
  carregando: boolean;
  /** `Date.now()` da última confirmação vinda do servidor. 0 antes da primeira. */
  confirmadaEm: number;
} {
  const { user, isLoading: carregandoAuth } = useAuth();
  const ehSuperadmin = user?.role === "superadmin";

  const [naMontagem] = useState(() => ({
    lembrete: lembreteDePersonificacao(),
    haOnde: haOndeLembrar(),
  }));
  const perguntar =
    !!user &&
    devePerguntarPelaSessao({
      ehSuperadmin,
      lembrete: naMontagem.lembrete,
      haOndeLembrar: naMontagem.haOnde,
    });

  const { data, isPending, dataUpdatedAt, error } = useQuery<EstadoDoAcesso>({
    queryKey: [ROTA_ESTADO_DO_ACESSO],
    enabled: perguntar,
    refetchInterval: (query) => (query.state.data?.liberado ? 60_000 : false),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  /**
   * O bilhete morre quando o servidor diz que não há (ou não há mais) sessão.
   *
   * Sem isto o lembrete sobreviveria ao fim do atendimento e o 403 por
   * carregamento voltaria — só que para sempre, já que ninguém mais o apagaria.
   * `liberado: false` e a recusa definitiva são as duas formas de o servidor
   * dizer "você não está dentro de ninguém"; instabilidade não é nenhuma das
   * duas (ver `ehRecusaDefinitiva`).
   */
  useEffect(() => {
    if (!perguntar) return;
    if (ehRecusaDefinitiva(error) || data?.liberado === false) esquecerPersonificacao();
  }, [perguntar, error, data?.liberado]);

  // A consulta desligada fica `pending` para sempre no React Query: devolver
  // `carregando: true` aqui congelaria o `App` em "ainda não sei" e o superadmin
  // nunca sairia da tela de espera.
  if (!perguntar) return { sessao: null, carregando: carregandoAuth, confirmadaEm: 0 };

  return {
    sessao: sessaoDaResposta(data, naMontagem.lembrete),
    carregando: carregandoAuth || isPending,
    confirmadaEm: dataUpdatedAt,
  };
}

/** HH:MM:SS, sempre com as três casas — largura estável em fonte tabular. */
export function formatarRestante(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segundos = total % 60;
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(horas)}:${dois(minutos)}:${dois(segundos)}`;
}

/**
 * Anel de foco da faixa — mesma estrutura da constante `FOCO` de painel/ui, com
 * a cor trocada.
 *
 * `FOCO` desenha o anel em `--brand` (berinjela), que sobre o vermelho da faixa
 * quase não aparece: seria um anel presente no CSS e invisível para quem navega
 * por teclado, o pior dos dois mundos. A cor aqui é a do texto da faixa, que já
 * é o par de contraste escolhido para este fundo nos dois temas.
 *
 * A armadilha documentada em `FOCO` continua valendo, e por isso a classe está
 * escrita inteira: `outline-2` sozinho emite largura sem estilo, e o anel some.
 */
const FOCO_NA_FAIXA =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-on-brand)]";

/**
 * Botão da faixa: fundo na cor do próprio texto, letra na cor do fundo.
 *
 * A inversão resolve os dois temas de uma vez, sem `dark:`. No claro `--danger`
 * é escuro e `--text-on-brand` é branco; no escuro os dois trocam de papel
 * (`--danger` clareia para salmão, `--text-on-brand` escurece). É o mesmo par
 * que a faixa já usa, só virado, então o contraste se mantém dos dois lados.
 * `ALVO_CONTROLE` garante os 44px no ponteiro grosso (seção 7).
 */
const BOTAO_DA_FAIXA = `inline-flex items-center justify-center gap-1.5 ${ALVO_CONTROLE} px-3 rounded text-[12.5px] font-medium bg-[var(--text-on-brand)] text-[var(--danger)] hover:opacity-90 ${FOCO_NA_FAIXA} ${DESABILITAVEL} motion-safe:transition-opacity active:scale-[0.97]`;

/**
 * "Esta aba já esteve dentro da conta de um provedor."
 *
 * Mora fora do componente de propósito. No instante em que a liberação cai, o
 * `App` deixa de renderizar as telas de provedor e a faixa é DESMONTADA junto —
 * se a memória fosse um `useRef`, ela morreria exatamente no momento em que
 * precisa falar, e a pessoa do suporte só veria a tela trocar sozinha. O fato é
 * da aba, não da montagem; sair da sessão recarrega a página e o zera.
 */
let houveSessaoNestaAba = false;

export function FaixaSuporte() {
  const { sessao, confirmadaEm } = useSessaoDeSuporte();
  const qc = useQueryClient();

  /**
   * A faixa nunca desaparece em silêncio.
   *
   * Quando a janela cai — o prazo venceu ou o provedor clicou em encerrar — a
   * rota deixa de reportar a liberação e o caminho ingênuo seria devolver `null`
   * e sumir. Para quem está do outro lado da tela isso é indistinguível de
   * "continuo dentro": as telas do provedor seguem montadas, com o dado dele à
   * vista, e o único sinal de que aquilo já não é permitido foi justamente o que
   * sumiu. Por isso a queda vira um estado explícito, com o que aconteceu
   * escrito na tela.
   */
  const [encerrada, setEncerrada] = useState(() => houveSessaoNestaAba && !sessao);
  useEffect(() => {
    if (sessao) {
      houveSessaoNestaAba = true;
      setEncerrada(false);
    } else if (houveSessaoNestaAba) {
      setEncerrada(true);
    }
  }, [sessao]);

  /**
   * O bilhete acompanha o que o servidor confirmou.
   *
   * Reescrever com a identidade que veio de lá mantém o lembrete verdadeiro sem
   * depender de quem o escreveu: se o provedor mudou de nome fantasia desde o
   * clique, o próximo carregamento já nasce com o nome novo. E a aba que
   * descobriu a sessão sem bilhete (armazenamento bloqueado que voltou a
   * funcionar) deixa de perguntar à toa a partir daqui.
   */
  useEffect(() => {
    if (sessao?.providerId) {
      lembrarPersonificacao({ providerId: sessao.providerId, providerNome: sessao.providerNome });
    }
  }, [sessao?.providerId, sessao?.providerNome]);

  /**
   * Reação imediata aos códigos da trava, sem esperar a próxima sondagem.
   *
   * A trava (`travaDeAcessoDeSuporte`) responde em TODA requisição de API, então
   * o veredito chega no erro do primeiro clique que a pessoa der depois da
   * queda — enquanto a sondagem levaria até um minuto. Um minuto olhando dado
   * que já não se pode ver é um minuto a mais do que o necessário.
   *
   * O erro é lido pela mensagem porque é assim que `queryClient.ts` a monta
   * (`${status}: ${corpo}`): o corpo inteiro da resposta vira o texto do Error,
   * e o `code` viaja dentro dele.
   */
  const [naoVerificado, setNaoVerificado] = useState(false);
  useEffect(() => {
    const olhar = (erro: unknown) => {
      const leitura = leituraDoCodigo(erro);
      if (leitura === "encerrada") {
        houveSessaoNestaAba = true;
        setEncerrada(true);
        // A janela morreu: o bilhete não tem mais o que lembrar, e mantê-lo
        // faria o próximo carregamento perguntar para ouvir 403.
        esquecerPersonificacao();
      } else if (leitura === "nao-verificado") {
        setNaoVerificado(true);
      }
    };
    const pararConsultas = qc.getQueryCache().subscribe((evento) => {
      if (evento.type === "updated") olhar(evento.query.state.error);
    });
    const pararMutacoes = qc.getMutationCache().subscribe((evento) => {
      if (evento.type === "updated") olhar(evento.mutation?.state.error);
    });
    return () => {
      pararConsultas();
      pararMutacoes();
    };
  }, [qc]);

  // Qualquer confirmação nova do servidor desmente o aviso de instabilidade: se
  // a rota respondeu, o banco respondeu.
  useEffect(() => {
    if (confirmadaEm) setNaoVerificado(false);
  }, [confirmadaEm]);

  /**
   * A contagem regressiva é DISPLAY, não autorização.
   *
   * Ela roda no relógio do navegador porque é o único que existe aqui, mas quem
   * decide se a janela ainda vale é o banco, a cada requisição. Se os dois
   * discordarem, o servidor ganha — e é por isso que chegar a zero aqui não
   * bloqueia nem libera nada sozinho: apenas pede confirmação a quem tem a
   * resposta.
   */
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!sessao) return;
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [sessao]);

  const restante = sessao ? restanteDaSessao(sessao.expiraEm, agora) : 0;
  const acabou = sessao != null && restante <= 0;
  useEffect(() => {
    if (acabou) qc.invalidateQueries({ queryKey: [ROTA_ESTADO_DO_ACESSO] });
  }, [acabou, qc]);

  const sair = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", ROTA_SAIR_DA_SESSAO_DE_SUPORTE);
    },
    onSuccess: () => {
      /**
       * Limpar o cache é parte do sair, não zelo.
       *
       * O cache do React Query está cheio de dado pessoal dos clientes do
       * provedor — inadimplentes, consultas, alertas. Voltar às telas da
       * plataforma sem esvaziá-lo deixaria esse dado disponível para renderizar
       * fora da janela que o autorizava. A navegação é dura (`location.href`)
       * em vez do `navigate` do wouter pelo mesmo motivo, e por mais um: o
       * `AuthProvider` só consulta `/api/auth/me` na montagem, então sem recarga
       * a aplicação continuaria se achando dentro do provedor.
       */
      esquecerPersonificacao();
      qc.clear();
      window.location.href = "/admin-sistema";
    },
  });

  /** Saída a partir do aviso de encerramento — aqui a janela já morreu. */
  const sairDepoisDoFim = () => {
    sair.mutate(undefined, {
      onError: () => {
        // O erro não muda a decisão: a autorização já não existe, e ficar parado
        // na conta do provedor é pior do que voltar sem a confirmação. A rota de
        // sair é idempotente e o servidor recusa a sessão sozinho.
        esquecerPersonificacao();
        qc.clear();
        window.location.href = "/admin-sistema";
      },
    });
  };

  if (encerrada) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="faixa-suporte-fim-titulo"
        className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-[var(--overlay)]"
        data-testid="suporte-sessao-encerrada"
      >
        <div className="w-full max-w-md rounded-lg bg-[var(--surface)] border border-[var(--danger-border)] p-5">
          <div className="flex items-center gap-2 text-[var(--danger)]">
            <ShieldAlert aria-hidden="true" className="w-4 h-4 shrink-0" />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">
              Sessão de suporte encerrada
            </span>
          </div>
          <h2
            id="faixa-suporte-fim-titulo"
            className="mt-2 text-[15px] font-medium tracking-[-0.02em] text-[var(--text)]"
          >
            A liberação acabou.
          </h2>
          <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
            O prazo terminou ou o provedor encerrou o acesso. O que está atrás desta
            mensagem é a última tela carregada e já não vale — nada ali pode ser usado
            ou copiado. Para continuar, peça uma nova liberação ao provedor.
          </p>
          <button
            type="button"
            autoFocus
            onClick={sairDepoisDoFim}
            disabled={sair.isPending}
            className={`mt-4 w-full inline-flex items-center justify-center gap-1.5 ${ALVO_CONTROLE} px-3 rounded text-[12.5px] font-medium bg-[var(--danger)] text-[var(--text-on-brand)] hover:opacity-90 ${FOCO_NA_FAIXA} ${DESABILITAVEL} motion-safe:transition-opacity`}
            data-testid="button-suporte-voltar-plataforma"
          >
            <LogOut aria-hidden="true" className="w-3.5 h-3.5" />
            {sair.isPending ? "Saindo..." : "Voltar ao painel da plataforma"}
          </button>
        </div>
      </div>
    );
  }

  if (!sessao) return null;

  return (
    <div
      role="region"
      aria-label="Sessão de suporte em andamento"
      /* `shrink-0`: a faixa empurra a página para baixo, nunca cobre — é a
         primeira linha de uma coluna flex, e o <main> abaixo continua sendo
         quem rola. Sem isto, o <main> com `flex-1` comeria a altura da faixa.

         `relative z-[60]`: no celular a barra lateral vira um Sheet em portal,
         com overlay `fixed inset-0 z-50` (client/src/components/ui/sidebar.tsx →
         ui/sheet.tsx). Sem camada própria a faixa fica no fluxo, em `z-auto`, e
         o overlay a escurece por inteiro — o aviso desaparece justamente quando
         o operador abre o menu para trocar de tela, que é o momento em que ele
         mais precisa lembrar de quem é a conta. 60 fica acima da família de
         sobreposições do app (sheet, dialog e drawer, todos em z-50) e abaixo
         do toast (z-[100]); nenhum deles muda de camada por causa disto, então o
         empilhamento entre eles continua o mesmo. A faixa tem ~36px de altura e
         cobre só o topo do que estiver aberto — na gaveta, a faixa do nome da
         marca; nenhum item de navegação, que começa abaixo dela.

         A escolha é deliberada: o aviso de que se está na conta de outra empresa
         é a única coisa desta tela que não pode ser tapada por nada. */
      className="shrink-0 relative z-[60] flex items-center gap-x-3 gap-y-1 flex-wrap px-3 py-2 bg-[var(--danger)] text-[var(--text-on-brand)]"
      data-testid="faixa-suporte"
    >
      <ShieldAlert aria-hidden="true" className="w-4 h-4 shrink-0" />
      <div className="min-w-0 flex items-baseline gap-2">
        <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.08em]">
          Suporte conectado
        </span>
        <span className="truncate text-[12.5px]" data-testid="text-suporte-provedor">
          {descricaoDoDono(sessao)} — tudo nesta tela é dado pessoal de clientes dele
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        <span className="hidden sm:inline text-[10.5px] font-semibold uppercase tracking-[0.08em] opacity-80">
          Restam
        </span>
        {/* Sem `aria-live` de propósito: um contador que muda a cada segundo em
            região viva vira ruído contínuo no leitor de tela. */}
        <span
          className="font-mono tabular-nums text-[13px] font-medium"
          data-testid="text-suporte-restante"
        >
          {formatarRestante(restante)}
        </span>
        <button
          type="button"
          onClick={() => sair.mutate()}
          disabled={sair.isPending}
          className={BOTAO_DA_FAIXA}
          data-testid="button-suporte-sair"
        >
          <LogOut aria-hidden="true" className="w-3.5 h-3.5" />
          {sair.isPending ? "Saindo..." : "Sair"}
        </button>
      </div>

      {/* Os dois avisos ficam NA faixa, e não num toast: toast some sozinho, e
          nenhuma das duas informações — "continuo dentro da conta de outra
          pessoa" e "o servidor não está confirmando a liberação" — pode sumir
          antes de ser resolvida. */}
      {naoVerificado && (
        <p className="w-full text-[12px] opacity-90" role="status">
          O servidor não está conseguindo confirmar a liberação. Enquanto isso, nada
          carrega — as telas seguem recusando por precaução.
        </p>
      )}
      {sair.isError && (
        <p className="w-full text-[12px] opacity-90" role="alert">
          Não foi possível encerrar a sessão de suporte. Tente de novo; se insistir,
          saia da sua conta.
        </p>
      )}
    </div>
  );
}

/**
 * O NOME DO PROVEDOR — de onde ele vem, e o que a faixa faz sem ele.
 *
 * "De quem é este dado" é a informação mais importante das quatro que a faixa
 * mostra. Ela vem de `GET /api/provider/acesso-suporte`, que devolve
 * `providerId` e `providerNome` junto com a janela — o nome fantasia, ou a razão
 * social quando não há fantasia. `GET /api/auth/me` NÃO serve para isso: ele
 * resolve o provedor por `user.providerId` (a coluna do usuário), que para o
 * superadmin é nula mesmo com a sessão apontando para um tenant; e
 * `GET /api/provider/profile`, que traria o nome, vem com os documentos de KYC
 * em base64 — megabytes de dado sensível puxados em toda tela só para escrever
 * um nome.
 *
 * A escada de `descricaoDoDono` continua valendo porque a leitura do provedor
 * pode falhar no servidor sem derrubar o estado do acesso (é o que
 * `nomeDoProvedor` faz de propósito). Nessa hora entra o lembrete de
 * personificação, que guarda o nome que a aba do superadmin já tinha na tela; e
 * se nem ele existir, sobra o número, e depois a frase sem identificação. O
 * aviso de que a conta é de outra pessoa nunca sai — só o nome dela.
 */
