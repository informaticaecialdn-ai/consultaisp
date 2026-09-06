import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AgentesDoChat } from "@/components/chat/AgentesDoChat";
import { ConexaoWhatsapp } from "@/components/chat/ConexaoWhatsapp";
import { TemplatesDatafy } from "@/components/chat/TemplatesDatafy";
import type { ProvedorWhatsapp } from "@shared/chat-whatsapp";
import { AutomacaoPrimeiroContato } from "@/components/chat/AutomacaoPrimeiroContato";
import { AutonomiaDoChat } from "@/components/chat/AutonomiaDoChat";
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

  const [canal, setCanal] = useState({ provider: "ZAPPFY" as ProvedorWhatsapp, nome: "WhatsApp principal", token: "", webhookSecret: "", baseUrl: "", phoneNumberId: "", businessAccountId: "" });
  const [senha, setSenha] = useState({ senha: "", confirmacao: "" });

  const ligarCanal = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${API_CHAT_BULLQ}/integracao/canal`, {
      provider: canal.provider,
      nome: canal.nome.trim(),
      token: canal.token.trim(),
      ...(canal.provider === "UAZAPI" ? { baseUrl: canal.baseUrl.trim() } : {}),
      ...(canal.provider === "DATAFY" ? { phoneNumberId: canal.phoneNumberId.trim(), ...(canal.businessAccountId.trim() ? { businessAccountId: canal.businessAccountId.trim() } : {}) } : {}),
      ...(canal.webhookSecret.trim() ? { webhookSecret: canal.webhookSecret.trim() } : {}),
    })).json(),
    onSuccess: (r: { canalOk?: boolean; integracao?: { ultimoErro?: string | null } }) => {
      queryClient.invalidateQueries({ queryKey: [CHAVE_INTEGRACAO] });
      setCanal(c => ({ ...c, token: "", webhookSecret: "" }));
      if (r.canalOk) toast({ title: "WhatsApp ligado ao chat", description: "O kanban e o 360 já oferecem \"Enviar para cobrança\"." });
      else toast({ title: "Canal salvo; falta confirmar a conexão", description: r.integracao?.ultimoErro ?? "Use Verificar conexão ou pareie o número pelo QR.", variant: "destructive" });
    },
    onError: (erro: Error) => toast({ title: "Não foi possível ligar o número", description: mensagemDoErro(erro), variant: "destructive" }),
  });

  const definirSenha = useMutation({
    mutationFn: async () => {
      if (senha.senha.length < 12) throw new Error("A senha precisa de ao menos 12 caracteres");
      if (senha.senha !== senha.confirmacao) throw new Error("As duas senhas não conferem");
      return (await apiRequest("POST", `${API_CHAT_BULLQ}/integracao/senha`, { senha: senha.senha })).json();
    },
    onSuccess: (r: { ownerEmail?: string }) => {
      setSenha({ senha: "", confirmacao: "" });
      toast({ title: "Senha do inbox definida", description: r.ownerEmail ? `Entre em chat.consultaisp.com.br com ${r.ownerEmail}.` : undefined });
    },
    onError: (erro: Error) => toast({ title: "Não foi possível definir a senha", description: mensagemDoErro(erro), variant: "destructive" }),
  });

  // O canal existe e o token vale; falta o cliente ler o QR. Não é erro — e o
  // que a coluna guarda como "último erro" nesse estado é o próprio recado de
  // pareamento, que não deve aparecer em vermelho como falha.
  const aguardandoPareamento = integracao?.status === "aguardando_conexao";
  const tomDoStatus = integracao?.status === "ativo" ? "ok" : integracao?.status === "erro" ? "danger" : "gated";
  const rotuloDoStatus = integracao?.status === "ativo" ? "número ativo"
    : integracao?.status === "erro" ? "erro no número"
    : aguardandoPareamento ? "aguardando pareamento"
    : integracao?.provisionado ? "sem número ligado"
    : "ainda não provisionado";

  return (
    <div className="space-y-4" data-testid="tab-content-chat">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4" data-testid="chat-estado">
        <div className="flex flex-wrap items-center gap-2">
          <Kicker>chat com o cliente</Kicker>
          {isLoading ? <SeloCobranca tom="neutro">carregando</SeloCobranca>
            : isError ? <SeloCobranca tom="danger" titulo={mensagemDoErro(error)}>não carregou</SeloCobranca>
            : !integracao?.ligado ? <SeloCobranca tom="neutro" titulo="A instalação não tem o chat configurado (CHAT_BULLQ_URL)">desligado nesta instalação</SeloCobranca>
            : <SeloCobranca tom={tomDoStatus} testId="selo-chat-status" titulo={aguardandoPareamento ? "O canal está salvo no chat; falta parear o número lendo o QR" : undefined}>{rotuloDoStatus}</SeloCobranca>}
          {integracao?.canal && <SeloCobranca tom="info" className="normal-case tracking-normal"><Smartphone className="h-3 w-3" aria-hidden /> {integracao.canal.nome ?? integracao.canal.id}</SeloCobranca>}
          {integracao?.inboxUrl && (
            <a href={integracao.inboxUrl} target="_blank" rel="noreferrer noopener" className={cn(BOTAO_SECUNDARIO, "ml-auto h-8 text-[11.5px]")} data-testid="link-inbox-chat"><ExternalLink className="h-3.5 w-3.5" aria-hidden /> abrir o inbox</a>
          )}
        </div>
        <p className="mt-2 text-[12.5px] leading-5 text-[var(--text-2)]">
          Conecte o WhatsApp do provedor aos módulos de Cobrança e Equipamentos. Inicie pelo caso, acompanhe a resposta e continue o atendimento aqui. O inbox externo fica disponível para administrar canais e recursos adicionais.
        </p>
        {aguardandoPareamento
          ? <p className="mt-2 text-[12px] leading-5 text-[var(--gated)]" data-testid="chat-aguardando-pareamento">Falta parear o número: abra <b>Conexão do número</b> e leia o QR com o WhatsApp do provedor. Até lá os botões de envio não aparecem nas telas.</p>
          : <>
              {integracao?.ultimoErro && <p className="mt-2 text-[12px] text-[var(--danger)]" data-testid="chat-ultimo-erro">último erro: {integracao.ultimoErro}</p>}
              {integracao?.ligado && !pronto && <p className="mt-2 text-[12px] text-[var(--gated)]">Sem número ativo, os botões de envio não aparecem nas telas.</p>}
            </>}

        {/* O agente de IA de cobrança: primeiro contato no WhatsApp, dentro da política e do tom do DNA; transfere ao atendente. */}
        <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-[var(--brand)]"><Link href="/cobranca/chat?carteira=ativo">Conversas de cobrança →</Link><Link href="/equipamentos/chat">Conversas de equipamentos →</Link></div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4" data-testid="chat-canal">
          <div className="flex items-center gap-2"><MessageSquareShare className="h-4 w-4 text-[var(--brand)]" aria-hidden /><h3 className="text-[14px] font-semibold text-[var(--text)]">Canal principal de WhatsApp</h3></div>
          <p className="mt-1 text-[11.5px] leading-4 text-[var(--text-muted)]">
            Escolha o serviço que atende seu número. As credenciais ficam no ChatBullQ e o atendimento continua aqui, com o histórico do cliente.
          </p>
          <form className="mt-3 grid gap-3" onSubmit={e => { e.preventDefault(); ligarCanal.mutate(); }}>
            <Campo rotulo="serviço de WhatsApp"><select className={CONTROLE_CAMPO} value={canal.provider} disabled={!podeAdministrar || ligarCanal.isPending} onChange={e => setCanal(c => ({ ...c, provider: e.target.value as ProvedorWhatsapp, token: "", webhookSecret: "" }))} data-testid="chat-canal-provider"><option value="ZAPPFY">Zappfy · instância / QR</option><option value="UAZAPI">Uazapi · instância / QR</option><option value="DATAFY">Datafy · API oficial</option></select></Campo>
            <Campo rotulo="nome do canal"><input className={CONTROLE_CAMPO} value={canal.nome} onChange={e => setCanal(c => ({ ...c, nome: e.target.value }))} disabled={!podeAdministrar} data-testid="chat-canal-nome" /></Campo>
            {canal.provider === "UAZAPI" && <Campo rotulo="URL da instância Uazapi"><input className={CONTROLE_CAMPO} type="url" placeholder="https://sua-instancia.uazapi.com" value={canal.baseUrl} onChange={e => setCanal(c => ({ ...c, baseUrl: e.target.value }))} disabled={!podeAdministrar} data-testid="chat-canal-url" /></Campo>}
            {canal.provider === "DATAFY" && <><Campo rotulo="ID do número (phone_number_id)"><input className={CONTROLE_CAMPO} inputMode="numeric" value={canal.phoneNumberId} onChange={e => setCanal(c => ({ ...c, phoneNumberId: e.target.value }))} disabled={!podeAdministrar} data-testid="chat-canal-phone-id" /></Campo><Campo rotulo="ID da conta WhatsApp Business (opcional)"><input className={CONTROLE_CAMPO} inputMode="numeric" value={canal.businessAccountId} onChange={e => setCanal(c => ({ ...c, businessAccountId: e.target.value }))} disabled={!podeAdministrar} /></Campo><p className="text-xs leading-5 text-[var(--text-muted)]">Conecte o número no painel Datafy e ative a assinatura de webhooks. Use aqui o token sk_live e o segredo whsec do número.</p></>}
            <Campo rotulo={canal.provider === "DATAFY" ? "token de acesso Datafy" : "token da instância"}><input className={cn(CONTROLE_CAMPO, "font-mono")} type="password" autoComplete="off" value={canal.token} onChange={e => setCanal(c => ({ ...c, token: e.target.value }))} disabled={!podeAdministrar} placeholder={canal.provider === "DATAFY" ? "sk_live_…" : "Token da instância"} data-testid="chat-canal-token" /></Campo>
            <Campo rotulo={canal.provider === "DATAFY" ? "segredo de assinatura do webhook" : "segredo do webhook (opcional)"}><input className={cn(CONTROLE_CAMPO, "font-mono")} type="password" autoComplete="off" value={canal.webhookSecret} onChange={e => setCanal(c => ({ ...c, webhookSecret: e.target.value }))} disabled={!podeAdministrar} data-testid="chat-canal-webhook" /></Campo>
            <div className="flex items-center gap-2">
              <button type="submit" className={BOTAO_MARCA} disabled={!podeAdministrar || !integracao?.ligado || ligarCanal.isPending || canal.token.trim().length < 8 || canal.nome.trim().length < 2 || (canal.provider === "UAZAPI" && !canal.baseUrl.trim()) || (canal.provider === "DATAFY" && (!/^\d{5,30}$/.test(canal.phoneNumberId.trim()) || canal.webhookSecret.trim().length < 8))} data-testid="chat-ligar-canal">{ligarCanal.isPending ? "Salvando…" : integracao?.canal ? "Salvar novo canal principal" : "Salvar e testar canal"}</button>
              {!podeAdministrar && <span className="text-[11px] text-[var(--text-faint)]">só o administrador liga o número</span>}
            </div>
          </form>
          {canal.provider === "DATAFY" && <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3 text-xs leading-5 text-[var(--text-muted)]">{integracao?.webhookDatafyUrl ? <><p>Cadastre esta URL na aba Webhooks do número no painel Datafy, com assinatura ativada:</p><input className={cn(CONTROLE_CAMPO, "font-mono text-[11px]")} readOnly aria-label="URL do webhook Datafy" value={integracao.webhookDatafyUrl} onFocus={e => e.target.select()} /></> : <p>O endereço HTTPS público do chat ainda precisa ser configurado para receber respostas da Datafy. O endereço local permite configurar e revisar a integração.</p>}</div>}

        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4" data-testid="chat-senha">
          {integracao?.canal ? <ConexaoWhatsapp key={integracao.canal.id} provider={integracao.canal.provider ?? "ZAPPFY"} podeAdministrar={podeAdministrar} /> : <div className="space-y-2"><h3 className="text-sm font-semibold">Conexão do número</h3><p className="text-xs leading-5 text-[var(--text-muted)]">Salve o canal para conferir a conexão. Zappfy e Uazapi permitem pareamento por QR ou código; a Datafy usa o número conectado no painel oficial.</p></div>}
          <details className="mt-5 border-t border-[var(--border)] pt-4"><summary className="cursor-pointer text-xs font-medium text-[var(--text-2)]">Acesso ao inbox externo</summary>
          <div className="mt-3 flex items-center gap-2"><KeyRound className="h-4 w-4 text-[var(--brand)]" aria-hidden /><h3 className="text-[14px] font-semibold text-[var(--text)]">Senha do inbox</h3></div>
          <p className="mt-1 text-[11.5px] leading-4 text-[var(--text-muted)]">
            A equipe entra em <b>chat.consultaisp.com.br</b> com o e-mail {integracao?.ownerEmail ? <><b className="font-mono" data-testid="chat-owner-email">{integracao.ownerEmail}</b></> : "de contato do provedor"} e esta senha. Ela não fica guardada aqui: vai direto para o chat.
          </p>
          <form className="mt-3 grid gap-3" onSubmit={e => { e.preventDefault(); definirSenha.mutate(); }}>
            <Campo rotulo="nova senha"><input className={CONTROLE_CAMPO} type="password" autoComplete="new-password" value={senha.senha} onChange={e => setSenha(s => ({ ...s, senha: e.target.value }))} disabled={!podeAdministrar} data-testid="chat-senha-nova" /></Campo>
            <Campo rotulo="confirmar"><input className={CONTROLE_CAMPO} type="password" autoComplete="new-password" value={senha.confirmacao} onChange={e => setSenha(s => ({ ...s, confirmacao: e.target.value }))} disabled={!podeAdministrar} data-testid="chat-senha-confirmacao" /></Campo>
            <div><button type="submit" className={BOTAO_SECUNDARIO} disabled={!podeAdministrar || definirSenha.isPending || senha.senha.length < 12} data-testid="chat-definir-senha">{definirSenha.isPending ? "Gravando…" : "Definir senha"}</button></div>
          </form>
          </details>
        </section>
      </div>
      {integracao?.canal?.provider === "DATAFY" && <TemplatesDatafy podeAdministrar={podeAdministrar} />}
      <AgentesDoChat podeAdministrar={podeAdministrar} />
      <AutomacaoPrimeiroContato podeAdministrar={podeAdministrar} />
      {/* Fase 2: o assistente continua a conversa sozinho, dentro das permissoes; a fila e o que ele nunca faz ficam a vista. */}
      <AutonomiaDoChat podeAdministrar={podeAdministrar} />
    </div>
  );
}
