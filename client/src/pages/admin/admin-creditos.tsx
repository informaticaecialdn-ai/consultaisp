import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { usePrecos, pedidoDeCreditoPronto } from "@/hooks/use-precos";
import { cn } from "@/lib/utils";
import {
  CabecalhoPainel, CartaoMetrica, KickerSecao, Selo, EstadoVazio, LinhasSkeleton,
  TabelaPainel, Th, Td, TABELA_NUM, BotaoIcone, BOTAO_ICONE, Campo, RotuloCampo,
  AvisoNaoCarregou, TITULO_CARTAO, BOTAO_SECUNDARIO, BOTAO_MARCA,
  type TomSelo, type Icone,
} from "@/components/painel/ui";
import {
  Dinheiro, ChipFiltro, ModalCobrancaAsaas, ModalPixAsaas, CONTROLE_CAMPO,
} from "@/components/admin/financeiro-ui";
import {
  Plus, RefreshCw, CheckCircle, XCircle, Clock,
  Wallet, QrCode, ExternalLink, RotateCcw, CheckCheck,
  ArrowUpRight, Search, Shield, Filter, DollarSign, ShoppingCart,
} from "lucide-react";

/**
 * Pedidos de crédito do superadmin, na MESMA linguagem do Painel do Provedor.
 *
 * Esta rodada é de LINGUAGEM VISUAL: nenhuma rota, queryKey, permissão ou
 * mutação mudou. O que mudou é quem fala — a tela agora consome
 * `@/components/painel/ui` em vez de repetir classes próprias, e usa os tokens
 * canônicos (`--text`, `--surface`, `--brand`, `--ok`…) no lugar da API antiga
 * de token e da paleta default do Tailwind. (O literal daquela API não aparece
 * escrito aqui de propósito: a auditoria que confere se ela sumiu é feita por
 * grep, e o comentário que conta a história envenenaria o resultado.)
 *
 * O QUE SAIU, E POR QUÊ
 * - Cinco cartões com faixa em gradiente no topo e ladrilho de ícone também
 *   em gradiente, ambos na paleta default: duas proibições da seção 7 em
 *   cada cartão. Viraram `CartaoMetrica`, cujo ícone é
 *   sempre neutro — quando toda métrica da linha é informativa, cor por cartão
 *   é ruído, e a pele reserva saturação para risco (seção 3).
 * - Spinner centralizado no carregamento da lista e "Nenhum pedido
 *   encontrado" solto no vazio: a seção 6 chama os dois de estado real.
 *   Viraram `LinhasSkeleton` e `EstadoVazio`.
 * - Badges escritos à mão, uns na API antiga de token e outros num azul da
 *   paleta default: viraram `Selo`.
 * - Botões de ação de 28px (`h-7 w-7`): abaixo do alvo mínimo de toque. Agora
 *   passam pela mesma regra de `ALVO_CONTROLE` — densos no mouse, 44px no dedo.
 *
 * TODO NÚMERO É MONO TABULAR (seção 2): valor, contagem de crédito, contagem
 * de filtro e data. Era o que mais faltava aqui: a coluna de valor usava a
 * fonte de texto e desalinhava linha a linha.
 *
 * SEGUNDA RODADA — AS CÓPIAS LOCAIS SAÍRAM
 * Esta tela mantinha `TH`, `TD`, `NUM`, `ROTULO_CAMPO`, `BOTAO_ICONE` e o anel
 * de foco redigitados aqui, porque `painel/ui` ainda não os tinha. Agora tem, e
 * a cópia foi apagada: enquanto ela existisse, o próximo ajuste seria feito de
 * um lado só e a divergência voltaria pelo mesmo caminho.
 *
 * O que MUDA de aparência com a troca, de propósito:
 * - o cabeçalho e a célula ganham o padding da seção 6 (14px, e não 16px), e a
 *   célula ganha o hairline que separa uma linha da outra;
 * - o rótulo de campo troca Inter 10,5px com tracking cravado por mono 10px com
 *   `var(--track-wide)`: a seção 2 pede a mono e diz, com todas as letras, para
 *   não cravar o valor do tracking;
 * - o botão de ícone sobe de 32px para 36px no ponteiro fino, que é a altura de
 *   controle que `ALVO_CONTROLE` já fixou para estes painéis (no dedo continua
 *   44px). Um botão de 32px ao lado de um chip de 36px na mesma barra era
 *   exatamente a divergência que a primitiva existe para acabar;
 * - "Liberar créditos" e "Cancelar pedido" deixam de ser coloridos em repouso e
 *   vestem a tinta semântica só no hover, como a primitiva define: ícone
 *   colorido repetido em toda linha vira alarme contínuo, e o operador para de
 *   ver o alarme que importa.
 *
 * TERCEIRA RODADA — ESTA TELA ENTRA NO VOCABULÁRIO FINANCEIRO
 * `components/admin/financeiro-ui.tsx` nasceu para as DUAS telas de fatura do
 * superadmin e deixou esta de fora, ainda que ela cobre pelo mesmo gateway, com
 * a mesma lista filtrada e o mesmo formulário de emissão. Enquanto ficou de
 * fora, ela manteve escritos à mão: os dois modais do Asaas, o chip de filtro, a
 * altura de campo e a formatação de dinheiro. Todos saíram daqui.
 *
 * O QUE MUDA DE APARÊNCIA, E POR QUÊ
 * - Os modais ganham `role="dialog"`, `aria-modal` e `aria-label` — sem eles o
 *   leitor de tela anuncia uma `div` e o conteúdo atrás continua sendo lido.
 * - O título do modal sobe de 13,5px (corpo de título de CARTÃO) para 15px: o
 *   modal É a tela enquanto está aberto, então seu título não pode falar no
 *   corpo de um cartão qualquer da página atrás dele.
 * - O padding do modal cai de 24px para 20px, a densidade que as outras duas
 *   telas já usavam.
 * - O QR Code cinza de enfeite SAIU. Quando o Asaas não devolve a imagem, a
 *   caixa passa a dizer isso: um desenho de QR Code no lugar exato do QR Code
 *   que falta é um placeholder mudo com a cara do dado ausente, e o operador
 *   fica tentando ler o que não existe.
 * - O botão de copiar o código PIX ganha `data-testid="button-copy-pix"`, que a
 *   peça compartilhada emite e esta tela não tinha. É testid ganho, nenhum
 *   perdido.
 *
 * O TESTID DAS OPÇÕES DE COBRANÇA MUDOU, e a decisão está escrita aqui:
 * `button-modal-charge-{undefined|pix|boleto}` passou a
 * `button-charge-{undefined|pix|boleto}`, o nome que a peça compartilhada emite
 * nas outras duas telas. Nenhum teste, script ou automação do repositório cita
 * o nome antigo (conferido por grep em todo o projeto), então o critério "não
 * quebrar automação existente" não é ferido — e o ganho é as três telas
 * chamarem o mesmo botão pelo mesmo nome. O botão da LINHA que abre o modal
 * continua `button-charge-<id do pedido>`, intocado; como o sufixo dele é
 * sempre numérico, ele nunca colide com as três formas de cobrança.
 */

