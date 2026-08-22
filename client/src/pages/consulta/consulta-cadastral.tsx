import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  IdCard, Search, MapPin, Wallet, ShieldCheck, Settings2, Phone, Mail,
  Gauge, AlertTriangle, Activity, CreditCard,
} from "lucide-react";
import LoadingCard from "@/components/consulta/LoadingCard";
import ConsultaIdleState from "@/components/consulta/ConsultaIdleState";
import ConsultaSearchBar from "@/components/consulta/ConsultaSearchBar";
import LgpdDisclaimerModal from "@/components/consulta/LgpdDisclaimerModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Endereco = {
  logradouro: string; numero?: string; complemento?: string; bairro?: string;
  cidade?: string; uf?: string; cep?: string;
  ratificado: boolean; ativo: boolean; principal: boolean; naReceita: boolean;
  ultimaPassagem?: string | null; passagens: number; passagensRuins: number;
};
type Telefone = {
  numero: string; ddd?: string; tipo?: string; operadora?: string;
  ativo: boolean; principal: boolean; prioridade?: number;
  naoPerturbe: boolean; ultimaPassagem?: string | null; passagensRuins: number;
};
type Identidade = {
  nome?: string; nascimento?: string; idade?: number; nomeMae?: string;
  situacaoReceita?: string; dataSituacao?: string;
};

type Resultado = {
  id: number; cpfCnpj: string;
  veredito: "APROVAR" | "ATENCAO" | "RECUSAR" | "NAO_ENCONTRADO";
  motivos: string[];
  latenciaMs: number;
  consultasComFalha: number;
  identidade: Identidade;
  enderecos: Endereco[];
  telefones: Telefone[];
  emails: string[];
  renda: {
    faixa?: string; emReais: string | null; patrimonio?: string;
    fontes: Array<{ fonte: string; faixa: string; emReais: string | null; formal: boolean }>;
    rendaFormal: { fonte: string; faixa: string; emReais: string | null } | null;
    declaracoesIR: Array<{ ano: string; status?: string; banco?: string; agencia?: string; segmentoVip: boolean }>;
    declaraIrRecorrente: boolean; temSegmentoVip: boolean;
  };
  risco: {
    score?: number; nivel?: string; empregado?: boolean; socio?: boolean;
    recebendoAuxilio?: boolean; inicioUltimaOcupacao?: string;
  };
  inadimplencia: {
    emCobrancaAgora: boolean; cobrancas365d: number; credores365d: number;
    mesesConsecutivos: number; ultimaCobranca?: string;
    processosTotal: number; processosComoReu: number; processos365d: number;
    temExecucao: boolean; naturezas: string[]; dividaAtiva: number;
  };
  rastro: {
    consultas30d: number; consultas365d: number; passagensRuins: number;
    primeiraPassagem?: string; ultimaPassagem?: string;
    buscaCredito?: string; usoCartao?: string; usoBancoDigital?: string;
    mudancasNome: number; mudancasStatus: number;
  };
  patrimonio: { veiculos: number; recebeAuxilio: boolean; auxiliosAtivos: number; valorAuxilio: number };
  riscoArea: Array<{ endereco: string; ponto?: number; raio100m?: number }>;
  consultasIndisponiveis: number;
  dados: {
    encontrado: boolean; taxIdStatus?: string; temObito?: boolean;
    nascimentoValidadoNaReceita?: boolean; homonimos?: number;
    badAddressPassages?: number; faixaRenda?: string;
  };
};

/** Formatador de data. Nome distinto de `data` para nao colidir com o
 *  `const { data }` do useQuery dentro do componente. */
const fmtData = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString("pt-BR") : "—";

const telefoneFmt = (t: Telefone) => {
  const n = t.numero.replace(/\D/g, "");
  const corpo = n.length >= 9 ? `${n.slice(0, n.length - 4)}-${n.slice(-4)}` : n;
  return t.ddd ? `(${t.ddd}) ${corpo}` : corpo;
};

/**
 * Pílula de fato — arredondada e com contorno, do mockup.
 *
 * Diverge do DESIGN_SYSTEM, que proíbe `rounded-full` em badge de STATUS. A
 * diferença é o papel: estas não são status de linha numa tabela densa, são os
 * três fatos que passam ou reprovam o CPF sozinhos, num cabeçalho arejado. O
 * contorno existe porque o `-bg` sozinho some contra `--surface`.
 */
function Pilula({ children, tom = "neutro" }: { children: React.ReactNode; tom?: "ok" | "alerta" | "neutro" }) {
  const cls = tom === "ok" ? "bg-[var(--ok-bg)] text-[var(--ok)] border-[var(--ok-border)]"
    : tom === "alerta" ? "bg-[var(--gated-bg)] text-[var(--gated)] border-[var(--gated-border)]"
    : "bg-[var(--surface-inset)] text-[var(--text-muted)] border-[var(--border)]";
  return (
    <span className={`inline-flex items-center text-[11.5px] font-semibold px-2.5 py-[3px] rounded-full border ${cls}`}>
      {children}
    </span>
  );
}

/**
 * Arco de score. A posição na escala se lê antes do valor — um número solto
 * exige que o operador saiba de cabeça que 900 é bom.
 */
