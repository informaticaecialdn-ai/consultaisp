/**
 * A aba "Chat" do painel do provedor — a ponte com o Chat BullQ.
 *
 * Pedido do dono (05/09/2026): o funcionário conversa com o cliente que vai
 * cobrar ou buscar o equipamento "direto aqui no sistema". O chat roda à
 * parte (Chat BullQ, fork privado); aqui o admin do provedor faz as três
 * coisas que dependem dele: liga o número de WhatsApp (o token da instância
 * Zappfy/Uazapi vai direto para o chat, nunca fica neste banco), define a
 * senha do inbox (para a equipe entrar em chat.consultaisp.com.br) e vê o
 * estado. Sem número ativo, o kanban e o 360 não oferecem "Enviar para
 * cobrança" — a tela diz isso em vez de esconder.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, KeyRound, MessageSquareShare, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, Campo, CONTROLE_CAMPO } from "@/components/painel/ui";
import { API_CHAT_BULLQ, chatProntoParaEnviar, lerIntegracaoDoChat } from "@/components/cobranca/tipos";
import { mensagemDoErro, SeloCobranca } from "@/components/cobranca/ui";
import { Kicker } from "@/components/localizacao/ui";

const CHAVE_INTEGRACAO = `${API_CHAT_BULLQ}/integracao`;

export function AbaChat({ podeAdministrar }: { podeAdministrar: boolean }) {
  const { toast } = useToast();
  const { data: crua, isLoading, isError, error } = useQuery<unknown>({ queryKey: [CHAVE_INTEGRACAO], staleTime: 60_000 });
  const integracao = useMemo(() => lerIntegracaoDoChat(crua), [crua]);
  const pronto = chatProntoParaEnviar(integracao);

  const [canal, setCanal] = useState({ nome: "WhatsApp principal", token: "", webhookSecret: "" });
  const [senha, setSenha] = useState({ senha: "", confirmacao: "" });

  const ligarCanal = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${API_CHAT_BULLQ}/integracao/canal`, {
      nome: canal.nome.trim(),
      token: canal.token.trim(),
      ...(canal.webhookSecret.trim() ? { webhookSecret: canal.webhookSecret.trim() } : {}),
    })).json(),
    onSuccess: (r: { canalOk?: boolean; integracao?: { ultimoErro?: string | null } }) => {
      queryClient.invalidateQueries({ queryKey: [CHAVE_INTEGRACAO] });
      setCanal(c => ({ ...c, token: "", webhookSecret: "" }));
      if (r.canalOk) toast({ title: "WhatsApp ligado ao chat", description: "O kanban e o 360 já oferecem \"Enviar para cobrança\"." });
      else toast({ title: "Canal criado, mas o teste falhou", description: r.integracao?.ultimoErro ?? "Confira se a instância está conectada no painel do Zappfy.", variant: "destructive" });
    },
    onError: (erro: Error) => toast({ title: "Não foi possível ligar o número", description: mensagemDoErro(erro), variant: "destructive" }),
  });

  const definirSenha = useMutation({
    mutationFn: async () => {
      if (senha.senha.length < 6) throw new Error("A senha precisa de ao menos 6 caracteres");
      if (senha.senha !== senha.confirmacao) throw new Error("As duas senhas não conferem");
      return (await apiRequest("POST", `${API_CHAT_BULLQ}/integracao/senha`, { senha: senha.senha })).json();
    },
    onSuccess: (r: { ownerEmail?: string }) => {
      setSenha({ senha: "", confirmacao: "" });
      toast({ title: "Senha do inbox definida", description: r.ownerEmail ? `Entre em chat.consultaisp.com.br com ${r.ownerEmail}.` : undefined });
    },
    onError: (erro: Error) => toast({ title: "Não foi possível definir a senha", description: mensagemDoErro(erro), variant: "destructive" }),
  });

  const tomDoStatus = integracao?.status === "ativo" ? "ok" : integracao?.status === "erro" ? "danger" : "gated";

  return (
    <div className="space-y-4" data-testid="tab-content-chat">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4" data-testid="chat-estado">
        <div className="flex flex-wrap items-center gap-2">
          <Kicker>chat com o cliente</Kicker>
          {isLoading ? <SeloCobranca tom="neutro">carregando</SeloCobranca>
            : isError ? <SeloCobranca tom="danger" titulo={mensagemDoErro(error)}>não carregou</SeloCobranca>
            : !integracao?.ligado ? <SeloCobranca tom="neutro" titulo="A instalação não tem o chat configurado (CHAT_BULLQ_URL)">desligado nesta instalação</SeloCobranca>
            : <SeloCobranca tom={tomDoStatus} testId="selo-chat-status">{integracao.status === "ativo" ? "número ativo" : integracao.status === "erro" ? "erro no número" : integracao.provisionado ? "sem número ligado" : "ainda não provisionado"}</SeloCobranca>}
          {integracao?.canal && <SeloCobranca tom="info" className="normal-case tracking-normal"><Smartphone className="h-3 w-3" aria-hidden /> {integracao.canal.nome ?? integracao.canal.id}</SeloCobranca>}
          {integracao?.inboxUrl && (
            <a href={integracao.inboxUrl} target="_blank" rel="noreferrer noopener" className={cn(BOTAO_SECUNDARIO, "ml-auto h-8 text-[11.5px]")} data-testid="link-inbox-chat"><ExternalLink className="h-3.5 w-3.5" aria-hidden /> abrir o inbox</a>
          )}
        </div>
        <p className="mt-2 text-[12.5px] leading-5 text-[var(--text-2)]">
          A conversa com o cliente acontece no WhatsApp do provedor, pelo chat. No kanban de cobrança e na ficha 360, <b>Enviar para cobrança</b> abre a conversa com a mensagem da etapa da régua; no kanban de retirada, <b>Chat</b> combina a busca do equipamento. A equipe responde no inbox.
        </p>
        {integracao?.ultimoErro && <p className="mt-2 text-[12px] text-[var(--danger)]" data-testid="chat-ultimo-erro">último erro: {integracao.ultimoErro}</p>}
        {integracao?.ligado && !pronto && <p className="mt-2 text-[12px] text-[var(--gated)]">Sem número ativo, os botões de envio não aparecem nas telas.</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4" data-testid="chat-canal">
          <div className="flex items-center gap-2"><MessageSquareShare className="h-4 w-4 text-[var(--brand)]" aria-hidden /><h3 className="text-[14px] font-semibold text-[var(--text)]">Ligar o WhatsApp</h3></div>
          <p className="mt-1 text-[11.5px] leading-4 text-[var(--text-muted)]">
            O número é uma instância Zappfy/Uazapi já pareada (QR code lido no painel deles). Cole aqui o token da instância: ele vai direto para o chat e não fica neste sistema.
          </p>
          <form className="mt-3 grid gap-3" onSubmit={e => { e.preventDefault(); ligarCanal.mutate(); }}>
            <Campo rotulo="nome do canal"><input className={CONTROLE_CAMPO} value={canal.nome} onChange={e => setCanal(c => ({ ...c, nome: e.target.value }))} disabled={!podeAdministrar} data-testid="chat-canal-nome" /></Campo>
            <Campo rotulo="token da instância"><input className={cn(CONTROLE_CAMPO, "font-mono")} type="password" autoComplete="off" value={canal.token} onChange={e => setCanal(c => ({ ...c, token: e.target.value }))} disabled={!podeAdministrar} placeholder="token da instância Zappfy/Uazapi" data-testid="chat-canal-token" /></Campo>
            <Campo rotulo="segredo do webhook (opcional)"><input className={cn(CONTROLE_CAMPO, "font-mono")} type="password" autoComplete="off" value={canal.webhookSecret} onChange={e => setCanal(c => ({ ...c, webhookSecret: e.target.value }))} disabled={!podeAdministrar} data-testid="chat-canal-webhook" /></Campo>
            <div className="flex items-center gap-2">
              <button type="submit" className={BOTAO_MARCA} disabled={!podeAdministrar || ligarCanal.isPending || canal.token.trim().length < 8 || canal.nome.trim().length < 2} data-testid="chat-ligar-canal">{ligarCanal.isPending ? "Ligando…" : integracao?.canal ? "Trocar o número" : "Ligar número"}</button>
              {!podeAdministrar && <span className="text-[11px] text-[var(--text-faint)]">só o administrador liga o número</span>}
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4" data-testid="chat-senha">
          <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-[var(--brand)]" aria-hidden /><h3 className="text-[14px] font-semibold text-[var(--text)]">Senha do inbox</h3></div>
          <p className="mt-1 text-[11.5px] leading-4 text-[var(--text-muted)]">
            A equipe entra em <b>chat.consultaisp.com.br</b> com o e-mail {integracao?.ownerEmail ? <><b className="font-mono" data-testid="chat-owner-email">{integracao.ownerEmail}</b></> : "de contato do provedor"} e esta senha. Ela não fica guardada aqui: vai direto para o chat.
          </p>
          <form className="mt-3 grid gap-3" onSubmit={e => { e.preventDefault(); definirSenha.mutate(); }}>
            <Campo rotulo="nova senha"><input className={CONTROLE_CAMPO} type="password" autoComplete="new-password" value={senha.senha} onChange={e => setSenha(s => ({ ...s, senha: e.target.value }))} disabled={!podeAdministrar} data-testid="chat-senha-nova" /></Campo>
            <Campo rotulo="confirmar"><input className={CONTROLE_CAMPO} type="password" autoComplete="new-password" value={senha.confirmacao} onChange={e => setSenha(s => ({ ...s, confirmacao: e.target.value }))} disabled={!podeAdministrar} data-testid="chat-senha-confirmacao" /></Campo>
            <div><button type="submit" className={BOTAO_SECUNDARIO} disabled={!podeAdministrar || definirSenha.isPending || senha.senha.length < 6} data-testid="chat-definir-senha">{definirSenha.isPending ? "Gravando…" : "Definir senha"}</button></div>
          </form>
        </section>
      </div>
    </div>
  );
}