/* ------------------------------------------------------------------ */
/* Vocabulário de domínio desta tela                                   */
/* ------------------------------------------------------------------ */

/** Situação do pedido, em português e com o tom pelo significado.
 *
 *  `pending` é a porta que ainda não abriu (`gated`), `paid` é o desfecho bom
 *  (`ok`), `overdue` é falha de pagamento (`danger`). `cancelled` fica NEUTRO
 *  de propósito: pedido cancelado pelo próprio superadmin não é acidente, e
 *  pintá-lo de vermelho competiria com o vencido, que é o que pede ação.
 *
 *  A coluna é texto livre, então um valor fora dos quatro é possível (linha
 *  antiga, escrita por fora). Cai no ramo desconhecido, que assume tom neutro
 *  em vez de afirmar uma situação que ninguém apurou. */
const SITUACAO_PEDIDO: Record<string, { rotulo: string; tom: TomSelo; Icone: Icone }> = {
  pending: { rotulo: "Pendente", tom: "gated", Icone: Clock },
  paid: { rotulo: "Pago", tom: "ok", Icone: CheckCheck },
  cancelled: { rotulo: "Cancelado", tom: "neutro", Icone: XCircle },
  overdue: { rotulo: "Vencido", tom: "danger", Icone: XCircle },
};

const SITUACAO_DESCONHECIDA: { rotulo: string; tom: TomSelo; Icone?: Icone } = {
  rotulo: "Desconhecida",
  tom: "neutro",
};

/** Tipo do crédito é IDENTIDADE, não risco — a seção 3.5 manda chip neutro,
 *  com o ícone fazendo a distinção. Antes o ISP saía num azul da paleta
 *  default e o SPC na cor da marca, o que dava a um dos dois um destaque que o
 *  outro não tinha sem nenhum motivo de leitura. */