function ArcoScore({ score }: { score?: number }) {
  const pct = Math.max(0, Math.min(1, (score ?? 0) / 1000));
  // Comprimento do arco: raio 74, meia-volta = π·74 ≈ 232.
  const comprimento = Math.PI * 74;
  const cor = score == null ? "var(--text-faint)"
    : score >= 700 ? "var(--ok)" : score >= 400 ? "var(--gated)" : "var(--danger)";
  return (
    <div className="relative flex flex-col items-center">
      <svg width="180" height="100" viewBox="0 0 180 100" aria-hidden="true">
        <path d="M16 90 A 74 74 0 0 1 164 90" fill="none"
          stroke="var(--surface-inset)" strokeWidth="12" strokeLinecap="round" />
        <path d="M16 90 A 74 74 0 0 1 164 90" fill="none"
          stroke={cor} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${(comprimento * pct).toFixed(1)} ${comprimento.toFixed(1)}`} />
      </svg>
      <span className="font-mono text-[44px] font-semibold tracking-[-0.02em] leading-none tabular-nums -mt-[52px] text-[var(--text)]">
        {score ?? "—"}
      </span>
    </div>
  );
}

/** Etiqueta pequena de estado. Retangular, conforme o design system. */
function Tag({ children, tom = "neutro" }: { children: React.ReactNode; tom?: "ok" | "alerta" | "neutro" }) {
  const cls = tom === "ok" ? "bg-[var(--ok-bg)] text-[var(--ok)]"
    : tom === "alerta" ? "bg-[var(--gated-bg)] text-[var(--gated)]"
    : "bg-[var(--surface-inset)] text-[var(--text-muted)]";
  return (
    <span className={`inline-flex items-center text-[10px] font-medium tracking-[0.04em] px-1.5 py-0.5 rounded ${cls}`}>
      {children}
    </span>
  );
}

type Integracao = {
  configurado: boolean; login: string | null; senhaMascarada: string | null;
  isEnabled: boolean; lastCheckStatus: string | null;
};

/**
 * `chamada` e o texto do chip — imperativo, do mockup: diz o que FAZER, nao
 * classifica. "Contrate com cautela" instrui; "Atenção" so rotula.
 */
const VEREDITO: Record<
  Resultado["veredito"],
  { rotulo: string; chamada: string; cls: string; borderCls: string; borda: string; nota: string }
> = {
  APROVAR: {
    rotulo: "Aprovar", chamada: "Pode contratar",
    cls: "bg-[var(--ok-bg)] text-[var(--ok)]", borderCls: "border-[var(--ok-border)]",
    borda: "border-l-[var(--ok)]", nota: "Nenhum sinal de risco cadastral",
  },
  ATENCAO: {
    rotulo: "Atenção", chamada: "Contrate com cautela",
    cls: "bg-[var(--gated-bg)] text-[var(--gated)]", borderCls: "border-[var(--gated-border)]",
    borda: "border-l-[var(--gated)]", nota: "Contrate com cautela — veja os motivos",
  },
  RECUSAR: {
    rotulo: "Recusar", chamada: "Não contrate",
    cls: "bg-[var(--danger-bg)] text-[var(--danger)]", borderCls: "border-[var(--danger-border)]",
    borda: "border-l-[var(--danger)]", nota: "Impedimento cadastral na Receita Federal",
  },
  NAO_ENCONTRADO: {
    rotulo: "Não encontrado", chamada: "Sem registro",
    cls: "bg-[var(--surface-inset)] text-[var(--text-muted)]", borderCls: "border-[var(--border)]",
    borda: "border-l-[var(--border-strong)]", nota: "Sem registro — não é recusa, é ausência de informação",
  },
};

/** A e o menor risco, H o maior. Do meio para baixo ja merece cautela. */
const NIVEL_TOM = (n: string): "ok" | "alerta" | "neutro" => {
  const c = n.trim().toUpperCase();
  if (["A", "B"].includes(c)) return "ok";
  if (["C", "D"].includes(c)) return "neutro";
  return "alerta";
};

/** A e altissima intensidade, H e ausencia de rastro. */
const ESCALA = (c?: string) => {
  if (!c) return "—";
  const l = c.trim().toUpperCase();
  const rotulos: Record<string, string> = {
    A: "A · muito alta", B: "B · alta", C: "C · média-alta", D: "D · média",
    E: "E · média-baixa", F: "F · baixa", G: "G · muito baixa", H: "H · nenhuma",
  };
  return rotulos[l] ?? l;
};

/** 1 = comunidade setorizada, 2 = nao setorizada, 3 = sem comunidade delimitada. */
const AREA_ROTULO = (p?: number) =>
  p === 1 ? "comunidade setorizada" : p === 2 ? "comunidade" : p === 3 ? "sem comunidade" : "—";
const AREA_TOM = (p?: number): "ok" | "alerta" | "neutro" =>
  p === 1 ? "alerta" : p === 2 ? "neutro" : "ok";

/**
 * Etapas reais desta consulta. A Cadastral nao bate em ERP de provedor nenhum,
 * entao reusar as etapas da Consulta ISP faria a tela mentir sobre a origem do
 * dado — e a origem e informacao sensivel que nao deve aparecer.
 */
const ETAPAS_CADASTRAL = [
  { id: 1, label: "Validando documento", detail: "Conferindo dígitos verificadores do CPF", duration: 700 },
  { id: 2, label: "Situação na Receita", detail: "Regularidade, óbito e alterações de nome", duration: 1800 },
  { id: 3, label: "Vínculo e contato", detail: "Endereços, telefones e ratificação", duration: 2200 },
  { id: 4, label: "Capacidade e restrições", detail: "Renda, cobranças e histórico judicial", duration: 2000 },
];

/** CPF mascarado para exibição: o meio não precisa aparecer na tela. */
const mascaraCpf = (v: string) => {
  const n = (v || "").replace(/\D/g, "");
  return n.length === 11 ? n.slice(0, 3) + ".•••.•••-" + n.slice(9) : v;
};

const soDigitos = (v: string) => v.replace(/\D/g, "").slice(0, 11);
const formataCpf = (v: string) =>
  soDigitos(v).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");

function Bloco({
  titulo, Icone, children, acao,
}: { titulo: string; Icone: any; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-faint)]">
        <Icone className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {titulo}
        </span>
        {acao && <span className="ml-auto">{acao}</span>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

/**
 * Grade de pares rotulo/valor. Duas colunas a partir de sm.
 *
 * Antes cada par ocupava a largura inteira do card com justify-between, entao
 * num card de 950px o olho viajava 900px entre o rotulo e o numero. Em duas
 * colunas a distancia cai pela metade e cabe o dobro de linhas na mesma altura
 * — densidade e decisao de produto neste sistema, o operador varre muitas
 * linhas por dia.
 */
function Pares({ children, cols = 2 }: { children: React.ReactNode; cols?: 1 | 2 | 3 }) {
  const grade = cols === 1 ? "grid-cols-1"
    : cols === 3 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
    : "grid-cols-1 sm:grid-cols-2";
  return <dl className={`grid ${grade} gap-x-8 gap-y-1.5`}>{children}</dl>;
}

function Linha({ rotulo, valor, alerta }: { rotulo: string; valor: React.ReactNode; alerta?: boolean }) {
  return (
    // O valor encosta no rotulo: 1fr no rotulo empurra so o resto da celula,
    // que e estreita, em vez da largura do card.
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-3 text-[13px] min-w-0">
      <dt className="text-[var(--text-muted)] truncate">{rotulo}</dt>
      <dd className={`font-mono tabular-nums text-right ${alerta ? "text-[var(--gated)] font-medium" : "text-[var(--text)]"}`}>
        {valor}
      </dd>
    </div>
  );
}

/** Número que decide, na tira de resumo. Mono e tabular, conforme o sistema. */
function Metrica({
  rotulo, valor, sub, tom = "neutro",
}: { rotulo: string; valor: React.ReactNode; sub?: string; tom?: "ok" | "alerta" | "perigo" | "neutro" }) {
  const cor = tom === "ok" ? "text-[var(--ok)]"
    : tom === "alerta" ? "text-[var(--gated)]"
    : tom === "perigo" ? "text-[var(--danger)]"
    : "text-[var(--text)]";
  return (
    <div className="px-4 py-3 min-w-0">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--text-faint)] truncate">
        {rotulo}
      </span>
      <p className={`mt-1 font-mono text-[19px] font-medium tracking-[-0.02em] tabular-nums truncate ${cor}`}>
        {valor}
      </p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] truncate">{sub}</p>}
    </div>
  );
}

/** Formulário de credencial — cada provedor usa o próprio usuário de integração. */
function Configuracao({ integracao }: { integracao?: Integracao }) {
  const { toast } = useToast();
  const [login, setLogin] = useState(integracao?.login ?? "");
  const [password, setPassword] = useState("");

  const salvar = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("PATCH", "/api/bigdata-integration", { login, password });
      return r.json();
    },
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bigdata-integration"] });
      setPassword("");
      toast({
        title: d.ok ? "Credencial validada" : "Credencial recusada",
        description: d.message,
        variant: d.ok ? undefined : "destructive",
      });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] max-w-[520px]">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-faint)]">
        <Settings2 className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Credencial da consulta cadastral
        </span>
      </div>
      <form
        className="px-4 py-4 space-y-3"
        onSubmit={e => { e.preventDefault(); salvar.mutate(); }}
      >
        <p className="text-[13px] text-[var(--text-muted)]">
          Credencial de integração própria do seu provedor. Assim o consumo e o
          custo ficam separados por provedor.
        </p>
        <div>
          <Label htmlFor="login">Usuário</Label>
          <Input id="login" value={login} onChange={e => setLogin(e.target.value)}
            autoComplete="off" required data-testid="campo-login" />
        </div>
        <div>
          <Label htmlFor="password">Senha</Label>
          <Input id="password" type="password" value={password}
            onChange={e => setPassword(e.target.value)} autoComplete="new-password"
            required placeholder={integracao?.senhaMascarada ?? ""} data-testid="campo-senha" />
        </div>
        {integracao?.lastCheckStatus && (
          <p className={`text-[12px] ${integracao.isEnabled ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
            {integracao.lastCheckStatus}
          </p>
        )}
        <Button type="submit" disabled={salvar.isPending} data-testid="botao-salvar-credencial">
          {salvar.isPending ? "Validando…" : "Salvar e validar"}
        </Button>
      </form>
    </div>
  );
}


