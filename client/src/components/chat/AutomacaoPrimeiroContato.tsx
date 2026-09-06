/**
 * Primeiros contatos automáticos — a configuração que o worker lê em
 * `server/services/chat/chat-primeiro-contato.service.ts`, e o que ele
 * efetivamente fez.
 *
 * O que a tela AFIRMA vem de lá: a rodada corre a cada minuto e inicia no
 * máximo 5 contatos por vez (`Math.min(5, limiteDiario - iniciadosHoje)`),
 * até o teto diário. Os dois números saem do servidor
 * (`GET /api/cobranca/indicadores/automacao`, que os lê do worker) e as
 * constantes daqui são só a reserva.
 *
 * O CONTADOR É O DO WORKER, não uma segunda conta: `hoje` vem de
 * `contatosIniciadosNoDia` — contato que SAIU pelo WhatsApp, na virada de dia
 * do fuso de São Paulo. Conversa reaproveitada não entra (nenhuma mensagem
 * saiu) e não gasta cota. O banco NÃO separa o disparo da rodada automática do
 * clique do operador em "Enviar p/ cobrança": os dois gravam o mesmo evento —
 * a tela diz isso em vez de fingir precisão. Quando a rota não tem de onde
 * contar, vem `null` com motivo e aqui aparece traço, nunca zero.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ALVO_TEXTO, CONTROLE_CAMPO, FOCO } from "@/components/painel/ui";
import { SeloCobranca, Traco } from "@/components/cobranca/ui";
import { API_INDICADOR_AUTOMACAO, lerAutomacaoDoPrimeiroContato, type EnvioDoPrimeiroContato } from "@/components/cobranca/tipos";
import { ROTULO_CANAL } from "@shared/cobranca";
import { lerAutomacaoChat } from "@shared/cobranca/automacao-chat";
import { BOTAO_CHAT_MARCA, NUM_CHAT } from "./PerfilDoCliente";

const API = "/api/chat-bullq/automacao";
/** Espelho do `Math.min(5, …)` do worker; não é configurável. Reserva: o servidor manda o valor. */
export const CONTATOS_POR_RODADA = 5;

const ROTULO_DA_ORIGEM: Record<string, string> = {
  cobranca: "Cobrança",
  equipamentos: "Equipamento",
};

/** Dia e hora curtos, como o resto da cobrança escreve. */
const quando = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const CAIXA = `${ALVO_TEXTO} gap-2 cursor-pointer`;
const MARCADOR = `h-4 w-4 rounded accent-[var(--brand)] ${FOCO}`;

