import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  QrCode, Copy, ExternalLink, RefreshCw, Clock, CheckCheck,
  XCircle, ArrowRight, Search, Shield, IdCard, X,
} from "lucide-react";
import { Kicker, pillStyle, ReportSection, Th, type Tone } from "@/components/consulta/report-ui";
import { CREDIT_PACKAGES, CUSTO_EM_CREDITOS } from "@shared/schema";

/**
 * COMPRAR CRÉDITOS — crédito único, válido para toda consulta.
 *
 * A tela vendia "créditos universais" e o sistema tinha três bolsos separados;
 * o resultado é que o provedor via saldo de 187 e a Consulta Cadastral dizia
 * "saldo insuficiente, você tem 0", porque debitava de outro bolso. Agora há um
 * saldo só, em `providers.isp_credits`.
 *
 * Os pacotes e o custo de cada consulta vêm de `shared/schema.ts`. Estavam
 * duplicados aqui como constante local, e a cópia divergiu da do servidor — que
 * é como uma tela passa a anunciar um preço que a rota não cobra.
 */

/** Quanto cada consulta consome. O crédito vale R$ 1,00, então é o preço. */
const CONSULTAS = [
  { id: "isp", nome: "Consulta ISP", icone: Search,
    descricao: "Rede colaborativa de provedores", custo: CUSTO_EM_CREDITOS.isp },
  { id: "cadastral", nome: "Consulta Cadastral", icone: IdCard,
    descricao: "Receita, endereço, renda e inadimplência", custo: CUSTO_EM_CREDITOS.cadastral },
  { id: "spc", nome: "Consulta SPC", icone: Shield,
    descricao: "Negativação formal", custo: CUSTO_EM_CREDITOS.spc },
];

const STATUS: Record<string, { rotulo: string; tom: Tone; Icone: any }> = {
  pending:   { rotulo: "aguardando pagamento", tom: "gated",   Icone: Clock },
  paid:      { rotulo: "créditos liberados",   tom: "ok",      Icone: CheckCheck },
  cancelled: { rotulo: "cancelado",            tom: "neutral", Icone: XCircle },
  overdue:   { rotulo: "vencido",              tom: "danger",  Icone: XCircle },
};

const brl = (v: number | string) =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const GRID_PEDIDOS = "minmax(120px,1fr) 150px minmax(90px,1fr) 110px 76px";

/* ── Peças locais em token puro ─────────────────────────────── */

function Botao({ children, onClick, variant = "ghost", disabled, testId, full }: {
  children: React.ReactNode; onClick?: () => void;
  variant?: "ghost" | "primary"; disabled?: boolean; testId?: string; full?: boolean;
}) {
  const p = variant === "primary";
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} data-testid={testId} className="ds-ctl"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
        width: full ? "100%" : undefined, height: 38, padding: "0 16px", borderRadius: 8,
        fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
        background: p ? "var(--action)" : "var(--surface)",
        color: p ? "var(--text-on-brand)" : "var(--text-2)",
        border: p ? "none" : "1px solid var(--border-strong)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/** Ícone de ação de 28px em linha de tabela — alvo pequeno, uso pontual. */
function IconeAcao({ children, onClick, title, href, testId }: {
  children: React.ReactNode; onClick?: () => void; title: string; href?: string; testId?: string;
}) {
  const estilo = {
    width: 28, height: 28, display: "inline-flex", alignItems: "center",
    justifyContent: "center", borderRadius: 4, color: "var(--text-muted)",
    background: "transparent", border: "none", cursor: "pointer",
  } as const;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title={title} style={estilo} className="ds-ctl">
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} style={estilo} className="ds-ctl" data-testid={testId}>
      {children}
    </button>
  );
}

function Modal({ titulo, sub, onClose, children, testId }: {
  titulo: string; sub?: string; onClose: () => void;
  children: React.ReactNode; testId?: string;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        data-testid={testId}
        style={{
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
          width: "100%", maxWidth: 420, overflow: "hidden",
          boxShadow: "0 0 0 1px var(--border), 0 12px 32px -14px rgba(20,19,26,.20)",
        }}
      >
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "var(--track-tight)", color: "var(--text)" }}>
              {titulo}
            </div>
            {sub && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{sub}</div>}
          </div>
          <IconeAcao onClick={onClose} title="Fechar"><X size={15} /></IconeAcao>
        </div>
        <div style={{ padding: "18px 20px" }}>{children}</div>
      </div>
    </div>
  );
}

