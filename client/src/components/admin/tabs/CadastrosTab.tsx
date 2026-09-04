import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, STALE_LISTS } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  Activity, Search, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle,
  User, Mail, FileText, Globe, CreditCard, Users, Trash2, Eye, Building2, SearchX, HelpCircle,
} from "lucide-react";
import {
  TITULO_CARTAO, Selo, EstadoVazio, LinhasSkeleton, LadrilhoInicial,
  BOTAO_SECUNDARIO, BOTAO_MARCA, DESABILITAVEL, type Icone, type TomSelo,
} from "@/components/painel/ui";
import { PLAN_LABELS, VERIFICATION_LABELS } from "../constants";
import { acaoExcluirProvedor, type AcaoProvedor } from "../acoes-provedor";

/**
 * Cadastros vindos do site, vestidos na MESMA linguagem do Painel do Provedor.
 *
 * Rodada de LINGUAGEM VISUAL: nenhuma rota, consulta, permissao, dado ou
 * data-testid mudou. O que mudou foi de que vocabulario a tela fala — os 41 usos
 * da API antiga de token e as classes cruas da paleta default do Tailwind
 * sairam, e as pecas passaram a vir de `@/components/painel/ui`.
 *
 * QUATRO DECISOES QUE VALE REGISTRAR
 *
 * 1. O `VERIFICATION_LABELS` local — a copia que devolvia string de classe na
 *    API antiga de token — morreu. O catalogo em `../constants` publica em
 *    `{ label, tom, Icone }`, e a saturacao ali E legitima: pendente / aprovado
 *    / rejeitado e exatamente o eixo que a secao 3 do DESIGN_SYSTEM reserva para
 *    ela — `gated` e a porta que ainda nao abriu, `danger` e a que fechou, `ok` e
 *    a que abriu. Duas copias do mesmo mapa e como a divergencia comeca.
 *
 * 2. Os quatro cartoes-contador viraram um SEGMENTADO. Eram blocos com numero
 *    de 24px em peso bold — fora do mono tabular — preenchidos de cor cheia
 *    quando ativos: quatro superficies saturadas lado a lado, tres delas em
 *    classes cruas da paleta default do Tailwind. O papel
 *    deles nao e METRICA e sim NAVEGACAO dentro da lista, e navegacao/estado
 *    ativo e justamente o que a berinjela existe para marcar (secao 3.4). Como
 *    chip, o controle reaproveita `BOTAO_SECUNDARIO` inteiro em vez de redigitar
 *    a casca de um cartao, a contagem fica mono tabular, e a cor semantica de
 *    cada situacao sobra para o icone — um marcador, nao um preenchimento. Quem
 *    carrega a situacao com forca e o `Selo` de cada linha, que e onde ela de
 *    fato se aplica a um cadastro.
 *
 * 3. AS COPIAS LOCAIS MORRERAM. Tres pecas eram escritas a mao aqui e agora vem
 *    de `@/components/painel/ui`: o estado desabilitado (era opacidade 40 com
 *    `pointer-events-none`), o ladrilho de inicial do provedor e o titulo da
 *    linha — este ultimo redigitado letra por letra ao lado do proprio
 *    `TITULO_CARTAO` que o arquivo ja importava. Copia manuscrita de primitiva
 *    viva e como a divergencia volta: o proximo ajuste seria feito de um lado so.
 *
 * 4. "Aprovar" e o unico botao de marca da linha. Antes o preenchimento forte
 *    era o "Ver" (`variant="default"`), e sobre uma pilha de seis controles isso
 *    dava destaque de CTA para a acao mais inofensiva de todas. A acao que a fila
 *    de cadastros existe para receber e a aprovacao; "Ver" desceu para
 *    secundario, e as destrutivas ("Rejeitar", "Excluir") levam a tinta de
 *    `--danger` sobre fundo de superficie, nunca preenchidas — preenchimento
 *    vermelho ao lado do CTA disputaria o clique com ele.
 */

