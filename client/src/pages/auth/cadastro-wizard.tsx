/**
 * Cadastro em três etapas: empresa, responsável, acesso.
 *
 * Substitui o formulário único de nove campos, que pedia tudo de uma vez e não
 * validava nada até o envio — quem errava o CNPJ descobria depois de preencher
 * a senha. Aqui cada etapa se resolve antes da seguinte, e o dado vem buscado
 * em vez de digitado onde isso é possível.
 *
 * Vive fora de `login.tsx` de propósito: aquele arquivo já carrega login,
 * esqueci-a-senha e redefinir-senha, e um assistente de três passos dentro dele
 * deixaria de caber na cabeça de quem for mexer depois.
 *
 * NADA é gravado antes da última etapa. Não existe provedor meio cadastrado no
 * banco: o POST acontece uma vez, no fim.
 */
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { cnpjMascarado } from "@/lib/cnpj";
import {
  Building2, User, KeyRound, CheckCircle2, AlertTriangle,
  RefreshCw, ArrowLeft, ArrowRight, Globe, Eye, EyeOff,
} from "lucide-react";

type Socio = { nome: string; qualificacao: string | null; cpfMascarado: string | null };

type Empresa = {
  passe: string; cnpj: string; razaoSocial: string; nomeFantasia: string | null;
  situacao: string | null; ativa: boolean; aberturaEm: string | null;
  atividade: string | null; porte: string | null;
  endereco: { cep: string | null; logradouro: string | null; numero: string | null;
    complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null };
  telefone: string | null; email: string | null; socios: Socio[]; enriquecido: boolean;
};

/** O que só o bureau sabe — contagem e sinalizador, nunca o processo em si. */
type Bureau = {
  encontrado: boolean; emCobrancaAgora: boolean;
  cobrancas365d: number; credores365d: number;
  processosTotal: number; processosComoReu: number;
  temExecucao: boolean; dividaAtiva: number; naturezas: string[];
};

const soDigitos = (v: string) => v.replace(/\D/g, "");

