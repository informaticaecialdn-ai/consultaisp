import { cruzarIdentificadores } from "@shared/equipamentos/identificacao";
import type { EquipamentoDoCliente, SnapshotAoVivo } from "./tipos";

export function IdentificacaoTecnica({
  snapshot,
  equipamentos,
}: {
  snapshot?: SnapshotAoVivo;
  equipamentos: EquipamentoDoCliente[];
}) {
  const conexoes = snapshot?.cliente?.autenticacoes ?? [];
  const inventario = equipamentos.map((e) => ({
    id: e.id,
    mac: e.mac,
    serial: e.serie,
  }));
  const rotulos: Record<string, string> = {
    coincidencia: "Identificador coincide com o cadastro",
    ambiguo: "Mais de um equipamento: conferir identificação",
    conflito: "MAC e serial divergem: revisão necessária",
    nao_localizado: "Sem correspondência no inventário",
    sem_identificador: "Sem MAC ou serial para cruzar",
  };
  return (
    <section
      className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      aria-label="Autenticação e identificação do equipamento"
      data-testid="identificacao-tecnica"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--text)]">
          Autenticação e equipamento do cliente
        </h2>
        <p className="text-[10px] text-[var(--text-muted)]">
          {snapshot?.ok
            ? `${snapshot.erpSource} · lido em ${new Date(snapshot.lidoEm).toLocaleString("pt-BR")}`
            : "Aguardando leitura do ERP"}
        </p>
      </div>
      {!conexoes.length ? (
        <p className="text-xs text-[var(--text-muted)]">
          O ERP não informou dados de autenticação nesta leitura. Equipamentos
          cadastrados continuam disponíveis no inventário.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {conexoes.map((a, i) => {
            const cruzamento = cruzarIdentificadores(a, inventario);
            return (
              <article
                key={`${a.contrato}-${a.login}-${i}`}
                className="space-y-2 rounded-lg border border-[var(--border)] p-3 text-xs"
              >
                <div className="flex justify-between">
                  <strong className="break-all">
                    {a.login ?? "Login não informado"}
                  </strong>
                  <span>
                    {a.online === null
                      ? "Sessão não informada"
                      : a.online
                        ? "Online no ERP"
                        : "Offline no ERP"}
                  </span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt>Contrato</dt>
                  <dd>{a.contrato ?? "—"}</dd>
                  <dt>MAC</dt>
                  <dd className="break-all font-mono">{a.mac ?? "—"}</dd>
                  <dt>IP</dt>
                  <dd className="font-mono">{a.ip ?? "—"}</dd>
                  <dt>Serial</dt>
                  <dd className="font-mono">{a.serial ?? "—"}</dd>
                </dl>
                <p
                  className={
                    cruzamento.status === "conflito" ||
                    cruzamento.status === "ambiguo"
                      ? "text-[var(--gated)]"
                      : "text-[var(--text-muted)]"
                  }
                >
                  {rotulos[cruzamento.status]}
                  {cruzamento.ids.length
                    ? ` · #${cruzamento.ids.join(", #")}`
                    : ""}
                </p>
              </article>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-[var(--text-muted)]">
        OLT: sem leitura integrada. A coincidência de MAC ajuda a localizar o
        aparelho; confirme serial e vínculo antes da retirada. Dados antigos do
        inventário podem permanecer após cancelamento.
      </p>
    </section>
  );
}
