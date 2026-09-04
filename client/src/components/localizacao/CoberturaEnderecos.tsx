/**
 * Por que um cliente está fora do mapa.
 *
 * POR QUE ISTO EXISTE. Medido na Amplinet (provedor 6) em 04/09/2026: a tela
 * dizia "184 clientes esperam plotagem · carteira sem geocodificação — fora do
 * mapa", com o botão "Plotar agora" ao lado. Verdadeiro e inútil — o dono leu e
 * concluiu que o sistema não plota. Não era isso. A base de endereços do IBGE
 * carregada no servidor cobria 9 municípios, TODOS do Paraná, a região de OUTRO
 * provedor; a região dele nunca tinha sido carregada. Dos 184, ~80 eram isso e
 * ~22 eram cadastro com cidade que não é cidade ("EMBU GAUCU", "SÃO PAUYLO",
 * "ITAP DA SERRA", "PARQUE JANDAIA"). Nada disso aparecia na tela: a cobertura
 * da base era invisível para o operador e para o provedor, e a única saída era
 * alguém com acesso ao servidor rodar um script.
 *
 * Estes dois blocos são a parte visível da correção. Eles não medem nada: quem
 * mede é `server/services/cobertura-geo.service.ts`, e a leitura chega por
 * `GET /api/localizacao/cobertura`.
 *
 * A DECISÃO DE O QUE MOSTRAR É PURA, de propósito — `planoDeCobertura`. Esta
 * tela erra caro nos dois sentidos: calada, o provedor culpa o produto; falante
 * demais, vira mais um cartão numa tela que já é densa. As duas frases têm de
 * poder ser provadas sem montar React, e é o que o teste ao lado faz.
 */
import { useEffect, useRef, type ElementType, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, MapPinOff, PencilLine, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Selo, BOTAO_MARCA, DESABILITAVEL } from "@/components/painel/ui";
import { CARD, Kicker, MONO, num } from "./ui";

/* ==================================================================== */
/* O contrato do servidor                                               */
/* ==================================================================== */

/**
 * A leitura e a ação moram no MESMO caminho, e é de propósito: o express
 * despacha por método, e o botão vizinho desta tela (`/api/localizacao/plotagem`)
 * já é assim.
 *
 * Vale a linha porque a divergência aqui nem sempre dá um 404 legível: em
 * desenvolvimento o catch-all da SPA responde a qualquer método com 200 e o
 * index.html, então um POST endereçado errado passa por `throwIfResNotOk` e só
 * estoura no `.json()` — o provedor lê um erro de parser de JavaScript num toast
 * vermelho e nenhuma base é baixada. Foi o que aconteceu enquanto isto apontava
 * para `/cobertura` e a rota estava registrada em `/cobertura/carregar`.
 */
export const ROTA_COBERTURA = "/api/localizacao/cobertura";

/** O que o servidor responde ao disparo. `iniciado`, como em `/plotagem`. */
export type RespostaDaCarga = { iniciado?: boolean; mensagem?: string };

/** Município como `server/services/municipio.service.ts` o define. */
export type Municipio = { nome: string; uf: string; ibge: string };

/** Uma cidade da carteira já resolvida contra a lista oficial de municípios. */
export type CidadeDeCobertura = {
  municipio: Municipio;
  clientes: number;
  /** Quantos desses ainda não têm coordenada — é o que a base destravaria. */
  semCoordenada: number;
  /** As grafias cruas do ERP que caíram nesta cidade. */
  grafias: string[];
  chaves: string[];
};

/**
 * Por que uma grafia não virou município. As duas pedem correção no ERP, mas
 * são correções DIFERENTES — e é por isso que o motivo vem do servidor em vez
 * de ser deduzido aqui.
 */
export type MotivoSemMunicipio = "sem_uf" | "nao_encontrada";

