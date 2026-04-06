import { useState, useRef, useCallback } from "react";
import Papa from "papaparse";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  Download,
  Users,
  FileText,
  Wifi,
  AlertTriangle,
  Loader2,
  Eye,
} from "lucide-react";

type ImportType = "customers" | "invoices" | "equipment";

interface ImportResult {
  imported: number;
  errors: { row: number; message: string }[];
}

interface PreviewData {
  headers: string[];
  rows: Record<string, string>[];
}

const TEMPLATES: Record<ImportType, { headers: string[]; example: string[] }> = {
  customers: {
    headers: ["nome", "cpf_cnpj", "email", "telefone", "endereco", "cidade", "estado", "cep", "status"],
    example: ["João da Silva", "123.456.789-00", "joao@email.com", "(11) 99999-9999", "Rua das Flores 123", "São Paulo", "SP", "01001-000", "active"],
  },
  invoices: {
    headers: ["cpf_cnpj", "nome_cliente", "valor", "data_vencimento", "status"],
    example: ["123.456.789-00", "João da Silva", "120.00", "31/01/2025", "pending"],
  },
  equipment: {
    headers: ["cpf_cnpj", "nome_cliente", "tipo", "marca", "modelo", "numero_serie", "mac", "status", "valor"],
    example: ["123.456.789-00", "João da Silva", "roteador", "Intelbras", "RF 301K", "SN123456", "AA:BB:CC:DD:EE:FF", "installed", "280.00"],
  },
};

const LABELS: Record<ImportType, { title: string; icon: React.ReactNode; hint: string }> = {
  customers: {
    title: "Clientes",
    icon: <Users className="w-4 h-4" />,
    hint: "Status: active, inactive",
  },
  invoices: {
    title: "Faturas",
    icon: <FileText className="w-4 h-4" />,
    hint: "Status: pending, paid, overdue | Data: dd/mm/aaaa | Valor: use ponto como decimal",
  },
  equipment: {
    title: "Equipamentos",
    icon: <Wifi className="w-4 h-4" />,
    hint: "Tipo: roteador, onu, switch, cabo | Status: installed, returned, lost",
  },
};

