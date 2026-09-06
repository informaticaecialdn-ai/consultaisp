/**
 * Primeiros contatos automáticos — a configuração que o worker lê em
 * `server/services/chat/chat-primeiro-contato.service.ts`.
 *
 * O que a tela AFIRMA vem de lá: a rodada corre a cada minuto e inicia no
 * máximo 5 contatos por vez (`Math.min(5, limiteDiario - iniciadosHoje)`),
 * até o teto diário. O teto é o campo gravado; os contatos já iniciados hoje
 * NÃO vêm em `GET /api/chat-bullq/automacao` (a rota devolve só a
 * configuração), então a tela mostra traço com o motivo — nunca zero.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ALVO_TEXTO, CONTROLE_CAMPO, FOCO } from "@/components/painel/ui";
import { Traco } from "@/components/cobranca/ui";
import { lerAutomacaoChat } from "@shared/cobranca/automacao-chat";
import { BOTAO_CHAT_MARCA, NUM_CHAT } from "./PerfilDoCliente";

const API = "/api/chat-bullq/automacao";
/** Espelho do `Math.min(5, …)` do worker; não é configurável. */
export const CONTATOS_POR_RODADA = 5;

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
          {query.isPending ? (
            <Skeleton className="inline-block h-3 w-14 align-middle" />
          ) : (
            <span className={cn(NUM_CHAT, "text-[var(--text)]")}>
              <Traco titulo="A rota de automação ainda não devolve quantos contatos o worker iniciou hoje" />{" "}
              / {query.data?.limiteDiario ?? <Traco titulo="Teto diário não carregado" />}
            </span>
          )}
        </p>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        O assistente inicia apenas casos ainda sem conversa, usando mensagens
        por contexto e tom DNA. A primeira resposta vai para a equipe. Respeita
        a janela da Política de Cobrança, feriados nacionais e datas pausadas
        abaixo. A rodada corre a cada minuto e inicia no máximo{" "}
        <span className={NUM_CHAT}>{CONTATOS_POR_RODADA}</span> contatos por
        vez, até o teto do dia.
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
