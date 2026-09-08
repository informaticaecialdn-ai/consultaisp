/**
 * A aba Conexões — as "tools" do Chat BullQ: o endereço-base e os headers que
 * as skills usam para sair.
 *
 * O header é CREDENCIAL. Ele sobe daqui e nunca volta: o servidor devolve só os
 * NOMES dos headers gravados. Por isso salvar sem digitar header nenhum mantém
 * os que já existem — a tela avisa isso em vez de apagar em silêncio.
 *
 * O host precisa estar liberado. A lista aparece na tela: sem ela, alguém
 * aponta a conexão para um servidor próprio e recebe a chave do header junto.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plug, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  BOTAO_MARCA, BOTAO_SECUNDARIO, Campo, CONTROLE_CAMPO, CONTROLE_CAMPO_MULTILINHA, EstadoVazio,
  LinhasSkeleton, MolduraModal, TITULO_MODAL,
} from "@/components/painel/ui";
import { mensagemDoErro, SeloCobranca } from "@/components/cobranca/ui";
import { cn } from "@/lib/utils";
import { hostPermitido, LIMITES_DO_CONSOLE, ToolDoConsoleSchema, type ToolDoConsole } from "@shared/chat-console";
import { API_TOOLS, invalidarConsole } from "./tipos";

const ERRO = "mt-1 text-[11px] text-[var(--danger)]";

interface Resposta { tools: ToolDoConsole[]; hostsPermitidos: string[] }

export function AbaConexoes({ podeAdministrar }: { podeAdministrar: boolean }) {
  const dados = useQuery<Resposta>({ queryKey: [API_TOOLS], staleTime: 20_000, retry: false });
  const [emEdicao, setEmEdicao] = useState<ToolDoConsole | null>(null);
  const [criando, setCriando] = useState(false);

  const tools = dados.data?.tools ?? [];
  const hosts = dados.data?.hostsPermitidos ?? [];

  return (
    <section className="space-y-4" data-testid="console-aba-conexoes">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[62ch] text-[12.5px] leading-5 text-[var(--text-2)]">
          Uma conexão é para onde as skills chamam: o endereço-base e a credencial no header.
          Várias skills usam a mesma conexão.
        </p>
        {podeAdministrar && (
          <button className={BOTAO_MARCA} onClick={() => setCriando(true)} data-testid="console-nova-conexao">
            <Plug className="h-3.5 w-3.5" aria-hidden /> Nova conexão
          </button>
        )}
      </div>

      {hosts.length > 0 && (
        <p className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2.5 text-[11.5px] leading-4 text-[var(--text-2)]">
          <span className="font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">hosts liberados</span>{" "}
          <span className="font-mono tabular-nums">{hosts.join(" · ")}</span>. Para liberar outro, fale com o suporte —
          a chave do header viaja nessa chamada.
        </p>
      )}

      {dados.isLoading ? <LinhasSkeleton linhas={2} />
        : dados.isError ? <p role="alert" className="text-[12.5px] text-[var(--danger)]">{mensagemDoErro(dados.error)}</p>
        : tools.length === 0 ? (
          <EstadoVazio Icone={Plug} titulo="Nenhuma conexão ainda"
            descricao="Cadastre o endereço que as skills vão chamar. Sem conexão nenhuma skill sai daqui." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {tools.map(t => (
              <article key={t.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5" data-testid={`console-conexao-${t.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate text-[13.5px] font-semibold leading-tight text-[var(--text)]">{t.nome}</h4>
                    <p className="mt-0.5 truncate font-mono text-[11px] tabular-nums text-[var(--text-muted)]" title={t.baseUrl ?? ""}>
                      {t.baseUrl ?? "—"}
                    </p>
                  </div>
                  <div className="flex flex-none flex-col items-end gap-1">
                    <SeloCobranca tom={t.ativa ? "ok" : "neutro"}>{t.ativa ? "ativa" : "desativada"}</SeloCobranca>
                    {t.daPonte && <SeloCobranca tom="info" titulo="É a conexão da cobrança com o Consulta ISP.">cobrança</SeloCobranca>}
                  </div>
                </div>
                <p className="mt-2 text-[12px] leading-4 text-[var(--text-2)]">{t.descricao}</p>
                <dl className="mt-2.5 grid grid-cols-[92px_1fr] gap-x-3 gap-y-1 text-[11.5px]">
                  <dt className="text-[var(--text-faint)]">headers</dt>
                  <dd className="truncate font-mono text-[var(--text-2)]">{t.headers.length ? t.headers.join(", ") : "nenhum"}</dd>
                  <dt className="text-[var(--text-faint)]">skills</dt>
                  <dd className="font-mono tabular-nums text-[var(--text-2)]">{t.skills}</dd>
                </dl>
                {podeAdministrar && !t.daPonte && (
                  <div className="mt-3 flex gap-1.5 border-t border-[var(--border-faint)] pt-3">
                    <button className={cn(BOTAO_SECUNDARIO, "h-8 flex-1 text-[11.5px]")} onClick={() => setEmEdicao(t)}>
                      <Pencil className="h-3 w-3" aria-hidden /> Editar
                    </button>
                    <BotaoApagarConexao tool={t} />
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

      {(criando || emEdicao) && (
        <DialogoConexao tool={emEdicao} hosts={hosts} onFechar={() => { setCriando(false); setEmEdicao(null); }} />
      )}
    </section>
  );
}

function BotaoApagarConexao({ tool }: { tool: ToolDoConsole }) {
  const { toast } = useToast();
  const [confirmando, setConfirmando] = useState(false);
  const apagar = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `${API_TOOLS}/${encodeURIComponent(tool.id)}`)).json(),
    onSuccess: () => { invalidarConsole(); toast({ title: "Conexão removida" }); },
    onError: (e) => toast({ title: "Não deu para remover", description: mensagemDoErro(e), variant: "destructive" }),
  });
  if (confirmando) {
    return (
      <span className="flex items-center gap-1">
        <button className={cn(BOTAO_SECUNDARIO, "h-8 text-[11px]")} onClick={() => setConfirmando(false)}>Não</button>
        <button className={cn(BOTAO_SECUNDARIO, "h-8 border-[var(--danger-border)] text-[11px] text-[var(--danger)]")}
          onClick={() => apagar.mutate()} disabled={apagar.isPending}>Remover</button>
      </span>
    );
  }
  return (
    <button className={cn(BOTAO_SECUNDARIO, "h-8 w-8 !px-0 text-[var(--text-muted)]")}
      aria-label={`Remover ${tool.nome}`} onClick={() => setConfirmando(true)}>
      <Trash2 className="h-3 w-3" aria-hidden />
    </button>
  );
}

/** Headers como texto `chave: valor`, uma por linha — é o formato que se lê e se cola. */
function lerHeaders(texto: string): { headers?: Record<string, string>; erro: string | null } {
  const linhas = texto.split("\n").map(l => l.trim()).filter(Boolean);
  if (!linhas.length) return { erro: null };
  const headers: Record<string, string> = {};
  for (const linha of linhas) {
    const corte = linha.indexOf(":");
    if (corte <= 0) return { erro: `Linha sem "chave: valor": ${linha.slice(0, 40)}` };
    const chave = linha.slice(0, corte).trim();
    const valor = linha.slice(corte + 1).trim();
    if (!chave || !valor) return { erro: `Linha incompleta: ${linha.slice(0, 40)}` };
    headers[chave] = valor;
  }
  if (Object.keys(headers).length > LIMITES_DO_CONSOLE.tool.headers) {
    return { erro: `No máximo ${LIMITES_DO_CONSOLE.tool.headers} headers` };
  }
  return { headers, erro: null };
}

