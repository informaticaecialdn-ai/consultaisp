import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MessageSquareText, Repeat } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { mensagemDoErro } from "@/components/cobranca/ui";
import { BOTAO_SECUNDARIO, Campo, CONTROLE_CAMPO, CONTROLE_CAMPO_MULTILINHA } from "@/components/painel/ui";
import { BOTAO_CHAT_MARCA, NUM_CHAT } from "./PerfilDoCliente";
import { ATALHO, ICONE_DO_ATALHO } from "./ConversaUi";
import type { DadosMulticanal } from "./multicanal";

export function useMulticanalDaConversa(url: string, escopo: string) {
  return useQuery<DadosMulticanal>({
    queryKey: [`${url}/multicanal?${escopo}`],
    queryFn: async () => (await apiRequest("GET", `${url}/multicanal?${escopo}`)).json(),
    refetchInterval: 10_000,
    retry: false,
  });
}

/** Ação complementar em diálogo próprio; o compositor principal continua no WhatsApp. O gatilho é um atalho do compositor. */
export function MulticanalDaConversa({ url, escopo, canal, dados, bloqueado }: {
  url: string; escopo: string; canal: "sms" | "email";
  dados: DadosMulticanal | undefined; bloqueado: boolean;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [assunto, setAssunto] = useState("");
  const [propostaId, setPropostaId] = useState("");
  const [confirmarProposta, setConfirmarProposta] = useState(false);
  // A mesma tentativa mantém sua chave quando a resposta se perde; editar cria outra.
  const tentativa = useRef<{ conteudo: string; chave: string } | null>(null);
  const atualizar = () => qc.invalidateQueries({ queryKey: [`${url}/multicanal?${escopo}`] });
  const previa = useMutation({
    mutationFn: async (id: number): Promise<{ assunto: string; texto: string; html: string }> =>
      (await apiRequest("POST", `${url}/multicanal/proposta?${escopo}`, { propostaId: id })).json(),
    onSuccess: () => setConfirmarProposta(false),
    retry: false,
  });
  const envio = useMutation({
    mutationFn: async () => {
      const pedido = {
        canal,
        texto: propostaId ? previa.data?.texto ?? "" : texto.trim(),
        ...(canal === "email" ? { assunto: propostaId ? previa.data?.assunto : assunto.trim() } : {}),
        ...(propostaId ? { propostaId: Number(propostaId), confirmarProposta } : {}),
      };
      const conteudo = JSON.stringify(pedido);
      if (tentativa.current?.conteudo !== conteudo)
        tentativa.current = { conteudo, chave: crypto.randomUUID() };
      const resposta: { status: string; motivo?: string } = await (await apiRequest("POST", `${url}/multicanal/enviar?${escopo}`, {
        ...pedido, chave: tentativa.current.chave,
      })).json();
      await atualizar();
      if (resposta.status === "falhou" || resposta.status === "incerto")
        throw new Error(resposta.motivo ?? "O canal não confirmou o envio. Confira o histórico antes de tentar novamente.");
      if (resposta.status === "ja_registrado")
        throw new Error("Esta solicitação já foi registrada. Confira a situação no histórico antes de preparar outro envio.");
      return resposta;
    },
    onSuccess: async () => {
      setTexto(""); setAssunto(""); setPropostaId(""); setConfirmarProposta(false);
      tentativa.current = null;
      previa.reset();
      await atualizar();
    },
    retry: false,
  });
  const disponivel = dados?.canais[canal] === true;
  const pronto = propostaId ? previa.isSuccess && confirmarProposta : texto.trim() && (canal !== "email" || assunto.trim());
  return (
    <>
    <button type="button" className={ATALHO} onClick={() => setAberto(true)} data-testid={`chat-abrir-${canal}`}>
      {canal === "sms" ? <MessageSquareText aria-hidden className={ICONE_DO_ATALHO} /> : <Mail aria-hidden className={ICONE_DO_ATALHO} />}
      Enviar {canal === "sms" ? "SMS" : "e-mail"}
    </button>
    <Dialog open={aberto} onOpenChange={setAberto}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[600px]" data-testid={`chat-dialogo-${canal}`}>
    <DialogHeader>
      <DialogTitle>Enviar {canal === "sms" ? "SMS" : "e-mail"}</DialogTitle>
      <DialogDescription>Envie ao contato cadastrado deste cliente. A mensagem e as respostas aparecem no histórico da conversa.</DialogDescription>
    </DialogHeader>
    <div className="space-y-2" data-testid="chat-compositor-multicanal">
      {!disponivel && <p role="status" className="text-xs text-[var(--text-muted)]">Este canal não está disponível para o cliente. Confira o contato e a integração do provedor.</p>}
      {canal === "email" && (
        <Campo rotulo="Proposta por e-mail">
          <select className={CONTROLE_CAMPO} value={propostaId} disabled={envio.isPending || previa.isPending} onChange={(e) => {
            setPropostaId(e.target.value); setConfirmarProposta(false); previa.reset();
            if (e.target.value) previa.mutate(Number(e.target.value));
          }}>
            <option value="">Escrever mensagem</option>
            {dados?.propostas.map((p) => <option key={p.id} value={p.id}>{p.rotulo}</option>)}
          </select>
        </Campo>
      )}
      {propostaId ? (
        <>
          {previa.isPending && <p role="status" className="text-xs text-[var(--text-muted)]">Preparando prévia da proposta…</p>}
          {previa.data && <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
            <p className="text-sm font-medium">{previa.data.assunto}</p>
            <iframe title="Prévia da proposta por e-mail" sandbox="" referrerPolicy="no-referrer"
              srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${previa.data.html}`}
              className="h-48 w-full rounded border border-[var(--border)] bg-[var(--surface)]" />
            <details className="text-xs"><summary>Versão em texto</summary><p className="mt-2 whitespace-pre-wrap break-words">{previa.data.texto}</p></details>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmarProposta} disabled={envio.isPending} onChange={(e) => setConfirmarProposta(e.target.checked)} />Revisei a proposta e confirmo o envio ao cliente.</label>
          </div>}
        </>
      ) : (
        <>
          {canal === "email" && <Campo rotulo="Assunto"><input className={CONTROLE_CAMPO} value={assunto} maxLength={200} disabled={envio.isPending} onChange={(e) => setAssunto(e.target.value)} /></Campo>}
          <Campo rotulo={`Mensagem por ${canal === "sms" ? "SMS" : "e-mail"}`}>
            <textarea className={CONTROLE_CAMPO_MULTILINHA} rows={3} value={texto} maxLength={canal === "sms" ? 1000 : 10000} disabled={envio.isPending} onChange={(e) => setTexto(e.target.value)} />
          </Campo>
        </>
      )}
      {(envio.isError || previa.isError) && <p role="alert" className="text-xs text-[var(--danger)]">{mensagemDoErro(envio.error ?? previa.error)} O conteúdo foi preservado.</p>}
      {envio.isSuccess && <p role="status" className="text-xs text-[var(--ok)]">Solicitação registrada. Acompanhe a situação no histórico.</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-[var(--text-muted)]">Destino: contato cadastrado deste cliente · atendimento humano</span>
        <button type="button" className={BOTAO_CHAT_MARCA} disabled={bloqueado || !disponivel || !pronto || envio.isPending} onClick={() => envio.mutate()}>{envio.isPending ? "Registrando…" : `Enviar ${canal === "sms" ? "SMS" : "e-mail"}`}</button>
      </div>
    </div>
    </DialogContent>
    </Dialog>
    </>
  );
}

export function ReforcosDaConversa({ url, escopo, dados }: { url: string; escopo: string; dados: DadosMulticanal }) {
  const qc = useQueryClient();
  const [intervalo, setIntervalo] = useState(String(dados.config.intervaloHoras));
  const [canais, setCanais] = useState(dados.config.canais);
  const config = useMutation({
    mutationFn: async (reforcoAtivo: boolean) => (await apiRequest("POST", `${url}/multicanal/config?${escopo}`, {
      reforcoAtivo, intervaloHoras: Number(intervalo),
      canais,
    })).json(),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: [`${url}/multicanal?${escopo}`] }); },
    retry: false,
  });
  const invalido = !Number.isInteger(Number(intervalo)) || Number(intervalo) < 24 || Number(intervalo) > 720 || !canais.length;
  // Configuração, não mensagem: mora num popover do atalho, como os popovers do compositor da referência.
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" className={ATALHO} title="Reforços por SMS/e-mail" data-testid="chat-reforcos">
        <Repeat aria-hidden className={ICONE_DO_ATALHO} />
        Reforços · {dados.config.reforcoAtivo ? "ativos" : "desligados"}
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" side="top" className="w-[320px] p-3 text-xs text-[var(--text-muted)]">
    <p className="mb-2 text-[11px] font-semibold text-[var(--text-2)]">Reforços por SMS/e-mail</p>
    <div className="flex flex-wrap items-center gap-2">
      <label>Intervalo em horas <input aria-label="Intervalo dos reforços em horas" type="number" min={24} max={720} className={`${CONTROLE_CAMPO} ${NUM_CHAT} w-20`} value={intervalo} onChange={(e) => setIntervalo(e.target.value)} /></label>
      {(["sms", "email"] as const).map((c) => <label key={c} className="flex items-center gap-1"><input type="checkbox" checked={canais.includes(c)} disabled={config.isPending || !dados.canais[c]} onChange={(e) => setCanais((atual) => e.target.checked ? [...atual, c] : atual.filter((x) => x !== c))} />{c === "sms" ? "SMS" : "E-mail"}</label>)}
      <button type="button" className={BOTAO_SECUNDARIO} disabled={config.isPending || invalido} onClick={() => config.mutate(!dados.config.reforcoAtivo)}>{dados.config.reforcoAtivo ? "Desligar reforços" : "Ativar reforços"}</button>
      {dados.config.reforcoAtivo && <button type="button" className={BOTAO_SECUNDARIO} disabled={config.isPending || invalido} onClick={() => config.mutate(true)}>Salvar intervalo e canais</button>}
      <p>Respeita a política de contato. Respostas recebidas ficam neste histórico.</p>
    </div>
    {config.isError && <p role="alert" className="mt-2 text-[var(--danger)]">{mensagemDoErro(config.error)}</p>}
    </PopoverContent>
  </Popover>;
}
