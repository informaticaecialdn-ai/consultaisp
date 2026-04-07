import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

interface Props {
  open: boolean;
  accepted: boolean;
  onAccept: () => void;
  onCancel: () => void;
  onToggle: (checked: boolean) => void;
}

export default function LgpdDisclaimerModal({ open, accepted, onAccept, onCancel, onToggle }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-[520px]" data-testid="dialog-lgpd-disclaimer">
        <div className="text-center mb-4">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">
            <Lock className="w-6 h-6 text-blue-600" />
          </div>
          <DialogTitle className="text-lg font-bold text-slate-900">Aviso Legal — LGPD</DialogTitle>
          <p className="text-sm text-slate-500 mt-1">Antes de prosseguir com a consulta na rede colaborativa</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2.5 text-sm">
          <div className="flex gap-2"><span className="font-semibold text-slate-500 min-w-[100px]">Base Legal:</span><span className="text-slate-700">Legitimo Interesse (LGPD Art. 7, IX)</span></div>
          <div className="flex gap-2"><span className="font-semibold text-slate-500 min-w-[100px]">Finalidade:</span><span className="text-slate-700">Analise de credito e protecao ao credito no ambito de telecomunicacoes</span></div>
          <div className="flex gap-2"><span className="font-semibold text-slate-500 min-w-[100px]">Dados tratados:</span><span className="text-slate-700">Indicadores de adimplencia anonimizados. Dados pessoais mascarados conforme LGPD.</span></div>
        </div>
        <div className="flex items-start gap-2.5 mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <input
            type="checkbox"
            id="lgpd-accept"
            checked={accepted}
            onChange={(e) => onToggle(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-blue-300"
            data-testid="lgpd-accept-checkbox"
          />
          <label htmlFor="lgpd-accept" className="text-xs text-blue-800 leading-relaxed cursor-pointer">
            Declaro que esta consulta tem finalidade legitima de analise de credito e estou ciente das obrigacoes da LGPD quanto ao tratamento dos dados obtidos.
          </label>
        </div>
        <div className="flex gap-3 mt-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            data-testid="lgpd-cancel-btn"
          >
            Cancelar
          </Button>
          <Button
            className="flex-1 bg-blue-600 hover:bg-blue-700"
            disabled={!accepted}
            onClick={onAccept}
            data-testid="lgpd-accept-btn"
          >
            Prosseguir com Consulta
          </Button>
        </div>
        <p className="text-center text-[11px] text-slate-400 mt-2">Lei n 13.709/2018 - LGPD - Versao 2.0</p>
      </DialogContent>
    </Dialog>
  );
}