function formatarCpf(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatarTelefone(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Mesma regra do servidor (server/tenant.ts), para o sugerido já nascer válido. */
function sugerirSubdominio(nome: string): string {
  return nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 30);
}

/**
 * Data em ISO para o formato brasileiro.
 *
 * O `slice(0, 10)` corta o horário, e não é detalhe: as duas fontes escrevem
 * diferente. A Receita manda "2021-01-25" e a BigDataCorp manda
 * "1978-07-16T00:00:00Z". Partindo no hífen sem cortar antes, o dia saía com o
 * resto grudado — "16T00:00:00Z/07/1978" apareceu na tela.
 *
 * O que não for data ISO volta como veio: melhor mostrar o valor cru do que
 * inventar uma data.
 */
export function dataBr(iso: string | null): string | null {
  if (!iso) return null;
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  const ehData = a?.length === 4 && m?.length === 2 && d?.length === 2
    && /^\d+$/.test(a + m + d);
  return ehData ? `${d}/${m}/${a}` : iso;
}

/**
 * O CPF digitado bate com a máscara do sócio? ("***208668**")
 *
 * A Receita cobre os três primeiros e os dois últimos dígitos. Os seis do meio
 * bastam para pegar erro de digitação AQUI, na hora, sem gastar a consulta de
 * R$ 1,09 para descobrir depois. O servidor confere de novo — esta é só a
 * versão instantânea, para o campo poder reclamar enquanto a pessoa digita.
 */
function bateComMascara(cpf: string, mascara: string | null | undefined): boolean {
  const m = String(mascara ?? "");
  if (m.length !== 11 || cpf.length !== 11) return false;
  for (let i = 0; i < 11; i++) {
    if (m[i] !== "*" && m[i] !== cpf[i]) return false;
  }
  return true;
}

/* ── Peças da tela ──────────────────────────────────────────────────────── */

function Passos({ atual }: { atual: 1 | 2 | 3 }) {
  const passos = [
    { n: 1, rotulo: "Empresa", Icone: Building2 },
    { n: 2, rotulo: "Responsável", Icone: User },
    { n: 3, rotulo: "Acesso", Icone: KeyRound },
  ] as const;

  return (
    <ol className="flex items-center gap-1 mb-6" aria-label="Etapas do cadastro">
      {passos.map(({ n, rotulo, Icone }, i) => {
        const feito = n < atual;
        const ativo = n === atual;
        return (
          <li key={n} className="flex items-center gap-1 flex-1 last:flex-none">
            <div className="flex items-center gap-2 min-w-0">
              <span
                aria-current={ativo ? "step" : undefined}
                className="w-7 h-7 rounded grid place-items-center flex-none"
                style={{
                  background: feito || ativo ? "var(--brand)" : "var(--surface-inset)",
                  color: feito || ativo ? "var(--text-on-brand)" : "var(--text-faint)",
                }}
              >
                {feito ? <CheckCircle2 className="w-4 h-4" /> : <Icone className="w-3.5 h-3.5" />}
              </span>
              <span
                className="text-[11px] font-mono uppercase tracking-[0.06em] truncate"
                style={{ color: ativo ? "var(--text)" : "var(--text-faint)" }}
              >
                {rotulo}
              </span>
            </div>
            {i < passos.length - 1 && (
              <span className="h-px flex-1 mx-1" style={{ background: feito ? "var(--brand)" : "var(--border)" }} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Linha({ rotulo, valor, mono }: { rotulo: string; valor: string | null; mono?: boolean }) {
  if (!valor) return null;
  return (
    <div className="flex justify-between gap-3 py-1 text-[13px]">
      <span className="text-[var(--text-muted)] flex-none">{rotulo}</span>
      <span
        className={`text-right text-[var(--text)] ${mono ? "font-mono tabular-nums" : ""}`}
        style={{ overflowWrap: "anywhere" }}
      >
        {valor}
      </span>
    </div>
  );
}

function Aviso({ tom, children }: { tom: "gated" | "danger" | "info"; children: React.ReactNode }) {
  return (
    <div
      className="flex gap-2 items-start rounded p-2.5 text-[12px] leading-relaxed"
      style={{ background: `var(--${tom}-bg)`, border: `1px solid var(--${tom}-border)`, color: `var(--${tom})` }}
    >
      <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

/* ── O assistente ───────────────────────────────────────────────────────── */

export default function CadastroWizard({ aoPrecisarVerificar }: {
  aoPrecisarVerificar: (email: string) => void;
}) {
  const { register } = useAuth();
  const { toast } = useToast();
  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [enviando, setEnviando] = useState(false);

  // etapa 1
  const [cnpj, setCnpj] = useState("");
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [buscaEmpresa, setBuscaEmpresa] = useState<"parado" | "buscando" | "erro">("parado");
  const [erroEmpresa, setErroEmpresa] = useState("");
  const [bureau, setBureau] = useState<Bureau | null>(null);
  const [carregandoBureau, setCarregandoBureau] = useState(false);

  // etapa 2
  const [buscaAutomatica, setBuscaAutomatica] = useState(true);
  /** Índice do sócio escolhido, "outro" para procurador, null para não escolhido. */
  const [socioEscolhido, setSocioEscolhido] = useState<number | "outro" | null>(null);
  const [cpf, setCpf] = useState("");
  const [nome, setNome] = useState("");
  const [nascimento, setNascimento] = useState<string | null>(null);
  const [buscaCpf, setBuscaCpf] = useState<"parado" | "buscando" | "achou" | "manual">("parado");
  const [avisoCpf, setAvisoCpf] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  // etapa 3
  const [subdominio, setSubdominio] = useState("");
  const [statusSub, setStatusSub] = useState<"parado" | "checando" | "livre" | "ocupado">("parado");
  const [email, setEmail] = useState("");
  const [emailConfirma, setEmailConfirma] = useState("");
  const [senha, setSenha] = useState("");
  const [senhaConfirma, setSenhaConfirma] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [lgpd, setLgpd] = useState(false);

  /* A tela pergunta se a busca paga está ligada ANTES de desenhar a etapa 2,
     para já abrir no modo certo em vez de trocar o formulário na cara. */
  useEffect(() => {
    fetch("/api/public/cadastro/recursos")
      .then(r => r.json())
      .then(d => setBuscaAutomatica(Boolean(d?.buscaAutomatica)))
      .catch(() => setBuscaAutomatica(false));
  }, []);

  /* ── Etapa 1: busca a empresa quando o CNPJ fica completo ── */
  const procurarEmpresa = useCallback(async (digitos: string) => {
    setBuscaEmpresa("buscando");
    setErroEmpresa("");
    setEmpresa(null);
    try {
      const r = await fetch(`/api/public/cadastro/empresa/${digitos}`);
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setBuscaEmpresa("erro");
        setErroEmpresa(d?.mensagem || "Não foi possível consultar este CNPJ agora.");
        return;
      }
      setEmpresa(d);
      setBuscaEmpresa("parado");
      setSubdominio(sugerirSubdominio(d.nomeFantasia || d.razaoSocial));
    } catch {
      setBuscaEmpresa("erro");
      setErroEmpresa("Não foi possível consultar agora. Tente de novo em instantes.");
    }
  }, []);

  useEffect(() => {
    const d = soDigitos(cnpj);
    if (d.length !== 14) {
      setEmpresa(null);
      setBureau(null);
      setSocioEscolhido(null);
      setNome("");
      setCpf("");
      setBuscaEmpresa("parado");
      setErroEmpresa("");
      return;
    }
    const t = setTimeout(() => procurarEmpresa(d), 300);
    return () => clearTimeout(t);
  }, [cnpj, procurarEmpresa]);

  /**
   * O bloco de bureau, DEPOIS que o cartão da empresa já apareceu.
   *
   * É a parte que só a BigDataCorp responde, e leva 4 a 6 segundos. Buscá-la
   * junto com a etapa 1 fazia a primeira tela do cadastro esperar por ela — e
   * chegou a estourar o tempo do servidor. Aqui ela chega por baixo, com o
   * formulário já utilizável, e some sem barulho se falhar.
   */
  useEffect(() => {
    if (!empresa) return;
    let vivo = true;
    setBureau(null);
    setCarregandoBureau(true);
    fetch(`/api/public/cadastro/empresa/${empresa.cnpj}/bureau?passe=${encodeURIComponent(empresa.passe)}`)
      .then(r => r.json())
      .then(d => { if (vivo && d?.ok) setBureau(d); })
      .catch(() => {})
      .finally(() => { if (vivo) setCarregandoBureau(false); });
    return () => { vivo = false; };
  }, [empresa]);

  /**
   * O CPF digitado contradiz o sócio escolhido?
   *
   * Só reclama com os 11 dígitos completos — reclamar no meio da digitação
   * seria ruído, já que o CPF ainda está incompleto por definição.
   */
  const mascaraDoSocio = typeof socioEscolhido === "number"
    ? empresa?.socios[socioEscolhido]?.cpfMascarado ?? null
    : null;
  const naoBateComOSocio = Boolean(
    mascaraDoSocio && soDigitos(cpf).length === 11 && !bateComMascara(soDigitos(cpf), mascaraDoSocio),
  );

  /* ── Etapa 2: busca o responsável quando o CPF fica completo ── */
  useEffect(() => {
    const d = soDigitos(cpf);
    if (d.length !== 11 || !empresa) return;
    if (!buscaAutomatica) { setBuscaCpf("manual"); return; }
    // CPF que não bate com o sócio escolhido não vira consulta: seria pagar
    // R$ 1,09 para o servidor devolver exatamente o que já sabemos aqui.
    if (naoBateComOSocio) { setBuscaCpf("parado"); return; }

    const t = setTimeout(async () => {
      setBuscaCpf("buscando");
      setAvisoCpf("");
      try {
        const r = await fetch("/api/public/cadastro/responsavel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cpf: d, passe: empresa.passe }),
        });
        const dados = await r.json();
        if (dados?.ok) {
          setNome(dados.nome);
          setNascimento(dados.nascimento ?? null);
          setBuscaCpf("achou");
          return;
        }
        if (dados?.motivo === "passe") {
          toast({ title: "Sessão do cadastro expirou", description: "Confirme o CNPJ novamente.", variant: "destructive" });
          setEtapa(1);
          return;
        }
        // "desligado" e "nao-encontrado" caem no manual: o cadastro segue.
        setBuscaCpf("manual");
        setAvisoCpf(dados?.mensagem || "");
      } catch {
        setBuscaCpf("manual");
        setAvisoCpf("A consulta não respondeu. Preencha seu nome abaixo.");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [cpf, empresa, buscaAutomatica, naoBateComOSocio, toast]);

  /* ── Etapa 3: disponibilidade do subdomínio ── */
  useEffect(() => {
    if (etapa !== 3 || subdominio.length < 3) { setStatusSub("parado"); return; }
    setStatusSub("checando");
    const t = setTimeout(async () => {
      try {
        const r = await apiRequest("GET", `/api/auth/check-subdomain?subdomain=${encodeURIComponent(subdominio)}`);
        const d = await r.json();
        setStatusSub(d.available ? "livre" : "ocupado");
      } catch {
        setStatusSub("parado");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [subdominio, etapa]);

  async function criarConta() {
    if (email !== emailConfirma) {
      toast({ title: "Os e-mails não conferem", description: "O e-mail e a confirmação precisam ser iguais.", variant: "destructive" });
      return;
    }
    if (senha !== senhaConfirma) {
      toast({ title: "As senhas não conferem", description: "A senha e a confirmação precisam ser iguais.", variant: "destructive" });
      return;
    }
    setEnviando(true);
    try {
      const r = await register({
        email, password: senha, name: nome, phone: soDigitos(whatsapp),
        responsavelCpf: soDigitos(cpf),
        providerName: empresa!.nomeFantasia || empresa!.razaoSocial,
        cnpj: empresa!.cnpj, subdomain: subdominio, lgpdAccepted: lgpd,
      });
      if (r.needsVerification) aoPrecisarVerificar(r.email);
    } catch (err: any) {
      toast({
        title: "Não foi possível criar sua conta",
        description: err?.message || "Confira os dados e tente novamente.",
        variant: "destructive",
      });
    } finally {
      setEnviando(false);
    }
  }

  const enderecoEmLinha = empresa
    ? [empresa.endereco.logradouro, empresa.endereco.numero, empresa.endereco.bairro]
        .filter(Boolean).join(", ")
    : null;
  const cidadeUf = empresa && empresa.endereco.cidade
    ? `${empresa.endereco.cidade}${empresa.endereco.uf ? ` — ${empresa.endereco.uf}` : ""}`
    : null;

  const podeIrEtapa2 = Boolean(empresa);
  const podeIrEtapa3 = Boolean(
    nome.trim().length >= 3 &&
    soDigitos(cpf).length === 11 &&
    !naoBateComOSocio &&
    soDigitos(whatsapp).length >= 10 &&
    // Empresa com quadro societario exige escolher quem e; sem quadro (MEI),
    // nao ha o que escolher.
    (empresa?.socios.length === 0 || socioEscolhido !== null),
  );
  const podeCriar = Boolean(
    subdominio.length >= 3 && statusSub !== "ocupado" &&
    email && emailConfirma && senha.length >= 6 && senhaConfirma && lgpd,
  );

  return (
    <div className="space-y-1" data-testid="cadastro-wizard">
      <Passos atual={etapa} />

      {/* ─── ETAPA 1 · EMPRESA ─────────────────────────────────────────── */}
      {etapa === 1 && (
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)]" htmlFor="cnpj">
              CNPJ do provedor
            </label>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5 mb-2">
              É só o que precisamos para começar. Buscamos o resto na Receita.
            </p>
            <div className="relative">
              <Input
                id="cnpj" inputMode="numeric" autoFocus
                data-testid="input-cnpj"
                placeholder="00.000.000/0000-00"
                value={cnpj}
                onChange={e => setCnpj(cnpjMascarado(e.target.value))}
                className="font-mono tabular-nums pr-9"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                {buscaEmpresa === "buscando" && <RefreshCw className="w-4 h-4 animate-spin text-[var(--text-muted)]" />}
                {empresa && <CheckCircle2 className="w-4 h-4 text-[var(--ok)]" />}
              </span>
            </div>
          </div>

          {buscaEmpresa === "erro" && <Aviso tom="danger">{erroEmpresa}</Aviso>}

          {empresa && (
            <div
              className="rounded p-3.5 space-y-0.5"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
              data-testid="card-empresa"
            >
              <p className="font-semibold text-[var(--text)] leading-snug mb-1.5">
                {empresa.nomeFantasia || empresa.razaoSocial}
              </p>
              {empresa.nomeFantasia && <Linha rotulo="Razão social" valor={empresa.razaoSocial} />}
              <Linha rotulo="CNPJ" valor={cnpjMascarado(empresa.cnpj)} mono />
              <Linha rotulo="Situação" valor={empresa.situacao} />
              <Linha rotulo="Aberta em" valor={dataBr(empresa.aberturaEm)} mono />
              <Linha rotulo="Atividade" valor={empresa.atividade} />
              <Linha rotulo="Endereço" valor={enderecoEmLinha} />
              <Linha rotulo="Cidade" valor={cidadeUf} />

              {!empresa.ativa && (
                <div className="pt-2">
                  <Aviso tom="gated">
                    A Receita não mostra este CNPJ como ativo. Você pode seguir, mas a
                    aprovação da conta vai depender de regularizar a situação.
                  </Aviso>
                </div>
              )}
            </div>
          )}

          {/* O bloco que só o bureau responde. É a primeira vez que o visitante
              vê o produto trabalhando — e é sobre a empresa dele mesmo. */}
          {empresa && (carregandoBureau || bureau) && (
            <div
              className="rounded p-3.5"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
              data-testid="card-bureau"
            >
              <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-faint)] mb-2">
                Consulta na base · o que já sabemos desta empresa
              </p>

              {carregandoBureau && (
                <div className="space-y-1.5" aria-live="polite" aria-busy="true">
                  <div className="h-3 rounded animate-pulse" style={{ background: "var(--surface-inset)", width: "70%" }} />
                  <div className="h-3 rounded animate-pulse" style={{ background: "var(--surface-inset)", width: "45%" }} />
                </div>
              )}

              {bureau && !carregandoBureau && (
                bureau.encontrado && (bureau.cobrancas365d > 0 || bureau.processosComoReu > 0 || bureau.dividaAtiva > 0) ? (
                  <div className="space-y-0.5">
                    <Linha rotulo="Cobranças (12 meses)" valor={String(bureau.cobrancas365d)} mono />
                    <Linha rotulo="Credores distintos" valor={bureau.credores365d ? String(bureau.credores365d) : null} mono />
                    <Linha rotulo="Processos como réu" valor={bureau.processosComoReu ? String(bureau.processosComoReu) : null} mono />
                    <Linha rotulo="Dívida ativa" valor={bureau.dividaAtiva ? `R$ ${bureau.dividaAtiva.toLocaleString("pt-BR")}` : null} mono />
                    {bureau.temExecucao && (
                      <p className="text-[12px] text-[var(--past)] pt-1">Há execução judicial registrada.</p>
                    )}
                    <p className="text-[11px] text-[var(--text-muted)] pt-2 leading-relaxed">
                      É este tipo de leitura que você vai fazer dos seus assinantes, em 2 segundos,
                      antes de instalar.
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-[13px] text-[var(--ok)] inline-flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Nenhuma ocorrência registrada.
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] pt-1.5 leading-relaxed">
                      Foi a mesma consulta que você vai fazer dos seus assinantes antes de instalar.
                    </p>
                  </div>
                )
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              className="flex-1 h-11 gap-1.5" disabled={!podeIrEtapa2}
              onClick={() => setEtapa(2)} data-testid="button-confirmar-empresa"
            >
              Confirmar e continuar <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
          {/* O link para "já tenho conta" fica no rodapé do cartão, que a
              página de login já desenha. Um aqui seria o segundo, um em cima
              do outro. */}
        </div>
      )}

      {/* ─── ETAPA 2 · RESPONSÁVEL ────────────────────────────────────── */}
      {etapa === 2 && empresa && (
        <div className="space-y-4">
          {/* A Receita já disse quem responde pela empresa. Escolher da lista é
              melhor que digitar: o nome vem pronto, e o CPF passa a ter contra
              quem ser conferido — o que também impede a consulta paga de ser
              disparada por quem não é sócio. */}
          {empresa.socios.length > 0 && (
            <div>
              <label className="text-sm font-medium text-[var(--text)]">Quem responde pelo provedor?</label>
              <p className="text-[12px] text-[var(--text-muted)] mt-0.5 mb-2">
                Selecione seu nome no quadro societário da Receita.
              </p>
              <div className="space-y-1.5" role="radiogroup" aria-label="Sócios da empresa">
                {empresa.socios.map((s, i) => {
                  const escolhido = socioEscolhido === i;
                  return (
                    <button
                      key={s.nome} type="button" role="radio" aria-checked={escolhido}
                      data-testid={`socio-${i}`}
                      onClick={() => { setSocioEscolhido(i); setNome(s.nome); setCpf(""); setBuscaCpf("parado"); setAvisoCpf(""); }}
                      className="w-full text-left rounded px-3 py-2.5 transition-colors"
                      style={{
                        background: escolhido ? "var(--brand-soft)" : "var(--surface-2)",
                        boxShadow: `0 0 0 1px ${escolhido ? "var(--brand)" : "var(--border)"}`,
                      }}
                    >
                      <span className="flex items-center gap-2">
                        {escolhido
                          ? <CheckCircle2 className="w-4 h-4 flex-none" style={{ color: "var(--brand)" }} />
                          : <span className="w-4 h-4 rounded-full flex-none" style={{ boxShadow: "0 0 0 1px var(--border-strong)" }} />}
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium truncate"
                                style={{ color: escolhido ? "var(--brand-ink)" : "var(--text)" }}>
                            {s.nome}
                          </span>
                          <span className="block text-[11px] text-[var(--text-muted)]">
                            {s.qualificacao ?? "Sócio"}
                            {s.cpfMascarado && <span className="font-mono ml-1.5">{s.cpfMascarado}</span>}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}

                <button
                  type="button" role="radio" aria-checked={socioEscolhido === "outro"}
                  data-testid="socio-outro"
                  onClick={() => { setSocioEscolhido("outro"); setNome(""); setCpf(""); setBuscaCpf("manual"); setAvisoCpf(""); }}
                  className="w-full text-left rounded px-3 py-2 text-[12px] transition-colors"
                  style={{
                    background: socioEscolhido === "outro" ? "var(--brand-soft)" : "transparent",
                    boxShadow: `0 0 0 1px ${socioEscolhido === "outro" ? "var(--brand)" : "var(--border-faint)"}`,
                    color: "var(--text-muted)",
                  }}
                >
                  Não sou nenhum destes — sou procurador ou represento a empresa
                </button>
              </div>
            </div>
          )}

          {/* O CPF só entra depois de escolher quem é — ou de imediato quando a
              empresa não tem quadro societário (MEI, empresário individual). */}
          {(socioEscolhido !== null || empresa.socios.length === 0) && (
            <div>
              <label className="text-sm font-medium text-[var(--text)]" htmlFor="cpf">
                {socioEscolhido !== null && socioEscolhido !== "outro" ? "Confirme seu CPF" : "CPF do responsável"}
              </label>
              <p className="text-[12px] text-[var(--text-muted)] mt-0.5 mb-2">
                {socioEscolhido !== null && socioEscolhido !== "outro"
                  ? `Precisa bater com ${empresa.socios[socioEscolhido]?.cpfMascarado ?? "o registro da Receita"}.`
                  : "Quem responde pelo provedor e vai administrar a conta."}
              </p>
              <div className="relative">
                <Input
                  id="cpf" inputMode="numeric" autoFocus
                  data-testid="input-cpf"
                  placeholder="000.000.000-00"
                  value={cpf}
                  onChange={e => { setCpf(formatarCpf(e.target.value)); setBuscaCpf(socioEscolhido === "outro" ? "manual" : "parado"); setAvisoCpf(""); }}
                  className="font-mono tabular-nums pr-9"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {buscaCpf === "buscando" && <RefreshCw className="w-4 h-4 animate-spin text-[var(--text-muted)]" />}
                  {buscaCpf === "achou" && <CheckCircle2 className="w-4 h-4 text-[var(--ok)]" />}
                </span>
              </div>
              {/* Conferência instantânea contra a máscara, antes de gastar
                  consulta: erro de digitação aparece na hora, de graça. */}
              {naoBateComOSocio && (
                <p className="text-[12px] text-[var(--danger)] mt-1">
                  Não bate com o CPF do sócio selecionado. Confira os números.
                </p>
              )}
            </div>
          )}

          {/* O nome aparece assim que há um sócio escolhido — ele já veio da
              Receita e a pessoa só confere. Sem sócio, aparece quando a busca
              resolve, ou de imediato no modo manual. */}
          {(buscaCpf === "achou" || buscaCpf === "manual" || typeof socioEscolhido === "number") && (
            <>
              {avisoCpf && buscaCpf === "manual" && <Aviso tom="info">{avisoCpf}</Aviso>}
              <div>
                <label className="text-sm font-medium text-[var(--text)]" htmlFor="nome">
                  Nome completo
                </label>
                <Input
                  id="nome" data-testid="input-nome" className="mt-1.5"
                  placeholder="Seu nome completo"
                  value={nome} onChange={e => setNome(e.target.value)}
                />
                {buscaCpf === "achou" && (
                  <p className="text-[12px] text-[var(--ok)] mt-1 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Encontrado{nascimento ? ` · nascimento ${dataBr(nascimento)}` : ""}. Confira e corrija se precisar.
                  </p>
                )}
              </div>
            </>
          )}

          <div>
            <label className="text-sm font-medium text-[var(--text)]" htmlFor="whatsapp">
              WhatsApp do responsável
            </label>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5 mb-1.5">
              Obrigatório — é por onde falamos com você sobre a conta.
            </p>
            <Input
              id="whatsapp" inputMode="numeric" data-testid="input-whatsapp"
              placeholder="(00) 00000-0000"
              value={whatsapp} onChange={e => setWhatsapp(formatarTelefone(e.target.value))}
              className="font-mono tabular-nums"
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="h-11 gap-1.5" onClick={() => setEtapa(1)}
                    data-testid="button-voltar-1">
              <ArrowLeft className="w-4 h-4" /> Voltar
            </Button>
            <Button className="flex-1 h-11 gap-1.5" disabled={!podeIrEtapa3}
                    onClick={() => setEtapa(3)} data-testid="button-confirmar-responsavel">
              Confirmar e continuar <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── ETAPA 3 · ACESSO ─────────────────────────────────────────── */}
      {etapa === 3 && empresa && (
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[var(--text)] inline-flex items-center gap-1.5" htmlFor="subdominio">
              <Globe className="w-3.5 h-3.5" /> Endereço do seu painel
            </label>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Input
                id="subdominio" data-testid="input-subdominio"
                value={subdominio}
                onChange={e => setSubdominio(sugerirSubdominio(e.target.value))}
                className="font-mono"
              />
              <span className="text-[13px] text-[var(--text-muted)] font-mono flex-none">.consultaisp.com.br</span>
            </div>
            <p className="text-[12px] mt-1"
               style={{ color: statusSub === "ocupado" ? "var(--danger)" : "var(--text-muted)" }}>
              {statusSub === "checando" && "Verificando disponibilidade…"}
              {statusSub === "livre" && "Disponível."}
              {statusSub === "ocupado" && "Este endereço já está em uso. Escolha outro."}
              {statusSub === "parado" && "Sugerido a partir do nome da empresa. Você pode editar."}
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--text)]" htmlFor="email">
              E-mail (será seu usuário)
            </label>
            <Input
              id="email" type="email" data-testid="input-email" className="mt-1.5"
              placeholder="seu@email.com" value={email}
              onChange={e => setEmail(e.target.value.trim())}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--text)]" htmlFor="email2">
              Confirmar e-mail
            </label>
            <Input
              id="email2" type="email" data-testid="input-confirm-email" className="mt-1.5"
              placeholder="Repita o e-mail" value={emailConfirma}
              onChange={e => setEmailConfirma(e.target.value.trim())}
            />
            {/* A confirmação existe porque o link de ativação vai para este
                endereço: um erro de digitação aqui cria uma conta inacessível. */}
            {emailConfirma && email !== emailConfirma && (
              <p className="text-[12px] text-[var(--danger)] mt-1">Os e-mails não conferem.</p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--text)]" htmlFor="senha">Senha</label>
            <div className="relative mt-1.5">
              <Input
                id="senha" type={verSenha ? "text" : "password"} data-testid="input-password"
                placeholder="Mínimo 6 caracteres" value={senha}
                onChange={e => setSenha(e.target.value)} className="pr-9"
              />
              <button type="button" onClick={() => setVerSenha(v => !v)}
                      aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                {verSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-[var(--text)]" htmlFor="senha2">Repetir senha</label>
            <Input
              id="senha2" type={verSenha ? "text" : "password"} data-testid="input-confirm-password"
              className="mt-1.5" placeholder="Repita a senha" value={senhaConfirma}
              onChange={e => setSenhaConfirma(e.target.value)}
            />
            {senhaConfirma && senha !== senhaConfirma && (
              <p className="text-[12px] text-[var(--danger)] mt-1">As senhas não conferem.</p>
            )}
          </div>

          <label className="flex items-start gap-2 text-[12px] text-[var(--text-2)] leading-relaxed cursor-pointer">
            <input
              type="checkbox" checked={lgpd} onChange={e => setLgpd(e.target.checked)}
              data-testid="checkbox-lgpd" className="mt-0.5 flex-none"
            />
            <span>
              Autorizo o tratamento dos dados informados para análise de crédito e prevenção
              à fraude, conforme a LGPD (Lei nº 13.709/2018).
            </span>
          </label>

          <div className="flex gap-2">
            <Button variant="outline" className="h-11 gap-1.5" onClick={() => setEtapa(2)}
                    data-testid="button-voltar-2">
              <ArrowLeft className="w-4 h-4" /> Voltar
            </Button>
            <Button className="flex-1 h-11" disabled={!podeCriar || enviando}
                    onClick={criarConta} data-testid="button-criar-conta">
              {enviando ? "Criando…" : "Criar conta"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