export type GrafiaDeCobertura = {
  chave: string;
  grafias: string[];
  clientes: number;
  semCoordenada: number;
  motivo: MotivoSemMunicipio;
};

/**
 * O estado da carga em curso.
 *
 * Ela demora minutos — são dezenas de megabytes por município, baixados do FTP
 * do IBGE um de cada vez. Sem este campo a tela ficaria idêntica antes e depois
 * do clique, e o operador clicaria de novo.
 */
export type CargaDeBase = {
  /**
   * A carga DESTA carteira está rodando. É o único sinal que autoriza a tela a
   * prometer alguma coisa a quem está olhando.
   */
  emAndamento: boolean;
  /**
   * O servidor está carregando ALGUMA base — a de outro provedor, ou a passada
   * do worker sobre a base inteira.
   *
   * A trava do servidor é global (o recurso é o FTP do IBGE e as tabelas de
   * endereço, uma só para toda a plataforma), então isto impede o disparo. Mas
   * não é a carga deste provedor: dizer "leva alguns minutos, pode sair desta
   * tela" aqui seria falso, e a passada do worker roda em todo boot e a cada
   * 24h — congelaria a tela de todo mundo.
   */
  ocupado?: boolean;
  /** Município que está sendo carregado agora, quando o servidor sabe dizer. */
  cidade?: string | null;
  concluidas?: number;
  total?: number;
  terminadaEm?: string | null;
};

/** O corpo de `GET /api/localizacao/cobertura`, na parte que esta tela usa. */
export type Cobertura = {
  clientes?: number;
  semCoordenada?: number;
  /** Cidades que já têm o cadastro de endereços carregado. Não é mostrado. */
  comBase?: CidadeDeCobertura[];
  semBase?: CidadeDeCobertura[];
  semMunicipio?: GrafiaDeCobertura[];
  carga?: CargaDeBase;
};

/* ==================================================================== */
/* A decisão: o que aparece, e com que frase                            */
/* ==================================================================== */

/** O que o botão do bloco da base pode ser. */
export type AcaoDeCarga =
  | { estado: "carregar"; rotulo: string }
  | { estado: "rodando"; rotulo: string; aviso: string }
  /** A trava do servidor está com outra carteira — o botão não funciona agora. */
  | { estado: "ocupado"; rotulo: string; aviso: string }
  | { estado: "sem_permissao"; recado: string };

export type LinhaDeCidade = {
  ibge: string;
  /** "Embu-Guaçu · SP" — o nome oficial, não a grafia do ERP. */
  rotulo: string;
  retidos: number;
  clientes: number;
};

export type BlocoSemBase = {
  titulo: string;
  explicacao: string;
  cidades: LinhaDeCidade[];
  /** Clientes que estas cidades seguram fora do mapa. */
  retidos: number;
  acao: AcaoDeCarga;
  /** O que acontece depois da carga. Muda com a permissão de quem lê. */
  rodape: string;
  /** Cidades sem base que não seguram ninguém — uma linha, não uma lista. */
  outras: string | null;
};

export type LinhaDeGrafia = {
  chave: string;
  /** As grafias como o ERP as escreveu, prontas para a tela. */
  rotulo: string;
  retidos: number;
  clientes: number;
  motivo: MotivoSemMunicipio;
  selo: string;
  /** Tom do selo — `Selo` de components/painel/ui.tsx. */
  tom: "gated" | "neutro";
};

export type BlocoSemMunicipio = {
  titulo: string;
  explicacao: string;
  itens: LinhaDeGrafia[];
  retidos: number;
  /** Uma frase por motivo PRESENTE. Explicar o que não está na lista é ruído. */
  comoCorrigir: string[];
  outras: string | null;
};

export type PlanoDeCobertura = {
  semBase: BlocoSemBase | null;
  semMunicipio: BlocoSemMunicipio | null;
  /** Clientes que os blocos explicam. Some os dois; não repete ninguém. */
  explicados: number;
  /** A sublinha do KPI "Sem coordenada" quando há diagnóstico a ler. */
  explicaOKpi: string;
};

