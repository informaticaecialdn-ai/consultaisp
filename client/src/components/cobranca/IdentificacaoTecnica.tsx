/**
 * CONEXÃO — a identificação técnica da instalação, no porte de cartão.
 *
 * Pedido do dono (06/09/2026): "criar mac da instalação que está conectado no
 * sistema". O bloco vive em DOIS lugares — o Cliente 360 e o painel do chat —
 * e é UM componente só (`BlocoConexao`), não duas cópias que divergem.
 *
 * A regra de ouro vale campo a campo: serial, MAC, login, IP e contrato saem
 * como vieram do ERP ou como traço COM o motivo no `title`. O estado da sessão
 * é `online === true|false|null` — e `null` é "sem leitura", nunca "offline":
 * ausência de leitura não é prova de que o cliente está fora do ar.
 *
 * "Bloqueada" é um selo SEPARADO, derivado do status do CONTRATO no ERP
 * (`suspended` = corte por atraso). Não é o estado da sessão, e por isso não
 * substitui o selo de sessão — os dois convivem, cada um com sua fonte.
 *
 * O selo de origem (`SeloOrigem`/`origemDoDado`) é a mesma regra nas duas
 * telas: "Dados reais" SÓ quando a leitura ao vivo respondeu e encontrou este
 * cliente; senão diz "Base sincronizada" e mostra a data da varredura. Nunca
 * "dados reais" sobre base sincronizada.
 */
// `jsx: preserve` no tsconfig: fora do Vite (o vitest, que renderiza este bloco
// em SSR para provar a regra do dado) o esbuild compila para `React.createElement`.
import * as React from "react";
import type { ReactNode } from "react";
import { Wifi } from "lucide-react";
import { cruzarIdentificadores, type AutenticacaoCliente } from "@shared/equipamentos/identificacao";
import { cn } from "@/lib/utils";
import { SeloCobranca, Traco, type TomDeSelo } from "./ui";
import type { EquipamentoDoCliente, SnapshotAoVivo } from "./tipos";

/* ── Origem do dado ────────────────────────────────────────────────────── */

export interface OrigemDoDado {
  /** `true` só quando a leitura ao vivo respondeu, encontrou o cliente e disse quando. */
  aoVivo: boolean;
  rotulo: string;
  tom: TomDeSelo;
  titulo: string;
  /** A data que o selo mostra ao lado do rótulo — nula quando ninguém mediu. */
  quando: string | null;
}

export const MOTIVO_SEM_ORIGEM =
  "Ninguém mediu: não houve leitura ao vivo e a base não guarda a data da varredura";