export default function ConsultaCadastralPage() {
  const { toast } = useToast();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [activeTab, setActiveTab] = useState<"nova" | "historico" | "info">("nova");
  const [verConfig, setVerConfig] = useState(false);

  // LGPD — mesmo fluxo de modal da Consulta ISP: o aceite vale para a sessao,
  // nao para cada busca. Checkbox no formulario pedia confirmacao repetida.
  const [lgpdDisclaimerOpen, setLgpdDisclaimerOpen] = useState(false);
  const [lgpdAccepted, setLgpdAccepted] = useState(false);
  const [lgpdSessionAccepted, setLgpdSessionAccepted] = useState(false);
  const [pendingSearchPayload, setPendingSearchPayload] = useState<any>(null);

  const { data: integracao, isLoading: carregandoIntegracao } = useQuery<Integracao>({
    queryKey: ["/api/bigdata-integration"],
  });
  const { data } = useQuery<any>({ queryKey: ["/api/bigdata-consultations"] });
  const consultations = data?.consultations ?? [];

  const mutation = useMutation({
    mutationFn: async (payload: any) => {
      const r = await apiRequest("POST", "/api/bigdata-consultations", {
        cpfCnpj: soDigitos(payload.cpfCnpj),
        lgpdAccepted: true,
      });
      return r.json();
    },
    onSuccess: (d: Resultado) => {
      setResultado(d);
      queryClient.invalidateQueries({ queryKey: ["/api/bigdata-consultations"] });
    },
    onError: (e: any) => {
      setResultado(null);
      toast({ title: "Consulta não realizada", description: e.message, variant: "destructive" });
    },
  });

  const executeSearch = (payload: any) => mutation.mutate(payload);

  const handleSearch = (payload: any) => {
    if (!lgpdSessionAccepted) {
      setPendingSearchPayload(payload);
      setLgpdAccepted(false);
      setLgpdDisclaimerOpen(true);
      return;
    }
    executeSearch(payload);
  };

  const handleLgpdAcceptAndSearch = () => {
    setLgpdSessionAccepted(true);
    setLgpdDisclaimerOpen(false);
    if (pendingSearchPayload) {
      executeSearch(pendingSearchPayload);
      setPendingSearchPayload(null);
    }
  };

  const handleClear = () => setResultado(null);

  const configurado = integracao?.configurado;
  const v = resultado ? VEREDITO[resultado.veredito] : null;
  const d = resultado?.dados;

  const aprovados = consultations.filter((c: any) => c.veredito === "APROVAR").length;
  const taxaAprovacao = consultations.length > 0
    ? Math.round((aprovados / consultations.length) * 100) : 0;

  return (
    <div className="bg-[var(--color-bg)] p-4 lg:p-5" data-testid="consulta-cadastral-page">
      <div className="space-y-4">

        {/* HEADER — mesmo formato da Consulta ISP */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1
              className="text-[19px] font-medium tracking-[-0.02em] text-[var(--color-ink)] leading-tight"
              data-testid="text-consulta-cadastral-title"
            >
              Consulta Cadastral
            </h1>
            <p className="text-[13px] text-[var(--color-muted)] mt-0.5">
              Situação do CPF na Receita, endereço, renda e inadimplência
            </p>
          </div>
          <div className="flex items-center gap-2">
            {configurado && (
              <Button variant="ghost" size="sm" onClick={() => setVerConfig(x => !x)} data-testid="botao-config">
                <Settings2 className="w-4 h-4 mr-1.5" />
                Credencial
              </Button>
            )}
            <div className="border border-[var(--border)] rounded px-3 py-1.5 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[var(--color-brand)]" />
              <span
                className={`font-mono text-sm font-semibold ${(data?.credits ?? 1) === 0 ? "text-[var(--color-danger)]" : "text-[var(--color-ink)]"}`}
                data-testid="text-cadastral-credits"
              >
                {data?.credits ?? "..."}
              </span>
            </div>
          </div>
        </div>

        {/* TABS */}
        <div className="flex gap-0 border-b border-[var(--border)] w-fit">
          {(["nova", "historico", "info"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              data-testid={`tab-${tab}`}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-[var(--color-brand)] text-[var(--color-ink)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              {tab === "nova" ? "Nova Consulta" : tab === "historico" ? "Histórico" : "Informações"}
            </button>
          ))}
        </div>

        {activeTab === "nova" && (
          <div className="space-y-5">
            {carregandoIntegracao ? (
              <Skeleton className="h-[200px] max-w-[520px]" />
            ) : !configurado || verConfig ? (
              <Configuracao integracao={integracao} />
            ) : (
              <>
                <ConsultaSearchBar
                  onSearch={handleSearch}
                  isLoading={mutation.isPending}
                  hasResult={!!resultado}
                  onClear={handleClear}
                />

                {mutation.isPending && (
                  <LoadingCard
                    titulo="Consultando dados cadastrais..."
                    subtitulo="Aguarde, conferindo situação do CPF, endereço e restrições"
                    etapas={ETAPAS_CADASTRAL}
                  />
                )}

                {!mutation.isPending && !resultado && (
                  <ConsultaIdleState
                    totalConsultas={consultations.length}
                    metrics={[
                      { label: "Consultas hoje", value: data?.todayCount ?? 0, testId: "text-cadastral-today" },
                      { label: "No mês", value: data?.monthCount ?? 0, testId: "text-cadastral-month" },
                      { label: "Taxa de aprovação", value: taxaAprovacao, suffix: "%", testId: "text-cadastral-approval" },
                      { label: "Créditos", value: data?.credits ?? 0, testId: "text-cadastral-saldo" },
                    ]}
                    emptyTitle="Nenhuma consulta ainda"
                    emptyDescription="Digite o CPF do candidato antes de liberar a instalação. Você recebe a situação na Receita, o vínculo com o endereço, a renda estimada e o histórico de inadimplência."
                    emptyCta="FAZER PRIMEIRA CONSULTA"
                    searchInputTestId="input-consulta-search"
                  />
                )}

                {!mutation.isPending && resultado && v && (
                  <div className="space-y-4" data-testid="consultation-result">
              {/* A decisão é o produto. Barra lateral na cor do veredito dá o
                  peso que um badge de 12px não dava. */}
              {/* Estrutura do mockup: conteudo a esquerda, arco de score num
                  painel proprio a direita. O score deixa de ser mais um numero
                  na fila e passa a ser a segunda coisa que o olho encontra. */}
              <div className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden border-l-[3px] ${v.borda} grid grid-cols-1 lg:grid-cols-[1fr_300px]`}>
                <div className="p-6 flex flex-col gap-4">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-[0.08em] px-2.5 py-1 rounded-full border ${v.cls} ${v.borderCls}`}
                      data-testid="veredito">
                      {v.chamada}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--text-faint)] tabular-nums">
                      {resultado.latenciaMs} ms
                    </span>
                  </div>

                  {/* Identidade grande: o operador confirma que consultou a pessoa
                      certa antes de olhar qualquer numero. */}
                  <div>
                    <p className="text-[26px] font-bold tracking-[-0.02em] leading-[1.15] text-[var(--text)]">
                      {resultado.identidade?.nome ?? "Nome não informado"}
                    </p>
                    <p className="font-mono text-[13px] tabular-nums text-[var(--text-muted)] mt-1">
                      {mascaraCpf(resultado.cpfCnpj)}
                      {resultado.identidade?.idade ? ` · ${resultado.identidade.idade} anos` : ""}
                      {resultado.enderecos?.[0]?.cidade
                        ? ` · ${resultado.enderecos[0].cidade}/${resultado.enderecos[0].uf ?? ""}` : ""}
                    </p>
                  </div>

                  {d?.encontrado && (
                    <div className="flex gap-2 flex-wrap">
                      <Pilula tom={d.taxIdStatus?.toUpperCase() === "REGULAR" ? "ok" : "alerta"}>
                        {d.taxIdStatus?.toUpperCase() === "REGULAR" ? "CPF regular na Receita" : `CPF ${d.taxIdStatus}`}
                      </Pilula>
                      <Pilula tom={d.temObito ? "alerta" : "ok"}>
                        {d.temObito ? "Com indicação de óbito" : "Sem indicação de óbito"}
                      </Pilula>
                      {resultado.risco.empregado != null && (
                        <Pilula tom={resultado.risco.empregado ? "ok" : "alerta"}>
                          {resultado.risco.empregado ? "Empregado" : "Sem vínculo formal"}
                          {resultado.risco.socio ? " · sócio de empresa" : ""}
                        </Pilula>
                      )}
                    </div>
                  )}

                  {resultado.motivos.length > 0 && (
                    <div className="border-t border-[var(--border-faint)] pt-3.5">
                      <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] mb-2">
                        {resultado.veredito === "RECUSAR" ? "Por que recusar" : "Por que cautela"}
                      </span>
                      <div className="flex flex-col gap-1.5">
                        {resultado.motivos.map((m, i) => (
                          <div key={i} className="flex items-center gap-2 text-[13.5px] text-[var(--text)]">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[var(--gated)]" />
                            <span>{m}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Painel do score. Arco em vez de numero solto: a posicao na
                    escala se le antes do valor. */}
                <div className="border-t lg:border-t-0 lg:border-l border-[var(--border-faint)] bg-[var(--surface-2)] p-6 flex flex-col items-center justify-center">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] mb-1.5">
                    Score de risco
                  </span>
                  <ArcoScore score={resultado.risco.score} />
                  <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-faint)] mt-0.5">
                    de 1000{resultado.risco.nivel ? ` · nível ${resultado.risco.nivel}` : ""}
                  </span>
                  <p className="text-[12px] text-[var(--text-muted)] text-center mt-2.5 max-w-[220px]">
                    Maior é melhor. A é o menor risco, H o maior.
                  </p>
                </div>
              </div>

              {/* Tira de resumo: os cinco números que decidem, numa varredura só.
                  Sem ela o operador tinha que ler sete cards para formar o quadro. */}
              {d?.encontrado && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y lg:divide-y-0 divide-[var(--border-faint)]">
                  <Metrica
                    rotulo="Score de risco"
                    valor={resultado.risco.score != null ? resultado.risco.score : "—"}
                    sub={resultado.risco.nivel ? `nível ${resultado.risco.nivel} de A–H` : undefined}
                    tom={resultado.risco.score == null ? "neutro"
                      : resultado.risco.score >= 700 ? "ok"
                      : resultado.risco.score >= 400 ? "alerta" : "perigo"}
                  />
                  <Metrica
                    rotulo="Cobranças 12m"
                    valor={resultado.inadimplencia.cobrancas365d}
                    sub={resultado.inadimplencia.emCobrancaAgora ? "em cobrança agora"
                      : resultado.inadimplencia.credores365d > 1
                        ? `${resultado.inadimplencia.credores365d} credores` : "nenhuma ativa"}
                    tom={resultado.inadimplencia.emCobrancaAgora ? "perigo"
                      : resultado.inadimplencia.cobrancas365d > 0 ? "alerta" : "ok"}
                  />
                  <Metrica
                    rotulo="Processos como réu"
                    valor={resultado.inadimplencia.processosComoReu}
                    sub={resultado.inadimplencia.temExecucao ? "com execução judicial"
                      : `${resultado.inadimplencia.processos365d} no último ano`}
                    tom={resultado.inadimplencia.temExecucao ? "perigo"
                      : resultado.inadimplencia.processosComoReu > 0 ? "alerta" : "ok"}
                  />
                  <Metrica
                    rotulo="Renda estimada"
                    valor={resultado.renda.emReais?.replace("/mês", "") ?? "—"}
                    sub={resultado.risco.empregado ? "com vínculo formal" : "sem vínculo formal"}
                    tom={resultado.risco.empregado === false ? "alerta" : "neutro"}
                  />
                  <Metrica
                    rotulo="Consultas 30d"
                    valor={resultado.rastro.consultas30d}
                    sub="no mercado inteiro"
                    tom={resultado.rastro.consultas30d >= 10 ? "alerta" : "ok"}
                  />
                </div>
              )}

              {d?.encontrado && (
                <div className="space-y-3">
                  {/* Score e inadimplência vêm antes do cadastro: é o que decide. */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <Bloco titulo="Capacidade de pagamento" Icone={Gauge}>
                      {resultado.risco.score != null ? (
                        <>
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-[28px] font-medium tracking-[-0.02em] text-[var(--text)] tabular-nums">
                              {resultado.risco.score}
                            </span>
                            <span className="text-[13px] text-[var(--text-muted)]">/ 1000</span>
                            {resultado.risco.nivel && (
                              <Tag tom={NIVEL_TOM(resultado.risco.nivel)}>nível {resultado.risco.nivel}</Tag>
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--text-faint)]">
                            Maior é melhor. Nível A é o menor risco, H o maior.
                          </p>
                          <Pares cols={1}>
                            <Linha rotulo="Empregado atualmente"
                              valor={resultado.risco.empregado == null ? "—" : resultado.risco.empregado ? "Sim" : "Não"}
                              alerta={resultado.risco.empregado === false} />
                            <Linha rotulo="Sócio de empresa"
                              valor={resultado.risco.socio == null ? "—" : resultado.risco.socio ? "Sim" : "Não"} />
                            <Linha rotulo="Recebe auxílio"
                              valor={resultado.risco.recebendoAuxilio == null ? "—" : resultado.risco.recebendoAuxilio ? "Sim" : "Não"} />
                          </Pares>
                        </>
                      ) : (
                        <p className="text-[13px] text-[var(--text-muted)]">Sem score para este CPF.</p>
                      )}
                    </Bloco>

                    <Bloco titulo="Inadimplência e judicial" Icone={AlertTriangle}>
                      <Pares>
                        <Linha rotulo="Em cobrança agora"
                          valor={resultado.inadimplencia.emCobrancaAgora ? "Sim" : "Não"}
                          alerta={resultado.inadimplencia.emCobrancaAgora} />
                        <Linha rotulo="Cobranças em 12 meses"
                          valor={resultado.inadimplencia.cobrancas365d +
                            (resultado.inadimplencia.credores365d > 1
                              ? " · " + resultado.inadimplencia.credores365d + " credores" : "")}
                          alerta={resultado.inadimplencia.cobrancas365d > 0} />
                        <Linha rotulo="Processos como réu"
                          valor={resultado.inadimplencia.processosComoReu + " de " + resultado.inadimplencia.processosTotal}
                          alerta={resultado.inadimplencia.temExecucao} />
                        <Linha rotulo="Processos no último ano"
                          valor={resultado.inadimplencia.processos365d}
                          alerta={resultado.inadimplencia.processos365d > 0} />
                        <Linha rotulo="Dívida ativa da União"
                          valor={resultado.inadimplencia.dividaAtiva > 0
                            ? "R$ " + resultado.inadimplencia.dividaAtiva.toLocaleString("pt-BR", { minimumFractionDigits: 2 })
                            : "nenhuma"}
                          alerta={resultado.inadimplencia.dividaAtiva > 0} />
                        <Linha rotulo="Última cobrança" valor={fmtData(resultado.inadimplencia.ultimaCobranca)} />
                      </Pares>
                      {(resultado.inadimplencia.temExecucao || resultado.inadimplencia.naturezas.length > 0) && (
                        <div className="flex gap-1.5 flex-wrap pt-2.5 mt-2.5 border-t border-[var(--border-faint)]">
                          {resultado.inadimplencia.temExecucao && <Tag tom="alerta">execução judicial</Tag>}
                          {resultado.inadimplencia.naturezas.map((n, i) => <Tag key={i}>{n.toLowerCase()}</Tag>)}
                        </div>
                      )}
                    </Bloco>
                  </div>

                  <Bloco titulo="Rastro no mercado" Icone={Activity}>
                    <Pares cols={3}>
                      <Linha rotulo="Consultas em 30 dias" valor={resultado.rastro.consultas30d}
                        alerta={resultado.rastro.consultas30d >= 10} />
                      <Linha rotulo="Consultas em 12 meses" valor={resultado.rastro.consultas365d} />
                      <Linha rotulo="Alterações de nome" valor={resultado.rastro.mudancasNome}
                        alerta={resultado.rastro.mudancasNome > 0} />
                      <Linha rotulo="Veículos" valor={resultado.patrimonio.veiculos} />
                      <Linha rotulo="Busca por crédito" valor={ESCALA(resultado.rastro.buscaCredito)}
                        alerta={["A","B"].includes((resultado.rastro.buscaCredito||"").toUpperCase())} />
                      <Linha rotulo="Uso de cartão" valor={ESCALA(resultado.rastro.usoCartao)} />
                      <Linha rotulo="Banco digital" valor={ESCALA(resultado.rastro.usoBancoDigital)} />
                      <Linha rotulo="Recebe auxílio"
                        valor={resultado.patrimonio.recebeAuxilio ? "Sim" : "Não"} />
                    </Pares>
                    {/* Consulta demais em 30 dias é o padrão do migrador serial —
                        o mesmo sinal que o score ISP persegue dentro da rede. */}
                    <p className="text-[11px] text-[var(--text-faint)] pt-1">
                      Escala de intensidade: A é a mais alta, H é ausência de rastro.
                    </p>
                  </Bloco>

                  {resultado.riscoArea?.length > 0 && (
                    <Bloco titulo="Risco da área · segurança da instalação" Icone={MapPin}>
                      {resultado.riscoArea.map((a, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 text-[13px] py-0.5">
                          <span className="text-[var(--text-2)] min-w-0 truncate">{a.endereco}</span>
                          <Tag tom={AREA_TOM(a.ponto)}>{AREA_ROTULO(a.ponto)}</Tag>
                        </div>
                      ))}
                      {/* Nenhum bureau responde isso: é risco operacional, não de crédito. */}
                      <p className="text-[11px] text-[var(--text-faint)] pt-1 leading-relaxed">
                        Classificação territorial da coordenada. Não entra no veredito de
                        crédito — serve para planejar a visita técnica e o comodato.
                      </p>
                    </Bloco>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Bloco titulo="Identidade" Icone={ShieldCheck}>
                    <Pares>
                    <Linha rotulo="Nome" valor={resultado.identidade.nome ?? "—"} />
                    <Linha rotulo="Nascimento" valor={
                      fmtData(resultado.identidade.nascimento) +
                      (resultado.identidade.idade ? " · " + resultado.identidade.idade + " anos" : "")
                    } />
                    <Linha rotulo="Nome da mãe" valor={resultado.identidade.nomeMae ?? "—"} />
                    <Linha rotulo="Situação na Receita" valor={
                      (resultado.identidade.situacaoReceita ?? "—") + " · " + fmtData(resultado.identidade.dataSituacao)
                    } alerta={!!d.taxIdStatus && d.taxIdStatus.toUpperCase() !== "REGULAR"} />
                    <Linha rotulo="Indicação de óbito" valor={d.temObito ? "Sim" : "Não"} alerta={d.temObito} />
                    <Linha rotulo="Nascimento confere" valor={d.nascimentoValidadoNaReceita === false ? "Não" : "Sim"}
                      alerta={d.nascimentoValidadoNaReceita === false} />
                    <Linha rotulo="Homônimos" valor={d.homonimos ?? 0} alerta={(d.homonimos ?? 0) >= 100} />
                    </Pares>
                  </Bloco>

                  <Bloco titulo="Renda e patrimônio" Icone={Wallet}>
                    {/* A faixa em salários mínimos não diz nada a quem decide um plano
                        de R$ 120 — o valor em reais é o que se compara. */}
                    <p className="font-mono text-[19px] font-medium tracking-[-0.02em] text-[var(--text)] tabular-nums">
                      {resultado.renda.emReais ?? "sem informação"}
                    </p>
                    {resultado.renda.faixa && resultado.renda.emReais && (
                      <p className="text-[12px] text-[var(--text-muted)]">
                        Faixa de referência: {resultado.renda.faixa}
                      </p>
                    )}
                    {/* MTE vem de registro do Ministério do Trabalho: é vínculo formal,
                        não estimativa. Quando existe, é o número mais confiável. */}
                    {resultado.renda.rendaFormal && (
                      <div className="rounded bg-[var(--ok-bg)] px-2.5 py-2 mt-1">
                        <span className="text-[11px] font-medium text-[var(--ok)]">
                          {resultado.renda.rendaFormal.fonte}
                        </span>
                        <p className="font-mono text-[13px] tabular-nums text-[var(--ok)]">
                          {resultado.renda.rendaFormal.emReais ?? resultado.renda.rendaFormal.faixa}
                        </p>
                      </div>
                    )}

                    {resultado.renda.fontes.length > 1 && (
                      <div className="pt-1 space-y-1">
                        {resultado.renda.fontes.filter(f => !f.formal).map((f, i) => (
                          <Linha key={i} rotulo={f.fonte} valor={f.emReais ?? f.faixa} />
                        ))}
                      </div>
                    )}

                    <Pares cols={1}>
                      <Linha rotulo="Patrimônio estimado" valor={
                        resultado.renda.patrimonio && resultado.renda.patrimonio !== "SEM INFORMACAO"
                          ? resultado.renda.patrimonio : "sem informação"} />
                      <Linha rotulo="Declarações de IR" valor={
                        resultado.renda.declaracoesIR.length > 0
                          ? resultado.renda.declaracoesIR.length + " anos · desde " +
                            resultado.renda.declaracoesIR[resultado.renda.declaracoesIR.length - 1].ano
                          : "nenhuma"} />
                    </Pares>

                    <div className="flex gap-1.5 flex-wrap pt-1">
                      {/* Quem some da Receita costuma ser quem some da cobrança. */}
                      {resultado.renda.declaraIrRecorrente && <Tag tom="ok">declara IR com recorrência</Tag>}
                      {resultado.renda.temSegmentoVip && <Tag tom="ok">segmento premium no banco</Tag>}
                      {resultado.renda.declaracoesIR[0]?.banco && (
                        <Tag>{resultado.renda.declaracoesIR[0].banco}</Tag>
                      )}
                    </div>

                    <p className="text-[11px] text-[var(--text-faint)] pt-1 leading-relaxed">
                      Estimativa estatística, não comprovação de renda. Nunca gera recusa —
                      apenas alerta quando não cobre a mensalidade.
                    </p>
                  </Bloco>
                  </div>

                  <Bloco titulo={"Endereços · " + resultado.enderecos.length} Icone={MapPin}>
                    {resultado.enderecos.length === 0 ? (
                      <p className="text-[13px] text-[var(--text-muted)]">
                        Nenhum endereço vinculado a este CPF.
                      </p>
                    ) : (
                      <ul className="divide-y divide-[var(--border-faint)] -my-1">
                        {resultado.enderecos.map((e, i) => (
                          <li key={i} data-testid={"endereco-" + i}
                            className="py-2.5 flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[13px] text-[var(--text)]">
                                {e.logradouro}{e.numero ? ", " + e.numero : ""}
                                {e.complemento ? " — " + e.complemento : ""}
                              </p>
                              <p className="text-[12px] text-[var(--text-muted)]">
                                {[e.bairro, e.cidade, e.uf].filter(Boolean).join(" · ")}
                                {e.cep ? " · CEP " + e.cep : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              {e.principal && <Tag>principal</Tag>}
                              <Tag tom={e.ratificado ? "ok" : "alerta"}>
                                {e.ratificado ? "ratificado" : "não ratificado"}
                              </Tag>
                              {e.naReceita && <Tag tom="ok">na Receita</Tag>}
                              {e.passagensRuins > 0 && <Tag tom="alerta">{e.passagensRuins} suspeita(s)</Tag>}
                              <span className="font-mono text-[11px] text-[var(--text-faint)] tabular-nums">
                                visto {fmtData(e.ultimaPassagem)}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Bloco>

                  <Bloco titulo={"Telefones · " + resultado.telefones.length} Icone={Phone}>
                    {resultado.telefones.length === 0 ? (
                      <p className="text-[13px] text-[var(--text-muted)]">
                        Nenhum telefone vinculado a este CPF.
                      </p>
                    ) : (
                      <ul className="divide-y divide-[var(--border-faint)] -my-1">
                        {resultado.telefones.map((t, i) => (
                          <li key={i} data-testid={"telefone-" + i}
                            className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-baseline gap-2 min-w-0">
                              <span className="font-mono text-[13px] tabular-nums text-[var(--text)]">
                                {telefoneFmt(t)}
                              </span>
                              <span className="text-[12px] text-[var(--text-muted)]">
                                {[t.tipo === "MOBILE" ? "celular" : t.tipo === "HOME" ? "fixo" : t.tipo?.toLowerCase(),
                                  t.operadora].filter(Boolean).join(" · ")}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              {t.principal && <Tag>principal</Tag>}
                              {t.ativo && <Tag tom="ok">ativo</Tag>}
                              {/* Ligar para quem está no não-perturbe expõe o provedor. */}
                              {t.naoPerturbe && <Tag tom="alerta">não perturbe</Tag>}
                              {t.passagensRuins > 0 && <Tag tom="alerta">{t.passagensRuins} suspeita(s)</Tag>}
                              <span className="font-mono text-[11px] text-[var(--text-faint)] tabular-nums">
                                visto {fmtData(t.ultimaPassagem)}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Bloco>

                  {resultado.emails.length > 0 && (
                    <Bloco titulo={"E-mails · " + resultado.emails.length} Icone={Mail}>
                      <ul className="space-y-1.5">
                        {resultado.emails.map((e, i) => (
                          <li key={i} className="font-mono text-[13px] text-[var(--text-2)] break-all">{e}</li>
                        ))}
                      </ul>
                    </Bloco>
                  )}
                </div>
              )}

              {resultado.consultasIndisponiveis > 0 && (
                <p className="text-[12px] text-[var(--text-muted)]">
                  {resultado.consultasIndisponiveis} consulta(s) adicional(is)
                  disponível(is) no seu plano — score de crédito de mercado e histórico
                  de negativação. Fale com o suporte para habilitar.
                </p>
              )}

              {resultado.consultasComFalha > 0 && (
                <p className="text-[12px] text-[var(--text-muted)]">
                  {resultado.consultasComFalha} consulta(s) não responderam. O restante do
                  resultado é válido.
                </p>
              )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "historico" && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            {consultations.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <IdCard className="w-8 h-8 mx-auto mb-4 text-[var(--text-muted)] opacity-50" />
                <h3 className="font-medium text-base text-[var(--text)]">Nenhuma consulta no histórico</h3>
                <p className="mt-2 mx-auto max-w-[52ch] text-sm text-[var(--text-muted)]">
                  As consultas aparecem aqui assim que você fizer a primeira.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[560px]">
                  <thead>
                    <tr>
                      {["Data", "CPF", "Veredito", "Datasets"].map(h => (
                        <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] px-4 py-2 border-b border-[var(--border-faint)]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {consultations.map((c: any) => {
                      const vv = VEREDITO[c.veredito as Resultado["veredito"]] ?? VEREDITO.NAO_ENCONTRADO;
                      return (
                        <tr key={c.id} className="border-b border-[var(--border-faint)] last:border-b-0"
                          data-testid={`consulta-${c.id}`}>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--text-2)]">
                            {fmtData(c.createdAt)}
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--text)]">
                            {formataCpf(c.cpfCnpj)}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center text-[10px] font-medium tracking-[0.04em] px-2 py-0.5 rounded ${vv.cls}`}>
                              {vv.rotulo}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--text-muted)]">
                            {c.datasets?.length ?? 0}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "info" && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-5 space-y-4 max-w-[760px]">
            <div>
              <h3 className="text-[15px] font-medium text-[var(--text)]">O que a Consulta Cadastral responde</h3>
              <p className="text-[13px] text-[var(--text-muted)] mt-1 leading-relaxed">
                A Consulta ISP diz se o CPF deve para algum provedor da rede. A Cadastral
                responde as duas perguntas que vêm antes: esse CPF existe e é utilizável, e
                essa pessoa tem vínculo com o endereço que informou.
              </p>
            </div>
            <div className="border-t border-[var(--border-faint)] pt-4">
              <h3 className="text-[15px] font-medium text-[var(--text)]">Como o veredito é formado</h3>
              <Pares cols={1}>
                <Linha rotulo="Recusar" valor="CPF fora de REGULAR, ou óbito" />
                <Linha rotulo="Atenção" valor="cobrança, execução, endereço ou renda" />
                <Linha rotulo="Aprovar" valor="nenhum sinal acima" />
              </Pares>
              <p className="text-[12px] text-[var(--text-faint)] mt-2 leading-relaxed">
                Renda estimada nunca gera recusa — só alerta. Negar serviço por estimativa
                estatística é decisão que a LGPD dá ao titular o direito de contestar.
              </p>
            </div>
            <div className="border-t border-[var(--border-faint)] pt-4">
              <h3 className="text-[15px] font-medium text-[var(--text)]">Fonte dos dados</h3>
              <p className="text-[13px] text-[var(--text-muted)] mt-1 leading-relaxed">
Bases públicas e cadastrais consolidadas, com credencial própria do seu
                provedor — o consumo e o custo ficam separados por provedor. Cada
                consulta usa 1 crédito.
              </p>
            </div>
          </div>
        )}

        <LgpdDisclaimerModal
          open={lgpdDisclaimerOpen}
          accepted={lgpdAccepted}
          onAccept={handleLgpdAcceptAndSearch}
          onCancel={() => { setLgpdDisclaimerOpen(false); setPendingSearchPayload(null); }}
          onToggle={setLgpdAccepted}
        />

      </div>
    </div>
  );
}