export type OpcoesDoPlano = {
  /** Mesmo portão do "Plotar agora": operador `user` não dispara carga. */
  podeCarregar: boolean;
  /** Carga DESTA carteira em curso — inclui o intervalo entre o POST e a primeira leitura. */
  carregando: boolean;
  /** Servidor carregando a base de outra carteira. Impede o disparo, não promete nada. */
  ocupado?: boolean;
};

const plural = (n: number, um: string, muitos: string) => (n === 1 ? um : muitos);

/** "Embu-Guaçu · SP". Sem município nomeado não há linha que valha a pena. */
function rotuloDaCidade(c: CidadeDeCobertura): string {
  const nome = (c.municipio?.nome || "").trim();
  const uf = (c.municipio?.uf || "").trim();
  if (!nome) return "";
  return uf ? `${nome} · ${uf}` : nome;
}

/**
 * As grafias de uma chave, como o ERP as escreveu.
 *
 * Mais de uma é comum ("EMBU GAUCU" e "Embu Gaucu" colapsam na mesma chave), e
 * mostrar todas ajuda quem vai procurá-las no ERP. A partir da terceira o
 * resto vira contagem: a linha tem de caber.
 */
export function rotuloDasGrafias(grafias: string[]): string {
  const limpas = grafias.map(g => (g || "").trim()).filter(Boolean);
  if (limpas.length === 0) return "";
  if (limpas.length <= 3) return limpas.join(" · ");
  return `${limpas.slice(0, 3).join(" · ")} +${limpas.length - 3}`;
}

const SELO_DO_MOTIVO: Record<MotivoSemMunicipio, { selo: string; tom: "gated" | "neutro" }> = {
  // O cadastro não diz o estado, e "ITAPECERICA" existe em SP e em MG. Não há
  // erro de digitação nenhum aqui — falta um campo, e o selo não acusa.
  sem_uf: { selo: "sem estado", tom: "neutro" },
  // Erro de digitação, ou bairro escrito no campo da cidade.
  nao_encontrada: { selo: "não confere", tom: "gated" },
};

const COMO_CORRIGIR: Record<MotivoSemMunicipio, string> = {
  sem_uf:
    "“sem estado”: o nome existe em mais de um estado e o cadastro não diz qual. " +
    "Basta preencher o estado destes clientes.",
  nao_encontrada:
    "“não confere”: quase sempre é um erro de digitação, ou o nome de um bairro " +
    "escrito no campo da cidade.",
};

/**
 * O plano da tela. `null` = nenhum bloco.
 *
 * DUAS DECISÕES QUE VALEM O COMENTÁRIO:
 *
 * 1. **Só entra na lista quem segura alguém fora do mapa.** Uma cidade sem base
 *    cujos clientes já estão todos plotados não responde à pergunta desta tela
 *    ("por que este cliente está fora do mapa?"), e a seção 4 do DESIGN_SYSTEM
 *    trata densidade como decisão de produto: cartão que não muda nada é ruído.
 *    O que se perde: carregar a base também MELHORA a precisão de quem já está
 *    plotado por aproximação — e isso a tela deliberadamente não promete, porque
 *    esta leitura não sabe a precisão de ninguém.
 * 2. **O que sobrou não some.** As cidades e grafias que não seguram ninguém
 *    viram uma linha de contagem no fim do bloco, nunca silêncio. A falha que
 *    originou esta tela foi exatamente uma verdade invisível; trocá-la por outra,
 *    menor, seria repetir o erro em escala menor.
 */
