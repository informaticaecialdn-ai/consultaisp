/**
 * Confissão de dívida (CPC 784) no Cliente 360 — o bloco e o diálogo de
 * emissão (spec §6.2, §6.7, §8).
 *
 * O operador NUNCA digita valor: a base (acordo ou saldo integral ao vivo)
 * vem do servidor com a prévia, o custo, os bloqueios e o `baseHash`; o que
 * ele escolhe é o vencimento (saldo integral), quais faturas de saída ficam
 * de fora, o contato do cliente e, para PJ, o representante. Toda escolha
 * recarrega a base — é ela que o servidor confere na emissão. O que é
 * DIGITADO (contato e representante) só recarrega depois de uma pausa: cada
 * leitura é uma ida ao vivo ao ERP do provedor.
 */
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, FileSignature, RefreshCw, Send, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, CONTROLE_CAMPO } from "@/components/painel/ui";
import {
  ROTULO_CLASSE_DA_FATURA, ROTULO_ORIGEM_DA_CONFISSAO, ROTULO_STATUS_DE_CONFISSAO, ROTULO_STATUS_DO_SIGNATARIO, SELO_SANDBOX,
  type BaseDaConfissaoDto, type ConfissaoResumo, type EstadoDaAssinatura,
} from "@shared/cobranca/confissao";
import { SeloCobranca } from "./ui";
import { dataBr, dataHoraBr } from "./formatacao";

const NUM = "font-mono tabular-nums";
const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

interface Props {
  customerId: number;
  casoId: number | null;
  clienteNome: string;
  podeAdministrar: boolean;
  /** O caso ligado ao chat (para "enviar pelo chat"), quando o Chat BullQ está ligado. */
  chatCasoId: number | null;
}

interface Escolhas { vencimento: string; faturasExcluidas: string[]; email: string; telefone: string; representanteNome: string; representanteCpf: string; confirmoTeste: boolean }
type Digitado = Pick<Escolhas, "email" | "telefone" | "representanteNome" | "representanteCpf">;

/** A pausa na digitação antes de reler a base. */
const PAUSA_DA_DIGITACAO_MS = 600;

const digitadoDe = (e: Escolhas): Digitado => ({ email: e.email, telefone: e.telefone, representanteNome: e.representanteNome, representanteCpf: e.representanteCpf });

/**
 * Contato e representante entram na leitura da base só depois de uma pausa.
 * Eles PRECISAM ir ao GET — viram o devedor do texto e, por isso, o `baseHash`
 * que o POST devolve —, mas entrando direto na chave cada tecla era uma chave
 * nova: uma leitura ao vivo no ERP por caractere e, sem dado para a chave
 * nova, o formulário (com o campo sendo digitado) desmontava a cada letra.
 */