/** Data curta e legível; o que não for data válida não vira data inventada. */
export function quandoBr(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * A regra do selo de origem, isolada para poder ser provada:
 * ao vivo → "Dados reais"; varredura com data → "Base sincronizada · <data>";
 * sem data nenhuma → traço, nunca um rótulo que afirme medição.
 */
export function origemDoDado(entrada: {
  aoVivo: boolean;
  erpSource?: string | null;
  lidoEm?: string | null;
  motivo?: string | null;
  nota?: string | null;
}): OrigemDoDado {
  const quando = quandoBr(entrada.lidoEm);
  const erp = entrada.erpSource ? entrada.erpSource.toUpperCase() : "ERP";
  const nota = entrada.nota ? ` ${entrada.nota}` : "";
  if (entrada.aoVivo && quando) {
    return {
      aoVivo: true,
      rotulo: "Dados reais",
      tom: "ok",
      quando,
      titulo: `Leitura ao vivo do ${erp} em ${quando}.${nota}`,
    };
  }
  if (quando) {
    return {
      aoVivo: false,
      rotulo: "Base sincronizada",
      tom: "info",
      quando,
      titulo: `Números da varredura do ${erp} de ${quando} — não é leitura de agora.${entrada.motivo ? ` Leitura ao vivo: ${entrada.motivo}.` : ""}${nota}`,
    };
  }
  return { aoVivo: false, rotulo: "Origem —", tom: "neutro", quando: null, titulo: MOTIVO_SEM_ORIGEM };
}

/** A origem a partir do snapshot do 360 — quem chama não repete a regra. */
export function origemDoSnapshot(
  snapshot: SnapshotAoVivo | undefined,
  varredura?: { erpSource?: string | null; lidoEm?: string | null },
  nota?: string,
): OrigemDoDado {
  const respondeu = !!snapshot?.ok && !!snapshot.encontrado && !!snapshot.lidoEm;
  if (respondeu) return origemDoDado({ aoVivo: true, erpSource: snapshot!.erpSource, lidoEm: snapshot!.lidoEm, nota });
  const motivo = !snapshot
    ? "ainda não respondeu"
    : !snapshot.ok
      ? (snapshot.erro ?? "o ERP não respondeu")
      : "o ERP respondeu, mas não encontrou este cliente";
  return origemDoDado({ aoVivo: false, erpSource: varredura?.erpSource, lidoEm: varredura?.lidoEm, motivo, nota });
}

export function SeloOrigem({ origem, testId }: { origem: OrigemDoDado; testId?: string }) {
  return (
    <SeloCobranca tom={origem.tom} titulo={origem.titulo} testId={testId ?? "selo-origem"}>
      {origem.rotulo}
      {!origem.aoVivo && origem.quando && <span className="font-mono tabular-nums"> · {origem.quando}</span>}
    </SeloCobranca>
  );
}

/* ── Estado da sessão e do contrato ────────────────────────────────────── */

export interface EstadoDaConexao {
  rotulo: string;
  tom: TomDeSelo;
  motivo: string;
}

export function estadoDaConexao(online: boolean | null | undefined): EstadoDaConexao {
  if (online === true) return { rotulo: "Online", tom: "ok", motivo: "O ERP devolveu a sessão autenticada nesta leitura" };
  if (online === false) return { rotulo: "Offline", tom: "gated", motivo: "O ERP devolveu a sessão sem autenticação nesta leitura" };
  return { rotulo: "Sem leitura", tom: "neutro", motivo: "O ERP não devolveu o estado da sessão — ausência de leitura não é prova de que está fora do ar" };
}

/** `suspended` no ERP é corte por atraso: a instalação está bloqueada. Fato do CONTRATO, não da sessão. */
export function bloqueioDoContrato(statusContrato: string | null | undefined): EstadoDaConexao | null {
  return statusContrato === "suspended"
    ? { rotulo: "Bloqueada", tom: "past", motivo: "Contrato suspenso no ERP (corte por atraso) — estado do contrato, não da sessão" }
    : null;
}

/* ── Identificadores ───────────────────────────────────────────────────── */

/** `64DBF7ED1D24` → `64:DB:F7:ED:1D:24`. O que não for MAC de 48 bits sai como veio. */
export function formatarMac(mac: string | null | undefined): string | null {
  if (!mac) return null;
  const limpo = mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  return limpo.length === 12 ? (limpo.match(/.{2}/g) as string[]).join(":") : mac;
}

export const ROTULO_DO_CRUZAMENTO: Record<string, string> = {
  coincidencia: "Identificador coincide com o cadastro",
  ambiguo: "Mais de um equipamento: conferir identificação",
  conflito: "MAC e serial divergem: revisão necessária",
  nao_localizado: "Sem correspondência no inventário",
  sem_identificador: "Sem MAC ou serial para cruzar",
};

export const MOTIVO_SEM_MAC_CONEXAO = "O ERP não devolveu o MAC desta autenticação";
export const MOTIVO_SEM_SERIAL_CONEXAO = "O ERP não devolveu o serial da ONU desta autenticação";
export const MOTIVO_SEM_LOGIN = "O ERP não devolveu o login desta autenticação";
export const MOTIVO_SEM_IP = "O ERP não devolveu o IP desta autenticação";
export const MOTIVO_SEM_CONTRATO = "O ERP não vinculou esta autenticação a um contrato";

const MONO = "font-mono tabular-nums";

function Dado({ rotulo, valor, motivo, mono }: { rotulo: string; valor: string | null; motivo: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9.5px] font-medium uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]">{rotulo}</dt>
      <dd className={cn("mt-0.5 break-all text-[12px] text-[var(--text-2)]", mono && MONO)}>{valor ?? <Traco titulo={motivo} />}</dd>
    </div>
  );
}

export interface ItemDeInventario {
  id: number | string;
  mac?: string | null;
  serial?: string | null;
  rotulo?: string | null;
}

/* ── O cartão ──────────────────────────────────────────────────────────── */

