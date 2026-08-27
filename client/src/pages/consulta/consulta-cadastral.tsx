import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { IdCard, Settings2, AlertTriangle, CreditCard } from "lucide-react";
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
  /** Nível consultado. Ausente nas consultas gravadas antes do seletor existir. */
  nivel?: string;
  creditosCobrados?: number;
  /** Carimbo do relatório — vem do registro salvo no servidor. */
  createdAt?: string;
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
  /** O que sobra para a mensalidade, e quanto disso vem de beneficio. */
  capacidade?: {
    sobraMensal?: string; despesaMensal?: string; rendaFamiliar?: string;
    dependentes: number; ehResponsavel?: boolean; ehDependente?: boolean;
    origemRenda?: string; percentualBeneficio?: string;
    recebeBeneficio: boolean; beneficiosAtivos: number; beneficiariosNaFamilia: number;
  };
  /** Contagem por padrao; nomes so quando ha ocorrencia entre os relacionados. */
  domicilio?: {
    totalRelacionados: number; noDomicilio: number; vizinhos: number;
    parentes: number; conjuges: number; socios: number; colegasTrabalho: number;
    nomes: Array<{ nome: string; vinculo: string; nivel: string }>;
    nomesLiberados: boolean;
  };
  /** Score da CASA, com a distribuicao A-H dos membros. */
  riscoFamiliar?: {
    score?: number; nivel?: string; membros: number; empregados: number;
    emCobranca: number; ocorrencias365d: number;
    distribuicao: Record<string, number>; piorFaixa?: string;
  };
  /** Risco de crime no endereco de instalacao. */
  seguranca?: {
    score?: number; nivel?: string; cidade?: string; uf?: string;
    roubo?: number; violencia?: number; narcotrafico?: number; furtoVeiculo?: number;
    ocorrenciasPorMes?: number; crimes360d?: number;
    totalEnderecos: number; totalCidades: number;
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
  /** Processos individuais — a tabela de ocorrências do modelo de bureau. */
  processos?: Array<{
    data?: string; tipo?: string; assunto?: string; tribunal?: string;
    uf?: string; status?: string; valor?: number; papel: "réu" | "autor" | "outro";
  }>;
  rastro: {
    consultas30d: number; consultas365d: number; passagensRuins: number;
    primeiraPassagem?: string; ultimaPassagem?: string;
    buscaCredito?: string; usoCartao?: string; usoBancoDigital?: string;
    mudancasNome: number; mudancasStatus: number;
  };
  patrimonio: { veiculos: number; recebeAuxilio: boolean; auxiliosAtivos: number; valorAuxilio: number };
  ocupacao?: {
    empregadoAgora?: boolean; empreendedor?: boolean;
    trocasTotal: number; trocas5Anos: number; trocas10Anos: number;
    mediaAnosPorVinculo?: number; idadePrimeiroEmprego?: number; primeiroVinculo?: string;
    setorPublico?: boolean; setorPrivado?: boolean; totalEmpregadores: number;
  };
  perfil?: { classeSocial?: string; faixaRenda?: string; escolaridade?: string; origem?: string };
  /** true quando o nível pedido tinha bureau e nenhum estava habilitado na conta. */
  bureauIndisponivel?: boolean;
  nivelPedido?: string;
  /** Vem vazio enquanto os datasets de bureau não estiverem habilitados. */
  mercado?: {
    score?: number; scoreExplicacao?: string; scoreProbabilidade?: string;
    negativado?: boolean; temRegistroMinimo?: boolean; consultouCredito?: boolean;
    dividaTotal?: number; negativacoesAtivas?: number; negativacoesInativas?: number;
    protestos?: number; apontamentosJudiciais?: number; ultimaNegativacao?: string;
    negativacoes: Array<{ credor: string; valor: number; ocorrencias: number; primeira?: string; ultima?: string }>;
    consultas30d?: number; consultas60d?: number; consultas90d?: number;
    consultasPorSegmento?: Record<string, number>;
    quemConsultou: Array<{ empresa: string; data?: string; cidadeUf?: string }>;
    classeCadastral?: string; classeCadastralDescricao?: string;
  };
  riscoArea: Array<{ endereco: string; ponto?: number; raio100m?: number }>;
  /** Sondas da Completa — null quando o nível não inclui ou o bureau falhou. */
  validacaoTelefone?: {
    numero: string; tipo?: string; operadoraAtual?: string;
    bloqueado?: boolean; cidade?: string;
  } | null;
  imovel?: {
    endereco: string; tipologia?: string; uso?: string;
    areaM2?: number; comodos?: number; correspondenciaExata?: boolean;
  } | null;
  consultasIndisponiveis: number;
  dados: {
    encontrado: boolean; taxIdStatus?: string; temObito?: boolean;
    nascimentoValidadoNaReceita?: boolean; homonimos?: number;
    badAddressPassages?: number; faixaRenda?: string;
  };
};

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

const telefoneFmt = (t: Telefone) => {
  const n = t.numero.replace(/\D/g, "");
  const corpo = n.length >= 9 ? `${n.slice(0, n.length - 4)}-${n.slice(-4)}` : n;
  return t.ddd ? `(${t.ddd}) ${corpo}` : corpo;
};

type Tom = "ok" | "alerta" | "perigo" | "marca" | "neutro";

/**
 * Pílula de fato — arredondada e sem contorno, exatamente como no mockup.
 *
 * Diverge do DESIGN_SYSTEM, que proíbe `rounded-full` em badge de STATUS. A
 * diferença é o papel: não são status de linha numa tabela densa, são fatos
 * avulsos num cabeçalho arejado e em fim de linha de lista.
 */
const CHIP_TOM: Record<Tom, string> = {
  ok: "bg-[var(--ok-bg)] text-[var(--ok)]",
  alerta: "bg-[var(--gated-bg)] text-[var(--gated)]",
  perigo: "bg-[var(--past-bg)] text-[var(--past)]",
  marca: "bg-[var(--brand-soft)] text-[var(--brand-ink)]",
  neutro: "bg-[var(--surface-inset)] text-[var(--text-muted)]",
};

