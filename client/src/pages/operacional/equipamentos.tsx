import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Papa from "papaparse";
// Data civil (rescisão, prazo) sai em UTC: no fuso do navegador mostrava o dia anterior.
import { dataBr, deInputDataHora, paraInputDataHora } from "@/components/recuperacao/datas";
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileUp,
  History,
  Kanban,
  Package,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Truck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Equipamento = {
  id: number;
  customerId: number | null;
  assetTag: string | null;
  type: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  mac: string | null;
  status: string;
  inRecoveryProcess: boolean | null;
  value: string | null;
  source: string;
};

type Cliente = {
  id: number;
  name: string;
  cpfCnpj: string;
  phone: string | null;
  status: string;
};

type CasoRecuperacao = {
  id: number;
  equipmentId: number;
  customerId: number;
  status: string;
  priority: string;
  terminationDate: string;
  deadlineAt: string;
  scheduledAt: string | null;
  collectionMethod: string | null;
  proofReference: string | null;
  customerNotifiedAt: string | null;
  notificationProtocol: string | null;
  bureauStatus: string;
  disputeReason: string | null;
  closedAt: string | null;
  notes: string | null;
  customerName: string;
  customerCpfCnpj: string;
  customerPhone: string | null;
  equipmentType: string;
  equipmentBrand: string | null;
  equipmentModel: string | null;
  equipmentSerialNumber: string | null;
  equipmentAssetTag: string | null;
  equipmentValue: string | null;
};

type EventoRecuperacao = {
  id: number;
  type: string;
  channel: string | null;
  result: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  notes: string | null;
  occurredAt: string;
};

const STATUS_EQUIPAMENTO: Record<string, { label: string; cls: string }> = {
  em_comodato: { label: "Em comodato", cls: "bg-[var(--brand-bg)] text-[var(--brand-ink)]" },
  retirada_pendente: { label: "Retirada pendente", cls: "bg-[var(--gated-bg)] text-[var(--gated)]" },
  recuperado_triagem: { label: "Recuperado / triagem", cls: "bg-[var(--ok-bg)] text-[var(--ok)]" },
  disponivel_reuso: { label: "Disponível para reuso", cls: "bg-[var(--ok-bg)] text-[var(--ok)]" },
  avariado: { label: "Avariado", cls: "bg-[var(--past-bg)] text-[var(--past)]" },
  nao_localizado: { label: "Não localizado", cls: "bg-[var(--danger-bg)] text-[var(--danger)]" },
  furto_roubo_declarado: { label: "Furto/roubo declarado", cls: "bg-[var(--past-bg)] text-[var(--past)]" },
  baixado: { label: "Baixado", cls: "bg-[var(--surface-inset)] text-[var(--text-muted)]" },
  installed: { label: "Em comodato", cls: "bg-[var(--brand-bg)] text-[var(--brand-ink)]" },
  retido: { label: "Retirada pendente", cls: "bg-[var(--gated-bg)] text-[var(--gated)]" },
  em_cobranca: { label: "Retirada pendente", cls: "bg-[var(--gated-bg)] text-[var(--gated)]" },
  not_returned: { label: "Retirada pendente", cls: "bg-[var(--gated-bg)] text-[var(--gated)]" },
  devolvido: { label: "Recuperado", cls: "bg-[var(--ok-bg)] text-[var(--ok)]" },
  returned: { label: "Recuperado", cls: "bg-[var(--ok-bg)] text-[var(--ok)]" },
};

const STATUS_CASO: Record<string, string> = {
  pre_recuperacao: "Pré-recuperação",
  aguardando_agendamento: "Aguardando agendamento",
  agendado: "Agendado",
  nova_tentativa: "Nova tentativa",
  devolucao_em_loja: "Devolução em loja",
  notificacao_formal: "Notificação formal",
  contestado: "Contestado",
  concluido: "Concluído",
  baixado_economico: "Baixado economicamente",
  prazo_expirado: "Prazo expirado",
};

const PRIORIDADE: Record<string, { label: string; cls: string }> = {
  critica: { label: "Crítica", cls: "bg-[var(--danger-bg)] text-[var(--danger)]" },
  alta: { label: "Alta", cls: "bg-[var(--past-bg)] text-[var(--past)]" },
  normal: { label: "Normal", cls: "bg-[var(--surface-inset)] text-[var(--text-2)]" },
  baixa: { label: "Baixa", cls: "bg-[var(--surface-inset)] text-[var(--text-muted)]" },
};

const RESULTADO_TENTATIVA: Record<string, string> = {
  contato_confirmado: "Contato confirmado",
  sem_resposta: "Sem resposta",
  numero_invalido: "Número inválido",
  reagendado: "Reagendado",
  ausente_horario_confirmado: "Ausente no horário confirmado",
  acesso_impedido: "Acesso impedido",
  endereco_incorreto: "Endereço incorreto",
  recusa_expressa: "Recusa expressa",
  provedor_nao_compareceu: "Provedor não compareceu",
};

const CANAL: Record<string, string> = {
  whatsapp: "WhatsApp",
  telefone: "Telefone",
  email: "E-mail",
  visita: "Visita técnica",
  loja: "Loja",
  logistica_reversa: "Logística reversa",
};

const FINAL_CASE_STATUSES = new Set(["concluido", "baixado_economico", "prazo_expirado"]);
const PENDING_EQUIPMENT_STATUSES = new Set(["retirada_pendente", "nao_localizado", "retido", "em_cobranca", "not_returned"]);

