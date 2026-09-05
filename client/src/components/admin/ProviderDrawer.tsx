import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ALVO_CONTROLE, BOTAO_MARCA, BOTAO_SECUNDARIO, BotaoIcone, Campo,
  CONTROLE_CAMPO, DESABILITAVEL, EstadoVazio, LadrilhoInicial, LinhasSkeleton,
  PilulaCabecalho, ROTULO_CAMPO, Selo, TITULO_CARTAO, LISTA_ABAS, ABA, type TomSelo,
} from "@/components/painel/ui";
import { cn } from "@/lib/utils";
import {
  BarChart3, Building2, CreditCard, ExternalLink, Plus, RefreshCw, Save,
  Trash2, User, Users,
} from "lucide-react";
import { PLAN_LABELS } from "./constants";
import { PLANOS_DO_CATALOGO, rotuloDoPlano } from "@/lib/planos";
import { cnpjMascarado } from "@/lib/cnpj";

/**
 * Ficha rapida do provedor, vestida na MESMA linguagem do Painel do Provedor.
 *
 * Rodada de LINGUAGEM VISUAL: nenhuma rota, consulta (queryKey, endpoint,
 * parametro), permissao, dado enviado ou data-testid mudou.
 *
 * O QUE ESTAVA ERRADO
 * - Um par de classes da paleta default do Tailwind pintava o avatar do usuario:
 *   paleta proibida pela secao 7. Virou o MESMO avatar que a lista de
 *   provedores recentes do Painel Geral ja usa (`--surface-inset` + `--text-2`,
 *   raio de 4px) — reaproveitar o que ja foi decidido vale mais do que inventar
 *   um terceiro avatar.
 * - Toda a familia de tokens da API antiga trocada pelos canonicos.
 * - Dois `<Badge>` com uma classe de cor pronta vinda do catalogo de planos:
 *   agora e `<Selo tom={...}>`, a primitiva. Era o pedido explicito do catalogo,
 *   e o campo de classe que sobrava la ja foi removido — o catalogo publica so
 *   o tom.
 * - "Carregando..." como titulo do painel: a secao 6 pede a FORMA do que vem,
 *   nunca a palavra. E o estado nem era so de carregamento — a mesma tela
 *   aparecia para provedor que nao esta na lista, e ficava dizendo "carregando"
 *   para sempre. Agora sao dois estados de verdade, decididos pelo `isLoading`
 *   da consulta que ja existia: esqueleto enquanto busca, `EstadoVazio` quando
 *   a busca terminou e nao ha ficha.
 * - Estado do provedor saia como "Ativo" ou "Inativo", e "inativo" cobria tanto
 *   suspenso quanto cancelado — dois fatos diferentes achatados em um. Agora
 *   cada um tem nome, e o valor que ninguem previu cai em "Desconhecido" com
 *   tom neutro, em vez de ser afirmado como inativo.
 *
 * SOMBRA: o `SheetContent` do shadcn ja traz o par do flutuante da secao 5.2
 * (anel de 1px + lift). Este arquivo nao acrescenta nenhuma sombra; so troca o
 * fundo, que apontava para o canvas em vez de `--surface`.
 *
 * A ABA DE ERP NAO VOLTA. Ela saiu numa rodada anterior junto com a consulta
 * que a alimentava (ver o comentario em `server/storage/providers.storage.ts`);
 * a configuracao de ERP de cada provedor vive no Painel Completo.
 *
 * SEGUNDA RODADA — AS COPIAS LOCAIS FORAM APAGADAS
 * Rotulo de campo, par rotulo+controle, anel de foco, desabilitado, botao de
 * icone e ladrilho de inicial eram todos locais aqui — e a constante de botao
 * de icone carregava a nota "quando houver primitiva, esta constante sobe". Ela
 * subiu; todos vem de `painel/ui` agora. O plano ja lia `tom` de
 * `PLAN_LABELS`, entao nao havia o que migrar ali.
 *
 * TRES MUDANCAS DE PIXEL, declaradas:
 * 1. O BOTAO DE REMOVER USUARIO deixa de ser vermelho em repouso e so ganha a
 *    tinta de risco no hover. Um icone vermelho repetido em toda linha vira
 *    alarme continuo, e alarme continuo e alarme que ninguem ve — a saturacao
 *    da secao 3 e para risco, nao para a porta que leva a ele. O `confirm()`
 *    antes de apagar continua igual.
 * 2. O BOTAO DESLIGADO passa de 40% para 50% de opacidade e troca
 *    `pointer-events-none` por `cursor-not-allowed`. O rotulo do botao travado
 *    e o que explica o que falta fazer; ele precisa continuar legivel, e o
 *    cursor e o unico aviso de que o controle esta travado.
 * 3. O ICONE DA LIXEIRA cai de 16px para 14px, que e a medida da primitiva — a
 *    mesma de todo botao de icone do painel. A caixa clicavel nao muda: 36px no
 *    mouse, 44x44 no dedo, como ja era.
 * O rotulo de campo nao muda de valor: o local ja era, letra por letra, o que
 * virou primitiva.
 *
 * TERCEIRA RODADA — A CAIXA DO CAMPO
 * As duas ultimas constantes locais eram a caixa do campo de texto e a do
 * seletor nativo, com alturas e corpos diferentes empilhadas no mesmo cartao da
 * aba Plano ("novo plano" seletor, "observacao" campo de texto). Viraram
 * `CONTROLE_CAMPO`. As mudancas de pixel estao justificadas na primitiva: 36px
 * em vez de 40px no campo de texto, corpo unico de 12,5px e o anel de foco da
 * casa, que o componente base nao entregava de forma visivel.
 */

