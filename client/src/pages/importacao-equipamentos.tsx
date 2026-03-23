import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Package, Upload, Plus, FileText, Download, CheckCircle, AlertTriangle,
  Trash2, RefreshCw, DollarSign, ChevronDown, Loader2, TableIcon,
  Wifi, Router, ChevronRight, ChevronLeft, User, Settings,
  Calendar, ScanLine, ArrowRight, Zap, Server, Network, Cpu,
} from "lucide-react";
import Papa from "papaparse";

const TIPOS_CONFIG = [
  { id: "ONU/ONT", label: "ONU / ONT", icon: Zap, desc: "Fibra optica GPON/EPON", color: "blue" },
  { id: "Roteador Wi-Fi", label: "Roteador Wi-Fi", icon: Router, desc: "Equipamento sem fio", color: "violet" },
  { id: "Switch", label: "Switch", icon: Network, desc: "Comutador de rede", color: "emerald" },
  { id: "Conversor de Midia", label: "Conversor de Midia", icon: ArrowRight, desc: "Media converter", color: "orange" },
  { id: "Access Point", label: "Access Point", icon: Wifi, desc: "Ponto de acesso Wi-Fi", color: "cyan" },
  { id: "Outro", label: "Outro", icon: Cpu, desc: "Outro equipamento", color: "slate" },
];

const MARCAS_POR_TIPO: Record<string, string[]> = {
  "ONU/ONT": ["Intelbras", "ZTE", "Huawei", "FiberHome", "Nokia", "Motorola", "Datacom", "Outra"],
  "Roteador Wi-Fi": ["Intelbras", "TP-Link", "Asus", "D-Link", "Mikrotik", "Ubiquiti", "Cisco", "Outra"],
  "Switch": ["Intelbras", "Cisco", "D-Link", "TP-Link", "Mikrotik", "HP", "Outra"],
  "Conversor de Midia": ["TP-Link", "Intelbras", "D-Link", "Cisco", "Outra"],
  "Access Point": ["Ubiquiti", "Intelbras", "Cisco", "TP-Link", "Mikrotik", "Ruckus", "Outra"],
  "Outro": ["Intelbras", "TP-Link", "ZTE", "Huawei", "Cisco", "Outra"],
};

const MODELOS_SUGERIDOS: Record<string, Record<string, string[]>> = {
  "ONU/ONT": {
    "Intelbras": ["WiFiber 1200R", "WiFiber 121 AC", "ONU 110", "WiFiber 300", "WiFiber AX 1800"],
    "ZTE": ["F601", "F660", "F680", "F650"],
    "Huawei": ["HG8310M", "HG8120C", "HG8245H", "EG8010H"],
    "FiberHome": ["AN5506-04-F", "AN5506-04-FG", "HG220GS"],
  },
  "Roteador Wi-Fi": {
    "Intelbras": ["Action RF1200", "Action RG1200", "Action A1200"],
    "TP-Link": ["Archer C6", "Archer AX23", "TL-WR849N", "Archer AX10"],
    "Asus": ["RT-AX55", "RT-AC750", "RT-AX3000"],
    "Mikrotik": ["hAP ac²", "hAP ax²", "RB951Ui"],
  },
};

const TIPOS = TIPOS_CONFIG.map(t => t.id);
const MARCAS = ["Intelbras", "TP-Link", "ZTE", "Huawei", "FiberHome", "Nokia", "Cisco", "Outra"];
const STATUS_LABELS: Record<string, string> = {
  retido: "Retido",
  recuperado: "Recuperado",
  em_cobranca: "Em cobranca",
  baixado: "Baixado",
};