function Chip({ children, tom = "neutro" }: { children: React.ReactNode; tom?: Tom }) {
  return (
    <span className={`inline-flex items-center text-[11.5px] font-semibold px-2.5 py-[3px] rounded-full ${CHIP_TOM[tom]}`}>
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

const TEXTO_TOM: Record<Tom, string> = {
  ok: "text-[var(--ok)]",
  alerta: "text-[var(--gated)]",
  perigo: "text-[var(--past)]",
  marca: "text-[var(--brand-ink)]",
  neutro: "text-[var(--text)]",
};

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

const RESUMO_TOM: Record<LinhaResumo["estado"], string> = {
  nada: "text-[var(--ok)]",
  consta: "text-[var(--past)]",
  atencao: "text-[var(--gated)]",
  fora: "text-[var(--text-faint)]",
};

/**
 * Resumo da consulta — o esqueleto de relatório de bureau (padrão Serasa):
 * TODA verificação executada aparece, inclusive as que deram "Nada consta".
 * Listar só o que constou parece um alerta; listar tudo prova o que foi
 * checado — é isso que faz um relatório valer o que custou.
 */
function ResumoConsulta({ linhas }: { linhas: LinhaResumo[] }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
      data-testid="resumo-consulta">
      <div className="flex items-center justify-between gap-3 px-5 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border-faint)]">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Resumo da consulta
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
          {linhas.filter(l => l.estado === "nada").length} nada consta ·{" "}
          {linhas.filter(l => l.estado === "consta" || l.estado === "atencao").length} com ocorrência
        </span>
      </div>
      {linhas.map((l, i) => (
        <div key={i} data-testid={`resumo-${i}`}
          className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-5 py-[9px] border-b border-[var(--border-faint)] last:border-b-0">
          <span className="text-[13px] text-[var(--text-2)] min-w-[14ch]">{l.categoria}</span>
          <span className={`text-[13px] font-semibold ${RESUMO_TOM[l.estado]}`}>
            {l.resultado}
          </span>
          <span className="ml-auto flex items-baseline gap-4 shrink-0">
            {l.valor && (
              <span className="font-mono text-[13px] font-semibold tabular-nums text-[var(--past)]">
                {l.valor}
              </span>
            )}
            {l.ultimo && (
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-faint)]">
                último em {l.ultimo}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Monta as linhas do resumo a partir do resultado. Fica fora do JSX porque a
 * regra de três estados (consta / nada consta / fora do nível) é lógica, não
 * apresentação — e muda quando um nível novo entrar.
 */
function montarResumo(r: Resultado): LinhaResumo[] {
  const inad = r.inadimplencia;
  const m = r.mercado;
  const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

  // Bureau consultado de verdade? Distingue "0 negativações" de "não olhei".
  const temBureau = m != null && (m.negativacoesAtivas != null || m.protestos != null);
  const foraTexto = r.bureauIndisponivel
    ? "Bureaus não habilitados na conta"
    : "Não incluído — disponível no nível Completa";

  const linhas: LinhaResumo[] = [
    {
      categoria: "Situação na Receita Federal",
      estado: r.dados.taxIdStatus?.toUpperCase() === "REGULAR" ? "nada" : "consta",
      resultado: r.dados.taxIdStatus?.toUpperCase() === "REGULAR"
        ? "Regular" : `${r.dados.taxIdStatus ?? "Não informada"}`,
      ultimo: r.identidade.dataSituacao ? fmtData(r.identidade.dataSituacao) : undefined,
    },
    {
      categoria: "Indicação de óbito",
      estado: r.dados.temObito ? "consta" : "nada",
      resultado: r.dados.temObito ? "Consta indicação" : "Nada consta",
    },
    {
      categoria: "Pendências de cobrança",
      estado: inad.emCobrancaAgora ? "consta" : inad.cobrancas365d > 0 ? "atencao" : "nada",
      resultado: inad.emCobrancaAgora
        ? "Em cobrança neste momento"
        : inad.cobrancas365d > 0
          ? `${inad.cobrancas365d} ocorrência(s) em 12 meses`
          : "Nada consta",
      ultimo: inad.cobrancas365d > 0 ? fmtData(inad.ultimaCobranca) : undefined,
    },
    {
      categoria: "Processos como réu",
      estado: inad.temExecucao ? "consta" : inad.processosComoReu > 0 ? "atencao" : "nada",
      resultado: inad.processosComoReu > 0
        ? `${inad.processosComoReu} de ${inad.processosTotal} processos`
          + (inad.temExecucao ? " · com execução" : "")
        : "Nada consta",
    },
    {
      categoria: "Dívida ativa da União",
      estado: inad.dividaAtiva > 0 ? "consta" : "nada",
      resultado: inad.dividaAtiva > 0 ? "Inscrição ativa" : "Nada consta",
      valor: inad.dividaAtiva > 0 ? brl(inad.dividaAtiva) : undefined,
    },
    {
      categoria: "Negativações no mercado",
      estado: !temBureau ? "fora"
        : (m!.negativacoesAtivas ?? 0) > 0 ? "consta" : "nada",
      resultado: !temBureau ? foraTexto
        : (m!.negativacoesAtivas ?? 0) > 0
          ? `${m!.negativacoesAtivas} ativa(s)`
            + (m!.negativacoesInativas ? ` · ${m!.negativacoesInativas} quitada(s)` : "")
          : "Nada consta",
      valor: temBureau && (m!.dividaTotal ?? 0) > 0 ? brl(m!.dividaTotal!) : undefined,
      ultimo: temBureau && m!.ultimaNegativacao ? fmtData(m!.ultimaNegativacao) : undefined,
    },
    {
      categoria: "Protestos em cartório",
      estado: !temBureau ? "fora" : (m!.protestos ?? 0) > 0 ? "consta" : "nada",
      resultado: !temBureau ? foraTexto
        : (m!.protestos ?? 0) > 0 ? `${m!.protestos} protesto(s)` : "Nada consta",
    },
  ];
  return linhas;
}

/**
 * Card de painel. O título leva ponto final — é uma afirmação sobre o CPF, não
 * o nome de uma gaveta.
 */
function Painel({ titulo, sub, children }: {
  titulo: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <p className="text-[14px] font-bold tracking-[-0.02em] text-[var(--text)]">{titulo}</p>
      {sub && <p className="text-[12px] text-[var(--text-muted)] mt-1">{sub}</p>}
      <div className={sub ? "mt-[18px]" : "mt-3"}>{children}</div>
    </div>
  );
}

/** Card de lista com cabeçalho próprio e contagem à direita. */
function PainelLista({ titulo, meta, children }: {
  titulo: string; meta: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--border-faint)]">
        <span className="text-[14px] font-bold tracking-[-0.02em] text-[var(--text)]">{titulo}</span>
        <span className="font-mono text-[12px] tabular-nums text-[var(--text-muted)] shrink-0">{meta}</span>
      </div>
      {children}
    </div>
  );
}

/** Faixa de rodapé do card de lista — o fato que não cabe numa linha da lista. */
function RodapeFato({ titulo, sub, children }: {
  titulo: string; sub: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 bg-[var(--surface-2)]">
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold text-[var(--text)]">{titulo}</p>
        <p className="text-[11.5px] text-[var(--text-muted)]">{sub}</p>
      </div>
      <span className="shrink-0">{children}</span>
    </div>
  );
}

/** Par rótulo/valor com filete embaixo, do card de renda. */
function ParFilete({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-[9px] border-b border-[var(--border-faint)] text-[13px]">
      <span className="text-[var(--text-muted)]">{rotulo}</span>
      <span className="font-mono font-semibold tabular-nums text-[var(--text)] text-right">{valor}</span>
    </div>
  );
}

/**
 * Barra de intensidade A–H. Oito segmentos: A acende os oito, H nenhum.
 * A letra sozinha exige que o operador saiba a escala de cabeça.
 */
function BarraIntensidade({ rotulo, letra }: { rotulo: string; letra?: string }) {
  const c = (letra ?? "").trim().toUpperCase();
  const acesos = /^[A-H]$/.test(c) ? 9 - (c.charCodeAt(0) - 64) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-[5px]">
        <span className="text-[13px] text-[var(--text-2)]">{rotulo}</span>
        <span className="font-mono text-[12px] font-semibold text-[var(--text-muted)]">{ESCALA(letra)}</span>
      </div>
      <div className="flex gap-[3px]">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i}
            className={`flex-1 h-1.5 rounded-[2px] ${i < acesos ? "bg-[var(--brand)]" : "bg-[var(--surface-inset)]"}`} />
        ))}
      </div>
    </div>
  );
}

