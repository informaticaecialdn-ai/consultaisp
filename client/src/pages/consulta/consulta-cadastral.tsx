import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { IdCard, Search, MapPin, Wallet, ShieldCheck, Settings2, Phone, Mail } from "lucide-react";
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
  datasetsComFalha: string[];
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
  dados: {
    encontrado: boolean; taxIdStatus?: string; temObito?: boolean;
    nascimentoValidadoNaReceita?: boolean; homonimos?: number;
    badAddressPassages?: number; faixaRenda?: string;
  };
};

const data = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString("pt-BR") : "—";

const telefoneFmt = (t: Telefone) => {
  const n = t.numero.replace(/\D/g, "");
  const corpo = n.length >= 9 ? `${n.slice(0, n.length - 4)}-${n.slice(-4)}` : n;
  return t.ddd ? `(${t.ddd}) ${corpo}` : corpo;
};

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

const VEREDITO: Record<Resultado["veredito"], { rotulo: string; cls: string; nota: string }> = {
  APROVAR:        { rotulo: "Aprovar",         cls: "bg-[var(--ok-bg)] text-[var(--ok)]",         nota: "Nenhum sinal de risco cadastral" },
  ATENCAO:        { rotulo: "Atenção",         cls: "bg-[var(--gated-bg)] text-[var(--gated)]",   nota: "Contrate com cautela — veja os motivos" },
  RECUSAR:        { rotulo: "Recusar",         cls: "bg-[var(--danger-bg)] text-[var(--danger)]", nota: "Impedimento cadastral na Receita Federal" },
  NAO_ENCONTRADO: { rotulo: "Não encontrado",  cls: "bg-[var(--surface-inset)] text-[var(--text-muted)]", nota: "Sem registro — não é recusa, é ausência de informação" },
};

const soDigitos = (v: string) => v.replace(/\D/g, "").slice(0, 11);
const formataCpf = (v: string) =>
  soDigitos(v).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");

function Bloco({ titulo, Icone, children }: { titulo: string; Icone: any; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-faint)]">
        <Icone className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {titulo}
        </span>
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </div>
  );
}

