import { useEffect, useRef, useState } from "react";
import { Copy, Check, X } from "lucide-react";
import { copiarTexto, retornoDaCopia, type EstadoDaCopia } from "./copiar";

/**
 * Copiar um valor curto, com retorno visível e honesto.
 *
 * O client tinha um `CopyButton` local dentro de `painel-provedor.tsx` (não
 * exportado) e mais seis chamadas soltas a `navigator.clipboard.writeText`,
 * todas assumindo sucesso. Aqui o estado tem TRÊS valores, não dois: parado,
 * copiado e NÃO copiado. O terceiro existe porque a cópia falha de verdade —
 * permissão negada, contexto inseguro — e um botão que diz "copiado" sem ter
 * copiado é pior que um botão que não faz nada: o operador cola outra coisa no
 * chamado do suporte e ninguém descobre o motivo.
 *
 * O rótulo do valor entra no `aria-label` porque a tela tem dois códigos lado a
 * lado (o desta consulta e o do bureau de origem): "Copiar" sozinho não diria a
 * quem usa leitor de tela qual dos dois o foco alcançou.
 */
export default function CopiarBotao({ texto, rotulo, testId }: {
  texto: string;
  /** O que se está copiando, como se fala: "identificador desta consulta". */
  rotulo: string;
  testId?: string;
}) {
  const [estado, setEstado] = useState<EstadoDaCopia>("parado");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sem isto o `setEstado` do temporizador dispara depois de o relatório sair do
  // DOM — é o que acontece assim que o operador faz outra consulta.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copiar = async () => {
    const ok = await copiarTexto(texto);
    const proximo: EstadoDaCopia = ok ? "copiado" : "falhou";
    setEstado(proximo);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setEstado("parado"), retornoDaCopia(proximo, rotulo).duracaoMs);
  };

  const r = retornoDaCopia(estado, rotulo);
  const Icone = estado === "copiado" ? Check : estado === "falhou" ? X : Copy;

  return (
    <button
      type="button"
      onClick={copiar}
      data-testid={testId}
      data-estado={estado}
      aria-label={r.aria}
      title={r.aria}
      className="ds-ctl ds-copiar"
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        // 4px: raio de botão do design system. Nunca pill.
        height: 24, padding: r.dito ? "0 7px" : "0 5px", borderRadius: 4,
        // O fundo mora na classe `.ds-copiar` (index.css), e nao aqui: estilo
        // inline vence seletor de classe tambem no `:hover`, e com
        // `background: transparent` inline o hover da folha de estilo era
        // regra morta — o botao nunca reagia ao ponteiro.
        border: "1px solid var(--border)",
        color: r.cor, cursor: "pointer", flexShrink: 0,
        fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "var(--track-wide)",
        lineHeight: 1, whiteSpace: "nowrap",
      }}
    >
      <Icone size={12} aria-hidden="true" />
      {/* A região `aria-live` fica SEMPRE no DOM, vazia enquanto não há o que
          dizer. Criada junto com o texto, ela não é anunciada: o leitor de tela
          precisa já estar observando o nó quando o conteúdo muda — uma região
          que nasce preenchida costuma passar em silêncio. O `aria-label`
          sozinho só seria relido se o foco voltasse ao botão. */}
      <span aria-live="polite">{r.dito ?? ""}</span>
    </button>
  );
}