function downloadTemplate(type: ImportType) {
  const { headers, example } = TEMPLATES[type];
  const csv = [headers.join(","), example.join(",")].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `modelo_${type}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ImportTab({ type }: { type: ImportType }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cdcAcknowledged, setCdcAcknowledged] = useState(false);
  const label = LABELS[type];
  const requiresCdcAck = type === "customers" || type === "invoices";

  const mutation = useMutation({
    mutationFn: async (rows: Record<string, string>[]) => {
      const res = await apiRequest("POST", `/api/import/${type}`, { rows });
      return res.json() as Promise<ImportResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.imported > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
        queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
        toast({
          title: `${data.imported} ${label.title.toLowerCase()} importado(s)`,
          description: data.errors.length > 0 ? `${data.errors.length} linha(s) com erro` : "Importacao concluida com sucesso",
        });
      } else {
        toast({ title: "Nenhum registro importado", description: "Verifique os erros abaixo", variant: "destructive" });
      }
    },
    onError: (e: Error) => {
      toast({ title: "Erro na importacao", description: e.message, variant: "destructive" });
    },
  });

  const parseFile = useCallback((file: File) => {
    setResult(null);
    if (!file.name.match(/\.(csv|txt)$/i)) {
      toast({ title: "Formato nao suportado", description: "Use arquivos CSV (.csv)", variant: "destructive" });
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      complete: (result) => {
        if (!result.data || result.data.length === 0) {
          toast({ title: "Arquivo vazio", description: "O arquivo nao contem dados", variant: "destructive" });
          return;
        }
        setPreview({
          headers: result.meta.fields || [],
          rows: result.data as Record<string, string>[],
        });
      },
      error: () => {
        toast({ title: "Erro ao ler arquivo", description: "Verifique se o arquivo e um CSV valido", variant: "destructive" });
      },
    });
  }, [toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  };

  const handleImport = () => {
    if (!preview) return;
    mutation.mutate(preview.rows);
  };

  const reset = () => {
    setPreview(null);
    setResult(null);
    setCdcAcknowledged(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label.hint}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => downloadTemplate(type)}
          data-testid={`button-download-template-${type}`}
        >
          <Download className="w-4 h-4" />
          Baixar modelo CSV
        </Button>
      </div>

      {!preview && !result && (
        <div
          className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
            isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          data-testid={`dropzone-${type}`}
        >
          <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
          <p className="text-sm font-medium mb-1">Arraste o arquivo CSV aqui</p>
          <p className="text-xs text-muted-foreground mb-4">ou clique para selecionar</p>
          <Button
            variant="secondary"
            className="gap-2"
            onClick={() => fileInputRef.current?.click()}
            data-testid={`button-upload-${type}`}
          >
            <Upload className="w-4 h-4" />
            Selecionar Arquivo CSV
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleFileChange}
            data-testid={`input-file-${type}`}
          />
        </div>
      )}

      {preview && !result && (
        <div className="space-y-4">
          {requiresCdcAck && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cdcAcknowledged}
                    onChange={(e) => setCdcAcknowledged(e.target.checked)}
                    className="mt-1 rounded border-gray-300"
                    data-testid={`checkbox-cdc-${type}`}
                  />
                  <span className="text-sm">
                    Declaro que os titulares dos dados foram previamente notificados sobre a inclusao de suas informacoes, conforme exigido pelo CDC Art. 43, §2 (Codigo de Defesa do Consumidor).
                  </span>
                </label>
              </AlertDescription>
            </Alert>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {preview.rows.length} linha(s) encontrada(s)
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset} data-testid={`button-cancelar-${type}`}>
                Cancelar
              </Button>
              <Button
                size="sm"
                className="gap-2"
                onClick={handleImport}
                disabled={mutation.isPending || (requiresCdcAck && !cdcAcknowledged)}
                data-testid={`button-importar-${type}`}
              >
                {mutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Importando...</>
                ) : (
                  <><CheckCircle className="w-4 h-4" />Importar {preview.rows.length} registros</>
                )}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left p-2 font-medium text-muted-foreground w-8">#</th>
                  {preview.headers.map((h) => (
                    <th key={h} className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 10).map((row, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-2 text-muted-foreground">{i + 1}</td>
                    {preview.headers.map((h) => (
                      <td key={h} className="p-2 max-w-[150px] truncate">{row[h] || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length > 10 && (
              <div className="text-center text-xs text-muted-foreground py-2 border-t bg-muted/20">
                + {preview.rows.length - 10} linha(s) não exibida(s)
              </div>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-600">{result.imported}</p>
                <p className="text-xs text-muted-foreground">Importados</p>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <XCircle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-500">{result.errors.length}</p>
                <p className="text-xs text-muted-foreground">Erros</p>
              </div>
            </Card>
          </div>

          {result.errors.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium mb-2">Linhas com erro:</p>
                <ul className="space-y-1 text-sm max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}>Linha {e.row}: {e.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Button variant="outline" className="w-full gap-2" onClick={reset} data-testid={`button-nova-importacao-${type}`}>
            <Upload className="w-4 h-4" />
            Nova Importacao
          </Button>
        </div>
      )}
    </div>
  );
}

export default function ImportacaoPage() {
  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto" data-testid="importacao-page">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center">
          <Upload className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-importacao-title">Importacao</h1>
          <p className="text-sm text-muted-foreground">Importe dados via planilhas CSV</p>
        </div>
      </div>

      <Alert>
        <FileSpreadsheet className="h-4 w-4" />
        <AlertDescription>
          Baixe o modelo CSV, preencha com seus dados e faça o upload. Campos obrigatorios estao marcados no modelo.
        </AlertDescription>
      </Alert>

      <Card className="p-6">
        <Tabs defaultValue="customers">
          <TabsList className="mb-6" data-testid="tabs-importacao">
            <TabsTrigger value="customers" className="gap-2" data-testid="tab-import-clientes">
              <Users className="w-4 h-4" />
              Clientes
            </TabsTrigger>
            <TabsTrigger value="invoices" className="gap-2" data-testid="tab-import-faturas">
              <FileText className="w-4 h-4" />
              Faturas
            </TabsTrigger>
            <TabsTrigger value="equipment" className="gap-2" data-testid="tab-import-equipamentos">
              <Wifi className="w-4 h-4" />
              Equipamentos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="customers">
            <ImportTab type="customers" />
          </TabsContent>
          <TabsContent value="invoices">
            <ImportTab type="invoices" />
          </TabsContent>
          <TabsContent value="equipment">
            <ImportTab type="equipment" />
          </TabsContent>
        </Tabs>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
          Dados suportados por tipo
        </h3>
        <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
          {(["customers", "invoices", "equipment"] as ImportType[]).map((type) => (
            <div key={type}>
              <p className="font-medium text-foreground mb-1 capitalize">{LABELS[type].title}</p>
              {TEMPLATES[type].headers.map((h) => (
                <div key={h} className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                  <span>{h}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