export default function CreditosPage() {
  const { provider } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [pacoteEscolhido, setPacoteEscolhido] = useState<any>(null);
  const [modalPagar, setModalPagar] = useState<{ order: any; charge: any } | null>(null);
  const [modalPix, setModalPix] = useState<{ pixData: any } | null>(null);

  const { data: orders = [], isLoading: carregandoPedidos } = useQuery<any[]>({
    queryKey: ["/api/credits/orders"],
  });

  const compra = useMutation({
    mutationFn: async ({ packageId, billingType }: { packageId: string; billingType: string }) => {
      const res = await apiRequest("POST", "/api/credits/purchase", { packageId, billingType });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/credits/orders"] });
      qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setPacoteEscolhido(null);
      setModalPagar(data);
      toast({ title: "Pedido criado" });
    },
    onError: (e: any) => toast({ title: "Não foi possível criar o pedido", description: e.message, variant: "destructive" }),
  });

  const pix = useMutation({
    mutationFn: async (orderId: number) => {
      const res = await apiRequest("GET", `/api/credits/orders/${orderId}/asaas/pix`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => setModalPix({ pixData: data }),
    onError: (e: any) => toast({ title: "Não foi possível buscar o PIX", description: e.message, variant: "destructive" }),
  });

  // O saldo é UM só. Somar isp + spc era o resto do modelo de três bolsos e
  // mostrava um número que nenhuma consulta debitava por inteiro.
  const saldo = provider?.ispCredits ?? 0;
  const pendentes = orders.filter(o => o.status === "pending" || o.status === "overdue");

  /** Quantas consultas de cada tipo o saldo ainda paga. */
  const rende = (custo: number) => Math.floor(saldo / custo);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ═══ CABEÇALHO + SALDO ═══ */}
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, overflow: "hidden",
      }}>
        <div style={{
          padding: "20px 24px", display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", gap: 20, flexWrap: "wrap",
        }}>
          <div>
            <Kicker>Créditos</Kicker>
            <h1 style={{
              fontSize: 22, fontWeight: 500, letterSpacing: "var(--track-tight)",
              margin: "6px 0 0", color: "var(--text)",
            }} data-testid="text-creditos-title">
              Comprar créditos
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, maxWidth: "58ch", lineHeight: 1.5 }}>
              Um crédito custa R$ 1,00 e vale para qualquer consulta do sistema.
              O que muda é quantos créditos cada uma consome.
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <Kicker>Saldo disponível</Kicker>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 42, fontWeight: 600, lineHeight: 1.05,
              fontVariantNumeric: "tabular-nums", marginTop: 6,
              color: saldo > 0 ? "var(--text)" : "var(--past)",
            }} data-testid="text-credits-balance">
              {saldo}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {saldo === 1 ? "crédito" : "créditos"}
            </div>
          </div>
        </div>

        {/* ═══ O QUE CADA CONSULTA CONSOME ═══ */}
        <ReportSection title="O que cada consulta consome">
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 12, marginTop: 14,
          }}>
            {CONSULTAS.map(c => (
              <div key={c.id} style={{
                background: "var(--surface-2)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "12px 14px",
              }} data-testid={`custo-${c.id}`}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <c.icone size={14} style={{ color: "var(--brand)", flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{c.nome}</span>
                  </div>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600,
                    fontVariantNumeric: "tabular-nums", color: "var(--text)", whiteSpace: "nowrap",
                  }}>
                    {brl(c.custo)}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 5, lineHeight: 1.45 }}>
                  {c.descricao}
                </div>
                <div style={{
                  marginTop: 9, paddingTop: 9, borderTop: "1px solid var(--border-faint)",
                  fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase",
                  letterSpacing: "var(--track-wide)", color: "var(--text-faint)",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {c.custo} crédito{c.custo > 1 ? "s" : ""} · seu saldo paga {rende(c.custo)}
                </div>
              </div>
            ))}
          </div>
        </ReportSection>
      </div>

      {/* ═══ PAGAMENTOS PENDENTES ═══ */}
      {pendentes.length > 0 && (
        <div style={{
          background: "var(--gated-bg)", border: "1px solid var(--gated-border)",
          borderRadius: 10, padding: "14px 18px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
            <Clock size={14} style={{ color: "var(--gated)" }} />
            <Kicker style={{ color: "var(--gated)" }}>
              {pendentes.length} pagamento{pendentes.length > 1 ? "s" : ""} aguardando
            </Kicker>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendentes.map((o: any) => (
              <div key={o.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                background: "var(--surface)", border: "1px solid var(--gated-border)",
                borderRadius: 8, padding: "9px 12px",
              }} data-testid={`pending-order-${o.id}`}>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: "var(--font-mono)", fontSize: 11.5, fontWeight: 600,
                    color: "var(--text)", fontVariantNumeric: "tabular-nums",
                  }}>
                    {o.orderNumber}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                    {o.packageName} · {brl(o.amount)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {o.asaasChargeId && (
                    <IconeAcao onClick={() => pix.mutate(o.id)} title="Ver QR Code PIX" testId={`button-pix-${o.id}`}>
                      {pix.isPending ? <RefreshCw size={14} className="animate-spin" /> : <QrCode size={14} />}
                    </IconeAcao>
                  )}
                  {o.asaasInvoiceUrl && (
                    <IconeAcao href={o.asaasInvoiceUrl} title="Abrir cobrança"><ExternalLink size={14} /></IconeAcao>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ PACOTES ═══ */}
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, overflow: "hidden",
      }}>
        <ReportSection
          title="Pacotes"
          trailing={<Kicker>Mesmo preço por crédito em todos</Kicker>}
          style={{ borderTop: "none" }}
        >
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5, maxWidth: "70ch" }}>
            O pacote maior não barateia a consulta — evita recarga. Preço de
            consulta que muda conforme o tamanho da compra é difícil de explicar
            no suporte e impossível de conferir numa fatura.
          </p>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(178px, 1fr))",
            gap: 12, marginTop: 16,
          }}>
            {CREDIT_PACKAGES.map((pkg: any) => (
              <button
                key={pkg.id}
                type="button"
                onClick={() => setPacoteEscolhido(pkg)}
                data-testid={`package-${pkg.id}`}
                className="ds-ctl"
                style={{
                  textAlign: "left", cursor: "pointer", background: "var(--surface)",
                  borderRadius: 8, padding: "15px 16px 16px", position: "relative",
                  fontFamily: "var(--font-sans)",
                  // O destaque é 2px em --brand; os demais mantêm a hairline.
                  border: pkg.popular
                    ? "2px solid var(--brand)"
                    : "1px solid var(--border)",
                }}
              >
                {pkg.popular && (
                  <span style={{ ...pillStyle("neutral"), position: "absolute", top: 11, right: 11, background: "var(--brand-soft)", color: "var(--brand-ink)", border: "1px solid var(--border-strong)" }}>
                    popular
                  </span>
                )}
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 600,
                  fontVariantNumeric: "tabular-nums", letterSpacing: "-.02em", color: "var(--text)",
                }}>
                  {pkg.credits}
                </div>
                <Kicker style={{ marginTop: 2 }}>créditos</Kicker>
                <div style={{
                  marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--border-faint)",
                  fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 600,
                  fontVariantNumeric: "tabular-nums", color: "var(--text)",
                }}>
                  {pkg.priceLabel}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>
                  {pkg.perUnit}
                </div>
                <div style={{
                  marginTop: 11, display: "inline-flex", alignItems: "center", gap: 6,
                  fontSize: 12, fontWeight: 600, color: "var(--action)",
                }}>
                  Comprar <ArrowRight size={13} />
                </div>
              </button>
            ))}
          </div>

          <p style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 14, lineHeight: 1.5 }}>
            Créditos não expiram. Pagamento por PIX compensa em até 5 minutos;
            por boleto, em até 3 dias úteis.
          </p>
        </ReportSection>
      </div>

      {/* ═══ HISTÓRICO ═══ */}
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, overflow: "hidden",
      }}>
        <ReportSection
          title="Histórico de pedidos"
          trailing={<Kicker>{orders.length} pedido{orders.length === 1 ? "" : "s"}</Kicker>}
          style={{ borderTop: "none" }}
        >
          {carregandoPedidos ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ height: 44, borderRadius: 8, background: "var(--surface-inset)" }} />
              ))}
            </div>
          ) : orders.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 14, lineHeight: 1.55 }}>
              Nenhum pedido ainda. Os créditos comprados aparecem aqui com o
              número do pedido e a situação do pagamento.
            </p>
          ) : (
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <div style={{ minWidth: 620 }}>
                <div style={{
                  display: "grid", gridTemplateColumns: GRID_PEDIDOS, gap: 10,
                  padding: "12px 0 8px", borderBottom: "1px solid var(--border-faint)",
                }}>
                  <Th>Pedido</Th><Th>Situação</Th><Th>Pacote</Th>
                  <Th right>Valor</Th><Th right>Ações</Th>
                </div>
                {orders.map((o: any) => {
                  const st = STATUS[o.status] ?? STATUS.pending;
                  return (
                    <div key={o.id} style={{
                      display: "grid", gridTemplateColumns: GRID_PEDIDOS, gap: 10,
                      alignItems: "center", padding: "11px 0",
                      borderBottom: "1px solid var(--border-faint)",
                    }} data-testid={`order-row-${o.id}`}>
                      <div>
                        <div style={{
                          fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600,
                          fontVariantNumeric: "tabular-nums", color: "var(--text)",
                        }}>
                          {o.orderNumber}
                        </div>
                        {o.createdAt && (
                          <div style={{
                            fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-muted)",
                            fontVariantNumeric: "tabular-nums", marginTop: 2,
                          }}>
                            {new Date(o.createdAt).toLocaleDateString("pt-BR")}
                          </div>
                        )}
                      </div>
                      <div>
                        <span style={pillStyle(st.tom)}><st.Icone size={11} /> {st.rotulo}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--text-2)", minWidth: 0 }}>
                        {o.packageName}
                      </div>
                      <div style={{
                        fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600,
                        fontVariantNumeric: "tabular-nums", textAlign: "right", color: "var(--text)",
                      }}>
                        {brl(o.amount)}
                      </div>
                      <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                        {o.status === "pending" && o.asaasChargeId && (
                          <IconeAcao onClick={() => pix.mutate(o.id)} title="QR Code PIX" testId={`button-history-pix-${o.id}`}>
                            <QrCode size={14} />
                          </IconeAcao>
                        )}
                        {o.asaasInvoiceUrl && (
                          <IconeAcao href={o.asaasInvoiceUrl} title="Abrir cobrança"><ExternalLink size={14} /></IconeAcao>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </ReportSection>
      </div>

      {/* ═══ MODAL: ESCOLHER FORMA DE PAGAMENTO ═══ */}
      {pacoteEscolhido && (
        <Modal
          titulo={`${pacoteEscolhido.credits} créditos`}
          sub={`${pacoteEscolhido.priceLabel} · ${pacoteEscolhido.perUnit}`}
          onClose={() => setPacoteEscolhido(null)}
          testId="modal-pagamento"
        >
          <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55, marginBottom: 16 }}>
            Escolha como pagar. Os créditos entram no saldo assim que o pagamento
            for compensado.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <Botao
              variant="primary" full
              disabled={compra.isPending}
              onClick={() => compra.mutate({ packageId: pacoteEscolhido.id, billingType: "PIX" })}
              testId="button-pay-pix"
            >
              <QrCode size={15} /> Pagar com PIX
            </Botao>
            <Botao
              full
              disabled={compra.isPending}
              onClick={() => compra.mutate({ packageId: pacoteEscolhido.id, billingType: "BOLETO" })}
              testId="button-pay-boleto"
            >
              Gerar boleto
            </Botao>
          </div>
        </Modal>
      )}

      {/* ═══ MODAL: PEDIDO CRIADO ═══ */}
      {modalPagar && (
        <Modal
          titulo="Pedido criado"
          sub={modalPagar.order?.orderNumber}
          onClose={() => setModalPagar(null)}
          testId="modal-pedido-criado"
        >
          {modalPagar.charge ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55, marginBottom: 5 }}>
                A cobrança está pronta. Os créditos entram no saldo depois da
                compensação.
              </p>
              {modalPagar.charge.billingType === "PIX" && (
                <Botao
                  variant="primary" full
                  onClick={() => { pix.mutate(modalPagar.order.id); setModalPagar(null); }}
                  testId="button-show-pix"
                >
                  <QrCode size={15} /> Ver QR Code
                </Botao>
              )}
              {modalPagar.charge.invoiceUrl && (
                <a href={modalPagar.charge.invoiceUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                  <Botao full><ExternalLink size={14} /> Abrir cobrança</Botao>
                </a>
              )}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55 }}>
              O pedido foi registrado, mas a cobrança automática não pôde ser
              gerada agora. Fale com o suporte informando o número do pedido.
            </p>
          )}
        </Modal>
      )}

      {/* ═══ MODAL: QR CODE PIX ═══ */}
      {modalPix && (
        <Modal titulo="Pagar com PIX" onClose={() => setModalPix(null)} testId="modal-pix">
          {modalPix.pixData?.encodedImage ? (
            <img
              src={`data:image/png;base64,${modalPix.pixData.encodedImage}`}
              alt="QR Code do PIX"
              style={{
                display: "block", margin: "0 auto", width: 196, height: 196,
                borderRadius: 8, border: "1px solid var(--border)",
              }}
            />
          ) : (
            <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
              QR Code indisponível. Use o código copia e cola abaixo.
            </p>
          )}
          {modalPix.pixData?.payload && (
            <div style={{ marginTop: 16 }}>
              <Kicker style={{ marginBottom: 7 }}>Copia e cola</Kicker>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <code style={{
                  flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 11,
                  background: "var(--surface-inset)", border: "1px solid var(--border)",
                  borderRadius: 4, padding: "7px 9px", color: "var(--text-2)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {modalPix.pixData.payload}
                </code>
                <Botao
                  onClick={() => {
                    navigator.clipboard.writeText(modalPix.pixData.payload);
                    toast({ title: "Código copiado" });
                  }}
                  testId="button-copy-pix"
                >
                  <Copy size={14} /> Copiar
                </Botao>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
