import { useState } from "react";
import { CUSTO_EM_CREDITOS } from "@shared/schema";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import "./consulta-spc.css";
import IdentificacaoConsulta from "@/components/consulta/IdentificacaoConsulta";
import ConsultaErroCard from "@/components/consulta/ConsultaErroCard";
import { ProvTag } from "@/components/consulta/report-ui";
import {
  lerIdentificacao, lerErroDeConsulta, normalizarCodigo,
  type IdentificacaoDaConsulta, type ErroDeConsulta,
} from "@/components/consulta/identificacao";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  TrendingUp,
  CalendarDays,
  CheckCircle,
  BarChart3,
  Info,
  Clock,
  FileText,
  CreditCard,
  AlertTriangle,
  Shield,
  User,
  Building2,
  ClipboardCopy,
  XCircle,
  Scale,
  Eye,
  Target,
} from "lucide-react";

interface SpcResult {
  cpfCnpj: string;
  /** `CI-2609-K7F3M2` — a consulta AQUI. Ausente nas gravadas antes desta versão. */
  consultaId?: string | null;
  /** O protocolo do SPC Brasil, já emparelhado com quem o emitiu. */
  protocoloDaOrigem?: { origem: string; protocolo: string } | null;
  /** O mesmo número do SPC, cru — como a rota o devolve desde antes. */
  protocolo?: string | null;
  consultadoEm?: string | null;
  cadastralData: {
    nome: string;
    cpfCnpj: string;
    dataNascimento?: string;
    dataFundacao?: string;
    nomeMae?: string;
    situacaoRf: string;
    obitoRegistrado: boolean;
    tipo: "PF" | "PJ";
    endereco?: string;
    cidade?: string;
    uf?: string;
  };
  /** null quando o produto SPC contratado não devolve score. */
  score: number | null;
  scoreFonte?: string;
  scoreDetalhe?: { indiceRisco?: string; classe?: string; probabilidade?: number };
  riskLevel: string;
  riskLabel: string;
  recommendation: string;
  status: string;
  restrictions: {
    type: string;
    description: string;
    severity: string;
    creditor: string;
    value: string;
    date: string;
    origin: string;
    contrato?: string;
    vencimento?: string;
    papel?: string;
    /** Todos os dados do registro, com rótulo, na ordem da tela. */
    detalhes?: Array<{ rotulo: string; valor: string }>;
  }[];
  totalRestrictions: number;
  previousConsultations: {
    total: number;
    last90Days: number;
    diasConsiderados?: number | null;
    bySegment: Record<string, number>;
    lista?: Array<{ associado: string; entidade?: string; cidade?: string; uf?: string; data: string }>;
  };
  pendenciasFinanceiras?: Array<{ origem: string; titulo: string; contrato?: string; data: string; valor: number; cidade?: string; avalista: boolean }>;
  alerts: { type: string; message: string; severity: string }[];
  rendaPresumida?: number | null;
  limiteCreditoSugerido?: number | null;
  /** true só na instância de demonstração — a tela mostra o selo "SIMULADO". */
  simulado?: boolean;
}

/** "2024-03-12" -> "12/03/2024" sem passar por Date: new Date("2024-03-12") cai no dia anterior no fuso -3. */
function dataBr(iso?: string | null): string {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

function formatCpfCnpj(value: string): string {
  const cleaned = value.replace(/\D/g, "");
  if (cleaned.length <= 11) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, (_, a, b, c, d) =>
      d ? `${a}.${b}.${c}-${d}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a
    );
  }
  return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, (_, a, b, c, d, e) =>
    e ? `${a}.${b}.${c}/${d}-${e}` : d ? `${a}.${b}.${c}/${d}` : c ? `${a}.${b}.${c}` : b ? `${a}.${b}` : a
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, (score / 1000) * 100));
  let color = "from-rose-500 to-rose-600";
  if (score >= 901) color = "from-emerald-400 to-emerald-600";
  else if (score >= 701) color = "from-emerald-500 to-emerald-600";
  else if (score >= 501) color = "from-amber-400 to-amber-600";
  else if (score >= 301) color = "from-orange-400 to-orange-600";

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between">
        <span className="text-4xl font-bold" data-testid="text-spc-score-value">{score}</span>
        <span className="text-sm text-muted-foreground">/1000</span>
      </div>
      <div className="w-full bg-muted h-3 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-1000`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>0</span>
        <span>300</span>
        <span>500</span>
        <span>700</span>
        <span>900</span>
        <span>1000</span>
      </div>
    </div>
  );
}

