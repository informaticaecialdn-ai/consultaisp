/**
 * Spec 008.5 Batch 4 — UI Superadmin para MCP bearer tokens.
 *
 * Permite criar/listar/revogar tokens que os Managed Agents da Anthropic
 * Platform usam pra invocar tools MCP no servidor Provedor.ai.
 *
 * Token é mostrado UMA VEZ na criação — depois disso só hash + prefix
 * persistem. Operador precisa copiar e cadastrar manualmente no Vault.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Bot, Copy, ExternalLink, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";

const MCP_SCOPE_OPTIONS = [
  { value: "read", label: "read", description: "Listar inadimplentes, faturas, testar conexão (PII mascarada)" },
  { value: "read_pii", label: "read_pii", description: "Permite erp_get_customer com unmasked=true (CPF/nome/telefone reais)" },
] as const;

interface ProviderOption { id: number; name: string }
interface BearerTokenRow {
  id: number;
  providerId: number;
  tokenPrefix: string;
  name: string;
  allowedScopes: string[];
  allowedTools: string[] | null;
  createdByUserId: number | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface CreateTokenResponse {
  token: string;
  record: BearerTokenRow;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function McpTokensSection() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: providers = [] } = useQuery<ProviderOption[]>({
    queryKey: ["/api/admin/providers"],
  });

  const { data: tokens = [], isLoading } = useQuery<BearerTokenRow[]>({
    queryKey: ["/api/admin/mcp/tokens"],
  });

  const [showCreate, setShowCreate] = useState(false);
  const [revealedToken, setRevealedToken] = useState<CreateTokenResponse | null>(null);
  const [formProviderId, setFormProviderId] = useState<string>("");
  const [formName, setFormName] = useState("");
  const [formScopes, setFormScopes] = useState<string[]>(["read"]);

  const providerLookup = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of providers) map.set(p.id, p.name);
    return map;
  }, [providers]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/mcp/tokens", {
        providerId: parseInt(formProviderId, 10),
        name: formName.trim(),
        allowedScopes: formScopes,
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(typeof body.message === "string" ? body.message : "Falha ao criar token");
      }
      return res.json() as Promise<CreateTokenResponse>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/mcp/tokens"] });
      setRevealedToken(data);
      setShowCreate(false);
      setFormName("");
      setFormScopes(["read"]);
      setFormProviderId("");
      toast({ title: "Token MCP criado" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao criar token", description: err.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/admin/mcp/tokens/${id}/revoke`);
      if (!res.ok) throw new Error("Falha ao revogar");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/mcp/tokens"] });
      toast({ title: "Token revogado" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao revogar", description: err.message, variant: "destructive" });
    },
  });

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: `${label} copiado` });
    });
  }

  const canCreate = !!formProviderId && formName.trim().length > 0 && formScopes.length > 0;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2 text-sm mb-1">
            <Bot className="w-4 h-4" />MCP Tokens (Anthropic Platform)
          </h3>
          <p className="text-xs text-[var(--color-muted)] max-w-2xl leading-relaxed">
            Bearer tokens para os 10 funcionários digitais (Managed Agents) acessarem dados ERP via{" "}
            <code className="text-[10px] bg-[var(--color-tag-bg)] px-1 py-0.5 rounded">
              {window.location.origin}/mcp/erp
            </code>
            . Gere aqui, cadastre como credential <code className="text-[10px]">static_bearer</code> no Vault da plataforma.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="btn-create-mcp-token">
          <Plus className="w-4 h-4 mr-1" />Novo token
        </Button>
      </div>

      {isLoading && <p className="text-xs text-[var(--color-muted)]">Carregando tokens...</p>}

      {!isLoading && tokens.length === 0 && (
        <div className="text-center py-8 text-xs text-[var(--color-muted)]">
          Nenhum token criado ainda. Clique "Novo token" para gerar o primeiro.
        </div>
      )}

      {tokens.length > 0 && (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 py-2.5 border-b last:border-0"
              data-testid={`mcp-token-row-${t.id}`}
            >
              <KeyRound className="w-4 h-4 text-[var(--color-muted)] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium truncate">{t.name}</span>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {t.tokenPrefix}***
                  </Badge>
                  {t.revokedAt ? (
                    <Badge className="text-[10px] bg-[var(--color-danger-bg)] text-[var(--color-danger)]">
                      Revogado
                    </Badge>
                  ) : (
                    <Badge className="text-[10px] bg-[var(--color-success-bg)] text-[var(--color-success)]">
                      Ativo
                    </Badge>
                  )}
                </div>
                <div className="text-[10px] text-[var(--color-muted)] flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span>Provedor: {providerLookup.get(t.providerId) ?? `#${t.providerId}`}</span>
                  <span>Scopes: {t.allowedScopes.join(", ")}</span>
                  <span>Criado: {formatDate(t.createdAt)}</span>
                  <span>Último uso: {formatDate(t.lastUsedAt)}</span>
                </div>
              </div>
              {!t.revokedAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Revogar o token "${t.name}"? Esta ação não pode ser desfeita.`)) {
                      revokeMutation.mutate(t.id);
                    }
                  }}
                  data-testid={`btn-revoke-mcp-token-${t.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5 text-[var(--color-danger)]" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal: Criar token */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo MCP Token</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">Provedor (tenant)</Label>
              <Select value={formProviderId} onValueChange={setFormProviderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Nome descritivo</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ex: Bruno production agent · Vertical Fibra"
              />
            </div>
            <div>
              <Label className="text-xs mb-2 block">Scopes permitidos</Label>
              <div className="space-y-2">
                {MCP_SCOPE_OPTIONS.map((opt) => {
                  const checked = formScopes.includes(opt.value);
                  return (
                    <label
                      key={opt.value}
                      className="flex items-start gap-2 p-2 border border-[var(--color-border)] rounded cursor-pointer hover:bg-[var(--color-tag-bg)]"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(c) => {
                          if (c) {
                            setFormScopes(Array.from(new Set([...formScopes, opt.value])));
                          } else {
                            setFormScopes(formScopes.filter((s) => s !== opt.value));
                          }
                        }}
                      />
                      <div className="flex-1">
                        <span className="text-sm font-mono">{opt.label}</span>
                        <p className="text-[10px] text-[var(--color-muted)]">{opt.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!canCreate || createMutation.isPending}
              data-testid="btn-submit-create-mcp-token"
            >
              <KeyRound className="w-4 h-4 mr-1" />Gerar token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Token revelado UMA VEZ */}
      <Dialog
        open={!!revealedToken}
        onOpenChange={(open) => {
          if (!open) setRevealedToken(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[var(--color-success)]" />
              Token criado — copie agora
            </DialogTitle>
          </DialogHeader>
          {revealedToken && (
            <div className="space-y-3 py-2">
              <div className="bg-[var(--color-brand-amber-100)] border border-[var(--color-brand-amber-500)]/40 rounded p-3">
                <p className="text-xs text-[var(--color-brand-amber-700)] font-medium leading-relaxed">
                  Este token será mostrado UMA ÚNICA VEZ. Depois que você fechar esta janela,
                  não há como recuperá-lo — apenas regenerar.
                </p>
              </div>

              <div>
                <Label className="text-xs">Token completo</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={revealedToken.token}
                    className="font-mono text-xs"
                    data-testid="revealed-mcp-token"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(revealedToken.token, "Token")}
                  >
                    <Copy className="w-3.5 h-3.5 mr-1" />Copiar
                  </Button>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <p className="font-semibold">Próximos passos:</p>
                <ol className="list-decimal list-inside space-y-1 text-[var(--color-muted)]">
                  <li>Acesse <a className="text-[var(--color-brand-green-700)] underline inline-flex items-center gap-1" href="https://platform.claude.com/" target="_blank" rel="noreferrer">platform.claude.com<ExternalLink className="w-3 h-3" /></a> → Workspace → Vaults</li>
                  <li>Crie/use um Vault para o tenant <strong>{providerLookup.get(revealedToken.record.providerId) ?? "—"}</strong></li>
                  <li>
                    Adicione credential <code className="bg-[var(--color-tag-bg)] px-1 rounded">static_bearer</code>:
                    <br />URL: <code className="bg-[var(--color-tag-bg)] px-1 rounded">{window.location.origin}/mcp/erp</code>
                    <br />Token: cole acima
                  </li>
                  <li>Vincule o Vault à session do agent (Bruno/Helena/etc) que vai usar esses dados ERP</li>
                </ol>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setRevealedToken(null)}>Copiei e guardei</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
