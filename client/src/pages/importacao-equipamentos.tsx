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
} from "lucide-react";
import Papa from "papaparse";

const TIPOS = ["ONU/ONT", "Roteador Wi-Fi", "Switch", "Conversor de Midia", "Access Point", "Outro"];
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
      setForm({ cpfCnpj: "", nomeCliente: "", tipo: "ONU/ONT", marca: "Intelbras", modelo: "", numeroSerie: "", valor: "", dataPerda: "", observacao: "" });
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

  const handleSubmitManual = () => {
    if (!form.cpfCnpj) {
      toast({ title: "CPF/CNPJ obrigatorio", variant: "destructive" });
      return;
    }
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
                onClick={() => setActiveTab(tab)}
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
          <Card className="p-6 space-y-4">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-amber-600" />
              Cadastro Manual de Equipamento
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">CPF/CNPJ <span className="text-red-500">*</span></Label>
                <Input
                  value={form.cpfCnpj}
                  onChange={(e) => setForm(f => ({ ...f, cpfCnpj: e.target.value }))}
                  placeholder="000.000.000-00"
                  data-testid="input-cpf-cnpj"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Nome do Cliente</Label>
                <Input
                  value={form.nomeCliente}
                  onChange={(e) => setForm(f => ({ ...f, nomeCliente: e.target.value }))}
                  placeholder="Nome completo"
                  data-testid="input-nome-cliente"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Tipo de Equipamento <span className="text-red-500">*</span></Label>
                <Select value={form.tipo} onValueChange={(v) => setForm(f => ({ ...f, tipo: v }))}>
                  <SelectTrigger data-testid="select-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Marca</Label>
                <Select value={form.marca} onValueChange={(v) => setForm(f => ({ ...f, marca: v }))}>
                  <SelectTrigger data-testid="select-marca">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARCAS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Modelo</Label>
                <Input
                  value={form.modelo}
                  onChange={(e) => setForm(f => ({ ...f, modelo: e.target.value }))}
                  placeholder="Ex: GPON 1200R"
                  data-testid="input-modelo"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Numero de Serie</Label>
                <Input
                  value={form.numeroSerie}
                  onChange={(e) => setForm(f => ({ ...f, numeroSerie: e.target.value }))}
                  placeholder="Serial do equipamento"
                  data-testid="input-numero-serie"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Valor do Equipamento (R$)</Label>
                <Input
                  type="number"
                  value={form.valor}
                  onChange={(e) => setForm(f => ({ ...f, valor: e.target.value }))}
                  placeholder="0.00"
                  data-testid="input-valor"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Data da Perda</Label>
                <Input
                  type="date"
                  value={form.dataPerda}
                  onChange={(e) => setForm(f => ({ ...f, dataPerda: e.target.value }))}
                  data-testid="input-data-perda"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs font-semibold text-slate-700">Observacoes</Label>
                <Textarea
                  value={form.observacao}
                  onChange={(e) => setForm(f => ({ ...f, observacao: e.target.value }))}
                  placeholder="Ex: Nao devolvido apos cancelamento do contrato"
                  rows={3}
                  data-testid="input-observacao"
                />
              </div>
            </div>
            <Button
              className="w-full gap-2 bg-amber-600 hover:bg-amber-700"
              onClick={handleSubmitManual}
              disabled={createMutation.isPending}
              data-testid="button-salvar-equipamento"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Salvar Equipamento
            </Button>
          </Card>
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