export function AutomacaoPrimeiroContato({
  podeAdministrar,
}: {
  podeAdministrar: boolean;
}) {
  const query = useQuery({
    queryKey: [API],
    queryFn: async () =>
      lerAutomacaoChat(await (await apiRequest("GET", API)).json()),
  });
  /** O que o worker fez: contagem do dia, teto e o diário dos últimos envios. */
  const indicador = useQuery({
    queryKey: [API_INDICADOR_AUTOMACAO],
    queryFn: async () =>
      lerAutomacaoDoPrimeiroContato(await (await apiRequest("GET", API_INDICADOR_AUTOMACAO)).json()),
    staleTime: 60_000,
  });
  const qc = useQueryClient();
  const [config, setConfig] = useState(() => lerAutomacaoChat(null));
  const [datas, setDatas] = useState("");
  useEffect(() => {
    if (query.data) {
      setConfig(query.data);
      setDatas(query.data.diasPausados.join(", "));
    }
  }, [query.data]);
  const salvar = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("PUT", API, {
          ...config,
          diasPausados: datas.split(/[,\s]+/).filter(Boolean),
        })
      ).json(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [API] });
      // O teto mudou: o contador do dia precisa ser relido, senão a tela
      // continua mostrando "3 / 10" depois de o provedor baixar o teto para 5.
      await qc.invalidateQueries({ queryKey: [API_INDICADOR_AUTOMACAO] });
    },
    retry: false,
  });
  return (
    <section
      className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
      aria-label="Primeiros contatos automáticos"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">Primeiros contatos automáticos</h3>
        <p
          className="text-xs text-[var(--text-muted)]"
          data-testid="automacao-contatos-hoje"
        >
          Contatos de hoje{" "}
          {indicador.isPending ? (
            <Skeleton className="inline-block h-3 w-14 align-middle" />
          ) : (
            <span className={cn(NUM_CHAT, "text-[var(--text)]")}>
              {indicador.data?.hoje ?? (
                <Traco
                  titulo={
                    indicador.data?.motivo ??
                    "Não foi possível contar os contatos de hoje"
                  }
                />
              )}{" "}
              /{" "}
              {indicador.data?.limiteDiario ??
                query.data?.limiteDiario ?? <Traco titulo="Teto diário não carregado" />}
            </span>
          )}
        </p>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        O assistente inicia apenas casos ainda sem conversa, usando mensagens
        por contexto e tom DNA. A primeira resposta vai para a equipe. Respeita
        a janela da Política de Cobrança, feriados nacionais e datas pausadas
        abaixo. A rodada corre a cada minuto e inicia no máximo{" "}
        <span className={NUM_CHAT}>
          {indicador.data?.porRodada ?? CONTATOS_POR_RODADA}
        </span>{" "}
        contatos por vez, até o teto do dia.
      </p>
      <p className="text-xs text-[var(--text-faint)]">
        A contagem do dia é a mesma que o worker usa para decidir se ainda pode
        contatar: mensagem que <b>saiu</b> pelo WhatsApp, virada de dia no fuso
        de Brasília. Conversa já existente não entra — nada foi enviado. O
        registro não separa o disparo automático do botão “Enviar p/ cobrança”:
        os dois contam.
      </p>
      <fieldset
        disabled={
          !podeAdministrar ||
          query.isPending ||
          query.isError ||
          salvar.isPending
        }
        className="space-y-3 disabled:opacity-60"
      >
        <label className={cn(CAIXA, "text-sm")}>
          <input
            type="checkbox"
            className={MARCADOR}
            checked={config.ligada}
            onChange={(e) =>
              setConfig((c) => ({ ...c, ligada: e.target.checked }))
            }
          />
          Ativar primeiro contato automático
        </label>
        <div className="flex flex-wrap gap-4 text-xs">
          <label className={CAIXA}>
            <input
              type="checkbox"
              className={MARCADOR}
              checked={config.cobranca}
              onChange={(e) =>
                setConfig((c) => ({ ...c, cobranca: e.target.checked }))
              }
            />
            Cobrança
          </label>
          <label className={CAIXA}>
            <input
              type="checkbox"
              className={MARCADOR}
              checked={config.equipamentos}
              onChange={(e) =>
                setConfig((c) => ({ ...c, equipamentos: e.target.checked }))
              }
            />
            Recuperação de equipamentos
          </label>
        </div>
        {config.cobranca && (
          <div className="flex flex-wrap gap-4 text-xs">
            {(["ativo", "ex_cliente"] as const).map((carteira) => (
              <label key={carteira} className={CAIXA}>
                <input
                  type="checkbox"
                  className={MARCADOR}
                  checked={config.carteiras.includes(carteira)}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      carteiras: e.target.checked
                        ? [...c.carteiras, carteira]
                        : c.carteiras.filter((x) => x !== carteira),
                    }))
                  }
                />
                {carteira === "ativo" ? "Clientes ativos" : "Ex-clientes"}
              </label>
            ))}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="block">Limite de novos contatos por dia</span>
            <input
              type="number"
              min={1}
              max={100}
              value={config.limiteDiario}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  limiteDiario: Number(e.target.value),
                }))
              }
              className={cn(CONTROLE_CAMPO, NUM_CHAT)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block">
              Feriados locais e outras pausas (AAAA-MM-DD)
            </span>
            <input
              value={datas}
              onChange={(e) => setDatas(e.target.value)}
              placeholder="2026-12-24, 2026-12-31"
              className={cn(CONTROLE_CAMPO, NUM_CHAT)}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => salvar.mutate()}
          className={BOTAO_CHAT_MARCA}
        >
          {salvar.isPending ? "Salvando…" : "Salvar automação"}
        </button>
      </fieldset>

      <DiarioDeEnvios
        carregando={indicador.isPending}
        envios={indicador.data?.envios ?? []}
        motivo={
          indicador.isError
            ? "Não foi possível carregar os últimos envios."
            : indicador.data?.motivo ?? null
        }
      />
      {salvar.isSuccess && (
        <p role="status" className="text-xs text-[var(--ok)]">
          Configuração salva.{" "}
          {query.data?.ligada
            ? "O worker iniciará os casos elegíveis dentro da janela configurada."
            : "Primeiros contatos automáticos desligados."}
        </p>
      )}
      {(salvar.isError || query.isError) && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          Não foi possível salvar ou carregar a configuração. Confira o canal,
          as datas e o limite diário.
        </p>
      )}
    </section>
  );
}