/* ------------------------------------------------------------------ */
/* Vocabulario de dominio desta tela                                   */
/* ------------------------------------------------------------------ */

/** SITUACAO DO PROVEDOR, em portugues.
 *
 *  `providers.status` guarda 'active' | 'suspended' | 'cancelled'. A tela lia
 *  so `=== "active"` e chamava todo o resto de "Inativo" — um provedor cancelado
 *  e um suspenso apareciam iguais para quem decide o que fazer com o cadastro.
 *  A coluna e TEXT livre, entao um valor fora dos tres ainda e possivel: cai no
 *  ramo desconhecido, que NAO afirma inatividade que ninguem verificou. */
const SITUACAO_PROVEDOR: Record<string, { rotulo: string; ponto: string }> = {
  active: { rotulo: "Ativo", ponto: "bg-[var(--ok)]" },
  suspended: { rotulo: "Suspenso", ponto: "bg-[var(--gated)]" },
  cancelled: { rotulo: "Cancelado", ponto: "bg-[var(--danger)]" },
};

const SITUACAO_DESCONHECIDA = { rotulo: "Situação desconhecida", ponto: "bg-[var(--text-faint)]" } as const;

/** Mesmo tratamento para a conferencia: `verification_status` tambem e TEXT
 *  livre. A tela caia em "Pendente" para qualquer valor fora dos tres, ou seja,
 *  colocava na fila de conferencia um cadastro cujo estado ninguem sabe — e o
 *  selo amarelo ainda afirmava que ele esta esperando alguem. Neutro e o que se
 *  pode dizer com honestidade. */
const CONFERENCIA_DESCONHECIDA = { label: "Conferência desconhecida", tom: "neutro" as TomSelo, Icone: HelpCircle };

/** Os filtros da fila. O rotulo esta no plural porque nomeia um conjunto, e nao
 *  a situacao de um cadastro — por isso nao sai de `VERIFICATION_LABELS`. O
 *  icone e a tinta, sim, saem de la: dois desenhos diferentes para o mesmo
 *  estado no mesmo ecra seria a divergencia em miniatura. */
const FILTROS: Array<{ chave: string; rotulo: string; Icone: Icone; tinta: string }> = [
  { chave: "all", rotulo: "Todos", Icone: Activity, tinta: "text-[var(--text-faint)]" },
  { chave: "pending", rotulo: "Pendentes", Icone: VERIFICATION_LABELS.pending.Icone, tinta: "text-[var(--gated)]" },
  { chave: "approved", rotulo: "Aprovados", Icone: VERIFICATION_LABELS.approved.Icone, tinta: "text-[var(--ok)]" },
  { chave: "rejected", rotulo: "Rejeitados", Icone: VERIFICATION_LABELS.rejected.Icone, tinta: "text-[var(--danger)]" },
];

/* Estados de controle. `disabled` precisa ler como indisponivel: sem isso o
   botao continua com a cara de clicavel enquanto a mutation esta em voo.
   O valor vem de `DESABILITAVEL` — a copia local daqui era opacidade 40 com
   `pointer-events-none`, e as duas metades perdiam: 40% joga o rotulo do botao
   travado para perto do papel, e sem eventos de ponteiro o cursor de aviso
   nunca chega a trocar. Sao todos `<button>`, que ja ignoram o clique sozinhos. */
const BOTAO_ACAO = cn(BOTAO_SECUNDARIO, DESABILITAVEL);
const BOTAO_ACAO_PERIGO = cn(
  BOTAO_ACAO,
  "text-[var(--danger)] border-[var(--danger-border)] hover:bg-[var(--danger-bg)]",
);
const BOTAO_ACAO_MARCA = cn(BOTAO_MARCA, DESABILITAVEL);
/* Confirmacao de reprovacao: aqui o preenchimento vermelho e correto — e o
   unico botao de acao do dialogo, nao disputa com CTA nenhum, e o dialogo
   inteiro existe para essa decisao. */