export function planoDeCobertura(
  cobertura: Cobertura | null | undefined,
  opcoes: OpcoesDoPlano,
): PlanoDeCobertura | null {
  if (!cobertura) return null;

  const semBase = planoDaBase(cobertura.semBase ?? [], opcoes);
  const semMunicipio = planoDasGrafias(cobertura.semMunicipio ?? []);
  if (!semBase && !semMunicipio) return null;

  return {
    semBase,
    semMunicipio,
    explicados: (semBase?.retidos ?? 0) + (semMunicipio?.retidos ?? 0),
    explicaOKpi: SUB_SEM_COORDENADA_COM_DIAGNOSTICO,
  };
}

/** A sublinha do KPI "Sem coordenada" quando não há o que diagnosticar. */
export const SUB_SEM_COORDENADA_PADRAO = "carteira sem geocodificação — fora do mapa";

/**
 * A mesma sublinha quando HÁ.
 *
 * Este cartão é o que o dono leu antes de concluir que o sistema não plota. A
 * frase antiga estava certa e não levava a lugar nenhum; esta manda o olho três
 * centímetros abaixo, onde está a causa.
 */
export const SUB_SEM_COORDENADA_COM_DIAGNOSTICO = "fora do mapa — o que falta está logo abaixo";

/**
 * Decide a sublinha do KPI. É a mesma decisão dos blocos, e por isso passa pela
 * mesma função — o KPI não pode apontar para baixo quando não há bloco nenhum.
 */
export function subDoKpiSemCoordenada(
  cobertura: Cobertura | null | undefined,
  podeCarregar: boolean,
): string {
  // `carregando` não muda QUAIS blocos existem, só o rótulo do botão. Aqui ele
  // não importa, e passá-lo obrigaria a página a conhecer o estado da mutação.
  const plano = planoDeCobertura(cobertura, { podeCarregar, carregando: false });
  return plano ? plano.explicaOKpi : SUB_SEM_COORDENADA_PADRAO;
}

function planoDaBase(
  cidades: CidadeDeCobertura[],
  { podeCarregar, carregando, ocupado }: OpcoesDoPlano,
): BlocoSemBase | null {
  const comNome = cidades.filter(c => rotuloDaCidade(c) !== "");
  const seguram = comNome
    .filter(c => (Number(c.semCoordenada) || 0) > 0)
    // Quem segura mais gente primeiro: é a ordem em que a carga devolve cliente
    // plotado por megabyte baixado.
    .sort((a, b) => b.semCoordenada - a.semCoordenada || b.clientes - a.clientes);

  if (seguram.length === 0) return null;

  const retidos = seguram.reduce((s, c) => s + (Number(c.semCoordenada) || 0), 0);
  const uma = seguram.length === 1;
  /* Com uma cidade só a frase a NOMEIA — "de Embu-Guaçu" diz mais do que "de 1
     cidade sua", e o provedor reconhece a praça dele. Sem a UF: o texto já é
     uma frase, e "de Embu-Guaçu · SP" leria como etiqueta. */
  const cidadeUnica = uma ? seguram[0].municipio.nome.trim() : null;
  const ondeFalta = cidadeUnica ? `de ${cidadeUnica}` : "das cidades abaixo";
  const restantes = comNome.length - seguram.length;

  const acao: AcaoDeCarga = !podeCarregar
    ? {
        estado: "sem_permissao",
        recado: "Só um administrador da conta pode carregar a base.",
      }
    : carregando
      ? {
          estado: "rodando",
          rotulo: "Carregando…",
          aviso:
            "São dezenas de megabytes por cidade e leva alguns minutos. " +
            "Pode sair desta tela: a carga continua no servidor.",
        }
      : ocupado
        ? {
            /* A trava do servidor é global — o FTP do IBGE e as tabelas de
               endereço são um recurso só —, então clicar agora não adiantaria.
               O recado é neutro de propósito: nenhuma cidade DESTE provedor
               está sendo baixada, e prometer progresso aqui seria falso. */
            estado: "ocupado",
            rotulo: uma ? "Carregar a base" : "Carregar as bases",
            aviso: "O servidor está carregando outra base agora. Assim que terminar, este botão volta.",
          }
        : { estado: "carregar", rotulo: uma ? "Carregar a base" : "Carregar as bases" };

  return {
    titulo: retidos === 1
      ? `1 cliente espera a base de endereços ${uma ? ondeFalta : "da região dele"}`
      : `${num(retidos)} clientes esperam a base de endereços ${uma ? ondeFalta : `de ${num(seguram.length)} cidades suas`}`,
    explicacao:
      "Para pôr um cliente no ponto certo do mapa, o sistema usa o cadastro de endereços " +
      `que o IBGE publica município por município. O ${ondeFalta} ` +
      "ainda não foi carregado aqui — é isso que segura estes clientes fora do mapa, e não " +
      "o endereço que eles têm no seu cadastro.",
    cidades: seguram.map(c => ({
      ibge: c.municipio.ibge,
      rotulo: rotuloDaCidade(c),
      retidos: Number(c.semCoordenada) || 0,
      clientes: Number(c.clientes) || 0,
    })),
    retidos,
    acao,
    /* Carregar a base não põe ninguém no mapa: quem plota é a varredura. Ela
       agora é DISPARADA logo depois da carga, quando alguma base entrou (a rota
       encadeia as duas), então a frase antiga — "entram na próxima varredura, ou
       use Plotar agora" — passou a mentir por excesso de cautela e a mandar o
       operador a um botão que ele nem sempre enxerga. Uma frase só, e ela
       continua sem prometer mapa cheio no instante do clique: os pontos aparecem
       à medida que cada endereço resolve. */
    rodape:
      "Carregada a base, a plotagem destas cidades começa em seguida, sozinha — " +
      "os pontos aparecem no mapa conforme forem resolvidos.",
    outras: restantes > 0
      ? (restantes === 1
          ? "Outra cidade sua também não tem base carregada, mas nenhum cliente dela está fora do mapa."
          : `Outras ${num(restantes)} cidades suas também não têm base carregada, mas nenhum cliente delas está fora do mapa.`)
      : null,
  };
}

