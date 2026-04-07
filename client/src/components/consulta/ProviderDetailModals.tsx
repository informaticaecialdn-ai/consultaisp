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
  const statusCls = d.daysOverdue === 0 ? "bg-emerald-100 text-emerald-700"
    : d.daysOverdue <= 30 ? "bg-orange-100 text-orange-700"
    : "bg-red-100 text-red-700";
  const hasOverdue = isOwn ? (d.overdueAmount || 0) > 0 : false;

  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
        {/* Financeiro */}
        <div className="p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <CreditCard className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Financeiro</span>
          </div>
          <div className="space-y-2.5">
            <div>
              <p className="text-[10px] text-slate-400 mb-0.5">Status de pagamento</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>{d.status}</span>
            </div>
            {d.daysOverdue > 0 && (
              <div>
                <p className="text-[10px] text-slate-400">Dias em atraso</p>
                <p className="text-sm font-bold text-red-600">{d.daysOverdue} dias</p>
              </div>
            )}
            {isOwn && hasOverdue && (
              <div>
                <p className="text-[10px] text-slate-400">Valor em aberto</p>
                <p className="text-base font-black text-red-600">
                  R$ {(d.overdueAmount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}
            {!isOwn && d.overdueAmountRange && (
              <div>
                <p className="text-[10px] text-slate-400">Faixa de valor</p>
                <p className="text-sm text-slate-700">{d.overdueAmountRange}</p>
              </div>
            )}
            {d.overdueInvoicesCount > 0 && (
              <div>
                <p className="text-[10px] text-slate-400">Faturas em atraso</p>
                <p className="text-sm font-semibold text-slate-700">{d.overdueInvoicesCount} fatura(s)</p>
              </div>
            )}
            {!hasOverdue && d.daysOverdue === 0 && (
              <div className="flex items-center gap-1.5 mt-1">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span className="text-sm text-emerald-700 font-medium">Sem pendencias</span>
              </div>
            )}
          </div>
        </div>

        {/* Contrato */}
        <div className="p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contrato</span>
          </div>
          <div className="space-y-2.5">
            <div>
              <p className="text-[10px] text-slate-400">Tempo de servico</p>
              <p className="text-sm font-semibold text-slate-800">{contractMonths} {contractMonths === 1 ? "mes" : "meses"}</p>
            </div>
            {isOwn ? (
              <>
                <div>
                  <p className="text-[10px] text-slate-400">Status do contrato</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusContrato === "Ativo" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                    {statusContrato}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">Cliente</p>
                  <p className="text-sm font-semibold text-slate-800">{d.customerName}</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-[10px] text-slate-400">Provedor</p>
                  <p className="text-sm font-semibold text-slate-800">{d.providerName}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">Cliente</p>
                  <span className="flex items-center gap-1 text-xs text-slate-400"><Lock className="w-3 h-3" /> Dado restrito</span>
                </div>
              </>
            )}
            {d.cancelledDate && (
              <div>
                <p className="text-[10px] text-slate-400">Data cancelamento</p>
                <p className="text-xs text-slate-600">{new Date(d.cancelledDate).toLocaleDateString("pt-BR")}</p>
              </div>
            )}
          </div>
        </div>

        {/* Equipamentos */}
        <div className={`p-4 ${d.hasUnreturnedEquipment ? "bg-amber-50/60" : ""}`}>
          <div className="flex items-center gap-1.5 mb-3">
            <Router className={`w-3.5 h-3.5 ${d.hasUnreturnedEquipment ? "text-amber-500" : "text-slate-400"}`} />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Equipamentos</span>
          </div>
          {d.hasUnreturnedEquipment ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <p className="text-xs font-bold text-amber-700">{d.unreturnedEquipmentCount} nao devolvido(s)</p>
              </div>
              {isOwn && d.equipmentDetails ? (
                <div className="space-y-1.5 mt-2">
                  {d.equipmentDetails.map((eq: any, j: number) => (
                    <div key={j} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-700 flex-1 truncate">{eq.type} {eq.brand} {eq.model}</span>
                      <span className="text-xs font-semibold text-slate-800 flex-shrink-0">
                        R$ {parseFloat(eq.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                  <div className="pt-1.5 border-t border-amber-200 flex justify-between">
                    <span className="text-xs font-bold text-amber-700">Total</span>
                    <span className="text-xs font-black text-amber-700">
                      R$ {totalEqp.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              ) : !isOwn ? (
                <span className="flex items-center gap-1 text-xs text-slate-400 mt-1"><Lock className="w-3 h-3" /> Detalhes restritos</span>
              ) : (
                <p className="text-xs text-slate-600">{d.equipmentPendingSummary}</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span className="text-sm text-emerald-700 font-medium">Todos devolvidos</span>
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
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-900">Consulta Gratuita</DialogTitle>
                <p className="text-xs text-slate-500 mt-0.5">{selectedFreeDetail?.providerName} — Seu Provedor</p>
              </div>
              <span className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                Gratuita — Sem Custo
              </span>
            </div>
          </DialogHeader>
          {selectedFreeDetail && (() => {
            const d = selectedFreeDetail;
            const statusCls = d.daysOverdue === 0 ? "bg-emerald-100 text-emerald-700"
              : d.daysOverdue <= 30 ? "bg-orange-100 text-orange-700"
              : "bg-red-100 text-red-700";
            return (
              <div className="space-y-4 mt-2">
                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="w-9 h-9 rounded-full bg-white border border-blue-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-black text-blue-700">{getInitials(d.customerName)}</span>
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 text-sm" data-testid="free-dialog-customer-name">{d.customerName}</p>
                    <p className="text-xs text-slate-500">Cliente do seu provedor</p>
                  </div>
                  <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>
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
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-900">Consulta Paga</DialogTitle>
                <p className="text-xs text-slate-500 mt-0.5">{selectedPaidDetail?.providerName} — Outro Provedor</p>
              </div>
              <span className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                1 Credito Debitado
              </span>
            </div>
          </DialogHeader>
          {selectedPaidDetail && (() => {
            const d = selectedPaidDetail;
            const statusCls = d.daysOverdue === 0 ? "bg-emerald-100 text-emerald-700"
              : d.daysOverdue <= 30 ? "bg-orange-100 text-orange-700"
              : "bg-red-100 text-red-700";
            return (
              <div className="space-y-4 mt-2">
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                    <Lock className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-700 text-sm">Dados Restritos</p>
                    <p className="text-xs text-slate-500">Informacoes parciais — cliente de outro provedor</p>
                  </div>
                  <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>
                    {d.daysOverdue === 0 ? "Em dia" : `${d.daysOverdue} dias atraso`}
                  </span>
                </div>
                <DetailGrid d={d} isOwn={false} />
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-700">
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
