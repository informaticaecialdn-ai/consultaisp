import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { usePrecos, camposDaFatura, planoPorChave } from "@/hooks/use-precos";
import { rotuloDoPlano } from "@/lib/planos";
import {
  CabecalhoPainel, CartaoMetrica, KickerSecao, Selo, EstadoVazio, LinhasSkeleton,
  LadrilhoIcone, LadrilhoInicial, TabelaPainel, Th, Td,
  Dinheiro, MolduraModal, AvisoNaoCarregou, Campo,
  TITULO_CARTAO, TITULO_MODAL, ALVO_CONTROLE, BOTAO_SECUNDARIO, BOTAO_MARCA,
  CAIXA_ICONE, CONTROLE_CAMPO, ROTULO_CAMPO, TABELA_NUM, DESABILITAVEL, FOCO,
  type TomSelo, type Icone,
} from "@/components/painel/ui";
import { PLAN_LABELS, VERIFICATION_LABELS } from "@/components/admin/constants";
import {
  ArrowLeft, Building2, Users, CreditCard, BarChart3, Activity,
  Globe, Mail, Calendar, Shield, CheckCircle, XCircle,
  Plus, RefreshCw, FileText, Search, MapPin,
  AlertCircle, Zap, Star, Edit2, Save, X, Eye,
  Ban, Copy, Wifi, Database, AlertTriangle, ChevronRight,
  KeyRound, Receipt, History, ScanSearch, IdCard, Lock, LogIn,
} from "lucide-react";
import FormularioErp, { type ConectorMeta } from "@/components/erp/FormularioErp";
import { lembrarPersonificacao } from "@/components/FaixaSuporte";
import {
  cadastroDoProvedor, corpoDoPatch, errosDoCadastro,
  aplicarEmpresaPublica, aplicarViaCep, opcoesComValorAtual,
  cnpjCru, cnpjMascarado, cepCru, cepMascarado,
  CAMPOS_DO_CADASTRO, SEGMENTOS, TIPOS_SOCIETARIOS, type CadastroProvedor,
} from "./cadastro-provedor";

/**
 * O PLANO SAI DO CATALOGO DO PAINEL, NAO DE UMA COPIA DESTA TELA.
 *
 * Aqui morava um `PLANO_VISUAL` — a quinta copia do mapa de plano do cliente —
 * com rotulo repetido e classe de cor escrita a mao. `@/components/admin/constants`
 * ja publica `PLAN_LABELS` com `{ label, tom }`, e o `tom` alimenta o `<Selo>`
 * da primitiva: uma decisao de cor, valida para os dois paineis.
 *
 * (Antes do `PLANO_VISUAL` morava aqui um `PLAN_CONFIG` com preco e credito
 * cravados — basic 199, pro 399 — que ninguem sincronizou quando a tabela virou
 * `shared/planos.ts`. O cartao anunciava "Mensalidade R$ 399,00" e o modal de
 * fatura abria com esse valor num plano que `generate-monthly` cobra a R$ 99.
 * Preco e credito continuam vindo so de `usePrecos()`, que e o servidor.)
 *
 * Plano desconhecido cai em `rotuloDoPlano`, que devolve a propria chave — e
 * tom neutro, porque nao ha o que afirmar sobre um plano que o catalogo nao tem.
 */
function seloDoPlano(chave: string | null | undefined): { label: string; tom: TomSelo } {
  return PLAN_LABELS[(chave || "").trim()] ?? { label: rotuloDoPlano(chave), tom: "neutro" };
}

/**
 * A SITUACAO DO PROVEDOR, EM PORTUGUES E SEM CHUTE.
 *
 * O mapa anterior tinha `active`, `inactive` e `suspended`, e o fallback era
 * `STATUS_CONFIG.active` — ou seja, um provedor `cancelled` (valor que a coluna
 * `providers.status` admite desde sempre) aparecia como **Ativo**, em verde, nas
 * duas telas onde o selo sai. Afirmar saude a partir de um valor que a tela nao
 * reconhece e o pior desfecho possivel numa ficha de conta.
 *
 * Agora `cancelled` tem nome proprio e o desconhecido cai em neutro dizendo que
 * nao sabe — nunca no identificador cru da coluna (secao 8 do DESIGN_SYSTEM).
 */
const SITUACAO_PROVEDOR: Record<string, { label: string; tom: TomSelo }> = {
  active: { label: "Ativo", tom: "ok" },
  inactive: { label: "Inativo", tom: "neutro" },
  suspended: { label: "Suspenso", tom: "danger" },
  cancelled: { label: "Cancelado", tom: "danger" },
};

const SITUACAO_DESCONHECIDA = { label: "Situação não informada", tom: "neutro" } as const;

/** Situacao da fatura. `overdue` e risco de verdade; `pending` e a porta que
 *  ainda nao abriu. Um status fora dos quatro nao vira texto cru na tela. */
const SITUACAO_FATURA: Record<string, { label: string; tom: TomSelo }> = {
  pending: { label: "Pendente", tom: "gated" },
  paid: { label: "Paga", tom: "ok" },
  overdue: { label: "Vencida", tom: "danger" },
  cancelled: { label: "Cancelada", tom: "neutro" },
};

/**
 * O ESTADO DESABILITADO VEM DA PRIMITIVA, e nao mais desta tela.
 *
 * `BOTAO_SECUNDARIO` e `BOTAO_MARCA` nao carregam `:disabled` — sao classes de
 * aparencia, e o `<Button>` do shadcn e que trazia isso. Um botao travado
 * (salvando, sem tabela de precos, sem e-mail valido) ficaria identico ao
 * clicavel, e o operador clicaria achando que nao respondeu.
 *
 * O valor morava aqui, e era o quarto valor diferente do painel: opacidade 40 e
 * `pointer-events-none` junto de `cursor-not-allowed`. Os dois ultimos se
 * anulam — sem eventos de ponteiro o cursor nunca troca, e o cursor e a unica
 * coisa que AVISA que o controle esta travado. Todos os desabilitados desta
 * tela sao `<button disabled>`, que o navegador ja ignora sozinho. Agora e
 * `DESABILITAVEL` de `painel/ui`: opacidade 50 (o rotulo do botao travado e
 * justamente o que explica o que falta fazer) e so o cursor.
 */

/* A CORTINA DOS MODAIS SAIU DAQUI.
   Era `VEU_MODAL`, uma constante local com a cortina em `--overlay` — o token
   certo, e foi essa a correcao da rodada anterior. O que ela nao tinha era o
   resto do que faz um modal: `role="dialog"`, `aria-modal` e um nome. Isso
   existia so dentro dos dois modais do Asaas, porque a casca era privada do
   arquivo do financeiro. Agora a casca e `MolduraModal`, da primitiva, e ela
   traz a cortina junto — uma declaracao a menos que possa divergir. */

/**
 * As abas da ficha. A CHAVE e contrato — ela vai no `data-testid` e no estado
 * da tela —, o rotulo e texto de gente e leva acento (secao 8). "ERP" fica: e a
 * palavra que o proprio provedor usa para o sistema dele.
 */
const ABAS: { chave: string; rotulo: string; Icone: Icone }[] = [
  { chave: "geral", rotulo: "Geral", Icone: Building2 },
  { chave: "financeiro", rotulo: "Financeiro", Icone: Receipt },
  { chave: "usuarios", rotulo: "Usuários", Icone: Users },
  { chave: "consumo", rotulo: "Consumo", Icone: ScanSearch },
  { chave: "historico", rotulo: "Histórico", Icone: History },
  { chave: "integracao", rotulo: "Integração ERP", Icone: Database },
  /* Fica por ULTIMO de propósito. É o caminho mais raro da ficha — só existe
     enquanto o provedor mantém uma liberação aberta — e enfiá-lo antes de
     "Integração ERP" trocaria a posição de uma aba que o operador já sabe onde
     encontrar. */
  { chave: "suporte", rotulo: "Acesso de suporte", Icone: KeyRound },
];

/**
 * O FORMATADOR DE REAL SAIU DAQUI.
 *
 * Morava nesta tela um `fmt()` proprio — o quarto formatador de real do produto
 * —, e o defeito nao era a duplicacao: era o que ele DEVOLVIA. Uma string crua.
 * Entregue a `<CartaoMetrica valor={...}>` ela herda o mono tabular do slot de
 * numero por acaso, e num `<span>` qualquer nao herda nada; foi assim que o
 * mesmo valor saiu em Inter em uma tela e em mono em outra. `<Dinheiro>` carrega
 * o proprio mono tabular (secao 2) e a tinta de negativo, entao o valor chega
 * certo em qualquer lugar onde couber um elemento.
 *
 * `fmtDate`/`fmtDateTime` continuam devolvendo texto porque data nao tem
 * primitiva propria: quem as usa envolve em `<Num>`, que e o envelope mono desta
 * tela.
 */
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR");
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR");
}

/**
 * Data de abertura em dd/mm/aaaa, SEM passar por `new Date`.
 *
 * `openingDate` e coluna TEXT com ISO so-data. Entregue a `fmtDate`, o
 * "2015-03-27" e lido como meia-noite UTC e, em Brasilia (UTC-3), volta como
 * 26/03/2015: a ficha mostraria a empresa aberta um dia antes do que a Receita
 * registrou.
 *
 * Valor fora do formato sai COMO ESTA, e nao como "—" nem "Invalid Date": se
 * alguma linha antiga guarda "27/03/2015", o superadmin precisa VER para poder
 * corrigir no formulario.
 */
function fmtDataIso(v: string | null | undefined) {
  const t = (v ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return t || "—";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Todo numero desta tela e mono e tabular (secao 2). Quando ele mora no meio
 *  de uma frase em Inter, este e o envelope. Vale para CPF, CNPJ, data, valor,
 *  contagem e endereco tecnico — tudo que se le coluna por coluna.
 *
 *  As classes vem de `TABELA_NUM`, a `.num` da secao 6 que a primitiva publica:
 *  redigita-las aqui faria o numero em prosa divergir do numero em coluna no
 *  primeiro ajuste. O componente existe so para poupar o `cn()` em ~40 pontos. */
function Num({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <span className={cn(TABELA_NUM, className)} data-testid={testId}>
      {children}
    </span>
  );
}

/**
 * Junta pedacos com um separador de texto — o `join` que `Array.join` nao faz.
 *
 * Existe porque o endereco da LEITURA mistura texto e numero: rua e bairro sao
 * prosa, numero e UF sao dado que se le caractere a caractere e por isso vao
 * dentro de `<Num>` (secao 2). Com um elemento no meio, `join` chamaria
 * `String(elemento)` e imprimiria "[object Object]".
 */
function juntarPedacos(pedacos: React.ReactNode[], separador: string): React.ReactNode {
  return pedacos.map((pedaco, i) => (
    <Fragment key={i}>{i > 0 ? separador : null}{pedaco}</Fragment>
  ));
}

/** Linha de par rotulo/valor dentro de cartao. Separador de hairline, nunca a
 *  borda default do Tailwind — `border-b` sozinho pinta a cor herdada. */
function LinhaDado({ rotulo, children }: { rotulo: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border-faint)] last:border-0">
      <span className="text-[12.5px] text-[var(--text-muted)]">{rotulo}</span>
      {children}
    </div>
  );
}

function SeloFatura({ status }: { status: string }) {
  const s = SITUACAO_FATURA[status] ?? { label: "Situação desconhecida", tom: "neutro" as TomSelo };
  return <Selo tom={s.tom}>{s.label}</Selo>;
}

/**
 * Cabecalho de cartao com icone — o mesmo corpo do `TITULO_CARTAO` da
 * primitiva, sobre a superficie de segundo nivel. E o molde que o Painel Geral
 * (VisaoGeralTab) ja usa; aqui ele vira funcao porque esta tela tem sete deles.
 */