function DialogoConexao({ tool, hosts, onFechar }: { tool: ToolDoConsole | null; hosts: string[]; onFechar: () => void }) {
  const { toast } = useToast();
  const editando = tool !== null;
  const [nome, setNome] = useState(tool?.nome ?? "");
  const [descricao, setDescricao] = useState(tool?.descricao ?? "");
  const [baseUrl, setBaseUrl] = useState(tool?.baseUrl ?? "https://");
  const [headersTexto, setHeadersTexto] = useState("");

  const headers = useMemo(() => lerHeaders(headersTexto), [headersTexto]);
  const veredito = useMemo(() => hostPermitido(baseUrl.trim(), hosts), [baseUrl, hosts]);
  const entrada = {
    nome: nome.trim(), descricao: descricao.trim(), baseUrl: baseUrl.trim(),
    ...(headers.headers ? { headers: headers.headers } : {}),
  };
  const validacao = useMemo(() => ToolDoConsoleSchema.safeParse(entrada), [nome, descricao, baseUrl, headersTexto]);
  const erroDe = (campo: string) =>
    validacao.success ? null : validacao.error.issues.find(i => i.path[0] === campo)?.message ?? null;
  const pronto = validacao.success && veredito.ok && !headers.erro;

  const salvar = useMutation({
    mutationFn: async () => {
      if (!validacao.success) throw new Error("Revise os campos do formulário");
      const r = editando
        ? await apiRequest("PATCH", `${API_TOOLS}/${encodeURIComponent(tool.id)}`, validacao.data)
        : await apiRequest("POST", API_TOOLS, validacao.data);
      return r.json();
    },
    onSuccess: () => { invalidarConsole(); toast({ title: editando ? "Conexão salva" : "Conexão criada" }); onFechar(); },
    onError: (e) => toast({ title: "Não deu para salvar", description: mensagemDoErro(e), variant: "destructive" }),
  });

  return (
    <MolduraModal rotulo={editando ? `Editar conexão ${tool.nome}` : "Nova conexão"} onFechar={onFechar}>
      <h2 className={TITULO_MODAL}>
        <Plug className="h-4 w-4 text-[var(--brand)]" aria-hidden /> {editando ? "Editar conexão" : "Nova conexão"}
      </h2>
      <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
        <Campo rotulo="nome">
          <input className={CONTROLE_CAMPO} value={nome} onChange={e => setNome(e.target.value)}
            maxLength={LIMITES_DO_CONSOLE.tool.nome.max} placeholder="Ex.: API do meu ERP" data-testid="conexao-nome" />
          {erroDe("nome") && <p className={ERRO}>{erroDe("nome")}</p>}
        </Campo>
        <Campo rotulo="descrição">
          <input className={CONTROLE_CAMPO} value={descricao} onChange={e => setDescricao(e.target.value)}
            maxLength={LIMITES_DO_CONSOLE.tool.descricao.max} placeholder="Para que serve, em uma frase" />
          {erroDe("descricao") && <p className={ERRO}>{erroDe("descricao")}</p>}
        </Campo>
        <Campo rotulo="endereço-base">
          <input className={cn(CONTROLE_CAMPO, "font-mono")} value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
            maxLength={LIMITES_DO_CONSOLE.tool.baseUrl} spellCheck={false} data-testid="conexao-base" />
          {!veredito.ok && baseUrl.trim().length > 8 && <p className={ERRO} data-testid="conexao-host-recusado">{veredito.motivo}</p>}
        </Campo>
        <Campo rotulo="headers (uma por linha, chave: valor)">
          <textarea className={cn(CONTROLE_CAMPO_MULTILINHA, "min-h-[80px] font-mono text-[12px]")} value={headersTexto}
            onChange={e => setHeadersTexto(e.target.value)} spellCheck={false}
            placeholder={"x-api-key: abc123\nContent-Type: application/json"} />
          {headers.erro && <p className={ERRO}>{headers.erro}</p>}
          <span className="font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
            {editando
              ? "Deixe vazio para manter os headers que já estão gravados. Preencher substitui todos."
              : "O valor é credencial: sobe daqui e não volta para a tela."}
          </span>
        </Campo>
        <div className="flex justify-end gap-2 border-t border-[var(--border-faint)] pt-3">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={BOTAO_MARCA} disabled={!pronto || salvar.isPending} data-testid="conexao-salvar">
            {salvar.isPending ? "Salvando…" : editando ? "Salvar conexão" : "Criar conexão"}
          </button>
        </div>
      </form>
    </MolduraModal>
  );
}