const BOTAO_CONFIRMA_PERIGO = cn(
  BOTAO_ACAO_MARCA,
  "bg-[var(--danger)] focus-visible:outline-[var(--danger)]",
);

/** Rotulo mono em caixa alta do cabecalho da lista, no tracking do sistema. */
const CONTAGEM = "font-mono text-[11px] font-normal tabular-nums text-[var(--text-muted)]";

export default function CadastrosTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [cadastroSearch, setCadastroSearch] = useState("");
  const [cadastroFilter, setCadastroFilter] = useState("all");
  /**
   * Reprovar sem dizer por que transforma um problema resolvivel — documento
   * ilegivel, CNPJ com pendencia — numa porta sem macaneta: o servidor manda o
   * e-mail de reprovacao, e o provedor le "nao pode ser concluida" sem saber o
   * que corrigir. Por isso a reprovacao passou de um `confirm()` para este
   * campo, e o motivo viaja no PATCH.
   */
  const [reprovando, setReprovando] = useState<{ id: number; nome: string } | null>(null);
  const [motivo, setMotivo] = useState("");

  const { data: allProviders = [], isLoading: providersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    staleTime: STALE_LISTS,
  });
  const { data: allUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    staleTime: STALE_LISTS,
  });

  const updateVerificationMutation = useMutation({
    mutationFn: async ({ id, verificationStatus, motivo }: { id: number; verificationStatus: string; motivo?: string }) => {
      // `motivo` so vai quando existe: o servidor valida com zod e um campo
      // vazio seria recusado como dado invalido.
      const corpo: Record<string, string> = { verificationStatus };
      if (motivo?.trim()) corpo.motivo = motivo.trim();
      const res = await apiRequest("PATCH", `/api/admin/providers/${id}`, corpo);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      const statusLabels: Record<string, string> = { approved: "aprovado", rejected: "rejeitado", pending: "movido para pendente" };
      toast({
        title: `Cadastro ${statusLabels[variables.verificationStatus] || "atualizado"} com sucesso`,
        // "Foi avisado" seria promessa: o aviso so sai se o provedor tiver
        // contato cadastrado ou algum administrador com e-mail.
        description: variables.verificationStatus === "rejected" || variables.verificationStatus === "approved"
          ? "Um aviso por e-mail foi disparado ao contato do provedor."
          : undefined,
      });
      setReprovando(null);
      setMotivo("");
    },
    onError: (e: any) => toast({ title: "Erro ao atualizar status", description: e.message, variant: "destructive" }),
  });

  const resendVerificationMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/providers/${id}/resend-verification`, {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "E-mail enviado", description: data.message || "E-mail de verificação reenviado com sucesso." });
    },
    onError: (e: any) => toast({ title: "Erro ao reenviar e-mail", description: e.message, variant: "destructive" }),
  });

  // Este e o caminho explicito do hard delete: rotulo "Excluir", aviso que
  // lista o que some e diz que nao ha desfazer. A lista de Provedores so
  // suspende. Ver client/src/components/admin/acoes-provedor.ts.
  const deleteProviderMutation = useMutation({
    mutationFn: async (acao: AcaoProvedor) => {
      const res = await apiRequest(acao.metodo, acao.caminho, acao.corpo);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      toast({ title: "Provedor excluído", description: "O cadastro e todos os dados associados foram removidos." });
    },
    onError: (e: any) => toast({ title: "Erro ao excluir", description: e.message, variant: "destructive" }),
  });

  const filteredCadastros = allProviders
    .filter((p: any) => {
      const matchesSearch = p.name.toLowerCase().includes(cadastroSearch.toLowerCase()) ||
        (p.contactEmail || "").toLowerCase().includes(cadastroSearch.toLowerCase()) ||
        (p.cnpj || "").includes(cadastroSearch);
      const matchesFilter = cadastroFilter === "all" || p.verificationStatus === cadastroFilter;
      return matchesSearch && matchesFilter;
    })
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const cadastroCounts: Record<string, number> = {
    all: allProviders.length,
    pending: allProviders.filter((p: any) => p.verificationStatus === "pending").length,
    approved: allProviders.filter((p: any) => p.verificationStatus === "approved").length,
    rejected: allProviders.filter((p: any) => p.verificationStatus === "rejected").length,
  };

  const filtrando = cadastroFilter !== "all" || cadastroSearch.trim() !== "";
  const limparFiltro = () => { setCadastroFilter("all"); setCadastroSearch(""); };

  return (
    <div className="space-y-4">
      {/* Segmentado de situacao. `aria-pressed` porque sao botoes de alternancia
          de um filtro, e nao abas de conteudo separado. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar cadastros por situação">
        {FILTROS.map((f) => {
          const ativo = cadastroFilter === f.chave;
          return (
            <button
              key={f.chave}
              type="button"
              onClick={() => setCadastroFilter(f.chave)}
              aria-pressed={ativo}
              className={cn(
                BOTAO_SECUNDARIO,
                ativo &&
                  "bg-[var(--brand-soft)] text-[var(--brand-ink)] border-[var(--brand)] hover:bg-[var(--brand-soft)]",
              )}
              data-testid={`button-filter-cadastro-${f.chave}`}
            >
              <f.Icone
                className={cn("w-3.5 h-3.5 flex-none", !ativo && f.tinta)}
                strokeWidth={2}
                aria-hidden
              />
              {f.rotulo}
              <span
                className={cn(
                  "font-mono tabular-nums",
                  ativo ? "text-[var(--brand-ink)]" : "text-[var(--text-muted)]",
                )}
              >
                {cadastroCounts[f.chave]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative max-w-sm">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-faint)]"
          aria-hidden
        />
        <Input
          placeholder="Buscar por nome, e-mail ou CNPJ"
          aria-label="Buscar cadastros"
          className="pl-9"
          value={cadastroSearch}
          onChange={(e) => setCadastroSearch(e.target.value)}
          data-testid="input-search-cadastro"
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <h3 className={`${TITULO_CARTAO} flex items-center gap-2`}>
            <Building2 className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
            Cadastros
            {!providersLoading && (
              <span className={CONTAGEM}>
                {filteredCadastros.length} {filteredCadastros.length === 1 ? "exibido" : "exibidos"}
              </span>
            )}
          </h3>
        </div>

        {providersLoading ? (
          <div className="p-4">
            <LinhasSkeleton linhas={4} />
          </div>
        ) : filteredCadastros.length === 0 ? (
          /* Dois vazios diferentes, e a diferenca importa: "ainda nao chegou
             ninguem" e um fato sobre o sistema; "o filtro nao achou" e um fato
             sobre a busca, e nesse caso o que resolve e limpar o filtro. */
          filtrando ? (
            <EstadoVazio
              Icone={SearchX}
              titulo="Nenhum cadastro com esse filtro"
              descricao="Existem cadastros na fila, mas nenhum corresponde à situação e ao termo de busca escolhidos."
              cta={
                <button type="button" className={BOTAO_ACAO} onClick={limparFiltro} data-testid="button-limpar-filtro-cadastro">
                  Limpar filtro
                </button>
              }
              testId="empty-cadastros-filtrados"
            />
          ) : (
            <EstadoVazio
              Icone={Building2}
              titulo="Nenhum cadastro ainda"
              descricao="Assim que um provedor concluir o cadastro pelo site, ele aparece aqui para conferência e aprovação."
              testId="empty-cadastros"
            />
          )
        ) : (
          <div className="divide-y divide-[var(--border-faint)]">
            {filteredCadastros.map((p: any) => {
              const vs = VERIFICATION_LABELS[p.verificationStatus] ?? CONFERENCIA_DESCONHECIDA;
              const situacao = SITUACAO_PROVEDOR[p.status] ?? SITUACAO_DESCONHECIDA;
              const adminUser = allUsers.find((u: any) => u.providerId === p.id && u.role === "admin");
              const criadoEm = p.createdAt ? new Date(p.createdAt) : null;
              const usuarios = p.userCount || 0;
              return (
                <div key={p.id} className="px-5 py-4" data-testid={`cadastro-row-${p.id}`}>
                  <div className="flex items-start gap-4 flex-wrap">
                    {/* Provedor e uma COISA, entao ladrilho de canto seco — o
                        circulo da primitiva e para pessoa. A inicial sai de
                        dentro dela: a copia daqui fazia `charAt(0)` sem caixa
                        alta, e um provedor cadastrado em minusculas aparecia
                        com a letra minuscula ao lado de todos os outros. */}
                    <LadrilhoInicial nome={p.name} tamanho="lg" />
                    <div className="flex-1 min-w-[220px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={TITULO_CARTAO}>{p.name}</p>
                        <Selo tom={vs.tom} Icone={vs.Icone} testId={`badge-status-${p.id}`}>
                          {vs.label}
                        </Selo>
                        {p.adminEmailVerified ? (
                          <Selo tom="ok" Icone={CheckCircle} testId={`badge-email-verified-${p.id}`}>
                            E-mail verificado
                          </Selo>
                        ) : (
                          /* `gated` e nao `danger`: o e-mail nao confirmado e uma
                             porta que ainda nao abriu, nao uma falha do cadastro. */
                          <Selo tom="gated" Icone={AlertCircle} testId={`badge-email-unverified-${p.id}`}>
                            E-mail não verificado
                          </Selo>
                        )}
                      </div>
                      {/* Toda leitura de dado — CNPJ, data, subdominio, contagem —
                          e mono tabular (secao 2). Faltando o dado, o travessao:
                          um "-" solto nao diz se e vazio ou se e um hifen. */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-[12px] text-[var(--text-muted)]">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3 h-3 flex-none" strokeWidth={2} aria-hidden />
                          <span className="truncate">{adminUser?.name || "—"}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Mail className="w-3 h-3 flex-none" strokeWidth={2} aria-hidden />
                          <span className="truncate">{p.contactEmail || adminUser?.email || "—"}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-3 h-3 flex-none" strokeWidth={2} aria-hidden />
                          <span className="font-mono tabular-nums">
                            {p.cnpj ? p.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : "—"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 flex-none" strokeWidth={2} aria-hidden />
                          {criadoEm ? (
                            <time dateTime={criadoEm.toISOString()} className="font-mono tabular-nums">
                              {criadoEm.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </time>
                          ) : (
                            <span>—</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Globe className="w-3 h-3 flex-none" strokeWidth={2} aria-hidden />
                          <span className="font-mono truncate">
                            {p.subdomain ? `${p.subdomain}.consultaisp.com.br` : "—"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CreditCard className="w-3 h-3 flex-none" strokeWidth={2} aria-hidden />
                          <span className="truncate">Plano {PLAN_LABELS[p.plan]?.label || p.plan}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3 h-3 flex-none" strokeWidth={2} aria-hidden />
                          <span>
                            <span className="font-mono tabular-nums">{usuarios}</span>{" "}
                            {usuarios === 1 ? "usuário" : "usuários"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {/* Ponto de situacao: o unico rounded-full permitido —
                              e um dot, nao um badge. */}
                          <span className={`w-2 h-2 rounded-full flex-none ${situacao.ponto}`} aria-hidden />
                          <span>{situacao.rotulo}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {p.verificationStatus === "pending" && (
                        <>
                          <button
                            type="button"
                            className={BOTAO_ACAO_MARCA}
                            onClick={() => updateVerificationMutation.mutate({ id: p.id, verificationStatus: "approved" })}
                            disabled={updateVerificationMutation.isPending}
                            data-testid={`button-approve-${p.id}`}
                          >
                            <CheckCircle className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />Aprovar
                          </button>
                          <button
                            type="button"
                            className={BOTAO_ACAO_PERIGO}
                            onClick={() => { setMotivo(""); setReprovando({ id: p.id, nome: p.name }); }}
                            disabled={updateVerificationMutation.isPending}
                            data-testid={`button-reject-${p.id}`}
                          >
                            <XCircle className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />Rejeitar
                          </button>
                        </>
                      )}
                      {p.verificationStatus === "rejected" && (
                        <>
                          <button
                            type="button"
                            className={BOTAO_ACAO_MARCA}
                            onClick={() => updateVerificationMutation.mutate({ id: p.id, verificationStatus: "approved" })}
                            disabled={updateVerificationMutation.isPending}
                            data-testid={`button-reapprove-${p.id}`}
                          >
                            <CheckCircle className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />Aprovar
                          </button>
                          <button
                            type="button"
                            className={BOTAO_ACAO}
                            onClick={() => updateVerificationMutation.mutate({ id: p.id, verificationStatus: "pending" })}
                            disabled={updateVerificationMutation.isPending}
                            data-testid={`button-set-pending-rejected-${p.id}`}
                          >
                            <Clock className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />Voltar para pendente
                          </button>
                        </>
                      )}
                      {p.verificationStatus === "approved" && (
                        <button
                          type="button"
                          className={BOTAO_ACAO}
                          onClick={() => updateVerificationMutation.mutate({ id: p.id, verificationStatus: "pending" })}
                          disabled={updateVerificationMutation.isPending}
                          data-testid={`button-set-pending-${p.id}`}
                        >
                          <Clock className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />Voltar para pendente
                        </button>
                      )}
                      {!p.adminEmailVerified && (
                        <button
                          type="button"
                          className={BOTAO_ACAO}
                          onClick={() => resendVerificationMutation.mutate(p.id)}
                          disabled={resendVerificationMutation.isPending}
                          data-testid={`button-resend-email-${p.id}`}
                        >
                          <RefreshCw className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />Reenviar e-mail
                        </button>
                      )}
                      <button
                        type="button"
                        className={BOTAO_ACAO_PERIGO}
                        onClick={() => {
                          const acao = acaoExcluirProvedor(p.id, p.name);
                          if (confirm(acao.confirmacao!)) deleteProviderMutation.mutate(acao);
                        }}
                        disabled={deleteProviderMutation.isPending}
                        data-testid={`button-delete-cadastro-${p.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />Excluir
                      </button>
                      <button
                        type="button"
                        className={BOTAO_ACAO}
                        onClick={() => navigate(`/admin/provedor/${p.id}`)}
                        data-testid={`button-view-cadastro-${p.id}`}
                      >
                        <Eye className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />Ver ficha
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={reprovando !== null} onOpenChange={(aberto) => { if (!aberto) { setReprovando(null); setMotivo(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reprovar o cadastro de {reprovando?.nome}</DialogTitle>
            <DialogDescription>
              O motivo vai no e-mail que o provedor recebe. Escreva o que precisa ser corrigido
              para que ele possa reenviar — sem isso, sai um texto genérico.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
            rows={4}
            aria-label="Motivo da reprovação"
            placeholder="Ex.: o contrato social enviado está ilegível nas páginas 2 e 3."
            data-testid="input-motivo-reprovacao"
          />
          <p className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
            {motivo.length}/500
          </p>
          <DialogFooter>
            <button
              type="button"
              className={BOTAO_ACAO}
              onClick={() => { setReprovando(null); setMotivo(""); }}
              data-testid="button-cancelar-reprovacao"
            >
              Cancelar
            </button>
            <button
              type="button"
              className={BOTAO_CONFIRMA_PERIGO}
              disabled={updateVerificationMutation.isPending}
              onClick={() => reprovando && updateVerificationMutation.mutate({
                id: reprovando.id, verificationStatus: "rejected", motivo,
              })}
              data-testid="button-confirmar-reprovacao"
            >
              Reprovar cadastro
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
