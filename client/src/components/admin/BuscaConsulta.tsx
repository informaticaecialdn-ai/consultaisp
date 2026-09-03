import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, FileSearch, AlertCircle, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Kicker, pillStyle, type Tone } from "@/components/consulta/report-ui";
import {
  codigoParaUrl, desfechoDaFicha, linhasDaFicha, mensagemDoErro,
  ROTULO_DO_TIPO, type FichaDeConsulta, type TomDoDesfecho,
} from "./consulta-por-codigo";

/**
 * A tela onde o suporte cola o codigo e ve a consulta.
 *
 * Existe porque o codigo sozinho e decoracao: o provedor liga dizendo "a
 * consulta CI-2609-K7F3M2 deu erro" e, ate aqui, nao havia nenhuma rota nem
 * nenhuma tela que aceitasse isso.
 *
 * A busca e MUTATION, nao query: e uma acao que quem atende dispara ao apertar
 * Enter, com o resultado descartado ao digitar outro codigo. `useQuery` guarda
 * o resultado por chave e reexecutaria sozinho — dois comportamentos que numa
 * caixa de busca aparecem como a ficha do chamado ANTERIOR reaparecendo na
 * tela enquanto se digita o proximo.
 *
 * A ficha NAO tem o relatorio da consulta, de proposito: ver o comentario de
 * LGPD em GET /api/admin/consultas?codigo=. Quem atende ve metadados e o
 * protocolo a apresentar ao bureau; o dado do titular fica onde esta.
 */

/** O tom do desfecho no vocabulario das primitivas do relatorio. */
const TOM_PARA_PILL: Record<TomDoDesfecho, Tone> = {
  ok: "ok",
  atencao: "gated",
  recusa: "past",
  neutro: "neutral",
};

