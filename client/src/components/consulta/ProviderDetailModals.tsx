import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, CreditCard, Clock, Router, AlertTriangle, Lock, Info } from "lucide-react";
import type { ProviderDetail } from "./types";
import { getInitials } from "./utils";

interface Props {
  freeDialogOpen: boolean;
  paidDialogOpen: boolean;
  selectedFreeDetail: ProviderDetail | null;
  selectedPaidDetail: ProviderDetail | null;
  onCloseFree: () => void;
  onClosePaid: () => void;
}

function DetailGrid({ d, isOwn }: { d: ProviderDetail; isOwn: boolean }) {
  const contractMonths = Math.max(1, Math.round(d.contractAgeDays / 30));
  const statusContrato = d.cancelledDate ? "Cancelado" : "Ativo";
  const totalEqp = d.equipmentDetails?.reduce((s: number, e: any) => s + parseFloat(e.value || "0"), 0) || 0;
  const statusCls = d.daysOverdue === 0 ? "bg-[var(--color-success-bg)] text-[var(--color-success)]"
    : d.daysOverdue <= 30 ? "bg-[var(--color-gold-bg)] text-[var(--color-gold)]"
    : "bg-[var(--color-danger-bg)] text-[var(--color-danger)]";
  const hasOverdue = isOwn ? (d.overdueAmount || 0) > 0 : false;

  return (
    <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] overflow-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--color-border)]">
        {/* Financeiro */}
        <div className="p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <CreditCard className="w-3.5 h-3.5 text-[var(--color-muted)]" />
            <span className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wider">Financeiro</span>
          </div>
          <div className="space-y-2.5">
            <div>
              <p className="text-[10px] text-[var(--color-muted)] mb-0.5">Status de pagamento</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-sm ${statusCls}`}>{d.status}</span>
            </div>
            {d.daysOverdue > 0 && (
              <div>
                <p className="text-[10px] text-[var(--color-muted)]">Dias em atraso</p>
                <p className="text-sm font-bold text-[var(--color-danger)]">{d.daysOverdue} dias</p>
              </div>
            )}
            {isOwn && hasOverdue && (
              <div>
                <p className="text-[10px] text-[var(--color-muted)]">Valor em aberto</p>
                <p className="text-base font-semibold text-[var(--color-danger)]">
                  R$ {(d.overdueAmount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}
            {!isOwn && d.overdueAmountRange && (
              <div>
                <p className="text-[10px] text-[var(--color-muted)]">Faixa de valor</p>
                <p className="text-sm text-[var(--color-ink)]">{d.overdueAmountRange}</p>
              </div>
            )}
            {d.overdueInvoicesCount > 0 && (
              <div>
                <p className="text-[10px] text-[var(--color-muted)]">Faturas em atraso</p>
                <p className="text-sm font-semibold text-[var(--color-ink)]">{d.overdueInvoicesCount} fatura(s)</p>
              </div>
            )}
            {!hasOverdue && d.daysOverdue === 0 && (
              <div className="flex items-center gap-1.5 mt-1">
                <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />
                <span className="text-sm text-[var(--color-success)] font-medium">Sem pendencias</span>
              </div>
            )}
          </div>
        </div>

        {/* Contrato */}
        <div className="p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Clock className="w-3.5 h-3.5 text-[var(--color-muted)]" />
            <span className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wider">Contrato</span>
          </div>
          <div className="space-y-2.5">
            <div>
              <p className="text-[10px] text-[var(--color-muted)]">Tempo de servico</p>
              <p className="text-sm font-semibold text-[var(--color-ink)]">{contractMonths} {contractMonths === 1 ? "mes" : "meses"}</p>
            </div>
            {isOwn ? (
              <>
                <div>
                  <p className="text-[10px] text-[var(--color-muted)]">Status do contrato</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-sm ${statusContrato === "Ativo" ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" : "bg-[var(--color-tag-bg)] text-[var(--color-muted)]"}`}>
                    {statusContrato}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--color-muted)]">Cliente</p>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">{d.customerName}</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-[10px] text-[var(--color-muted)]">Provedor</p>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">{d.providerName}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--color-muted)]">Cliente</p>
                  <span className="flex items-center gap-1 text-xs text-[var(--color-muted)]"><Lock className="w-3 h-3" /> Dado restrito</span>
                </div>
              </>
            )}
            {d.cancelledDate && (
              <div>
                <p className="text-[10px] text-[var(--color-muted)]">Data cancelamento</p>
                <p className="text-xs text-[var(--color-muted)]">{new Date(d.cancelledDate).toLocaleDateString("pt-BR")}</p>
              </div>
            )}
          </div>
        </div>

        {/* Equipamentos */}
        <div className={`p-4 ${d.hasUnreturnedEquipment ? "bg-[var(--color-gold-bg)]" : ""}`}>
          <div className="flex items-center gap-1.5 mb-3">
            <Router className={`w-3.5 h-3.5 ${d.hasUnreturnedEquipment ? "text-[var(--color-gold)]" : "text-[var(--color-muted)]"}`} />
            <span className="text-[10px] font-bold text-[var(--color-muted)] uppercase tracking-wider">Equipamentos</span>
          </div>
          {d.hasUnreturnedEquipment ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-[var(--color-gold)]" />
                <p className="text-xs font-bold text-[var(--color-gold)]">{d.unreturnedEquipmentCount} nao devolvido(s)</p>
              </div>
              {isOwn && d.equipmentDetails ? (
                <div className="space-y-1.5 mt-2">
                  {d.equipmentDetails.map((eq: any, j: number) => (
                    <div key={j} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[var(--color-ink)] flex-1 truncate">{eq.type} {eq.brand} {eq.model}</span>
                      <span className="text-xs font-semibold text-[var(--color-ink)] flex-shrink-0">
                        R$ {parseFloat(eq.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                  <div className="pt-1.5 border-t border-[var(--color-border)] flex justify-between">
                    <span className="text-xs font-bold text-[var(--color-gold)]">Total</span>
                    <span className="text-xs font-semibold text-[var(--color-gold)]">
                      R$ {totalEqp.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              ) : !isOwn ? (
                <span className="flex items-center gap-1 text-xs text-[var(--color-muted)] mt-1"><Lock className="w-3 h-3" /> Detalhes restritos</span>
              ) : (
                <p className="text-xs text-[var(--color-muted)]">{d.equipmentPendingSummary}</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />
              <span className="text-sm text-[var(--color-success)] font-medium">Todos devolvidos</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProviderDetailModals({ freeDialogOpen, paidDialogOpen, selectedFreeDetail, selectedPaidDetail, onCloseFree, onClosePaid }: Props) {
  return (
    <>
      {/* Free dialog */}
      <Dialog open={freeDialogOpen} onOpenChange={(o) => { if (!o) onCloseFree(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-consulta-gratuita">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--color-success-bg)] flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-5 h-5 text-[var(--color-success)]" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-[var(--color-ink)]">Consulta Gratuita</DialogTitle>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">{selectedFreeDetail?.providerName} — Seu Provedor</p>
              </div>
              <span className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-sm bg-[var(--color-success-bg)] text-[var(--color-success)]">
                Gratuita — Sem Custo
              </span>
            </div>
          </DialogHeader>
          {selectedFreeDetail && (() => {
            const d = selectedFreeDetail;
            const statusCls = d.daysOverdue === 0 ? "bg-[var(--color-success-bg)] text-[var(--color-success)]"
              : d.daysOverdue <= 30 ? "bg-[var(--color-gold-bg)] text-[var(--color-gold)]"
              : "bg-[var(--color-danger-bg)] text-[var(--color-danger)]";
            return (
              <div className="space-y-4 mt-2">
                <div className="flex items-center gap-3 p-3 bg-[var(--color-navy-bg)] rounded border border-[var(--color-border)]">
                  <div className="w-9 h-9 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-[var(--color-navy)]">{getInitials(d.customerName)}</span>
                  </div>
                  <div>
                    <p className="font-bold text-[var(--color-ink)] text-sm" data-testid="free-dialog-customer-name">{d.customerName}</p>
                    <p className="text-xs text-[var(--color-muted)]">Cliente do seu provedor</p>
                  </div>
                  <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-sm ${statusCls}`}>
                    {d.daysOverdue === 0 ? "Em dia" : `${d.daysOverdue} dias atraso`}
                  </span>
                </div>
                <DetailGrid d={d} isOwn={true} />
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={onCloseFree} data-testid="button-fechar-free-dialog">
                    Fechar
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Paid dialog */}
      <Dialog open={paidDialogOpen} onOpenChange={(o) => { if (!o) onClosePaid(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-consulta-paga">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--color-navy-bg)] flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-5 h-5 text-[var(--color-navy)]" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-[var(--color-ink)]">Consulta Paga</DialogTitle>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">{selectedPaidDetail?.providerName} — Outro Provedor</p>
              </div>
              <span className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-sm bg-[var(--color-navy-bg)] text-[var(--color-navy)]">
                1 Credito Debitado
              </span>
            </div>
          </DialogHeader>
          {selectedPaidDetail && (() => {
            const d = selectedPaidDetail;
            const statusCls = d.daysOverdue === 0 ? "bg-[var(--color-success-bg)] text-[var(--color-success)]"
              : d.daysOverdue <= 30 ? "bg-[var(--color-gold-bg)] text-[var(--color-gold)]"
              : "bg-[var(--color-danger-bg)] text-[var(--color-danger)]";
            return (
              <div className="space-y-4 mt-2">
                <div className="flex items-center gap-3 p-3 bg-[var(--color-bg)] rounded border border-[var(--color-border)]">
                  <div className="w-9 h-9 rounded-full bg-[var(--color-tag-bg)] flex items-center justify-center flex-shrink-0">
                    <Lock className="w-4 h-4 text-[var(--color-muted)]" />
                  </div>
                  <div>
                    <p className="font-bold text-[var(--color-ink)] text-sm">Dados Restritos</p>
                    <p className="text-xs text-[var(--color-muted)]">Informacoes parciais — cliente de outro provedor</p>
                  </div>
                  <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-sm ${statusCls}`}>
                    {d.daysOverdue === 0 ? "Em dia" : `${d.daysOverdue} dias atraso`}
                  </span>
                </div>
                <DetailGrid d={d} isOwn={false} />
                <div className="bg-[var(--color-navy-bg)] border border-[var(--color-border)] rounded p-3 flex items-start gap-2">
                  <Info className="w-4 h-4 text-[var(--color-navy)] flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-[var(--color-navy)]">
                    1 credito ISP foi debitado por este resultado. Dados completos somente disponiveis para clientes do proprio provedor.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={onClosePaid} data-testid="button-fechar-paid-dialog">
                    Fechar
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}
