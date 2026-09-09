import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ShieldCheck } from "lucide-react";
import "./lgpd-disclaimer.css";

interface Props {
  open: boolean;
  accepted: boolean;
  onAccept: () => void;
  onCancel: () => void;
  onToggle: (checked: boolean) => void;
  purpose?: "credito" | "cadastro";
}

export default function LgpdDisclaimerModal({ open, accepted, onAccept, onCancel, onToggle, purpose = "credito" }: Props) {
  const credit = purpose === "credito";
  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="lgpd-dialog" data-testid="dialog-lgpd-disclaimer">
        <header>
          <span className="lgpd-icon"><ShieldCheck size={23} aria-hidden="true" /></span>
          <DialogTitle>Confirme a finalidade da consulta</DialogTitle>
          <DialogDescription className="lgpd-description">Você terá acesso a informações pessoais. Use os dados apenas para a finalidade informada abaixo.</DialogDescription>
        </header>
        <div className="lgpd-body">
          <dl className="lgpd-facts">
            <div><dt>Finalidade</dt><dd>{credit ? "Analisar o histórico na rede de provedores para apoiar uma decisão de crédito." : "Verificar dados cadastrais para analisar uma contratação."}</dd></div>
            <div><dt>Uso responsável</dt><dd>Restrinja o acesso à equipe autorizada e não compartilhe os dados para outras finalidades.</dd></div>
            <div><dt>Referência legal</dt><dd>{credit ? "Proteção do crédito · LGPD, art. 7º, X." : "Legítimo interesse · LGPD, art. 7º, IX, observados os direitos do titular."}</dd></div>
          </dl>
          <label className="lgpd-confirm">
            <input type="checkbox" checked={accepted} onChange={(event) => onToggle(event.target.checked)} data-testid="lgpd-accept-checkbox" />
            <span>{credit ? "Confirmo que esta consulta é para análise de crédito e me responsabilizo pelo uso adequado dos dados." : "Confirmo que esta consulta é para análise de contratação e me responsabilizo pelo uso adequado dos dados."}</span>
          </label>
        </div>
        <footer>
          <div className="lgpd-actions">
            <button type="button" onClick={onCancel} data-testid="lgpd-cancel-btn">Voltar</button>
            <button type="button" className="lgpd-primary" disabled={!accepted} onClick={onAccept} data-testid="lgpd-accept-btn">Confirmar e consultar</button>
          </div>
          <a href="/lgpd" target="_blank" rel="noopener noreferrer">Política de privacidade ↗</a>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