function useDigitadoDepoisDaPausa(e: Escolhas): Digitado {
  const [lido, setLido] = useState<Digitado>(() => digitadoDe(e));
  useEffect(() => {
    const timer = setTimeout(() => setLido(digitadoDe(e)), PAUSA_DA_DIGITACAO_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.email, e.telefone, e.representanteNome, e.representanteCpf]);
  return lido;
}

function queryDaBase(e: Escolhas): string {
  const p = new URLSearchParams();
  if (e.vencimento) p.set("vencimento", e.vencimento);
  if (e.faturasExcluidas.length) p.set("faturasExcluidas", e.faturasExcluidas.join(","));
  if (e.email) p.set("email", e.email);
  if (e.telefone) p.set("telefone", e.telefone);
  if (e.representanteNome) p.set("representanteNome", e.representanteNome);
  if (e.representanteCpf) p.set("representanteCpf", e.representanteCpf);
  return p.toString();
}

export function ConfissaoDeDivida({ customerId, casoId, clienteNome, podeAdministrar, chatCasoId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const chaveLista = ["/api/cobranca/clientes", customerId, "confissoes"];
  const { data: estado } = useQuery<EstadoDaAssinatura>({ queryKey: ["/api/cobranca/confissoes/estado"], queryFn: async () => (await apiRequest("GET", "/api/cobranca/confissoes/estado")).json() });
  const { data: lista = [], isLoading } = useQuery<ConfissaoResumo[]>({ queryKey: chaveLista, queryFn: async () => (await apiRequest("GET", `/api/cobranca/clientes/${customerId}/confissoes`)).json() });
  const [aberto, setAberto] = useState(false);
  const viva = lista.find(c => c.status === "rascunho" || c.status === "enviada") ?? null;
  const assinada = lista.find(c => c.status === "assinada") ?? null;
  const recarregar = () => qc.invalidateQueries({ queryKey: chaveLista });

  const erroDaApi = (e: unknown) => {
    const err = e as Error & { codigo?: string; corpo?: { detalhes?: { bloqueios?: string[] } } };
    const bloqueios = err.corpo?.detalhes?.bloqueios;
    toast({ title: err.codigo === "APROVACAO_OBRIGATORIA" ? "Ação de administrador" : "Não foi possível", description: bloqueios?.length ? bloqueios.join(" · ") : err.message, variant: "destructive" });
  };
  const cancelar = useMutation({ mutationFn: async (id: number) => (await apiRequest("POST", `/api/cobranca/confissoes/${id}/cancelar`)).json(), onSuccess: () => { recarregar(); toast({ title: "Confissão cancelada" }); }, onError: erroDaApi });
  const reenviar = useMutation({ mutationFn: async (id: number) => (await apiRequest("POST", `/api/cobranca/confissoes/${id}/reenviar`)).json() as Promise<{ enviados: number }>, onSuccess: r => toast({ title: `Lembrete reenviado a ${r.enviados} signatário${r.enviados === 1 ? "" : "s"}` }), onError: erroDaApi });
  const enviarPeloChat = useMutation({
    mutationFn: async (c: ConfissaoResumo) => {
      const texto = `${clienteNome}, aqui é o atendimento do provedor. Segue o link para assinar a confissão de dívida (R$ ${c.valorTotal.toFixed(2).replace(".", ",")}) com validade até ${dataBr(c.dataLimiteAssinatura)}: ${c.signUrlCliente}`;
      return (await apiRequest("POST", `/api/chat-bullq/cobranca/casos/${chatCasoId}/enviar`, { texto })).json();
    },
    onSuccess: () => toast({ title: "Link enviado pelo chat", description: "Registrado como contato no caso" }),
    onError: erroDaApi,
  });

  const copiar = async (url: string) => { await navigator.clipboard.writeText(url); toast({ title: "Link copiado" }); };
  const sandbox = estado?.ambiente === "sandbox";

  return (
    <div className="flex flex-col gap-2" data-testid="confissao-de-divida">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-mono text-[10px] font-semibold uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">Confissão de dívida</span>
        {sandbox && <SeloCobranca tom="gated" titulo="A integração do provedor está em sandbox: nada é enviado ao cliente e o documento não tem validade jurídica">{SELO_SANDBOX}</SeloCobranca>}
      </div>

      {estado && !estado.ativa && <p className="text-[12px] leading-4 text-[var(--text-2)]" data-testid="confissao-nao-configurada">{estado.motivo}</p>}

      {isLoading ? <p className="text-[12px] text-[var(--text-muted)]">Lendo confissões…</p> : lista.length === 0 ? (
        <p className="text-[12px] leading-4 text-[var(--text-2)]">Nenhuma confissão emitida para este cliente.{estado?.ativa ? " O título executivo (CPC 784, III) sai com os valores do acordo ou do ERP ao vivo — nada digitado." : ""}</p>
      ) : (
        <ul className="space-y-2" data-testid="lista-confissoes">
          {lista.map(c => (
            <li key={c.id} className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[12px]" data-testid={`confissao-${c.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <SeloCobranca tom={c.status === "assinada" ? (c.ambiente === "sandbox" ? "gated" : "ok") : c.status === "enviada" ? "info" : c.status === "quitada" ? "ok" : "neutro"}>{ROTULO_STATUS_DE_CONFISSAO[c.status]}</SeloCobranca>
                <b className={NUM}>{brl(c.valorTotal)}</b>
                <span className="text-[var(--text-muted)]">· {ROTULO_ORIGEM_DA_CONFISSAO[c.origem]} · {c.parcelas.length} parcela{c.parcelas.length === 1 ? "" : "s"}</span>
                {c.ambiente === "sandbox" && <span className="font-mono text-[10px] uppercase text-[var(--gated)]">teste</span>}
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-2)]">
                {c.signatarios.map(s => `${s.papel}: ${ROTULO_STATUS_DO_SIGNATARIO[s.status]}${s.signedAt ? ` em ${dataHoraBr(s.signedAt)}` : ""}`).join(" · ") || "sem signatário registrado"}
                {c.status === "enviada" && <> · prazo até <span className={NUM}>{dataBr(c.dataLimiteAssinatura)}</span></>}
                {c.assinadaEm && <> · assinada em <span className={NUM}>{dataHoraBr(c.assinadaEm)}</span></>}
                {c.criadaPor && <> · emitida por {c.criadaPor}</>}
              </p>
              {c.recusaInformadaEm && <p className="mt-1 text-[11px] text-[var(--past)]">O ZapSign informou recusa em {dataHoraBr(c.recusaInformadaEm)} — confirme na conta e cancele se for o caso.</p>}
              {c.expiracaoInformadaEm && <p className="mt-1 text-[11px] text-[var(--gated)]">O ZapSign informou expiração em {dataHoraBr(c.expiracaoInformadaEm)}.</p>}
              {c.erroUltimo && !c.recusaInformadaEm && !c.expiracaoInformadaEm && <p className="mt-1 text-[11px] text-[var(--danger)]">{c.erroUltimo}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {c.signUrlCliente && c.status === "enviada" && <button type="button" className={BOTAO_SECUNDARIO} onClick={() => copiar(c.signUrlCliente!)}><Copy className="h-3.5 w-3.5" aria-hidden /> Copiar link</button>}
                {c.signUrlCliente && c.status === "enviada" && estado?.chatDisponivel && chatCasoId && c.ambiente !== "sandbox" && <button type="button" className={BOTAO_SECUNDARIO} disabled={enviarPeloChat.isPending} onClick={() => enviarPeloChat.mutate(c)}><Send className="h-3.5 w-3.5" aria-hidden /> Enviar pelo chat</button>}
                {c.status === "enviada" && c.ambiente !== "sandbox" && podeAdministrar && <button type="button" className={BOTAO_SECUNDARIO} disabled={reenviar.isPending} onClick={() => reenviar.mutate(c.id)} title="1 lembrete a cada 30 minutos"><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reenviar</button>}
                {(c.status === "enviada" || c.status === "rascunho") && podeAdministrar && <button type="button" className={BOTAO_SECUNDARIO} disabled={cancelar.isPending} onClick={() => { if (window.confirm("Cancelar esta confissão? O documento é apagado no ZapSign.")) cancelar.mutate(c.id); }}><XCircle className="h-3.5 w-3.5" aria-hidden /> Cancelar</button>}
                {c.pdf.original && <a className={BOTAO_SECUNDARIO} href={`/api/cobranca/confissoes/${c.id}/pdf?tipo=original`}><Download className="h-3.5 w-3.5" aria-hidden /> PDF original</a>}
                {c.pdf.assinado && <a className={BOTAO_SECUNDARIO} href={`/api/cobranca/confissoes/${c.id}/pdf?tipo=assinado`}><Download className="h-3.5 w-3.5" aria-hidden /> PDF assinado</a>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(BOTAO_MARCA, !podeAdministrar && "opacity-60")} disabled={!estado?.ativa || !!viva} onClick={() => setAberto(true)} title={!estado?.ativa ? estado?.motivo ?? "" : viva ? "Já há uma confissão em andamento — cancele-a antes" : podeAdministrar ? "Emitir a confissão com os valores do acordo ou do ERP ao vivo" : "Apenas administradores emitem (APROVACAO_OBRIGATORIA)"} data-testid="acao-emitir-confissao">
          <FileSignature className="h-3.5 w-3.5" aria-hidden /> {assinada ? "Emitir outra" : "Emitir confissão"}
        </button>
        {!casoId && <span className="text-[11px] text-[var(--text-muted)]">abra o caso antes de emitir</span>}
      </div>

      {aberto && <DialogoEmissao customerId={customerId} estado={estado ?? null} onFechar={() => setAberto(false)} onEmitida={() => { setAberto(false); recarregar(); }} />}
    </div>
  );
}

function DialogoEmissao({ customerId, estado, onFechar, onEmitida }: { customerId: number; estado: EstadoDaAssinatura | null; onFechar: () => void; onEmitida: () => void }) {
  const { toast } = useToast();
  const [escolhas, setEscolhas] = useState<Escolhas>({ vencimento: "", faturasExcluidas: [], email: "", telefone: "", representanteNome: "", representanteCpf: "", confirmoTeste: false });
  const [chave] = useState(() => crypto.randomUUID());
  const digitado = useDigitadoDepoisDaPausa(escolhas);
  const query = queryDaBase({ ...escolhas, ...digitado });
  const { data: base, isFetching, isPlaceholderData, error } = useQuery<BaseDaConfissaoDto>({
    queryKey: ["/api/cobranca/clientes", customerId, "confissoes", "base", query],
    queryFn: async () => (await apiRequest("GET", `/api/cobranca/clientes/${customerId}/confissoes/base?${query}`)).json(),
    staleTime: 0,
    // Enquanto a leitura nova não volta, a anterior fica na tela: o formulário
    // nunca desmonta no meio de uma leitura (o Emitir fica travado, abaixo).
    placeholderData: keepPreviousData,
  });
  // A base na tela tem de ser a das escolhas de AGORA: com a leitura anterior
  // o Emitir mandaria o hash de outra base (409 BASE_MUDOU) — ou, pior, a
  // leitura velha iria para o documento.
  const baseEmDia = !!base && !isPlaceholderData && !isFetching && query === queryDaBase(escolhas);
  useEffect(() => {
    // O contato do cadastro entra como valor inicial editável — uma vez só.
    if (base && !escolhas.email && !escolhas.telefone && (base.cliente.email || base.cliente.telefone)) {
      setEscolhas(e => ({ ...e, email: base.cliente.email ?? "", telefone: base.cliente.telefone ?? "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base?.cliente.email, base?.cliente.telefone]);
  const emitir = useMutation({
    mutationFn: async () => {
      if (!base) throw new Error("Base ainda não carregada");
      const corpo = {
        origem: base.origem,
        vencimento: base.origem === "saldo_integral" ? (escolhas.vencimento || base.vencimento.minimo) : null,
        faturasExcluidas: escolhas.faturasExcluidas,
        clienteEmail: escolhas.email || null,
        clienteTelefone: escolhas.telefone || null,
        representante: base.cliente.pessoaJuridica ? { nome: escolhas.representanteNome, cpf: escolhas.representanteCpf } : null,
        baseHash: base.baseHash,
        chaveIdempotencia: chave,
        confirmoTeste: escolhas.confirmoTeste,
      };
      return (await apiRequest("POST", `/api/cobranca/clientes/${customerId}/confissoes`, corpo)).json() as Promise<ConfissaoResumo>;
    },
    onSuccess: c => { toast({ title: c.ambiente === "sandbox" ? "Confissão de TESTE emitida" : "Confissão enviada para assinatura", description: c.signUrlCliente ? "Copie o link ou envie pelo chat" : undefined }); onEmitida(); },
    onError: (e: Error & { codigo?: string; corpo?: { detalhes?: { bloqueios?: string[] } } }) => toast({ title: e.codigo === "BASE_MUDOU" ? "A dívida mudou" : e.codigo === "APROVACAO_OBRIGATORIA" ? "Ação de administrador" : "Não foi possível emitir", description: e.corpo?.detalhes?.bloqueios?.join(" · ") ?? e.message, variant: "destructive" }),
  });
  const alternarFatura = (chaveDaLinha: string) => setEscolhas(e => ({ ...e, faturasExcluidas: e.faturasExcluidas.includes(chaveDaLinha) ? e.faturasExcluidas.filter(x => x !== chaveDaLinha) : [...e.faturasExcluidas, chaveDaLinha] }));
  const sandbox = base?.ambiente === "sandbox";
  const podeEmitir = !!base && baseEmDia && base.bloqueios.length === 0 && (!sandbox || escolhas.confirmoTeste) && (base.origem !== "saldo_integral" || !!(escolhas.vencimento || base.vencimento.minimo));
  const previa = useMemo(() => (base?.previa && base.previa.modelo === "padrao" ? base.previa.texto : null), [base]);

  return (
    <Dialog open onOpenChange={o => { if (!o) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confissão de dívida — {base ? ROTULO_ORIGEM_DA_CONFISSAO[base.origem] : "lendo o ERP ao vivo…"}</DialogTitle>
          <DialogDescription>{sandbox ? `${SELO_SANDBOX}: nada é enviado ao cliente; o documento serve só para testar a integração.` : "Instrumento particular de confissão de dívida (CPC 784, III e §4º), assinado eletronicamente pelo ZapSign na conta do provedor. Nenhum valor é digitado: tudo vem do acordo ou do ERP ao vivo."}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-[12px] text-[var(--danger)]">{(error as Error).message}</p>}
        {base && (
          <div className="space-y-3 text-[12.5px]">
            {!baseEmDia && <p role="status" aria-live="polite" className="text-[11px] text-[var(--text-muted)]" data-testid="confissao-base-atualizando">Atualizando a prévia com o que foi escolhido…</p>}
            {base.bloqueios.length > 0 && <ul className="rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] p-2 text-[12px] text-[var(--danger)]" data-testid="confissao-bloqueios">{base.bloqueios.map(b => <li key={b}>• {b}</li>)}</ul>}
            {base.avisos.length > 0 && <ul className="rounded border border-[var(--gated-border)] bg-[var(--gated-bg)] p-2 text-[12px] text-[var(--gated)]" data-testid="confissao-avisos">{base.avisos.map(a => <li key={a}>• {a}</li>)}</ul>}
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded border border-[var(--border)] p-2"><p className="text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">valor confessado</p><p className={cn("text-[18px] font-medium", NUM)}>{brl(base.valorTotal)}</p>{base.encargos.multa + base.encargos.juros > 0 && <p className="text-[11px] text-[var(--text-muted)]">inclui multa {brl(base.encargos.multa)} e juros {brl(base.encargos.juros)} ({base.encargos.multaPct}% · {base.encargos.jurosMesPct}% a.m.) até a leitura</p>}</div>
              <div className="rounded border border-[var(--border)] p-2"><p className="text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">leitura do ERP</p><p className={NUM}>{base.erpLidoEm ? dataHoraBr(base.erpLidoEm) : "—"}</p><p className="text-[11px] text-[var(--text-muted)]">{base.erpSource ?? "sem ERP"}{base.dividaAtualDoErp !== null ? ` · saldo ${brl(base.dividaAtualDoErp)}` : ""}</p></div>
              <div className="rounded border border-[var(--border)] p-2"><p className="text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">custo desta emissão</p><p className="text-[11.5px]">{base.custo.texto}</p></div>
            </div>
            {base.origem === "saldo_integral" && (
              <label className="block">Vencimento do saldo integral (entre {dataBr(base.vencimento.minimo)} e {dataBr(base.vencimento.maximo)})
                <input type="date" className={cn(CONTROLE_CAMPO, "mt-1", NUM)} min={base.vencimento.minimo} max={base.vencimento.maximo} value={escolhas.vencimento || base.vencimento.minimo} onChange={e => setEscolhas(x => ({ ...x, vencimento: e.target.value }))} />
              </label>
            )}
            {base.anexo.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Anexo I — faturas lidas do ERP</p>
                <table className="w-full text-[11.5px]"><thead><tr className="text-left text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]"><th>ref.</th><th>descrição</th><th>venc.</th><th className="text-right">valor</th><th>natureza</th><th className="text-right">encargos</th><th /></tr></thead>
                  <tbody>{base.anexo.concat().map(f => (
                    <tr key={f.chave} className="border-t border-[var(--border-faint)]"><td className={NUM}>{f.erpRef}</td><td>{f.descricao ?? "—"}</td><td className={NUM}>{dataBr(f.vencimento)}</td><td className={cn("text-right", NUM)}>{brl(f.valor)}</td><td>{ROTULO_CLASSE_DA_FATURA[f.classe]}</td><td className={cn("text-right", NUM)}>{f.multa + f.juros > 0 ? brl(f.multa + f.juros) : "—"}</td>
                      <td className="text-right">{base.faturasDeSaida.includes(f.chave) && <button type="button" className="text-[11px] text-[var(--brand)] underline" onClick={() => alternarFatura(f.chave)}>desmarcar</button>}</td></tr>
                  ))}</tbody></table>
                {escolhas.faturasExcluidas.length > 0 && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Fora do título: {escolhas.faturasExcluidas.join(", ")} <button type="button" className="text-[var(--brand)] underline" onClick={() => setEscolhas(e => ({ ...e, faturasExcluidas: [] }))}>incluir de volta</button></p>}
              </div>
            )}
            {/* Os limites são os do GET da base: acima deles o servidor responderia 400 e o diálogo ficaria sem base. */}
            <div className="grid gap-2 sm:grid-cols-2">
              <label>E-mail do cliente<input type="email" maxLength={160} className={cn(CONTROLE_CAMPO, "mt-1")} value={escolhas.email} onChange={e => setEscolhas(x => ({ ...x, email: e.target.value }))} /></label>
              <label>Telefone (WhatsApp)<input maxLength={30} className={cn(CONTROLE_CAMPO, "mt-1", NUM)} value={escolhas.telefone} onChange={e => setEscolhas(x => ({ ...x, telefone: e.target.value }))} /></label>
              {base.cliente.pessoaJuridica && (<>
                <label>Representante legal · nome<input maxLength={160} className={cn(CONTROLE_CAMPO, "mt-1")} value={escolhas.representanteNome} onChange={e => setEscolhas(x => ({ ...x, representanteNome: e.target.value }))} /></label>
                <label>Representante legal · CPF<input maxLength={20} className={cn(CONTROLE_CAMPO, "mt-1", NUM)} value={escolhas.representanteCpf} onChange={e => setEscolhas(x => ({ ...x, representanteCpf: e.target.value }))} /></label>
              </>)}
            </div>
            {previa && <details className="rounded border border-[var(--border)] p-2"><summary className="cursor-pointer text-[12px] font-medium">Prévia do texto (modelo padrão v1.0{base.modeloRevisado ? "" : " — sem parecer jurídico"})</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-sans text-[11.5px] leading-4">{previa}</pre></details>}
            {base.previa && base.previa.modelo === "zapsign" && <p className="text-[11.5px] text-[var(--text-muted)]">Modelo do ZapSign {base.previa.templateId}: {base.previa.variaveis.length} variáveis preenchidas pelo servidor.</p>}
            {sandbox && <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={escolhas.confirmoTeste} onChange={e => setEscolhas(x => ({ ...x, confirmoTeste: e.target.checked }))} /> Entendo que é um TESTE sem validade jurídica e que nada será enviado ao cliente.</label>}
          </div>
        )}
        <DialogFooter>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Fechar</button>
          <button type="button" className={BOTAO_MARCA} disabled={!podeEmitir || emitir.isPending} onClick={() => emitir.mutate()} data-testid="confirmar-emissao">{emitir.isPending ? "Emitindo…" : isFetching ? "Lendo o ERP…" : "Emitir e enviar para assinatura"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
