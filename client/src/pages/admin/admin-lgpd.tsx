/**
 * LGPD — solicitações de titulares, na MESMA linguagem do Painel do Provedor.
 *
 * Esta rodada é de LINGUAGEM VISUAL: nenhuma rota, queryKey, endpoint, mutação
 * ou permissão mudou. O que mudou é quem fala — a tela consome
 * `@/components/painel/ui` em vez de repetir classes próprias, e usa os tokens
 * canônicos (`--text`, `--surface`, `--brand`, `--ok`, `--danger`…) no lugar da
 * API antiga de token e da paleta default do Tailwind. (O literal da API antiga
 * não aparece escrito aqui de propósito: uma auditoria por grep não pode ser
 * envenenada pelo comentário que conta que ela saiu.)
 *
 * O QUE SAIU, E POR QUÊ
 * - Dezesseis classes da paleta default do Tailwind (azul no ícone do título,
 *   verde no botão de concluir, três amarelos diferentes disputando o mesmo
 *   significado no indicador de prazo, e um cartão inteiro em vermelho claro):
 *   proibidas pela seção 7. Todas viraram token.
 * - "Carregando..." dentro da tabela e "Nenhuma solicitacao encontrada" solto:
 *   a seção 6 chama os dois de estado real. Viraram `LinhasSkeleton` e
 *   `EstadoVazio`, este último distinguindo "não há pedido nenhum" de "o filtro
 *   escondeu todos" — que não são a mesma notícia para quem opera o prazo.
 * - Badges do shadcn com `variant`/`className` à mão: viraram `Selo`.
 * - Texto sem acento em tela ("Solicitacoes", "Correcao", "Concluido"):
 *   seção 8, português com acento.
 *
 * ONDE A SATURAÇÃO É LEGÍTIMA — E ONDE NÃO É
 * A seção 3 reserva cor saturada para risco. Nesta tela o risco de verdade tem
 * nome e prazo: a LGPD dá 15 dias úteis para responder ao titular, e passar
 * disso é exposição perante a ANPD. Por isso o vermelho fica com "Vencido" e o
 * âmbar com o prazo apertado, e SÓ com eles.
 * A situação do pedido, em contraste, é quase toda neutra: "Recusada" é uma
 * decisão deliberada de quem opera, não um acidente — pintá-la de vermelho
 * competiria com o vencido, que é o que de fato pede ação hoje. É a mesma
 * leitura que a tela irmã de créditos faz do pedido cancelado.
 *
 * TODO NÚMERO É MONO TABULAR (seção 2): contagem, dias úteis, protocolo,
 * CPF/CNPJ e data. A coluna de data usava a fonte de texto e desalinhava linha
 * a linha.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CabecalhoPainel, PilulaCabecalho, CartaoMetrica, KickerSecao, Selo,
  EstadoVazio, LinhasSkeleton, TabelaPainel, Th, Td, RotuloCampo,
  ALVO_CONTROLE, CONTROLE_CAMPO, BOTAO_SECUNDARIO, BOTAO_MARCA, TABELA_NUM, DESABILITAVEL, FOCO, FOCO_INTERNO,
  type TomSelo, type Icone,
} from "@/components/painel/ui";
import {
  AlertTriangle, CheckCircle, Clock, XCircle, Shield, FileText,
  Filter, RefreshCw, Inbox, SearchX,
} from "lucide-react";

interface TitularRequest {
  id: number;
  cpfCnpj: string;
  nome: string;
  email: string;
  tipoSolicitacao: string;
  descricao: string | null;
  protocolo: string;
  status: string;
  prazoLimite: string | null;
  updatedBy: number | null;
  updatedAt: string | null;
  executionResult: any;
  createdAt: string;
  businessDays: number;
  nearDeadline: boolean;
  overdue: boolean;
}

interface Stats {
  pendente: number;
  em_andamento: number;
  concluido: number;
  recusado: number;
  slaRisco: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/* Vocabulário de domínio desta tela                                   */