/**
 * Bureau de mercado. Só existe quando o provedor habilita os datasets de
 * parceiro; enquanto não habilita, o card inteiro some e a nota de rodapé
 * continua sendo a única menção. Nunca renderize "—" aqui: campo vazio dá a
 * entender que o bureau respondeu "não há", quando ele nem foi consultado.
 */
function PainelMercado({ mercado }: { mercado: NonNullable<Resultado["mercado"]> }) {
  const temScore = mercado.score != null;
  const temFlags = mercado.negativado != null || mercado.temRegistroMinimo != null;
  const temDetalhe = mercado.negativacoesAtivas != null || mercado.negativacoes.length > 0;
  if (!temScore && !temFlags && !temDetalhe && !mercado.classeCadastral) return null;

  // Mesmas faixas do arco de score, mas sobre 999 em vez de 1000.
  const tom: Tom = !temScore ? "neutro"
    : mercado.score! >= 700 ? "ok" : mercado.score! >= 300 ? "alerta" : "perigo";

  const ativas = mercado.negativacoesAtivas ?? 0;
  const segmentos = Object.entries(mercado.consultasPorSegmento ?? {})
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
      data-testid="painel-mercado">
      <div className="px-5 pt-5 pb-4">
        <p className="text-[14px] font-bold tracking-[-0.02em] text-[var(--text)]">
          Fora da rede de provedores.
        </p>
        <p className="text-[12px] text-[var(--text-muted)] mt-1">
          Histórico de crédito deste CPF no mercado inteiro, não só entre provedores.
        </p>

        <div className="flex flex-wrap items-start gap-x-10 gap-y-4 mt-[18px]">
          {temScore && (
            <div className="min-w-0">
              <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Score de crédito
              </span>
              <p className={`font-mono text-[30px] font-semibold tabular-nums leading-none mt-1.5 ${TEXTO_TOM[tom]}`}>
                {mercado.score}
                <span className="text-[13px] font-normal text-[var(--text-muted)]"> de 999</span>
              </p>
              {/* A frase do bureau em português vale mais que o número: o
                  operador de balcão não precisa saber ler escala de score. */}
              {mercado.scoreExplicacao && (
                <p className="text-[12px] text-[var(--text-muted)] mt-2 max-w-[46ch] leading-relaxed">
                  {mercado.scoreExplicacao}
                </p>
              )}
            </div>
          )}

          {temDetalhe && (
            <div>
              <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Dívida em aberto
              </span>
              <p className={`font-mono text-[30px] font-semibold tabular-nums leading-none mt-1.5 ${
                (mercado.dividaTotal ?? 0) > 0 ? "text-[var(--past)]" : "text-[var(--ok)]"}`}>
                {mercado.dividaTotal != null
                  ? `R$ ${mercado.dividaTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                  : "—"}
              </p>
              <p className="text-[12px] text-[var(--text-muted)] mt-2">
                {ativas > 0 ? `${ativas} negativação(ões) ativa(s)` : "nenhuma negativação ativa"}
                {mercado.negativacoesInativas ? ` · ${mercado.negativacoesInativas} quitada(s)` : ""}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-1.5 flex-wrap mt-4">
          {mercado.negativado != null && ativas === 0 && (
            <Chip tom={mercado.negativado ? "perigo" : "ok"}>
              {mercado.negativado ? "Indício de negativação" : "Sem indício de negativação"}
            </Chip>
          )}
          {(mercado.protestos ?? 0) > 0 && (
            <Chip tom="perigo">{mercado.protestos} protesto(s) em cartório</Chip>
          )}
          {(mercado.apontamentosJudiciais ?? 0) > 0 && (
            <Chip tom="alerta">{mercado.apontamentosJudiciais} apontamento(s) judicial(is)</Chip>
          )}
          {/* Quem não tem cadastro mínimo não tem histórico — não é bom nem
              ruim, é ausência. Por isso tom neutro, nunca verde. */}
          {mercado.temRegistroMinimo === false && (
            <Chip tom="neutro">Sem cadastro nos bureaus</Chip>
          )}
          {mercado.classeCadastral && (
            <Chip tom={["A", "B"].includes(mercado.classeCadastral.toUpperCase()) ? "ok" : "alerta"}>
              Ficha classe {mercado.classeCadastral}
              {mercado.classeCadastralDescricao ? ` · ${mercado.classeCadastralDescricao.toLowerCase()}` : ""}
            </Chip>
          )}
          {mercado.ultimaNegativacao && (
            <Chip tom="neutro">última em {fmtData(mercado.ultimaNegativacao)}</Chip>
          )}
        </div>
      </div>

      {/* Quem cobrou, quanto e quando. Só o birô devolve o nome do credor —
          sem ele o operador vê um número e não tem o que negociar. */}
      {mercado.negativacoes.length > 0 && (
        <div className="border-t border-[var(--border-faint)]">
          <div className="px-5 py-2.5 bg-[var(--surface-2)]">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Quem está cobrando
            </span>
          </div>
          {mercado.negativacoes.map((n, i) => (
            <div key={i} data-testid={"negativacao-" + i}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 border-t border-[var(--border-faint)]">
              <span className="text-[13.5px] font-semibold text-[var(--text)] min-w-0">{n.credor}</span>
              {n.ocorrencias > 1 && (
                <span className="text-[12px] text-[var(--text-muted)]">{n.ocorrencias} ocorrências</span>
              )}
              <span className="ml-auto flex items-baseline gap-3 shrink-0">
                {n.ultima && (
                  <span className="font-mono text-[11px] tabular-nums text-[var(--text-faint)]">
                    {fmtData(n.ultima)}
                  </span>
                )}
                <span className="font-mono text-[13.5px] font-semibold tabular-nums text-[var(--past)]">
                  R$ {n.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* O dado mais revelador para um bureau de provedores: os concorrentes
          que já avaliaram este mesmo CPF, com nome e cidade. */}
      {mercado.quemConsultou.length > 0 && (
        <div className="border-t border-[var(--border-faint)]">
          <div className="flex items-center justify-between gap-3 px-5 py-2.5 bg-[var(--surface-2)]">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Quem já consultou este CPF
            </span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
              {mercado.consultas30d != null ? `${mercado.consultas30d} em 30 dias` : mercado.quemConsultou.length}
            </span>
          </div>
          {mercado.quemConsultou.slice(0, 6).map((c, i) => (
            <div key={i} data-testid={"consulta-anterior-" + i}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5 border-t border-[var(--border-faint)]">
              <span className="text-[13px] text-[var(--text)] min-w-0">{c.empresa}</span>
              {c.cidadeUf && <span className="text-[12px] text-[var(--text-muted)]">{c.cidadeUf}</span>}
              {c.data && (
                <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--text-faint)] shrink-0">
                  {fmtData(c.data)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Consulta por ramo: "Telecomunicações: 4" é o migrador serial escrito
          por extenso — quatro concorrentes avaliaram este CPF. */}
      {segmentos.length > 0 && (
        <div className="border-t border-[var(--border-faint)] px-5 py-3 bg-[var(--surface-2)]">
          <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] mb-2">
            Consultas por ramo
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {segmentos.map(([ramo, n]) => (
              <Chip key={ramo} tom="neutro">{ramo.toLowerCase()} · {n}</Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Processo = NonNullable<Resultado["processos"]>[number];

/**
 * Tabela de processos no formato do relatório de bureau: barra de título,
 * uma linha por ocorrência, "NÃO CONSTAM OCORRÊNCIAS" ocupando a linha
 * inteira quando vazio — listar o vazio é o que prova que a checagem rodou —
 * e rodapé com o total, como nas tabelas de Pendências/Protesto da Serasa.
 */
/**
 * Capacidade de pagar — o que SOBRA, não o que entra.
 *
 * Renda bruta já tem card próprio. Este responde outra pergunta: depois das
 * despesas da casa, resta dinheiro para a mensalidade? É o número que decide um
 * plano de R$ 100, e nenhum score de crédito o entrega.
 */
function PainelCapacidade({ c }: { c: NonNullable<Resultado["capacidade"]> }) {
  const temAlgo = c.sobraMensal || c.despesaMensal || c.rendaFamiliar
    || c.recebeBeneficio || c.percentualBeneficio || c.dependentes > 0;
  if (!temAlgo) return null;

  const sm = (v?: string) => v?.toLowerCase().replace(/\bsm\b/g, "SM");

  return (
    <Painel titulo="Capacidade de pagar." sub="Faixas estatísticas da renda da casa, não comprovação.">
      <Pares cols={2}>
        <Linha rotulo="Sobra por mês" valor={sm(c.sobraMensal) ?? "—"} />
        <Linha rotulo="Despesa mensal" valor={sm(c.despesaMensal) ?? "—"} />
        <Linha rotulo="Renda da casa" valor={sm(c.rendaFamiliar) ?? "—"} />
        <Linha rotulo="Dependentes" valor={c.dependentes} />
      </Pares>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {c.ehResponsavel && <Chip tom="neutro">Responsável pelo domicílio</Chip>}
        {c.ehDependente && <Chip tom="alerta">Provável dependente</Chip>}
        {c.origemRenda && <Chip tom="neutro">Renda: {c.origemRenda.toLowerCase()}</Chip>}
        {/* Benefício não é demérito — é origem de renda, e origem de renda muda
            a leitura de estabilidade. Por isso tom neutro, nunca alerta. */}
        {c.recebeBeneficio && (
          <Chip tom="neutro">
            Recebe benefício social{c.beneficiosAtivos > 1 ? ` · ${c.beneficiosAtivos} ativos` : ""}
          </Chip>
        )}
        {c.beneficiariosNaFamilia > 0 && (
          <Chip tom="neutro">{c.beneficiariosNaFamilia} beneficiário(s) na casa</Chip>
        )}
      </div>

      {c.percentualBeneficio && (
        <p className="text-[12px] text-[var(--text-muted)] mt-3">
          Participação do benefício na renda da casa:{" "}
          <span className="font-mono tabular-nums text-[var(--text-2)]">
            {c.percentualBeneficio.toLowerCase()}
          </span>
        </p>
      )}
    </Painel>
  );
}

/**
 * Domicílio e rede próxima.
 *
 * LGPD: por padrão só CONTAGEM. Os nomes são de terceiros que nunca pediram
 * nada ao provedor, e o próprio titular ainda não é cliente dele — sem
 * ocorrência entre os relacionados, saber o nome de um parente não muda decisão
 * nenhuma, só expõe uma pessoa. O servidor decide (`nomesLiberados`); a tela
 * apenas explica ao operador por que os nomes apareceram.
 */
function PainelDomicilio({ d }: { d: NonNullable<Resultado["domicilio"]> }) {
  if (d.totalRelacionados === 0 && d.noDomicilio === 0) return null;

  return (
    <PainelLista
      titulo="Domicílio e rede próxima."
      meta={`${d.totalRelacionados} vínculo${d.totalRelacionados === 1 ? "" : "s"}`}
    >
      <div className="px-5 py-4">
        <Pares cols={2}>
          <Linha rotulo="No mesmo domicílio" valor={d.noDomicilio} alerta={d.noDomicilio > 0} />
          <Linha rotulo="Vizinhos" valor={d.vizinhos} />
          <Linha rotulo="Parentes" valor={d.parentes} />
          <Linha rotulo="Cônjuge" valor={d.conjuges} />
          <Linha rotulo="Sócios" valor={d.socios} />
          <Linha rotulo="Colegas de trabalho" valor={d.colegasTrabalho} />
        </Pares>

        {d.nomesLiberados && d.nomes.length > 0 ? (
          <div className="mt-4">
            <p className="text-[11.5px] text-[var(--text-muted)] mb-2">
              Nomes exibidos porque há ocorrência de cobrança entre os relacionados.
            </p>
            <div className="divide-y divide-[var(--border-faint)]">
              {d.nomes.map((n, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-[13px] text-[var(--text)] truncate">{n.nome}</span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] shrink-0">
                    {n.vinculo}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[11.5px] text-[var(--text-muted)] mt-3">
            Identificação dos relacionados fica oculta: sem ocorrência no endereço,
            o nome de terceiro não entra na consulta (LGPD).
          </p>
        )}
      </div>

      {d.noDomicilio > 0 && (
        <RodapeFato
          titulo={`${d.noDomicilio} pessoa${d.noDomicilio === 1 ? "" : "s"} no mesmo domicílio`}
          sub="Reinstalação no mesmo imóvel com outro CPF é o padrão de fraude mais comum do setor."
        >
          <Chip tom="alerta">verificar</Chip>
        </RodapeFato>
      )}
    </PainelLista>
  );
}

/**
 * Segurança do endereço — a chance de o equipamento sumir.
 *
 * Não fala da pessoa: fala do lugar onde a ONU vai ficar. Um titular que paga
 * em dia num endereço de roubo alto continua sendo um comodato em risco, e
 * nenhum dado de crédito responde isso.
 */
function PainelSeguranca({ s }: { s: NonNullable<Resultado["seguranca"]> }) {
  if (s.score == null && s.roubo == null) return null;

  const riscos: Array<[string, number | undefined]> = [
    ["Roubo", s.roubo],
    ["Violência", s.violencia],
    ["Narcotráfico", s.narcotrafico],
    ["Furto de veículo", s.furtoVeiculo],
  ];
  const pior = Math.max(...riscos.map(([, v]) => v ?? 0));
  // A escala do bureau é aberta: comparo os quatro entre si em vez de cravar um
  // teto que a fonte não define.
  const tom: Tom = pior >= 30 ? "perigo" : pior >= 15 ? "alerta" : "ok";

  return (
    <Painel
      titulo="Segurança do endereço."
      sub={[s.cidade, s.uf].filter(Boolean).join("/") || "Endereço principal do titular."}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[26px] font-semibold tabular-nums leading-none text-[var(--text)]">
          {s.score ?? "—"}
        </span>
        {s.nivel && (
          <span className="font-mono text-[12px] text-[var(--text-muted)]">
            nível {s.nivel}
          </span>
        )}
      </div>

      <div className="mt-4">
        <Pares cols={2}>
          {riscos.map(([rotulo, v]) => (
            <Linha key={rotulo} rotulo={rotulo} valor={v ?? "—"} alerta={(v ?? 0) >= 15} />
          ))}
        </Pares>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        <Chip tom={tom}>
          {tom === "ok" ? "Área tranquila" : tom === "alerta" ? "Atenção ao comodato" : "Comodato em risco"}
        </Chip>
        {s.ocorrenciasPorMes != null && s.ocorrenciasPorMes > 0 && (
          <Chip tom="neutro">{s.ocorrenciasPorMes} ocorrências/mês na região</Chip>
        )}
        {s.totalEnderecos > 1 && (
          <Chip tom="alerta">{s.totalEnderecos} endereços · {s.totalCidades} cidade(s)</Chip>
        )}
      </div>
    </Painel>
  );
}

function TabelaProcessos({ processos }: { processos: Processo[] }) {
  const comoReu = processos.filter(p => p.papel === "réu").length;
  const valorTotal = processos.reduce((s, p) => s + (p.valor ?? 0), 0);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
      data-testid="tabela-processos">
      <div className="flex items-center justify-between gap-3 px-5 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border-faint)]">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Processos judiciais e administrativos
        </span>
        {processos.length > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
            fonte pública · tribunais
          </span>
        )}
      </div>

      {processos.length === 0 ? (
        <p className="px-5 py-3.5 text-[13px] font-semibold text-[var(--ok)]">
          Não constam ocorrências
        </p>
      ) : (
        <>
          {/* Tabela real com rolagem própria: 6 colunas não cabem em 375px, e o
              design system manda a rolagem ficar no container, nunca na página. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr>
                  {["Data", "Tipo", "Assunto", "Tribunal", "Situação", "Papel", "Valor"].map(h => (
                    <th key={h}
                      className={`text-[9.5px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)] px-4 py-2 border-b border-[var(--border)] ${h === "Valor" ? "text-right" : "text-left"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {processos.map((p, i) => (
                  <tr key={i} data-testid={`processo-${i}`}
                    className="border-b border-[var(--border-faint)] last:border-b-0">
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--text-2)] whitespace-nowrap">
                      {fmtData(p.data)}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text)]">{p.tipo?.toLowerCase() ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[var(--text-muted)]">{p.assunto?.toLowerCase() ?? "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-[var(--text-muted)] whitespace-nowrap">
                      {[p.tribunal, p.uf].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-[var(--text-muted)]">{p.status?.toLowerCase() ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {/* Só o polo passivo pesa: ser autor não diz nada sobre pagar. */}
                      <Chip tom={p.papel === "réu" ? "perigo" : "neutro"}>{p.papel}</Chip>
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-right text-[var(--text)] whitespace-nowrap">
                      {p.valor != null
                        ? `R$ ${p.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-2.5 bg-[var(--surface-2)] border-t border-[var(--border-faint)] text-[12px] text-[var(--text-muted)]">
            <span>
              Total de ocorrências:{" "}
              <span className="font-mono font-semibold tabular-nums text-[var(--text)]">{processos.length}</span>
              {" "}· como réu:{" "}
              <span className="font-mono font-semibold tabular-nums text-[var(--past)]">{comoReu}</span>
            </span>
            {valorTotal > 0 && (
              <span className="ml-auto">
                Valor total informado:{" "}
                <span className="font-mono font-semibold tabular-nums text-[var(--text)]">
                  R$ {valorTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </span>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Salário mínimo de referência — mesmo valor usado no veredito do servidor. */
const SALARIO_MINIMO = 1518;
/** Teto da régua de renda. R$ 35.000 ≈ 23 SM; acima disso nada muda na decisão. */
const TETO_RENDA = 35000;

/** "ACIMA DE 20 SM" · "3 A 5 SM" · "ATE 2 SM" → intervalo em reais. */
function faixaEmReais(faixa?: string | null): { de: number; ate: number | null } | null {
  if (!faixa) return null;
  const f = faixa.trim().toUpperCase();
  if (f === "SEM INFORMACAO") return null;
  const sm = (s: string) => parseFloat(s.replace(",", ".")) * SALARIO_MINIMO;

  let m = f.match(/^ACIMA DE\s+([\d.,]+)\s*SM$/);
  if (m) return { de: sm(m[1]), ate: null };
  m = f.match(/^ATE\s+([\d.,]+)\s*SM$/);
  if (m) return { de: 0, ate: sm(m[1]) };
  m = f.match(/^([\d.,]+)\s*A\s*([\d.,]+)\s*SM$/);
  if (m) return { de: sm(m[1]), ate: sm(m[2]) };
  return null;
}

const pctRenda = (v: number) => Math.max(0, Math.min(100, (v / TETO_RENDA) * 100));

/**
 * Régua de renda: onde este CPF cai contra a média da própria região.
 * "R$ 3.000" sozinho não diz se é muito ou pouco para o bairro dele — a
 * comparação é que informa, e ela já vem na resposta (fonte IBGE).
 */
function BarraRenda({ faixa, fontes }: {
  faixa?: string;
  fontes: Array<{ fonte: string; faixa: string; emReais: string | null; formal: boolean }>;
}) {
  const alvo = faixaEmReais(faixa);
  if (!alvo) return null;
  // "acima de N SM" não tem topo: o próprio piso é a posição.
  const ponto = alvo.ate == null ? alvo.de : (alvo.de + alvo.ate) / 2;

  const fonteIbge = fontes.find(f => f.fonte === "Média IBGE da região");
  const ibge = faixaEmReais(fonteIbge?.faixa);
  const ibgeDe = ibge ? pctRenda(ibge.de) : 0;
  const ibgeAte = ibge ? pctRenda(ibge.ate ?? TETO_RENDA) : 0;

  return (
    <div className="mt-5">
      <div className="relative h-2 rounded-full bg-[var(--surface-inset)]">
        {ibge && (
          <div className="absolute top-0 bottom-0 rounded-full bg-[var(--border-strong)]"
            style={{ left: `${ibgeDe}%`, width: `${Math.max(1.5, ibgeAte - ibgeDe)}%` }} />
        )}
        <div className="absolute -top-1 -bottom-1 w-[3px] rounded-full bg-[var(--ok)]"
          style={{ left: `${pctRenda(ponto)}%` }} />
      </div>
      <div className="flex justify-between gap-3 mt-2 text-[11.5px] text-[var(--text-muted)]">
        <span>
          {fonteIbge
            ? `Média IBGE da região · ${(fonteIbge.emReais ?? fonteIbge.faixa).replace("/mês", "")}`
            : "Sem média regional para comparar"}
        </span>
        <span className="text-[var(--ok)] font-semibold shrink-0">Este CPF</span>
      </div>
    </div>
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

type Nivel = { id: string; rotulo: string; descricao: string; creditos: number };

/** Fallback: se a lista não vier da API, a tela ainda oferece o nível básico. */
const NIVEIS_PADRAO: Nivel[] = [
  { id: "padrao", rotulo: "Padrão", descricao: "Receita, endereço, renda, cobranças e processos", creditos: 1 },
];

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

                {!mutation.isPending && resultado && v && (
                  <div className="space-y-4" data-testid="consultation-result">

              {/* VEREDITO — a decisão é o produto. Conteúdo à esquerda, arco de
                  score em painel próprio à direita: o score deixa de ser mais um
                  número na fila e vira a segunda coisa que o olho encontra. */}
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
                    {/* Sem isto o operador não sabe se a ausência de negativação
                        é "não deve nada" ou "não perguntei". */}
                    {resultado.nivel && (
                      <Chip tom="neutro">
                        consulta {(data?.niveis ?? NIVEIS_PADRAO).find((n: Nivel) => n.id === resultado.nivel)?.rotulo ?? resultado.nivel}
                        {resultado.creditosCobrados ? ` · ${resultado.creditosCobrados} cr` : ""}
                      </Chip>
                    )}
                    {/* Protocolo do relatório — bureau emite documento, não tela.
                        Dá ao operador o que citar num contrato ou contestação. */}
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--text-faint)]">
                      Nº {String(resultado.id).padStart(6, "0")}
                      {resultado.createdAt
                        ? ` · ${new Date(resultado.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
                        : ""}
                    </span>
                  </div>

                  {/* Identidade grande: o operador confirma que consultou a pessoa
                      certa antes de olhar qualquer número. */}
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
                    {/* Nascimento e filiação — o que o balcão confere contra o
                        documento com foto. O relatório da Serasa abre com isso. */}
                    {(resultado.identidade?.nascimento || resultado.identidade?.nomeMae) && (
                      <p className="font-mono text-[12px] tabular-nums text-[var(--text-faint)] mt-0.5">
                        {resultado.identidade?.nascimento ? `nascimento ${fmtData(resultado.identidade.nascimento)}` : ""}
                        {resultado.identidade?.nascimento && resultado.identidade?.nomeMae ? " · " : ""}
                        {resultado.identidade?.nomeMae ? `mãe ${resultado.identidade.nomeMae}` : ""}
                      </p>
                    )}
                  </div>

                  {d?.encontrado && (
                    <div className="flex gap-2 flex-wrap">
                      <Chip tom={d.taxIdStatus?.toUpperCase() === "REGULAR" ? "ok" : "alerta"}>
                        {d.taxIdStatus?.toUpperCase() === "REGULAR" ? "CPF regular na Receita" : `CPF ${d.taxIdStatus}`}
                      </Chip>
                      <Chip tom={d.temObito ? "alerta" : "ok"}>
                        {d.temObito ? "Com indicação de óbito" : "Sem indicação de óbito"}
                      </Chip>
                      {resultado.risco.empregado != null && (
                        <Chip tom={resultado.risco.empregado ? "ok" : "alerta"}>
                          {resultado.risco.empregado ? "Empregado" : "Sem vínculo formal"}
                          {resultado.risco.socio ? " · sócio de empresa" : ""}
                        </Chip>
                      )}
                      {/* Não está no mockup: o bloco de identidade saiu e levou junto
                          a validação de nascimento, que é sinal de fraude. Entra aqui
                          só quando há divergência. */}
                      {d.nascimentoValidadoNaReceita === false && (
                        <Chip tom="alerta">Nascimento não confere na Receita</Chip>
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

                {/* Painel do score. Arco em vez de número solto: a posição na
                    escala se lê antes do valor. */}
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

              {d?.encontrado && (
                <>
                  {/* RESUMO DA CONSULTA — o esqueleto do relatório de bureau:
                      toda verificação listada, inclusive as "Nada consta". */}
                  <ResumoConsulta linhas={montarResumo(resultado)} />

                  {/* Bureau pedido e não entregue. Sem este aviso o operador lê
                      a ausência do painel como "CPF limpo no mercado", quando na
                      verdade ninguém consultou. */}
                  {resultado.bureauIndisponivel && (
                    <div className="rounded-lg border border-[var(--gated-border)] bg-[var(--gated-bg)] px-4 py-3 flex gap-2.5"
                      data-testid="aviso-bureau-indisponivel">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-px text-[var(--gated)]" />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-[var(--gated)]">
                          Consulta {(data?.niveis ?? NIVEIS_PADRAO).find((n: Nivel) => n.id === resultado.nivelPedido)?.rotulo ?? "Completa"} pedida, mas os bureaus não retornaram dados
                        </p>
                        <p className="text-[12.5px] text-[var(--text-muted)] mt-0.5 leading-relaxed">
                          Negativação, dívida, protestos e score de mercado não vieram
                          nesta consulta — bureau ainda não liberado ou fora do ar. Você
                          foi cobrado apenas {resultado.creditosCobrados ?? 1} crédito;
                          a diferença voltou para o saldo. Tente novamente mais tarde ou
                          confirme a liberação no BDC Center.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Só aparece com os datasets de bureau habilitados. */}
                  {resultado.mercado && <PainelMercado mercado={resultado.mercado} />}

                  {/* Capacidade e segurança lado a lado: um diz se PODE pagar,
                      o outro se o equipamento volta. São as duas perguntas que o
                      provedor faz antes de mandar o técnico. */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    {resultado.capacidade && <PainelCapacidade c={resultado.capacidade} />}
                    {resultado.seguranca && <PainelSeguranca s={resultado.seguranca} />}
                  </div>

                  {resultado.domicilio && <PainelDomicilio d={resultado.domicilio} />}

                  {/* Capacidade à esquerda, comportamento à direita. */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    <Painel titulo="Renda e patrimônio." sub="Estimativa estatística, não comprovação de renda.">
                      <p className="font-mono text-[26px] font-semibold tracking-[-0.02em] tabular-nums leading-none text-[var(--text)]">
                        {resultado.renda.emReais
                          ? <>
                              {resultado.renda.emReais.replace("/mês", "")}
                              <span className="text-[14px] font-normal text-[var(--text-muted)]">/mês</span>
                            </>
                          : "sem informação"}
                      </p>
                      <p className="text-[12px] text-[var(--text-muted)] mt-1">
                        {resultado.renda.faixa
                          // A faixa vem em caixa alta do bureau; só a sigla SM fica.
                          ? `Faixa de referência · ${resultado.renda.faixa.toLowerCase().replace(/\bsm\b/g, "SM")}`
                          : "Sem faixa de referência para este CPF"}
                      </p>

                      <BarraRenda faixa={resultado.renda.faixa} fontes={resultado.renda.fontes} />

                      <div className="mt-5 border-t border-[var(--border-faint)]">
                        {/* MTE é registro do Ministério do Trabalho: vínculo formal,
                            não estimativa. Quando existe, é o número confiável. */}
                        {resultado.renda.rendaFormal && (
                          <ParFilete
                            rotulo={resultado.renda.rendaFormal.fonte}
                            valor={(resultado.renda.rendaFormal.emReais ?? resultado.renda.rendaFormal.faixa).replace("/mês", "")}
                          />
                        )}
                        {resultado.renda.fontes
                          .filter(f => !f.formal && f.fonte !== "Média IBGE da região")
                          .map((f, i) => (
                            <ParFilete key={i} rotulo={f.fonte}
                              valor={(f.emReais ?? f.faixa).replace("/mês", "")} />
                          ))}
                        <ParFilete rotulo="Patrimônio estimado" valor={
                          resultado.renda.patrimonio && resultado.renda.patrimonio !== "SEM INFORMACAO"
                            ? resultado.renda.patrimonio : "sem informação"} />
                        <ParFilete rotulo="Declarações de IR" valor={
                          resultado.renda.declaracoesIR.length > 0
                            ? `desde ${resultado.renda.declaracoesIR[resultado.renda.declaracoesIR.length - 1].ano}`
                            : "nenhuma"} />
                        {/* Estabilidade mora aqui e não num card próprio: a
                            pergunta não é quanto a pessoa ganha, é se ela vai
                            continuar ganhando durante os 12 meses do contrato. */}
                        {resultado.ocupacao && resultado.ocupacao.trocasTotal > 0 && (
                          <>
                            <ParFilete rotulo="Trocas de emprego em 5 anos"
                              valor={resultado.ocupacao.trocas5Anos} />
                            {resultado.ocupacao.mediaAnosPorVinculo != null && (
                              <ParFilete rotulo="Tempo médio por vínculo" valor={
                                `${resultado.ocupacao.mediaAnosPorVinculo.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} anos`} />
                            )}
                          </>
                        )}
                        {/* SocialClass costuma vir vazia; escolaridade e faixa
                            por setor censitário quase sempre vêm. */}
                        {resultado.perfil?.classeSocial && (
                          <ParFilete rotulo="Classe social estimada"
                            valor={resultado.perfil.classeSocial} />
                        )}
                        {resultado.perfil?.escolaridade && (
                          <ParFilete rotulo="Escolaridade estimada"
                            valor={resultado.perfil.escolaridade.toLowerCase()} />
                        )}
                        {resultado.perfil?.faixaRenda && (
                          <ParFilete
                            rotulo={`Renda da região${resultado.perfil.origem ? ` · ${resultado.perfil.origem}` : ""}`}
                            valor={resultado.perfil.faixaRenda.toLowerCase()} />
                        )}
                      </div>

                      <div className="flex gap-1.5 flex-wrap mt-3.5">
                        {/* Quem some da Receita costuma ser quem some da cobrança. */}
                        {resultado.renda.declaraIrRecorrente && (
                          <Chip tom="ok">
                            Declara IR com recorrência · {resultado.renda.declaracoesIR.length} anos
                          </Chip>
                        )}
                        {resultado.renda.temSegmentoVip && <Chip tom="ok">Segmento premium no banco</Chip>}
                        {/* Vínculo longo é o melhor sinal de que a renda dura
                            mais que o contrato. Só entra quando é bom notícia. */}
                        {resultado.ocupacao?.empregadoAgora &&
                          (resultado.ocupacao.mediaAnosPorVinculo ?? 0) >= 3 && (
                          <Chip tom="ok">Vínculo de trabalho estável</Chip>
                        )}
                        {resultado.ocupacao?.setorPublico && <Chip tom="ok">Já foi servidor público</Chip>}
                      </div>
                    </Painel>

                    <div className="flex flex-col gap-4">
                      <Painel titulo="Rastro no mercado." sub="Intensidade de A (mais alta) a H (ausência de rastro).">
                        <div className="flex flex-col gap-3">
                          <BarraIntensidade rotulo="Uso de cartão" letra={resultado.rastro.usoCartao} />
                          <BarraIntensidade rotulo="Banco digital" letra={resultado.rastro.usoBancoDigital} />
                          <BarraIntensidade rotulo="Busca por crédito" letra={resultado.rastro.buscaCredito} />
                        </div>
                        {/* Consultar demais em 30 dias é o padrão do migrador serial —
                            o mesmo sinal que o score ISP persegue dentro da rede. */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2 mt-[18px] pt-3.5 border-t border-[var(--border-faint)]">
                          {([
                            ["Consultas em 30 dias", resultado.rastro.consultas30d],
                            ["Consultas em 12 meses", resultado.rastro.consultas365d],
                            ["Alterações de nome", resultado.rastro.mudancasNome],
                            ["Veículos", resultado.patrimonio.veiculos],
                          ] as Array<[string, number]>).map(([rotulo, valor]) => (
                            <div key={rotulo} className="flex justify-between gap-2 text-[13px]">
                              <span className="text-[var(--text-muted)]">{rotulo}</span>
                              <span className="font-mono font-semibold tabular-nums text-[var(--text)]">{valor}</span>
                            </div>
                          ))}
                        </div>
                      </Painel>

                    </div>
                  </div>

                  {/* TABELA DE PROCESSOS — modelo de relatório de bureau: cada
                      ocorrência é uma linha com data, tipo, assunto e valor,
                      como as tabelas de Pendências/Protesto do relatório Serasa. */}
                  <TabelaProcessos processos={resultado.processos ?? []} />

                  {/* Vínculo: onde essa pessoa mora e por onde se fala com ela. */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    <PainelLista titulo="Endereços" meta={resultado.enderecos.length}>
                      {resultado.enderecos.length === 0 ? (
                        <p className="px-5 py-4 text-[13px] text-[var(--text-muted)]">
                          Nenhum endereço vinculado a este CPF.
                        </p>
                      ) : resultado.enderecos.map((e, i) => (
                        <div key={i} data-testid={"endereco-" + i}
                          className="flex items-start gap-3 px-5 py-3 border-b border-[var(--border-faint)]">
                          <div className="flex-1 min-w-0">
                            <p className="text-[13.5px] font-semibold text-[var(--text)]">
                              {e.logradouro}{e.numero ? ", " + e.numero : ""}
                              {e.complemento ? " — " + e.complemento : ""}
                            </p>
                            <p className="text-[12px] text-[var(--text-muted)] mt-px">
                              {[e.bairro, [e.cidade, e.uf].filter(Boolean).join("/")]
                                .filter(Boolean).join(" · ")}
                              {e.cep ? " · " + e.cep : ""}
                              {e.naReceita ? " · na Receita" : ""}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              <Chip tom={e.principal ? "marca" : e.ratificado ? "ok" : "alerta"}>
                                {e.principal ? "principal" : e.ratificado ? "ratificado" : "não ratificado"}
                              </Chip>
                              {e.passagensRuins > 0 && (
                                <Chip tom="alerta">{e.passagensRuins} suspeita(s)</Chip>
                              )}
                            </div>
                            <span className="font-mono text-[11px] tabular-nums text-[var(--text-faint)]">
                              visto {fmtData(e.ultimaPassagem)}
                            </span>
                          </div>
                        </div>
                      ))}
                      {/* Nenhum bureau responde isso: é risco operacional, não de
                          crédito. Fica fora do veredito, no rodapé do card. */}
                      <RodapeFato
                        titulo="Risco da área · instalação"
                        sub="Planejamento da visita técnica, fora do veredito"
                      >
                        <Chip tom={AREA_TOM(resultado.riscoArea?.[0]?.ponto)}>
                          {AREA_ROTULO(resultado.riscoArea?.[0]?.ponto)}
                        </Chip>
                      </RodapeFato>
                      {/* Imóvel do endereço principal (só na Completa). Casa
                          térrea e apartamento são visitas técnicas diferentes —
                          e CEP+número que não bate com imóvel nenhum é alerta
                          de endereço inventado. */}
                      {resultado.imovel && (
                        <RodapeFato
                          titulo="Imóvel no endereço principal"
                          sub={[
                            resultado.imovel.tipologia?.toLowerCase(),
                            resultado.imovel.uso?.toLowerCase(),
                            resultado.imovel.areaM2 ? `${resultado.imovel.areaM2} m²` : null,
                            resultado.imovel.comodos ? `${resultado.imovel.comodos} cômodos` : null,
                          ].filter(Boolean).join(" · ") || "sem detalhe do imóvel"}
                        >
                          <Chip tom={resultado.imovel.correspondenciaExata === false ? "alerta" : "ok"}>
                            {resultado.imovel.correspondenciaExata === false
                              ? "endereço não confere"
                              : "endereço confere"}
                          </Chip>
                        </RodapeFato>
                      )}
                    </PainelLista>

                    <PainelLista
                      titulo="Contato"
                      meta={`${resultado.telefones.length} telefones · ${resultado.emails.length} e-mails`}
                    >
                      {resultado.telefones.length === 0 && resultado.emails.length === 0 && (
                        <p className="px-5 py-4 text-[13px] text-[var(--text-muted)]">
                          Nenhum contato vinculado a este CPF.
                        </p>
                      )}
                      {(verTodosFones ? resultado.telefones : resultado.telefones.slice(0, 4)).map((t, i) => (
                        <div key={i} data-testid={"telefone-" + i}
                          // Linha única no desktop, como no mockup; no celular as
                          // pílulas caem para a segunda linha em vez de estourar o card.
                          className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-5 py-[11px] border-b border-[var(--border-faint)]">
                          <span className="font-mono text-[13.5px] font-semibold tabular-nums text-[var(--text)]">
                            {telefoneFmt(t)}
                          </span>
                          <span className="min-w-0 truncate text-[12px] text-[var(--text-muted)]">
                            {[t.tipo === "MOBILE" ? "celular" : t.tipo === "HOME" ? "fixo" : t.tipo?.toLowerCase(),
                              t.operadora].filter(Boolean).join(" · ")}
                          </span>
                          <span className="ml-auto flex items-center gap-1.5 shrink-0">
                            {t.principal && <Chip tom="marca">principal</Chip>}
                            {/* Validação viva da linha principal (só na Completa):
                                operadora AGORA, pós-portabilidade, e bloqueio.
                                Linha bloqueada = cadastro que não atende cobrança. */}
                            {t.principal && resultado.validacaoTelefone && (
                              resultado.validacaoTelefone.bloqueado
                                ? <Chip tom="perigo">linha bloqueada</Chip>
                                : resultado.validacaoTelefone.bloqueado === false
                                  ? <Chip tom="ok">
                                      linha ativa
                                      {resultado.validacaoTelefone.operadoraAtual
                                        ? ` · ${resultado.validacaoTelefone.operadoraAtual.split(" ")[0]}`
                                        : ""}
                                    </Chip>
                                  : null
                            )}
                            {/* Ligar para quem está no não-perturbe expõe o provedor. */}
                            {t.naoPerturbe && <Chip tom="alerta">não perturbe</Chip>}
                            {t.passagensRuins > 0 && <Chip tom="alerta">{t.passagensRuins} suspeita(s)</Chip>}
                            <span className="font-mono text-[11px] tabular-nums text-[var(--text-faint)]">
                              {fmtData(t.ultimaPassagem)}
                            </span>
                          </span>
                        </div>
                      ))}
                      {resultado.telefones.length > 4 && (
                        <div className="px-5 py-[11px] border-b border-[var(--border-faint)]">
                          <button type="button" onClick={() => setVerTodosFones(x => !x)}
                            className="text-[12.5px] font-semibold text-[var(--brand)] hover:underline"
                            data-testid="botao-ver-telefones">
                            {verTodosFones ? "Ver menos" : `Ver todos os ${resultado.telefones.length} telefones`}
                          </button>
                        </div>
                      )}
                      {resultado.emails.map((em, i) => (
                        <div key={i} data-testid={"email-" + i}
                          className="px-5 py-[11px] border-b border-[var(--border-faint)] font-mono text-[13px] text-[var(--text-2)] break-all">
                          {em}
                        </div>
                      ))}
                      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 px-5 py-[11px] text-[13px] bg-[var(--surface-2)]">
                        <span className="text-[var(--text-muted)] shrink-0">Nome da mãe · homônimos</span>
                        <span className="font-mono font-semibold text-[var(--text)] sm:text-right">
                          {resultado.identidade.nomeMae ?? "—"} · {d.homonimos ?? 0}
                        </span>
                      </div>
                    </PainelLista>
                  </div>
                </>
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

              {/* Rodapé de relatório. O disclaimer não é enfeite: a LGPD dá ao
                  titular o direito de rever decisão automatizada, e o texto
                  deixa claro que quem decide é o provedor, não o sistema. */}
              <p className="text-[11px] leading-relaxed text-[var(--text-faint)] border-t border-[var(--border-faint)] pt-3">
                Consulta registrada sob o protocolo{" "}
                <span className="font-mono tabular-nums">Nº {String(resultado.id).padStart(6, "0")}</span>
                {" "}· Base legal: legítimo interesse para análise de risco de crédito
                (LGPD, art. 7º, IX). As informações são subsidiárias à decisão de
                contratação, que é de exclusiva responsabilidade do provedor — o
                titular pode solicitar revisão da decisão.
              </p>
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