function planoDasGrafias(grafias: GrafiaDeCobertura[]): BlocoSemMunicipio | null {
  const comRotulo = grafias.filter(g => rotuloDasGrafias(g.grafias ?? []) !== "");
  const seguram = comRotulo
    .filter(g => (Number(g.semCoordenada) || 0) > 0)
    .sort((a, b) => b.semCoordenada - a.semCoordenada || b.clientes - a.clientes);

  if (seguram.length === 0) return null;

  const retidos = seguram.reduce((s, g) => s + (Number(g.semCoordenada) || 0), 0);
  const restantes = comRotulo.length - seguram.length;

  const itens: LinhaDeGrafia[] = seguram.map(g => ({
    chave: g.chave,
    rotulo: rotuloDasGrafias(g.grafias),
    retidos: Number(g.semCoordenada) || 0,
    clientes: Number(g.clientes) || 0,
    motivo: g.motivo,
    ...SELO_DO_MOTIVO[g.motivo],
  }));

  // Na ordem em que os selos aparecem na lista — a explicação abaixo tem de
  // seguir o olho, não a ordem em que o enum foi escrito.
  const motivosPresentes: MotivoSemMunicipio[] = [];
  for (const i of itens) if (!motivosPresentes.includes(i.motivo)) motivosPresentes.push(i.motivo);

  return {
    titulo: retidos === 1
      ? "1 cliente tem no cadastro uma cidade que não confere"
      : `${num(retidos)} clientes têm no cadastro uma cidade que não confere`,
    explicacao:
      "O sistema procura a cidade do cliente na lista oficial de municípios do IBGE. " +
      `${plural(itens.length, "A grafia abaixo não bate", "As grafias abaixo não batem")} com nenhum ` +
      "município, então não há onde procurar o endereço — e nenhuma correção automática resolve " +
      "isso. O ajuste é no seu ERP: corrija a cidade destes clientes e, na sincronização " +
      "seguinte, eles entram na fila do mapa.",
    itens,
    retidos,
    comoCorrigir: motivosPresentes.map(m => COMO_CORRIGIR[m]),
    outras: restantes > 0
      ? (restantes === 1
          ? "Outra grafia também não confere, mas os clientes dela já estão no mapa."
          : `Outras ${num(restantes)} grafias também não conferem, mas os clientes delas já estão no mapa.`)
      : null,
  };
}