/* ------------------------------------------------------------------ */

/** Situação da solicitação, em português e com o tom pelo significado.
 *
 *  `pendente` e `recusada` ficam NEUTROS: a primeira ainda não foi tocada e a
 *  segunda é uma decisão que alguém tomou de propósito — nenhuma das duas é
 *  acidente. `em_andamento` usa a cor da marca porque é o estado ativo, o papel
 *  que a seção 3.4 dá ao acento; `concluida` é o desfecho bom.
 *  O vermelho desta tela pertence ao PRAZO, não à situação — ver `SeloDePrazo`.
 *
 *  A coluna é texto livre, então um valor fora dos quatro é possível (linha
 *  antiga, escrita por fora). Cai no ramo desconhecido, que assume tom neutro
 *  em vez de afirmar uma situação que ninguém apurou. */
const SITUACAO: Record<string, { rotulo: string; tom: TomSelo; Icone: Icone }> = {
  pendente: { rotulo: "Pendente", tom: "neutro", Icone: Clock },
  em_andamento: { rotulo: "Em andamento", tom: "marca", Icone: RefreshCw },
  concluido: { rotulo: "Concluída", tom: "ok", Icone: CheckCircle },
  recusado: { rotulo: "Recusada", tom: "neutro", Icone: XCircle },
};

const SITUACAO_DESCONHECIDA: { rotulo: string; tom: TomSelo; Icone?: Icone } = {
  rotulo: "Desconhecida",
  tom: "neutro",
};

/** Direito exercido pelo titular. É IDENTIDADE, não risco: a seção 3.5 manda
 *  chip neutro — pedir exclusão não é pior do que pedir acesso. */
const TIPO_LABELS: Record<string, string> = {
  acesso: "Acesso",
  correcao: "Correção",
  exclusao: "Exclusão",
  portabilidade: "Portabilidade",
  revogacao: "Revogação",
};

/* ------------------------------------------------------------------ */
/* O que sobrou de local nesta tela                                    */
/* ------------------------------------------------------------------ */

/* A tabela, o rótulo de campo, o estado desabilitado e o anel de foco eram
   cinco constantes escritas aqui — e as mesmas cinco estavam, com outros
   valores, nas telas irmãs. Agora vêm de `painel/ui`: `TabelaPainel`/`Th`/`Td`,
   `RotuloCampo`, `DESABILITAVEL`, `FOCO` e `FOCO_INTERNO`. Nada disto se
   redigita aqui; se um valor mudar, muda para os dois painéis de uma vez. */

/** Recusar é a ação adversa desta tela, e ela merece cautela sem virar alarme:
 *  contorno e tinta de risco, não preenchimento. Um segundo botão cheio ao lado
 *  de "Concluir" faria as duas ações disputarem o clique — e a que fecha a
 *  porta para o titular não pode ser a mais fácil de acertar sem querer.
 *
 *  Continua local porque a primitiva só tem botão de RISCO em forma de ícone —
 *  este é o único CTA adverso com texto do painel. Candidato declarado a subir
 *  quando a segunda tela precisar dele. */
const BOTAO_RISCO = cn(
  "inline-flex items-center justify-center gap-1.5 px-3.5 rounded text-[12.5px] font-medium",
  ALVO_CONTROLE,
  "bg-[var(--surface)] text-[var(--danger)] border border-[var(--danger-border)]",
  "hover:bg-[var(--danger-bg)]",
  FOCO,
  "motion-safe:transition-colors",
  DESABILITAVEL,
);

