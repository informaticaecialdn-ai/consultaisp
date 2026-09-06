import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { QrCode, RefreshCw } from "lucide-react";
import { EstadoDaConexaoWhatsappSchema, type EstadoDaConexaoWhatsapp, type ProvedorWhatsapp } from "@shared/chat-whatsapp";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, CONTROLE_CAMPO } from "@/components/painel/ui";
import { mensagemDoErro, SeloCobranca } from "@/components/cobranca/ui";

export function ConexaoWhatsapp({ provider, podeAdministrar }: { provider: ProvedorWhatsapp; podeAdministrar: boolean }) {
  const [estado, setEstado] = useState<EstadoDaConexaoWhatsapp | null>(null);
  const [telefone, setTelefone] = useState("");
  const [modo, setModo] = useState<"qr" | "codigo">("qr");
  const acao = useMutation({
    mutationFn: async (tipo: "consultar" | "conectar") => {
      const r = await apiRequest(tipo === "consultar" ? "GET" : "POST", `/api/chat-bullq/integracao/canal/${tipo === "consultar" ? "conexao" : "conectar"}`, tipo === "consultar" ? undefined : modo === "qr" ? {} : { phone: telefone.replace(/\D/g, "") });
      return EstadoDaConexaoWhatsappSchema.parse(await r.json());
    },
    onMutate: () => { setEstado(e => e ? { ...e, qrCode: null, pairCode: null } : e); },
    onSuccess: async (r) => { setEstado(r); await queryClient.invalidateQueries({ queryKey: ["/api/chat-bullq/integracao"] }); },
    retry: false,
  });
  useEffect(() => {
    if (!estado?.qrCode && !estado?.pairCode) return;
    const id = window.setTimeout(() => setEstado(e => e ? { ...e, qrCode: null, pairCode: null } : e), 120_000);
    return () => window.clearTimeout(id);
  }, [estado?.qrCode, estado?.pairCode]);
  if (!podeAdministrar) return <p className="text-xs text-[var(--text-muted)]">O administrador pode consultar e parear este número.</p>;
  const oficial = provider === "DATAFY";
  return <div className="space-y-3 border-t border-[var(--border)] pt-4" data-testid="chat-conexao-whatsapp">
    <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-medium">Conexão · {provider}</h4>{estado && <SeloCobranca tom={estado.connected && estado.loggedIn ? "ok" : "gated"}>{estado.connected && estado.loggedIn ? "conectado" : estado.status === "connecting" ? "aguardando pareamento" : "desconectado"}</SeloCobranca>}</div>
    <p className="text-xs leading-5 text-[var(--text-muted)]">{oficial ? "O número é conectado no painel Datafy. Verifique aqui se o token permite acesso ao número informado." : "Escaneie o QR em WhatsApp → Aparelhos conectados → Conectar aparelho. Também é possível parear usando o número."}</p>
    {!oficial && <div className="flex flex-wrap items-end gap-3"><label className="space-y-1 text-xs"><span className="block">Forma de conexão</span><select className={CONTROLE_CAMPO} value={modo} onChange={e => { setModo(e.target.value as "qr" | "codigo"); setEstado(null); }}><option value="qr">QR code</option><option value="codigo">Código pelo número</option></select></label>{modo === "codigo" && <label className="space-y-1 text-xs"><span className="block">Número com DDI e DDD</span><input className={CONTROLE_CAMPO} inputMode="tel" value={telefone} placeholder="55 43 99999-0000" onChange={e => setTelefone(e.target.value)} /></label>}</div>}
    <div className="flex flex-wrap gap-2">{!oficial && <button type="button" className={BOTAO_MARCA} disabled={acao.isPending || (modo === "codigo" && !/^55\d{10,11}$/.test(telefone.replace(/\D/g, "")))} onClick={() => acao.mutate("conectar")}><QrCode className="h-3.5 w-3.5" aria-hidden /> {modo === "qr" ? "Gerar QR code" : "Gerar código"}</button>}<button type="button" className={BOTAO_SECUNDARIO} disabled={acao.isPending} onClick={() => acao.mutate("consultar")}><RefreshCw className="h-3.5 w-3.5" aria-hidden />{acao.isPending ? "Consultando…" : "Verificar conexão"}</button></div>
    {acao.isError && <p role="alert" className="text-xs leading-5 text-[var(--danger)]">{mensagemDoErro(acao.error)}</p>}
    {estado?.phone && <p className="font-mono text-xs tabular-nums">Número: {estado.phone}</p>}
    {estado?.qrCode && <div className="space-y-2"><img src={estado.qrCode} alt="QR para conectar o WhatsApp do provedor" className="h-56 w-56 rounded border border-[var(--border)] bg-white p-2" /><p className="text-xs text-[var(--text-muted)]">Após escanear, clique em Verificar conexão. Gere outro QR se ele expirar.</p></div>}
    {estado?.pairCode && <div className="rounded border border-[var(--border)] p-3"><p className="text-xs text-[var(--text-muted)]">Digite este código no WhatsApp</p><p className="mt-1 font-mono text-xl tracking-widest tabular-nums">{estado.pairCode}</p></div>}
  </div>;
}
