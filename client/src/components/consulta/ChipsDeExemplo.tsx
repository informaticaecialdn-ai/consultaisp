import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Users, Repeat } from "lucide-react";
import { Kicker } from "./report-ui";

/**
 * Os três CPFs de exemplo da demonstração pública (item 1 do plano de
 * 2026-09-11): um clique por história — limpo, devendo na rede, migrador
 * serial. `GET /api/demo/exemplos-cpf` só existe (200) para uma sessão de
 * sandbox; qualquer outra resposta (404 fora da demonstração, erro de rede)
 * faz este componente não renderizar nada — a tela de um provedor de
 * verdade nunca ganha um chip a mais por acidente.
 */
interface ExemploCpf {
  situacao: "limpo" | "devendo_na_rede" | "migrador_serial";
  cpf: string;
  rotulo: string;
  descricao: string;
}

const ICONE_POR_SITUACAO: Record<ExemploCpf["situacao"], typeof CheckCircle> = {
  limpo: CheckCircle,
  devendo_na_rede: Users,
  migrador_serial: Repeat,
};

/** "12345678900" -> "123.456.789-00" — só para exibição; a busca em si vai com os dígitos crus. */
function formatarCpf(cpf: string): string {
  return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

export default function ChipsDeExemplo({ onEscolher }: { onEscolher: (cpf: string) => void }) {
  const { data, isError } = useQuery<{ exemplos: ExemploCpf[] }>({
    queryKey: ["/api/demo/exemplos-cpf"],
  });

  // Sem dado (404 de fora da demonstração, ou a query ainda não voltou) ou
  // erro: nada aparece. Nunca um esqueleto de carregamento aqui — a barra de
  // busca acima já é utilizável sem isto.
  if (isError || !data?.exemplos?.length) return null;

  return (
    <div
      style={{
        display: "flex", flexWrap: "wrap", gap: 10,
        padding: "12px 14px", borderRadius: 8,
        border: "1px solid var(--border)", background: "var(--surface-2)",
      }}
      data-testid="chips-exemplo-demo"
    >
      <div style={{ width: "100%" }}>
        <Kicker>Demonstração · experimente com um clique</Kicker>
      </div>
      {data.exemplos.map((exemplo) => {
        const Icone = ICONE_POR_SITUACAO[exemplo.situacao];
        return (
          <button
            key={exemplo.situacao}
            type="button"
            className="ds-ctl"
            onClick={() => onEscolher(exemplo.cpf)}
            data-testid={`chip-exemplo-${exemplo.situacao}`}
            style={{
              display: "flex", flexDirection: "column", gap: 4, textAlign: "left",
              flex: "1 1 220px", minWidth: 200,
              padding: "10px 12px", borderRadius: 6, cursor: "pointer",
              border: "1px solid var(--border)", background: "var(--surface)",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
              <Icone size={14} style={{ color: "var(--brand)", flexShrink: 0 }} aria-hidden="true" />
              {exemplo.rotulo}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.4 }}>
              {exemplo.descricao}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)", fontSize: 12,
                fontVariantNumeric: "tabular-nums", color: "var(--text-2)",
              }}
              data-testid={`chip-exemplo-${exemplo.situacao}-cpf`}
            >
              {formatarCpf(exemplo.cpf)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