export default function ConsultaSPCPage() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SpcResult | null>(null);
  /* O identificador é da REQUISIÇÃO, e a resposta o traz até no erro — por isso
     ele não mora dentro de `result`, que só existe quando a consulta deu certo. */
  const [identificacao, setIdentificacao] = useState<IdentificacaoDaConsulta | null>(null);
  const [erro, setErro] = useState<ErroDeConsulta | null>(null);
  const [aba, setAba] = useState("nova");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/spc-consultations"],
  });

  const mutation = useMutation({
    mutationFn: async (cpfCnpj: string) => {
      const res = await apiRequest("POST", "/api/spc-consultations", { cpfCnpj });
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data.result);
      // "SPC Brasil" é a origem padrão: enquanto a rota não mandar o par pronto,
      // o `protocolo` cru que ela já devolvia continua identificado na tela.
      setIdentificacao(lerIdentificacao(data, "SPC Brasil"));
      setErro(null);
      queryClient.invalidateQueries({ queryKey: ["/api/spc-consultations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Consulta realizada", description: "Consulta SPC processada com sucesso" });
    },
    onError: (err: any) => {
      // O desembrulho do "503: {json}" que morava aqui virou `lerErroDeConsulta`,
      // compartilhado com as outras duas telas — e ele traz também o código da
      // consulta que falhou, que é o que o provedor leva ao suporte.
      const falha = lerErroDeConsulta(err);
      setResult(null);
      setIdentificacao(null);
      setErro(falha);
      toast({
        title: "Consulta não realizada",
        description: falha.consultaId ? `${falha.mensagem} · ${falha.consultaId}` : falha.mensagem,
        variant: "destructive",
      });
    },
  });

  // O resultado gravado (sem o XML cru) volta à tela: o provedor pagou por ele.
  const abrirDoHistorico = (c: any) => {
    if (!c?.result) return;
    setResult(c.result as SpcResult);
    // O código vem da LINHA, não do `result`: quem guarda `consulta_id` é a
    // tabela. Sem isto o relatório reaberto do histórico apareceria sem número.
    setIdentificacao(lerIdentificacao(c, "SPC Brasil"));
    setErro(null);
    setQuery(formatCpfCnpj(c.cpfCnpj ?? ""));
    setAba("nova");
  };

  const handleSearch = () => {
    if (!query.trim()) return;
    mutation.mutate(query);
  };

  const getDetectedType = (val: string) => {
    const cleaned = val.replace(/\D/g, "");
    if (cleaned.length === 11) return "CPF";
    if (cleaned.length === 14) return "CNPJ";
    return null;
  };

  const detectedType = getDetectedType(query);

  const riskColors: Record<string, string> = {
    very_low: "bg-[var(--color-success-bg)] text-[var(--color-success)]",
    low: "bg-[var(--color-success-bg)] text-[var(--color-success)]",
    medium: "bg-[var(--color-gold-bg)] text-[var(--color-gold)]",
    high: "bg-[var(--color-gold-bg)] text-[var(--score-low)]",
    very_high: "bg-[var(--color-danger-bg)] text-rose-800",
  };

  const severityColors: Record<string, string> = {
    medium: "bg-[var(--color-gold-bg)] text-[var(--color-gold)] border-amber-200",
    high: "bg-[var(--color-danger-bg)] text-[var(--color-danger)] border-rose-200",
    critical: "bg-[var(--color-danger-bg)] text-[var(--color-danger)] border-red-300",
  };

  const severityLabels: Record<string, string> = {
    medium: "Media",
    high: "Alta",
    critical: "Critica",
  };

  return (
    <div className="spc-page" data-testid="consulta-spc-page">
      <header className="spc-hero">
        <div className="spc-hero-main"><span className="spc-symbol"><BarChart3 size={26}/></span><div><span className="spc-kicker">ANÁLISE DE CRÉDITO · CONSULTA ISP</span><h1 data-testid="text-consulta-spc-title">Consulta SPC</h1><p>Informações do SPC Brasil para apoiar sua análise.</p></div></div>
        <div className="spc-balance"><CreditCard size={19}/><div><span>Seu saldo</span><strong data-testid="text-spc-credits">{data?.credits ?? "—"} <small>créditos</small></strong></div></div>
      </header>
      <div className="spc-activity"><span><TrendingUp size={14}/>Hoje <strong data-testid="text-spc-today">{isLoading ? "—" : data?.todayCount ?? "—"}</strong></span><span><CalendarDays size={14}/>Neste mês <strong data-testid="text-spc-month">{isLoading ? "—" : data?.monthCount ?? "—"}</strong></span><span className="spc-source"><Shield size={14}/>Fonte: SPC Brasil</span></div>

      <Tabs value={aba} onValueChange={setAba} className="space-y-4">
        <TabsList className="spc-tabs">
          <TabsTrigger value="nova" className="gap-1.5" data-testid="tab-spc-nova">
            <Search className="w-4 h-4" />
            Consultar documento
          </TabsTrigger>
          <TabsTrigger value="historico" className="gap-1.5" data-testid="tab-spc-historico">
            <Clock className="w-3.5 h-3.5" />
            Histórico
          </TabsTrigger>
          <TabsTrigger value="info" className="gap-1.5">
            <Info className="w-3.5 h-3.5" />
            Guia de leitura
          </TabsTrigger>
        </TabsList>

        <TabsContent value="nova" className="spc-new">
          <Card className="spc-consultation">
            <div className="spc-search-heading"><div><span className="spc-kicker">SPC MIX TOP +</span><h2>Quem você deseja consultar?</h2><p>Informe o CPF da pessoa ou o CNPJ da empresa.</p></div><span className="spc-cost"><b>{CUSTO_EM_CREDITOS.spc}</b> créditos por consulta</span></div>
            <label htmlFor="spc-documento" className="spc-field-label">CPF ou CNPJ</label>
            <div className="spc-search-controls">
              <div className="relative flex-1">
                <Input
                  id="spc-documento" inputMode="numeric" autoComplete="off" data-testid="input-spc-search"
                  placeholder="Digite CPF ou CNPJ"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pr-10"
                />
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    navigator.clipboard.readText().then((text) => {
                      if (text) setQuery(text);
                    }).catch(() => {});
                  }}
                  aria-label="Colar CPF ou CNPJ" title="Colar da área de transferência"
                  data-testid="button-spc-paste"
                >
                  <ClipboardCopy className="w-4 h-4" />
                </button>
              </div>
              <Button variant="ghost" onClick={() => { setQuery(""); setResult(null); setErro(null); setIdentificacao(null); }} data-testid="button-clear-spc">
                Limpar
              </Button>
              <Button
                onClick={handleSearch}
                disabled={!query.trim() || mutation.isPending}
                className="spc-search-button"
                data-testid="button-consultar-spc"
              >
                {mutation.isPending ? "Consultando..." : "Consultar SPC"}
              </Button>
            </div>

            {detectedType && (
              <div className="mt-2 flex items-center gap-1.5" data-testid="text-spc-detected-type">
                <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />
                <span className="text-sm font-medium text-[var(--color-success)]">{detectedType} detectado</span>
              </div>
            )}

            <div className="spc-search-note"><Shield size={15}/><span>Consulta ao produto SPC MIX TOP + · <strong>{CUSTO_EM_CREDITOS.spc} créditos</strong> por consulta. Score e informações adicionais dependem do produto contratado.</span></div>
            {mutation.isPending && <div className="spc-loading" role="status" aria-label="Consultando SPC Brasil"><p>Buscando informações no SPC Brasil…</p><Skeleton className="h-5 w-2/3"/><Skeleton className="h-20 w-full"/></div>}

            {!mutation.isPending && erro && (
              <div className="mt-6">
                <ConsultaErroCard erro={erro} testId="consulta-spc-erro" />
              </div>
            )}

            {!mutation.isPending && !result && !erro && <div className="spc-included"><h3>Informações para uma análise mais completa</h3><div>{[
              { icon: User, title: "Identificação cadastral", text: "Nome, documento e situação cadastral retornados na consulta." },
              { icon: Shield, title: "Restrições e ocorrências", text: "Registros, credores, valores e detalhes disponíveis no produto." },
              { icon: Clock, title: "Histórico de consultas", text: "Consultas anteriores ao documento e identificação da origem." },
            ].map(item => <section key={item.title}><item.icon size={20}/><h4>{item.title}</h4><p>{item.text}</p></section>)}</div><p className="spc-included-foot">Já consultou este documento? Reabra o resultado salvo em <button onClick={() => setAba("historico")}>Histórico</button>.</p></div>}

            {result && (
              <div className="spc-report" data-testid="spc-result">
                <div className="border rounded-lg overflow-hidden">
                  <div className="spc-report-header">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <BarChart3 className="w-5 h-5" />
                        <div>
                          <h3 className="text-lg font-semibold">Relatório SPC · {result.cadastralData.tipo === "PF" ? "CPF" : "CNPJ"}: {formatCpfCnpj(result.cpfCnpj)}</h3>
                          {/* O protocolo do SPC saiu daqui: em 12px branco sobre
                              a faixa da marca ele era decoração, e é um número
                              para ser lido e ditado. Desceu para o bloco de
                              Identificação, ao lado do código desta consulta. */}
                          <p className="text-sm text-white/70">
                            SPC Brasil
                            {result.consultadoEm ? <> · {new Date(result.consultadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</> : null}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {result.simulado && <ProvTag kind="simulado" />}
                        <Badge className={`border-0 ${result.status === "clean" ? "bg-[var(--color-success)] text-white" : "bg-rose-500 text-white"}`}>
                          {result.status === "clean" ? "Sem restrições" : "Com restrições"}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="spc-report-body space-y-6">
                    <nav className="spc-report-nav" aria-label="Seções do relatório SPC"><a href="#spc-cadastro">Dados cadastrais</a><a href="#spc-analise">Análise de crédito</a>{result.restrictions.length > 0 && <a href="#spc-restricoes">Restrições ({result.restrictions.length})</a>}</nav>
                    <IdentificacaoConsulta
                      consultaId={identificacao?.consultaId}
                      protocoloDaOrigem={identificacao?.protocoloDaOrigem}
                      testIdPrefixo="identificacao-spc"
                    />

                    <Card id="spc-cadastro" className="spc-report-section p-4">
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <User className="w-4 h-4" />
                        Dados Cadastrais
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Nome:</span>
                          <p className="font-medium" data-testid="text-spc-nome">{result.cadastralData.nome}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{result.cadastralData.tipo === "PF" ? "CPF" : "CNPJ"}:</span>
                          <p className="font-medium">{formatCpfCnpj(result.cadastralData.cpfCnpj)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{result.cadastralData.tipo === "PF" ? "Nascimento" : "Fundacao"}:</span>
                          <p className="font-medium">{dataBr(result.cadastralData.dataNascimento || result.cadastralData.dataFundacao) || "—"}</p>
                        </div>
                        {result.cadastralData.nomeMae && (
                          <div>
                            <span className="text-muted-foreground">Nome da Mae:</span>
                            <p className="font-medium">{result.cadastralData.nomeMae}</p>
                          </div>
                        )}
                        <div>
                          <span className="text-muted-foreground">Situacao RF:</span>
                          <p className="font-medium flex items-center gap-1.5">
                            {/^(regular|ativa)$/i.test(result.cadastralData.situacaoRf ?? "") ? (
                              <><CheckCircle className="w-3.5 h-3.5 text-[var(--color-success)]" /> <span className="text-[var(--color-success)]">Regular</span></>
                            ) : (
                              <><XCircle className="w-3.5 h-3.5 text-rose-500" /> <span className="text-[var(--color-danger)]">{result.cadastralData.situacaoRf || "Não informada"}</span></>
                            )}
                          </p>
                        </div>
                        {result.cadastralData.obitoRegistrado && (
                          <div>
                            <span className="text-muted-foreground">Obito:</span>
                            <p className="font-medium text-[var(--color-danger)] flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5" /> Registrado
                            </p>
                          </div>
                        )}
                      </div>
                    </Card>

                    <div id="spc-analise" className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card className="p-4">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                          <BarChart3 className="w-4 h-4" />
                          Score de Credito
                        </h4>
                        {result.score != null ? (
                          <ScoreBar score={result.score} />
                        ) : (
                          <p className="text-sm text-muted-foreground" data-testid="text-spc-sem-score">
                            O produto contratado não devolve score. O veredito abaixo sai das restrições encontradas.
                          </p>
                        )}
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <Badge className={`${riskColors[result.riskLevel]} border-0`} data-testid="text-spc-risk">
                            {result.riskLabel}
                          </Badge>
                          {result.scoreDetalhe?.indiceRisco && (
                            <span className="text-xs text-muted-foreground">índice SPC: {result.scoreDetalhe.indiceRisco}</span>
                          )}
                          {result.rendaPresumida != null && (
                            <span className="text-xs text-muted-foreground">renda presumida R$ {result.rendaPresumida.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                          )}
                        </div>
                      </Card>

                      <Card className="p-4">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                          <Target className="w-4 h-4" />
                          Análise do Consulta ISP
                        </h4>
                        <div className="flex flex-col gap-3">
                          <p className="text-lg font-semibold" data-testid="text-spc-recommendation">{result.recommendation}</p>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="p-2 bg-muted/50 rounded">
                              <span className="text-muted-foreground">Restricoes:</span>
                              <p className="font-bold text-lg">{result.restrictions.length}</p>
                            </div>
                            <div className="p-2 bg-muted/50 rounded">
                              <span className="text-muted-foreground">Total Dividas:</span>
                              <p className="font-bold text-lg">R$ {result.totalRestrictions.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                            </div>
                          </div>
                        </div>
                      </Card>
                    </div>

                    {result.restrictions.length > 0 && (
                      <Card id="spc-restricoes" className="spc-report-section p-4">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[var(--color-danger)]">
                          <AlertTriangle className="w-4 h-4" />
                          Restricoes Encontradas: {result.restrictions.length}
                        </h4>
                        <div className="space-y-2">
                          {result.restrictions.map((r, i) => (
                            <div
                              key={i}
                              className="spc-restriction space-y-2"
                              data-testid={`restriction-${i}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <Badge className={`${severityColors[r.severity]} border text-xs`}>
                                    {r.type.replace(/_/g, " ")}
                                  </Badge>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium">{r.creditor}</p>
                                    <p className="text-xs text-muted-foreground">{r.description}</p>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-sm font-semibold tabular-nums">R$ {parseFloat(r.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                                  <p className="text-xs text-muted-foreground tabular-nums">{dataBr(r.date)}</p>
                                  <Badge variant="outline" className="text-xs mt-0.5">{severityLabels[r.severity]}</Badge>
                                </div>
                              </div>
                              {/* Tudo que o SPC devolveu sobre o registro: e com isto que o
                                  operador cobra ou confere com o cliente. */}
                              {(r.detalhes?.length ?? 0) > 0 && (
                                <details className="spc-restriction-details"><summary>Detalhes do registro</summary><dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5 text-xs border-t border-[var(--border-faint)] pt-2" data-testid={`restriction-${i}-detalhes`}>
                                  {r.detalhes!.map((d, j) => (
                                    <div key={j} className="min-w-0">
                                      <dt className="text-muted-foreground">{d.rotulo}</dt>
                                      <dd className="font-medium tabular-nums break-words">{d.valor}</dd>
                                    </div>
                                  ))}
                                </dl></details>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 p-3 bg-rose-50 dark:bg-rose-950/20 rounded-lg flex items-center justify-between">
                          <span className="text-sm font-semibold text-[var(--color-danger)]">Total em Restricoes:</span>
                          <span className="text-lg font-bold text-[var(--color-danger)]">R$ {result.totalRestrictions.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                        </div>
                      </Card>
                    )}

                    {result.status === "clean" && (
                      <Card className="p-5 bg-[var(--color-success-bg)] border-[var(--color-success)] text-center">
                        <Shield className="w-10 h-10 mx-auto mb-2 text-[var(--color-success)]" />
                        <p className="text-lg font-semibold text-[var(--color-success)]">Nenhuma restricao encontrada</p>
                        <p className="text-sm text-[var(--color-success)] mt-1">Nenhuma restrição foi retornada para este documento nesta consulta.</p>
                      </Card>
                    )}

                    <Card className="p-4">
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Eye className="w-4 h-4" />
                        Quem consultou este documento (últimos {result.previousConsultations.diasConsiderados ?? 90} dias): {result.previousConsultations.total}
                      </h4>
                      <div className="space-y-1">
                        {(result.previousConsultations.lista ?? []).map((c, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm" data-testid={`spc-consulta-anterior-${i}`}>
                            <div>
                              <span className="font-medium">{c.associado}</span>
                              {(c.cidade || c.uf) && <span className="text-xs text-muted-foreground ml-2">{[c.cidade, c.uf].filter(Boolean).join(" / ")}</span>}
                            </div>
                            <span className="text-xs text-muted-foreground tabular-nums">{c.data ? new Date(c.data + "T12:00:00").toLocaleDateString("pt-BR") : ""}</span>
                          </div>
                        ))}
                        {result.previousConsultations.total === 0 && (
                          <p className="text-sm text-muted-foreground">Nenhuma consulta de outro associado no período.</p>
                        )}
                      </div>
                    </Card>

                    {result.alerts.length > 0 && (
                      <Card className="p-4 bg-[var(--color-gold-bg)] border-[var(--color-gold)]/20">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[var(--color-gold)]">
                          <AlertTriangle className="w-4 h-4" />
                          Alertas Especiais
                        </h4>
                        <div className="space-y-2">
                          {result.alerts.map((alert, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm" data-testid={`spc-alert-${i}`}>
                              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${alert.severity === "critical" ? "bg-rose-500" : alert.severity === "high" ? "bg-orange-500" : "bg-amber-500"}`} />
                              <span className="text-amber-900 dark:text-amber-200">{alert.message}</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="historico">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Histórico de consultas SPC</h2>
            {data?.consultations?.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Nenhuma consulta SPC realizada ainda</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data?.consultations?.map((c: any) => {
                  const resultData = c.result as any;
                  const riskLevel = resultData?.riskLevel || (c.score >= 700 ? "low" : c.score >= 500 ? "medium" : "high");
                  const statusLabel = resultData?.status === "clean" ? "Limpo" : resultData?.restrictions?.length > 0 ? `${resultData.restrictions.length} restricoes` : "Com restricoes";
                  // Consulta anterior a esta versão não tem código: traço, nunca um inventado.
                  const codigo = normalizarCodigo(c.consultaId);
                  return (
                    <div
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      title="Abrir o resultado desta consulta"
                      className="spc-history-row cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
                      onClick={() => abrirDoHistorico(c)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirDoHistorico(c); } }}
                      data-testid={`spc-consultation-${c.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${resultData?.status === "clean" ? "bg-[var(--color-success)]" : "bg-rose-500"}`} />
                        <div>
                          <span className="text-sm font-medium">{formatCpfCnpj(c.cpfCnpj)}</span>
                          {resultData?.cadastralData?.nome && (
                            <span className="text-xs text-muted-foreground ml-2">{resultData.cadastralData.nome}</span>
                          )}
                          <div
                            className={`font-mono tabular-nums text-[11.5px] ${codigo ? "text-[var(--text-2)]" : "text-[var(--text-faint)]"}`}
                            data-testid={`spc-consultation-${c.id}-consulta-id`}
                          >
                            {codigo ?? "—"}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">{c.score != null ? `Score: ${c.score}/1000` : "Sem score"}</span>
                        <Badge className={`${riskColors[riskLevel] || "bg-muted"} border-0 text-xs`}>
                          {statusLabel}
                        </Badge>
                        {resultData?.creditosCobrados != null && (
                          <Badge variant="outline" className="text-xs tabular-nums">-{resultData.creditosCobrados} créditos</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-BR") : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="info">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Sobre a Consulta SPC</h2>
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>A consulta apresenta os dados devolvidos pelo produto SPC contratado. A ausência de uma informação não significa valor zero. Confira a data, o protocolo e o contexto dos registros antes de decidir.</p>

              <div>
                <h3 className="font-semibold text-foreground mb-2">Faixas de leitura do Consulta ISP (quando há score)</h3>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-rose-600" />
                      <span className="text-xs font-medium text-foreground">0-300</span>
                    </div>
                    <p className="text-xs">Risco Muito Alto</p>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-orange-500" />
                      <span className="text-xs font-medium text-foreground">301-500</span>
                    </div>
                    <p className="text-xs">Risco Alto</p>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-amber-500" />
                      <span className="text-xs font-medium text-foreground">501-700</span>
                    </div>
                    <p className="text-xs">Risco Medio</p>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-[var(--color-success)]" />
                      <span className="text-xs font-medium text-foreground">701-900</span>
                    </div>
                    <p className="text-xs">Risco Baixo</p>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full bg-[var(--color-success)]" />
                      <span className="text-xs font-medium text-foreground">901-1000</span>
                    </div>
                    <p className="text-xs">Risco Muito Baixo</p>
                  </Card>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-2">Tipos de Restricoes</h3>
                <div className="space-y-1">
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-[var(--color-gold-bg)] text-[var(--color-gold)] border-amber-200 border text-xs">PEFIN</Badge>
                      <span>Pendencia Financeira</span>
                    </div>
                    <span className="text-amber-600 font-medium">Media</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-[var(--color-danger-bg)] text-[var(--color-danger)] border-rose-200 border text-xs">REFIN</Badge>
                      <span>Restricao Financeira</span>
                    </div>
                    <span className="text-rose-600 font-medium">Alta</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-[var(--color-danger-bg)] text-[var(--color-danger)] border-rose-200 border text-xs">CCF</Badge>
                      <span>Cheque sem Fundo</span>
                    </div>
                    <span className="text-rose-600 font-medium">Alta</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-[var(--color-danger-bg)] text-[var(--color-danger)] border-rose-200 border text-xs">Protesto</Badge>
                      <span>Titulo protestado em cartorio</span>
                    </div>
                    <span className="text-rose-600 font-medium">Alta</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-[var(--color-danger-bg)] text-[var(--color-danger)] border-red-300 border text-xs">Acao Judicial</Badge>
                      <span>Processo de cobranca</span>
                    </div>
                    <span className="text-red-700 font-medium">Muito Alta</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-[var(--color-danger-bg)] text-[var(--color-danger)] border-red-300 border text-xs">Falencia</Badge>
                      <span>Processo falimentar</span>
                    </div>
                    <span className="text-red-700 font-medium">Critica</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-foreground mb-2">Fluxo Recomendado</h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <span className="font-bold text-blue-600">1.</span>
                    <div>
                      <p className="font-medium text-foreground">Consulta ISP (rapida e barata)</p>
                      <p className="text-xs">Verifique o histórico em provedores e o contexto de eventuais pendências.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg">
                    <span className="font-bold text-[var(--color-brand)]">2.</span>
                    <div>
                      <p className="font-medium text-foreground">Consulta SPC (completa)</p>
                      <p className="text-xs">Confirma a negativação formal no SPC: registros de inadimplência, cheques devolvidos e quem consultou. Sem score neste produto.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-[var(--color-success-bg)] rounded-lg">
                    <span className="font-bold text-[var(--color-success)]">3.</span>
                    <div>
                      <p className="font-medium text-foreground">Decisao Final</p>
                      <p className="text-xs">Use os registros como apoio à política de crédito do seu provedor. A análise exibida pelo Consulta ISP não é uma aprovação concedida pelo SPC.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