export function BlocoConexao({
  conexoes,
  inventario,
  origem,
  statusContrato,
  denso,
  rodape,
  nivel = "h2",
  testId = "bloco-conexao",
}: {
  conexoes: AutenticacaoCliente[];
  inventario: ItemDeInventario[];
  origem: OrigemDoDado;
  statusContrato?: string | null;
  /** Coluna estreita (painel do chat): uma autenticação por linha, tipografia menor. */
  denso?: boolean;
  rodape?: ReactNode;
  /** O bloco entra em telas com hierarquias diferentes; o título acompanha o sumário de cada uma. */
  nivel?: "h2" | "h3" | "h4";
  testId?: string;
}) {
  const bloqueio = bloqueioDoContrato(statusContrato);
  const Titulo = nivel;
  return (
    <section
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--surface)]",
        denso ? "px-3 py-3" : "px-5 py-4",
      )}
      aria-label="Conexão e identificação da instalação"
      data-testid={testId}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Titulo className={cn("flex items-center gap-2 font-semibold text-[var(--text)]", denso ? "text-xs" : "text-[13.5px]")}>
          <Wifi aria-hidden className="h-3.5 w-3.5 text-[var(--text-muted)]" /> Conexão
        </Titulo>
        <SeloOrigem origem={origem} />
      </header>

      {!conexoes.length ? (
        <p className="text-[11.5px] text-[var(--text-muted)]" data-testid="conexao-sem-leitura">
          O ERP não devolveu login, MAC nem serial nesta leitura. Sem isso não há
          como identificar a instalação conectada — o inventário do cliente
          continua valendo como cadastro, não como leitura de agora.
        </p>
      ) : (
        <div className={cn("grid gap-2.5", !denso && "md:grid-cols-2")} data-testid="conexao-lista">
          {conexoes.map((a, i) => {
            const cruzamento = cruzarIdentificadores(a, inventario.map(e => ({ id: e.id, mac: e.mac, serial: e.serial })));
            const sessao = estadoDaConexao(a.online);
            const revisar = cruzamento.status === "conflito" || cruzamento.status === "ambiguo";
            const casados = inventario.filter(e => cruzamento.ids.includes(e.id));
            return (
              <article
                key={`${a.contrato ?? ""}-${a.login ?? ""}-${a.mac ?? ""}-${i}`}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
                data-testid="conexao-item"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[9.5px] font-medium uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]">ONU · serial</p>
                    <p className={cn("break-all font-semibold leading-tight text-[var(--text)]", denso ? "text-[13px]" : "text-[15px]", MONO)} data-testid="conexao-serial">
                      {a.serial ?? <Traco titulo={MOTIVO_SEM_SERIAL_CONEXAO} />}
                    </p>
                  </div>
                  <div className="flex flex-none flex-wrap items-center gap-1">
                    <SeloCobranca tom={sessao.tom} titulo={sessao.motivo} testId="conexao-estado">{sessao.rotulo}</SeloCobranca>
                    {bloqueio && <SeloCobranca tom={bloqueio.tom} titulo={bloqueio.motivo} testId="conexao-bloqueio">{bloqueio.rotulo}</SeloCobranca>}
                  </div>
                </div>
                <dl className={cn("mt-2.5 grid gap-x-3 gap-y-2", denso ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
                  <Dado rotulo="MAC" valor={formatarMac(a.mac)} motivo={MOTIVO_SEM_MAC_CONEXAO} mono />
                  <Dado rotulo="Login" valor={a.login} motivo={MOTIVO_SEM_LOGIN} />
                  <Dado rotulo="IP" valor={a.ip} motivo={MOTIVO_SEM_IP} mono />
                  <Dado rotulo="Contrato" valor={a.contrato} motivo={MOTIVO_SEM_CONTRATO} mono />
                </dl>
                <p
                  className={cn("mt-2 text-[11px]", revisar ? "text-[var(--gated)]" : "text-[var(--text-muted)]")}
                  data-testid="conexao-cruzamento"
                >
                  {ROTULO_DO_CRUZAMENTO[cruzamento.status]}
                  {casados.length ? (
                    <span className={MONO}> · {casados.map(e => e.rotulo ?? `#${e.id}`).join(", ")}</span>
                  ) : null}
                  {a.fonte ? <span className="text-[var(--text-faint)]"> · fonte {a.fonte}</span> : null}
                </p>
              </article>
            );
          })}
        </div>
      )}

      {rodape}
      <p className="mt-3 text-[11px] leading-[1.45] text-[var(--text-faint)]">
        OLT: sem leitura integrada. A coincidência de MAC ajuda a localizar o
        aparelho; confirme serial e vínculo antes da retirada. O inventário pode
        guardar aparelho antigo após o cancelamento.
      </p>
    </section>
  );
}

/* ── O bloco do Cliente 360 ────────────────────────────────────────────── */

export function IdentificacaoTecnica({
  snapshot,
  equipamentos,
  varredura,
  statusContrato,
}: {
  snapshot?: SnapshotAoVivo;
  equipamentos: EquipamentoDoCliente[];
  /** Quando e por qual ERP a base foi varrida — é o que o selo mostra sem leitura ao vivo. */
  varredura?: { erpSource?: string | null; lidoEm?: string | null };
  statusContrato?: string | null;
}) {
  const conexoes = snapshot?.cliente?.autenticacoes ?? [];
  const inventario: ItemDeInventario[] = equipamentos.map(e => ({
    id: e.id,
    mac: e.mac,
    serial: e.serie,
    rotulo: [e.tipo, e.modelo ?? e.marca].filter(Boolean).join(" ") || `#${e.id}`,
  }));
  return (
    <BlocoConexao
      conexoes={conexoes}
      inventario={inventario}
      origem={origemDoSnapshot(snapshot, varredura, "Serial, MAC, login e IP só existem na leitura ao vivo.")}
      statusContrato={statusContrato}
      testId="identificacao-tecnica"
    />
  );
}