// Vocabulario aceito pela API — as demais chaves de STATUS_EQUIPAMENTO sao so exibicao de legado.
const EQUIPMENT_FORM_STATUSES = [
  "em_comodato", "retirada_pendente", "recuperado_triagem", "disponivel_reuso",
  "avariado", "nao_localizado", "furto_roubo_declarado", "baixado",
];

// Registros anteriores a migracao guardam o vocabulario antigo; a API so aceita o novo.
const STATUS_LEGADO_PARA_NOVO: Record<string, string> = {
  installed: "em_comodato",
  retido: "retirada_pendente",
  em_cobranca: "retirada_pendente",
  not_returned: "retirada_pendente",
  devolvido: "recuperado_triagem",
  returned: "recuperado_triagem",
};

const normalizarStatus = (status: string) => STATUS_LEGADO_PARA_NOVO[status] ?? status;

const equipamentoVazio = {
  customerId: "",
  assetTag: "",
  type: "ONU/ONT",
  brand: "",
  model: "",
  serialNumber: "",
  mac: "",
  value: "",
  status: "em_comodato",
};

const hojeInput = () => new Date().toISOString().slice(0, 10);

function brl(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarDocumento(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return value;
}

function diasAte(value: string) {
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function StatusBadge({ status }: { status: string }) {
  const item = STATUS_EQUIPAMENTO[status] ?? { label: status, cls: "bg-[var(--surface-inset)] text-[var(--text-muted)]" };
  return <span className={`inline-flex rounded px-2 py-1 font-mono text-[10px] font-medium tracking-[0.04em] ${item.cls}`}>{item.label}</span>;
}

function Kpi({ label, value, detail, alert }: { label: string; value: string; detail: string; alert?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-[14px] py-3">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1.5 font-mono text-[21px] font-medium tracking-[-0.02em] tabular-nums ${alert ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{value}</p>
      <p className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">{detail}</p>
    </div>
  );
}

function downloadTemplate() {
  const content = [
    "cpf_cnpj,nome_cliente,tipo,marca,modelo,numero_serie,mac,status,valor",
    "12345678901,Cliente Exemplo,ONU/ONT,Intelbras,ONU 110,SN123456,AA:BB:CC:DD:EE:FF,em_comodato,290.00",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "modelo-equipamentos.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export default function EquipamentosPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [aba, setAba] = useState<"patrimonio" | "recuperacao">("patrimonio");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [equipamentoDialog, setEquipamentoDialog] = useState(false);
  const [editando, setEditando] = useState<Equipamento | null>(null);
  const [formEquipamento, setFormEquipamento] = useState({ ...equipamentoVazio });
  const [casoDialog, setCasoDialog] = useState(false);
  const [equipamentoParaCaso, setEquipamentoParaCaso] = useState<Equipamento | null>(null);
  const [formCaso, setFormCaso] = useState({ terminationDate: hojeInput(), priority: "normal", proofReference: "", customerNotifiedAt: "", notificationProtocol: "", notes: "" });
  const [casoSelecionado, setCasoSelecionado] = useState<CasoRecuperacao | null>(null);
  const [detalheDialog, setDetalheDialog] = useState(false);
  const [statusCaso, setStatusCaso] = useState("aguardando_agendamento");
  const [statusNotes, setStatusNotes] = useState("");
  const [agenda, setAgenda] = useState({ scheduledAt: "", collectionMethod: "retirada" });
  const [tentativa, setTentativa] = useState({ channel: "whatsapp", result: "sem_resposta", occurredAt: hojeInput(), notes: "" });
  const [validacao, setValidacao] = useState({ proofReference: "", customerNotifiedAt: "", notificationProtocol: "" });
  const [importDialog, setImportDialog] = useState(() => new URLSearchParams(window.location.search).get("importar") === "1");
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: equipamentos = [], isLoading: loadingEquipment } = useQuery<Equipamento[]>({ queryKey: ["/api/equipment"] });
  const { data: clientes = [], isLoading: loadingCustomers } = useQuery<Cliente[]>({ queryKey: ["/api/customers"] });
  const { data: casos = [], isLoading: loadingCases } = useQuery<CasoRecuperacao[]>({ queryKey: ["/api/equipment/recovery-cases"] });
  const { data: eventos = [], isLoading: loadingEvents } = useQuery<EventoRecuperacao[]>({
    queryKey: [`/api/equipment/recovery-cases/${casoSelecionado?.id}/events`],
    enabled: !!casoSelecionado,
  });

  const clientePorId = useMemo(() => new Map(clientes.map(cliente => [cliente.id, cliente])), [clientes]);
  const casoAbertoPorEquipamento = useMemo(() => new Map(
    casos.filter(item => !item.closedAt).map(item => [item.equipmentId, item]),
  ), [casos]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
    queryClient.invalidateQueries({ queryKey: ["/api/equipment/recovery-cases"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inadimplentes"] });
  };

  const salvarEquipamento = useMutation({
    mutationFn: async () => {
      const payload = {
        ...formEquipamento,
        customerId: Number(formEquipamento.customerId),
        value: formEquipamento.value.replace(",", ".") || undefined,
      };
      const response = await apiRequest(editando ? "PATCH" : "POST", editando ? `/api/equipment/${editando.id}` : "/api/equipment", payload);
      return response.json();
    },
    onSuccess: () => {
      invalidateAll();
      setEquipamentoDialog(false);
      setEditando(null);
      setFormEquipamento({ ...equipamentoVazio });
      toast({ title: editando ? "Equipamento atualizado" : "Equipamento cadastrado" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" }),
  });

  const criarCaso = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/equipment/recovery-cases", {
        equipmentId: equipamentoParaCaso?.id,
        ...formCaso,
        customerNotifiedAt: formCaso.customerNotifiedAt || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      invalidateAll();
      setCasoDialog(false);
      setAba("recuperacao");
      setFormCaso({ terminationDate: hojeInput(), priority: "normal", proofReference: "", customerNotifiedAt: "", notificationProtocol: "", notes: "" });
      toast({ title: "Caso de recuperação aberto" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível abrir o caso", description: error.message, variant: "destructive" }),
  });

  const atualizarCaso = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const response = await apiRequest("PATCH", `/api/equipment/recovery-cases/${casoSelecionado?.id}`, payload);
      return response.json();
    },
    onSuccess: (updated: CasoRecuperacao) => {
      invalidateAll();
      setCasoSelecionado(current => current ? { ...current, ...updated } : current);
      toast({ title: "Caso atualizado" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" }),
  });

  const registrarTentativa = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/equipment/recovery-cases/${casoSelecionado?.id}/attempts`, tentativa);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/equipment/recovery-cases/${casoSelecionado?.id}/events`] });
      setTentativa({ channel: "whatsapp", result: "sem_resposta", occurredAt: hojeInput(), notes: "" });
      toast({ title: "Tentativa registrada" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível registrar", description: error.message, variant: "destructive" }),
  });

  const validarSinal = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/equipment/recovery-cases/${casoSelecionado?.id}/validate-signal`, validacao);
      return response.json();
    },
    onSuccess: (updated: CasoRecuperacao) => {
      invalidateAll();
      setCasoSelecionado(current => current ? { ...current, ...updated } : current);
      toast({ title: "Ocorrência validada", description: "O sinal mínimo já pode aparecer na Consulta ISP." });
    },
    onError: (error: Error) => toast({ title: "Sinal ainda não pode ser publicado", description: error.message, variant: "destructive" }),
  });

  const importar = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/import/equipment", { rows: importRows });
      return response.json();
    },
    onSuccess: (result: { imported: number }) => {
      invalidateAll();
      setImportDialog(false);
      setImportRows([]);
      setImportError("");
      toast({ title: `${result.imported} equipamento(s) importado(s)` });
    },
    onError: (error: Error) => toast({ title: "Importação não concluída", description: error.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!casoSelecionado) return;
    setStatusCaso(casoSelecionado.status);
    setStatusNotes(casoSelecionado.disputeReason || casoSelecionado.notes || "");
    setAgenda({
      scheduledAt: paraInputDataHora(casoSelecionado.scheduledAt),
      collectionMethod: casoSelecionado.collectionMethod || "retirada",
    });
    setValidacao({
      proofReference: casoSelecionado.proofReference || "",
      customerNotifiedAt: casoSelecionado.customerNotifiedAt?.slice(0, 10) || "",
      notificationProtocol: casoSelecionado.notificationProtocol || "",
    });
  }, [casoSelecionado?.id]);

  const equipamentosFiltrados = useMemo(() => {
    const term = busca.trim().toLowerCase();
    return equipamentos.filter(item => {
      const cliente = item.customerId ? clientePorId.get(item.customerId) : undefined;
      const matchStatus = filtroStatus === "todos" || normalizarStatus(item.status) === filtroStatus;
      const matchTerm = !term || [item.type, item.brand, item.model, item.serialNumber, item.mac, item.assetTag, cliente?.name, cliente?.cpfCnpj]
        .some(value => value?.toLowerCase().includes(term));
      return matchStatus && matchTerm;
    });
  }, [busca, clientePorId, equipamentos, filtroStatus]);

  const casosAbertos = casos.filter(item => !item.closedAt);
  const pendentes = equipamentos.filter(item => PENDING_EQUIPMENT_STATUSES.has(item.status));
  const exposicao = pendentes.reduce((total, item) => total + Number(item.value || 0), 0);
  const criticos = casosAbertos.filter(item => diasAte(item.deadlineAt) <= 10).length;
  const sinaisValidados = casosAbertos.filter(item => item.bureauStatus === "ativo_validado").length;
  const loading = loadingEquipment || loadingCustomers || loadingCases;

  const abrirCadastro = (item?: Equipamento) => {
    setEditando(item || null);
    setFormEquipamento(item ? {
      customerId: item.customerId ? String(item.customerId) : "",
      assetTag: item.assetTag || "",
      type: item.type,
      brand: item.brand || "",
      model: item.model || "",
      serialNumber: item.serialNumber || "",
      mac: item.mac || "",
      value: item.value || "",
      status: EQUIPMENT_FORM_STATUSES.includes(normalizarStatus(item.status)) ? normalizarStatus(item.status) : "em_comodato",
    } : { ...equipamentoVazio });
    setEquipamentoDialog(true);
  };

  const abrirCaso = (item: Equipamento) => {
    setEquipamentoParaCaso(item);
    setCasoDialog(true);
  };

  const abrirDetalhes = (item: CasoRecuperacao) => {
    setCasoSelecionado(item);
    setDetalheDialog(true);
  };

  const parseCsv = (file?: File) => {
    if (!file) return;
    setImportError("");
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: result => {
        if (result.errors.length) {
          setImportError(`O arquivo contém erro na linha ${result.errors[0].row ? result.errors[0].row + 1 : 1}.`);
          setImportRows([]);
          return;
        }
        setImportRows(result.data);
      },
      error: () => setImportError("Não foi possível ler o arquivo CSV."),
    });
  };

  return (
    <div className="space-y-4 p-4 lg:p-6" data-testid="equipamentos-page">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-medium leading-tight tracking-[-0.02em] text-[var(--text)]">Equipamentos</h1>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">Patrimônio em comodato, recuperação após rescisão e ocorrência validada na Consulta ISP.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11" onClick={() => setImportDialog(true)}>
            <FileUp className="mr-1.5 h-4 w-4" /> Importar planilha
          </Button>
          <Button className="min-h-11" onClick={() => abrirCadastro()} data-testid="botao-cadastrar-equipamento">
            <Plus className="mr-1.5 h-4 w-4" /> Cadastrar equipamento
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
        <Kpi label="Patrimônio" value={String(equipamentos.length)} detail="itens cadastrados" />
        <Kpi label="Retirada pendente" value={String(pendentes.length)} detail="não inclui comodato ativo" />
        <Kpi label="Exposição" value={brl(exposicao)} detail="valor recuperável" />
        <Kpi label="Prazo crítico" value={String(criticos)} detail="10 dias ou menos" alert={criticos > 0} />
        <Kpi label="Sinais validados" value={String(sinaisValidados)} detail="visíveis no bureau" />
      </section>

      <section className="flex items-start gap-3 rounded-lg border border-[var(--gated-border)] bg-[var(--gated-bg)] px-4 py-3">
        <CalendarClock className="mt-0.5 h-4 w-4 flex-none text-[var(--gated)]" />
        <div className="text-[12px] leading-5 text-[var(--text-2)]">
          <strong className="font-medium text-[var(--gated)]">Janela de retirada: 60 dias após a rescisão.</strong>{" "}
          A retirada é gratuita e o cancelamento não pode depender dela. Ao final do prazo, o sinal é retirado automaticamente da Consulta ISP.
        </div>
      </section>

      <div className="flex gap-1 border-b border-[var(--border)]" role="tablist" aria-label="Áreas do módulo">
        {([
          ["patrimonio", "Patrimônio", Package],
          ["recuperacao", `Recuperação (${casosAbertos.length})`, Truck],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={aba === key}
            onClick={() => setAba(key)}
            className={`flex min-h-11 items-center gap-2 border-b-2 px-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${aba === key ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2"><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /></div>
      ) : aba === "patrimonio" ? (
        <section className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input value={busca} onChange={event => setBusca(event.target.value)} placeholder="Buscar cliente, CPF/CNPJ, série, MAC ou patrimônio" className="min-h-11 pl-9" />
            </div>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="min-h-11 sm:w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {EQUIPMENT_FORM_STATUSES.map(value => <SelectItem key={value} value={value}>{STATUS_EQUIPAMENTO[value].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {equipamentosFiltrados.length === 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
              <Package className="mx-auto h-8 w-8 text-[var(--text-faint)]" />
              <h2 className="mt-4 text-[15px] font-medium text-[var(--text)]">Nenhum equipamento encontrado</h2>
              <p className="mx-auto mt-2 max-w-[48ch] text-[13px] text-[var(--text-muted)]">Cadastre o patrimônio individualmente ou importe uma planilha com o CPF/CNPJ do responsável.</p>
              <Button className="mt-5 min-h-11" onClick={() => abrirCadastro()}><Plus className="mr-1.5 h-4 w-4" /> Cadastrar equipamento</Button>
            </div>
          ) : (
            <>
              <div className="space-y-2 md:hidden">
                {equipamentosFiltrados.map(item => {
                  const cliente = item.customerId ? clientePorId.get(item.customerId) : undefined;
                  const openCase = casoAbertoPorEquipamento.get(item.id);
                  return (
                    <article key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div><h3 className="text-[14px] font-medium text-[var(--text)]">{item.type} {[item.brand, item.model].filter(Boolean).join(" ")}</h3><p className="mt-1 text-[12px] text-[var(--text-muted)]">{cliente?.name || "Cliente não vinculado"}</p></div>
                        <StatusBadge status={item.status} />
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border-faint)] pt-3 text-[11px]">
                        <div><dt className="text-[var(--text-muted)]">Série</dt><dd className="mt-0.5 font-mono tabular-nums text-[var(--text-2)]">{item.serialNumber || "—"}</dd></div>
                        <div><dt className="text-[var(--text-muted)]">Valor</dt><dd className="mt-0.5 font-mono tabular-nums text-[var(--text)]">{item.value ? brl(Number(item.value)) : "—"}</dd></div>
                      </dl>
                      <div className="mt-3 flex gap-2">
                        <Button variant="outline" className="min-h-11 flex-1" onClick={() => abrirCadastro(item)}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar</Button>
                        {openCase ? <Button className="min-h-11 flex-1" onClick={() => abrirDetalhes(openCase)}>Abrir caso <ChevronRight className="ml-1 h-4 w-4" /></Button> : <Button className="min-h-11 flex-1" onClick={() => abrirCaso(item)} disabled={!item.customerId || item.status === "baixado"}>Recuperar</Button>}
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="hidden overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] md:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-[13px]">
                    <thead className="bg-[var(--surface-2)]">
                      <tr>{["Equipamento", "Cliente", "Série / patrimônio", "Valor", "Status", "Ação"].map(label => <th key={label} className="border-b border-[var(--border)] px-[14px] py-2.5 text-left font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {equipamentosFiltrados.map(item => {
                        const cliente = item.customerId ? clientePorId.get(item.customerId) : undefined;
                        const openCase = casoAbertoPorEquipamento.get(item.id);
                        return (
                          <tr key={item.id} className="border-b border-[var(--border-faint)] last:border-0" data-testid={`equipamento-${item.id}`}>
                            <td className="px-[14px] py-3"><p className="font-medium text-[var(--text)]">{item.type}</p><p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{[item.brand, item.model].filter(Boolean).join(" ") || "Sem marca/modelo"}</p></td>
                            <td className="px-[14px] py-3"><p className="text-[var(--text-2)]">{cliente?.name || "Não vinculado"}</p><p className="mt-0.5 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{cliente ? formatarDocumento(cliente.cpfCnpj) : "—"}</p></td>
                            <td className="px-[14px] py-3 font-mono text-[11px] tabular-nums text-[var(--text-2)]"><p>{item.serialNumber || "—"}</p><p className="mt-0.5 text-[var(--text-muted)]">{item.assetTag || item.mac || "—"}</p></td>
                            <td className="px-[14px] py-3 font-mono tabular-nums text-[var(--text)]">{item.value ? brl(Number(item.value)) : "—"}</td>
                            <td className="px-[14px] py-3"><StatusBadge status={item.status} /></td>
                            <td className="px-[14px] py-3"><div className="flex items-center gap-1"><Button variant="ghost" size="sm" className="min-h-9" onClick={() => abrirCadastro(item)}><Pencil className="mr-1 h-3.5 w-3.5" /> Editar</Button>{openCase ? <Button variant="ghost" size="sm" className="min-h-9 text-[var(--brand)]" onClick={() => abrirDetalhes(openCase)}>Abrir caso</Button> : <Button variant="ghost" size="sm" className="min-h-9 text-[var(--brand)]" onClick={() => abrirCaso(item)} disabled={!item.customerId || item.status === "baixado"}>Iniciar recuperação</Button>}</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="space-y-3">
          {/* O kanban em /recuperacao e a mesma fila por idade da rescisao; a lista aqui continua para quem prefere ler linha a linha. */}
          <div className="flex justify-end">
            <Button variant="outline" className="min-h-11" onClick={() => navigate("/recuperacao")} data-testid="botao-ver-kanban">
              <Kanban className="mr-1.5 h-4 w-4" /> Ver kanban
            </Button>
          </div>
          {casos.length === 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
              <Truck className="mx-auto h-8 w-8 text-[var(--text-faint)]" />
              <h2 className="mt-4 text-[15px] font-medium text-[var(--text)]">Nenhum caso de recuperação</h2>
              <p className="mx-auto mt-2 max-w-[48ch] text-[13px] text-[var(--text-muted)]">Abra o caso a partir do patrimônio somente após a rescisão do contrato.</p>
              <Button variant="outline" className="mt-5 min-h-11" onClick={() => setAba("patrimonio")}>Ver patrimônio</Button>
            </div>
          ) : (
            <div className="grid gap-2.5 lg:grid-cols-2">
              {casos.map(item => {
                const remaining = diasAte(item.deadlineAt);
                const priority = PRIORIDADE[item.priority] ?? PRIORIDADE.normal;
                return (
                  <button key={item.id} type="button" onClick={() => abrirDetalhes(item)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition-colors hover:border-[var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><div className="flex items-center gap-2"><span className={`rounded px-2 py-1 font-mono text-[10px] font-medium ${priority.cls}`}>{priority.label}</span>{item.bureauStatus === "ativo_validado" && <span className="inline-flex items-center gap-1 rounded bg-[var(--ok-bg)] px-2 py-1 font-mono text-[10px] text-[var(--ok)]"><ShieldCheck className="h-3 w-3" /> Sinal validado</span>}</div><h3 className="mt-2 truncate text-[14px] font-medium text-[var(--text)]">{item.customerName}</h3><p className="mt-0.5 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{formatarDocumento(item.customerCpfCnpj)}</p></div>
                      <div className="text-right"><p className={`font-mono text-[18px] font-medium tabular-nums ${remaining <= 10 && !item.closedAt ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{item.closedAt ? "—" : Math.max(0, remaining)}</p><p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">dias restantes</p></div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border-faint)] pt-3 text-[11px]">
                      <div><p className="text-[var(--text-muted)]">Equipamento</p><p className="mt-0.5 truncate text-[var(--text-2)]">{item.equipmentType} {[item.equipmentBrand, item.equipmentModel].filter(Boolean).join(" ")}</p></div>
                      <div><p className="text-[var(--text-muted)]">Etapa</p><p className="mt-0.5 text-[var(--text-2)]">{STATUS_CASO[item.status] || item.status}</p></div>
                      <div><p className="text-[var(--text-muted)]">Prazo final</p><p className="mt-0.5 font-mono tabular-nums text-[var(--text-2)]">{dataBr(item.deadlineAt)}</p></div>
                      <div><p className="text-[var(--text-muted)]">Agenda</p><p className="mt-0.5 font-mono tabular-nums text-[var(--text-2)]">{dataBr(item.scheduledAt)}</p></div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      <Dialog open={equipamentoDialog} onOpenChange={setEquipamentoDialog}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[620px]">
          <DialogHeader><DialogTitle>{editando ? "Editar equipamento" : "Cadastrar equipamento"}</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={event => { event.preventDefault(); salvarEquipamento.mutate(); }}>
            <div><Label>Cliente responsável</Label><Select value={formEquipamento.customerId} onValueChange={value => setFormEquipamento(current => ({ ...current, customerId: value }))}><SelectTrigger className="mt-1 min-h-11"><SelectValue placeholder="Selecione o cliente" /></SelectTrigger><SelectContent>{clientes.slice().sort((a, b) => a.name.localeCompare(b.name)).map(cliente => <SelectItem key={cliente.id} value={String(cliente.id)}>{cliente.name} · {formatarDocumento(cliente.cpfCnpj)}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-[11px] text-[var(--text-muted)]">O vínculo é obrigatório para localizar a ocorrência em uma futura Consulta ISP.</p></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="tipo">Tipo</Label><Input id="tipo" className="mt-1 min-h-11" required value={formEquipamento.type} onChange={event => setFormEquipamento(current => ({ ...current, type: event.target.value }))} /></div><div><Label htmlFor="patrimonio">Etiqueta patrimonial</Label><Input id="patrimonio" className="mt-1 min-h-11 font-mono" value={formEquipamento.assetTag} onChange={event => setFormEquipamento(current => ({ ...current, assetTag: event.target.value }))} /></div></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="marca">Marca</Label><Input id="marca" className="mt-1 min-h-11" value={formEquipamento.brand} onChange={event => setFormEquipamento(current => ({ ...current, brand: event.target.value }))} /></div><div><Label htmlFor="modelo">Modelo</Label><Input id="modelo" className="mt-1 min-h-11" value={formEquipamento.model} onChange={event => setFormEquipamento(current => ({ ...current, model: event.target.value }))} /></div></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="serie">Número de série</Label><Input id="serie" className="mt-1 min-h-11 font-mono tabular-nums" value={formEquipamento.serialNumber} onChange={event => setFormEquipamento(current => ({ ...current, serialNumber: event.target.value }))} /></div><div><Label htmlFor="mac">MAC</Label><Input id="mac" className="mt-1 min-h-11 font-mono tabular-nums" value={formEquipamento.mac} onChange={event => setFormEquipamento(current => ({ ...current, mac: event.target.value }))} /></div></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="valor">Valor recuperável (R$)</Label><Input id="valor" inputMode="decimal" className="mt-1 min-h-11 font-mono tabular-nums" value={formEquipamento.value} onChange={event => setFormEquipamento(current => ({ ...current, value: event.target.value }))} /></div><div><Label>Situação física</Label><Select value={formEquipamento.status} onValueChange={value => setFormEquipamento(current => ({ ...current, status: value }))}><SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger><SelectContent>{EQUIPMENT_FORM_STATUSES.map(value => <SelectItem key={value} value={value}>{STATUS_EQUIPAMENTO[value].label}</SelectItem>)}</SelectContent></Select></div></div>
            <DialogFooter><Button type="button" variant="ghost" className="min-h-11" onClick={() => setEquipamentoDialog(false)}>Cancelar</Button><Button type="submit" className="min-h-11" disabled={salvarEquipamento.isPending || !formEquipamento.customerId}>{salvarEquipamento.isPending ? "Salvando..." : "Salvar equipamento"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={casoDialog} onOpenChange={setCasoDialog}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader><DialogTitle>Iniciar recuperação</DialogTitle></DialogHeader>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"><p className="text-[13px] font-medium text-[var(--text)]">{equipamentoParaCaso?.type} {[equipamentoParaCaso?.brand, equipamentoParaCaso?.model].filter(Boolean).join(" ")}</p><p className="mt-1 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{equipamentoParaCaso?.serialNumber || equipamentoParaCaso?.assetTag || "Sem identificação individual"}</p></div>
          <form className="space-y-4" onSubmit={event => { event.preventDefault(); criarCaso.mutate(); }}>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="rescisao">Data da rescisão</Label><Input id="rescisao" type="date" className="mt-1 min-h-11 font-mono tabular-nums" max={hojeInput()} required value={formCaso.terminationDate} onChange={event => setFormCaso(current => ({ ...current, terminationDate: event.target.value }))} /></div><div><Label>Prioridade</Label><Select value={formCaso.priority} onValueChange={value => setFormCaso(current => ({ ...current, priority: value }))}><SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PRIORIDADE).map(([value, item]) => <SelectItem key={value} value={value}>{item.label}</SelectItem>)}</SelectContent></Select></div></div>
            <div><Label htmlFor="prova">Referência do termo ou OS</Label><Input id="prova" className="mt-1 min-h-11" placeholder="Ex.: OS-4821 ou termo assinado em 10/01/2026" value={formCaso.proofReference} onChange={event => setFormCaso(current => ({ ...current, proofReference: event.target.value }))} /></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="notificado">Titular notificado em</Label><Input id="notificado" type="date" className="mt-1 min-h-11 font-mono tabular-nums" max={hojeInput()} value={formCaso.customerNotifiedAt} onChange={event => setFormCaso(current => ({ ...current, customerNotifiedAt: event.target.value }))} /></div><div><Label htmlFor="protocolo">Protocolo</Label><Input id="protocolo" className="mt-1 min-h-11 font-mono" value={formCaso.notificationProtocol} onChange={event => setFormCaso(current => ({ ...current, notificationProtocol: event.target.value }))} /></div></div>
            <div><Label htmlFor="observacao-caso">Observação interna</Label><Textarea id="observacao-caso" className="mt-1" value={formCaso.notes} onChange={event => setFormCaso(current => ({ ...current, notes: event.target.value }))} /></div>
            <DialogFooter><Button type="button" variant="ghost" className="min-h-11" onClick={() => setCasoDialog(false)}>Cancelar</Button><Button type="submit" className="min-h-11" disabled={criarCaso.isPending}>{criarCaso.isPending ? "Abrindo..." : "Abrir caso"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={detalheDialog} onOpenChange={setDetalheDialog}>
        <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-[820px]">
          <DialogHeader><DialogTitle>Recuperação #{casoSelecionado?.id}</DialogTitle></DialogHeader>
          {casoSelecionado && (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4 sm:grid-cols-[1fr_auto]">
                <div><div className="flex flex-wrap items-center gap-2"><span className={`rounded px-2 py-1 font-mono text-[10px] ${PRIORIDADE[casoSelecionado.priority]?.cls || PRIORIDADE.normal.cls}`}>{PRIORIDADE[casoSelecionado.priority]?.label || "Normal"}</span>{casoSelecionado.bureauStatus === "ativo_validado" && <span className="inline-flex items-center gap-1 rounded bg-[var(--ok-bg)] px-2 py-1 font-mono text-[10px] text-[var(--ok)]"><ShieldCheck className="h-3 w-3" /> Ocorrência validada</span>}{casoSelecionado.bureauStatus === "contestado_bloqueado" && <span className="rounded bg-[var(--danger-bg)] px-2 py-1 font-mono text-[10px] text-[var(--danger)]">Sinal bloqueado</span>}</div><h3 className="mt-2 text-[16px] font-medium text-[var(--text)]">{casoSelecionado.customerName}</h3><p className="mt-1 font-mono text-[11px] tabular-nums text-[var(--text-muted)]">{formatarDocumento(casoSelecionado.customerCpfCnpj)} · {casoSelecionado.customerPhone || "sem telefone"}</p><p className="mt-2 text-[12px] text-[var(--text-2)]">{casoSelecionado.equipmentType} {[casoSelecionado.equipmentBrand, casoSelecionado.equipmentModel].filter(Boolean).join(" ")} · <span className="font-mono tabular-nums">{casoSelecionado.equipmentSerialNumber || casoSelecionado.equipmentAssetTag || "sem identificação"}</span></p></div>
                <div className="sm:text-right"><p className={`font-mono text-[24px] font-medium tabular-nums ${diasAte(casoSelecionado.deadlineAt) <= 10 && !casoSelecionado.closedAt ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{casoSelecionado.closedAt ? "Encerrado" : `${Math.max(0, diasAte(casoSelecionado.deadlineAt))} dias`}</p><p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">prazo até {dataBr(casoSelecionado.deadlineAt)}</p></div>
              </div>

              {!casoSelecionado.closedAt && <div className="grid gap-3 lg:grid-cols-2">
                <section className="rounded-lg border border-[var(--border)] p-4"><h4 className="flex items-center gap-2 text-[13px] font-medium text-[var(--text)]"><ClipboardCheck className="h-4 w-4 text-[var(--brand)]" /> Etapa e desfecho</h4><div className="mt-3 space-y-3"><Select value={statusCaso} onValueChange={setStatusCaso}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUS_CASO).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Textarea value={statusNotes} onChange={event => setStatusNotes(event.target.value)} placeholder={statusCaso === "contestado" ? "Motivo da contestação (obrigatório)" : "Observação da mudança"} /><Button className="min-h-11 w-full" variant="outline" disabled={atualizarCaso.isPending || (statusCaso === "contestado" && !statusNotes.trim())} onClick={() => atualizarCaso.mutate({ status: statusCaso, notes: statusNotes, disputeReason: statusCaso === "contestado" ? statusNotes : undefined })}>Atualizar etapa</Button></div></section>
                <section className="rounded-lg border border-[var(--border)] p-4"><h4 className="flex items-center gap-2 text-[13px] font-medium text-[var(--text)]"><CalendarClock className="h-4 w-4 text-[var(--brand)]" /> Agendamento</h4><div className="mt-3 space-y-3"><Input type="datetime-local" className="min-h-11 font-mono tabular-nums" value={agenda.scheduledAt} onChange={event => setAgenda(current => ({ ...current, scheduledAt: event.target.value }))} /><Select value={agenda.collectionMethod} onValueChange={value => setAgenda(current => ({ ...current, collectionMethod: value }))}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="retirada">Retirada gratuita</SelectItem><SelectItem value="entrega_loja">Entrega em loja</SelectItem><SelectItem value="logistica_reversa">Logística reversa</SelectItem></SelectContent></Select><Button className="min-h-11 w-full" variant="outline" disabled={!agenda.scheduledAt || atualizarCaso.isPending} onClick={() => atualizarCaso.mutate({ ...agenda, scheduledAt: deInputDataHora(agenda.scheduledAt) })}>Salvar agendamento</Button></div></section>
                <section className="rounded-lg border border-[var(--border)] p-4"><h4 className="flex items-center gap-2 text-[13px] font-medium text-[var(--text)]"><History className="h-4 w-4 text-[var(--brand)]" /> Registrar tentativa</h4><div className="mt-3 space-y-3"><div className="grid grid-cols-2 gap-2"><Select value={tentativa.channel} onValueChange={value => setTentativa(current => ({ ...current, channel: value }))}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CANAL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Input type="date" max={hojeInput()} className="min-h-11 font-mono tabular-nums" value={tentativa.occurredAt} onChange={event => setTentativa(current => ({ ...current, occurredAt: event.target.value }))} /></div><Select value={tentativa.result} onValueChange={value => setTentativa(current => ({ ...current, result: value }))}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(RESULTADO_TENTATIVA).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Textarea value={tentativa.notes} onChange={event => setTentativa(current => ({ ...current, notes: event.target.value }))} placeholder="Contexto objetivo da tentativa" /><Button className="min-h-11 w-full" variant="outline" disabled={registrarTentativa.isPending} onClick={() => registrarTentativa.mutate()}>Registrar tentativa</Button></div></section>
                <section className="rounded-lg border border-[var(--border)] p-4"><h4 className="flex items-center gap-2 text-[13px] font-medium text-[var(--text)]"><ShieldCheck className="h-4 w-4 text-[var(--brand)]" /> Publicação no bureau</h4><p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">Exige prova, notificação e recusa expressa ou duas ausências confirmadas. Apenas administradores podem validar.</p><div className="mt-3 space-y-3"><Input value={validacao.proofReference} onChange={event => setValidacao(current => ({ ...current, proofReference: event.target.value }))} placeholder="Referência do termo ou OS" /><div className="grid grid-cols-2 gap-2"><Input type="date" max={hojeInput()} className="font-mono tabular-nums" value={validacao.customerNotifiedAt} onChange={event => setValidacao(current => ({ ...current, customerNotifiedAt: event.target.value }))} /><Input className="font-mono" value={validacao.notificationProtocol} onChange={event => setValidacao(current => ({ ...current, notificationProtocol: event.target.value }))} placeholder="Protocolo" /></div><Button className="min-h-11 w-full" disabled={validarSinal.isPending || !validacao.proofReference || !validacao.customerNotifiedAt || user?.role !== "admin"} onClick={() => validarSinal.mutate()}>{casoSelecionado.bureauStatus === "ativo_validado" ? "Revalidar ocorrência" : "Validar ocorrência"}</Button>{user?.role !== "admin" && <p className="text-[11px] text-[var(--gated)]">Solicite a validação ao administrador do provedor.</p>}</div></section>
              </div>}

              <section className="rounded-lg border border-[var(--border)]"><div className="border-b border-[var(--border)] px-4 py-3"><h4 className="text-[13px] font-medium text-[var(--text)]">Linha do tempo</h4></div><div className="divide-y divide-[var(--border-faint)]">{loadingEvents ? <Skeleton className="m-4 h-16" /> : eventos.length === 0 ? <p className="px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">Nenhum evento registrado.</p> : eventos.map(evento => <div key={evento.id} className="flex gap-3 px-4 py-3"><span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-[var(--brand)]" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[12px] font-medium text-[var(--text)]">{evento.type === "tentativa" ? `${CANAL[evento.channel || ""] || evento.channel}: ${RESULTADO_TENTATIVA[evento.result || ""] || evento.result}` : evento.type === "status_alterado" ? `${STATUS_CASO[evento.fromStatus || ""] || evento.fromStatus} → ${STATUS_CASO[evento.toStatus || ""] || evento.toStatus}` : evento.type.replaceAll("_", " ")}</p><time className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{new Date(evento.occurredAt).toLocaleString("pt-BR")}</time></div>{evento.notes && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{evento.notes}</p>}</div></div>)}</div></section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={importDialog} onOpenChange={setImportDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader><DialogTitle>Importar equipamentos</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)] px-6 py-8 text-center"><FileUp className="mx-auto h-7 w-7 text-[var(--text-faint)]" /><p className="mt-3 text-[13px] font-medium text-[var(--text)]">Selecione uma planilha CSV</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">CPF/CNPJ e tipo são obrigatórios. O lote é validado antes da gravação.</p><input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={event => parseCsv(event.target.files?.[0])} /><Button variant="outline" className="mt-4 min-h-11" onClick={() => fileInputRef.current?.click()}>Selecionar arquivo</Button></div>
            {importError && <div className="rounded bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--danger)]">{importError}</div>}
            {importRows.length > 0 && <div className="flex items-center gap-2 rounded bg-[var(--ok-bg)] px-3 py-2 text-[12px] text-[var(--ok)]"><CheckCircle2 className="h-4 w-4" /> {importRows.length} linha(s) pronta(s) para validação.</div>}
            <button type="button" onClick={downloadTemplate} className="flex min-h-11 items-center gap-2 text-[12px] font-medium text-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"><Download className="h-4 w-4" /> Baixar modelo CSV</button>
          </div>
          <DialogFooter><Button variant="ghost" className="min-h-11" onClick={() => setImportDialog(false)}>Cancelar</Button><Button className="min-h-11" disabled={importRows.length === 0 || importar.isPending} onClick={() => importar.mutate()}>{importar.isPending ? "Importando..." : "Importar equipamentos"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