/* ==================================================================== */
/* A tela                                                               */
/* ==================================================================== */

/** Linha de item dos dois blocos: rótulo à esquerda, números à direita. */
function Linha({
  rotulo, retidos, clientes, mono, selo,
}: {
  rotulo: string;
  retidos: number;
  clientes: number;
  /** Grafia do ERP é dado, e dado é mono. Nome de município é texto. */
  mono?: boolean;
  selo?: ReactNode;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 py-[7px] border-b border-[var(--border-faint)] last:border-b-0"
    >
      <span className="min-w-0 flex items-baseline gap-2">
        {/* `min-w-0` no próprio item que trunca, e não só no pai: sem ele um
            item flex nunca encolhe abaixo do conteúdo e o `truncate` não corta
            nada — a linha é que estoura para o lado. */}
        <span
          className="min-w-0 text-[12.5px] text-[var(--text)] truncate"
          style={mono ? MONO : undefined}
          title={rotulo}
        >
          {rotulo}
        </span>
        {selo}
      </span>
      <span className="flex-none flex items-baseline gap-1.5">
        <span style={{ ...MONO, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {num(retidos)}
        </span>
        <span style={{ ...MONO, fontSize: 10.5, color: "var(--text-faint)" }}>
          de {num(clientes)}
        </span>
      </span>
    </div>
  );
}

function Bloco({
  Icone, kicker, titulo, explicacao, testId, children,
}: {
  Icone: ElementType;
  kicker: string;
  titulo: string;
  explicacao: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div style={{ ...CARD, display: "flex", flexDirection: "column" }} data-testid={testId}>
      <div className="px-4 pt-3 pb-2.5 border-b border-[var(--border-faint)]">
        <span className="inline-flex items-center gap-2">
          <Icone size={14} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
          <Kicker style={{ fontSize: 11 }}>{kicker}</Kicker>
        </span>
        {/* `tabular-nums` mas NÃO mono: a seção 2 pede mono em dado e rótulo, e
            aqui o número está dentro de uma frase. A régua tabular vale sempre —
            é o que impede o título de dançar quando 80 vira 79. A coluna de
            números de verdade, essa é mono, e está em `Linha`. */}
        <p className="text-[13.5px] font-semibold text-[var(--text)] leading-tight mt-2 tabular-nums">
          {titulo}
        </p>
        {/* `max-w` em ch porque o bloco ocupa a largura inteira da página
            quando é o único: sem teto, a explicação viraria uma linha de 200
            caracteres num monitor largo e ninguém a leria até o fim. */}
        <p className="text-[11.5px] text-[var(--text-2)] leading-relaxed mt-1.5 max-w-[86ch]">
          {explicacao}
        </p>
      </div>
      <div className="px-4 py-2.5">{children}</div>
    </div>
  );
}

/**
 * Os blocos de cobertura. Renderiza nada quando não há nada a dizer — a tela já
 * é densa, e "tudo certo" num cartão próprio é ruído.
 *
 * A página lê a MESMA query para a sublinha do KPI (`subDoKpiSemCoordenada`).
 * São duas leituras da mesma chave, e o React Query as atende com uma requisição
 * só; devolver o plano por callback criaria estado da página derivado de um
 * objeto novo a cada render, que é laço de renderização.
 */
export default function CoberturaEnderecos({ podeCarregar }: { podeCarregar: boolean }) {
  const { toast } = useToast();
  const clienteDeQuery = useQueryClient();

  const { data } = useQuery<Cobertura>({
    queryKey: [ROTA_COBERTURA],
    /* Enquanto a carga DESTA carteira roda, a tela tem de mudar sozinha: são
       minutos, e o operador que não vê progresso clica de novo. Quando quem
       está carregando é outra carteira (a passada do worker cobre a base
       inteira, roda em todo boot e a cada 24h, e pode durar horas), a tela não
       tem progresso nenhum a mostrar — só precisa saber quando o botão volta, e
       um minuto basta. Com um intervalo só, essa passada punha TODO provedor
       com a tela aberta a consultar o servidor de 10 em 10 segundos. */
    refetchInterval: q => {
      const carga = (q.state.data as Cobertura | undefined)?.carga;
      if (carga?.emAndamento) return 10_000;
      return carga?.ocupado ? 60_000 : false;
    },
  });

  const carregar = useMutation({
    mutationFn: async (): Promise<RespostaDaCarga> => (await apiRequest("POST", ROTA_COBERTURA)).json(),
    // `iniciado`, no masculino, é o que o servidor manda — e é o mesmo campo do
    // POST /api/localizacao/plotagem, o botão vizinho desta tela. Enquanto isto
    // dizia `iniciada`, o segundo clique numa carga em curso recebia
    // `{iniciado:false}`, a condição falhava e a tela titulava "Carga iniciada"
    // com a mensagem de "já em andamento" logo abaixo, se contradizendo.
    onSuccess: (r: RespostaDaCarga) => {
      toast({
        title: r?.iniciado === false ? "Carga já em andamento" : "Carga iniciada",
        description: r?.mensagem ?? "Baixando o cadastro de endereços do IBGE. Leva alguns minutos.",
      });
      clienteDeQuery.invalidateQueries({ queryKey: [ROTA_COBERTURA] });
    },
    onError: (e: Error) =>
      toast({ title: "Não foi possível carregar", description: e.message, variant: "destructive" }),
  });

  /**
   * DUAS PERGUNTAS DIFERENTES, e pendurá-las na mesma variável produzia um
   * anúncio falso.
   *
   * "O botão pode ser clicado?" inclui `isPending`, para tapar a janela entre o
   * POST e a primeira leitura que já vem com `emAndamento` — é justamente nela
   * que o operador clicaria de novo.
   *
   * "A carga terminou?" NÃO pode depender de `isPending`. A rota responde 202 na
   * hora, por desenho, então a mutação assenta segundos depois do clique
   * enquanto o refetch ainda está no ar e `data` ainda é a foto anterior: existe
   * um render garantido com `isPending` falso e `emAndamento` falso. Nele o
   * efeito anunciava "Base de endereços carregada" com a carga apenas começando
   * — e no caminho de erro anunciava sucesso logo depois do toast vermelho.
   * O sinal do fim é só do servidor, e exige ter visto o começo.
   */
  const minhaCarga = data?.carga?.emAndamento === true;
  const servidorOcupado = data?.carga?.ocupado === true;
  const rodando = minhaCarga || carregar.isPending;

  const plano = planoDeCobertura(data, {
    podeCarregar, carregando: rodando, ocupado: servidorOcupado,
  });

  // Fim da carga: as cidades saem da lista sozinhas na próxima leitura, mas o
  // provedor precisa saber que terminou — ele pode ter saído da tela e voltado.
  const viRodando = useRef(false);
  useEffect(() => {
    if (minhaCarga) { viRodando.current = true; return; }
    if (!viRodando.current) return;
    viRodando.current = false;
    toast({
      title: "Base de endereços carregada",
      description: "A plotagem destas cidades começa em seguida; os pontos aparecem conforme forem resolvidos.",
    });
    clienteDeQuery.invalidateQueries({ queryKey: ["/api/localizacao"] });
    clienteDeQuery.invalidateQueries({ queryKey: ["/api/localizacao/plotagem"] });
  }, [minhaCarga, toast, clienteDeQuery]);

  if (!plano) return null;
  // Locais em vez da cadeia inteira repetida: o estreitamento do tipo fica
  // óbvio para quem lê e para o compilador.
  const base = plano.semBase;
  const grafias = plano.semMunicipio;
  const ambos = !!base && !!grafias;

  return (
    <div className={`grid gap-3 ${ambos ? "lg:grid-cols-2" : ""}`} data-testid="cobertura-enderecos">
      {base && (
        <Bloco
          Icone={MapPinOff}
          kicker="Base de endereços"
          titulo={base.titulo}
          explicacao={base.explicacao}
          testId="cobertura-sem-base"
        >
          <div className="max-h-[220px] overflow-y-auto">
            {base.cidades.map(c => (
              <Linha key={c.ibge} rotulo={c.rotulo} retidos={c.retidos} clientes={c.clientes} />
            ))}
          </div>

          {base.outras && (
            <p className="text-[11px] text-[var(--text-faint)] leading-snug max-w-[86ch] tabular-nums mt-2.5">
              {base.outras}
            </p>
          )}

          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3"
            role="status"
            aria-live="polite"
            data-testid="cobertura-acao"
          >
            {base.acao.estado === "sem_permissao" ? (
              <p className="text-[11.5px] text-[var(--text-muted)]">{base.acao.recado}</p>
            ) : (
              <>
                {/* Fora de serviço tanto na carga deste provedor quanto com o
                    servidor ocupado por outra carteira: a trava do servidor é
                    global, então o clique seria recusado de qualquer jeito. */}
                <button
                  type="button"
                  onClick={() => carregar.mutate()}
                  disabled={base.acao.estado !== "carregar"}
                  className={`${BOTAO_MARCA} ${DESABILITAVEL}`}
                  data-testid="botao-carregar-base"
                >
                  {base.acao.estado === "rodando" ? (
                    <RefreshCw className="w-3.5 h-3.5 flex-none motion-safe:animate-spin" strokeWidth={2} />
                  ) : (
                    <Download className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
                  )}
                  {base.acao.rotulo}
                </button>
                {(base.acao.estado === "rodando" || base.acao.estado === "ocupado") && (
                  <p className="text-[11.5px] text-[var(--text-2)] leading-snug flex-1 min-w-[220px]">
                    {base.acao.aviso}
                  </p>
                )}
              </>
            )}
          </div>

          <p className="text-[11px] text-[var(--text-faint)] leading-snug max-w-[86ch] tabular-nums mt-2.5">
            {base.rodape}
          </p>
        </Bloco>
      )}

      {grafias && (
        <Bloco
          Icone={PencilLine}
          kicker="Cidade no cadastro"
          titulo={grafias.titulo}
          explicacao={grafias.explicacao}
          testId="cobertura-sem-municipio"
        >
          <div className="max-h-[220px] overflow-y-auto">
            {grafias.itens.map(i => (
              <Linha
                key={i.chave}
                rotulo={i.rotulo}
                retidos={i.retidos}
                clientes={i.clientes}
                mono
                selo={<Selo tom={i.tom}>{i.selo}</Selo>}
              />
            ))}
          </div>

          {grafias.outras && (
            <p className="text-[11px] text-[var(--text-faint)] leading-snug max-w-[86ch] tabular-nums mt-2.5">
              {grafias.outras}
            </p>
          )}

          <div className="mt-2.5 space-y-1">
            {grafias.comoCorrigir.map(frase => (
              <p key={frase} className="text-[11px] text-[var(--text-faint)] leading-snug max-w-[86ch] tabular-nums">
                {frase}
              </p>
            ))}
          </div>
        </Bloco>
      )}
    </div>
  );
}