function Linha({ rotulo, valor, alerta }: { rotulo: string; valor: React.ReactNode; alerta?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-[var(--text-muted)]">{rotulo}</span>
      <span className={`font-mono tabular-nums text-right ${alerta ? "text-[var(--gated)]" : "text-[var(--text)]"}`}>
        {valor}
      </span>
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
          Credencial BigDataCorp
        </span>
      </div>
      <form
        className="px-4 py-4 space-y-3"
        onSubmit={e => { e.preventDefault(); salvar.mutate(); }}
      >
        <p className="text-[13px] text-[var(--text-muted)]">
          Use um usuário de integração próprio do seu provedor. Assim o consumo e o
          custo aparecem separados também no painel da BigDataCorp.
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
  const [cpf, setCpf] = useState("");
  const [valorPlano, setValorPlano] = useState("");
  const [lgpd, setLgpd] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [verConfig, setVerConfig] = useState(false);

  const { data: integracao, isLoading } = useQuery<Integracao>({
    queryKey: ["/api/bigdata-integration"],
  });

  const consultar = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/bigdata-consultations", {
        cpfCnpj: soDigitos(cpf),
        lgpdAccepted: lgpd,
        valorPlano: valorPlano ? Number(valorPlano.replace(",", ".")) : undefined,
      });
      return r.json();
    },
    onSuccess: (d: Resultado) => setResultado(d),
    onError: (e: any) => {
      setResultado(null);
      toast({ title: "Consulta não realizada", description: e.message, variant: "destructive" });
    },
  });

  const configurado = integracao?.configurado;
  const v = resultado ? VEREDITO[resultado.veredito] : null;
  const d = resultado?.dados;

  return (
    <div className="p-4 lg:p-6 space-y-4" data-testid="consulta-cadastral-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[19px] font-medium tracking-[-0.02em] text-[var(--text)] leading-tight">
            Consulta Cadastral
          </h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
            Situação do CPF na Receita, validação de endereço e faixa de renda
          </p>
        </div>
        {configurado && (
          <Button variant="ghost" onClick={() => setVerConfig(x => !x)} data-testid="botao-config">
            <Settings2 className="w-4 h-4 mr-1.5" />
            Credencial
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-[180px] max-w-[520px]" />
      ) : !configurado || verConfig ? (
        <Configuracao integracao={integracao} />
      ) : null}

      {configurado && !verConfig && (
        <>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-4 space-y-3 max-w-[640px]">
            <div className="flex gap-3 flex-wrap items-end">
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="cpf">CPF do assinante</Label>
                <Input id="cpf" value={formataCpf(cpf)} inputMode="numeric"
                  onChange={e => setCpf(soDigitos(e.target.value))}
                  placeholder="000.000.000-00" className="font-mono tabular-nums"
                  data-testid="campo-cpf" />
              </div>
              <div className="w-[150px]">
                <Label htmlFor="plano">Mensalidade (R$)</Label>
                <Input id="plano" value={valorPlano} inputMode="decimal"
                  onChange={e => setValorPlano(e.target.value)} placeholder="120"
                  className="font-mono tabular-nums" data-testid="campo-plano" />
              </div>
            </div>
            {/* Sem mensalidade a renda não é avaliada — dizer isso evita o operador
                achar que o sistema ignorou o dado. */}
            <p className="text-[12px] text-[var(--text-faint)]">
              A mensalidade é opcional. Sem ela, a renda estimada não é comparada.
            </p>
            <label className="flex items-start gap-2 text-[13px] text-[var(--text-2)] cursor-pointer">
              <input type="checkbox" checked={lgpd} onChange={e => setLgpd(e.target.checked)}
                className="mt-0.5" data-testid="campo-lgpd" />
              <span>
                Declaro que tenho base legal para consultar este CPF — legítimo
                interesse para análise de risco de contratação (LGPD Art. 7, IX).
              </span>
            </label>
            <Button
              onClick={() => consultar.mutate()}
              disabled={consultar.isPending || soDigitos(cpf).length !== 11 || !lgpd}
              data-testid="botao-consultar"
            >
              <Search className="w-4 h-4 mr-1.5" />
              {consultar.isPending ? "Consultando…" : "Consultar"}
            </Button>
          </div>

          {!resultado && !consultar.isPending && (
            <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-6 py-12 text-center">
              <IdCard className="w-8 h-8 mx-auto mb-4 text-[var(--text-muted)] opacity-50" />
              <h3 className="font-medium text-base text-[var(--text)]">Nenhuma consulta ainda</h3>
              <p className="mt-2 mx-auto max-w-[52ch] text-sm text-[var(--text-muted)]">
                Informe o CPF do assinante antes da instalação. A consulta responde se o
                CPF está regular na Receita e se a pessoa tem vínculo com o endereço.
              </p>
            </div>
          )}

          {resultado && v && (
            <div className="space-y-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <span className={`inline-flex items-center text-[12px] font-medium tracking-[0.04em] px-2.5 py-1 rounded ${v.cls}`}
                      data-testid="veredito">
                      {v.rotulo}
                    </span>
                    <p className="text-[13px] text-[var(--text-muted)] mt-2">{v.nota}</p>
                  </div>
                  <span className="font-mono text-[11px] text-[var(--text-faint)] tabular-nums">
                    {resultado.latenciaMs} ms
                  </span>
                </div>
                {resultado.motivos.length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-[var(--border-faint)] pt-3">
                    {resultado.motivos.map((m, i) => (
                      <li key={i} className="text-[13px] text-[var(--text-2)] flex gap-2">
                        <span className="text-[var(--text-faint)]">·</span>{m}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {d?.encontrado && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Bloco titulo="Identidade" Icone={ShieldCheck}>
                    <Linha rotulo="Nome" valor={resultado.identidade.nome ?? "—"} />
                    <Linha rotulo="Nascimento" valor={
                      data(resultado.identidade.nascimento) +
                      (resultado.identidade.idade ? " · " + resultado.identidade.idade + " anos" : "")
                    } />
                    <Linha rotulo="Nome da mãe" valor={resultado.identidade.nomeMae ?? "—"} />
                    <Linha rotulo="Situação na Receita" valor={
                      (resultado.identidade.situacaoReceita ?? "—") + " · " + data(resultado.identidade.dataSituacao)
                    } alerta={!!d.taxIdStatus && d.taxIdStatus.toUpperCase() !== "REGULAR"} />
                    <Linha rotulo="Indicação de óbito" valor={d.temObito ? "Sim" : "Não"} alerta={d.temObito} />
                    <Linha rotulo="Nascimento confere" valor={d.nascimentoValidadoNaReceita === false ? "Não" : "Sim"}
                      alerta={d.nascimentoValidadoNaReceita === false} />
                    <Linha rotulo="Homônimos" valor={d.homonimos ?? 0} alerta={(d.homonimos ?? 0) >= 100} />
                  </Bloco>

                  <Bloco titulo="Renda e patrimônio" Icone={Wallet}>
                    {/* A faixa em salários mínimos não diz nada a quem decide um plano
                        de R$ 120 — o valor em reais é o que se compara. */}
                    <p className="font-mono text-[19px] font-medium tracking-[-0.02em] text-[var(--text)] tabular-nums">
                      {resultado.renda.emReais ?? "sem informação"}
                    </p>
                    {resultado.renda.faixa && resultado.renda.emReais && (
                      <p className="text-[12px] text-[var(--text-muted)]">
                        Faixa BigDataCorp: {resultado.renda.faixa}
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

                    <div className="pt-1">
                      <Linha rotulo="Patrimônio estimado" valor={
                        resultado.renda.patrimonio && resultado.renda.patrimonio !== "SEM INFORMACAO"
                          ? resultado.renda.patrimonio : "sem informação"} />
                      <Linha rotulo="Declarações de IR" valor={
                        resultado.renda.declaracoesIR.length > 0
                          ? resultado.renda.declaracoesIR.length + " anos · desde " +
                            resultado.renda.declaracoesIR[resultado.renda.declaracoesIR.length - 1].ano
                          : "nenhuma"} />
                    </div>

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
                                visto {data(e.ultimaPassagem)}
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
                                visto {data(t.ultimaPassagem)}
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

              {resultado.datasetsComFalha.length > 0 && (
                <p className="text-[12px] text-[var(--text-muted)]">
                  Consultas que não responderam: {resultado.datasetsComFalha.join(", ")}.
                  O restante do resultado é válido.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
