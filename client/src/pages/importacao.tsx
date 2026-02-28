import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileSpreadsheet,
  Database,
  RefreshCw,
  CheckCircle,
  Wifi,
} from "lucide-react";

const erps = [
  { name: "IXC Provedor", status: "available" },
  { name: "Voalle", status: "available" },
  { name: "SGP", status: "available" },
  { name: "RBx", status: "coming_soon" },
  { name: "HubSoft", status: "coming_soon" },
  { name: "MK Solutions", status: "coming_soon" },
];

export default function ImportacaoPage() {
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="importacao-page">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center">
          <Upload className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-importacao-title">Importacao</h1>
          <p className="text-sm text-muted-foreground">Importe dados do seu ERP ou planilhas</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Database className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Integracao com ERP</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            Conecte seu ERP para sincronizacao automatica de clientes, contratos, faturas e equipamentos.
          </p>
          <div className="space-y-3">
            {erps.map((erp) => (
              <div key={erp.name} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg" data-testid={`erp-${erp.name.toLowerCase().replace(/\s/g, "-")}`}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <Wifi className="w-4 h-4 text-blue-600" />
                  </div>
                  <span className="text-sm font-medium">{erp.name}</span>
                </div>
                {erp.status === "available" ? (
                  <Button size="sm" variant="secondary" className="gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Conectar
                  </Button>
                ) : (
                  <Badge variant="secondary" className="text-xs">Em breve</Badge>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-semibold">Upload de Planilhas</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            Importe dados via planilhas CSV ou Excel com mapeamento automatico de campos.
          </p>
          <div className="border-2 border-dashed rounded-lg p-8 text-center">
            <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm font-medium mb-1">Arraste arquivos aqui</p>
            <p className="text-xs text-muted-foreground mb-4">CSV, XLS, XLSX (max 10MB)</p>
            <Button variant="secondary" className="gap-2">
              <Upload className="w-4 h-4" />
              Selecionar Arquivo
            </Button>
          </div>

          <div className="mt-6 space-y-2">
            <h3 className="text-sm font-semibold mb-3">Dados Importaveis</h3>
            {["Clientes", "Contratos", "Faturas", "Equipamentos"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