export default function BuscaConsulta() {
  const [texto, setTexto] = useState("");

  const busca = useMutation<FichaDeConsulta, Error, string>({
    mutationFn: async (codigo: string) => {
      const res = await apiRequest("GET", `/api/admin/consultas?codigo=${encodeURIComponent(codigo)}`);
      return res.json();
    },
  });

  const procurar = () => {
    const codigo = codigoParaUrl(texto);
    // Caixa vazia nao dispara pedido: o servidor devolveria 404 da rota, e nao
    // o 400 que explica o formato — o operador leria a mensagem errada.
    if (!codigo) return;
    busca.mutate(codigo);
  };

  const ficha = busca.data;
  const impedido = busca.isPending || !codigoParaUrl(texto);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
      {/* Campo */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "16px 20px",
        }}
      >
        <Kicker>buscar consulta pelo código</Kicker>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px 0 12px" }}>
          O código que o provedor apresenta ao suporte. Pode colar como veio — minúsculas,
          com espaço ou sem traço.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search
              className="w-4 h-4"
              style={{
                position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
                color: "var(--text-faint)", pointerEvents: "none",
              }}
            />
            <input
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") procurar(); }}
              placeholder="CI-2609-K7F3M2"
              aria-label="Código da consulta"
              spellCheck={false}
              autoComplete="off"
              data-testid="input-busca-consulta"
              // `ds-input` traz a borda e o anel de foco: estilo inline nao
              // expressa :focus, e sem anel a navegacao por Tab fica cega.
              className="ds-input"
              style={{
                width: "100%", height: 44, paddingLeft: 34, paddingRight: 12,
                background: "var(--surface-inset)",
                borderRadius: 4,
                fontFamily: "var(--font-mono)", fontSize: 13,
                fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em",
                color: "var(--text)",
                textTransform: "uppercase",
              }}
            />
          </div>
          <button
            type="button"
            onClick={procurar}
            disabled={impedido}
            data-testid="button-busca-consulta"
            // `ds-ctl` da o anel de foco; `data-variant` so quando o botao age,
            // senao o hover de :hover pintaria de acao um controle desligado.
            className="ds-ctl"
            data-variant={impedido ? undefined : "primary"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              // 44px de altura: alvo de toque minimo do DESIGN_SYSTEM.
              height: 44, padding: "0 18px", borderRadius: 4,
              fontSize: 13, fontWeight: 500, fontFamily: "var(--font-sans)",
              background: impedido ? "var(--surface-3)" : "var(--action)",
              color: impedido ? "var(--text-faint)" : "var(--text-on-brand)",
              border: "1px solid transparent",
              cursor: impedido ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {busca.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" />Buscando</>
              : "Buscar"}
          </button>
        </div>
      </div>

      {/* Ocioso — o estado em que a aba abre */}
      {!busca.isPending && !busca.data && !busca.error && (
        <div
          data-testid="busca-consulta-ocioso"
          style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "36px 24px", textAlign: "center",
          }}
        >
          <FileSearch className="w-8 h-8" style={{ color: "var(--text-faint)", margin: "0 auto 10px" }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)", letterSpacing: "var(--track-tight)" }}>
            Nenhuma consulta aberta
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px auto 0", maxWidth: 460 }}>
            Cole o código que o provedor informou. A ficha mostra quando a consulta foi feita,
            quem a fez, quanto custou e qual protocolo apresentar à origem do dado.
          </p>
        </div>
      )}

      {/* Não encontrado e erro: a própria mensagem do servidor é o que ensina */}
      {busca.error && (
        <div
          data-testid="busca-consulta-erro"
          style={{
            background: "var(--gated-bg)", border: "1px solid var(--gated-border)",
            borderRadius: 8, padding: "16px 20px",
            display: "flex", gap: 11, alignItems: "flex-start",
          }}
        >
          <AlertCircle className="w-4 h-4 shrink-0" style={{ color: "var(--gated)", marginTop: 2 }} />
          <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>
            {mensagemDoErro(busca.error)}
          </p>
        </div>
      )}

      {/* A ficha */}
      {ficha && (
        <div
          data-testid="busca-consulta-ficha"
          style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "16px 20px", background: "var(--surface-2)",
              borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 12, flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <Kicker>identificação</Kicker>
              <div
                data-testid="text-ficha-codigo"
                style={{
                  fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 500,
                  fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em",
                  color: "var(--text)", marginTop: 3,
                }}
              >
                {ficha.consultaId}
              </div>
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              <span style={pillStyle("neutral")}>{ROTULO_DO_TIPO[ficha.tipo] ?? ficha.tipo}</span>
              <span style={pillStyle(TOM_PARA_PILL[desfechoDaFicha(ficha).tom])}>
                {desfechoDaFicha(ficha).texto}
              </span>
            </div>
          </div>

          <dl style={{ margin: 0 }}>
            {linhasDaFicha(ficha).map((linha, i) => (
              <div
                key={linha.rotulo}
                style={{
                  display: "grid", gridTemplateColumns: "minmax(120px, 200px) 1fr",
                  gap: 14, padding: "10px 20px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border-faint)",
                  alignItems: "baseline",
                }}
              >
                <dt
                  style={{
                    fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 500,
                    textTransform: "uppercase", letterSpacing: "var(--track-wide)",
                    color: "var(--text-faint)",
                  }}
                >
                  {linha.rotulo}
                </dt>
                <dd style={{ margin: 0, minWidth: 0 }}>
                  <span
                    style={{
                      fontFamily: linha.mono ? "var(--font-mono)" : "var(--font-sans)",
                      fontVariantNumeric: linha.mono ? "tabular-nums" : undefined,
                      fontSize: linha.mono ? 12.5 : 13,
                      color: "var(--text)",
                      wordBreak: "break-word",
                    }}
                  >
                    {linha.valor}
                  </span>
                  {linha.nota && (
                    <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginLeft: 8 }}>
                      {linha.nota}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <p
            style={{
              margin: 0, padding: "11px 20px",
              borderTop: "1px solid var(--border)", background: "var(--surface-2)",
              fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5,
            }}
          >
            O relatório da consulta não é exibido aqui: o código circula por e-mail e ticket, e
            ele identifica a consulta, não autoriza a leitura do dado do titular.
          </p>
        </div>
      )}
    </div>
  );
}