/**
 * O diário: os últimos envios que SAÍRAM, mais recente primeiro. Mesma
 * definição do contador do dia — conversa reaproveitada não aparece porque não
 * existe como envio. Nome parcial (LGPD, mínimo necessário para reconhecer a
 * linha); a ficha inteira é o 360.
 *
 * Resultado em branco é o normal do primeiro contato: ele nasce sem desfecho e
 * ganha um quando o operador registra a resposta. Traço, nunca "sem sucesso".
 */
function DiarioDeEnvios({
  carregando,
  envios,
  motivo,
}: {
  carregando: boolean;
  envios: EnvioDoPrimeiroContato[];
  motivo: string | null;
}) {
  return (
    <div className="space-y-2" data-testid="automacao-diario">
      <h4 className="text-xs font-semibold text-[var(--text-2)]">
        Últimos envios
      </h4>
      {carregando ? (
        <div className="space-y-1.5" aria-busy>
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-7 w-full rounded" />
          ))}
        </div>
      ) : envios.length === 0 ? (
        <p className="text-xs text-[var(--text-faint)]">
          {motivo ?? "Nenhum primeiro contato saiu por aqui ainda."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">
                <th className="py-1.5 pr-3 font-medium">Quando</th>
                <th className="py-1.5 pr-3 font-medium">Cliente</th>
                <th className="py-1.5 pr-3 font-medium">Frente</th>
                <th className="py-1.5 pr-3 font-medium">Canal</th>
                <th className="py-1.5 font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {envios.map((e, i) => (
                <tr
                  key={`${e.em}-${i}`}
                  className="border-t border-[var(--border-faint)]"
                >
                  <td className={cn("py-1.5 pr-3 text-[var(--text-2)]", NUM_CHAT)}>
                    {quando(e.em)}
                  </td>
                  <td className="py-1.5 pr-3 text-[var(--text)]">{e.cliente}</td>
                  <td className="py-1.5 pr-3">
                    <SeloCobranca tom={e.origem === "equipamentos" ? "info" : "marca"}>
                      {ROTULO_DA_ORIGEM[e.origem] ?? e.origem}
                    </SeloCobranca>
                  </td>
                  <td className="py-1.5 pr-3 text-[var(--text-2)]">
                    {e.canal ? ROTULO_CANAL[e.canal as keyof typeof ROTULO_CANAL] ?? e.canal : <Traco titulo="Canal não registrado" />}
                  </td>
                  <td className="py-1.5 text-[var(--text-2)]">
                    {e.resultado ?? <Traco titulo="Primeiro contato ainda sem desfecho registrado" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
