import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, STALE_LISTS } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Bot, User, ArrowRightLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const AGENTE_COLORS: Record<string, string> = {
  sofia: "#f472b6",
  leo: "#fbbf24",
  carlos: "#34d399",
  lucas: "#60a5fa",
  rafael: "#a78bfa",
  marcos: "#f59e0b",
};

const CLASSIFICACAO_BADGE: Record<string, string> = {
  frio: "bg-slate-100 text-slate-700",
  morno: "bg-yellow-100 text-yellow-800",
  quente: "bg-orange-100 text-orange-800",
  ultra_quente: "bg-red-100 text-red-800",
};

export default function CrmConversasTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [agentKey, setAgentKey] = useState("carlos");

  const { data: leadsData } = useQuery<any>({
    queryKey: ["/api/crm/leads?limit=100"],
    staleTime: STALE_LISTS,
  });
  const leads = leadsData?.leads || [];

  const { data: leadDetail, refetch: refetchDetail } = useQuery<any>({
    queryKey: ["/api/crm/leads/" + selectedLeadId],
    enabled: selectedLeadId !== null,
  });

  const sendMessage = useMutation({
    mutationFn: async (data: { leadId: number; message: string; agentKey: string }) => {
      const res = await apiRequest("POST", "/api/crm/send", data);
      return res.json();
    },
    onSuccess: (result) => {
      setMessage("");
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      qc.invalidateQueries({ queryKey: ["/api/crm/stats"] });

      if (result.handoff) {
        toast({
          title: `Handoff: ${result.handoff.de} → ${result.handoff.para}`,
          description: result.handoff.motivo,
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
    },
  });

  const handleSend = () => {
    if (!selectedLeadId || !message.trim()) return;
    sendMessage.mutate({ leadId: selectedLeadId, message: message.trim(), agentKey });
  };

  const conversas = leadDetail?.conversas || [];

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)]">
      {/* Left: Lead list */}
      <div className="w-72 flex-shrink-0 overflow-y-auto border rounded-lg">
        <div className="p-3 border-b font-medium text-sm">Leads ({leads.length})</div>
        {leads.map((lead: any) => (
          <div
            key={lead.id}
            onClick={() => {
              setSelectedLeadId(lead.id);
              setAgentKey(lead.agenteAtual || "carlos");
            }}
            className={`p-3 border-b cursor-pointer hover:bg-muted/30 transition-colors ${
              selectedLeadId === lead.id ? "bg-muted/50" : ""
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="font-medium text-sm truncate">{lead.nome || lead.telefone}</span>
              <Badge className={`text-xs ${CLASSIFICACAO_BADGE[lead.classificacao] || ""}`}>
                {lead.classificacao}
              </Badge>
            </div>
            <div className="flex justify-between items-center mt-1">
              <span className="text-xs text-muted-foreground">{lead.provedor || "Sem provedor"}</span>
              <span className="text-xs capitalize" style={{ color: AGENTE_COLORS[lead.agenteAtual] }}>
                {lead.agenteAtual}
              </span>
            </div>
          </div>
        ))}
        {leads.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">Nenhum lead</p>
        )}
      </div>

      {/* Right: Chat view */}
      <div className="flex-1 flex flex-col border rounded-lg">
        {selectedLeadId === null ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Selecione um lead para conversar
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{leadDetail?.nome || "Lead"}</span>
                <span className="text-sm text-muted-foreground">{leadDetail?.telefone}</span>
                {leadDetail && (
                  <Badge className={`text-xs ${CLASSIFICACAO_BADGE[leadDetail.classificacao] || ""}`}>
                    Score: {leadDetail.scoreTotal}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Agente:</span>
                <Select value={agentKey} onValueChange={setAgentKey}>
                  <SelectTrigger className="w-[130px] h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["sofia", "leo", "carlos", "lucas", "rafael", "marcos"].map((a) => (
                      <SelectItem key={a} value={a} className="capitalize">
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {conversas.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">
                  Nenhuma conversa. Envie a primeira mensagem.
                </p>
              ) : (
                conversas.map((c: any) => (
                  <div
                    key={c.id}
                    className={`flex gap-2 ${c.direcao === "enviada" ? "justify-end" : "justify-start"}`}
                  >
                    {c.direcao === "recebida" && (
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                    <div
                      className={`max-w-[70%] rounded-lg p-3 text-sm ${
                        c.direcao === "enviada"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      {c.direcao === "enviada" && (
                        <div className="text-xs opacity-70 mb-1 capitalize flex items-center gap-1">
                          <Bot className="w-3 h-3" /> {c.agente}
                        </div>
                      )}
                      <p className="whitespace-pre-wrap">{c.mensagem}</p>
                      <p className="text-xs opacity-50 mt-1">
                        {c.criadoEm ? new Date(c.criadoEm).toLocaleString("pt-BR") : ""}
                      </p>
                    </div>
                    {c.direcao === "enviada" && (
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: AGENTE_COLORS[c.agente] || "#64748b" }}
                      >
                        <Bot className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                ))
              )}

              {sendMessage.isPending && (
                <div className="flex justify-end gap-2">
                  <div className="bg-muted rounded-lg p-3 text-sm animate-pulse">
                    Agente pensando...
                  </div>
                </div>
              )}
            </div>

            {/* Send bar */}
            <div className="p-3 border-t flex gap-2">
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Digite a mensagem do lead (simulando o que ele disse)..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={sendMessage.isPending}
              />
              <Button onClick={handleSend} disabled={sendMessage.isPending || !message.trim()}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