const TIPO_CREDITO: Record<string, { rotulo: string; Icone?: Icone }> = {
  isp: { rotulo: "ISP", Icone: Search },
  spc: { rotulo: "SPC", Icone: Shield },
  mixed: { rotulo: "Misto" },
};

/* ------------------------------------------------------------------ */
/* O QUE ERA LOCAL AQUI, E PARA ONDE FOI                               */
/* ------------------------------------------------------------------ */

/* CHIP DE FILTRO → `ChipFiltro` de `../../components/admin/financeiro-ui`.
 *
 * A versão daqui pintava o chip ativo com a marca CHEIA e citava a seção 3.4
 * para isso; a compartilhada usa `--brand-soft` e cita a 3.1. A arbitragem está
 * escrita por extenso no comentário de `ChipFiltro`, e o soft venceu: a 3.4
 * mapeia qual FAMÍLIA de token o estado ativo usa, e a 3.1 nomeia
 * `--brand-soft`, com todas as letras, como o fundo de "chip de marca". Além
 * disso a marca cheia é a voz do CTA, e esta barra de filtros fica na mesma
 * tela do botão cheio "Novo pedido" — dois cheios disputando a mesma atenção,
 * sendo que o filtro escolhido não é a ação principal daqui.
 *
 * ALTURA DE CAMPO → `CONTROLE_CAMPO`. A versão daqui era a TERCEIRA medida de
 * caixa de formulário do mesmo painel: só altura, sem a borda de área editável
 * que a seção 3.1 reserva ao input (`--border-strong`).
 *
 * FORMATAÇÃO DE MOEDA → `<Dinheiro>`. O `fmt()` local devolvia o número sem o
 * "R$", que era colado à mão em cada ponto — e o cifrão ficava fora da mono
 * tabular, ou dentro dela por acidente, conforme o ponto. `<Dinheiro>` monta os
 * dois juntos, sempre em mono tabular, e é onde o token de valor negativo mora.
 * A única grafia de "R$" que continua escrita nesta tela é o rótulo do campo
 * "valor (R$)": ali o cifrão nomeia a UNIDADE de uma caixa vazia, não formata
 * um valor. */

/* ------------------------------------------------------------------ */

