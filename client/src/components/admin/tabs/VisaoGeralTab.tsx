import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import {
  CartaoMetrica, KickerSecao, TITULO_CARTAO, Selo, BotaoLink,
  EstadoVazio, LinhasSkeleton, type Icone, type TomSelo,
} from "@/components/painel/ui";
import {
  Building2, Users, Contact, ScanSearch, BarChart3, MessageSquare,
  ArrowUpDown, Clock, RefreshCw, CheckCircle2, Repeat,
  Wifi, WifiOff, AlertCircle,
} from "lucide-react";
import { STALE_DASHBOARD, STALE_LISTS } from "@/lib/queryClient";
import { PLAN_LABELS, ERP_MAP } from "../constants";

/**
 * Painel Geral do superadmin, vestido na MESMA linguagem do Painel do Provedor.
 *
 * Nada de dado, rota ou consulta mudou nesta rodada — so o vocabulario visual.
 * As metricas, os blocos e as consultas sao os mesmos de antes; o que mudou e
 * que agora eles falam por `@/components/painel/ui`, a primitiva extraida do
 * painel do provedor, em vez de repetir classes proprias.
 *
 * Esta tela ja teve copias locais de TITULO_CARTAO, Selo, BotaoLink,
 * EstadoVazio e LinhasSkeleton. Todas subiram para a primitiva compartilhada e
 * sao importadas daqui em diante — uma peca redigitada de um lado so e o comeco
 * da divergencia que a primitiva existe para evitar.
 */

/* ------------------------------------------------------------------ */
/* Vocabulario de dominio desta tela                                   */
/* ------------------------------------------------------------------ */

/** DESFECHO DA ULTIMA SINCRONIZACAO, em portugues.
 *
 *  `erp_integrations.last_sync_status` guarda o que `registrarResultadoSync`
 *  escreve (`server/storage/erp.storage.ts`): 'success', 'partial' ou 'error' —
 *  mais `null`, que e a integracao que nunca rodou. A tela mostrava o valor cru
 *  em caixa alta, e o operador lia "SUCCESS"/"ERROR"/"PARTIAL": jargao tecnico
 *  exposto, proibido pela secao 8 do DESIGN_SYSTEM.
 *
 *  O rotulo concorda com "sincronizacao", que e o que a linha inteira descreve.
 *  A coluna e TEXT livre desde a migracao 0000, entao um valor fora dos tres
 *  ainda e possivel (linha antiga, escrita por fora): cai no ramo desconhecido,
 *  que assume tom neutro em vez de afirmar saude ou falha que ninguem mediu. */
const DESFECHO_SYNC: Record<string, { rotulo: string; tom: TomSelo }> = {
  success: { rotulo: "Concluída", tom: "ok" },
  partial: { rotulo: "Parcial", tom: "gated" },
  error: { rotulo: "Com falha", tom: "danger" },
};

const DESFECHO_DESCONHECIDO = { rotulo: "Desconhecido", tom: "neutro" } as const;

/* ------------------------------------------------------------------ */