function formatCpf(v: string) {
  const c = v.replace(/\D/g, "");
  if (c.length <= 11) return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

function formatCurrency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const CSV_HEADER = "cpf_cnpj,nome_cliente,tipo_equipamento,marca,modelo,numero_serie,valor_equipamento,data_perda,observacao";
const CSV_EXAMPLE1 = '12345678901,"Joao da Silva",ONU,Intelbras,GPON 1200R,SN123456,350.00,2025-01-15,"Nao devolvido apos cancelamento"';
const CSV_EXAMPLE2 = '98765432100,"Maria Oliveira",Roteador Wi-Fi,TP-Link,Archer C6,SN789012,180.00,2025-02-20,"Cliente sumiu"';

function downloadCsvTemplate() {
  const content = [CSV_HEADER, CSV_EXAMPLE1, CSV_EXAMPLE2].join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "modelo_equipamentos.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportacaoEquipamentosPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"upload" | "manual" | "lista">("upload");
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardErrors, setWizardErrors] = useState<Record<string, string>>({});

  const { data = { items: [], stats: {} }, isLoading } = useQuery<any>({
    queryKey: ["/api/equipamentos"],
  });
  const items: any[] = data.items || [];
  const stats = data.stats || {};

  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [parseErrors, setParseErrors] = useState<{ linha: number; erro: string }[]>([]);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    cpfCnpj: "", nomeCliente: "", tipo: "ONU/ONT", marca: "Intelbras",
    modelo: "", numeroSerie: "", valor: "", dataPerda: "", observacao: "",
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/equipamentos", data).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Equipamento cadastrado com sucesso" });
      setForm({ cpfCnpj: "", nomeCliente: "", tipo: "ONU/ONT", marca: "", modelo: "", numeroSerie: "", valor: "", dataPerda: "", observacao: "" });
      setWizardStep(1);
      setWizardErrors({});
      qc.invalidateQueries({ queryKey: ["/api/equipamentos"] });
      setActiveTab("lista");
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/equipamentos/${id}`, { status }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/equipamentos"] }),
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/equipamentos/${id}`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Equipamento removido" });
      qc.invalidateQueries({ queryKey: ["/api/equipamentos"] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const parseFile = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data as any[];
        const erros: { linha: number; erro: string }[] = [];
        const valid: any[] = [];
        rows.forEach((row, i) => {
          if (!row.cpf_cnpj) {
            erros.push({ linha: i + 2, erro: "CPF/CNPJ ausente" });
          } else {
            valid.push(row);
          }
        });
        setParsedRows(valid);
        setParseErrors(erros);
      },
      error: () => toast({ title: "Erro ao processar o arquivo CSV", variant: "destructive" }),
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".csv")) parseFile(file);
    else toast({ title: "Por favor, envie um arquivo .csv", variant: "destructive" });
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  };

  const handleImport = async () => {
    if (!parsedRows.length) return;
    setImporting(true);
    try {
      const res = await apiRequest("POST", "/api/equipamentos/import", { rows: parsedRows });
      const result = await res.json();
      toast({ title: `${result.importados} equipamentos importados com sucesso` });
      setParsedRows([]);
      setParseErrors([]);
      qc.invalidateQueries({ queryKey: ["/api/equipamentos"] });
      setActiveTab("lista");
    } catch (e: any) {
      toast({ title: "Erro na importacao", description: e.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const detectDocType = (v: string): "CPF" | "CNPJ" | null => {
    const c = v.replace(/\D/g, "");
    if (c.length === 11) return "CPF";
    if (c.length === 14) return "CNPJ";
    return null;
  };

  const formatDocAuto = (raw: string) => {
    const c = raw.replace(/\D/g, "").slice(0, 14);
    if (c.length <= 11) {
      return c
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    return c
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  };

  const validateStep = (step: number): boolean => {
    const errs: Record<string, string> = {};
    if (step === 1) {
      const c = form.cpfCnpj.replace(/\D/g, "");
      if (!c) errs.cpfCnpj = "CPF ou CNPJ e obrigatorio";
      else if (c.length !== 11 && c.length !== 14) errs.cpfCnpj = "CPF deve ter 11 digitos ou CNPJ 14 digitos";
    }
    if (step === 2) {
      if (!form.tipo) errs.tipo = "Selecione o tipo de equipamento";
    }
    setWizardErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const advanceWizard = () => {
    if (validateStep(wizardStep)) setWizardStep(s => Math.min(s + 1, 4));
  };

  const handleSubmitManual = () => {
    if (!validateStep(wizardStep)) return;
    createMutation.mutate({
      cpfCnpj: form.cpfCnpj.replace(/\D/g, ""),
      nomeCliente: form.nomeCliente || null,
      tipo: form.tipo,
      marca: form.marca || null,
      modelo: form.modelo || null,
      numeroSerie: form.numeroSerie || null,
      valor: form.valor ? String(parseFloat(form.valor)) : "0",
      dataPerda: form.dataPerda || null,
      observacao: form.observacao || null,
    });
  };

  const totalValorRetido = formatCurrency(parseFloat(String(stats.valorRisco || 0)));

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-slate-50 to-orange-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-600 flex items-center justify-center shadow-md">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-600 to-orange-700 bg-clip-text text-transparent leading-tight">
                  Importar Equipamentos
                </h1>
                <Badge className="bg-amber-500 text-white text-[10px] font-black">NOVO RECURSO</Badge>
              </div>
              <p className="text-base text-slate-600">Registre equipamentos retidos por clientes inadimplentes</p>
            </div>
          </div>
          <Button variant="outline" onClick={downloadCsvTemplate} className="gap-2" data-testid="button-download-template">
            <Download className="w-4 h-4" />
            Baixar Modelo CSV
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Retidos", value: stats.retidos ?? 0, icon: Package, color: "bg-red-100 text-red-700", bg: "bg-red-50", border: "border-red-200" },
            { label: "Recuperados", value: stats.recuperados ?? 0, icon: CheckCircle, color: "bg-emerald-100 text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
            { label: "Valor em Risco", value: totalValorRetido, icon: DollarSign, color: "bg-amber-100 text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
          ].map(stat => (
            <Card key={stat.label} className={`p-4 ${stat.border} ${stat.bg}`}>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${stat.color}`}>
                  <stat.icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-900">{isLoading ? "..." : stat.value}</p>
                  <p className="text-xs font-semibold text-slate-500">{stat.label}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="flex gap-1 bg-white/70 backdrop-blur border border-slate-200 rounded-xl p-1 w-fit">
          {(["upload", "manual", "lista"] as const).map(tab => {
            const labels: Record<string, string> = { upload: "📁 Upload Planilha", manual: "✏️ Cadastro Manual", lista: "📋 Equipamentos" };
            return (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === "manual") { setWizardStep(1); setWizardErrors({}); }
                }}
                data-testid={`tab-${tab}`}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === tab ? "bg-amber-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {activeTab === "upload" && (
          <div className="space-y-4">
            <Card className="p-5 border-amber-200 bg-amber-50/50">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-900 text-sm">Por que registrar equipamentos?</p>
                  <p className="text-xs text-amber-700 mt-1">
                    A maioria dos provedores nao registra equipamentos perdidos no ERP. Sem esse registro, o sistema nao consegue
                    alertar outros provedores quando um cliente inadimplente com equipamento retido tenta contratar novo servico.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                <TableIcon className="w-4 h-4 text-slate-400" />
                Campos Suportados no CSV
              </h3>
              <div className="divide-y divide-slate-100">
                {[
                  { campo: "cpf_cnpj", desc: "CPF ou CNPJ do cliente", obrig: true },
                  { campo: "nome_cliente", desc: "Nome do cliente inadimplente", obrig: false },
                  { campo: "tipo_equipamento", desc: "ONU, Roteador, Switch, etc.", obrig: true },
                  { campo: "marca", desc: "Intelbras, ZTE, TP-Link, Huawei...", obrig: false },
                  { campo: "modelo", desc: "Ex: GPON 1200R, Archer C6", obrig: false },
                  { campo: "numero_serie", desc: "Serial do equipamento", obrig: false },
                  { campo: "valor_equipamento", desc: "Valor em R$ para cobranca", obrig: false },
                  { campo: "data_perda", desc: "Data em que foi perdido (YYYY-MM-DD)", obrig: false },
                  { campo: "observacao", desc: "Observacoes adicionais", obrig: false },
                ].map(row => (
                  <div key={row.campo} className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      {row.obrig && <Badge className="text-[10px] bg-blue-100 text-blue-800 font-bold">OBRIG</Badge>}
                      {!row.obrig && <div className="w-12" />}
                      <code className="text-xs font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{row.campo}</code>
                    </div>
                    <p className="text-xs text-slate-500">{row.desc}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card
              className={`p-8 border-2 border-dashed transition-colors cursor-pointer text-center ${dragOver ? "border-amber-400 bg-amber-50" : "border-slate-200 hover:border-amber-300"}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              data-testid="dropzone-csv"
            >
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} data-testid="input-csv-file" />
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-700">Arraste o arquivo CSV aqui</p>
                  <p className="text-xs text-slate-400 mt-1">ou clique para selecionar — apenas arquivos .csv</p>
                </div>
              </div>
            </Card>

            {(parsedRows.length > 0 || parseErrors.length > 0) && (
              <Card className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">Preview dos Dados</h3>
                  <div className="flex gap-2">
                    {parsedRows.length > 0 && (
                      <Badge className="bg-emerald-100 text-emerald-800">{parsedRows.length} prontos para importar</Badge>
                    )}
                    {parseErrors.length > 0 && (
                      <Badge className="bg-red-100 text-red-800">{parseErrors.length} com erro</Badge>
                    )}
                    {parsedRows.length > 0 && (
                      <Badge className="bg-amber-100 text-amber-800">
                        R$ {parsedRows.reduce((s, r) => s + (parseFloat(r.valor_equipamento) || 0), 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} valor total
                      </Badge>
                    )}
                  </div>
                </div>

                {parsedRows.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50">
                        <tr>
                          {["CPF/CNPJ", "Nome", "Tipo", "Marca", "Modelo", "Valor"].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-semibold text-slate-600">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsedRows.slice(0, 10).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono">{row.cpf_cnpj}</td>
                            <td className="px-3 py-2">{row.nome_cliente || "—"}</td>
                            <td className="px-3 py-2">{row.tipo_equipamento || "—"}</td>
                            <td className="px-3 py-2">{row.marca || "—"}</td>
                            <td className="px-3 py-2">{row.modelo || "—"}</td>
                            <td className="px-3 py-2">{row.valor_equipamento ? `R$ ${row.valor_equipamento}` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsedRows.length > 10 && (
                      <p className="text-xs text-slate-400 text-center py-2">Mostrando 10 de {parsedRows.length} registros</p>
                    )}
                  </div>
                )}

                {parseErrors.length > 0 && (
                  <div className="space-y-1">
                    {parseErrors.map((e, i) => (
                      <p key={i} className="text-xs text-red-600">Linha {e.linha}: {e.erro}</p>
                    ))}
                  </div>
                )}

                <Button
                  className="w-full gap-2 bg-amber-600 hover:bg-amber-700"
                  onClick={handleImport}
                  disabled={importing || parsedRows.length === 0}
                  data-testid="button-import"
                >
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {importing ? "Importando..." : `Importar ${parsedRows.length} equipamentos`}
                </Button>
              </Card>
            )}
          </div>
        )}

        {activeTab === "manual" && (
          <div className="space-y-5">
            {/* Stepper */}
            <div className="flex items-center gap-0">
              {[
                { n: 1, label: "Cliente" },
                { n: 2, label: "Equipamento" },
                { n: 3, label: "Detalhes" },
                { n: 4, label: "Revisao" },
              ].map((step, i, arr) => (
                <div key={step.n} className="flex items-center flex-1">
                  <button
                    onClick={() => { if (step.n < wizardStep) setWizardStep(step.n); }}
                    className="flex flex-col items-center gap-1 flex-1"
                    data-testid={`wizard-step-${step.n}`}
                  >
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-black transition-all ${
                      step.n < wizardStep ? "bg-emerald-500 text-white"
                      : step.n === wizardStep ? "bg-amber-600 text-white ring-4 ring-amber-100 scale-110"
                      : "bg-slate-100 text-slate-400"
                    }`}>
                      {step.n < wizardStep ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : step.n}
                    </div>
                    <span className={`text-[11px] font-semibold ${step.n === wizardStep ? "text-amber-700" : step.n < wizardStep ? "text-emerald-600" : "text-slate-400"}`}>{step.label}</span>
                  </button>
                  {i < arr.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-1 mb-4 transition-colors ${step.n < wizardStep ? "bg-emerald-400" : "bg-slate-200"}`} />
                  )}
                </div>
              ))}
            </div>

            {/* Step 1: Identificacao */}
            {wizardStep === 1 && (
              <Card className="overflow-hidden shadow-lg rounded-2xl">
                <div className="bg-amber-50 border-b border-amber-100 px-6 py-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-600 flex items-center justify-center">
                    <User className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">Identificacao do Cliente</h3>
                    <p className="text-xs text-slate-500">Informe o documento do cliente inadimplente</p>
                  </div>
                </div>
                <div className="p-6 space-y-5">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-slate-700">CPF ou CNPJ <span className="text-red-500">*</span></Label>
                    <div className="relative">
                      <Input
                        value={form.cpfCnpj}
                        onChange={(e) => {
                          const fmt = formatDocAuto(e.target.value);
                          setForm(f => ({ ...f, cpfCnpj: fmt }));
                          if (wizardErrors.cpfCnpj) setWizardErrors(er => ({ ...er, cpfCnpj: "" }));
                        }}
                        onKeyDown={(e) => e.key === "Enter" && advanceWizard()}
                        placeholder="Digite o CPF ou CNPJ..."
                        className={`h-12 text-base pr-24 font-mono ${wizardErrors.cpfCnpj ? "border-red-400" : ""}`}
                        data-testid="input-cpf-cnpj"
                        maxLength={18}
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {detectDocType(form.cpfCnpj) === "CPF" && (
                          <Badge className="bg-green-100 text-green-700 text-xs font-bold">CPF</Badge>
                        )}
                        {detectDocType(form.cpfCnpj) === "CNPJ" && (
                          <Badge className="bg-blue-100 text-blue-700 text-xs font-bold">CNPJ</Badge>
                        )}
                        {!detectDocType(form.cpfCnpj) && form.cpfCnpj.replace(/\D/g, "").length > 0 && (
                          <Badge className="bg-slate-100 text-slate-500 text-xs">{form.cpfCnpj.replace(/\D/g, "").length}/11-14</Badge>
                        )}
                      </div>
                    </div>
                    {wizardErrors.cpfCnpj && <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {wizardErrors.cpfCnpj}</p>}
                    {detectDocType(form.cpfCnpj) && (
                      <p className="text-xs text-emerald-600 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        {detectDocType(form.cpfCnpj)} valido detectado
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-slate-700">Nome do Cliente</Label>
                    <Input
                      value={form.nomeCliente}
                      onChange={(e) => setForm(f => ({ ...f, nomeCliente: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && advanceWizard()}
                      placeholder="Ex: Joao da Silva"
                      className="h-12 text-base"
                      data-testid="input-nome-cliente"
                    />
                    <p className="text-xs text-slate-400">Opcional — facilita identificacao interna</p>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-800">
                      <span className="font-semibold">Dica:</span> O documento sera consultado na rede ISP para cruzamento de dados.
                      Qualquer outro provedor que consulte esse mesmo documento sera alertado sobre o equipamento retido.
                    </p>
                  </div>
                </div>
                <div className="border-t bg-slate-50 px-6 py-4 flex justify-end">
                  <Button className="gap-2 bg-amber-600 hover:bg-amber-700" onClick={advanceWizard} data-testid="wizard-next-1">
                    Continuar <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            )}

            {/* Step 2: Tipo de Equipamento */}
            {wizardStep === 2 && (
              <Card className="overflow-hidden shadow-lg rounded-2xl">
                <div className="bg-amber-50 border-b border-amber-100 px-6 py-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-600 flex items-center justify-center">
                    <Package className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">Tipo de Equipamento</h3>
                    <p className="text-xs text-slate-500">Selecione o tipo do equipamento retido</p>
                  </div>
                </div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {TIPOS_CONFIG.map(tipo => {
                      const selected = form.tipo === tipo.id;
                      const colorMap: Record<string, string> = {
                        blue: selected ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-blue-300 hover:bg-blue-50/50",
                        violet: selected ? "border-violet-500 bg-violet-50" : "border-slate-200 hover:border-violet-300 hover:bg-violet-50/50",
                        emerald: selected ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50",
                        orange: selected ? "border-orange-500 bg-orange-50" : "border-slate-200 hover:border-orange-300 hover:bg-orange-50/50",
                        cyan: selected ? "border-cyan-500 bg-cyan-50" : "border-slate-200 hover:border-cyan-300 hover:bg-cyan-50/50",
                        slate: selected ? "border-slate-500 bg-slate-100" : "border-slate-200 hover:border-slate-400",
                      };
                      const iconColorMap: Record<string, string> = {
                        blue: selected ? "bg-blue-500 text-white" : "bg-blue-100 text-blue-600",
                        violet: selected ? "bg-violet-500 text-white" : "bg-violet-100 text-violet-600",
                        emerald: selected ? "bg-emerald-500 text-white" : "bg-emerald-100 text-emerald-600",
                        orange: selected ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-600",
                        cyan: selected ? "bg-cyan-500 text-white" : "bg-cyan-100 text-cyan-600",
                        slate: selected ? "bg-slate-500 text-white" : "bg-slate-100 text-slate-600",
                      };
                      return (
                        <button
                          key={tipo.id}
                          onClick={() => {
                            setForm(f => ({ ...f, tipo: tipo.id, marca: "", modelo: "" }));
                            if (wizardErrors.tipo) setWizardErrors(er => ({ ...er, tipo: "" }));
                          }}
                          className={`p-4 rounded-xl border-2 transition-all text-left space-y-2 ${colorMap[tipo.color]}`}
                          data-testid={`tipo-card-${tipo.id.replace(/\//g, "-").replace(/ /g, "-")}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconColorMap[tipo.color]}`}>
                              <tipo.icon className="w-4 h-4" />
                            </div>
                            {selected && (
                              <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 text-sm">{tipo.label}</p>
                            <p className="text-[11px] text-slate-500">{tipo.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {wizardErrors.tipo && <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {wizardErrors.tipo}</p>}
                </div>
                <div className="border-t bg-slate-50 px-6 py-4 flex justify-between">
                  <Button variant="outline" className="gap-2" onClick={() => setWizardStep(1)} data-testid="wizard-back-2">
                    <ChevronLeft className="w-4 h-4" /> Voltar
                  </Button>
                  <Button className="gap-2 bg-amber-600 hover:bg-amber-700" onClick={advanceWizard} disabled={!form.tipo} data-testid="wizard-next-2">
                    Continuar <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            )}

            {/* Step 3: Detalhes do Equipamento */}
            {wizardStep === 3 && (
              <Card className="overflow-hidden shadow-lg rounded-2xl">
                <div className="bg-amber-50 border-b border-amber-100 px-6 py-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-600 flex items-center justify-center">
                    <Settings className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">Detalhes do Equipamento</h3>
                    <p className="text-xs text-slate-500">Marca, modelo, serial e valor para cobranca</p>
                  </div>
                </div>
                <div className="p-6 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-slate-700">Marca</Label>
                      <div className="flex flex-wrap gap-2">
                        {(MARCAS_POR_TIPO[form.tipo] || MARCAS).map(m => (
                          <button
                            key={m}
                            onClick={() => setForm(f => ({ ...f, marca: m, modelo: "" }))}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors ${
                              form.marca === m
                                ? "border-amber-500 bg-amber-50 text-amber-800"
                                : "border-slate-200 text-slate-600 hover:border-amber-300"
                            }`}
                            data-testid={`marca-btn-${m}`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-slate-700">Modelo</Label>
                      {form.marca && MODELOS_SUGERIDOS[form.tipo]?.[form.marca]?.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {MODELOS_SUGERIDOS[form.tipo][form.marca].map(m => (
                              <button
                                key={m}
                                onClick={() => setForm(f => ({ ...f, modelo: m }))}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                  form.modelo === m
                                    ? "border-amber-500 bg-amber-50 text-amber-800"
                                    : "border-slate-200 text-slate-500 hover:border-amber-300"
                                }`}
                                data-testid={`modelo-btn-${m}`}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                          <Input
                            value={form.modelo}
                            onChange={(e) => setForm(f => ({ ...f, modelo: e.target.value }))}
                            placeholder="Ou digite o modelo..."
                            className="h-9 text-sm"
                            data-testid="input-modelo"
                          />
                        </div>
                      ) : (
                        <Input
                          value={form.modelo}
                          onChange={(e) => setForm(f => ({ ...f, modelo: e.target.value }))}
                          placeholder="Ex: GPON 1200R, Archer C6"
                          className="h-10 text-sm"
                          data-testid="input-modelo"
                        />
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                        <ScanLine className="w-3.5 h-3.5 text-slate-400" />
                        Numero de Serie
                      </Label>
                      <Input
                        value={form.numeroSerie}
                        onChange={(e) => setForm(f => ({ ...f, numeroSerie: e.target.value }))}
                        placeholder="SN-XXXXX ou codigo do equipamento"
                        className="h-10 font-mono text-sm"
                        data-testid="input-numero-serie"
                      />
                      <p className="text-[11px] text-slate-400">Usado para identificar o equipamento em campo</p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                        <DollarSign className="w-3.5 h-3.5 text-slate-400" />
                        Valor do Equipamento (R$)
                      </Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">R$</span>
                        <Input
                          type="number"
                          value={form.valor}
                          onChange={(e) => setForm(f => ({ ...f, valor: e.target.value }))}
                          placeholder="0,00"
                          className="h-10 pl-9 text-sm"
                          data-testid="input-valor"
                          step="0.01"
                          min="0"
                        />
                      </div>
                      {form.valor && parseFloat(form.valor) > 0 && (
                        <p className="text-xs text-amber-700 font-semibold">
                          Sera exibido como valor a cobrar do cliente
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="border-t bg-slate-50 px-6 py-4 flex justify-between">
                  <Button variant="outline" className="gap-2" onClick={() => setWizardStep(2)} data-testid="wizard-back-3">
                    <ChevronLeft className="w-4 h-4" /> Voltar
                  </Button>
                  <Button className="gap-2 bg-amber-600 hover:bg-amber-700" onClick={advanceWizard} data-testid="wizard-next-3">
                    Continuar <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            )}

            {/* Step 4: Data, Observacoes e Revisao */}
            {wizardStep === 4 && (
              <Card className="overflow-hidden shadow-lg rounded-2xl">
                <div className="bg-amber-50 border-b border-amber-100 px-6 py-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-600 flex items-center justify-center">
                    <CheckCircle className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">Revisao e Confirmacao</h3>
                    <p className="text-xs text-slate-500">Verifique os dados e finalize o cadastro</p>
                  </div>
                </div>
                <div className="p-6 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        Data da Perda / Cancelamento
                      </Label>
                      <Input
                        type="date"
                        value={form.dataPerda}
                        onChange={(e) => setForm(f => ({ ...f, dataPerda: e.target.value }))}
                        className="h-10"
                        data-testid="input-data-perda"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-slate-700">Observacoes</Label>
                      <Textarea
                        value={form.observacao}
                        onChange={(e) => setForm(f => ({ ...f, observacao: e.target.value }))}
                        placeholder="Ex: Nao devolveu apos cancelamento em jan/25"
                        rows={2}
                        className="text-sm resize-none"
                        data-testid="input-observacao"
                      />
                    </div>
                  </div>

                  {/* Resumo */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-wide">Resumo do Cadastro</p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Documento", value: form.cpfCnpj || "—", badge: detectDocType(form.cpfCnpj) },
                        { label: "Cliente", value: form.nomeCliente || "Nao informado" },
                        { label: "Tipo", value: form.tipo || "—" },
                        { label: "Marca", value: form.marca || "Nao informada" },
                        { label: "Modelo", value: form.modelo || "Nao informado" },
                        { label: "Serie", value: form.numeroSerie || "Nao informado" },
                        { label: "Valor", value: form.valor && parseFloat(form.valor) > 0 ? formatCurrency(parseFloat(form.valor)) : "Nao informado" },
                        { label: "Data perda", value: form.dataPerda || "Nao informada" },
                      ].map(row => (
                        <div key={row.label} className="space-y-0.5">
                          <p className="text-[10px] text-slate-400 font-semibold uppercase">{row.label}</p>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-slate-800">{row.value}</p>
                            {row.badge && <Badge className="text-[9px] bg-emerald-100 text-emerald-700">{row.badge}</Badge>}
                          </div>
                        </div>
                      ))}
                    </div>
                    {form.observacao && (
                      <div className="pt-2 border-t border-slate-200">
                        <p className="text-[10px] text-slate-400 font-semibold uppercase mb-0.5">Observacoes</p>
                        <p className="text-sm text-slate-700">{form.observacao}</p>
                      </div>
                    )}
                  </div>

                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">
                      Ao salvar, este equipamento sera vinculado ao CPF/CNPJ informado.
                      Qualquer consulta futura sobre este documento na rede Consulta ISP ira exibir o alerta de equipamento retido.
                    </p>
                  </div>
                </div>
                <div className="border-t bg-slate-50 px-6 py-4 flex justify-between">
                  <Button variant="outline" className="gap-2" onClick={() => setWizardStep(3)} data-testid="wizard-back-4">
                    <ChevronLeft className="w-4 h-4" /> Voltar
                  </Button>
                  <Button
                    className="gap-2 bg-amber-600 hover:bg-amber-700 min-w-[160px]"
                    onClick={handleSubmitManual}
                    disabled={createMutation.isPending}
                    data-testid="button-salvar-equipamento"
                  >
                    {createMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
                    ) : (
                      <><CheckCircle className="w-4 h-4" /> Confirmar Cadastro</>
                    )}
                  </Button>
                </div>
              </Card>
            )}
          </div>
        )}

        {activeTab === "lista" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">
                {items.length} equipamento{items.length !== 1 ? "s" : ""} cadastrado{items.length !== 1 ? "s" : ""}
              </h3>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["/api/equipamentos"] })} className="gap-1.5" data-testid="button-refresh-lista">
                  <RefreshCw className="w-3.5 h-3.5" />
                  Atualizar
                </Button>
                <Button variant="outline" size="sm" onClick={() => setActiveTab("upload")} className="gap-1.5" data-testid="button-import-more">
                  <Upload className="w-3.5 h-3.5" />
                  Importar mais
                </Button>
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Card key={i} className="p-4 h-16 animate-pulse bg-slate-100" />)}
              </div>
            ) : items.length === 0 ? (
              <Card className="p-12 text-center border-dashed border-2">
                <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-semibold">Nenhum equipamento cadastrado</p>
                <p className="text-xs text-slate-400 mt-1">Use a aba "Upload Planilha" ou "Cadastro Manual" para comecar</p>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        {["Cliente", "Tipo", "Marca/Modelo", "Serie", "Valor", "Data", "Status", "Acoes"].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((item: any) => (
                        <tr key={item.id} className="hover:bg-slate-50" data-testid={`row-equipamento-${item.id}`}>
                          <td className="px-3 py-2.5">
                            <p className="font-semibold text-slate-900">{item.nomeCliente || "—"}</p>
                            <p className="text-slate-400 font-mono">{formatCpf(item.cpfCnpj)}</p>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge className="text-[10px] bg-slate-100 text-slate-700">{item.tipo}</Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-slate-700">{item.marca || "—"}</p>
                            <p className="text-slate-400">{item.modelo || "—"}</p>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-500">{item.numeroSerie || "—"}</td>
                          <td className="px-3 py-2.5">
                            {item.valor && parseFloat(item.valor) > 0
                              ? <span className="font-bold text-red-600">{formatCurrency(parseFloat(item.valor))}</span>
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-slate-500">{item.dataPerda || "—"}</td>
                          <td className="px-3 py-2.5">
                            <Select
                              value={item.status}
                              onValueChange={(v) => updateStatusMutation.mutate({ id: item.id, status: v })}
                            >
                              <SelectTrigger className={`h-7 text-[11px] w-32 ${item.status === "retido" ? "border-red-200 bg-red-50" : item.status === "recuperado" ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`} data-testid={`select-status-${item.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                                  <SelectItem key={v} value={v}>{l}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-800"
                                onClick={() => updateStatusMutation.mutate({ id: item.id, status: "recuperado" })}
                                title="Marcar como recuperado"
                                data-testid={`button-recuperado-${item.id}`}
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                                onClick={() => deleteMutation.mutate(item.id)}
                                title="Remover"
                                data-testid={`button-delete-${item.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