export default function AdminCreditosPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isSuperAdmin = user?.role === "superadmin";

  const [showNewOrder, setShowNewOrder] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterProvider, setFilterProvider] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [asaasChargeModal, setAsaasChargeModal] = useState<{ orderId: number; orderNumber: string; amount: string } | null>(null);
  const [pixModal, setPixModal] = useState<{ pixData: any } | null>(null);
  const [form, setForm] = useState({
    providerId: "", packageId: "",
    customCredits: "100", customAmount: "100.00",
    notes: "", billingType: "",
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/credit-orders"],
    enabled: isSuperAdmin,
    refetchInterval: 30000,
  });

  const { data: allProviders = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    enabled: isSuperAdmin,
  });

  /**
   * Os pacotes vem do servidor. A copia que morava neste arquivo listava
   * "50 ISP", "10 SPC" e afins — ids que o servidor deixou de reconhecer
   * quando o credito virou unico (migration 0008). O superadmin escolhia um
   * pacote e o POST respondia "Pacote invalido": o pedido manual estava
   * quebrado, e a tela nao tinha como saber.
   */
  const { data: precos, isLoading: carregandoPrecos, isError: erroPrecos, refetch: recarregarPrecos } = usePrecos();
  const pacotes = precos?.pacotes ?? [];

  const { data: asaasStatus } = useQuery<any>({
    queryKey: ["/api/admin/asaas/status"],
    enabled: isSuperAdmin,
    staleTime: 60000,
  });

  const createOrderMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/credit-orders", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/credit-orders"] });
      setShowNewOrder(false);
      setForm({ providerId: "", packageId: "", customCredits: "100", customAmount: "100.00", notes: "", billingType: "" });
      toast({ title: "Pedido criado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const releaseMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/credit-orders/${id}/release`, {});
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/credit-orders"] });
      toast({ title: "Créditos liberados", description: data.message });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/admin/credit-orders/${id}`, { status: "cancelled" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/credit-orders"] });
      toast({ title: "Pedido cancelado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const createChargeMutation = useMutation({
    mutationFn: async ({ id, billingType }: { id: number; billingType: string }) => {
      const res = await apiRequest("POST", `/api/admin/credit-orders/${id}/asaas/charge`, { billingType });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/credit-orders"] });
      setAsaasChargeModal(null);
      toast({ title: "Cobrança Asaas criada" });
    },
    onError: (e: any) => toast({ title: "Erro Asaas", description: e.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/credit-orders/${id}/asaas/sync`, {});
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/credit-orders"] });
      toast({ title: "Sincronizado", description: data.message || "Situação atualizada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const pixMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("GET", `/api/admin/credit-orders/${id}/asaas/pix`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => setPixModal({ pixData: data }),
    onError: (e: any) => toast({ title: "Erro PIX", description: e.message, variant: "destructive" }),
  });

  if (!isSuperAdmin) {
    return (
      <div className="p-4 lg:p-5">
        <Card>
          <EstadoVazio
            Icone={Shield}
            titulo="Acesso restrito"
            descricao="Esta tela é do administrador da plataforma. Sua conta não tem esse acesso."
          />
        </Card>
      </div>
    );
  }

  const filteredOrders = orders.filter(o => {
    if (filterStatus !== "all" && o.status !== filterStatus) return false;
    if (filterProvider !== "all" && o.providerId.toString() !== filterProvider) return false;
    if (filterType !== "all" && o.creditType !== filterType) return false;
    return true;
  });

  const totalPending = orders.filter(o => o.status === "pending").length;
  const totalRevenue = orders.filter(o => o.status === "paid").reduce((s: number, o: any) => s + parseFloat(o.amount), 0);
  const totalIspReleased = orders.filter(o => o.status === "paid").reduce((s: number, o: any) => s + o.ispCredits, 0);
  const totalSpcReleased = orders.filter(o => o.status === "paid").reduce((s: number, o: any) => s + o.spcCredits, 0);

  // Enquanto a tabela nao chega nao ha id valido; o popular e o padrao.
  const pacoteInicial = pacotes.find(p => p.popular) || pacotes[0];
  const packageId = form.packageId || pacoteInicial?.id || "";
  const selectedPkg = pacotes.find(p => p.id === packageId);
  /**
   * Sem pacote resolvido o POST vai com `packageId: ""`, que o servidor le
   * como falsy e trata como "Personalizado": grava um pedido de 100 creditos
   * por R$ 100,00 — os defaults deste formulario — e emite a cobranca no Asaas
   * se o superadmin tiver escolhido forma de pagamento. Antes da tabela vir do
   * servidor isso nao acontecia: o id sempre existia e, se estivesse errado, o
   * servidor respondia "Pacote invalido" e nada era gravado.
   */
  const podeCriarPedido = pedidoDeCreditoPronto({
    providerId: form.providerId,
    packageId,
    pacoteEscolhido: selectedPkg,
  });

  const FILTROS_SITUACAO = [
    { v: "all", l: "Todos", count: orders.length },
    { v: "pending", l: "Pendentes", count: orders.filter((o: any) => o.status === "pending").length },
    { v: "paid", l: "Pagos", count: orders.filter((o: any) => o.status === "paid").length },
    { v: "cancelled", l: "Cancelados", count: orders.filter((o: any) => o.status === "cancelled").length },
  ];

  return (
    <div className="p-4 lg:p-6 pb-10 space-y-6">
      {/* Os dois modais do Asaas vivem em `@/components/admin/financeiro-ui`:
          eram a mesma peça escrita aqui, na página `admin-financeiro` e na aba
          Faturas e Cobranças. Esta era a terceira cópia, e divergia das outras
          duas no corpo do título, no padding, na acessibilidade, no nome do
          `data-testid` e num QR Code de enfeite. */}
      {asaasChargeModal && (
        <ModalCobrancaAsaas
          rotuloDoDocumento="Pedido"
          numeroDaFatura={asaasChargeModal.orderNumber}
          valor={asaasChargeModal.amount}
          emAndamento={createChargeMutation.isPending}
          onEscolher={(formaDeCobranca) =>
            createChargeMutation.mutate({ id: asaasChargeModal.orderId, billingType: formaDeCobranca })
          }
          onFechar={() => setAsaasChargeModal(null)}
        />
      )}

      {pixModal && (
        <ModalPixAsaas pix={pixModal.pixData} onFechar={() => setPixModal(null)} />
      )}

      <CabecalhoPainel
        titulo="Pedidos de Créditos"
        descricao="Compras de crédito dos provedores"
        acoes={
          <>
            {asaasStatus?.configured && (
              /* "Sandbox" e "Producao" eram valor cru do gateway na tela. O que
                 o superadmin precisa saber é se a cobrança que ele emitir vai
                 valer dinheiro — e é isso que o selo passa a dizer. */
              <Selo tom={asaasStatus.mode === "sandbox" ? "gated" : "ok"} Icone={Wallet}>
                {asaasStatus.mode === "sandbox" ? "Asaas em teste" : "Asaas em produção"}
              </Selo>
            )}
            <button
              type="button"
              className={BOTAO_SECUNDARIO}
              onClick={() => qc.invalidateQueries({ queryKey: ["/api/admin/credit-orders"] })}
              data-testid="button-refresh-orders"
            >
              <RefreshCw className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
              Atualizar
            </button>
            <button
              type="button"
              className={BOTAO_MARCA}
              onClick={() => setShowNewOrder(!showNewOrder)}
              data-testid="button-new-order"
            >
              <Plus className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
              Novo pedido
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <CartaoMetrica rotulo="Pedidos" Icone={ShoppingCart} valor={orders.length} sub="no total" carregando={ordersLoading} testId="card-total-pedidos" testIdValor="value-card-total-pedidos" />
        <CartaoMetrica rotulo="Pendentes" Icone={Clock} valor={totalPending} sub="aguardando liberação" carregando={ordersLoading} testId="card-pedidos-pendentes" testIdValor="value-card-pedidos-pendentes" />
        <CartaoMetrica rotulo="Receita gerada" Icone={DollarSign} valor={<Dinheiro valor={totalRevenue} />} sub="pedidos pagos" carregando={ordersLoading} testId="card-receita-creditos" testIdValor="value-card-receita-creditos" />
        <CartaoMetrica rotulo="Créditos ISP liberados" Icone={Search} valor={totalIspReleased.toLocaleString("pt-BR")} sub="em pedidos pagos" carregando={ordersLoading} testId="card-isp-liberados" testIdValor="value-card-isp-liberados" />
        <CartaoMetrica rotulo="Créditos SPC liberados" Icone={Shield} valor={totalSpcReleased.toLocaleString("pt-BR")} sub="em pedidos pagos" carregando={ordersLoading} testId="card-spc-liberados" testIdValor="value-card-spc-liberados" />
      </div>

      {showNewOrder && (
        <section>
          <KickerSecao>Novo pedido</KickerSecao>
          {/* O card tinha borda e fundo num azul da paleta default — um azul
              que não existe em lugar nenhum deste produto. Superfície aninhada
              é `--surface-2` (seção 3.1). */}
          <Card className="p-4 bg-[var(--surface-2)]">
            <h3 className={`${TITULO_CARTAO} flex items-center gap-2 mb-4`}>
              <Plus className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
              Gerar pedido de crédito
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* POR QUE `RotuloCampo` (um <span>) E NAO `Campo` NOS SELETORES:
                  `Campo` monta um <label> com o controle DENTRO, e o gatilho do
                  Select e um <button>. Clicar no proprio gatilho faria o <label>
                  reenviar o clique para ele — abre e fecha no mesmo toque. Onde
                  o controle e um <input> nativo isso nao acontece, e ai o
                  `Campo` e usado, que e o que da a associacao de verdade. */}
              <div>
                <RotuloCampo>provedor</RotuloCampo>
                <Select value={form.providerId} onValueChange={v => setForm(f => ({ ...f, providerId: v }))}>
                  <SelectTrigger className={CONTROLE_CAMPO} data-testid="select-order-provider">
                    <SelectValue placeholder="Selecionar provedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {allProviders.map((p: any) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <RotuloCampo>pacote</RotuloCampo>
                {erroPrecos ? (
                  /* Seletor vazio nao explica nada: o superadmin escolheria
                     "Personalizado" achando que os pacotes acabaram.
                     A faixa vem de `AvisoNaoCarregou`; o padding de 2,5 que esta
                     tela usava continua, pela `className` — a caixa vive dentro
                     de uma coluna estreita do formulario. O "Tentar de novo"
                     ganha o alvo de toque da secao 7, que a copia manuscrita
                     nao tinha. */
                  <AvisoNaoCarregou
                    className="px-2.5"
                    aoTentarDeNovo={() => recarregarPrecos()}
                    testId="erro-precos-pedido"
                  >
                    Não foi possível carregar a tabela de preços.
                  </AvisoNaoCarregou>
                ) : (
                  <Select value={packageId} disabled={carregandoPrecos && pacotes.length === 0} onValueChange={v => {
                    const pkg = pacotes.find(p => p.id === v);
                    setForm(f => ({
                      ...f, packageId: v,
                      customCredits: pkg ? pkg.creditos.toString() : f.customCredits,
                      customAmount: pkg ? (pkg.precoCentavos / 100).toFixed(2) : f.customAmount,
                    }));
                  }}>
                    <SelectTrigger className={CONTROLE_CAMPO} data-testid="select-order-package">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {pacotes.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.nome} — {p.precoLabel}</SelectItem>
                      ))}
                      <SelectItem value="custom">Personalizado</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <RotuloCampo>cobrança asaas (opcional)</RotuloCampo>
                <Select value={form.billingType} onValueChange={v => setForm(f => ({ ...f, billingType: v }))}>
                  <SelectTrigger className={CONTROLE_CAMPO} data-testid="select-order-billing">
                    <SelectValue placeholder="Sem cobrança Asaas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem cobrança automática</SelectItem>
                    <SelectItem value="UNDEFINED">Asaas — Livre</SelectItem>
                    <SelectItem value="PIX">Asaas — PIX</SelectItem>
                    <SelectItem value="BOLETO">Asaas — Boleto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.packageId === "custom" && (
                <>
                  {/* Sem seletor ISP/SPC: o credito e unico desde a migration 0008 e o servidor ignora o tipo. */}
                  <Campo rotulo="quantidade de créditos">
                    <Input className={cn(CONTROLE_CAMPO, TABELA_NUM)} type="number" value={form.customCredits} onChange={e => setForm(f => ({ ...f, customCredits: e.target.value }))} data-testid="input-custom-credits" />
                  </Campo>
                  <Campo rotulo="valor (R$)">
                    <Input className={cn(CONTROLE_CAMPO, TABELA_NUM)} type="number" step="0.01" value={form.customAmount} onChange={e => setForm(f => ({ ...f, customAmount: e.target.value }))} data-testid="input-custom-amount" />
                  </Campo>
                </>
              )}
              <Campo rotulo="observações (opcional)" className="lg:col-span-3">
                <Input className={CONTROLE_CAMPO} placeholder="Ex.: cortesia, campanha especial…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </Campo>
            </div>

            {form.providerId && packageId && (
              <div className="mt-3 p-3 bg-[var(--surface)] rounded-lg border border-[var(--border)] flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
                <div>
                  <span className="text-[var(--text-muted)]">Provedor: </span>
                  <strong className="font-medium text-[var(--text)]">
                    {allProviders.find((p: any) => p.id.toString() === form.providerId)?.name || "—"}
                  </strong>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Créditos: </span>
                  <strong className={cn(TABELA_NUM, "font-medium text-[var(--text)]")}>
                    {form.packageId === "custom" ? form.customCredits : (selectedPkg?.creditos ?? 0)}
                  </strong>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Valor: </span>
                  <strong className={cn(TABELA_NUM, "font-medium text-[var(--text)]")}>
                    {form.packageId === "custom"
                      ? <Dinheiro valor={form.customAmount || "0"} />
                      : (selectedPkg?.precoLabel ?? "—")}
                  </strong>
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-4 flex-wrap">
              <button
                type="button"
                className={BOTAO_MARCA}
                disabled={!podeCriarPedido || createOrderMutation.isPending}
                onClick={() => createOrderMutation.mutate({
                  providerId: form.providerId,
                  packageId: packageId === "custom" ? undefined : packageId,
                  customCredits: form.customCredits,
                  customAmount: form.customAmount,
                  notes: form.notes,
                  billingType: (form.billingType && form.billingType !== "none") ? form.billingType : undefined,
                })}
                data-testid="button-submit-order"
              >
                {createOrderMutation.isPending
                  ? <RefreshCw className="w-3.5 h-3.5 flex-none motion-safe:animate-spin" strokeWidth={2} />
                  : <Plus className="w-3.5 h-3.5 flex-none" strokeWidth={2} />}
                Criar pedido
              </button>
              <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setShowNewOrder(false)} data-testid="button-cancel-new-order">
                Cancelar
              </button>
            </div>
          </Card>
        </section>
      )}

      <section>
        <KickerSecao>Pedidos</KickerSecao>
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] flex flex-wrap items-center gap-3">
            {/* O grupo nomeado é o que as outras duas telas financeiras já
                fazem: sem ele o leitor de tela lê quatro botões soltos e não
                diz que eles são um filtro só, com uma opção escolhida. */}
            <div
              className="flex items-center gap-2 flex-wrap"
              role="group"
              aria-label="Filtrar pedidos por situação"
            >
              <Filter className="w-3.5 h-3.5 text-[var(--text-faint)] flex-none" strokeWidth={2} aria-hidden />
              {FILTROS_SITUACAO.map(f => (
                <ChipFiltro
                  key={f.v}
                  ativo={filterStatus === f.v}
                  contagem={f.count}
                  onClick={() => setFilterStatus(f.v)}
                  testId={`button-filter-status-${f.v}`}
                >
                  {f.l}
                </ChipFiltro>
              ))}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className={cn(CONTROLE_CAMPO, "w-32")} aria-label="Filtrar por tipo de crédito">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="isp">ISP</SelectItem>
                  <SelectItem value="spc">SPC</SelectItem>
                  <SelectItem value="mixed">Misto</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterProvider} onValueChange={setFilterProvider}>
                <SelectTrigger className={cn(CONTROLE_CAMPO, "w-44")} aria-label="Filtrar por provedor">
                  <SelectValue placeholder="Todos os provedores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os provedores</SelectItem>
                  {allProviders.map((p: any) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {ordersLoading ? (
            <div className="p-4">
              <LinhasSkeleton linhas={4} />
            </div>
          ) : filteredOrders.length === 0 ? (
            /* Duas leituras diferentes, e a tela não pode confundi-las: não há
               pedido nenhum, ou há e o filtro escondeu todos. */
            <EstadoVazio
              Icone={ShoppingCart}
              titulo={orders.length === 0 ? "Nenhum pedido de crédito" : "Nenhum pedido neste filtro"}
              descricao={
                orders.length === 0
                  ? "Assim que um provedor comprar créditos — ou você gerar um pedido por aqui — ele aparece nesta lista."
                  : "Existem pedidos registrados, mas nenhum atende aos filtros escolhidos. Volte para “Todos” para ver a lista inteira."
              }
              cta={
                orders.length === 0 ? (
                  <button type="button" className={BOTAO_MARCA} onClick={() => setShowNewOrder(true)}>
                    <Plus className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
                    Novo pedido
                  </button>
                ) : (
                  <button
                    type="button"
                    className={BOTAO_SECUNDARIO}
                    onClick={() => { setFilterStatus("all"); setFilterType("all"); setFilterProvider("all"); }}
                  >
                    Limpar filtros
                  </button>
                )
              }
              testId="empty-pedidos-credito"
            />
          ) : (
            <TabelaPainel>
                <thead>
                  {/* Número do pedido e data são mono, mas se LEEM da esquerda
                      (um identificador que se dita, um dia que se compara), então
                      cabeça e célula apontam para o mesmo lado. Só o valor, que
                      se compara dígito a dígito, alinha à direita. */}
                  <tr>
                    <Th>Pedido</Th>
                    <Th>Provedor</Th>
                    <Th alinhamento="centro">Tipo</Th>
                    <Th alinhamento="centro">Créditos</Th>
                    <Th alinhamento="direita">Valor</Th>
                    <Th alinhamento="centro">Situação</Th>
                    <Th>Data</Th>
                    <Th alinhamento="centro">Ações</Th>
                  </tr>
                </thead>
                {/* A célula da primitiva já traz o hairline; a última linha o
                    devolve para não desenhar uma borda sobrando na base do card. */}
                <tbody className="[&>tr:last-child>td]:border-b-0">
                  {filteredOrders.map((order: any) => {
                    const st = SITUACAO_PEDIDO[order.status] ?? SITUACAO_DESCONHECIDA;
                    const ct = order.creditType || "mixed";
                    const tipo = TIPO_CREDITO[ct] ?? { rotulo: ct };
                    const isIsp = ct === "isp";
                    const isSpc = ct === "spc";
                    return (
                      <tr
                        key={order.id}
                        className="hover:bg-[var(--surface-2)] motion-safe:transition-colors"
                        data-testid={`order-row-${order.id}`}
                      >
                        <Td>
                          <span className={cn(TABELA_NUM, "text-[12px] font-medium text-[var(--text)]")}>{order.orderNumber}</span>
                          {order.notes && (
                            <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate max-w-[140px]">{order.notes}</p>
                          )}
                        </Td>
                        <Td className="font-medium text-[var(--text)]">{order.providerName}</Td>
                        <Td alinhamento="centro">
                          <Selo tom="neutro" Icone={tipo.Icone}>{tipo.rotulo}</Selo>
                        </Td>
                        <Td alinhamento="centro">
                          {/* Cada quantidade é mono tabular; a sigla continua
                              texto, senão a coluna vira um bloco de código. */}
                          {isIsp ? (
                            <><span className={TABELA_NUM}>{order.ispCredits}</span> ISP</>
                          ) : isSpc ? (
                            <><span className={TABELA_NUM}>{order.spcCredits}</span> SPC</>
                          ) : (
                            <>
                              <span className={TABELA_NUM}>{order.ispCredits}</span> ISP
                              {" + "}
                              <span className={TABELA_NUM}>{order.spcCredits}</span> SPC
                            </>
                          )}
                        </Td>
                        <Td num className="font-medium text-[var(--text)]">
                          <Dinheiro valor={order.amount} />
                        </Td>
                        <Td alinhamento="centro">
                          <div className="inline-flex items-center gap-1.5">
                            <Selo tom={st.tom} Icone={st.Icone}>{st.rotulo}</Selo>
                            {order.asaasChargeId && (
                              <span title="Cobrança emitida no Asaas" className="inline-flex text-[var(--text-faint)]">
                                <Wallet className="w-3 h-3" strokeWidth={2} aria-hidden />
                              </span>
                            )}
                          </div>
                        </Td>
                        <Td num alinhamento="esquerda" className="text-[var(--text-muted)] whitespace-nowrap">
                          {order.createdAt ? new Date(order.createdAt).toLocaleDateString("pt-BR") : "—"}
                        </Td>
                        <Td>
                          <div className="flex items-center justify-center gap-1">
                            {order.status === "pending" && (
                              <>
                                {/* Tinta semântica só no hover, espelhando a
                                    variante de risco da primitiva: um par
                                    verde/vermelho aceso em toda linha vira
                                    enfeite, e nenhum dos dois avisa nada. */}
                                <BotaoIcone
                                  Icone={CheckCircle}
                                  rotulo="Liberar créditos"
                                  className="hover:text-[var(--ok)] hover:bg-[var(--ok-bg)]"
                                  onClick={() => releaseMutation.mutate(order.id)}
                                  disabled={releaseMutation.isPending}
                                  testId={`button-release-${order.id}`}
                                />
                                <BotaoIcone
                                  Icone={XCircle}
                                  tom="risco"
                                  rotulo="Cancelar pedido"
                                  onClick={() => cancelMutation.mutate(order.id)}
                                  disabled={cancelMutation.isPending}
                                  testId={`button-cancel-${order.id}`}
                                />
                                {!order.asaasChargeId && (
                                  <BotaoIcone
                                    Icone={ArrowUpRight}
                                    rotulo="Cobrar via Asaas"
                                    onClick={() => setAsaasChargeModal({ orderId: order.id, orderNumber: order.orderNumber, amount: order.amount })}
                                    testId={`button-charge-${order.id}`}
                                  />
                                )}
                              </>
                            )}
                            {order.asaasChargeId && (
                              <>
                                <BotaoIcone
                                  Icone={RotateCcw}
                                  girando={syncMutation.isPending}
                                  rotulo="Sincronizar com o Asaas"
                                  onClick={() => syncMutation.mutate(order.id)}
                                  disabled={syncMutation.isPending}
                                  testId={`button-sync-${order.id}`}
                                />
                                <BotaoIcone
                                  Icone={QrCode}
                                  rotulo="QR Code PIX"
                                  onClick={() => pixMutation.mutate(order.id)}
                                  disabled={pixMutation.isPending}
                                  testId={`button-pix-${order.id}`}
                                />
                              </>
                            )}
                            {order.asaasInvoiceUrl && (
                              /* Âncora de verdade (abre outro site), então
                                 continua <a> e não vira `BotaoIcone`, que é um
                                 <button>. Veste a mesma constante da primitiva
                                 para ter alvo de toque, hover e anel de foco
                                 idênticos aos botões ao lado. */
                              <a
                                href={order.asaasInvoiceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={BOTAO_ICONE}
                                title="Abrir o link de pagamento"
                                aria-label="Abrir o link de pagamento"
                              >
                                <ExternalLink className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                              </a>
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
            </TabelaPainel>
          )}
        </Card>
      </section>
    </div>
  );
}