function TopoCartao({
  titulo,
  sub,
  Icone: IconeTopo,
  acao,
  testId,
}: {
  titulo: React.ReactNode;
  sub?: React.ReactNode;
  Icone?: Icone;
  acao?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3"
      data-testid={testId}
    >
      <div className="min-w-0">
        <h3 className={cn(TITULO_CARTAO, "flex items-center gap-2")}>
          {IconeTopo && (
            <IconeTopo className="w-4 h-4 flex-none text-[var(--text-faint)]" strokeWidth={2} />
          )}
          {titulo}
        </h3>
        {sub && <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
      </div>
      {acao}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A ficha cadastral — vocabulario do formulario                       */
/* ------------------------------------------------------------------ */

/** A frase do erro sob o campo culpado. Tinta de risco, corpo menor que o dado. */
const ERRO_CAMPO = "mt-1 block text-[11.5px] text-[var(--danger)]";

/** Nota auxiliar sob o campo (formato esperado, o que a busca fez). */
const DICA_CAMPO = "mt-1 block text-[11.5px] text-[var(--text-muted)]";

/**
 * A situacao cadastral na Receita e REGULAR?
 *
 * A comparacao era `situacao !== "ATIVA"`, letra por letra. As tres fontes
 * escrevem o mesmo fato de jeitos diferentes — a ReceitaWS e a BrasilAPI mandam
 * "ATIVA", a cnpj.ws manda "Ativa" —, e a terceira e justamente a que responde
 * quando as duas primeiras devolvem 429. O resultado era o aviso ambar de
 * irregularidade aceso para uma empresa perfeitamente regular.
 *
 * Quem le esse aviso e o superadmin, que pode REPROVAR ou SUSPENDER o provedor
 * com base nele — e as duas acoes disparam e-mail, que nao da para voltar atras.
 *
 * O servico ja canoniza a situacao para caixa alta (`situacaoCanonica`), e essa
 * e a correcao de fundo. Aqui a comparacao normaliza de novo de proposito: esta
 * tela nao pode depender de um contrato de outra frente para deixar de acusar
 * irregularidade de quem nao tem nenhuma.
 *
 * SEM INFORMACAO E REGULAR: ausencia de situacao nao e prova de situacao ruim,
 * e um aviso disparado no vazio seria a mesma acusacao sem fato.
 */
function situacaoRegular(bruta: string | null | undefined): boolean {
  const t = String(bruta ?? "")
    .trim().replace(/\s+/g, " ").toUpperCase();
  return t === "" || t === "ATIVA" || t === "ATIVO";
}

/**
 * O `errors` do 400, virando a frase de cada campo culpado.
 *
 * O servidor responde `{ message: "Dados invalidos", errors: fieldErrors }`, e a
 * tela jogava o `errors` fora: com dezessete campos, o operador ficava com um
 * toast generico e nenhuma pista de qual deles reprovou — e o PATCH e tudo ou
 * nada, entao as outras dezesseis correcoes tambem nao gravaram.
 *
 * So as chaves do cadastro entram. Erro de chave desconhecida cai em
 * `formErrors`, e nao aqui; e um nome que nao seja campo da ficha nao tem caixa
 * onde ser pintado — ele fica no toast, que continua repetindo a frase do
 * servidor.
 *
 * A frase vai VERBATIM. Zod so escreve em portugues onde o schema deu mensagem
 * propria ("CNPJ deve ter 14 digitos"); no resto ela vem em ingles. Traduzir por
 * cima seria adivinhar, e a alternativa — cair no generico — e exatamente o
 * defeito que este mapa existe para consertar. Quem enquadra em portugues e o
 * aviso do topo do formulario.
 */
function errosDoServidorNaResposta(corpo: any): Partial<Record<keyof CadastroProvedor, string>> {
  const campos = corpo?.errors;
  if (!campos || typeof campos !== "object") return {};
  const mapa: Partial<Record<keyof CadastroProvedor, string>> = {};
  for (const campo of CAMPOS_DO_CADASTRO) {
    const frases = (campos as Record<string, unknown>)[campo];
    const frase = Array.isArray(frases) ? frases.find(f => typeof f === "string" && f) : frases;
    if (typeof frase === "string" && frase.trim()) mapa[campo] = frase.trim();
  }
  return mapa;
}

/**
 * O 409 tambem tem campo culpado.
 *
 * `cnpj` e `subdomain` sao UNIQUE, e o servidor responde 409 nomeando o provedor
 * que ja tem o valor. Isso ia so para o toast — que some — enquanto a caixa
 * responsavel continuava limpa; o operador reabria a ficha sem saber onde estava
 * o conflito.
 *
 * A escolha sai da propria frase porque o corpo do 409 nao tem `errors`: sao as
 * duas unicas colisoes possiveis, e a mensagem as nomeia ("CNPJ ja cadastrado
 * no provedor ...", "Subdominio ja em uso pelo provedor ..."). A comparacao e em
 * minusculas e por PEDACO ("subdomin"), e nao pela frase inteira: a mensagem e
 * texto para gente ler, e nada impede que ela ganhe acento ou seja reescrita.
 */
function camposDoConflito(mensagem: string | undefined): Partial<Record<keyof CadastroProvedor, string>> {
  const frase = (mensagem ?? "").trim();
  const t = frase.toLowerCase();
  if (t.includes("cnpj")) return { cnpj: frase };
  if (t.includes("subdomin")) return { subdomain: frase };
  return {};
}

/**
 * Titulo de bloco dentro do formulario, na voz do kicker de secao.
 *
 * O molde e o passo 2 do `NewProviderWizard`: dezessete campos numa grade unica
 * sao uma parede: o operador que veio corrigir o CEP tem de varrer o telefone e
 * o subdominio para achar o campo. As quatro secoes sao os quatro assuntos.
 */
function BlocoCadastro({
  Icone: IconeBloco,
  titulo,
  children,
}: {
  Icone: Icone;
  titulo: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-[var(--border)] pt-3 first:border-t-0 first:pt-0">
      <KickerSecao className="flex items-center gap-1.5">
        <IconeBloco className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
        {titulo}
      </KickerSecao>
      {children}
    </section>
  );
}

/**
 * Um campo da ficha: rotulo, caixa e a frase do erro NO MESMO LUGAR.
 *
 * A caixa e `CONTROLE_CAMPO`, e nao o `<Input>` cru do shadcn que este modo de
 * edicao usava: sao 36px em vez de 40, 12,5px de corpo em vez de 14 e — o que
 * importa de verdade — o anel de foco visivel da secao 7, que o `Input` base
 * desenha sobre um token de fundo suave e some.
 *
 * O ERRO MORA AQUI porque a alternativa e o que existia: um toast dizendo
 * "Dados invalidos". Com cinco campos isso ja era ruim; com dezessete, o
 * operador nao tem como descobrir qual reprovou.
 *
 * NAO USA `Campo`, e essa e a diferenca que importa. O `Campo` da primitiva
 * embrulha TUDO num `<label>` e associa por aninhamento — o certo quando dentro
 * dele so ha rotulo e caixa. Aqui dentro tambem moram o botao de busca, a dica e
 * a frase do erro, e o nome acessivel de um campo e o texto INTEIRO do `<label>`
 * que o contem: o CNPJ passava a se chamar "CNPJ Buscar na Receita" e, depois da
 * busca, "CNPJ Buscar na Receita Ficha preenchida com o cadastro da Receita
 * Federal. Revise e salve." — um campo que muda de nome sozinho, e cujo nome
 * anuncia uma acao que ele nao e.
 *
 * Entao o `<label>` embrulha SO o rotulo e liga pelo `htmlFor` (o `id` ja existe
 * em todos os campos, e e o mesmo do `data-testid`). Erro e dica ficam de fora
 * dele e chegam pelo `aria-describedby`, que e o canal proprio para descricao —
 * anunciada DEPOIS do nome, e nao como parte dele.
 */
function CampoCadastro({
  id,
  rotulo,
  valor,
  aoMudar,
  erro,
  dica,
  acao,
  mono = false,
  placeholder,
  maxLength,
  className,
  tipo,
}: {
  id: string;
  rotulo: React.ReactNode;
  valor: string;
  aoMudar: (v: string) => void;
  erro?: string;
  dica?: React.ReactNode;
  /** Botao colado no campo (buscar na Receita, buscar o CEP). Fica ao lado da
   *  caixa e FORA do `<label>`: dentro dele, o rotulo do botao entrava no nome
   *  acessivel do campo. */
  acao?: React.ReactNode;
  /** Liga mono tabular: CNPJ, CEP, telefone, numero, data, UF (secao 2). */
  mono?: boolean;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  tipo?: string;
}) {
  const idErro = `${id}-erro`;
  const idDica = `${id}-dica`;
  return (
    <div className={cn("block min-w-0", className)}>
      <label htmlFor={id} className={ROTULO_CAMPO}>{rotulo}</label>
      <span className="flex items-center gap-2">
        <Input
          id={id}
          type={tipo}
          value={valor}
          onChange={e => aoMudar(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? idErro : dica ? idDica : undefined}
          className={cn(
            CONTROLE_CAMPO,
            "flex-1 min-w-0",
            mono && "font-mono tabular-nums",
            erro && "border-[var(--danger)]",
          )}
          data-testid={id}
        />
        {acao}
      </span>
      {erro ? (
        <span id={idErro} className={ERRO_CAMPO} role="alert">{erro}</span>
      ) : dica ? (
        <span id={idDica} className={DICA_CAMPO}>{dica}</span>
      ) : null}
    </div>
  );
}

/**
 * Seletor da ficha. A lista passa por `opcoesComValorAtual` no chamador.
 *
 * POR QUE ISSO IMPORTA: o cadastro grava `legalType` com a natureza juridica
 * CRUA da Receita ("Sociedade Empresaria Limitada") e `businessSegment` com a
 * atividade principal do CNAE. Nenhuma das duas esta nas listas. Num seletor
 * comum esse valor nao tem `<option>`, o campo volta sozinho para "Selecione..."
 * sem erro nenhum, e o primeiro salvamento APAGA o que a Receita trouxe.
 */
function SelecaoCadastro({
  id,
  rotulo,
  valor,
  aoMudar,
  opcoes,
  className,
}: {
  id: string;
  rotulo: React.ReactNode;
  valor: string;
  aoMudar: (v: string) => void;
  opcoes: readonly string[];
  className?: string;
}) {
  return (
    <Campo rotulo={rotulo} className={cn("min-w-0", className)}>
      <select
        id={id}
        value={valor}
        onChange={e => aoMudar(e.target.value)}
        className={CONTROLE_CAMPO}
        data-testid={id}
      >
        <option value="">Não informado</option>
        {opcoes.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </Campo>
  );
}

/**
 * Par rotulo/valor do cartao de cadastro, em duas colunas.
 *
 * Substituiu o `InfoRow` de coluna unica com icone. O motivo nao e estetico: a
 * ficha passou a mostrar dezessete campos em vez de sete, e em coluna unica o
 * cartao "Cadastro" ficava com mais que o dobro da altura do "Plano e creditos"
 * ao lado dele. O molde de dado denso ja existe em `ProviderDrawer`.
 *
 * `children` e ReactNode, e nao string: e o que permite um `<Selo>` na linha da
 * conferencia do cadastro — o `InfoRow` tipava `value: string` e nao aceitava.
 */
function DadoCadastro({
  rotulo,
  children,
  mono = false,
  className,
}: {
  rotulo: React.ReactNode;
  children: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className={ROTULO_CAMPO}>{rotulo}</dt>
      <dd className={cn("text-[13px] text-[var(--text)] break-words", mono && "font-mono tabular-nums")}>
        {children}
      </dd>
    </div>
  );
}

export default function AdminProvedorPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const providerId = parseInt(id || "0");

  const [activeTab, setActiveTab] = useState("geral");
  const [editMode, setEditMode] = useState(false);
  /**
   * A FICHA CADASTRAL INTEIRA, e nao mais cinco campos.
   *
   * O formulario editava `name`, `subdomain`, `contactEmail`, `contactPhone` e
   * `website`. CNPJ, nome fantasia, tipo societario, data de abertura, segmento
   * e os sete campos de endereco eram gravados no cadastro e depois nao tinham
   * conserto em lugar nenhum — enquanto a gaveta da lista mandava "use o Painel
   * completo", que e esta tela.
   *
   * A logica toda (mascara, hidratacao, corpo do PATCH, tradutores da Receita e
   * do ViaCEP, validacao) mora em `./cadastro-provedor`, com teste. Aqui fica so
   * o estado e o desenho: o vitest deste projeto nao coleta `.tsx` — sem ambiente
   * de DOM —, entao nada que morasse dentro do componente teria prova nenhuma.
   */
  const [cadastro, setCadastro] = useState<CadastroProvedor>(() => cadastroDoProvedor(null));
  /**
   * O CADASTRO COMO ELE ESTAVA QUANDO A EDICAO COMECOU.
   *
   * E a outra metade de `corpoDoPatch(atual, original)`: sem ele o PATCH levava
   * as dezessete colunas a cada salvamento, e o retrato de onde a tela nasceu
   * virava ordem de gravacao. O provedor corrige o endereco no painel dele as
   * 10h05; o superadmin, com a ficha aberta desde as 10h00, arruma so o telefone
   * e salva as 10h10 — e o endereco novo volta ao valor antigo, sem que nenhum
   * dos dois veja acontecer.
   */
  const [cadastroOriginal, setCadastroOriginal] = useState<CadastroProvedor>(() => cadastroDoProvedor(null));
  /** Os erros so aparecem depois da primeira tentativa de salvar. Acusar campo
   *  que o operador ainda nem alcancou e ruido; depois do clique, e resposta. */
  const [errosVisiveis, setErrosVisiveis] = useState(false);
  /**
   * O que o SERVIDOR recusou, campo a campo — vindo do `errors` do 400 ou do
   * campo que a frase do 409 nomeia.
   *
   * Fica separado de `errosDoCadastro` porque tem outro ciclo de vida: o erro
   * local se recalcula a cada tecla e some sozinho quando o valor fica valido; o
   * do servidor e sobre o valor que FOI ENVIADO, e so deixa de valer quando o
   * campo muda ou quando outro PATCH sai.
   */
  const [errosDoServidor, setErrosDoServidor] = useState<Partial<Record<keyof CadastroProvedor, string>>>({});
  /**
   * A releitura que abre a edicao. Enquanto ela nao termina, o formulario ainda
   * mostra o cadastro anterior — e salvar sobre ele e exatamente o que a
   * releitura existe para impedir.
   */
  const [releituraDoCadastro, setReleituraDoCadastro] = useState<"ocioso" | "lendo" | "erro">("ocioso");
  const [buscaCnpj, setBuscaCnpj] = useState<{
    estado: "ocioso" | "buscando" | "ok" | "erro";
    frase?: string;
    situacao?: string;
  }>({ estado: "ocioso" });
  const [buscaCep, setBuscaCep] = useState<"ocioso" | "buscando" | "ok" | "vazio" | "erro">("ocioso");
  /** O ultimo CEP que ja foi ao ViaCEP.
   *
   *  O painel do provedor dispara a busca a cada tecla, sem trava; aqui a
   *  consulta so sai quando ha 8 digitos e UMA vez por CEP. Sem isto, apagar e
   *  redigitar o ultimo digito manda o mesmo CEP de novo e a resposta que chegar
   *  por ultimo — nao a da ultima digitacao — e a que sobrescreve o endereco. */
  const cepJaBuscado = useRef("");
  /** O numero da busca de CEP mais recente. Resposta de pedido vencido e
   *  descartada — ver `buscarCep`. */
  const pedidoDeCep = useRef(0);
  /* Ver `abrirEdicao`: desiste da releitura que chegar depois de o operador
     ter cancelado, para a tela nao reabrir o formulario sozinha. */
  const sessaoDeEdicao = useRef(0);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [planForm, setPlanForm] = useState({ plan: "", notes: "" });
  const [creditsForm, setCreditsForm] = useState({ ispCredits: "", spcCredits: "", bigdataCredits: "", notes: "" });
  const [invoiceForm, setInvoiceForm] = useState({ period: "", amount: "", planAtTime: "basic", ispCreditsIncluded: "", spcCreditsIncluded: "", dueDate: "", notes: "" });
  const [editingEmailUser, setEditingEmailUser] = useState<{ id: number; name: string; email: string } | null>(null);
  const [newEmail, setNewEmail] = useState("");

  const isSuperAdmin = user?.role === "superadmin";

  /**
   * Preco e credito do plano sao do servidor, que e quem cobra. Com o white
   * label eles ainda passam a depender da marca que o provedor veste, e uma
   * constante compilada no bundle nao tem como saber disso.
   */
  const { data: precos, isLoading: carregandoPrecos, isError: erroPrecos, refetch: recarregarPrecos } = usePrecos();

  const { data, isLoading, error, refetch: relerDetalhe } = useQuery<any>({
    queryKey: ["/api/admin/providers", providerId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/providers/${providerId}/detail`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    enabled: !!providerId && isSuperAdmin,
    /**
     * O padrao do cliente e `staleTime: Infinity` — retrato eterno. Numa ficha
     * de conta isso e caro em leitura (o operador confere um saldo de credito de
     * horas atras) e caro de verdade na escrita: era desse retrato que o
     * formulario nascia. Trinta segundos e o mesmo prazo que o painel usa para
     * numero que muda sozinho. Quem abre a EDICAO nao depende disto: releitura
     * explicita, em `abrirEdicao`.
     */
    staleTime: 30_000,
  });

  /**
   * Enche o formulario com a LINHA INTEIRA de `providers` e zera os avisos.
   *
   * A fonte tem de ser `data.provider` — a linha crua do detalhe. Hidratar de um
   * resumo que nao traga todos os campos e depois enviar o corpo completo APAGA
   * o que o resumo nao trouxe.
   *
   * `cadastro` e `cadastroOriginal` nascem da MESMA leitura: e a comparacao
   * entre os dois que decide o que vai no PATCH. Hidratar um de uma leitura e o
   * outro de outra faria a tela "descobrir" alteracoes que ninguem fez.
   */
  const prepararEdicao = (p: any) => {
    setCadastro(cadastroDoProvedor(p));
    setCadastroOriginal(cadastroDoProvedor(p));
    setErrosVisiveis(false);
    setErrosDoServidor({});
    setBuscaCnpj({ estado: "ocioso" });
    setBuscaCep("ocioso");
    cepJaBuscado.current = "";
    /* Uma busca de CEP da sessao anterior de edicao ainda pode estar no ar.
       Sem invalidar o pedido, ela chega depois desta hidratacao e escreve o
       endereco dela por cima do cadastro recem-lido. */
    pedidoDeCep.current++;
    setActiveTab("geral");
    setEditMode(true);
  };

  /**
   * ABRIR A EDICAO E RELER O CADASTRO — nesta ordem, e sempre.
   *
   * O formulario nascia do que a query tinha em maos, e essa query e um retrato:
   * quem deixou a ficha aberta editava um cadastro de horas atras e, ao salvar,
   * DESFAZIA sem ver o que o provedor tivesse gravado no painel dele nesse
   * intervalo. Mandar so o que mudou (`corpoDoPatch`) reduz o estrago aos campos
   * tocados; nascer do dado de agora e o que o elimina.
   *
   * `refetch` ignora o `staleTime` por construcao — e a leitura forcada, nao uma
   * releitura "se estiver velho".
   *
   * A edicao abre ANTES da resposta, com o formulario travado: abrir so depois
   * faria o clique em "Editar" nao produzir nada por um instante, e o operador
   * clicaria de novo. Se a releitura falhar, a tela DIZ que falhou e nao deixa
   * salvar — o botao some —, porque salvar sobre o retrato antigo e justamente o
   * defeito.
   */
  const abrirEdicao = async () => {
    /**
     * A SESSAO DE EDICAO, e por que ela precisa de um numero.
     *
     * O `await` abaixo dura o tempo de uma requisicao, e nesse intervalo o
     * operador pode ter desistido. Sem esta trava, a resposta que chega depois
     * do clique em "Cancelar" executa `prepararEdicao` assim mesmo: a tela SALTA
     * de volta para a aba Geral e reabre o formulario de dezessete campos
     * sozinha, meio segundo depois de o operador ter ido para Creditos.
     *
     * Mesmo padrao — e mesmo motivo — do `pedidoDeCep` logo abaixo: quem espera
     * resposta precisa saber se ainda e o pedido corrente.
     */
    const minhaSessao = ++sessaoDeEdicao.current;
    setActiveTab("geral");
    setReleituraDoCadastro("lendo");
    /* Hidrata com o que ja esta em maos para o formulario nao abrir em branco —
       dezessete caixas vazias por um instante leem como cadastro apagado. Este
       valor e provisorio: a leitura nova o substitui, e ate ela chegar nao ha
       como gravar. */
    prepararEdicao(data?.provider);
    const leitura = await relerDetalhe();
    if (minhaSessao !== sessaoDeEdicao.current) return;
    const p = leitura.data?.provider;
    if (leitura.error || !p) {
      setReleituraDoCadastro("erro");
      return;
    }
    prepararEdicao(p);
    setReleituraDoCadastro("ocioso");
  };

  /** Enquanto a releitura nao volta (ou volta com erro), o formulario mostra o
   *  cadastro anterior — e nada dele pode ser gravado. */
  const cadastroPronto = releituraDoCadastro === "ocioso";

  /**
   * `?editar=1` abre a ficha JA editando.
   *
   * E o contrato da acao "Editar" da fila de Cadastros, que navega para
   * `/admin/provedor/:id?editar=1`. Nada no compilador liga as duas pontas: se o
   * nome do parametro divergir, o botao vira um segundo "Ver ficha" — sem erro,
   * sem console, sem sintoma. Por isso ha teste travando a string dos dois lados.
   *
   * A marca sai da URL depois de consumida, com `replace`: sem isso, cancelar a
   * edicao e recarregar (ou voltar pelo historico) reabre o formulario, e o
   * endereco que o operador copia da barra leva outra pessoa direto para dentro
   * de um formulario de escrita.
   */
  const edicaoAbertaPelaUrl = useRef(false);
  useEffect(() => {
    if (edicaoAbertaPelaUrl.current) return;
    const p = data?.provider;
    if (!p) return;
    if (new URLSearchParams(window.location.search).get("editar") !== "1") return;
    edicaoAbertaPelaUrl.current = true;
    /* Passa pela MESMA porta do botao — releitura inclusive. Chegar por
       `?editar=1` nao garante leitura nova: voltar pelo historico serve a ficha
       do cache, e era dela que o formulario nasceria. */
    void abrirEdicao();
    navigate(`/admin/provedor/${providerId}`, { replace: true });
  }, [data, providerId, navigate]);

  /**
   * O PATCH da ficha — a unica chamada da tela que NAO passa por `apiRequest`.
   *
   * `apiRequest` consome a resposta e devolve so `message` e `status`; o `errors`
   * do 400, que e o unico lugar onde o servidor diz QUAL dos dezessete campos
   * reprovou, morre no caminho. Com cinco campos dava para procurar na mao; com
   * dezessete, "Dados invalidos" num toast e um beco: o PATCH e tudo ou nada,
   * entao nada gravou e nada diz por que.
   *
   * A ida direta ao `fetch` custa uma repeticao — o desvio do 401, que
   * `apiRequest` faz por todo mundo. Ela e feita de proposito aqui: sessao
   * expirada tem de levar ao login em qualquer rota, e nao ha caminho para
   * pegar o corpo do erro passando pelo helper.
   */
  const editMutation = useMutation({
    mutationFn: async (body: Record<string, string | null>) => {
      const res = await fetch(`/api/admin/providers/${providerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (res.status === 401) {
        if (window.location.pathname !== "/login") window.location.href = "/login";
        throw new Error("Sessão expirada. Faça login novamente.");
      }
      // Corpo que nao e JSON (HTML de proxy, texto do Express) nao pode derrubar
      // a leitura do erro: a mensagem generica ainda e melhor que uma excecao de
      // parse chegando ao operador como "Unexpected token <".
      const corpo = await res.json().catch(() => null);
      if (!res.ok) {
        const erro = new Error(corpo?.message || `Erro ${res.status}`) as Error & {
          status: number;
          campos: Partial<Record<keyof CadastroProvedor, string>>;
        };
        erro.status = res.status;
        /**
         * O `errors` do servidor VEM PRIMEIRO, inclusive no 409.
         *
         * O handler passou a mandar `errors: { cnpj: [frase] }` / `{ subdomain }`
         * junto do 409 exatamente para a tela nao ter de adivinhar. Adivinhar
         * pelo texto erra de um jeito silencioso: a frase do conflito de
         * subdominio carrega o NOME do outro provedor, entao um provedor
         * chamado "CNPJ Solucoes" faz o teste `inclui("cnpj")` casar primeiro e
         * o erro ser pintado debaixo da caixa do CNPJ, que esta correta,
         * enquanto o subdominio — o culpado — fica limpo.
         *
         * `camposDoConflito` fica so como queda, para o caso de a tela nova
         * conversar com um servidor que ainda nao manda `errors`.
         */
        const doServidor = errosDoServidorNaResposta(corpo);
        erro.campos = Object.keys(doServidor).length > 0
          ? doServidor
          : (res.status === 409 ? camposDoConflito(corpo?.message) : {});
        throw erro;
      }
      return corpo;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      /* A LISTA TAMBEM MUDOU. A edicao passou a mexer em nome, nome fantasia e
         cidade — tres colunas que a lista de provedores e a gaveta exibem. Sem
         esta linha o superadmin corrige a razao social, volta para a lista e le
         o nome antigo, que e o jeito mais rapido de fazer alguem salvar duas
         vezes. `planMutation` e `statusMutation` ja faziam isso. */
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      setEditMode(false);
      setErrosVisiveis(false);
      setErrosDoServidor({});
      toast({ title: "Provedor atualizado" });
    },
    /* 409 e o unico desfecho que a tela nao tem como prever: CNPJ e subdominio
       sao UNIQUE, e quem ja tem o valor e outra linha do banco. A frase do
       servidor nomeia o provedor dono do valor — repeti-la e melhor que uma
       generica, porque e ela que diz ONDE resolver o conflito.

       E ela nao fica so no toast, que some: vai para a CAIXA do campo culpado,
       junto das frases do 400. Um toast lido e esquecido deixa o operador
       reabrindo a ficha sem saber onde estava o conflito. */
    onError: (e: any) => {
      const campos: Partial<Record<keyof CadastroProvedor, string>> = e?.campos ?? {};
      setErrosDoServidor(campos);
      const apontados = Object.keys(campos).length;
      toast({
        title: e?.status === 409 ? "Valor já usado por outro provedor" : "Erro ao salvar",
        description: apontados
          ? `${e?.message} A frase de cada campo recusado está sob a caixa dele.`
          : e?.message,
        variant: "destructive",
      });
    },
  });

  const planMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", `/api/admin/providers/${providerId}/plan`, body);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      setShowPlanModal(false);
      toast({ title: "Plano alterado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const creditsMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", `/api/admin/providers/${providerId}/credits`, body);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      setShowCreditsModal(false);
      toast({ title: "Créditos adicionados" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const invoiceMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/admin/invoices", body);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      setShowInvoiceModal(false);
      toast({ title: "Fatura criada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/api/admin/providers/${providerId}`, { status });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      toast({ title: "Situação atualizada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const invoiceStatusMutation = useMutation({
    mutationFn: async ({ invoiceId, status }: { invoiceId: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/invoices/${invoiceId}/status`, { status });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      toast({ title: "Fatura atualizada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateEmailMutation = useMutation({
    mutationFn: async ({ id, email }: { id: number; email: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}/email`, { email });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "detail"] });
      toast({ title: "E-mail atualizado", description: "O e-mail de acesso foi alterado com sucesso." });
      setEditingEmailUser(null);
      setNewEmail("");
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  /* Os tres desfechos que impedem a ficha de abrir usam o MESMO estado vazio da
     primitiva — icone, titulo, descricao e, quando ha, a saida. Antes eram tres
     blocos improvisados, cada um com um tamanho de icone e uma cor solta. */
  if (!isSuperAdmin) {
    return (
      <div className="p-4 lg:p-6">
        <Card>
          <EstadoVazio
            Icone={Shield}
            titulo="Acesso restrito"
            descricao="Esta ficha é do painel da plataforma. Só um administrador do sistema pode abrir os dados de um provedor."
            testId="acesso-restrito"
          />
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-5" data-testid="admin-provedor-carregando">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[86px] rounded-lg" />)}
        </div>
        <Card className="p-4">
          <LinhasSkeleton linhas={5} />
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 lg:p-6">
        <Card>
          <EstadoVazio
            Icone={AlertCircle}
            titulo="Provedor não encontrado"
            descricao="A ficha não pôde ser carregada. O provedor pode ter sido removido, ou o endereço aberto não corresponde a nenhum cadastro."
            cta={
              <button
                type="button"
                className={BOTAO_SECUNDARIO}
                /* O mesmo destino de antes. O cabecalho da ficha vai para
                   `#provedores`, mas mudar este aqui seria mexer em navegacao
                   numa rodada que e so de linguagem visual. */
                onClick={() => navigate("/admin-sistema")}
                data-testid="button-voltar-provedores-erro"
              >
                <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
                Voltar para o painel
              </button>
            }
            testId="provedor-nao-encontrado"
          />
        </Card>
      </div>
    );
  }

  const { provider, users, stats, invoices, planHistory, financial, recentIsp, recentSpc } = data;
  const plano = seloDoPlano(provider.plan);
  const planoCobrado = planoPorChave(precos, provider.plan);
  const situacao = SITUACAO_PROVEDOR[provider.status] ?? SITUACAO_DESCONHECIDA;

  /**
   * A conferencia do cadastro (o KYC) so aparecia na fila de Cadastros. Quem
   * abre a ficha para corrigir o CNPJ precisa saber se aquele cadastro ja foi
   * aprovado — e o mapa e o mesmo da fila, para as duas telas nao divergirem.
   * Valor fora dos tres conhecidos diz que nao sabe, e nunca o identificador cru.
   */
  const conferencia = VERIFICATION_LABELS[provider.verificationStatus] ?? {
    label: "Conferência desconhecida",
    tom: "neutro" as TomSelo,
  };

  /**
   * O endereco numa linha. Cada pedaco ausente some junto com o separador:
   * "— /" e o que sobra quando se junta campo vazio, e nao e informacao.
   *
   * O NUMERO E A UF SAO MONO TABULAR (secao 2 e 6). Os dois ja saem assim nas
   * caixas do formulario; a linha de leitura os imprimia em Inter, ao lado de um
   * CEP mono na linha de cima — o mesmo dado com duas tipografias na mesma
   * ficha. Rua, complemento e bairro sao prosa e ficam como estao.
   */
  const enderecoDoProvedor = (() => {
    const logradouro: React.ReactNode[] = [];
    if (provider.addressStreet) logradouro.push(provider.addressStreet);
    if (provider.addressNumber) logradouro.push(<Num key="numero">{provider.addressNumber}</Num>);

    const cidadeUf: React.ReactNode[] = [];
    if (provider.addressCity) cidadeUf.push(provider.addressCity);
    if (provider.addressState) cidadeUf.push(<Num key="uf">{provider.addressState}</Num>);

    const partes: React.ReactNode[] = [];
    if (logradouro.length) partes.push(juntarPedacos(logradouro, ", "));
    if (provider.addressComplement) partes.push(provider.addressComplement);
    if (provider.addressNeighborhood) partes.push(provider.addressNeighborhood);
    if (cidadeUf.length) partes.push(juntarPedacos(cidadeUf, "/"));

    return partes.length ? juntarPedacos(partes, " — ") : "—";
  })();

  /**
   * "de N do plano" so quando o plano DECLARA credito incluso. O card dizia
   * "de 500 do plano" para o Profissional, que hoje nao inclui nenhum — a
   * consulta na rede se paga por credito. Sem tabela nao ha o que afirmar.
   */
  const inclusoNoPlano = (campo: "isp" | "spc"): string | undefined => {
    if (!planoCobrado) return undefined;
    const incluso = planoCobrado.creditosInclusos[campo];
    return incluso > 0 ? `de ${incluso} do plano` : "sem crédito incluso";
  };

  /**
   * O formulario de fatura so preenche valor a partir da tabela. Sem ela
   * `camposDaFatura` devolve `null` e os campos ficam INTOCADOS, em vez de
   * caírem para um numero inventado — era `String(plan.price)`, R$ 399 da
   * tabela morta desta tela.
   */
  const abrirNovaFatura = () => {
    setInvoiceForm({
      period: "", amount: "", planAtTime: provider.plan,
      ispCreditsIncluded: "", spcCreditsIncluded: "", dueDate: "", notes: "",
      ...(camposDaFatura(precos, provider.plan) ?? {}),
    });
    setShowInvoiceModal(true);
  };

  /** Sem tabela nao ha valor confiavel para gravar numa fatura. */
  const podeEmitirFatura = Boolean(precos);

  const startEdit = () => { void abrirEdicao(); };

  /** Um campo do cadastro. Enquanto os erros estao a vista, eles se atualizam a
   *  cada tecla — a frase some no instante em que o campo fica valido. */
  const mudarCampo = (campo: keyof CadastroProvedor, valor: string) => {
    setCadastro(c => ({ ...c, [campo]: valor }));
    /* A recusa do servidor e sobre o valor que FOI ENVIADO. No instante em que
       o operador mexe na caixa, ela deixa de descrever o que esta la — e uma
       frase que nao sai mais ensina a ignorar a proxima. A chave e REMOVIDA, e
       nao zerada: `undefined` continuaria contando em `Object.keys`. */
    setErrosDoServidor(atuais => {
      if (!(campo in atuais)) return atuais;
      const resto = { ...atuais };
      delete resto[campo];
      return resto;
    });
  };

  const errosCadastro = errosDoCadastro(cadastro, cadastroOriginal);
  const temErros = Object.keys(errosCadastro).length > 0;
  const camposRecusadosPeloServidor = Object.keys(errosDoServidor).length;
  /** A frase local primeiro: ela e a que se atualiza a cada tecla. A do servidor
   *  entra quando a tela nao tem nada a dizer sobre aquele campo — que e
   *  exatamente o caso em que ela e a unica informacao existente. */
  const erroDe = (campo: keyof CadastroProvedor) =>
    (errosVisiveis ? errosCadastro[campo] : undefined) ?? errosDoServidor[campo];

  /**
   * A ficha da Receita entra no formulario, e NAO no banco.
   *
   * Preenche e pede revisao — nunca salva sozinho. O que a Receita traz
   * substitui, o que ela nao traz fica como esta (a regra vive em
   * `aplicarEmpresaPublica`), entao um CNPJ consultado por engano nao apaga
   * telefone e site que o provedor informou.
   *
   * A rota e a do SUPERADMIN. `GET /api/provider/cnpj` le
   * `req.session.providerId`, que num superadmin nao existe.
   */
  const buscarNaReceita = async () => {
    const digitos = cnpjCru(cadastro.cnpj);
    if (digitos.length !== 14) {
      setErrosVisiveis(true);
      setBuscaCnpj({ estado: "erro", frase: "Informe os 14 dígitos do CNPJ antes de buscar." });
      return;
    }
    setBuscaCnpj({ estado: "buscando" });
    try {
      const res = await apiRequest("GET", `/api/admin/cnpj/${digitos}`);
      const dados = await res.json();
      setCadastro(c => aplicarEmpresaPublica(c, dados));
      setBuscaCnpj({ estado: "ok", situacao: dados?.situacao });
    } catch (e: any) {
      /* Repetir a frase do servidor: "as três fontes recusaram, tente em alguns
         minutos" e "CNPJ não encontrado em nenhuma fonte" pedem ações diferentes. */
      setBuscaCnpj({
        estado: "erro",
        frase: e?.message || "A Receita não respondeu. Tente novamente em alguns minutos.",
      });
    }
  };

  /**
   * O endereco do CEP, uma vez por CEP.
   *
   * `forcar` existe para o botao: quem clica quer consultar de novo o mesmo CEP
   * (a primeira tentativa caiu, ou o operador desfez o preenchimento na mao).
   */
  const buscarCep = async (digitos: string, forcar = false) => {
    if (digitos.length !== 8) return;
    if (!forcar && cepJaBuscado.current === digitos) return;
    cepJaBuscado.current = digitos;
    /* SO A ULTIMA BUSCA VALE. A trava acima evita repetir o MESMO CEP — nao
       evita duas buscas DIFERENTES no ar ao mesmo tempo, que e o que acontece
       quando o operador corrige o CEP logo depois de digitar um errado. Se a
       primeira demorar mais que a segunda, ela chega por ultimo e grava a rua do
       CEP ANTERIOR sob o CEP novo: o endereco fica errado e a tela diz
       "Endereço preenchido pelo CEP". O numero do pedido e o desempate. */
    const meuPedido = ++pedidoDeCep.current;
    setBuscaCep("buscando");
    try {
      /* Chamada imperativa e de uma vez so, disparada por acao do operador — nao
         e estado de servidor para cachear, e o ViaCEP e de terceiro. Mesmo
         caminho do painel do provedor e da barra de consulta. */
      const resp = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
      const dados = await resp.json();
      if (meuPedido !== pedidoDeCep.current) return;
      if (dados?.erro) { setBuscaCep("vazio"); return; }
      setCadastro(c => aplicarViaCep(c, dados));
      setBuscaCep("ok");
    } catch {
      // A falha de uma busca vencida tambem nao fala pela tela: ela reportaria
      // "a busca não respondeu" por cima de um endereço que a busca atual acabou
      // de preencher.
      if (meuPedido !== pedidoDeCep.current) return;
      setBuscaCep("erro");
    }
  };

  const mudarCep = (valor: string) => {
    const digitos = cepCru(valor);
    mudarCampo("addressZip", digitos);
    if (digitos.length === 8) void buscarCep(digitos);
    else setBuscaCep("ocioso");
  };

  /**
   * O salvamento e TUDO OU NADA do lado do servidor: um campo invalido derruba o
   * PATCH inteiro e leva as outras dezesseis correcoes junto. Por isso a tela
   * para aqui e mostra as frases, em vez de mandar e traduzir um "Dados
   * invalidos" que nao diz qual dos dezessete campos reprovou.
   *
   * E o corpo leva SO O QUE MUDOU, comparado com o cadastro que a edicao releu
   * ao abrir. Mandar as dezessete colunas fazia deste formulario uma ordem de
   * gravacao sobre o retrato de quando a tela abriu — o superadmin desfazia, sem
   * ver, o que o provedor tivesse acabado de gravar no painel dele.
   */
  const salvarCadastro = () => {
    if (temErros) {
      setErrosVisiveis(true);
      toast({
        title: "Confira os campos destacados",
        description: "A ficha é gravada de uma vez só: um campo inválido cancela as outras correções junto.",
        variant: "destructive",
      });
      return;
    }
    const corpo = corpoDoPatch(cadastro, cadastroOriginal);
    /* Corpo vazio nao vai. O servidor responde 400 "Nenhum campo para alterar" a
       um PATCH sem colunas — o operador leria "Erro ao salvar" por ter aberto e
       fechado a ficha sem mexer em nada. Fechar dizendo que nada mudou e a
       resposta honesta. */
    if (Object.keys(corpo).length === 0) {
      setEditMode(false);
      setErrosVisiveis(false);
      setErrosDoServidor({});
      toast({
        title: "Nada mudou no cadastro",
        description: "Nenhum campo foi alterado, então não havia o que gravar.",
      });
      return;
    }
    editMutation.mutate(corpo);
  };

  /** Os dois botoes do formulario, repetidos no topo e no fim. */
  const acoesDaEdicao = (sufixo: "" | "-fim") => (
    <div className="flex items-center gap-2 flex-none">
      <button
        type="button"
        className={cn(BOTAO_SECUNDARIO, sufixo === "" && CAIXA_ICONE)}
        onClick={() => { sessaoDeEdicao.current++; setEditMode(false); setReleituraDoCadastro("ocioso"); setErrosDoServidor({}); }}
        aria-label={sufixo === "" ? "Cancelar edição" : undefined}
        data-testid={`button-cancel-edit${sufixo}`}
      >
        <X className="w-3.5 h-3.5" strokeWidth={2} />
        {sufixo === "" ? null : "Cancelar"}
      </button>
      {/* NAO HA SALVAR SOBRE DADO VELHO. Enquanto a releitura corre, o
          formulario ainda mostra o cadastro anterior; se ela falhou, ele nunca
          vai mostrar outro. Nos dois casos gravar dali e reescrever o cadastro
          com um retrato — que e o defeito que a releitura existe para fechar.
          Travado enquanto le (o rotulo diz o que falta), ausente quando falhou:
          um botao permanentemente travado no fim de um formulario de dezessete
          campos nao explica nada; a saida esta no aviso, com "Tentar de novo". */}
      {releituraDoCadastro !== "erro" && (
        <button
          type="button"
          className={cn(BOTAO_MARCA, DESABILITAVEL)}
          onClick={salvarCadastro}
          disabled={editMutation.isPending || !cadastroPronto}
          data-testid={`button-save-edit${sufixo}`}
        >
          <Save className="w-3.5 h-3.5" strokeWidth={2} />
          {editMutation.isPending ? "Salvando..." : cadastroPronto ? "Salvar" : "Lendo o cadastro..."}
        </button>
      )}
    </div>
  );

  const startPlanChange = () => {
    setPlanForm({ plan: provider.plan, notes: "" });
    setShowPlanModal(true);
  };

  return (
    <div className="p-4 lg:p-6 space-y-5" data-testid="admin-provedor-page">
      {/* A volta para a lista e a unica navegacao da tela e vem antes do titulo,
          onde o operador ja a procura. Botao de superficie, com o alvo de toque
          e o anel de foco da primitiva. */}
      <button
        type="button"
        className={cn(BOTAO_SECUNDARIO, "text-[var(--text-muted)]")}
        onClick={() => navigate("/admin-sistema#provedores")}
        data-testid="button-back-provedores"
      >
        <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
        Provedores
      </button>

      {/* O ladrilho da inicial ficava num gradiente azul→indigo da paleta default
          do Tailwind — duas proibicoes da secao 7. A inicial e identidade, nao
          estado, e agora quem a desenha e `LadrilhoInicial`.
          Forma `ladrilho` (canto seco) porque isto e um PROVEDOR: empresa nao
          tem rosto, e o circulo da secao 5.1 e a excecao do avatar de pessoa.
          Tamanho `lg`, a mesma escada de `LadrilhoIcone` — a caixa desce de 44px
          para 40px e o raio de 8px para 4px, que e a medida da primitiva. A
          inicial sai de dentro dela: o `charAt(0)` estava redigitado aqui e no
          avatar de usuario logo abaixo, e so um dos dois lembrava do maiusculo. */}
      <div className="flex items-start gap-3.5">
        <LadrilhoInicial nome={provider.name} tamanho="lg" />
        <div className="flex-1 min-w-0">
          <CabecalhoPainel
            titulo={provider.name}
            testIdTitulo="text-provider-name"
            descricao={
              <span className="flex items-center gap-2 flex-wrap">
                <Selo tom={plano.tom} testId="badge-plano">{plano.label}</Selo>
                <Selo tom={situacao.tom} testId="badge-situacao">{situacao.label}</Selo>
                {provider.subdomain && (
                  <span className="flex items-center gap-1 text-[12px] text-[var(--text-muted)]">
                    <Globe className="w-3 h-3 flex-none" strokeWidth={2} />
                    <Num>{provider.subdomain}.consultaisp.com.br</Num>
                  </span>
                )}
                <span className="flex items-center gap-1 text-[12px] text-[var(--text-muted)]">
                  <Calendar className="w-3 h-3 flex-none" strokeWidth={2} />
                  Desde <Num>{fmtDate(provider.createdAt)}</Num>
                </span>
              </span>
            }
            acoes={
              <>
                {/* SOME DURANTE A EDICAO. Ele continuava clicavel com o
                    formulario aberto, e clicar RECOMECA a ficha do zero: o
                    operador rola ate o topo, ve "Editar" e clica achando que e
                    inofensivo — e perde dezessete campos preenchidos, sem aviso
                    e sem desfazer. Quem ja esta editando nao tem o que fazer com
                    ele; salvar e cancelar estao no cartao, no topo e no fim. */}
                {!editMode && (
                  <button type="button" className={BOTAO_SECUNDARIO} onClick={startEdit} data-testid="button-edit-provider">
                    <Edit2 className="w-3.5 h-3.5" strokeWidth={2} /> Editar
                  </button>
                )}
                <button type="button" className={BOTAO_SECUNDARIO} onClick={startPlanChange} data-testid="button-change-plan">
                  <Star className="w-3.5 h-3.5" strokeWidth={2} /> Plano
                </button>
                <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setShowCreditsModal(true)} data-testid="button-add-credits">
                  <Zap className="w-3.5 h-3.5" strokeWidth={2} /> Créditos
                </button>
                <button type="button" className={BOTAO_SECUNDARIO} onClick={abrirNovaFatura} data-testid="button-create-invoice">
                  <FileText className="w-3.5 h-3.5" strokeWidth={2} /> Fatura
                </button>
                {/* Cortar e religar um provedor sao acoes de risco, e so elas
                    levam cor — o resto da barra e neutro (secao 3: saturacao
                    reservada para risco). `cn` resolve o conflito de tinta com o
                    botao secundario; concatenar string deixaria a vitoria por
                    conta da ordem do CSS gerado. */}
                {provider.status === "active" ? (
                  <button
                    type="button"
                    className={cn(BOTAO_SECUNDARIO, DESABILITAVEL, "text-[var(--danger)] border-[var(--danger-border)] hover:bg-[var(--danger-bg)]")}
                    onClick={() => statusMutation.mutate("suspended")}
                    data-testid="button-suspend-provider"
                    disabled={statusMutation.isPending}
                  >
                    <Ban className="w-3.5 h-3.5" strokeWidth={2} /> Suspender
                  </button>
                ) : (
                  <button
                    type="button"
                    className={cn(BOTAO_SECUNDARIO, DESABILITAVEL, "text-[var(--ok)] border-[var(--ok-border)] hover:bg-[var(--ok-bg)]")}
                    onClick={() => statusMutation.mutate("active")}
                    data-testid="button-activate-provider"
                    disabled={statusMutation.isPending}
                  >
                    <CheckCircle className="w-3.5 h-3.5" strokeWidth={2} /> Ativar
                  </button>
                )}
              </>
            }
          />
        </div>
      </div>

      {/* AS METRICAS EM DOIS GRUPOS, E NAO SETE NUMA FILA SO.
          Eram sete cartoes numa grade de seis colunas: a segunda fila abria com
          um cartao orfao e, num monitor de 1280px, cada um ficava com ~200px —
          o numero mono de 21px e um rotulo de duas palavras nao cabem juntos.
          Os sete tambem nao eram a mesma coisa: quatro contam o que ja
          aconteceu (acumulado), tres dizem quanto resta (saldo). Separados, cada
          fila fecha cheia — 4 e 3 — e o operador para de comparar contador com
          saldo lado a lado. */}
      <section>
        <KickerSecao>Uso da plataforma</KickerSecao>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <CartaoMetrica Icone={Users} rotulo="Clientes" valor={stats.customers} sub="cadastrados" testId="card-clientes" testIdValor="value-card-clientes" />
          <CartaoMetrica Icone={Activity} rotulo="Equipamentos" valor={stats.equipment} sub="ativos" testId="card-equipamentos" testIdValor="value-card-equipamentos" />
          <CartaoMetrica Icone={ScanSearch} rotulo="Consultas ISP" valor={stats.ispConsultations} sub={<><Num>{stats.ispConsultationsMonth}</Num> neste mês</>} testId="card-consultas-isp" testIdValor="value-card-consultas-isp" />
          <CartaoMetrica Icone={BarChart3} rotulo="Consultas SPC" valor={stats.spcConsultations} sub={<><Num>{stats.spcConsultationsMonth}</Num> neste mês</>} testId="card-consultas-spc" testIdValor="value-card-consultas-spc" />
        </div>
      </section>

      <section>
        <KickerSecao>Saldo de créditos</KickerSecao>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <CartaoMetrica Icone={Zap} rotulo="Créditos ISP" valor={provider.ispCredits} sub={inclusoNoPlano("isp")} testId="card-creditos-isp" testIdValor="value-card-creditos-isp" />
          <CartaoMetrica Icone={CreditCard} rotulo="Créditos SPC" valor={provider.spcCredits} sub={inclusoNoPlano("spc")} testId="card-creditos-spc" testIdValor="value-card-creditos-spc" />
          <CartaoMetrica Icone={IdCard} rotulo="Créditos cadastral" valor={provider.bigdataCredits ?? 0} sub="consulta cadastral" testId="card-creditos-cadastral" testIdValor="value-card-creditos-cadastral" />
        </div>
      </section>

      {/* AS ABAS.
          Nao ha primitiva de aba ainda — o painel do provedor tambem nao tinha
          uma quando esta rodada comecou. Ate haver, o estilo mora aqui, escrito
          nos tokens canonicos e com o alvo de toque da primitiva: densa no
          mouse, 44px no dedo. Candidata declarada a subir para `painel/ui`
          quando a segunda tela precisar dela. */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList
          className="h-auto flex-wrap justify-start gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1"
          data-testid="tabs-provider"
        >
          {ABAS.map(a => (
            <TabsTrigger
              key={a.chave}
              value={a.chave}
              data-testid={`tab-${a.chave}`}
              className={cn(
                ALVO_CONTROLE,
                "gap-1.5 rounded-md px-3 text-[12.5px] font-medium text-[var(--text-muted)]",
                "data-[state=active]:bg-[var(--brand-soft)] data-[state=active]:text-[var(--brand-ink)] data-[state=active]:shadow-none",
                /* Um indicador de foco so: o anel da primitiva. `ring-0` desliga
                   o do shadcn, que ficaria por baixo em outra cor e espessura.
                   `outline` (estilo) tem de vir junto de `outline-2` (largura) —
                   sozinha, a largura nao pinta nada. */
                "focus-visible:ring-0",
                FOCO,
              )}
            >
              <a.Icone className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
              {a.rotulo}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* TAB: GERAL */}
        <TabsContent value="geral">
          {editMode ? (
            <Card data-testid="card-editar-cadastro">
              <TopoCartao
                titulo="Editar cadastro"
                sub="Plano, créditos e situação não estão aqui: cada um tem botão próprio, no topo da ficha."
                Icone={Edit2}
                acao={acoesDaEdicao("")}
              />
              <div className="px-4 py-4 space-y-4">
                {/* A EDICAO NASCE DO DADO DE AGORA. Enquanto a releitura corre,
                    as caixas ainda mostram o cadastro anterior — e é isso que o
                    aviso diz, em vez de deixar o operador digitar por cima de um
                    retrato achando que é o valor atual. */}
                {releituraDoCadastro === "lendo" && (
                  <p
                    role="status"
                    className="flex items-center gap-2 rounded border border-[var(--info-border)] bg-[var(--info-bg)] px-3 py-2 text-[12.5px] text-[var(--info)]"
                    data-testid="aviso-relendo-cadastro"
                  >
                    <RefreshCw className="w-4 h-4 flex-none motion-safe:animate-spin" strokeWidth={2} aria-hidden />
                    <span>Lendo o cadastro atual antes de editar. Os campos abaixo ainda são os da abertura da ficha.</span>
                  </p>
                )}

                {releituraDoCadastro === "erro" && (
                  <AvisoNaoCarregou
                    aoTentarDeNovo={() => { void abrirEdicao(); }}
                    testId="erro-releitura-cadastro"
                  >
                    Não foi possível reler o cadastro. Os campos abaixo são do momento em que a ficha
                    abriu — gravá-los desfaria o que o provedor tenha alterado depois disso, então
                    salvar está indisponível até a leitura voltar.
                  </AvisoNaoCarregou>
                )}

                {/* O QUE O SERVIDOR RECUSOU. A frase de cada campo vai na caixa
                    dele; este aviso só diz, em português, quantos são e onde
                    procurar — a frase do servidor pode vir em inglês, e reescrevê-la
                    seria adivinhar o motivo da recusa. */}
                {camposRecusadosPeloServidor > 0 && (
                  <p
                    role="alert"
                    className="flex items-center gap-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12.5px] text-[var(--danger)]"
                    data-testid="aviso-erros-servidor"
                  >
                    <AlertTriangle className="w-4 h-4 flex-none" strokeWidth={2} aria-hidden />
                    <span>
                      O servidor recusou <Num>{camposRecusadosPeloServidor}</Num>{" "}
                      {camposRecusadosPeloServidor === 1
                        ? "campo. A frase dele está sob a caixa, como o servidor a escreveu."
                        : "campos. A frase de cada um está sob a caixa, como o servidor a escreveu."}
                    </span>
                  </p>
                )}

                {errosVisiveis && temErros && (
                  <p
                    role="alert"
                    className="flex items-center gap-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12.5px] text-[var(--danger)]"
                    data-testid="aviso-erros-cadastro"
                  >
                    <AlertTriangle className="w-4 h-4 flex-none" strokeWidth={2} aria-hidden />
                    <span>
                      <Num>{Object.keys(errosCadastro).length}</Num>{" "}
                      {Object.keys(errosCadastro).length === 1
                        ? "campo precisa de correção antes de salvar."
                        : "campos precisam de correção antes de salvar."}
                    </span>
                  </p>
                )}

                {/* AS CAIXAS FICAM TRAVADAS ENQUANTO A RELEITURA CORRE.
                    O aviso logo acima diz que o cadastro está sendo relido, mas
                    aviso não impede ninguém de digitar — e a ficha abre já na
                    aba Geral, com o cursor a um clique das caixas. Quem começa
                    a preencher antes de a resposta voltar perde tudo sem toast e
                    sem desfazer: `prepararEdicao` re-hidrata o formulário com a
                    leitura nova e apaga o que foi digitado.

                    `fieldset` e não um `disabled` por campo: são dezessete
                    caixas, dois seletores e dois botões de busca, e a trava
                    nativa alcança todos de uma vez — inclusive o que for
                    acrescentado depois. Cancelar e Salvar ficam FORA: travar o
                    Cancelar seria prender o operador dentro de uma edição que
                    ele já desistiu de fazer. */}
                <fieldset disabled={!cadastroPronto} className="min-w-0 border-0 p-0 m-0 space-y-4">
                {/* O CNPJ VEM PRIMEIRO porque é dele que sai o resto: a busca
                    na Receita preenche razão social, nome fantasia, tipo
                    societário, data de abertura, contato e endereço de uma vez.
                    É a mesma ordem do cadastro (passo 1 do NewProviderWizard). */}
                <BlocoCadastro Icone={IdCard} titulo="Identificação">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* O estado guarda o CNPJ CRU; a máscara é só de exibição.
                        Guardar mascarado é 400 na hora — a coluna é de 14 dígitos. */}
                    <CampoCadastro
                      id="input-edit-cnpj"
                      rotulo="CNPJ"
                      mono
                      className="sm:col-span-2"
                      placeholder="00.000.000/0000-00"
                      valor={cnpjMascarado(cadastro.cnpj)}
                      aoMudar={v => mudarCampo("cnpj", cnpjCru(v))}
                      erro={erroDe("cnpj")}
                      acao={
                        <button
                          type="button"
                          className={cn(BOTAO_SECUNDARIO, DESABILITAVEL, "flex-none")}
                          onClick={buscarNaReceita}
                          disabled={buscaCnpj.estado === "buscando"}
                          data-testid="button-buscar-cnpj"
                        >
                          {buscaCnpj.estado === "buscando" ? (
                            <RefreshCw className="w-3.5 h-3.5 motion-safe:animate-spin" strokeWidth={2} aria-hidden />
                          ) : (
                            <Search className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                          )}
                          Buscar na Receita
                        </button>
                      }
                      dica={
                        buscaCnpj.estado === "buscando"
                          ? "Consultando o cadastro da Receita Federal..."
                          : buscaCnpj.estado === "ok"
                            /* O contato fica de fora, e a frase DIZ isso: o que
                               a Receita guarda ali é a caixa e a linha do
                               escritório de contabilidade, e o operador que não
                               soubesse ficaria esperando os campos preencherem.
                               O argumento inteiro está em `aplicarEmpresaPublica`. */
                            ? "Ficha preenchida com o cadastro da Receita Federal. E-mail e telefone de contato não entram: na Receita eles são os do contador. Revise e salve."
                            : undefined
                      }
                    />
                    {/* A busca NUNCA salva sozinha: preenche e pede revisão. */}
                    {buscaCnpj.estado === "erro" && buscaCnpj.frase && (
                      <p className="sm:col-span-2 text-[11.5px] text-[var(--danger)]" role="alert" data-testid="erro-busca-cnpj">
                        {buscaCnpj.frase}
                      </p>
                    )}
                    {/* A situação cadastral sai como a Receita a escreve: é o termo
                        dela, público e em português, e traduzir mudaria o fato. A
                        COMPARAÇÃO, essa, é normalizada (`situacaoRegular`): era
                        `!== "ATIVA"` letra por letra, e a terceira fonte escreve
                        "Ativa" — a ficha acusava irregularidade de empresa regular
                        justamente quando as duas primeiras fontes recusavam. */}
                    {buscaCnpj.estado === "ok" && buscaCnpj.situacao && !situacaoRegular(buscaCnpj.situacao) && (
                      <p
                        role="status"
                        className="sm:col-span-2 flex items-center gap-2 rounded border border-[var(--gated-border)] bg-[var(--gated-bg)] px-3 py-2 text-[12px] text-[var(--gated)]"
                        data-testid="aviso-situacao-cnpj"
                      >
                        <AlertTriangle className="w-4 h-4 flex-none" strokeWidth={2} aria-hidden />
                        Situação cadastral na Receita Federal:{" "}
                        <strong className="font-mono font-medium uppercase tracking-[var(--track-wide)]">
                          {buscaCnpj.situacao}
                        </strong>
                      </p>
                    )}
                    <CampoCadastro
                      id="input-edit-name"
                      rotulo="Razão social"
                      className="sm:col-span-2"
                      valor={cadastro.name}
                      aoMudar={v => mudarCampo("name", v)}
                      erro={erroDe("name")}
                    />
                    <CampoCadastro
                      id="input-edit-trade-name"
                      rotulo="Nome fantasia"
                      valor={cadastro.tradeName}
                      aoMudar={v => mudarCampo("tradeName", v)}
                      erro={erroDe("tradeName")}
                    />
                    <SelecaoCadastro
                      id="input-edit-legal-type"
                      rotulo="Tipo societário"
                      valor={cadastro.legalType}
                      aoMudar={v => mudarCampo("legalType", v)}
                      opcoes={opcoesComValorAtual(TIPOS_SOCIETARIOS, cadastro.legalType)}
                    />
                    {/* Campo de TEXTO, e não `type="date"`. A coluna é TEXT: um
                        valor gravado fora do ISO (dd/mm/aaaa de uma importação
                        antiga) desaparece da caixa de data sem aviso, e o
                        primeiro salvamento o apagaria do banco. Em texto o
                        operador vê o que está lá e pode corrigir. */}
                    <CampoCadastro
                      id="input-edit-opening-date"
                      rotulo="Data de abertura"
                      mono
                      placeholder="AAAA-MM-DD"
                      maxLength={20}
                      valor={cadastro.openingDate}
                      aoMudar={v => mudarCampo("openingDate", v)}
                      erro={erroDe("openingDate")}
                    />
                    <SelecaoCadastro
                      id="input-edit-segment"
                      rotulo="Segmento"
                      valor={cadastro.businessSegment}
                      aoMudar={v => mudarCampo("businessSegment", v)}
                      opcoes={opcoesComValorAtual(SEGMENTOS, cadastro.businessSegment)}
                    />
                  </div>
                </BlocoCadastro>

                <BlocoCadastro Icone={Mail} titulo="Contato">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <CampoCadastro
                      id="input-edit-email"
                      rotulo="E-mail de contato"
                      tipo="email"
                      placeholder="contato@provedor.com.br"
                      valor={cadastro.contactEmail}
                      aoMudar={v => mudarCampo("contactEmail", v)}
                      erro={erroDe("contactEmail")}
                    />
                    <CampoCadastro
                      id="input-edit-phone"
                      rotulo="Telefone"
                      mono
                      placeholder="(00) 00000-0000"
                      valor={cadastro.contactPhone}
                      aoMudar={v => mudarCampo("contactPhone", v)}
                      erro={erroDe("contactPhone")}
                    />
                    <CampoCadastro
                      id="input-edit-website"
                      rotulo="Site"
                      className="sm:col-span-2"
                      placeholder="https://provedor.com.br"
                      valor={cadastro.website}
                      aoMudar={v => mudarCampo("website", v)}
                      erro={erroDe("website")}
                      dica="Sem o https:// na frente, ele é completado ao salvar."
                    />
                  </div>
                </BlocoCadastro>

                <BlocoCadastro Icone={MapPin} titulo="Endereço">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    {/* A consulta sai sozinha quando há 8 dígitos, e uma vez por
                        CEP. O botão existe para repetir a mesma consulta — a
                        primeira pode ter caído, ou o operador desfez o
                        preenchimento na mão. */}
                    <CampoCadastro
                      id="input-edit-zip"
                      rotulo="CEP"
                      mono
                      placeholder="00000-000"
                      valor={cepMascarado(cadastro.addressZip)}
                      aoMudar={mudarCep}
                      erro={erroDe("addressZip")}
                      acao={
                        <button
                          type="button"
                          className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE, DESABILITAVEL, "flex-none")}
                          onClick={() => buscarCep(cepCru(cadastro.addressZip), true)}
                          disabled={buscaCep === "buscando" || cepCru(cadastro.addressZip).length !== 8}
                          aria-label="Buscar endereço do CEP"
                          data-testid="button-buscar-cep"
                        >
                          {buscaCep === "buscando" ? (
                            <RefreshCw className="w-3.5 h-3.5 motion-safe:animate-spin" strokeWidth={2} aria-hidden />
                          ) : (
                            <Search className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                          )}
                        </button>
                      }
                      dica={
                        buscaCep === "buscando" ? "Buscando o endereço..."
                          : buscaCep === "ok" ? "Endereço preenchido pelo CEP."
                            : buscaCep === "vazio" ? "CEP não encontrado. Preencha o endereço à mão."
                              : buscaCep === "erro" ? "A busca de CEP não respondeu. Preencha à mão."
                                : undefined
                      }
                    />
                    <CampoCadastro
                      id="input-edit-street"
                      rotulo="Logradouro"
                      className="sm:col-span-2"
                      valor={cadastro.addressStreet}
                      aoMudar={v => mudarCampo("addressStreet", v)}
                      erro={erroDe("addressStreet")}
                    />
                    <CampoCadastro
                      id="input-edit-number"
                      rotulo="Número"
                      mono
                      valor={cadastro.addressNumber}
                      aoMudar={v => mudarCampo("addressNumber", v)}
                      erro={erroDe("addressNumber")}
                    />
                    <CampoCadastro
                      id="input-edit-complement"
                      rotulo="Complemento"
                      valor={cadastro.addressComplement}
                      aoMudar={v => mudarCampo("addressComplement", v)}
                      erro={erroDe("addressComplement")}
                    />
                    <CampoCadastro
                      id="input-edit-neighborhood"
                      rotulo="Bairro"
                      valor={cadastro.addressNeighborhood}
                      aoMudar={v => mudarCampo("addressNeighborhood", v)}
                      erro={erroDe("addressNeighborhood")}
                    />
                    <CampoCadastro
                      id="input-edit-city"
                      rotulo="Cidade"
                      valor={cadastro.addressCity}
                      aoMudar={v => mudarCampo("addressCity", v)}
                      erro={erroDe("addressCity")}
                    />
                    {/* A UF sobe para maiúscula no ATO, e não por CSS: a classe
                        `uppercase` mostraria "MG" com "mg" guardado, e a caixa
                        estaria mentindo sobre o valor. Subir de verdade também
                        casa com o que `corpoDoPatch` grava. */}
                    <CampoCadastro
                      id="input-edit-state"
                      rotulo="UF"
                      mono
                      maxLength={2}
                      valor={cadastro.addressState}
                      aoMudar={v => mudarCampo("addressState", v.toUpperCase())}
                      erro={erroDe("addressState")}
                    />
                  </div>
                </BlocoCadastro>

                <BlocoCadastro Icone={Globe} titulo="Plataforma">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <CampoCadastro
                      id="input-edit-subdomain"
                      rotulo="Subdomínio"
                      mono
                      valor={cadastro.subdomain}
                      aoMudar={v => mudarCampo("subdomain", v)}
                      erro={erroDe("subdomain")}
                      dica={
                        cadastro.subdomain.trim()
                          ? `${cadastro.subdomain.trim().toLowerCase()}.consultaisp.com.br`
                          : "Sem subdomínio o provedor entra pelo endereço principal."
                      }
                    />
                  </div>
                </BlocoCadastro>
                </fieldset>

                {/* OS BOTÕES DE NOVO, NO FIM. Os do `TopoCartao` saem da tela
                    assim que se rola um formulário de dezessete campos, e o
                    operador termina de preencher aqui embaixo. */}
                <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
                  {acoesDaEdicao("-fim")}
                </div>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* O CARTÃO MOSTRA O QUE O FORMULÁRIO EDITA.
                  Ele exibia sete linhas, e nome fantasia, tipo societário, data
                  de abertura, segmento, endereço e a conferência do cadastro não
                  apareciam em lugar nenhum da ficha — nem em leitura. O
                  superadmin não tinha como conferir o que acabara de corrigir.
                  Duas colunas porque dezessete campos em coluna única deixariam
                  este cartão com o dobro da altura do "Plano e créditos". */}
              <Card>
                <TopoCartao titulo="Cadastro" Icone={Building2} acao={
                  <button
                    type="button"
                    className={cn(BOTAO_SECUNDARIO, "flex-none")}
                    onClick={startEdit}
                    data-testid="button-edit-cadastro"
                  >
                    <Edit2 className="w-3.5 h-3.5" strokeWidth={2} /> Editar
                  </button>
                } />
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 px-4 py-3" data-testid="dados-cadastro">
                  <DadoCadastro rotulo="Razão social" className="sm:col-span-2">{provider.name}</DadoCadastro>
                  <DadoCadastro rotulo="Nome fantasia">{provider.tradeName || "—"}</DadoCadastro>
                  <DadoCadastro rotulo="CNPJ" mono={!!provider.cnpj}>
                    {provider.cnpj ? cnpjMascarado(provider.cnpj) : "—"}
                  </DadoCadastro>
                  <DadoCadastro rotulo="Tipo societário">{provider.legalType || "—"}</DadoCadastro>
                  <DadoCadastro rotulo="Data de abertura" mono={!!provider.openingDate}>
                    {fmtDataIso(provider.openingDate)}
                  </DadoCadastro>
                  <DadoCadastro rotulo="Segmento" className="sm:col-span-2">{provider.businessSegment || "—"}</DadoCadastro>
                  <DadoCadastro rotulo="E-mail de contato" className="sm:col-span-2">{provider.contactEmail || "—"}</DadoCadastro>
                  <DadoCadastro rotulo="Telefone" mono={!!provider.contactPhone}>{provider.contactPhone || "—"}</DadoCadastro>
                  <DadoCadastro rotulo="Site">{provider.website || "—"}</DadoCadastro>
                  <DadoCadastro rotulo="CEP" mono={!!provider.addressZip}>
                    {provider.addressZip ? cepMascarado(provider.addressZip) : "—"}
                  </DadoCadastro>
                  <DadoCadastro rotulo="Endereço">{enderecoDoProvedor}</DadoCadastro>
                  <DadoCadastro rotulo="Subdomínio" className="sm:col-span-2" mono={!!provider.subdomain}>
                    {provider.subdomain ? `${provider.subdomain}.consultaisp.com.br` : "Não configurado"}
                  </DadoCadastro>
                  <DadoCadastro rotulo="Cadastrado em" mono>{fmtDate(provider.createdAt)}</DadoCadastro>
                  <DadoCadastro rotulo="Conferência do cadastro">
                    <Selo tom={conferencia.tom} testId="badge-conferencia">{conferencia.label}</Selo>
                  </DadoCadastro>
                </dl>
              </Card>

              <Card>
                <TopoCartao titulo="Plano e créditos" Icone={Star} />
                <div className="px-4 py-3 space-y-3">
                  {/* Este bloco estava escrito a mao TRES vezes so nesta tela, e
                      seis no painel. `AvisoNaoCarregou` e a peca unica; o que
                      ela conserta de verdade e o alvo do "Tentar de novo", que
                      como texto sublinhado de 12px tinha ~16px de altura
                      clicavel — menos de metade dos 44px da secao 7. A frase
                      continua com a tela, porque o que falhou muda o que dizer. */}
                  {erroPrecos && (
                    <AvisoNaoCarregou aoTentarDeNovo={() => recarregarPrecos()} testId="erro-precos-plano">
                      Não foi possível carregar a tabela de preços.
                    </AvisoNaoCarregou>
                  )}
                  <div>
                    <LinhaDado rotulo="Plano atual">
                      <Selo tom={plano.tom}>{plano.label}</Selo>
                    </LinhaDado>
                    <LinhaDado rotulo="Mensalidade">
                      {carregandoPrecos ? (
                        <Skeleton className="h-4 w-20" data-testid="skeleton-mensalidade" />
                      ) : planoCobrado ? (
                        <Num className="text-[13px] font-medium text-[var(--text)]" testId="text-mensalidade">{planoCobrado.precoLabel}</Num>
                      ) : (
                        /* Ausencia de preco nao e gratuidade: a tela cala em vez
                           de afirmar um valor que o servidor nao confirmou. */
                        <span className="text-[13px] text-[var(--text-muted)]" data-testid="mensalidade-indisponivel">Tabela indisponível</span>
                      )}
                    </LinhaDado>
                    <LinhaDado rotulo="Créditos ISP">
                      <Num className="text-[13px] font-medium text-[var(--text)]">
                        {provider.ispCredits}{planoCobrado && planoCobrado.creditosInclusos.isp > 0 ? ` / ${planoCobrado.creditosInclusos.isp}` : ""}
                      </Num>
                    </LinhaDado>
                    <LinhaDado rotulo="Créditos SPC">
                      <Num className="text-[13px] font-medium text-[var(--text)]">
                        {provider.spcCredits}{planoCobrado && planoCobrado.creditosInclusos.spc > 0 ? ` / ${planoCobrado.creditosInclusos.spc}` : ""}
                      </Num>
                    </LinhaDado>
                    <LinhaDado rotulo="Situação">
                      <Selo tom={situacao.tom}>{situacao.label}</Selo>
                    </LinhaDado>
                  </div>
                </div>
              </Card>

              {/* O CARTAO DE DNS ERA A AREA MAIS AZUL DA TELA — borda, fundo,
                  cabecalho de tabela, tinta do destino e ate o selo do tipo, tudo
                  na paleta default do Tailwind. Nada disso significava nada: o
                  azul nao era estado, era enfeite. Vira cartao comum; a unica cor
                  que sobra e a do selo, que diz de verdade que falta uma acao
                  manual do operador. */}
              {provider.subdomain && (
                <Card className="md:col-span-2 overflow-hidden" data-testid="card-dns-config">
                  <TopoCartao
                    titulo="Configuração de DNS do subdomínio"
                    Icone={Globe}
                    sub={
                      <>
                        Crie o registro abaixo no painel de DNS do domínio{" "}
                        <Num>consultaisp.com.br</Num> para o subdomínio deste provedor responder.
                      </>
                    }
                    acao={
                      <Selo tom="gated" testId="badge-dns-status">
                        Configurar manualmente
                      </Selo>
                    }
                  />
                  {/* O cabecalho era 10px com padding proprio: o corpo do SELO e
                      do KICKER, e no cabecalho de tabela ele deixa de ler como
                      cabecalho. `Th` traz os 9,5px da secao 6, o fundo de
                      superficie de segundo nivel e o hairline. */}
                  <TabelaPainel>
                    <thead>
                      <tr>
                        {["Nome / host", "Tipo", "Destino", "TTL", ""].map((h, i) => (
                          <Th key={i}>{h}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {/* Host e destino se leem caractere a caractere e da
                            esquerda para a direita: mono, sem alinhar a direita. */}
                        <Td num alinhamento="esquerda">
                          <Num className="text-[13px] font-medium text-[var(--text)]" testId="dns-host">{provider.subdomain}</Num>
                        </Td>
                        <Td>
                          <Selo tom="neutro">CNAME</Selo>
                        </Td>
                        <Td num alinhamento="esquerda">
                          <Num className="text-[13px] text-[var(--text)]" testId="dns-destination">app.consultaisp.com.br</Num>
                        </Td>
                        <Td num alinhamento="esquerda">
                          <Num className="text-[13px] text-[var(--text-muted)]">3600</Num>
                        </Td>
                        <Td>
                          <button
                            type="button"
                            onClick={() => { navigator.clipboard.writeText(`${provider.subdomain}\tCNAME\tapp.consultaisp.com.br`); }}
                            className={cn(BOTAO_SECUNDARIO, "px-2.5")}
                            data-testid="button-copy-dns-record"
                          >
                            <Copy className="w-3 h-3" strokeWidth={2} />Copiar
                          </button>
                        </Td>
                      </tr>
                    </tbody>
                  </TabelaPainel>
                  {/* Sem `border-t`: a celula da primitiva ja fecha a linha com o
                      hairline, e as duas juntas leriam como uma borda de 2px. */}
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2">
                      <Globe className="w-3.5 h-3.5 flex-none text-[var(--text-faint)]" strokeWidth={2} />
                      <Num className="text-[12px] text-[var(--text-2)] truncate" testId="text-full-subdomain-url">
                        {provider.subdomain}.consultaisp.com.br
                      </Num>
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(`${provider.subdomain}.consultaisp.com.br`); }}
                        className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE, "ml-auto flex-none")}
                        aria-label="Copiar endereço do subdomínio"
                        data-testid="button-copy-subdomain-url"
                      >
                        <Copy className="w-3 h-3" strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                </Card>
              )}

              {/* Os tres totais eram tres poços coloridos (verde, amarelo,
                  vermelho) com o numero em Inter bold. Viram cartao de metrica,
                  como qualquer outro numero do produto. So o VENCIDO leva cor, e
                  so quando existe: dinheiro atrasado e risco; recebido e pago
                  nao precisa gritar. */}
              <section className="md:col-span-2">
                <KickerSecao>Resumo financeiro</KickerSecao>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <CartaoMetrica rotulo="Total pago" valor={<Dinheiro valor={financial.totalPaid} />} sub="faturas quitadas" testId="card-total-pago" />
                  <CartaoMetrica rotulo="Em aberto" valor={<Dinheiro valor={financial.totalPending} />} sub="a vencer" testId="card-total-aberto" />
                  <CartaoMetrica
                    rotulo="Vencido"
                    valor={
                      /* A cor do vencido NAO sai de `Dinheiro`: ali o vermelho
                         seria o sinal do numero, e este valor e positivo —
                         alguem deve. E atraso, entao e `--past`, e quem sabe
                         que aquilo esta vencido e esta tela. */
                      <Dinheiro
                        valor={financial.totalOverdue}
                        className={financial.totalOverdue > 0 ? "text-[var(--past)]" : undefined}
                      />
                    }
                    sub="fora do prazo"
                    testId="card-total-vencido"
                  />
                </div>
              </section>
            </div>
          )}
        </TabsContent>

        {/* TAB: FINANCEIRO */}
        <TabsContent value="financeiro">
          <Card className="overflow-hidden">
            <TopoCartao
              titulo="Faturas do provedor"
              Icone={Receipt}
              sub={<><Num>{invoices.length}</Num> {invoices.length === 1 ? "fatura emitida" : "faturas emitidas"}</>}
              acao={
                <button type="button" className={cn(BOTAO_SECUNDARIO, "flex-none")} onClick={abrirNovaFatura} data-testid="button-new-invoice-fin">
                  <Plus className="w-3.5 h-3.5" strokeWidth={2} /> Nova fatura
                </button>
              }
            />
            {invoices.length === 0 ? (
              <EstadoVazio
                Icone={Receipt}
                titulo="Nenhuma fatura emitida"
                descricao="Assim que a primeira mensalidade for lançada para este provedor, ela aparece aqui com período, vencimento e situação."
                cta={
                  <button type="button" className={BOTAO_SECUNDARIO} onClick={abrirNovaFatura} data-testid="button-nova-fatura-vazio">
                    <Plus className="w-3.5 h-3.5" strokeWidth={2} /> Nova fatura
                  </button>
                }
                testId="empty-faturas"
              />
            ) : (
              <div className="divide-y divide-[var(--border-faint)]">
                {invoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--surface-2)] motion-safe:transition-colors" data-testid={`row-invoice-${inv.id}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="min-w-0">
                        <Num className="block text-[13px] font-medium text-[var(--text)]">{inv.invoiceNumber}</Num>
                        <p className="text-[12px] text-[var(--text-muted)]">
                          <Num>{inv.period}</Num> · vence <Num>{fmtDate(inv.dueDate)}</Num>
                        </p>
                      </div>
                      <SeloFatura status={inv.status} />
                    </div>
                    <div className="flex items-center gap-3 flex-none">
                      <Dinheiro valor={inv.amount} className="text-[13px] font-medium text-[var(--text)]" />
                      <div className="flex items-center gap-1.5">
                        {/* Icone sozinho continua sendo um controle: rotulo
                            acessivel e o mesmo alvo de toque dos demais.
                            `CAIXA_ICONE` e a LARGURA desse alvo — `ALVO_CONTROLE`
                            so fala de altura, e com `px-2.5` o botao ficava com
                            44px de altura e 34 de largura no dedo. A secao 7 fala
                            dos dois eixos. Nao vira `BotaoIcone` porque este e
                            fantasma, sem borda: aqui a barra de acoes precisa da
                            borda para se separar do valor da fatura ao lado. */}
                        <button
                          type="button"
                          className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE)}
                          onClick={() => window.open(`/admin/fatura/${inv.id}`, "_blank")}
                          aria-label={`Abrir a fatura ${inv.invoiceNumber}`}
                          data-testid={`button-view-invoice-${inv.id}`}
                        >
                          <Eye className="w-3.5 h-3.5" strokeWidth={2} />
                        </button>
                        {inv.status !== "paid" && (
                          <button
                            type="button"
                            className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE, "text-[var(--ok)] border-[var(--ok-border)] hover:bg-[var(--ok-bg)]")}
                            onClick={() => invoiceStatusMutation.mutate({ invoiceId: inv.id, status: "paid" })}
                            aria-label={`Marcar a fatura ${inv.invoiceNumber} como paga`}
                            data-testid={`button-mark-paid-${inv.id}`}
                          >
                            <CheckCircle className="w-3.5 h-3.5" strokeWidth={2} />
                          </button>
                        )}
                        {inv.status === "pending" && (
                          <button
                            type="button"
                            className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE, "text-[var(--danger)] border-[var(--danger-border)] hover:bg-[var(--danger-bg)]")}
                            onClick={() => invoiceStatusMutation.mutate({ invoiceId: inv.id, status: "overdue" })}
                            aria-label={`Marcar a fatura ${inv.invoiceNumber} como vencida`}
                            data-testid={`button-mark-overdue-${inv.id}`}
                          >
                            <AlertCircle className="w-3.5 h-3.5" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* TAB: USUARIOS */}
        <TabsContent value="usuarios">
          <Card className="overflow-hidden">
            <TopoCartao
              titulo="Usuários do provedor"
              Icone={Users}
              sub={<><Num>{users.length}</Num> {users.length === 1 ? "conta cadastrada" : "contas cadastradas"}</>}
            />

            {editingEmailUser && (
              <div className="m-4 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h4 className={cn(TITULO_CARTAO, "flex items-center gap-2")}>
                    <Edit2 className="w-4 h-4 flex-none text-[var(--text-faint)]" strokeWidth={2} />
                    Alterar e-mail de acesso
                  </h4>
                  <button
                    type="button"
                    className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE, "flex-none")}
                    onClick={() => { setEditingEmailUser(null); setNewEmail(""); }}
                    aria-label="Cancelar alteração de e-mail"
                    data-testid="button-cancel-edit-email"
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                </div>
                <p className="text-[12px] text-[var(--text-muted)] mb-3">
                  {editingEmailUser.name} — hoje entra com{" "}
                  <span className="font-medium text-[var(--text)]">{editingEmailUser.email}</span>
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Novo e-mail de acesso"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="flex-1 max-w-sm"
                    data-testid="input-new-email"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newEmail.includes("@")) {
                        updateEmailMutation.mutate({ id: editingEmailUser.id, email: newEmail });
                      }
                    }}
                  />
                  <button
                    type="button"
                    className={cn(BOTAO_MARCA, DESABILITAVEL)}
                    disabled={!newEmail.includes("@") || updateEmailMutation.isPending}
                    onClick={() => updateEmailMutation.mutate({ id: editingEmailUser.id, email: newEmail })}
                    data-testid="button-save-email"
                  >
                    {updateEmailMutation.isPending
                      ? <RefreshCw className="w-3.5 h-3.5 motion-safe:animate-spin" strokeWidth={2} />
                      : <Save className="w-3.5 h-3.5" strokeWidth={2} />}
                    Salvar
                  </button>
                </div>
              </div>
            )}

            {users.length === 0 ? (
              <EstadoVazio
                Icone={Users}
                titulo="Nenhum usuário cadastrado"
                descricao="Este provedor não tem nenhuma conta de acesso. As contas nascem no cadastro do provedor e no convite feito pelo painel dele."
                testId="empty-usuarios"
              />
            ) : (
              <div className="divide-y divide-[var(--border-faint)]">
                {users.map((u: any) => (
                  <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`row-user-${u.id}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Aqui quem esta representado e uma PESSOA, entao a forma
                          e `avatar` — o unico redondo que a secao 5.1 autoriza,
                          e por nome. Selo de estado continua retangular.
                          O tamanho `md` (36px) e a mesma medida de antes; o que
                          muda e o dono do valor. */}
                      <LadrilhoInicial nome={u.name} forma="avatar" />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-[var(--text)] truncate">{u.name}</p>
                        <p className="text-[12px] text-[var(--text-muted)] truncate">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 flex-none">
                      <Selo tom={u.role === "admin" ? "marca" : "neutro"}>
                        {u.role === "admin" ? "Administrador" : "Operador"}
                      </Selo>
                      {/* O par verificado/nao verificado era icone mudo com
                          `title`. Vira selo, que se le sem passar o mouse — e o
                          "nao verificado" e mesmo um portao, nao uma falha. */}
                      <Selo tom={u.emailVerified ? "ok" : "gated"} Icone={u.emailVerified ? CheckCircle : XCircle}>
                        {u.emailVerified ? "E-mail verificado" : "E-mail pendente"}
                      </Selo>
                      <button
                        type="button"
                        className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE)}
                        onClick={() => { setEditingEmailUser({ id: u.id, name: u.name, email: u.email }); setNewEmail(""); }}
                        aria-label={`Alterar o e-mail de acesso de ${u.name}`}
                        data-testid={`button-edit-email-${u.id}`}
                      >
                        <Edit2 className="w-3.5 h-3.5" strokeWidth={2} />
                      </button>
                      <Num className="text-[12px] text-[var(--text-muted)]">{fmtDate(u.createdAt)}</Num>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* TAB: CONSUMO */}
        {/* As duas listas eram o mesmo cartao pintado de azul e de roxo, com a
            contagem repetindo a cor do cabecalho. A identidade de cada uma vem
            do titulo e do icone; a cor nao dizia nada e as duas contagens agora
            sao mono tabular, alinhadas entre si. */}
        <TabsContent value="consumo">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="overflow-hidden">
              <TopoCartao
                titulo="Consultas ISP"
                Icone={ScanSearch}
                sub={<><Num>{stats.ispConsultations}</Num> no total · <Num>{stats.ispConsultationsMonth}</Num> neste mês</>}
              />
              {recentIsp.length === 0 ? (
                <EstadoVazio
                  Icone={ScanSearch}
                  titulo="Nenhuma consulta ISP"
                  descricao="Este provedor ainda não consultou nenhum CPF ou CNPJ na rede. As consultas mais recentes aparecem aqui."
                  testId="empty-consultas-isp"
                />
              ) : (
                <div className="divide-y divide-[var(--border-faint)] max-h-80 overflow-y-auto">
                  {recentIsp.map((c: any) => (
                    <div key={c.id} className="px-4 py-2.5 flex items-center justify-between gap-3" data-testid={`row-isp-${c.id}`}>
                      <div className="min-w-0">
                        <Num className="block text-[13px] font-medium text-[var(--text)]">{c.cpfCnpj}</Num>
                        <p className="text-[12px] text-[var(--text-muted)] truncate max-w-[180px]">{c.name || "—"}</p>
                      </div>
                      <Num className="text-[12px] text-[var(--text-muted)] flex-none">{fmtDateTime(c.createdAt)}</Num>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <TopoCartao
                titulo="Consultas SPC"
                Icone={BarChart3}
                sub={<><Num>{stats.spcConsultations}</Num> no total · <Num>{stats.spcConsultationsMonth}</Num> neste mês</>}
              />
              {recentSpc.length === 0 ? (
                <EstadoVazio
                  Icone={BarChart3}
                  titulo="Nenhuma consulta SPC"
                  descricao="Este provedor ainda não fez nenhuma consulta no SPC Brasil. As consultas mais recentes aparecem aqui."
                  testId="empty-consultas-spc"
                />
              ) : (
                <div className="divide-y divide-[var(--border-faint)] max-h-80 overflow-y-auto">
                  {recentSpc.map((c: any) => (
                    <div key={c.id} className="px-4 py-2.5 flex items-center justify-between gap-3" data-testid={`row-spc-${c.id}`}>
                      <div className="min-w-0">
                        <Num className="block text-[13px] font-medium text-[var(--text)]">{c.cpfCnpj}</Num>
                        <p className="text-[12px] text-[var(--text-muted)] truncate max-w-[180px]">{c.name || "—"}</p>
                      </div>
                      <Num className="text-[12px] text-[var(--text-muted)] flex-none">{fmtDateTime(c.createdAt)}</Num>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* TAB: HISTORICO */}
        <TabsContent value="historico">
          <Card className="overflow-hidden">
            <TopoCartao titulo="Histórico de alterações" Icone={History} sub="Mudanças de plano e créditos lançados" />
            {planHistory.length === 0 ? (
              <EstadoVazio
                Icone={History}
                titulo="Nenhuma alteração registrada"
                descricao="Toda troca de plano e todo crédito lançado por um administrador ficam registrados aqui, com autor e data."
                testId="empty-historico"
              />
            ) : (
              <div className="divide-y divide-[var(--border-faint)]">
                {planHistory.map((h: any) => (
                  <div key={h.id} className="px-4 py-3 flex items-start gap-3" data-testid={`row-history-${h.id}`}>
                    {/* Ladrilho neutro nos dois casos: troca de plano e credito
                        lancado sao registro, nao risco — o laranja do raio era
                        cor sem significado. */}
                    <LadrilhoIcone Icone={h.oldPlan ? RefreshCw : Zap} tom="vazio" />
                    <div className="flex-1 min-w-0">
                      {h.oldPlan ? (
                        <p className="text-[13px] text-[var(--text-2)]">
                          Plano alterado:{" "}
                          <span className="text-[var(--text-muted)]">{seloDoPlano(h.oldPlan).label}</span>
                          {" → "}
                          <span className="font-medium text-[var(--text)]">{seloDoPlano(h.newPlan).label}</span>
                        </p>
                      ) : (
                        <p className="text-[13px] text-[var(--text-2)]">
                          Créditos adicionados:
                          {h.ispCreditsAdded > 0 && <> <Num className="font-medium text-[var(--text)]">+{h.ispCreditsAdded}</Num> ISP</>}
                          {h.spcCreditsAdded > 0 && <> <Num className="font-medium text-[var(--text)]">+{h.spcCreditsAdded}</Num> SPC</>}
                        </p>
                      )}
                      {h.notes && <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{h.notes}</p>}
                      <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                        {h.changedByName} · <Num>{fmtDateTime(h.createdAt)}</Num>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* TAB: INTEGRACAO ERP */}
        {/* `provider.erpSource` e `provider.erpEnabled` iam daqui e chegavam
            sempre `undefined`: a tabela `providers` nao tem essas colunas e
            /detail devolve o registro cru. A aba lia integracao de la e
            deduzia "Configurado" de um valor que nunca existiu — tudo agora
            sai de `erp_integrations`. */}
        <IntegracaoTab providerId={providerId} ativo={activeTab === "integracao"} />

        {/* TAB: ACESSO DE SUPORTE */}
        <AcessoSuporteTab
          providerId={providerId}
          nomeProvedor={provider.name}
          ativo={activeTab === "suporte"}
        />

      </Tabs>

      {/* Modal: alterar plano.
          A CASCA DOS TRÊS MODAIS DESTA TELA vem de `MolduraModal`, e o motivo
          não é aparência: os três eram uma `<div>` sobre uma cortina, sem
          `role="dialog"`, sem `aria-modal` e sem nome. Para quem usa leitor de
          tela isso significa que a página atrás continuava fazendo parte da
          leitura e que a caixa aberta não se anunciava. A acessibilidade existia
          — mas só dentro dos dois modais do Asaas, porque a casca era privada do
          arquivo financeiro. Ela subiu para a primitiva e agora chega aqui.

          O QUE MUDA DE PIXEL, declarado: a caixa passa de 448px (`max-w-md`)
          para os 384px que a primitiva define como A largura de modal do
          sistema, o corpo ganha o padding de 20px da moldura no lugar da faixa
          de cabeçalho e do rodapé sangrados do `Card`, e o título troca
          `TopoCartao` por `TITULO_MODAL` — 15px, o corpo que a primitiva
          reserva ao modal, que é a tela enquanto está aberto. O X de fechar
          fica: ele e o "Cancelar" fazem a mesma coisa, mas tirar o X removeria
          um alvo que já existe. */}
      {showPlanModal && (
        <MolduraModal rotulo="Alterar plano" onFechar={() => setShowPlanModal(false)}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className={TITULO_MODAL}>
              <Star className="w-4 h-4 flex-none text-[var(--text-faint)]" strokeWidth={2} />
              Alterar plano
            </h2>
            <button type="button" className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE, "flex-none")} onClick={() => setShowPlanModal(false)} aria-label="Fechar">
              <X className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
          <div className="space-y-3">
            {carregandoPrecos && <Skeleton className="h-9 w-full" data-testid="skeleton-precos-plano" />}
            {erroPrecos && (
              /* Anunciar plano com preco desta tela foi exatamente o defeito.
                 Sem a tabela do servidor o seletor nao tem o que oferecer. */
              <AvisoNaoCarregou aoTentarDeNovo={() => recarregarPrecos()} testId="erro-precos-troca-plano">
                Não foi possível carregar a tabela de preços. O plano não pode ser trocado sem ela.
              </AvisoNaoCarregou>
            )}
            <div className="space-y-1.5">
              <Label>Plano</Label>
              <Select value={planForm.plan} disabled={!precos} onValueChange={v => setPlanForm(f => ({ ...f, plan: v }))}>
                {/* A caixa do seletor é a mesma dos campos de texto:
                    `CONTROLE_CAMPO`. Solto, `ALVO_CONTROLE` dava só a altura —
                    o seletor ficava sem a borda de área editável e sem anel de
                    foco ao lado de campos que têm os dois. */}
                <SelectTrigger className={CONTROLE_CAMPO} data-testid="select-plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(precos?.planos ?? []).map(p => (
                    <SelectItem key={p.chave} value={p.chave}>{p.rotulo} — {p.precoLabel}/mês</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Observação (opcional)</Label>
              <Textarea
                value={planForm.notes}
                onChange={e => setPlanForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Motivo da mudança de plano..."
                rows={2}
                data-testid="textarea-plan-notes"
              />
            </div>
          </div>
          {/* Sem a régua sangrada do rodapé do `Card`: dentro do padding da
              moldura ela pararia a 20px de cada borda e leria como um traço
              solto. Os dois modais do Asaas já separam os botões pelo espaço,
              e é essa a voz de rodapé de modal do painel. */}
          <div className="flex gap-2 justify-end mt-4">
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setShowPlanModal(false)}>Cancelar</button>
            <button
              type="button"
              className={cn(BOTAO_MARCA, DESABILITAVEL)}
              onClick={() => planMutation.mutate(planForm)}
              disabled={planMutation.isPending || !planForm.plan || !precos}
              data-testid="button-confirm-plan"
            >
              {planMutation.isPending ? "Salvando..." : "Confirmar"}
            </button>
          </div>
        </MolduraModal>
      )}

      {/* Modal: adicionar créditos. Mesma casca compartilhada — ver o comentário
          do modal de plano. */}
      {showCreditsModal && (
        <MolduraModal rotulo="Adicionar créditos" onFechar={() => setShowCreditsModal(false)}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className={TITULO_MODAL}>
              <Zap className="w-4 h-4 flex-none text-[var(--text-faint)]" strokeWidth={2} />
              Adicionar créditos
            </h2>
            <button type="button" className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE, "flex-none")} onClick={() => setShowCreditsModal(false)} aria-label="Fechar">
              <X className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
          <div className="space-y-3">
            {/* O saldo de hoje sai no MESMO cartao de metrica das outras telas —
                eram dois poços coloridos com o numero em Inter bold. */}
            <div className="grid grid-cols-2 gap-3">
              <CartaoMetrica rotulo="Saldo ISP" valor={provider.ispCredits} testId="card-modal-saldo-isp" />
              <CartaoMetrica rotulo="Saldo SPC" valor={provider.spcCredits} testId="card-modal-saldo-spc" />
            </div>
            <div className="space-y-1.5">
              <Label>Créditos ISP a adicionar</Label>
              <Input
                type="number"
                value={creditsForm.ispCredits}
                onChange={e => setCreditsForm(f => ({ ...f, ispCredits: e.target.value }))}
                placeholder="0"
                data-testid="input-isp-credits"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Créditos SPC a adicionar</Label>
              <Input
                type="number"
                value={creditsForm.spcCredits}
                onChange={e => setCreditsForm(f => ({ ...f, spcCredits: e.target.value }))}
                placeholder="0"
                data-testid="input-spc-credits"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Créditos de consulta cadastral a adicionar</Label>
              <Input
                type="number"
                value={creditsForm.bigdataCredits}
                onChange={e => setCreditsForm(f => ({ ...f, bigdataCredits: e.target.value }))}
                placeholder="0"
                data-testid="input-bigdata-credits"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Observação (opcional)</Label>
              <Input
                value={creditsForm.notes}
                onChange={e => setCreditsForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Motivo..."
                data-testid="input-credits-notes"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setShowCreditsModal(false)}>Cancelar</button>
            <button
              type="button"
              className={cn(BOTAO_MARCA, DESABILITAVEL)}
              onClick={() => creditsMutation.mutate({
                ispCredits: parseInt(creditsForm.ispCredits) || 0,
                spcCredits: parseInt(creditsForm.spcCredits) || 0,
                bigdataCredits: parseInt(creditsForm.bigdataCredits) || 0,
                notes: creditsForm.notes,
              })}
              disabled={creditsMutation.isPending}
              data-testid="button-confirm-credits"
            >
              {creditsMutation.isPending ? "Salvando..." : "Adicionar"}
            </button>
          </div>
        </MolduraModal>
      )}

      {/* Modal: nova fatura. Mesma casca compartilhada — ver o comentário do
          modal de plano. */}
      {showInvoiceModal && (
        <MolduraModal rotulo="Nova fatura" onFechar={() => setShowInvoiceModal(false)}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className={TITULO_MODAL}>
              <Receipt className="w-4 h-4 flex-none text-[var(--text-faint)]" strokeWidth={2} />
              Nova fatura
            </h2>
            <button type="button" className={cn(BOTAO_SECUNDARIO, CAIXA_ICONE, "flex-none")} onClick={() => setShowInvoiceModal(false)} aria-label="Fechar">
              <X className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
          <div className="space-y-3">
            {carregandoPrecos && <Skeleton className="h-9 w-full" data-testid="skeleton-precos-fatura" />}
            {erroPrecos && (
              /* Sem a tabela o formulario nao sabe quanto cobrar, e o campo
                 vazio ao lado do botao ativo era o convite ao R$ 0,00. */
              <AvisoNaoCarregou aoTentarDeNovo={() => recarregarPrecos()} testId="erro-precos-fatura">
                Não foi possível carregar a tabela de preços. A fatura não pode ser emitida sem ela.
              </AvisoNaoCarregou>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Período (AAAA-MM)</Label>
                <Input
                  value={invoiceForm.period}
                  onChange={e => setInvoiceForm(f => ({ ...f, period: e.target.value }))}
                  placeholder="2026-03"
                  data-testid="input-invoice-period"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Valor (R$)</Label>
                <Input
                  type="number"
                  value={invoiceForm.amount}
                  onChange={e => setInvoiceForm(f => ({ ...f, amount: e.target.value }))}
                  data-testid="input-invoice-amount"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Créditos ISP</Label>
                <Input
                  type="number"
                  value={invoiceForm.ispCreditsIncluded}
                  onChange={e => setInvoiceForm(f => ({ ...f, ispCreditsIncluded: e.target.value }))}
                  data-testid="input-invoice-isp"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Créditos SPC</Label>
                <Input
                  type="number"
                  value={invoiceForm.spcCreditsIncluded}
                  onChange={e => setInvoiceForm(f => ({ ...f, spcCreditsIncluded: e.target.value }))}
                  data-testid="input-invoice-spc"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Vencimento</Label>
              <Input
                type="date"
                value={invoiceForm.dueDate}
                onChange={e => setInvoiceForm(f => ({ ...f, dueDate: e.target.value }))}
                data-testid="input-invoice-due"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Input
                value={invoiceForm.notes}
                onChange={e => setInvoiceForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Observações..."
                data-testid="input-invoice-notes"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-4">
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setShowInvoiceModal(false)}>Cancelar</button>
            <button
              type="button"
              className={cn(BOTAO_MARCA, DESABILITAVEL)}
              onClick={() => invoiceMutation.mutate({
                providerId: String(providerId),
                period: invoiceForm.period,
                amount: invoiceForm.amount,
                planAtTime: invoiceForm.planAtTime,
                ispCreditsIncluded: invoiceForm.ispCreditsIncluded || "0",
                spcCreditsIncluded: invoiceForm.spcCreditsIncluded || "0",
                dueDate: invoiceForm.dueDate,
                notes: invoiceForm.notes,
              })}
              disabled={!podeEmitirFatura || invoiceMutation.isPending || !invoiceForm.period || !invoiceForm.amount}
              data-testid="button-confirm-invoice"
            >
              {invoiceMutation.isPending ? "Criando..." : "Criar fatura"}
            </button>
          </div>
        </MolduraModal>
      )}
    </div>
  );
}

/* ========================== ACESSO DE SUPORTE ========================== */

/**
 * A JANELA DE ACESSO, COMO O SERVIDOR A ENTREGA PARA ESTA TELA.
 *
 * Espelha uma linha de `acessos_suporte` (shared/schema.ts) mais o NOME de quem
 * liberou, revogou e entrou — a tabela guarda id de usuário, e id não se lê numa
 * trilha de auditoria. Os nomes são opcionais porque a linha sobrevive ao
 * usuário (nenhuma FK da tabela tem CASCADE, de propósito); sem par a tela
 * escreve "—" em vez de imprimir o número cru.
 *
 * `expiraEm` chega como texto ISO e é o ÚNICO horário que esta tela transforma
 * em contagem regressiva. Quem AUTORIZA continua sendo o servidor: o relógio
 * daqui só decide o que mostrar, e quando ele acha que venceu a tela para de
 * oferecer o botão e manda perguntar de novo — nunca o contrário.
 */
interface JanelaDeAcesso {
  id: number;
  liberadoEm: string;
  expiraEm: string;
  revogadoEm: string | null;
  liberadoPorNome?: string | null;
  revogadoPorNome?: string | null;
  usadoPorNome?: string | null;
  primeiroUsoEm: string | null;
  ultimoUsoEm: string | null;
  usos: number;
}

/**
 * QUANTO FALTA, EM PROSA CURTA.
 *
 * Sai como "1h 58min", e não como "01:58:32": o operador precisa saber se dá
 * tempo de fazer o que veio fazer, não cronometrar. Abaixo de um minuto a tela
 * para de anunciar número — dizer "0min" enquanto o botão ainda funciona é
 * pior do que dizer que está acabando.
 */
function faltaEmProsa(ms: number): string {
  const minutos = Math.floor(ms / 60000);
  if (minutos < 1) return "menos de 1min";
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto}min`;
  if (resto === 0) return `${horas}h`;
  return `${horas}h ${resto}min`;
}

/**
 * A SITUAÇÃO DE UMA JANELA NA TRILHA.
 *
 * "Vigente" sai em `gated` (âmbar), e não em `ok` (verde), porque verde afirma
 * que está tudo bem — e uma janela aberta é justamente o intervalo em que
 * alguém de fora enxerga o dado pessoal dos titulares deste provedor. Âmbar é o
 * que a seção 3 reserva para o estado que pede atenção sem ser erro.
 *
 * "Encerrada" e "Expirada" são coisas diferentes e a tabela as separa desde a
 * fundação: `revogado_em` preenchido quer dizer que alguém cortou (o provedor,
 * ou o próprio clique dele em liberar de novo); prazo vencido com
 * `revogado_em` nulo quer dizer que a hora simplesmente passou. Fundir as duas
 * num "Fechada" apagaria a única pergunta que uma auditoria faz aqui.
 */
function situacaoDaJanela(j: JanelaDeAcesso, agora: number): { label: string; tom: TomSelo } {
  if (j.revogadoEm) return { label: "Encerrada", tom: "neutro" };
  if (new Date(j.expiraEm).getTime() > agora) return { label: "Vigente", tom: "gated" };
  return { label: "Expirada", tom: "neutro" };
}

/** O texto que existe, ou nada — string vazia na trilha lê como nome apagado. */
function textoOuNada(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * UMA LINHA DA TRILHA, CONFERIDA CAMPO A CAMPO.
 *
 * Sem `id`, `liberadoEm` e `expiraEm` não há linha: são eles que dão a chave da
 * tabela e as duas datas de que a situação depende. Faltando qualquer um, a
 * linha é descartada em vez de virar "Invalid Date" numa auditoria — e um corpo
 * inteiro sem nenhuma linha aproveitável cai no bloco de falha de leitura, que é
 * a única coisa que esta tela pode afirmar nesse caso.
 *
 * Os nomes de pessoa são opcionais de propósito: a rota resolve `liberado_por` e
 * `usado_por` em nome quando consegue, e a tela já sabe dizer "—".
 */
function janelaNormalizada(bruto: unknown): JanelaDeAcesso | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const id = Number(b.id);
  const liberadoEm = textoOuNada(b.liberadoEm);
  const expiraEm = textoOuNada(b.expiraEm);
  if (!Number.isInteger(id) || !liberadoEm || !expiraEm) return null;
  const usos = Number(b.usos);
  return {
    id,
    liberadoEm,
    expiraEm,
    revogadoEm: textoOuNada(b.revogadoEm),
    liberadoPorNome: textoOuNada(b.liberadoPorNome),
    revogadoPorNome: textoOuNada(b.revogadoPorNome),
    usadoPorNome: textoOuNada(b.usadoPorNome),
    primeiroUsoEm: textoOuNada(b.primeiroUsoEm),
    ultimoUsoEm: textoOuNada(b.ultimoUsoEm),
    usos: Number.isFinite(usos) ? usos : 0,
  };
}

/**
 * O CORPO DA ROTA, ANTES DE A TELA ACREDITAR NELE.
 *
 * `data?.vigente ?? null` é confortável e é justamente a armadilha que o bloco
 * "FALHA DE LEITURA NÃO PODE VIRAR 'O PROVEDOR NÃO LIBEROU'" descreve: um corpo
 * com outro formato — a rota mudando de nome de campo, um proxy devolvendo HTML,
 * uma resposta de erro em 200 — passaria por ele em silêncio e a tela diria ao
 * operador que o provedor não liberou nada. Nesta aba, dizer isso errado custa
 * um telefonema cobrando um clique que já foi dado, e um histórico vazio afirma
 * "ninguém nunca entrou aqui" numa trilha de auditoria.
 *
 * Por isso o formato desconhecido ESTOURA: quem trata erro aqui é o bloco que
 * diz "não foi possível ler", com botão de tentar de novo.
 *
 * `vigente` ausente é diferente de `vigente: null`. `null` é o servidor
 * afirmando que não há janela aberta, e a tela obedece. Ausente é um corpo que
 * não fala disso, e aí a janela vigente é deduzida do próprio histórico pela
 * mesma regra do banco (não revogada, dentro do prazo). Deduzir no máximo faz a
 * tela oferecer um "Entrar" que o servidor recusa com a frase certa — a rota
 * revalida a janela pelo banco, e o botão daqui nunca foi autorização.
 */
function acessoNormalizado(
  bruto: unknown,
  agora: number,
): { vigente: JanelaDeAcesso | null; historico: JanelaDeAcesso[] } {
  const corpo: Record<string, unknown> | null = Array.isArray(bruto)
    ? { historico: bruto }
    : bruto && typeof bruto === "object"
      ? (bruto as Record<string, unknown>)
      : null;
  if (!corpo || !Array.isArray(corpo.historico)) {
    throw new Error("Resposta do acesso de suporte em formato inesperado");
  }

  const historico = corpo.historico
    .map(janelaNormalizada)
    .filter((j): j is JanelaDeAcesso => j !== null);

  const vigente =
    "vigente" in corpo
      ? janelaNormalizada(corpo.vigente)
      : (historico.find(j => !j.revogadoEm && new Date(j.expiraEm).getTime() > agora) ?? null);

  return { vigente, historico };
}

/**
 * POR ONDE O SUPORTE ENTRA — e por que ele quase nunca pode.
 *
 * Entrar aqui é PERSONIFICAÇÃO: a sessão do superadmin ganha o `providerId`
 * deste provedor e, a partir daí, `requireAuth`, `requireProvider` e
 * `requireAdmin` passam a valer inteiros — ou seja, ele faz tudo que o
 * administrador do provedor faz, inclusive consulta que gasta crédito. O que
 * separa isso de um bureau sem isolamento é uma coisa só: a janela que o
 * PROVEDOR abriu. Por isso o botão não é um botão desabilitado com um título
 * explicativo — sem liberação ele não existe, e no lugar dele fica a frase que
 * diz o que falta acontecer.
 *
 * O CONTRATO COM O SERVIDOR:
 *
 *   POST /api/admin/acesso-suporte/:providerId/entrar  — JÁ EXISTE
 *        (server/routes/suporte-acesso.routes.ts). 200 grava o `providerId` na
 *        sessão; 403 quando não há janela válida, 409 quando este superadmin já
 *        está dentro de OUTRO provedor. Todos devolvem `{ message }` em
 *        português, que é o que a tela mostra. A rota REVALIDA a janela pelo
 *        banco: o botão daqui é conveniência, nunca autorização.
 *
 *   GET  /api/admin/acesso-suporte/:providerId
 *        → { vigente: JanelaDeAcesso | null, historico: JanelaDeAcesso[] }
 *        `vigente` é `storage.acessoDeSuporteValido` (não revogada e dentro do
 *        prazo, medido pelo relógio do BANCO) e `historico` é
 *        `storage.historicoDeAcessos`, completo, com a vigente incluída.
 *        A tela não confia no corpo de olhos fechados: `acessoNormalizado`
 *        confere campo a campo e estoura no que não reconhece, para que formato
 *        inesperado caia em "não foi possível ler" em vez de virar "o provedor
 *        não liberou".
 *
 *        O `GET /api/provider/acesso-suporte` NÃO serve aqui: ele lê
 *        `req.session.providerId` (o provedor perguntando de si mesmo), não
 *        aceita provedor por parâmetro, e de propósito não devolve nome de
 *        pessoa nem histórico — o que o provedor precisa saber é "há alguém
 *        dentro", enquanto esta tela existe para responder "quem, quando e por
 *        autorização de quem".
 *
 * E, ao entrar, esta tela deixa o LEMBRETE DE PERSONIFICAÇÃO
 * (client/src/components/FaixaSuporte.tsx). Ele não autoriza nada — é o bilhete
 * que faz a faixa vermelha saber que vale a pena perguntar ao servidor, em vez
 * de perguntar em toda montagem do app e colher um 403 por carregamento. Como
 * quem clica aqui é quem começa a personificação, este é o único lugar do
 * sistema que sabe disso na hora certa.
 */
function AcessoSuporteTab({
  providerId,
  nomeProvedor,
  ativo,
}: {
  providerId: number;
  nomeProvedor: string;
  ativo: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{
    vigente: JanelaDeAcesso | null;
    historico: JanelaDeAcesso[];
  }>({
    queryKey: ["/api/admin/acesso-suporte", providerId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/acesso-suporte/${providerId}`);
      return acessoNormalizado(await res.json(), Date.now());
    },
    /* Como em `IntegracaoTab`: a busca só acontece com a aba aberta. Aqui o
       payload não traz credencial, traz nomes de pessoas e horários de quem
       olhou dado de titular — trilha de auditoria não precisa ficar no cache do
       navegador de quem abriu a ficha para ver uma fatura. */
    enabled: ativo,
    /* Enquanto EXISTE janela aberta a tela relê sozinha, porque o estado pode
       mudar sem que ninguém toque nesta aba: o prazo vence, ou o provedor
       encerra do lado dele. Sem janela não há o que expirar e a releitura
       automática só gastaria requisição — quem quer saber se o provedor já
       clicou usa o "Verificar de novo". */
    refetchInterval: q => (q.state.data?.vigente ? 30000 : false),
  });

  /**
   * O relógio da contagem regressiva.
   *
   * Passo de 15s para um texto que só mostra minutos: erra por menos de um
   * quarto de minuto e não acorda a tela a cada segundo. Só corre com a aba
   * aberta — um `setInterval` vivo numa aba fechada re-renderiza a ficha
   * inteira de graça.
   */
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    setAgora(Date.now());
    const t = window.setInterval(() => setAgora(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, [ativo]);

  /**
   * A entrada. `fetch` cru, e não `apiRequest`, pelo mesmo motivo já escrito no
   * teste de ERP: `apiRequest` estoura antes de a tela ler o corpo, e aqui a
   * mensagem do servidor é o conteúdo ("a liberação expirou", "o provedor
   * encerrou o acesso") — trocá-la por "403: {json}" faria o operador ligar
   * para o provedor sem saber o que dizer.
   */
  const entrarMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/acesso-suporte/${providerId}/entrar`, {
        method: "POST",
        credentials: "include",
      });
      const corpo = await res.json().catch(() => ({}) as any);
      if (!res.ok) {
        throw new Error(corpo.message || "Não foi possível entrar no sistema deste provedor.");
      }
      return corpo;
    },
    onSuccess: (corpo: { providerId?: number }) => {
      /* O BILHETE VAI ANTES DA RECARGA.
         Escrito aqui, e não depois, porque `location.assign` derruba este
         JavaScript: qualquer coisa deixada para o "depois" não acontece. O id
         preferido é o que o servidor confirmou ter gravado na sessão — a rota
         devolve `providerId` — e o da rota desta ficha é o suplente. O nome vem
         da tela, que já o tem, e serve de reserva para o caso de a leitura do
         provedor falhar no servidor. Ver o bloco do lembrete em FaixaSuporte. */
      const id = Number(corpo?.providerId);
      lembrarPersonificacao({
        providerId: Number.isInteger(id) && id > 0 ? id : providerId,
        providerNome: nomeProvedor || undefined,
      });
      /* A sessão trocou de dono. `qc.clear()` antes de sair porque todo o cache
         desta aba pertence à plataforma, e recarregar de página em página com
         resposta de outro tenant no cache é exatamente como dado de um provedor
         apareceria dentro de outro.
         A saída é `location.assign`, e não o `navigate` do wouter, porque o
         `AuthProvider` só consulta `/api/auth/me` na montagem (client/src/lib/auth.tsx):
         sem recarga a aplicação continuaria se achando superadmin sem provedor,
         e a faixa de "Suporte conectado" nunca desenharia. */
      qc.clear();
      window.location.assign("/");
    },
    onError: (e: any) => {
      /* Título neutro porque a recusa tem duas caras muito diferentes: 403 é
         "este provedor não liberou", 409 é "você já está dentro de outro
         provedor, saia de lá primeiro". Quem sabe qual das duas é o servidor, e
         a frase dele vai inteira na descrição. */
      toast({ title: "Não foi possível entrar", description: e.message, variant: "destructive" });
      /* O servidor disse não; o mais provável é que a janela tenha fechado
         enquanto a tela estava aberta. Relê para a tela parar de oferecer o que
         não existe mais. */
      refetch();
    },
  });

  if (isLoading) {
    return (
      <TabsContent value="suporte" className="space-y-4">
        <Card className="p-4">
          <LinhasSkeleton linhas={3} />
        </Card>
      </TabsContent>
    );
  }

  /**
   * FALHA DE LEITURA NÃO PODE VIRAR "O PROVEDOR NÃO LIBEROU".
   *
   * Um GET que quebrou cairia em `data?.vigente ?? null` e a tela mandaria o
   * operador cobrar do provedor um clique que ele talvez já tenha dado — e o
   * histórico apareceria vazio, que numa trilha de auditoria é uma afirmação
   * ("ninguém nunca entrou aqui") que esta tela não tem como fazer.
   */
  if (isError) {
    return (
      <TabsContent value="suporte" className="space-y-4" data-testid="tab-content-suporte">
        <Card className="px-4 py-4" data-testid="acesso-suporte-erro">
          <AvisoNaoCarregou aoTentarDeNovo={() => refetch()} testIdAcao="button-recarregar-acesso-suporte">
            Não foi possível ler o acesso de suporte deste provedor. Sem essa leitura não dá para
            afirmar se existe liberação aberta nem mostrar o histórico.
          </AvisoNaoCarregou>
        </Card>
      </TabsContent>
    );
  }

  const vigente = data?.vigente ?? null;
  const historico = data?.historico ?? [];
  const restanteMs = vigente ? new Date(vigente.expiraEm).getTime() - agora : 0;
  /** O botão só aparece com janela aberta E com prazo pelo relógio desta tela. */
  const liberado = !!vigente && restanteMs > 0;
  /** O servidor mandou uma janela que, aqui, já venceu — vale dizer isso. */
  const venceuNaTela = !!vigente && restanteMs <= 0;

  return (
    <TabsContent value="suporte" className="space-y-4" data-testid="tab-content-suporte">
      <Card className="overflow-hidden" data-testid="card-acesso-suporte">
        <TopoCartao
          titulo="Acesso de suporte"
          Icone={KeyRound}
          sub="Entrar no sistema deste provedor para configurar e verificar, com a autorização dele."
          acao={
            <Selo tom={liberado ? "gated" : "neutro"} testId="badge-acesso-suporte">
              {liberado ? "Liberado" : "Sem liberação"}
            </Selo>
          }
        />

        {liberado && vigente ? (
          <div className="px-4 py-3 space-y-3">
            <div>
              <LinhaDado rotulo="Tempo restante">
                <Num className="text-[13px] font-medium text-[var(--text)]" testId="text-acesso-restante">
                  {faltaEmProsa(restanteMs)}
                </Num>
              </LinhaDado>
              <LinhaDado rotulo="Vale até">
                <Num className="text-[13px] text-[var(--text)]" testId="text-acesso-expira">
                  {fmtDateTime(vigente.expiraEm)}
                </Num>
              </LinhaDado>
              <LinhaDado rotulo="Liberado por">
                <span className="text-[13px] text-[var(--text)]" data-testid="text-acesso-liberado-por">
                  {vigente.liberadoPorNome || "—"}
                </span>
              </LinhaDado>
              <LinhaDado rotulo="Liberado em">
                <Num className="text-[13px] text-[var(--text-2)]">{fmtDateTime(vigente.liberadoEm)}</Num>
              </LinhaDado>
              <LinhaDado rotulo="Quem já entrou">
                {vigente.usadoPorNome ? (
                  <span className="text-[13px] text-[var(--text)]" data-testid="text-acesso-usado-por">
                    {vigente.usadoPorNome} · <Num>{fmtDateTime(vigente.primeiroUsoEm)}</Num>
                  </span>
                ) : (
                  /* Janela autorizada e nunca aberta é informação — é o provedor
                     tendo liberado sem que ninguém tenha olhado nada. */
                  <span className="text-[13px] text-[var(--text-muted)]" data-testid="text-acesso-sem-uso">
                    Ninguém entrou ainda
                  </span>
                )}
              </LinhaDado>
            </div>

            {/* O QUE ENTRAR SIGNIFICA, ANTES DO CLIQUE E NÃO DEPOIS.
                Âmbar (`--gated`) porque não é erro nem risco consumado: é o
                aviso de que o próximo clique atravessa o isolamento por
                provedor, que é a invariante central do produto. */}
            <div className="rounded border border-[var(--gated-border)] bg-[var(--gated-bg)] px-3 py-2.5">
              <p className="text-[12px] text-[var(--gated)] leading-snug">
                Ao entrar, você passa a agir como administrador de{" "}
                <span className="font-medium">{nomeProvedor}</span>: vê o dado pessoal completo
                dos clientes dele e faz tudo que o painel do provedor faz — inclusive consulta
                que gasta crédito e importação. A entrada e o tempo que você ficar dentro ficam
                registrados nesta trilha, no nome de quem está logado.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={cn(BOTAO_MARCA, DESABILITAVEL)}
                onClick={() => entrarMutation.mutate()}
                disabled={entrarMutation.isPending}
                data-testid="button-entrar-suporte"
              >
                <LogIn className="w-3.5 h-3.5" strokeWidth={2} />
                {entrarMutation.isPending ? "Entrando..." : "Entrar no sistema do provedor"}
              </button>
              <button
                type="button"
                className={cn(BOTAO_SECUNDARIO, DESABILITAVEL)}
                onClick={() => refetch()}
                disabled={isFetching}
                data-testid="button-verificar-acesso-suporte"
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5", isFetching && "motion-safe:animate-spin")}
                  strokeWidth={2}
                />
                Verificar de novo
              </button>
            </div>
          </div>
        ) : (
          /* SEM LIBERAÇÃO NÃO HÁ BOTÃO — há a explicação do que falta.
             Um "Entrar" desabilitado deixaria o operador procurando o que
             destrava, e o que destrava não está nesta tela nem nas mãos dele:
             está no clique do provedor. A única ação honesta aqui é reler.
             A tela também NÃO diz em que menu do painel o provedor clica: essa
             tela é de outra frente, e mandar alguém procurar um menu que pode
             ter outro nome é a receita de um chamado que não fecha. */
          <EstadoVazio
            Icone={Lock}
            titulo={venceuNaTela ? "A liberação venceu" : "O provedor não liberou o acesso"}
            descricao={
              venceuNaTela
                ? "A janela aberta por este provedor chegou ao fim. Para entrar de novo é preciso que ele libere outra — cada liberação vale 2 horas."
                : "Ninguém entra no sistema de um provedor sem que ele autorize. A liberação é feita por ele, no painel do provedor, vale 2 horas e pode ser encerrada por ele a qualquer momento."
            }
            cta={
              <button
                type="button"
                className={cn(BOTAO_SECUNDARIO, DESABILITAVEL)}
                onClick={() => refetch()}
                disabled={isFetching}
                data-testid="button-verificar-acesso-suporte"
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5", isFetching && "motion-safe:animate-spin")}
                  strokeWidth={2}
                />
                Verificar de novo
              </button>
            }
            testId="acesso-suporte-sem-liberacao"
          />
        )}
      </Card>

      {/* A TRILHA. Ela é metade da razão de a tabela existir em vez de duas
          colunas em `providers`, e uma trilha que ninguém consegue ler não
          protege ninguém. Vem completa: liberação encerrada e liberação que
          ninguém usou também são linhas da história. */}
      <Card className="overflow-hidden">
        <TopoCartao
          titulo="Histórico de acessos"
          Icone={History}
          sub={
            historico.length === 1 ? (
              <>
                <Num>1</Num> liberação registrada
              </>
            ) : (
              <>
                <Num>{historico.length}</Num> liberações registradas
              </>
            )
          }
        />
        {historico.length === 0 ? (
          <EstadoVazio
            Icone={History}
            titulo="Nenhuma liberação registrada"
            descricao="Toda vez que este provedor liberar o acesso de suporte, a janela aparece aqui — com quem autorizou, até quando valia, quem entrou e quantas requisições foram feitas."
            testId="empty-historico-acesso-suporte"
          />
        ) : (
          <>
            <TabelaPainel testId="tabela-historico-acesso-suporte">
              <thead>
                <tr>
                  <Th>Liberado em</Th>
                  <Th>Liberado por</Th>
                  <Th>Vale até</Th>
                  <Th>Quem entrou</Th>
                  <Th alinhamento="direita">Atividade</Th>
                  <Th>Situação</Th>
                </tr>
              </thead>
              <tbody>
                {historico.map(j => {
                  const s = situacaoDaJanela(j, agora);
                  return (
                    <tr key={j.id} data-testid={`row-acesso-suporte-${j.id}`}>
                      {/* Data e hora se leem da esquerda para a direita, como
                          identificador — mono sem alinhar à direita. */}
                      <Td num alinhamento="esquerda">{fmtDateTime(j.liberadoEm)}</Td>
                      <Td>{j.liberadoPorNome || "—"}</Td>
                      <Td num alinhamento="esquerda">{fmtDateTime(j.expiraEm)}</Td>
                      <Td>
                        {j.usadoPorNome ? (
                          <span className="text-[var(--text)]">
                            {j.usadoPorNome} · <Num>{fmtDateTime(j.primeiroUsoEm)}</Num>
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">Ninguém entrou</span>
                        )}
                      </Td>
                      <Td num>{j.usos}</Td>
                      <Td>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Selo tom={s.tom}>{s.label}</Selo>
                          {/* Quem cortou só aparece quando alguém cortou. Numa
                              janela que apenas venceu não há autor, e inventar
                              um é o que a coluna `revogado_em` existe para
                              impedir. */}
                          {j.revogadoEm && (
                            <span className="text-[11.5px] text-[var(--text-muted)]">
                              {j.revogadoPorNome ? `por ${j.revogadoPorNome} · ` : ""}
                              <Num>{fmtDateTime(j.revogadoEm)}</Num>
                            </span>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TabelaPainel>
            {/* O NÚMERO PRECISA DO SEU RÓTULO CERTO.
                `usos` NÃO é "vezes que entrou" nem "requisições": a trava
                amostra no máximo uma gravação por minuto por janela
                (INTERVALO_REGISTRO_DE_USO_MS, server/auth.ts), então o que a
                coluna conta são minutos em que houve atividade do suporte.
                Chamá-la de "acessos" faria o operador ler cinquenta visitas
                onde houve uma de cinquenta minutos.
                E "Quem entrou" guarda o PRIMEIRO, e só ele: `usado_por` nunca é
                sobrescrito, de propósito — dois superadmins na mesma janela
                aparecem aqui como um nome só. */}
            <p className="px-4 py-2.5 text-[11.5px] text-[var(--text-muted)] border-t border-[var(--border)]">
              "Atividade" conta os minutos em que houve alguma requisição do suporte dentro da
              janela — é a medida de quanto tempo alguém ficou dentro, não de quantas vezes
              entrou. "Quem entrou" guarda o primeiro a usar a liberação; havendo mais de um, os
              demais ficam no log do servidor.
            </p>
          </>
        )}
      </Card>
    </TabsContent>
  );
}

/* ============================ INTEGRACAO ERP ============================ */

/**
 * A configuracao do ERP mora AQUI, no painel SaaS.
 *
 * O painel do provedor virou vitrine: ele diz se esta integrado e nada mais.
 * Quem digita credencial, testa conexao e dispara varredura e o superadmin —
 * esta tela. O motivo nao e de layout: as rotas de escrita do provedor exigiam
 * so `requireAuth`, entao qualquer operador de role "user" gravava credencial
 * de ERP por curl. Tirar o formulario de la sem trazer para ca deixaria o
 * produto sem lugar nenhum para configurar.
 */

interface IntegracaoAdmin {
  id: number;
  erpSource: string;
  isEnabled: boolean;
  status: string | null;
  apiUrl: string | null;
  apiToken: string | null;
  apiUser: string | null;
  mkContraSenha: string | null;
  clientId: string | null;
  clientSecret: string | null;
  extraConfig: Record<string, string> | null;
  /**
   * A credencial esta gravada mas este servidor nao consegue LE-LA — a chave
   * deriva do SESSION_SECRET, e ele mudou (troca de segredo, base restaurada de
   * outro ambiente). O servidor devolve os quatro campos secretos em branco (o
   * texto cifrado nao serve de nada no navegador) e liga esta marca.
   *
   * Ignora-la e o pior desfecho possivel: a linha leria "Sem credencial", o
   * operador salvaria por cima achando que nunca houve nada, e como segredo
   * vazio significa "nao mexe" no upsert, o valor ilegivel continuaria no banco
   * e o sync continuaria falhando — com a tela dizendo que salvou.
   */
  credencialIlegivel: boolean;
  /**
   * `syncIntervalHours` NAO entra aqui de proposito.
   *
   * A coluna existe, o Zod da rota a aceita e o seed a preenche, mas nenhum
   * agendador a le: a cadencia real e a da varredura completa — segunda, quarta
   * e sexta as 03:00 (server/services/erp-agenda.ts). Publicar "intervalo 12h"
   * numa tela e prometer um numero que nenhum codigo honra.
   */
  notes: string | null;
  totalSynced: number;
  totalErrors: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
}

interface LogSyncAdmin {
  id: number;
  erpSource: string;
  status: string;
  recordsProcessed: number;
  recordsFailed: number;
  /**
   * A coluna e `synced_at`. Esta tela lia `createdAt`, que `erp_sync_logs`
   * nunca teve: toda linha do historico imprimia "Invalid Date".
   */
  syncedAt: string | null;
  ipAddress: string | null;
}

/**
 * O conector como /api/erp-connectors o entrega para esta tela.
 *
 * `naoImplementado` marca o conector que esta registrado so para figurar no
 * catalogo — nenhum metodo dele fala com o ERP. Ausente significa implementado.
 * O campo mora aqui, e nao em `ConectorMeta`, porque aquele tipo pertence a
 * outra frente; quando ele passar a declarar a marca, este alias sai.
 */
type ConectorAdmin = ConectorMeta & { naoImplementado?: boolean };

/**
 * Uma linha da lista "Integracoes deste provedor".
 *
 * `conector` e opcional porque a integracao manda na lista: existe linha em
 * `erp_integrations` cujo `erpSource` nao tem mais conector registrado, e ela
 * precisa aparecer mesmo assim — sem conector, sem campos, so o aviso.
 */
type ItemErp = { fonte: string; conector?: ConectorAdmin; integracao: IntegracaoAdmin };

type ResultadoTeste = { ok: boolean; message: string; latencyMs?: number };
type ResultadoSync = { tipo: "info" | "erro" | "ok"; texto: string };

/**
 * O selo do conector que ainda nao fala com a API do ERP.
 *
 * Nasceu na lista suspensa de "Adicionar integracao", mas a linha que JA existe
 * para um desses ERPs precisa do MESMO selo — se ele so trancasse a porta da
 * frente, a linha antiga continuaria lendo "Configurado / Ativo" e o provedor
 * leria "Integrada" para um ERP que nenhuma varredura consegue ler. O texto mora
 * aqui para que os dois lugares nao divirjam com o tempo; a FORMA agora vem do
 * `<Selo>` da primitiva — este arquivo tinha o corpo do selo redigitado a mao
 * (`PILL_BASE`), a copia manuscrita que faz os dois paineis divergirem no
 * proximo ajuste.
 */
const ROTULO_CONECTOR_PENDENTE = "Conector em desenvolvimento";

/**
 * Os dois blocos de aviso desta aba, escritos uma vez.
 *
 * `ATENCAO` (gated) e a porta que ainda nao abriu — pausa, conector pendente,
 * ERP sem conector. `RISCO` (danger) e a porta fechada: a credencial que nao
 * abre e derruba toda varredura. Eram seis copias das mesmas classes espalhadas
 * pela aba, e a divergencia ja tinha comecado (uma delas usava outro padding).
 */
const AVISO_ATENCAO = "rounded-lg border border-[var(--gated-border)] bg-[var(--gated-bg)] px-3 py-2.5";
const AVISO_RISCO = "rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2.5";
const TEXTO_AVISO = "text-[12px] leading-snug text-[var(--text-2)]";

/**
 * O selo da credencial gravada que este servidor nao consegue ler.
 *
 * Ele SUBSTITUI "Sem credencial", nunca soma: os dois dizem coisas opostas e o
 * que o operador faz depende de qual e. "Sem credencial" convida a preencher do
 * zero — e preencher o que ja tem valor apagaria nada, porque campo secreto
 * vazio significa "nao mexe" no servidor. "Credencial ilegivel" diz a unica
 * coisa que resolve: digitar o segredo de novo.
 *
 * Tom de perigo, e nao de atencao: enquanto ninguem redigitar, toda varredura
 * deste ERP falha, e a integracao caminha para a pausa automatica.
 */
const ROTULO_CREDENCIAL_ILEGIVEL = "Credencial ilegível";

/** Os campos que o servidor guarda cifrados — os unicos zerados quando a credencial nao abre. */
const CAMPOS_SECRETOS = ["apiToken", "apiUser", "mkContraSenha", "clientSecret"] as const;

/**
 * Ficou algum segredo em branco neste Salvar?
 *
 * Numa linha ilegivel a resposta precisa ser nao para TODOS os segredos que o
 * conector declara, e nao so para um: o servidor zerou os quatro na leitura, e
 * segredo em branco no upsert significa "mantem o que esta la" — ou seja,
 * mantem justamente o valor que nao abre. Redigitar so o token do Hubsoft e
 * deixar o client secret em branco produziria de novo o desfecho que esta marca
 * existe para evitar: a tela diz "salvo" e a varredura continua falhando.
 *
 * So os campos presentes no corpo entram na conta — o formulario manda o que o
 * conector declara, e cobrar um campo que a tela nem desenha travaria o Salvar
 * para sempre.
 */
function segredoEmBranco(corpo: Record<string, unknown>): boolean {
  return CAMPOS_SECRETOS.some(k => k in corpo && !String(corpo[k] ?? "").trim());
}

/**
 * O DESFECHO DA VARREDURA, em portugues e no tom da primitiva.
 *
 * Era `{ texto, cls }` com a classe de cor escrita a mao; virou `{ texto, tom }`
 * porque quem decide a cor de um selo e o `<Selo>`, para os dois paineis de uma
 * vez.
 *
 * MUDANCA DE PIXEL, DECLARADA: `reativado` estava em `--info` (azul). A
 * primitiva nao tem tom `info`, e inventar um aqui — por `className` — seria
 * recriar num canto a divergencia que ela existe para acabar. Fica `neutro`, que
 * e o que a linha significa: reativacao nao leu registro nenhum, e a coluna
 * "Registros" da mesma linha ja mostra "—". Se um dia `info` virar tom da
 * primitiva, esta linha volta a ele sem tocar em mais nada.
 */
const PILL_SYNC: Record<string, { texto: string; tom: TomSelo }> = {
  success: { texto: "Sucesso", tom: "ok" },
  error: { texto: "Erro", tom: "danger" },
  partial: { texto: "Parcial", tom: "gated" },
  /**
   * `reativado` nao e varredura: e a marca de que o superadmin religou a
   * integracao, e o batente que faz a contagem de falhas consecutivas
   * recomecar. Sem esta linha ela caia no ramo generico e o historico imprimia
   * o identificador cru no lugar de portugues.
   */
  reativado: { texto: "Reativado", tom: "neutro" },
};

function relDateAdmin(d: string | null): string {
  if (!d) return "Nunca";
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (diff < 60) return `${diff}min atrás`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h atrás`;
  return `${Math.floor(diff / 1440)}d atrás`;
}

/** Numerais por extenso do aviso de pausa. O indice e a propria contagem. */
const CONTAGEM_EXTENSO = ["", "Uma", "Duas", "Três", "Quatro", "Cinco", "Seis", "Sete", "Oito", "Nove", "Dez"];

/**
 * O aviso e prosa, e prosa se escreve por extenso.
 *
 * O ramo singular ja dizia "Uma integracao"; o plural imprimia o algarismo em
 * Inter, que e numero sem mono — o design system nao admite. Escrever "Duas",
 * "Tres" resolve sem enfiar font-mono no meio de uma frase corrida, e dez cobre
 * o catalogo inteiro de conectores. Acima disso (linhas de ERP que nem conector
 * tem mais) o algarismo aparece, e ai vai em mono como todo numero do sistema.
 */
function frasePausadas(quantidade: number) {
  const resto = quantidade === 1 ? "integração foi pausada" : "integrações foram pausadas";
  const extenso = CONTAGEM_EXTENSO[quantidade];
  /* A frase inteira sai daqui, inclusive o fecho: o container e flex, e devolver
     pedacos faria do algarismo um item de flex com `gap` no lugar do espaco. */
  if (extenso) return <span>{`${extenso} ${resto} por falhas consecutivas`}</span>;
  return (
    <span>
      <Num>{quantidade}</Num> {resto} por falhas consecutivas
    </span>
  );
}

/**
 * O rotulo sai do catalogo de conectores, nao de uma lista cravada na tela.
 *
 * A lista daqui trazia tiacos, flyspeed e netflash — ERPs sem nenhum conector
 * no servidor. Um log de origem desconhecida cai no proprio identificador, que
 * ao menos e verdade.
 */
function rotuloErp(source: string, conectores: ConectorMeta[]): string {
  return conectores.find(c => c.name === source)?.label ?? source;
}

function IntegracaoTab({ providerId, ativo }: { providerId: number; ativo: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const chave = ["/api/admin/providers", providerId, "integration"];

  /**
   * `enabled` amarra a busca a aba aberta.
   *
   * O payload traz a credencial de todo ERP do provedor DECIFRADA. Sem esta
   * trava ele saia no primeiro render de qualquer aba — Financeiro, Usuarios,
   * Historico — e ficava no cache do navegador de quem nunca abriu Integracao.
   */
  const { data, isLoading, isError, refetch, isFetching } = useQuery<{
    token: string | null;
    integrations: IntegracaoAdmin[];
    logs: LogSyncAdmin[];
  }>({
    queryKey: chave,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/providers/${providerId}/integration`);
      return res.json();
    },
    enabled: ativo,
  });

  /** Os campos de cada ERP vem do proprio servidor que os consome. */
  const {
    data: conectores = [],
    isLoading: carregandoConectores,
    isError: erroConectores,
    refetch: recarregarConectores,
  } = useQuery<ConectorAdmin[]>({
    queryKey: ["/api/erp-connectors"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/erp-connectors");
      return res.json();
    },
    enabled: ativo,
  });

  const [expandido, setExpandido] = useState<string | null>(null);
  /** O ERP escolhido na lista suspensa de "Adicionar integracao" — ainda sem linha no banco. */
  const [novoErp, setNovoErp] = useState<string | null>(null);
  /** O gatilho da lista suspensa, para o estado vazio conseguir mandar o foco para la. */
  const seletorRef = useRef<HTMLButtonElement | null>(null);
  const [resultadoTeste, setResultadoTeste] = useState<Record<string, ResultadoTeste | null>>({});
  const [resultadoSync, setResultadoSync] = useState<Record<string, ResultadoSync | null>>({});

  /**
   * Temporizadores do acompanhamento, por ERP.
   *
   * Sem eles, cada clique deixava um `setInterval` de 15 minutos solto: sair da
   * tela nao o parava, e clicar duas vezes no mesmo ERP acumulava dois. Guardar
   * por `source` permite trocar o anterior e limpar tudo na desmontagem.
   */
  const acompanhamentoRef = useRef<Record<string, { intervalo: number; teto: number }>>({});
  useEffect(() => () => {
    for (const t of Object.values(acompanhamentoRef.current)) {
      window.clearInterval(t.intervalo);
      window.clearTimeout(t.teto);
    }
  }, []);

  const acompanhar = (source: string) => {
    const anterior = acompanhamentoRef.current[source];
    if (anterior) {
      window.clearInterval(anterior.intervalo);
      window.clearTimeout(anterior.teto);
    }
    const intervalo = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "integration"] });
    }, 15000);
    const teto = window.setTimeout(() => {
      window.clearInterval(intervalo);
      delete acompanhamentoRef.current[source];
    }, 15 * 60 * 1000);
    acompanhamentoRef.current[source] = { intervalo, teto };
  };

  const salvarMutation = useMutation({
    mutationFn: async ({ source, corpo }: { source: string; corpo: Record<string, unknown>; reativando?: boolean }) => {
      const res = await apiRequest("PUT", `/api/admin/providers/${providerId}/erp/${source}`, corpo);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (_dados, variaveis) => {
      // Nenhuma mutation desta tela invalidava a chave da aba: o formulario
      // salvava e continuava exibindo o valor antigo ate um F5. Depois de
      // religar isso e o que tira a marca de pausa da tela — sem a invalidacao
      // o operador reativa e continua lendo "Pausado por falhas".
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "integration"] });
      // Integracao recem-criada: a linha passa a existir, o ERP sai da lista
      // suspensa e o formulario de baixo desapareceria sem explicacao. Abrir o
      // item na secao de cima mostra para onde ele foi.
      if (novoErp === variaveis.source) {
        setNovoErp(null);
        setExpandido(variaveis.source);
      }
      toast({
        title: variaveis.reativando ? "Integração reativada" : "Integração salva",
        description: variaveis.reativando
          ? "A contagem de falhas recomeça do zero na próxima varredura automática."
          : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  /**
   * Teste e sync respondem com significado tambem fora do 2xx — 400 "configure
   * a URL e o token", 409 "ja existe uma varredura". `apiRequest` estoura antes
   * de a tela ler o corpo, entao aqui o fetch e cru de proposito e a mensagem
   * do servidor chega inteira ao operador.
   */
  const testarMutation = useMutation({
    mutationFn: async (source: string) => {
      const res = await fetch(`/api/admin/providers/${providerId}/erp/${source}/test`, {
        method: "POST",
        credentials: "include",
      });
      const corpo = await res.json().catch(() => ({} as any));
      return { source, corpo };
    },
    onSuccess: ({ source, corpo }) => {
      setResultadoTeste(r => ({
        ...r,
        [source]: {
          ok: !!corpo.ok,
          message: corpo.message || (corpo.ok ? "Conexão estabelecida." : "Não foi possível conectar."),
          latencyMs: corpo.latencyMs,
        },
      }));
    },
    onError: (_e, source) => {
      setResultadoTeste(r => ({ ...r, [source]: { ok: false, message: "Não consegui falar com o servidor." } }));
    },
  });

  /**
   * Dispara a varredura e volta na hora.
   *
   * A rota responde 202 assim que enfileira: a sincronizacao leva minutos, o
   * proxy corta em 60s, e um `res.json()` de um 504 em HTML mostrava "Erro ao
   * sincronizar" para um sync que estava rodando e ia terminar bem. A mensagem
   * de sucesso, quando chegava, lia `data.synced` e `data.total`, campos que a
   * rota nunca devolveu: sairia "undefined registros sincronizados".
   *
   * O desfecho de verdade mora no historico logo abaixo, que passa a recarregar
   * sozinho enquanto ha varredura em andamento.
   */
  const sincronizarMutation = useMutation({
    mutationFn: async (source: string) => {
      const res = await fetch(`/api/admin/providers/${providerId}/sync/${source}`, {
        method: "POST",
        credentials: "include",
      });
      const corpo = await res.json().catch(() => ({} as any));
      return { source, status: res.status, corpo };
    },
    onSuccess: ({ source, status, corpo }) => {
      if (status === 409) {
        setResultadoSync(r => ({
          ...r,
          [source]: { tipo: "info", texto: corpo.message || "Sincronização já em andamento." },
        }));
        return;
      }
      if (!corpo.ok) {
        setResultadoSync(r => ({
          ...r,
          [source]: { tipo: "erro", texto: corpo.message || "Não foi possível iniciar a sincronização." },
        }));
        return;
      }
      setResultadoSync(r => ({
        ...r,
        [source]: { tipo: "info", texto: "Sincronização iniciada — o resultado aparece no histórico ao terminar." },
      }));
      qc.invalidateQueries({ queryKey: ["/api/admin/providers", providerId, "integration"] });
      // A varredura leva minutos; rele o historico ate ele registrar o
      // desfecho. So quando ela de fato comecou — em 409 ja saimos acima, e
      // num erro nao ha o que acompanhar.
      acompanhar(source);
    },
    onError: (_e, source) => {
      setResultadoSync(r => ({ ...r, [source]: { tipo: "erro", texto: "Não consegui falar com o servidor." } }));
    },
  });

  const ocupadoDe = (source: string) => ({
    salvando: salvarMutation.isPending && salvarMutation.variables?.source === source,
    testando: testarMutation.isPending && testarMutation.variables === source,
    sincronizando: sincronizarMutation.isPending && sincronizarMutation.variables === source,
  });

  if (isLoading || carregandoConectores) {
    return (
      <TabsContent value="integracao" className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-[86px] rounded-lg" />
          ))}
        </div>
        {/* A forma do que vem, e nao um bloco cinza: a lista de ERPs e uma
            pilha de linhas com ladrilho, titulo e sublinha. */}
        <Card className="p-4">
          <LinhasSkeleton linhas={3} />
        </Card>
      </TabsContent>
    );
  }

  /**
   * Falha de leitura NAO pode virar tela vazia.
   *
   * Sem esta saida, um GET que quebrou caia em `data?.integrations ?? []` e
   * todo conector aparecia como "Sem credencial" — convite para o operador
   * digitar por cima de uma integracao que existe e esta configurada. Aqui a
   * tela diz que nao conseguiu ler e nao mostra a lista.
   */
  if (isError || erroConectores) {
    return (
      <TabsContent value="integracao" className="space-y-4" data-testid="tab-content-integracao">
        <Card className="px-4 py-5" data-testid="erp-erro-carregamento">
          <div className="flex items-start gap-3">
            {/* Ladrilho de risco: e uma falha de leitura, nao um vazio. */}
            <LadrilhoIcone Icone={AlertTriangle} tom="risco" />
            <div className="min-w-0">
              <p className={cn(TITULO_CARTAO, "text-[var(--danger)]")}>
                Não foi possível carregar a integração ERP
              </p>
              <p className={cn(TEXTO_AVISO, "mt-1.5")}>
                A leitura falhou — o que você vê não é a configuração do provedor. Não preencha
                credencial agora: uma integração já configurada apareceria como vazia e gravar por
                cima apagaria o que está funcionando.
              </p>
              <button
                type="button"
                className={cn(BOTAO_SECUNDARIO, DESABILITAVEL, "mt-3")}
                disabled={isFetching}
                onClick={() => {
                  if (isError) refetch();
                  if (erroConectores) recarregarConectores();
                }}
                data-testid="button-recarregar-integracao"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "motion-safe:animate-spin")} strokeWidth={2} />
                Tentar novamente
              </button>
            </div>
          </div>
        </Card>
      </TabsContent>
    );
  }

  const integrations = data?.integrations ?? [];
  const logs = data?.logs ?? [];

  /**
   * `configurado` e AND, nunca OR.
   *
   * Um registro so com a URL lia "Configurado" e mentia: testar e sincronizar
   * exigem os dois campos, e a rota devolve 400 antes de tentar qualquer coisa.
   */
  const estaConfigurado = (i?: IntegracaoAdmin) => !!(i?.apiUrl && i?.apiToken);

  const porFonte = new Map(integrations.map(i => [i.erpSource, i]));
  const porConector = new Map(conectores.map(c => [c.name, c]));

  /**
   * Ha conector capaz de ler este ERP?
   *
   * Nao basta a linha estar ligada e com credencial: sem conector registrado, ou
   * com um que so figura no catalogo, nenhuma varredura traz um registro. Contar
   * essas linhas como ativas fazia o resumo do topo prometer sincronizacao que
   * nunca aconteceu.
   */
  const leDados = (source: string) => {
    const c = porConector.get(source);
    return !!c && !c.naoImplementado;
  };

  /**
   * A lista de cima sai das INTEGRACOES, nao do catalogo de conectores.
   *
   * Empilhar os dez conectores obrigava o operador a rolar dez cartoes para
   * achar o unico que o provedor usa. E uma linha de erpSource sem conector
   * registrado — sobra de configuracao antiga — nunca aparecia: o que nao
   * estava no catalogo sumia da tela, e nao havia como sequer saber que
   * existia. Aqui ela entra, sem formulario, porque nao ha campos a editar.
   */
  const integrados: ItemErp[] = integrations
    .map(i => ({ fonte: i.erpSource, conector: porConector.get(i.erpSource), integracao: i }))
    .sort((a, b) =>
      rotuloErp(a.fonte, conectores).localeCompare(rotuloErp(b.fonte, conectores), "pt-BR"),
    );

  /** A lista suspensa so oferece o que ainda NAO tem linha para este provedor. */
  const disponiveis = [...conectores]
    .filter(c => !porFonte.has(c.name))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  /**
   * O formulario em branco vive enquanto a linha nao existe.
   *
   * Assim que o salvar volta e a leitura traz a integracao, o item migra para a
   * secao de cima — manter aqui um segundo formulario para o mesmo ERP daria
   * dois lugares para editar a mesma credencial.
   */
  const escolhido = novoErp && !porFonte.has(novoErp) ? porConector.get(novoErp) : undefined;
  /* A lista suspensa ja trava o conector so casca, mas o catalogo e recarregado
     enquanto a tela vive: se um ERP virar stub depois de escolhido, o
     formulario de credencial some junto com a possibilidade de salva-lo. */
  const conectorNovo = escolhido?.naoImplementado ? undefined : escolhido;

  const ativos = integrations.filter(i => i.isEnabled && estaConfigurado(i) && leDados(i.erpSource)).length;
  const totalSincronizado = integrations.reduce((s, i) => s + (i.totalSynced || 0), 0);
  const totalErros = integrations.reduce((s, i) => s + (i.totalErrors || 0), 0);
  const pausados = integrations.filter(i => i.status === "pausado_por_falhas");
  /**
   * A instrucao do aviso muda conforme haja o que corrigir.
   *
   * "Corrija a credencial e reative" e conselho errado quando a pausa veio de um
   * conector que ainda nao fala com a API do ERP: a credencial esta certa, e
   * religar so faria a proxima varredura pausar de novo — e o provedor receber
   * outro e-mail sobre um problema que nao e dele.
   */
  const pausadosCorrigiveis = pausados.filter(i => !porConector.get(i.erpSource)?.naoImplementado);
  const pausadosPendentes = pausados.filter(i => !!porConector.get(i.erpSource)?.naoImplementado);

  /**
   * As linhas cuja credencial o servidor nao conseguiu decifrar.
   *
   * O aviso sobe ao topo porque o defeito nao e de uma linha so: a chave deriva
   * do SESSION_SECRET, entao quando ele muda TODAS as credenciais gravadas com
   * o anterior param de abrir de uma vez. Ver a marca so ao expandir cada linha
   * esconderia a extensao do estrago.
   */
  const ilegiveis = integrations.filter(i => i.credencialIlegivel);

  /* O resumo do topo era um cartao proprio, com rotulo e numero redigitados —
     e o "ERPs ativos" saia em verde, cor de estado num numero que e so
     contagem (secao 3: saturacao reservada para risco). Vira o mesmo
     `CartaoMetrica` do resto do produto; a unica cor que sobra e a do erro
     acumulado, e so quando ele existe. */
  const resumo: { label: string; valor: React.ReactNode; sub: string; Icone: Icone; testId: string }[] = [
    { label: "ERPs ativos", valor: ativos.toLocaleString("pt-BR"), sub: "com conector e credencial", Icone: Wifi, testId: "card-erps-ativos" },
    { label: "Registros sincronizados", valor: totalSincronizado.toLocaleString("pt-BR"), sub: "desde a primeira varredura", Icone: Database, testId: "card-registros-sincronizados" },
    {
      label: "Erros acumulados",
      valor: totalErros > 0
        ? <span className="text-[var(--danger)]">{totalErros.toLocaleString("pt-BR")}</span>
        : totalErros.toLocaleString("pt-BR"),
      sub: "em todas as varreduras",
      Icone: AlertTriangle,
      testId: "card-erros-acumulados",
    },
  ];

  return (
    <TabsContent value="integracao" className="space-y-4" data-testid="tab-content-integracao">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {resumo.map(s => (
          <CartaoMetrica
            key={s.label}
            rotulo={s.label}
            valor={s.valor}
            sub={s.sub}
            Icone={s.Icone}
            testId={s.testId}
            testIdValor={`value-${s.testId}`}
          />
        ))}
      </div>

      {/* Antes do aviso de pausa de proposito: quando as duas coisas aparecem
          juntas, a credencial ilegivel e a CAUSA e a pausa e o efeito. Ler
          primeiro "corrija a credencial e reative" mandaria religar uma
          integracao que voltaria a falhar na varredura seguinte. */}
      {ilegiveis.length > 0 && (
        <div className={cn(AVISO_RISCO, "px-4 py-3")} data-testid="aviso-credencial-ilegivel">
          <p className={cn(TITULO_CARTAO, "flex items-center gap-2 text-[var(--danger)]")}>
            <KeyRound className="h-4 w-4 flex-none" strokeWidth={2} />
            {ilegiveis.length === 1
              ? "Uma credencial gravada não pode ser lida por este servidor"
              : "Credenciais gravadas que este servidor não consegue ler"}
          </p>
          <p className={cn(TEXTO_AVISO, "mt-1")}>
            {/* O texto e impessoal de proposito: a lista pode ter um ERP ou
                todos, e "o segredo gravado" serve aos dois sem plural postico. */}
            {ilegiveis.map(i => rotuloErp(i.erpSource, conectores)).join(", ")} — o segredo gravado
            continua no banco, mas foi cifrado com outra chave de servidor e não abre mais aqui.
            {/* A instrucao inteira do reparo mora nesta frase porque e ela que
                separa "ilegivel" de "faltando": quem le "faltando" salva por
                cima e acha que resolveu. */}
            {" "}Precisa ser <strong className="font-medium">digitado de novo</strong>: abra a
            integração abaixo e preencha os campos secretos. Salvar com campo em branco mantém o
            valor ilegível — em branco significa manter o que já está lá —, e a varredura segue
            falhando.
          </p>
        </div>
      )}

      {pausados.length > 0 && (
        <div className={cn(AVISO_ATENCAO, "px-4 py-3")} data-testid="aviso-pausado-por-falhas">
          <p className={cn(TITULO_CARTAO, "flex items-center gap-2 text-[var(--gated)]")}>
            <AlertTriangle className="h-4 w-4 flex-none" strokeWidth={2} />
            {frasePausadas(pausados.length)}
          </p>
          {pausadosCorrigiveis.length > 0 && (
            <p className={cn(TEXTO_AVISO, "mt-1")}>
              {pausadosCorrigiveis.map(i => rotuloErp(i.erpSource, conectores)).join(", ")} — corrija a credencial, teste a conexão e reative abaixo.
            </p>
          )}
          {pausadosPendentes.length > 0 && (
            <p className={cn(TEXTO_AVISO, "mt-1")} data-testid="aviso-pausado-conector-pendente">
              {pausadosPendentes.map(i => rotuloErp(i.erpSource, conectores)).join(", ")} — a pausa veio do
              conector, que ainda não conversa com a API desse ERP. A credencial do provedor não tem
              defeito e não há o que reativar.
            </p>
          )}
        </div>
      )}

      <Card className="overflow-hidden">
        <TopoCartao
          titulo="Integrações deste provedor"
          Icone={Wifi}
          sub={
            <>
              Credenciais, teste de conexão e sincronização. O provedor só visualiza o que está integrado.
              {/* A cadencia vem da agenda da varredura (server/services/erp-agenda.ts),
                  nao da coluna `sync_interval_hours` — que existe e ninguem le. */}
              <br />
              Varredura automática: <Num>segunda, quarta e sexta às 03:00</Num>.
              Três varreduras seguidas com falha pausam a integração e avisam o provedor.
            </>
          }
        />

        {integrados.length === 0 ? (
          /* O estado vazio da primitiva: mesmo ladrilho, mesmo corpo e mesmo CTA
             dos vazios do Painel Geral. O CTA herda o alvo de toque do
             `BOTAO_SECUNDARIO` — 36px no mouse, 44px no dedo — em vez do `h-11`
             cravado, que engordava o controle tambem no desktop. */
          <EstadoVazio
            Icone={Wifi}
            titulo="Nenhum ERP integrado"
            descricao="Este provedor ainda não tem integração configurada. A integração começa na lista suspensa abaixo: escolha o ERP, preencha as credenciais e salve."
            cta={
              disponiveis.length > 0 ? (
                <button
                  type="button"
                  className={BOTAO_SECUNDARIO}
                  onClick={() => seletorRef.current?.focus()}
                  data-testid="button-ir-para-seletor-erp"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                  Escolher ERP
                </button>
              ) : undefined
            }
            testId="erp-empty-state"
          />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {integrados.map(({ fonte, conector, integracao: intg }) => {
              const rotulo = rotuloErp(fonte, conectores);
              const configurado = estaConfigurado(intg);
              const aberto = expandido === fonte;
              const pillUltimo = intg?.lastSyncStatus ? PILL_SYNC[intg.lastSyncStatus] : undefined;
              const pausado = intg?.status === "pausado_por_falhas";
              const reativando = ocupadoDe(fonte).salvando;

              /**
               * `pendente` e o conector que esta no catalogo mas nao fala com o
               * ERP: todo metodo dele devolve erro. A marca ja travava a lista
               * suspensa; aqui ela precisa valer para a linha que JA existe —
               * ate esta mudanca o painel do provedor aceitava qualquer fonte
               * suportada, entao ha linha assim no banco.
               *
               * `editavel` junta os dois casos em que nao ha o que salvar,
               * testar ou sincronizar: sem conector nenhum, ou com um que so
               * figura no catalogo. O servidor recusa as tres acoes nos dois, e
               * abrir o formulario seria oferecer botao que volta com erro.
               */
              const pendente = !!conector?.naoImplementado;
              const editavel = !!conector && !pendente;

              /**
               * A credencial existe no banco e este servidor nao consegue abrir.
               *
               * Vem marcada da rota justamente para nao ser confundida com
               * ausencia: os campos secretos chegam em branco nos dois casos, e
               * so a marca distingue "nunca foi preenchida" de "foi, e nao abre".
               */
              const ilegivel = !!intg?.credencialIlegivel;

              /* O bloco de identidade e sempre o mesmo; o que muda e se ele abre
                 formulario. Fora do caso editavel nao ha o que abrir, e um
                 <button> que nao faz nada e pior que texto. */
              const identidade = (
                <>
                  {/* O ladrilho da primitiva: `vazio` porque ele identifica a
                      linha, nao promete um caminho — quem leva a algum lugar
                      aqui e a propria linha, quando abre o formulario. */}
                  <LadrilhoIcone Icone={Database} tom="vazio" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={TITULO_CARTAO}>{rotulo}</p>
                      {/* Tres estados, nao dois: configurado, sem credencial e
                          credencial que nao abre. O terceiro chegava aqui como
                          "Sem credencial" — a leitura que faz o operador salvar
                          por cima e sair achando que consertou. */}
                      <Selo
                        tom={ilegivel ? "danger" : configurado ? "ok" : "neutro"}
                        testId={`badge-erp-configurado-${fonte}`}
                      >
                        {ilegivel ? ROTULO_CREDENCIAL_ILEGIVEL : configurado ? "Configurado" : "Sem credencial"}
                      </Selo>
                      {/* Pausada, a integracao esta desligada — mas dizer so
                          "Inativo" esconde QUEM a desligou. O selo de pausa
                          substitui o par ativo/inativo em vez de somar a ele. */}
                      <Selo
                        tom={pausado ? "gated" : intg?.isEnabled ? "marca" : "neutro"}
                        testId={`badge-erp-status-${fonte}`}
                      >
                        {pausado ? "Pausado por falhas" : intg?.isEnabled ? "Ativo" : "Inativo"}
                      </Selo>
                      {!conector && (
                        <Selo tom="gated" testId={`badge-erp-sem-conector-${fonte}`}>
                          Sem conector
                        </Selo>
                      )}
                      {pendente && (
                        <Selo tom="neutro" testId={`badge-erp-indisponivel-${fonte}`}>
                          {ROTULO_CONECTOR_PENDENTE}
                        </Selo>
                      )}
                      {configurado && pillUltimo && <Selo tom={pillUltimo.tom}>{pillUltimo.texto}</Selo>}
                    </div>
                    {ilegivel ? (
                      /* "Preencha as credenciais", a linha do caso vazio, seria
                         mentira aqui: elas estao preenchidas. O que falta e
                         redigitar. */
                      <p className="mt-0.5 text-[12px] text-[var(--danger)]">
                        A credencial gravada não abre neste servidor — precisa ser digitada de novo.
                      </p>
                    ) : configurado ? (
                      <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                        <Num>{intg!.apiUrl?.replace(/https?:\/\//, "").slice(0, 50)}</Num>
                        {" · "}
                        <Num>{(intg!.totalSynced || 0).toLocaleString("pt-BR")}</Num> registros
                        {" · "}
                        {/* As linhas de ERP se empilham e esta e a ultima coluna
                            de dado da frase: em Inter os "45min"/"3h"/"12d" de
                            uma linha nao caem sobre os da outra. */}
                        <Num>{relDateAdmin(intg!.lastSyncAt)}</Num>
                        {(intg!.totalErrors || 0) > 0 && (
                          <span className="ml-1 text-[var(--danger)]">
                            · <Num>{intg!.totalErrors}</Num> erros
                          </span>
                        )}
                      </p>
                    ) : editavel ? (
                      <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                        Preencha as credenciais para habilitar teste e sincronização.
                      </p>
                    ) : (
                      /* Sem conector — ou com um que so figura no catalogo —
                         credencial nenhuma habilita teste ou varredura, e
                         prometer isso mandaria o operador procurar campo que a
                         tela nao vai abrir. O aviso logo abaixo diz o porque. */
                      <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                        Nenhuma varredura lê este ERP.
                      </p>
                    )}
                  </div>
                </>
              );

              return (
                <div key={fonte} className="px-4 py-4" data-testid={`row-erp-${fonte}`}>
                  {editavel ? (
                    <button
                      type="button"
                      // `ds-ctl` traz o anel de foco do sistema (index.css); o
                      // anel padrao do navegador aparecia, mas com outra cor e
                      // outra espessura que a dos demais controles da tela.
                      className={cn(ALVO_CONTROLE, "ds-ctl flex w-full items-center gap-3 rounded text-left")}
                      onClick={() => setExpandido(aberto ? null : fonte)}
                      data-testid={`button-toggle-erp-${fonte}`}
                    >
                      {identidade}
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 flex-none text-[var(--text-muted)] motion-safe:transition-transform",
                          aberto && "rotate-90",
                        )}
                        strokeWidth={2}
                      />
                    </button>
                  ) : (
                    <div className="flex w-full items-center gap-3">{identidade}</div>
                  )}

                  {!conector && (
                    <div className="mt-3 pl-12" data-testid={`erp-sem-conector-${fonte}`}>
                      <div className={AVISO_ATENCAO}>
                        {/* O identificador do ERP ja esta no titulo da linha; repeti-lo
                            aqui so publicaria de novo um nome tecnico que nao ajuda quem le. */}
                        <p className={TEXTO_AVISO}>
                          Este ERP não é mais suportado: não há conector para ele, então não há
                          campos para editar nem varredura que o leia. Esta linha sobrou de uma
                          configuração antiga e continua visível para que você saiba que ela existe.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* O par do selo: o selo diz o estado, este bloco diz o que ele
                      custa. Sem o texto, "Conector em desenvolvimento" ao lado de
                      "Ativo" seria mais uma marca para o operador decifrar. */}
                  {pendente && (
                    <div className="mt-3 pl-12" data-testid={`erp-conector-pendente-${fonte}`}>
                      <div className={AVISO_ATENCAO}>
                        <p className={TEXTO_AVISO}>
                          O conector deste ERP ainda não conversa com a API dele: existe só para
                          constar no catálogo, e nenhuma varredura consegue trazer dados. Salvar
                          credencial, testar conexão e sincronizar ficam indisponíveis aqui — o
                          servidor recusa as três enquanto o conector não for concluído.
                        </p>
                        {pausado && (
                          /* O pior desfecho do corte automatico: o provedor recebeu
                             e-mail de pausa por falhas de um ERP que nunca leu nada.
                             Religar so repetiria o ciclo, entao a linha nao oferece
                             o botao de reativar — oferece a explicacao. */
                          <p className={cn(TEXTO_AVISO, "mt-2")}>
                            As varreduras automáticas falharam até a pausa e o provedor foi avisado
                            por e-mail. Não há nada a corrigir do lado dele: a falha é do conector,
                            não da credencial. Reativar só repetiria a pausa.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* O par do selo "Credencial ilegivel": o selo nomeia o estado,
                      este bloco diz o que fazer. Aparece com a linha fechada
                      porque a acao (redigitar) exige abrir o formulario — sem o
                      aviso aqui, o operador nao teria motivo para abrir. */}
                  {ilegivel && (
                    <div className="mt-3 pl-12" data-testid={`erp-credencial-ilegivel-${fonte}`}>
                      <div className={AVISO_RISCO}>
                        <p className={TEXTO_AVISO}>
                          A credencial deste ERP está gravada, mas foi cifrada com outro segredo de
                          servidor e não pode ser lida aqui. Ela não está faltando — está ilegível — e,
                          enquanto continuar assim, toda varredura falha na autenticação.
                        </p>
                        <p className={cn(TEXTO_AVISO, "mt-2")}>
                          {editavel
                            ? "Abra o formulário e digite os segredos de novo, todos eles. Salvar com campo em branco não conserta: em branco significa manter o valor que já está gravado, e o valor gravado é justamente o que não abre."
                            : "Não há formulário para este ERP nesta tela, então a credencial não pode ser redigitada aqui. Avise o suporte técnico."}
                        </p>
                        {pausado && (
                          /* Sem esta frase, o aviso de pausa logo acima mandaria
                             religar — e religar sem redigitar repete a pausa e
                             dispara outro e-mail ao provedor. */
                          <p className={cn(TEXTO_AVISO, "mt-2")}>
                            As varreduras seguidas com falha já pausaram esta integração e o provedor
                            foi avisado por e-mail. Reativar sem redigitar a credencial repetiria a
                            pausa: salve o segredo novo com a integração ativa e ela volta a rodar.
                          </p>
                        )}
                        {editavel && !aberto && (
                          <button
                            type="button"
                            className={cn(BOTAO_MARCA, "mt-2")}
                            onClick={() => setExpandido(fonte)}
                            data-testid={`button-redigitar-credencial-${fonte}`}
                          >
                            Redigitar credencial
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Fora do <button> de cima de proposito: botao dentro de
                      botao e HTML invalido e o clique de religar viraria um
                      abre/fecha do formulario. */}
                  {pausado && !pendente && !ilegivel && (
                    <div className="mt-3 pl-12" data-testid={`erp-pausado-${fonte}`}>
                      <div className={AVISO_ATENCAO}>
                        <p className={TEXTO_AVISO}>
                          O sistema desligou esta integração sozinho após três varreduras automáticas
                          seguidas com falha, e avisou o provedor por e-mail. Corrija a credencial,
                          teste a conexão e religue — a contagem de falhas recomeça do zero.
                        </p>
                        <button
                          type="button"
                          className={cn(BOTAO_MARCA, DESABILITAVEL, "mt-2")}
                          disabled={reativando}
                          onClick={() =>
                            salvarMutation.mutate({
                              source: fonte,
                              // So `isEnabled`: a rota grava o que chega, e mandar
                              // os outros campos vazios apagaria a credencial que
                              // esta la. Quem limpa o status e registra a
                              // reativacao e o servidor.
                              corpo: { isEnabled: true },
                              reativando: true,
                            })
                          }
                          data-testid={`button-reativar-erp-${fonte}`}
                        >
                          {reativando ? "Reativando..." : "Reativar integração"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* O recuo alinha ao texto da linha: 36px do ladrilho da
                      primitiva + 12px do gap. Era 52px, medida do ladrilho de
                      40px que esta tela desenhava a mao. */}
                  {editavel && aberto && (
                    <div className="mt-4 pl-12" data-testid={`form-erp-${fonte}`}>
                      <FormularioErp
                        conector={conector!}
                        integracao={intg}
                        ocupado={ocupadoDe(fonte)}
                        resultadoTeste={resultadoTeste[fonte] ?? null}
                        resultadoSync={resultadoSync[fonte] ?? null}
                        onSalvar={corpo => {
                          /* A ultima barreira do defeito: numa linha ilegivel, um
                             Salvar com segredo em branco volta 200 e nao muda
                             nada no banco — a tela diria "Integração salva" e o
                             sync continuaria falhando. Melhor recusar aqui do que
                             confirmar um conserto que nao aconteceu. */
                          if (ilegivel && segredoEmBranco(corpo)) {
                            toast({
                              title: "Credencial não foi redigitada",
                              description:
                                "Um dos campos secretos ficou em branco, e em branco o servidor mantém o valor que já está gravado — o mesmo que ele não consegue ler. Digite os segredos de novo antes de salvar.",
                              variant: "destructive",
                            });
                            return;
                          }
                          salvarMutation.mutate({ source: fonte, corpo });
                        }}
                        onTestar={() => testarMutation.mutate(fonte)}
                        onSincronizar={() => sincronizarMutation.mutate(fonte)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <TopoCartao
          titulo="Adicionar integração"
          Icone={Plus}
          sub="Escolha um dos ERPs disponíveis para configurar. Ao salvar, ele passa a constar acima."
        />

        <div className="space-y-4 px-4 py-4">
          {conectores.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)]" data-testid="erp-sem-catalogo">
              {/* O caminho da rota nao ajuda quem le a tela e publica a API para
                  qualquer um com acesso ao painel (DESIGN_SYSTEM, secao 8). O
                  operador precisa saber o que fazer, nao onde o dado nasceu. */}
              O sistema não devolveu nenhum ERP para integrar agora. Recarregue a página; se a lista
              continuar vazia, avise o suporte técnico.
            </p>
          ) : disponiveis.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)]" data-testid="erp-todos-integrados">
              Todos os ERPs disponíveis já estão integrados com este provedor.
            </p>
          ) : (
            <>
              <div className="max-w-sm">
                {/* O rotulo de campo vem da primitiva. O que estava aqui era a
                    quarta voz de rotulo do painel: mono, mas em `--text-faint`,
                    que a 10px fica abaixo do minimo de contraste da secao 7 — e
                    rotulo de campo existe para ser LIDO antes de se preencher a
                    caixa. Fica `<Label>` e nao `Campo` porque o controle e um
                    `Select` do Radix, que se associa por `htmlFor` e nao por
                    aninhamento. */}
                <Label htmlFor="select-novo-erp" className={ROTULO_CAMPO}>
                  ERP disponível
                </Label>
                <Select
                  value={novoErp ?? ""}
                  onValueChange={fonte => {
                    // Trocar de ERP joga fora o que estava digitado: o `key` do
                    // formulario carrega a fonte, entao React desmonta o antigo
                    // em vez de reaproveitar o estado. Sem isso o token de um
                    // ERP apareceria no formulario de outro.
                    setNovoErp(fonte);
                    setResultadoTeste(r => ({ ...r, [fonte]: null }));
                    setResultadoSync(r => ({ ...r, [fonte]: null }));
                  }}
                >
                  <SelectTrigger
                    id="select-novo-erp"
                    ref={seletorRef}
                    /* Era `h-11` cravado: 44px tambem no mouse, contra a
                       densidade da secao 4. `ALVO_CONTROLE` guarda os 44px onde
                       eles sao regra — no ponteiro grosso. */
                    className={cn(ALVO_CONTROLE, "h-auto rounded")}
                    data-testid="select-novo-erp"
                  >
                    <SelectValue placeholder="Selecione um ERP" />
                  </SelectTrigger>
                  <SelectContent>
                    {disponiveis.map(c => (
                      <SelectItem
                        key={c.name}
                        value={c.name}
                        /* O conector so casca aparece, mas travado. Escondido, o
                           operador nao saberia que o sistema conhece o ERP e
                           abriria chamado perguntando se ha suporte; oferecido,
                           ele salvaria a credencial, a linha nasceria
                           "Configurado / Ativo" e o provedor leria "Integrada"
                           ate a primeira varredura falhar. */
                        disabled={!!c.naoImplementado}
                        data-testid={`option-erp-${c.name}`}
                      >
                        <span className="flex items-center gap-2">
                          {rotuloErp(c.name, conectores)}
                          {/* Mesmo testid da linha ja integrada: a lista suspensa so
                              oferece ERP sem linha, entao os dois nunca coexistem para
                              a mesma fonte. */}
                          {c.naoImplementado && (
                            <Selo tom="neutro" testId={`badge-erp-indisponivel-${c.name}`}>
                              {ROTULO_CONECTOR_PENDENTE}
                            </Selo>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Enquanto nenhum ERP esta escolhido nao ha formulario: um form
                  em branco sem dono convida a digitar credencial sem saber
                  para quem ela vai. */}
              {conectorNovo && (
                <div className="border-t border-[var(--border)] pt-4" data-testid={`form-novo-erp-${conectorNovo.name}`}>
                  <FormularioErp
                    key={conectorNovo.name}
                    conector={conectorNovo}
                    ocupado={ocupadoDe(conectorNovo.name)}
                    resultadoTeste={resultadoTeste[conectorNovo.name] ?? null}
                    resultadoSync={resultadoSync[conectorNovo.name] ?? null}
                    onSalvar={corpo => salvarMutation.mutate({ source: conectorNovo.name, corpo })}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <TopoCartao titulo="Histórico de sincronização" Icone={History} sub="Últimas 20 varreduras" />
        {logs.length === 0 ? (
          <EstadoVazio
            Icone={RefreshCw}
            titulo="Nenhuma sincronização registrada"
            descricao="Cada varredura — automática ou disparada aqui — deixa uma linha com o desfecho, quantos registros entraram e de qual endereço partiu."
            testId="empty-historico-sync"
          />
        ) : (
          /* A ultima linha nao repete o hairline: a tabela termina no rodape do
             cartao, e as duas bordas coladas leem como uma so, de 2px. */
          <TabelaPainel className="[&_tbody_tr:last-child_td]:border-0">
              <thead>
                <tr>
                  {/* "Status" e "IP" sao as duas palavras tecnicas que sobravam
                      num cabecalho de tela (secao 8): a coluna diz como a
                      varredura terminou e de qual endereco ela partiu. */}
                  {["ERP", "Desfecho", "Registros", "Data", "Endereço de origem"].map(h => (
                    <Th key={h}>{h}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  /* Status fora dos quatro conhecidos: nunca o identificador cru
                     na tela (secao 8). Diz que nao sabe, em tom neutro. */
                  const pill = PILL_SYNC[log.status] ?? { texto: "Desfecho desconhecido", tom: "neutro" as TomSelo };
                  return (
                    <tr key={log.id} data-testid={`row-synclog-${log.id}`}>
                      <Td className="text-[13px] font-medium text-[var(--text)]">
                        {rotuloErp(log.erpSource, conectores)}
                      </Td>
                      <Td>
                        <Selo tom={pill.tom}>{pill.texto}</Selo>
                      </Td>
                      {/* Contagem, data e endereco se leem da esquerda para a
                          direita ao lado do rotulo da coluna: mono tabular, sem
                          alinhar a direita, e a cabeca acompanha. */}
                      <Td num alinhamento="esquerda" className="text-[12px]">
                        {/* A linha de reativacao nao processou registro nenhum:
                            "0 ok" leria como varredura que nao achou ninguem. */}
                        {log.status === "reativado" ? (
                          <span className="text-[var(--text-muted)]">—</span>
                        ) : (
                          <>
                            {log.recordsProcessed} ok
                            {log.recordsFailed > 0 && ` · ${log.recordsFailed} falhas`}
                          </>
                        )}
                      </Td>
                      <Td num alinhamento="esquerda" className="text-[12px] text-[var(--text-muted)]">
                        {fmtDateTime(log.syncedAt)}
                      </Td>
                      <Td num alinhamento="esquerda" className="text-[12px] text-[var(--text-muted)]">
                        {log.ipAddress || "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
          </TabelaPainel>
        )}
      </Card>
    </TabsContent>
  );
}


/* O `InfoRow` (icone + rotulo + valor, uma coluna) morava aqui e saiu com o
   cartao que o usava. Ele tipava `value: string`, entao nao aceitava um `<Selo>`
   — e a conferencia do cadastro precisa de um. Quem faz o par agora e
   `DadoCadastro`, la em cima, que recebe ReactNode e monta duas colunas. */