/* ------------------------------------------------------------------ */
/* Vocabulario local                                                   */
/* ------------------------------------------------------------------ */

/* A caixa de campo saiu daqui: eram duas locais (campo de texto e seletor
   nativo) com alturas e corpos diferentes, empilhadas no mesmo cartao da aba
   Plano. Agora e `CONTROLE_CAMPO`, da primitiva. */

/** Bloco de acao dentro de uma aba: card de 8px com hairline, sem sombra. */
const CARTAO_ACAO = "rounded-lg border border-[var(--border)] p-4 space-y-3";

/** SITUACAO DO PROVEDOR, em portugues.
 *
 *  `providers.status` guarda 'active', 'suspended' ou 'cancelled'. A tela
 *  mostrava so "Ativo" ou "Inativo", e suspenso (cortado, mas ainda cliente) e
 *  cancelado (foi embora) nao sao a mesma coisa para quem administra a conta.
 *  Valor fora dos tres cai no ramo desconhecido, com tom neutro: nao ter medido
 *  nao autoriza a tela a afirmar nada. */
const SITUACAO_PROVEDOR: Record<string, { rotulo: string; tom: TomSelo }> = {
  active: { rotulo: "Ativo", tom: "ok" },
  suspended: { rotulo: "Suspenso", tom: "gated" },
  cancelled: { rotulo: "Cancelado", tom: "danger" },
};

const SITUACAO_DESCONHECIDA = { rotulo: "Desconhecida", tom: "neutro" } as const;

/** PAPEL DO USUARIO. `admin` ganha o tom da marca porque e quem manda na conta
 *  do provedor; papel nao e risco, entao nada de saturacao aqui (secao 3). */
const PAPEL_USUARIO: Record<string, { rotulo: string; tom: TomSelo }> = {
  admin: { rotulo: "Administrador", tom: "marca" },
  user: { rotulo: "Usuário", tom: "neutro" },
  superadmin: { rotulo: "Superadministrador", tom: "neutro" },
};