export default function VisaoGeralTab() {
  const { data: stats, isLoading: statsLoading } = useQuery<any>({
    queryKey: ["/api/admin/stats"],
    staleTime: STALE_DASHBOARD,
  });
  const { data: allProviders = [], isLoading: providersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    staleTime: STALE_LISTS,
  });
  const { data: planHistory = [], isLoading: historyLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/plan-history"],
  });
  const { data: chatThreads = [], isLoading: threadsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/chat/threads"],
    refetchInterval: 10000,
  });
  const {
    data: autoSyncStatus,
    isLoading: syncLoading,
    isError: syncIndisponivel,
  } = useQuery<any>({
    queryKey: ["/api/admin/auto-sync/status"],
    refetchInterval: 30000,
  });

  const totalUnread = chatThreads.reduce((sum: number, t: any) => sum + (t.unreadCount || 0), 0);

  /* Seis metricas em UMA linha ficavam com ~180px cada num monitor de 1280px:
     o numero mono de 21px e um rotulo de tres palavras nao cabem juntos, e a
     leitura vira encaixe. Tres colunas dao ~380px — a mesma largura util dos
     quatro cards do provedor — e 6 divide exato por 3, entao a segunda fila
     fecha cheia, sem cartao orfao (com 4 colunas sobrariam dois).
     O icone e sempre neutro, como na primitiva: quando toda metrica da linha e
     informativa, cor por card vira ruido. */
  const STAT_CARDS: Array<{
    testId: string; rotulo: string; valor: React.ReactNode;
    sub: React.ReactNode; Icone: Icone; carregando: boolean;
  }> = [
    { testId: "stat-card-provedores", rotulo: "Provedores", Icone: Building2, valor: stats?.providers ?? "—", sub: <><span className="font-mono tabular-nums">{stats?.activeProviders ?? 0}</span> ativos</>, carregando: statsLoading },
    { testId: "stat-card-usuarios", rotulo: "Usuários", Icone: Users, valor: stats?.users ?? "—", sub: "cadastrados", carregando: statsLoading },
    { testId: "stat-card-clientes", rotulo: "Clientes", Icone: Contact, valor: stats?.customers ?? "—", sub: "em todos os provedores", carregando: statsLoading },
    { testId: "stat-card-consultas-isp", rotulo: "Consultas ISP", Icone: ScanSearch, valor: stats?.ispConsultations ?? "—", sub: "total realizado", carregando: statsLoading },
    { testId: "stat-card-consultas-spc", rotulo: "Consultas SPC", Icone: BarChart3, valor: stats?.spcConsultations ?? "—", sub: "total realizado", carregando: statsLoading },
    { testId: "stat-card-mensagens-novas", rotulo: "Mensagens novas", Icone: MessageSquare, valor: totalUnread, sub: "aguardando resposta", carregando: threadsLoading },
  ];

  const scheduler = autoSyncStatus?.scheduler;
  const ultimaExecucao = scheduler?.lastRun ? new Date(scheduler.lastRun) : null;
  const integracoes: any[] = autoSyncStatus?.integrations ?? [];
  /* "Nao respondeu" e "respondeu que esta zerado" sao fatos diferentes, e so o
     segundo autoriza a tela a afirmar alguma coisa sobre o scheduler. */
  const semResposta = syncIndisponivel || !autoSyncStatus;

  return (
    <div className="space-y-6" data-testid="admin-visao-geral">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {STAT_CARDS.map((s) => (
          <CartaoMetrica
            key={s.testId}
            testId={s.testId}
            testIdValor={`value-${s.testId}`}
            rotulo={s.rotulo}
            valor={s.valor}
            sub={s.sub}
            Icone={s.Icone}
            carregando={s.carregando}
          />
        ))}
      </div>

      <section>
        <KickerSecao>Movimentação recente</KickerSecao>
        <div className="grid md:grid-cols-2 gap-3">
          <Card className="p-4">
            <h3 className={`${TITULO_CARTAO} flex items-center gap-2 mb-3`}>
              <Building2 className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
              Provedores recentes
            </h3>
            {providersLoading ? (
              <LinhasSkeleton />
            ) : allProviders.length === 0 ? (
              <EstadoVazio
                Icone={Building2}
                titulo="Nenhum provedor cadastrado"
                descricao="Assim que o primeiro provedor concluir o cadastro, ele aparece aqui com plano e subdomínio."
                cta={<BotaoLink href="#provedores">Abrir provedores</BotaoLink>}
                testId="empty-provedores-recentes"
              />
            ) : (
              <div>
                {allProviders.slice(0, 5).map((p: any) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 py-2 border-b border-[var(--border-faint)] last:border-0"
                    data-testid={`provider-row-${p.id}`}
                  >
                    <div className="w-8 h-8 rounded grid place-items-center bg-[var(--surface-inset)] text-[13px] font-semibold text-[var(--text-2)] flex-none">
                      {p.name?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[var(--text)] truncate">{p.name}</p>
                      <p className="font-mono text-[11px] text-[var(--text-muted)] truncate">
                        {p.subdomain}.consultaisp.com.br
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-none">
                      {/* A ultima copia manuscrita do `Selo` no painel: o corpo
                          inteiro da pilula estava redigitado aqui (raio,
                          padding, mono, caixa alta, tracking) so para injetar
                          uma classe de cor pronta que o catalogo de planos
                          publicava. O catalogo passou a publicar so o TOM, e a
                          pilula virou a primitiva. */}
                      <Selo tom={PLAN_LABELS[p.plan]?.tom ?? "neutro"}>
                        {PLAN_LABELS[p.plan]?.label ?? p.plan}
                      </Selo>
                      {/* Ponto de status: o unico rounded-full permitido — e um
                          dot, nao um badge. */}
                      <span
                        className={`w-2 h-2 rounded-full ${p.status === "active" ? "bg-[var(--ok)]" : "bg-[var(--text-faint)]"}`}
                        title={p.status === "active" ? "Ativo" : "Inativo"}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h3 className={`${TITULO_CARTAO} flex items-center gap-2 mb-3`}>
              <ArrowUpDown className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
              Histórico de planos
            </h3>
            {historyLoading ? (
              <LinhasSkeleton linhas={3} />
            ) : planHistory.length === 0 ? (
              <EstadoVazio
                Icone={ArrowUpDown}
                titulo="Nenhum histórico ainda"
                descricao="Toda troca de plano e todo crédito lançado por aqui ficam registrados nesta lista."
                cta={<BotaoLink href="#provedores">Abrir provedores</BotaoLink>}
                testId="empty-historico-planos"
              />
            ) : (
              <div>
                {planHistory.slice(0, 5).map((h: any) => (
                  <div
                    key={h.id}
                    className="py-2 border-b border-[var(--border-faint)] last:border-0"
                    data-testid={`plan-history-row-${h.id}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[var(--text-faint)] flex-none" strokeWidth={2} />
                      <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                        {new Date(h.createdAt).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    {h.oldPlan && h.newPlan ? (
                      <p className="text-[12.5px] text-[var(--text-2)] mt-1">
                        Plano: <strong className="text-[var(--text)] font-medium">{PLAN_LABELS[h.oldPlan]?.label}</strong>
                        {" → "}
                        <strong className="text-[var(--text)] font-medium">{PLAN_LABELS[h.newPlan]?.label}</strong>
                      </p>
                    ) : (
                      <p className="text-[12.5px] text-[var(--text-2)] mt-1">
                        Créditos: ISP{" "}
                        <strong className="font-mono tabular-nums text-[var(--text)] font-medium">+{h.ispCreditsAdded}</strong>
                        {" / SPC "}
                        <strong className="font-mono tabular-nums text-[var(--text)] font-medium">+{h.spcCreditsAdded}</strong>
                      </p>
                    )}
                    {h.notes && (
                      <p className="text-[12px] text-[var(--text-muted)] truncate mt-0.5">{h.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </section>

      <section>
        <KickerSecao>Sincronização automática</KickerSecao>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <CartaoMetrica
            rotulo="Rotina de sincronização"
            Icone={RefreshCw}
            carregando={syncLoading}
            testId="card-scheduler"
            /* Vai pelo slot de ESTADO, nao pelo de valor: um selo de 10px
               ocupando a caixa de um numero de 21px derrubava a linha de base
               dos dois cartoes irmaos. O slot guarda a altura do numero. */
            estado={
              /* Tres estados, nao dois. Sem resposta do monitor a tela nao pode
                 pintar "Aguardando" de verde: isso afirma saude que ninguem
                 mediu. O selo neutro diz o que de fato se sabe. */
              semResposta ? (
                <Selo tom="neutro">Sem dados</Selo>
              ) : scheduler?.running ? (
                <Selo tom="gated" Icone={RefreshCw} girando>Executando</Selo>
              ) : (
                <Selo tom="ok" Icone={CheckCircle2}>Aguardando</Selo>
              )
            }
          />
          <CartaoMetrica
            rotulo="Última execução"
            Icone={Clock}
            carregando={syncLoading}
            testId="card-ultima-execucao"
            /* Data como valor e hora como sub: assim o numero grande continua
               sendo mono tabular e a linha nao quebra em tres pedacos.
               OS SEGUNDOS VOLTARAM. A versao anterior mostrava o carimbo
               completo; a reforma cortou para hh:mm e perdeu informacao que
               estava na tela. Num monitor de scheduler o carimbo e o unico
               sinal de vida do processo: ao lado de "Total de ciclos", saber
               se a execucao foi ha 40 segundos ou ha 9 minutos e o que separa
               "esta rodando agora" de "parou". O custo de largura e zero
               porque a hora agora e mono tabular — nao ha salto de coluna. */
            valor={semResposta ? "—" : ultimaExecucao ? ultimaExecucao.toLocaleDateString("pt-BR") : "Nunca"}
            sub={
              semResposta ? (
                "sem resposta do monitor"
              ) : ultimaExecucao ? (
                <>
                  às{" "}
                  <span className="font-mono tabular-nums">
                    {ultimaExecucao.toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </>
              ) : (
                "nenhum ciclo registrado"
              )
            }
          />
          <CartaoMetrica
            rotulo="Total de ciclos"
            Icone={Repeat}
            carregando={syncLoading}
            testId="card-total-ciclos"
            valor={semResposta ? "—" : scheduler?.totalRuns ?? 0}
            /* "boot" era a mesma falta do selo de desfecho: termo tecnico cru na
               tela. A contagem vive na memoria do processo, entao o que ela
               conta e mesmo o que passou desde o servidor subir. */
            sub="desde o último reinício do servidor"
          />
        </div>

        <Card className="p-0 overflow-hidden mt-3">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
            <h3 className={`${TITULO_CARTAO} flex items-center gap-2`}>
              <Wifi className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
              Integrações ativas
              {integracoes.length > 0 && (
                <span className="font-mono text-[11px] font-normal tabular-nums text-[var(--text-muted)]">
                  {integracoes.length} provedores
                </span>
              )}
            </h3>
          </div>

          {syncLoading ? (
            <div className="p-4">
              <LinhasSkeleton linhas={3} />
            </div>
          ) : semResposta ? (
            /* HONESTIDADE: a tela nao pode dizer "nenhuma integracao ativa"
               quando na verdade nao recebeu resposta nenhuma — sao coisas
               diferentes, e a segunda nao autoriza a primeira. */
            <EstadoVazio
              Icone={AlertCircle}
              titulo="Monitor de sincronização indisponível"
              descricao="O painel não recebeu resposta do monitor, então esta lista não prova que nenhum provedor está integrado. A integração de cada provedor pode ser conferida na ficha dele."
              cta={<BotaoLink href="#provedores">Abrir provedores</BotaoLink>}
              testId="empty-monitor-indisponivel"
            />
          ) : integracoes.length === 0 ? (
            <EstadoVazio
              Icone={WifiOff}
              titulo="Nenhuma integração ativa"
              descricao="O monitor respondeu, e nenhum provedor tem ERP com credencial configurada. A configuração fica na ficha de cada provedor."
              cta={<BotaoLink href="#provedores">Abrir provedores</BotaoLink>}
              testId="empty-integracoes"
            />
          ) : (
            <div>
              {integracoes.map((intg: any) => {
                const desfecho = intg.lastSyncStatus
                  ? DESFECHO_SYNC[intg.lastSyncStatus] ?? DESFECHO_DESCONHECIDO
                  : null;
                const ultimaSync = intg.lastSyncAt ? new Date(intg.lastSyncAt) : null;
                return (
                  <div
                    key={`${intg.providerId}-${intg.erpSource}`}
                    className="px-4 py-3 border-b border-[var(--border-faint)] last:border-0"
                    data-testid={`sync-row-${intg.providerId}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium text-[var(--text)] truncate">
                        {intg.providerName}
                      </span>
                      <Selo tom="neutro">{ERP_MAP[intg.erpSource] ?? intg.erpSource}</Selo>
                      {desfecho && <Selo tom={desfecho.tom}>{desfecho.rotulo}</Selo>}
                      {intg.isDue && <Selo tom="marca">Vencido</Selo>}
                    </div>
                    <div className="flex items-center gap-4 mt-1 flex-wrap text-[12px] text-[var(--text-muted)]">
                      {/* Data e mono tabular como qualquer outro dado (secao 2).
                          Proporcional, ela desalinhava contra a contagem tabular
                          que vem ao lado na mesma linha. */}
                      <span>
                        {ultimaSync ? (
                          <>
                            Última sincronização:{" "}
                            <time
                              dateTime={ultimaSync.toISOString()}
                              className="font-mono tabular-nums"
                            >
                              {ultimaSync.toLocaleString("pt-BR")}
                            </time>
                          </>
                        ) : (
                          "Nunca sincronizado"
                        )}
                      </span>
                      {/* Contagem informativa fica na tinta do corpo: a pele
                          reserva saturacao para risco (secao 3), e "sincronizou
                          N" nao e risco. O verde aqui competia com o selo de
                          desfecho, que e quem de fato diz se foi bem. */}
                      <span className="font-mono tabular-nums">
                        {intg.totalSynced} sincronizados
                      </span>
                      {intg.totalErrors > 0 && (
                        <span className="text-[var(--danger)] font-mono tabular-nums">
                          {intg.totalErrors} erros
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
