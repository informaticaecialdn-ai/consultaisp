import { AlertTriangle } from "lucide-react";
import { Kicker } from "./report-ui";
import IdentificacaoConsulta from "./IdentificacaoConsulta";
import type { ErroDeConsulta } from "./identificacao";

/**
 * A consulta que falhou, na tela e com o código.
 *
 * Até aqui a falha existia só como toast: aparecia por cinco segundos e sumia.
 * É o pior lugar possível para pôr o identificador — o momento em que ele mais
 * serve é justamente este, e um número que desaparece antes de a pessoa abrir o
 * chamado não serve para nada. O card fica até a próxima consulta, e o código
 * pode ser copiado.
 *
 * O toast continua: ele avisa. Este card é o que se pode ler e copiar depois.
 */
export default function ConsultaErroCard({ erro, testId = "consulta-erro" }: {
  erro: ErroDeConsulta;
  testId?: string;
}) {
  return (
    <div
      style={{
        background: "var(--surface)", border: "1px solid var(--danger-border)",
        borderRadius: 10, overflow: "hidden",
      }}
      role="alert"
      data-testid={testId}
    >
      <div style={{
        padding: "16px 24px", display: "flex", alignItems: "flex-start", gap: 12,
        background: "var(--danger-bg)", borderBottom: "1px solid var(--danger-border)",
      }}>
        <AlertTriangle size={18} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <Kicker style={{ color: "var(--danger)" }}>Consulta não realizada</Kicker>
          <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.55, marginTop: 4 }}
            data-testid={`${testId}-mensagem`}>
            {erro.mensagem}
          </p>
        </div>
      </div>

      {erro.consultaId ? (
        <div style={{ padding: "14px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
          <IdentificacaoConsulta consultaId={erro.consultaId} testIdPrefixo={`${testId}-identificacao`} />
          <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            A tentativa ficou registrada com este código. Informe-o ao suporte para que a
            falha seja localizada sem precisar do documento consultado.
          </p>
        </div>
      ) : (
        /* Sem código não se promete rastreio: a falha pode ter acontecido antes
           de a requisição chegar ao servidor (rede, sessão), e aí não há o que
           procurar no log. */
        <div style={{ padding: "14px 24px" }}>
          <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Esta falha não recebeu identificador — provavelmente a requisição não chegou ao
            servidor. Tente novamente; persistindo, informe ao suporte o horário da tentativa.
          </p>
        </div>
      )}
    </div>
  );
}
