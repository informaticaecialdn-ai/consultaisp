import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
} from "lucide-react";

export default function ImportacaoPage() {
  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto" data-testid="importacao-page">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center">
          <Upload className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-importacao-title">Importacao</h1>
          <p className="text-sm text-muted-foreground">Importe dados do seu ERP ou planilhas</p>
        </div>
      </div>

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
          <Button variant="secondary" className="gap-2" data-testid="button-selecionar-arquivo">
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
  );
}