/** Par rotulo/valor da ficha. */
function Dado({
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

interface ProviderDrawerProps {
  providerId: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export default function ProviderDrawer({ providerId, open, onOpenChange }: ProviderDrawerProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [activeSubTab, setActiveSubTab] = useState("dados");

  // Fetch the provider from the list cache (or refetch list)
  const { data: allProviders = [], isLoading: provedoresCarregando } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    enabled: open,
  });
  const provider = allProviders.find((p: any) => p.id === providerId);

  const { data: allUsers = [], isLoading: usuariosCarregando } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    enabled: open,
  });
  const providerUsers = allUsers.filter((u: any) => u.providerId === providerId);

  // Creditos state
  const [isp, setIsp] = useState("0");
  const [spc, setSpc] = useState("0");
  const [notes, setNotes] = useState("");

  // Plano state
  const [plan, setPlan] = useState("free");

  // Reset state when provider changes
  useEffect(() => {
    if (provider) {
      setPlan(provider.plan || "free");
      setIsp("0");
      setSpc("0");
      setNotes("");
    }
  }, [provider?.id]);

  const creditsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/providers/${providerId}/credits`, {
        ispCredits: parseInt(isp) || 0, spcCredits: parseInt(spc) || 0, notes,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/plan-history"] });
      toast({ title: "Créditos adicionados!" });
      setIsp("0");
      setSpc("0");
      setNotes("");
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const planMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/providers/${providerId}/plan`, { plan, notes });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/plan-history"] });
      toast({ title: "Plano alterado!" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Usuário removido" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const abrirPainelCompleto = () => navigate(`/admin/provedor/${providerId}`);

  /* Sem ficha: esqueleto enquanto a lista vem, estado vazio quando ela chegou e
     este provedor nao esta nela. O titulo continua existindo para o leitor de
     tela — o Radix exige um, e sem ele o painel abre sem nome. */
  if (!provider) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-[var(--surface)]">
          <SheetHeader className="pb-4">
            <SheetTitle className="sr-only">Ficha do provedor</SheetTitle>
            <SheetDescription className="sr-only">
              Dados cadastrais, usuários, créditos e plano do provedor.
            </SheetDescription>
          </SheetHeader>
          {provedoresCarregando ? (
            <LinhasSkeleton linhas={5} />
          ) : (
            <EstadoVazio
              Icone={Building2}
              titulo="Provedor não encontrado"
              descricao="A ficha deste provedor não está na lista carregada. Ele pode ter sido removido, ou a lista pode estar desatualizada."
              testId="empty-provedor-nao-encontrado"
            />
          )}
        </SheetContent>
      </Sheet>
    );
  }

  const situacao = SITUACAO_PROVEDOR[provider.status] ?? SITUACAO_DESCONHECIDA;
  const planoAtual = PLAN_LABELS[provider.plan];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-2xl overflow-y-auto bg-[var(--surface)]"
        data-testid="provider-drawer"
      >
        <SheetHeader className="pb-4 space-y-3 text-left sm:text-left">
          <div className="flex items-center gap-3">
            {/* Ladrilho, e nao avatar: provedor e empresa, e empresa nao tem
                rosto — canto seco. A inicial sai da primitiva (uma copia local
                esquecia a caixa alta, e a mesma lista mostrava "A" e "j"). */}
            <LadrilhoInicial nome={provider.name} tamanho="lg" />
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-[17px] font-medium tracking-[-0.02em] text-[var(--text)] truncate">
                {provider.name}
              </SheetTitle>
              <SheetDescription className="font-mono text-[11px] text-[var(--text-muted)] truncate">
                {provider.subdomain}.consultaisp.com.br
              </SheetDescription>
            </div>
            <button
              type="button"
              className={cn(BOTAO_SECUNDARIO, "flex-none")}
              onClick={abrirPainelCompleto}
              data-testid="button-open-provider-full-panel"
            >
              <ExternalLink className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
              Painel completo
            </button>
          </div>

          {/* Os saldos saem da linha de descricao e viram pilula — a primitiva
              que existe para leitura numerica. Mesmo dado, mono e tabular, e
              visivel de qualquer aba. */}
          <div className="flex items-center gap-2 flex-wrap">
            <PilulaCabecalho Icone={CreditCard} valor={provider.ispCredits} rotulo="créditos ISP" />
            <PilulaCabecalho Icone={BarChart3} valor={provider.spcCredits} rotulo="créditos SPC" />
          </div>
        </SheetHeader>

        <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
          <TabsList className={LISTA_ABAS}>
            <TabsTrigger value="dados" className={ABA} data-testid="tab-provider-dados">Dados</TabsTrigger>
            <TabsTrigger value="usuarios" className={ABA} data-testid="tab-provider-usuarios">Usuários</TabsTrigger>
            <TabsTrigger value="creditos" className={ABA} data-testid="tab-provider-creditos">Créditos</TabsTrigger>
            <TabsTrigger value="plano" className={ABA} data-testid="tab-provider-plano">Plano</TabsTrigger>
          </TabsList>

          {/* Dados */}
          <TabsContent value="dados" className="space-y-3 pt-4">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              <Dado rotulo="Razão social">{provider.name}</Dado>
              <Dado rotulo="Nome fantasia">{provider.tradeName || "—"}</Dado>
              {/* Mascara na exibicao: `providers.cnpj` guarda 14 digitos crus.
                  Sem ela, a gaveta mostraria "23864873000148" para quem hoje ve o
                  numero pontuado — e a pontuacao vinha do banco, nao daqui. */}
              <Dado rotulo="CNPJ" mono={!!provider.cnpj}>{cnpjMascarado(provider.cnpj) || "—"}</Dado>
              <Dado rotulo="Telefone" mono={!!provider.contactPhone}>{provider.contactPhone || "—"}</Dado>
              <Dado rotulo="E-mail" className="sm:col-span-2">{provider.contactEmail || "—"}</Dado>
              <Dado rotulo="Endereço" className="sm:col-span-2">
                {[
                  [provider.addressStreet, provider.addressNumber].filter(Boolean).join(", "),
                  [provider.addressCity, provider.addressState].filter(Boolean).join("/"),
                ].filter(Boolean).join(" — ") || "—"}
              </Dado>
              <Dado rotulo="Plano atual">
                <Selo tom={planoAtual?.tom ?? "neutro"}>{planoAtual?.label ?? provider.plan}</Selo>
              </Dado>
              <Dado rotulo="Situação">
                <Selo tom={situacao.tom}>{situacao.rotulo}</Selo>
              </Dado>
            </dl>
            <p className="text-[12px] text-[var(--text-muted)] pt-3 border-t border-[var(--border)]">
              Para editar os dados cadastrais detalhados, use o Painel completo.
            </p>
          </TabsContent>

          {/* Usuarios */}
          <TabsContent value="usuarios" className="space-y-2 pt-4">
            {usuariosCarregando ? (
              <LinhasSkeleton />
            ) : providerUsers.length === 0 ? (
              <EstadoVazio
                Icone={Users}
                titulo="Nenhum usuário vinculado"
                descricao="Nenhuma conta de acesso está ligada a este provedor. O cadastro de usuários fica no Painel completo."
                cta={
                  <button type="button" className={BOTAO_SECUNDARIO} onClick={abrirPainelCompleto}>
                    Abrir painel completo
                  </button>
                }
                testId="empty-usuarios-provedor"
              />
            ) : (
              <>
                <p className="text-[12px] text-[var(--text-muted)]">
                  <span className="font-mono tabular-nums">{providerUsers.length}</span>
                  {providerUsers.length === 1 ? " usuário vinculado" : " usuários vinculados"} a este provedor
                </p>
                {providerUsers.map((u: any) => {
                  const papel = PAPEL_USUARIO[u.role] ?? { rotulo: u.role, tom: "neutro" as TomSelo };
                  return (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2"
                      data-testid={`drawer-user-row-${u.id}`}
                    >
                      <div className="w-8 h-8 rounded grid place-items-center flex-none bg-[var(--surface-inset)]">
                        <User className="w-4 h-4 text-[var(--text-faint)]" strokeWidth={2} aria-hidden />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[var(--text)] truncate">{u.name}</p>
                        <p className="text-[11.5px] text-[var(--text-muted)] truncate">{u.email}</p>
                      </div>
                      <Selo tom={papel.tom}>{papel.rotulo}</Selo>
                      {u.role !== "superadmin" && (
                        <BotaoIcone
                          Icone={Trash2}
                          tom="risco"
                          rotulo={`Remover ${u.name}`}
                          onClick={() => { if (confirm(`Remover o usuário ${u.name}?`)) deleteUserMutation.mutate(u.id); }}
                          testId={`drawer-button-delete-user-${u.id}`}
                        />
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </TabsContent>

          {/* Creditos. O saldo atual nao se repete aqui: as pilulas do cabecalho
              ficam na mesma tela, logo acima, e dizer o mesmo numero duas vezes
              a 20px de distancia e ruido, nao reforco. */}
          <TabsContent value="creditos" className="space-y-4 pt-4">
            <div className={CARTAO_ACAO}>
              <h4 className={`${TITULO_CARTAO} flex items-center gap-2`}>
                <CreditCard className="w-4 h-4 flex-none text-[var(--text-faint)]" strokeWidth={2} aria-hidden />
                Adicionar créditos
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="créditos ISP">
                  <Input
                    type="number"
                    value={isp}
                    onChange={(e) => setIsp(e.target.value)}
                    placeholder="0"
                    className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")}
                    data-testid="input-isp-credits"
                  />
                </Campo>
                <Campo rotulo="créditos SPC">
                  <Input
                    type="number"
                    value={spc}
                    onChange={(e) => setSpc(e.target.value)}
                    placeholder="0"
                    className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")}
                    data-testid="input-spc-credits"
                  />
                </Campo>
              </div>
              <Campo rotulo="observação (opcional)">
                <Input
                  placeholder="Motivo do lançamento"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={CONTROLE_CAMPO}
                  data-testid="input-credit-notes"
                />
              </Campo>
              <button
                type="button"
                onClick={() => creditsMutation.mutate()}
                disabled={creditsMutation.isPending}
                className={cn(BOTAO_MARCA, DESABILITAVEL, "w-full")}
                data-testid="button-add-credits"
              >
                {creditsMutation.isPending
                  ? <RefreshCw className="w-4 h-4 motion-safe:animate-spin" strokeWidth={2} aria-hidden />
                  : <Plus className="w-4 h-4" strokeWidth={2} aria-hidden />}
                Adicionar créditos
              </button>
            </div>
          </TabsContent>

          {/* Plano */}
          <TabsContent value="plano" className="space-y-4 pt-4">
            <div className={CARTAO_ACAO}>
              <h4 className={TITULO_CARTAO}>Alterar plano</h4>
              <Campo rotulo="novo plano">
                <select
                  className={CONTROLE_CAMPO}
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  data-testid="select-provider-plan"
                >
                  {PLANOS_DO_CATALOGO.map(p => <option key={p} value={p}>{rotuloDoPlano(p)}</option>)}
                </select>
              </Campo>
              <Campo rotulo="observação (opcional)">
                <Input
                  placeholder="Motivo da troca"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={CONTROLE_CAMPO}
                  data-testid="input-plan-notes"
                />
              </Campo>
              <button
                type="button"
                onClick={() => planMutation.mutate()}
                disabled={planMutation.isPending || plan === provider.plan}
                className={cn(BOTAO_MARCA, DESABILITAVEL, "w-full")}
                data-testid="button-save-plan"
              >
                {planMutation.isPending
                  ? <RefreshCw className="w-4 h-4 motion-safe:animate-spin" strokeWidth={2} aria-hidden />
                  : <Save className="w-4 h-4" strokeWidth={2} aria-hidden />}
                Salvar plano
              </button>
              <p className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                Plano atual:
                <Selo tom={planoAtual?.tom ?? "neutro"}>{planoAtual?.label ?? provider.plan}</Selo>
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
