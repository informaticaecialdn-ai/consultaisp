import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { IdCard, Settings2, AlertTriangle, CreditCard } from "lucide-react";
import LoadingCard from "@/components/consulta/LoadingCard";
import ConsultaIdleState from "@/components/consulta/ConsultaIdleState";
import ConsultaSearchBar from "@/components/consulta/ConsultaSearchBar";
import LgpdDisclaimerModal from "@/components/consulta/LgpdDisclaimerModal";
import CadastralResultReport from "@/components/consulta/CadastralResultReport";
import type { ResultadoCadastral } from "@/components/consulta/cadastral-tipos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * O tipo do resultado mora em `cadastral-tipos.ts`, nao aqui.
 *
 * Ele estava declarado nesta pagina e o relatorio e o PDF redeclaravam a
 * propria copia. Foi assim que `patrimonio`, `vizinhos` e `percentualBeneficio`
 * seguiram na tela depois de a rota parar de envia-los: TypeScript nao acusa
 * campo que existe no tipo local e nao existe na resposta — so o runtime
 * acusa, e la vira tela quebrada.
 */
type Resultado = ResultadoCadastral;
type Processo = NonNullable<ResultadoCadastral["processos"]>[number];

/**
 * Formatador de data. Nome distinto de `data` para nao colidir com o
 * `const { data }` do useQuery dentro do componente.
 *
 * A BigData devolve tanto "2026-03-18" quanto "2026-03-18T00:00:00Z". `new
 * Date()` lê os dois como meia-noite UTC, e o Brasil (UTC-3) renderizava o dia
 * anterior — uma negativação de 18/03 aparecia como 17/03. Com data de
 * negativação e de consulta na tela isso deixou de ser cosmético, então a parte
 * de data é lida literalmente, sem passar por fuso.
 */
const fmtData = (s?: string | null) => {
  if (!s) return "—";
  const soData = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (soData) return `${soData[3]}/${soData[2]}/${soData[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
};


type Tom = "ok" | "alerta" | "perigo" | "marca" | "neutro";





/**
 * Uma linha do Resumo da consulta.
 *
 * `nada` — verificado, nada consta (o estado que constrói confiança);
 * `consta` — verificado, há ocorrência;
 * `atencao` — verificado, ocorrência que pede cautela mas não trava;
 * `fora` — a verificação existe, mas o nível consultado não a cobre.
 * O quarto estado é o que a tela antiga não tinha: ausência de dado e
 * "não perguntei" apareciam iguais.
 */
type LinhaResumo = {
  categoria: string;
  estado: "nada" | "consta" | "atencao" | "fora";
  resultado: string;
  valor?: string;
  ultimo?: string;
};



















type Integracao = {
  configurado: boolean; login: string | null; senhaMascarada: string | null;
  isEnabled: boolean; lastCheckStatus: string | null;
};

/**
 * `chamada` e o texto do chip — imperativo, do mockup: diz o que FAZER, nao
 * classifica. "Contrate com cautela" instrui; "Atenção" so rotula.
 */


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

/**
 * Dígitos do documento. O teto e 14, nao 11: cortar em 11 truncava todo CNPJ
 * digitado — o campo aceitava a digitacao e mandava para o servidor um numero
 * mutilado, que voltava como "documento invalido".
 */
const soDigitos = (v: string) => v.replace(/\D/g, "").slice(0, 14);

/** Mascara de CPF ou CNPJ, decidida pelo comprimento. */
const formataCpf = (v: string) => {
  const n = soDigitos(v);
  if (n.length > 11) {
    return n
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }
  return n
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};

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

type Nivel = { id: string; rotulo: string; descricao: string; creditos: number };


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
  // A lista de contato mostra 4 telefones; o resto fica atrás de um clique,
  // como no mockup — nove linhas de telefone empurram o resto da tela pra baixo.
  const [verTodosFones, setVerTodosFones] = useState(false);
  // Nível escolhido para a próxima busca. Volta ao padrão a cada carga da tela:
  // deixar Premium "grudado" faria o operador gastar 17 créditos sem perceber.
  const [nivel, setNivel] = useState("padrao");

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
        // O servidor decide quantos créditos isso custa — aqui só vai o nome.
        nivel: payload.nivel ?? nivel,
        // Endereço de instalação: a barra de busca já coletava estes campos e
        // esta chamada não os enviava, então o painel "Verificar também por
        // endereço de instalação" existia e não fazia nada. São eles que ligam
        // o cruzamento de domicílio — parente morando no imóvel da instalação.
        addressStreet: payload.addressStreet,
        addressNumber: payload.addressNumber,
        addressComplement: payload.addressComplement,
        addressNeighborhood: payload.addressNeighborhood,
        addressCity: payload.addressCity,
        addressState: payload.addressState,
        addressZip: payload.addressZip,
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
    // Congela o nível aqui: entre abrir o modal de LGPD e aceitar, o operador
    // pode mexer no seletor, e o que ele viu ao clicar em Consultar é o que vale.
    payload = { ...payload, nivel };
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
                {/* O seletor de profundidade saiu.
                    A Completa cobrava 4 créditos por quatro datasets de parceiro
                    que a conta NÃO tem habilitados — medido contra a API da
                    BigDataCorp em 27/08/2026, os quatro respondem -109 DATASET
                    NOT AVAILABLE. O provedor pagava o quádruplo e recebia
                    exatamente o mesmo que na Padrão.
                    Para reativar: habilitar os datasets no BDC Center, tirar o
                    `const nivel = NIVEL_PADRAO` de server/routes/bigdata.routes.ts
                    e voltar o seletor (está no git, neste commit). A tabela
                    NIVEIS do backend continua com a Completa definida. */}

                {/* Copy própria: a barra é compartilhada com a Consulta ISP, e os
                    textos padrão dela falam de rede ISP e ERP de parceiros — que
                    não é a origem de nada aqui. Sem isto a tela mentiria sobre a
                    procedência do dado e sobre o preço. */}
                <ConsultaSearchBar
                  onSearch={handleSearch}
                  isLoading={mutation.isPending}
                  hasResult={!!resultado}
                  onClear={handleClear}
                  inputTestId="input-consulta-search"
                  kicker="Nova consulta · CPF ou CNPJ"
                  selo="Bureau de dados cadastrais"
                  custos={["Consulta · 1 crédito"]}
                  notaLegal="Consulta registrada para auditoria · LGPD art. 7º, X — proteção ao crédito"
                />

                {mutation.isPending && (
                  <LoadingCard
                    titulo="Consultando dados cadastrais..."
                    subtitulo="Aguarde, conferindo situação do CPF, endereço e restrições"
                    etapas={ETAPAS_CADASTRAL}
                  />
                )}

                {/* Sem a tira de métricas: saldo já aparece no seletor de nível
                    e no topo; contagem do dia/mês vive no Histórico. */}
                {!mutation.isPending && !resultado && (
                  <ConsultaIdleState
                    totalConsultas={consultations.length}
                    emptyTitle="Nenhuma consulta ainda"
                    emptyDescription="Digite o CPF do candidato antes de liberar a instalação. Você recebe a situação na Receita, o vínculo com o endereço, a renda estimada e o histórico de inadimplência."
                    emptyCta="FAZER PRIMEIRA CONSULTA"
                    searchInputTestId="input-consulta-search"
                  />
                )}

                {!mutation.isPending && resultado && (
                  <CadastralResultReport
                    r={resultado}
                    onGeneratePDF={() => window.print()}
                  />
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