function maskCpf(cpf: string): string {
  const raw = cpf.replace(/\D/g, "");
  if (raw.length === 11) return `${raw.slice(0, 3)}.***.***-${raw.slice(9)}`;
  if (raw.length === 14) return `${raw.slice(0, 2)}.***.***/${raw.slice(8, 12)}-**`;
  return cpf;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * O prazo do titular — o único lugar desta tela onde a saturação significa
 * alguma coisa.
 *
 * A régua é a mesma de antes, vinda do servidor: 15 dias úteis para responder,
 * `nearDeadline` a partir do 12º e `overdue` a partir do 15º. O que mudou é a
 * cor: eram dois amarelos diferentes da paleta default para o mesmo aviso, mais
 * um verde de contorno para o prazo folgado. Prazo folgado não é notícia — vira
 * neutro; o que aperta é âmbar e o que estourou é vermelho.
 */
function SeloDePrazo({ pedido }: { pedido: TitularRequest }) {
  if (pedido.status === "concluido" || pedido.status === "recusado") {
    return <span className="text-[12px] text-[var(--text-faint)]">—</span>;
  }
  if (pedido.overdue) {
    return <Selo tom="danger" Icone={AlertTriangle}>Vencido</Selo>;
  }
  const restam = 15 - pedido.businessDays;
  if (pedido.nearDeadline) {
    return <Selo tom="gated" Icone={AlertTriangle} className="tabular-nums">Urgente · {restam} dias</Selo>;
  }
  return (
    <Selo tom={restam <= 5 ? "gated" : "neutro"} className="tabular-nums">
      {restam} dias úteis
    </Selo>
  );
}

/* ------------------------------------------------------------------ */

export default function AdminLgpdPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterTipo, setFilterTipo] = useState<string>("all");
  const [selectedRequest, setSelectedRequest] = useState<TitularRequest | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: ["/api/admin/titular-requests/stats"],
  });

  const { data: requests = [], isLoading } = useQuery<TitularRequest[]>({
    queryKey: ["/api/admin/titular-requests"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/admin/titular-requests/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/titular-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/titular-requests/stats"] });
      toast({ title: "Situação atualizada" });
      setSelectedRequest(null);
    },
    onError: (err: Error) => {
      toast({ title: "Não foi possível atualizar", description: err.message, variant: "destructive" });
    },
  });

  const filtered = requests.filter(r => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterTipo !== "all" && r.tipoSolicitacao !== filterTipo) return false;
    return true;
  });

  const emRisco = stats?.slaRisco ?? 0;

  return (
    <div className="p-4 lg:p-6 pb-10 space-y-6" data-testid="admin-lgpd">
      <CabecalhoPainel
        titulo="LGPD — Solicitações de titulares"
        descricao="Direitos que o titular exerce sobre os dados dele: acesso, correção, exclusão, portabilidade e revogação (artigo 18 da LGPD)."
        testIdTitulo="text-lgpd-title"
        acoes={
          /* O total já vinha na resposta e nunca aparecia na tela. Ao lado do
             título ele diz o tamanho da fila sem competir com os cartões, que
             contam por situação. */
          <PilulaCabecalho
            Icone={Shield}
            valor={statsLoading ? "…" : stats?.total ?? 0}
            rotulo="no total"
            testId="pill-total-solicitacoes"
            testIdValor="value-total-solicitacoes"
            titleAtributo="Todas as solicitações recebidas, incluindo as já encerradas."
          />
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <CartaoMetrica
          rotulo="Pendentes"
          Icone={Clock}
          valor={stats?.pendente ?? 0}
          sub="ainda sem triagem"
          carregando={statsLoading}
          testId="card-pendentes"
          testIdValor="value-card-pendentes"
        />
        <CartaoMetrica
          rotulo="Em andamento"
          Icone={FileText}
          valor={stats?.em_andamento ?? 0}
          sub="alguém já assumiu"
          carregando={statsLoading}
          testId="card-em-andamento"
          testIdValor="value-card-em-andamento"
        />
        <CartaoMetrica
          rotulo="Concluídas"
          Icone={CheckCircle}
          valor={stats?.concluido ?? 0}
          sub="titular respondido"
          carregando={statsLoading}
          testId="card-concluidas"
          testIdValor="value-card-concluidas"
        />
        <CartaoMetrica
          rotulo="Recusadas"
          Icone={XCircle}
          valor={stats?.recusado ?? 0}
          sub="com recusa registrada"
          carregando={statsLoading}
          testId="card-recusadas"
          testIdValor="value-card-recusadas"
        />
        {/* O ÚNICO cartão que pode gritar, e só quando há motivo: solicitação
            aberta há 12 dias úteis ou mais, de um prazo legal de 15. Sem
            nenhuma em risco ele fica igual aos irmãos — alarme permanente
            deixa de ser alarme. */}
        <CartaoMetrica
          rotulo="Prazo em risco"
          Icone={AlertTriangle}
          valor={emRisco}
          sub="abertas há 12+ dias úteis, de 15"
          carregando={statsLoading}
          testId="card-prazo-risco"
          testIdValor="value-card-prazo-risco"
          className={emRisco > 0 ? "border-[var(--danger-border)] bg-[var(--danger-bg)]" : undefined}
        />
      </div>

      <section>
        <KickerSecao>Solicitações recebidas</KickerSecao>
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] flex flex-wrap items-center gap-3">
            <Filter className="w-3.5 h-3.5 text-[var(--text-faint)] flex-none" strokeWidth={2} aria-hidden />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className={cn(CONTROLE_CAMPO, "w-48")} aria-label="Filtrar por situação" data-testid="select-filtro-situacao">
                <SelectValue placeholder="Filtrar por situação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as situações</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="em_andamento">Em andamento</SelectItem>
                <SelectItem value="concluido">Concluída</SelectItem>
                <SelectItem value="recusado">Recusada</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterTipo} onValueChange={setFilterTipo}>
              <SelectTrigger className={cn(CONTROLE_CAMPO, "w-48")} aria-label="Filtrar por direito exercido" data-testid="select-filtro-tipo">
                <SelectValue placeholder="Filtrar por direito" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os direitos</SelectItem>
                <SelectItem value="acesso">Acesso</SelectItem>
                <SelectItem value="correcao">Correção</SelectItem>
                <SelectItem value="exclusao">Exclusão</SelectItem>
                <SelectItem value="portabilidade">Portabilidade</SelectItem>
                <SelectItem value="revogacao">Revogação</SelectItem>
              </SelectContent>
            </Select>
            <span className="ml-auto text-[12px] text-[var(--text-muted)]">
              <span className={TABELA_NUM}>{filtered.length}</span> na lista
            </span>
          </div>

          {isLoading ? (
            <div className="p-4">
              <LinhasSkeleton linhas={4} />
            </div>
          ) : filtered.length === 0 ? (
            /* Duas leituras diferentes, e a tela não pode confundi-las: não
               chegou pedido nenhum, ou chegou e o filtro escondeu todos. A
               primeira é boa notícia; a segunda pode estar escondendo um
               prazo correndo. */
            <EstadoVazio
              Icone={requests.length === 0 ? Inbox : SearchX}
              titulo={requests.length === 0 ? "Nenhuma solicitação recebida" : "Nenhuma solicitação neste filtro"}
              descricao={
                requests.length === 0
                  ? "Quando um titular pedir acesso, correção ou exclusão dos dados dele pela página de privacidade, o pedido aparece aqui com protocolo e prazo."
                  : "Existem solicitações registradas, mas nenhuma atende aos filtros escolhidos — e um prazo pode estar correndo fora deles."
              }
              cta={
                requests.length > 0 ? (
                  <button
                    type="button"
                    className={BOTAO_SECUNDARIO}
                    onClick={() => { setFilterStatus("all"); setFilterTipo("all"); }}
                    data-testid="button-limpar-filtros"
                  >
                    Limpar filtros
                  </button>
                ) : undefined
              }
              testId="empty-solicitacoes"
            />
          ) : (
            /* O cabeçalho traz fundo e hairline de dentro da primitiva — antes
               eles estavam no `<tr>`, escritos à mão. A última linha perde a
               sua: a tabela termina no rodapé do cartão, e duas hairlines
               coladas leem como uma borda de 2px. */
            <TabelaPainel className="[&_tbody_tr:last-child_td]:border-0">
                <thead>
                  <tr>
                    {/* Protocolo, CPF e as duas datas se leem da esquerda para a
                        direita como identificador: por isso mono SEM alinhar à
                        direita, e a cabeça acompanha a célula. */}
                    <Th>Protocolo</Th>
                    <Th>CPF/CNPJ</Th>
                    <Th>Direito exercido</Th>
                    <Th>Situação</Th>
                    <Th>Recebida em</Th>
                    <Th>Prazo de resposta</Th>
                    <Th>Prazo legal</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const st = SITUACAO[r.status] ?? SITUACAO_DESCONHECIDA;
                    return (
                      /* A linha inteira abre o detalhe, e isso era só do
                         mouse: sem foco e sem tecla, o operador de teclado não
                         alcançava a única ação da tela. `tabIndex` + Enter/Espaço
                         resolvem, e o anel de foco vem junto — seção 7, não
                         negociável. A ação continua sendo exatamente a mesma. */
                      <tr
                        key={r.id}
                        className={cn(
                          "hover:bg-[var(--surface-2)] motion-safe:transition-colors cursor-pointer",
                          /* Anel para DENTRO: a linha encosta na borda do
                             cartão, e com deslocamento para fora ela cortaria
                             metade do anel. */
                          FOCO_INTERNO,
                        )}
                        onClick={() => setSelectedRequest(r)}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedRequest(r);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`Abrir a solicitação ${r.protocolo}`}
                        data-testid={`titular-row-${r.id}`}
                      >
                        <Td>
                          <span className={cn(TABELA_NUM, "text-[12px] font-medium text-[var(--text)]")}>{r.protocolo}</span>
                        </Td>
                        <Td num alinhamento="esquerda" className="text-[12px]">{maskCpf(r.cpfCnpj)}</Td>
                        <Td>
                          <Selo tom="neutro">{TIPO_LABELS[r.tipoSolicitacao] ?? r.tipoSolicitacao}</Selo>
                        </Td>
                        <Td>
                          <Selo tom={st.tom} Icone={st.Icone}>{st.rotulo}</Selo>
                        </Td>
                        <Td num alinhamento="esquerda" className="text-[12px] text-[var(--text-muted)]">{formatDate(r.createdAt)}</Td>
                        <Td num alinhamento="esquerda" className="text-[12px] text-[var(--text-muted)]">{formatDate(r.prazoLimite)}</Td>
                        <Td><SeloDePrazo pedido={r} /></Td>
                      </tr>
                    );
                  })}
                </tbody>
            </TabelaPainel>
          )}
        </Card>
      </section>

      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px] font-medium tracking-[-0.02em] text-[var(--text)]">
              <Shield className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
              Detalhes da solicitação
            </DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <RotuloCampo>protocolo</RotuloCampo>
                  <p className={cn(TABELA_NUM, "text-[12.5px] text-[var(--text)]")} data-testid="detalhe-protocolo">
                    {selectedRequest.protocolo}
                  </p>
                </div>
                <div>
                  <RotuloCampo>situação</RotuloCampo>
                  <div>
                    {(() => {
                      const st = SITUACAO[selectedRequest.status] ?? SITUACAO_DESCONHECIDA;
                      return <Selo tom={st.tom} Icone={st.Icone}>{st.rotulo}</Selo>;
                    })()}
                  </div>
                </div>
                <div>
                  <RotuloCampo>nome</RotuloCampo>
                  <p className="text-[12.5px] text-[var(--text)]">{selectedRequest.nome}</p>
                </div>
                <div>
                  <RotuloCampo>cpf/cnpj</RotuloCampo>
                  <p className={cn(TABELA_NUM, "text-[12.5px] text-[var(--text)]")}>{maskCpf(selectedRequest.cpfCnpj)}</p>
                </div>
                <div>
                  <RotuloCampo>direito exercido</RotuloCampo>
                  <p className="text-[12.5px] text-[var(--text)]">
                    {TIPO_LABELS[selectedRequest.tipoSolicitacao] ?? selectedRequest.tipoSolicitacao}
                  </p>
                </div>
                <div>
                  <RotuloCampo>prazo legal</RotuloCampo>
                  <div><SeloDePrazo pedido={selectedRequest} /></div>
                </div>
                <div>
                  <RotuloCampo>recebida em</RotuloCampo>
                  <p className={cn(TABELA_NUM, "text-[12.5px] text-[var(--text-2)]")}>{formatDateTime(selectedRequest.createdAt)}</p>
                </div>
                <div>
                  <RotuloCampo>prazo de resposta</RotuloCampo>
                  <p className={cn(TABELA_NUM, "text-[12.5px] text-[var(--text-2)]")}>{formatDate(selectedRequest.prazoLimite)}</p>
                </div>
              </div>

              {selectedRequest.descricao && (
                <div>
                  <RotuloCampo>o que o titular pediu</RotuloCampo>
                  <p className="text-[12.5px] text-[var(--text-2)] leading-relaxed bg-[var(--surface-inset)] rounded p-3">
                    {selectedRequest.descricao}
                  </p>
                </div>
              )}

              {selectedRequest.updatedAt && (
                <p className="text-[12px] text-[var(--text-muted)] border-t border-[var(--border)] pt-3">
                  Última atualização:{" "}
                  <span className={TABELA_NUM}>{formatDateTime(selectedRequest.updatedAt)}</span>
                </p>
              )}

              {selectedRequest.executionResult && (
                <div>
                  {/* O conteúdo é o registro cru do que a plataforma executou —
                      não há como traduzi-lo sem inventar campo que não se
                      conhece. O rótulo, esse sim, sai em português: ele diz o
                      que o bloco é antes de o operador tropeçar no JSON. */}
                  <RotuloCampo>registro do atendimento</RotuloCampo>
                  <pre className="text-[11px] font-mono text-[var(--text-2)] bg-[var(--surface-inset)] rounded p-3 overflow-auto max-h-48">
                    {JSON.stringify(selectedRequest.executionResult, null, 2)}
                  </pre>
                </div>
              )}

              {selectedRequest.status !== "concluido" && selectedRequest.status !== "recusado" && (
                <div className="flex gap-2 pt-3 border-t border-[var(--border)] flex-wrap">
                  {selectedRequest.status === "pendente" && (
                    <button
                      type="button"
                      className={cn(BOTAO_SECUNDARIO, DESABILITAVEL)}
                      onClick={() => updateStatusMutation.mutate({ id: selectedRequest.id, status: "em_andamento" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid="button-marcar-em-andamento"
                    >
                      <RefreshCw className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
                      Assumir atendimento
                    </button>
                  )}
                  <button
                    type="button"
                    className={cn(BOTAO_MARCA, DESABILITAVEL)}
                    onClick={() => updateStatusMutation.mutate({ id: selectedRequest.id, status: "concluido" })}
                    disabled={updateStatusMutation.isPending}
                    data-testid="button-concluir"
                  >
                    <CheckCircle className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
                    Concluir
                  </button>
                  <button
                    type="button"
                    className={BOTAO_RISCO}
                    onClick={() => updateStatusMutation.mutate({ id: selectedRequest.id, status: "recusado" })}
                    disabled={updateStatusMutation.isPending}
                    data-testid="button-recusar"
                  >
                    Recusar
                  </button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
