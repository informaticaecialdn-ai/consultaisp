import type { CSSProperties } from "react";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kicker } from "./report-ui";
import CopiarBotao from "./CopiarBotao";
import type { ProtocoloDaOrigem } from "./identificacao";

export const DICA_DO_IDENTIFICADOR =
  "Identificador desta consulta. Em caso de erro ou dúvida, informe este código ao suporte.";

const dicaDaOrigem = (origem: string) =>
  `Protocolo emitido por ${origem}. Use este número quando o problema for no dado que ${origem} devolveu.`;

/**
 * O bloco "Identificação" no topo do relatório.
 *
 * Dois números convivem aqui e não são a mesma coisa — é por isso que cada um
 * tem rótulo próprio em vez de aparecerem como uma lista de códigos:
 *
 * · o **identificador desta consulta** (`CI-2609-K7F3M2`) é nosso, está gravado
 *   na linha e no log, e é o que o suporte do Consulta ISP procura;
 * · o **protocolo da origem** é do bureau (SPC Brasil, BigDataCorp) e só serve
 *   quando o problema é no dado que ELE devolveu. Escalar para o SPC com o
 *   nosso código não leva a lugar nenhum, e vice-versa.
 *
 * O código é mono, tabular e em 14px — tamanho de leitura, não de metadata: ele
 * existe para ser lido em voz alta ao telefone. O protocolo derivado antigo era
 * 10px na cor `--text-muted`, do tamanho de um selo, porque ninguém esperava
 * que servisse para alguma coisa.
 */
export default function IdentificacaoConsulta({
  consultaId, protocoloDaOrigem, style, testIdPrefixo = "identificacao",
}: {
  consultaId?: string | null;
  protocoloDaOrigem?: ProtocoloDaOrigem | null;
  style?: CSSProperties;
  testIdPrefixo?: string;
}) {
  // Consulta anterior a esta versão nasceu sem código, e não há nada honesto a
  // mostrar: o rótulo sozinho, com um traço ao lado, faria o operador achar que
  // o sistema perdeu o número.
  if (!consultaId && !protocoloDaOrigem) return null;

  return (
    <div
      style={{ display: "flex", alignItems: "flex-start", gap: 22, flexWrap: "wrap", ...style }}
      data-testid={testIdPrefixo}
    >
      {consultaId && (
        <Campo
          rotulo="Identificação"
          dica={DICA_DO_IDENTIFICADOR}
          valor={consultaId}
          rotuloDaCopia="identificador desta consulta"
          testId={`${testIdPrefixo}-consulta-id`}
        />
      )}
      {protocoloDaOrigem && (
        <Campo
          rotulo={`Protocolo em ${protocoloDaOrigem.origem}`}
          dica={dicaDaOrigem(protocoloDaOrigem.origem)}
          valor={protocoloDaOrigem.protocolo}
          rotuloDaCopia={`protocolo em ${protocoloDaOrigem.origem}`}
          testId={`${testIdPrefixo}-protocolo-origem`}
        />
      )}
    </div>
  );
}

function Campo({ rotulo, dica, valor, rotuloDaCopia, testId }: {
  rotulo: string;
  dica: string;
  valor: string;
  rotuloDaCopia: string;
  testId: string;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <Kicker>{rotulo}</Kicker>
        <Dica texto={dica} rotulo={rotuloDaCopia} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600,
            fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em",
            color: "var(--text)", overflowWrap: "anywhere",
          }}
          data-testid={testId}
        >
          {valor}
        </span>
        <CopiarBotao texto={valor} rotulo={rotuloDaCopia} testId={`${testId}-copiar`} />
      </div>
    </div>
  );
}

/** O ponto de interrogação que explica o campo. Radix, com o Provider já em App.tsx. */
function Dica({ texto, rotulo }: { texto: string; rotulo: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Botão, e não ícone solto: o tooltip precisa alcançar o teclado, e um
            `<span>` com `title` não recebe foco. */}
        <button
          type="button"
          aria-label={`O que é o ${rotulo}`}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 16, height: 16, padding: 0, borderRadius: 4,
            background: "transparent", border: "none",
            color: "var(--text-faint)", cursor: "help",
          }}
        >
          <HelpCircle size={12} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[280px] text-[12px] leading-relaxed">
        {texto}
      </TooltipContent>
    </Tooltip>
  );
}
