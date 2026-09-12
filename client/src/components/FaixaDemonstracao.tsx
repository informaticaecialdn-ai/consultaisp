/**
 * A faixa de demonstração — o aviso permanente de que esta conta é um sandbox
 * público, com dados fictícios e prazo de vida curto.
 *
 * POR QUE ELA EXISTE
 * A demonstração pública dá a qualquer visitante uma conta real, com dados que
 * PARECEM reais (clientes, faturas, casos de cobrança) — é assim que o produto
 * se prova sozinho. O preço dessa fidelidade é a confusão: sem um aviso que não
 * sai da tela, nada distingue esta conta de um provedor de verdade, e um
 * visitante pode tratar como fato o que é ficção (ou, ao contrário, desconfiar
 * do produto real por causa do que viu na demonstração). A faixa existe para
 * que essa dúvida nunca precise ser resolvida por adivinhação.
 *
 * DE ONDE VEM O SINAL
 * O servidor não expõe nenhum "estou em modo demo" ao navegador — `emModoDemo()`
 * (server/demo/modo-demo.ts) é deliberadamente a ÚNICA leitura de `DEMO_MODE`,
 * e só no servidor. O que a faixa usa é a identidade do PROVEDOR da sessão,
 * que `GET /api/auth/me` já entrega via `useAuth()`: todo sandbox nasce com um
 * subdomínio começando por `sandbox-` (`PREFIXO_SANDBOX`, em
 * server/demo/sandbox.service.ts) — a mesma convenção que a limpeza automática
 * usa para achar o que apagar. Um provedor de verdade nunca cai nesse prefixo
 * (`/api/auth/register` e `/api/auth/check-subdomain` o reservam), então o
 * sinal é tão confiável quanto a própria trava de identidade do sandbox.
 *
 * DE ONDE VEM O PRAZO
 * Não há coluna de expiração — o sandbox não passou por migração nenhuma (ver
 * CLAUDE.md e as regras do plano) e sua identidade inteira é convenção. O
 * prazo é o mesmo cálculo que a limpeza automática usa: `createdAt` do
 * provedor mais a vida do sandbox. `VIDA_DO_SANDBOX_MS` abaixo espelha a
 * constante de mesmo nome em `server/demo/sandbox.service.ts` — o client não
 * importa código de servidor, então se aquele valor mudar, este precisa
 * acompanhar.
 *
 * POR QUE NÃO TEM BOTÃO DE FECHAR
 * Pela mesma razão de `FaixaSuporte`: o que ela avisa não é um detalhe que
 * some depois de lido uma vez — é o contexto de toda a sessão.
 */
import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ALVO_TEXTO, FOCO } from "@/components/painel/ui";

/** Para onde o "Quero no meu provedor" leva — o cadastro do site real. */
export const URL_CADASTRO_REAL = "https://consultaisp.com.br/login?mode=register";

/**
 * Espelha `VIDA_DO_SANDBOX_MS` (server/demo/sandbox.service.ts). Repetida, e
 * não importada — client não importa código de servidor (aquele arquivo abre
 * conexão com o banco).
 */
const VIDA_DO_SANDBOX_MS = 24 * 60 * 60 * 1000;

/** Mesmo prefixo de `PREFIXO_SANDBOX` (server/demo/sandbox.service.ts), pelo mesmo motivo acima. */
const PADRAO_SUBDOMINIO_SANDBOX = /^sandbox-/;

/** A cada quanto tempo o texto de "expira em" se atualiza sozinho. */
const INTERVALO_DE_ATUALIZACAO_MS = 30_000;

/**
 * "23 h 42 min", "8 min", "a qualquer momento" — nunca negativo, nunca `NaN`
 * na tela. Minutos, não segundos: numa janela de 24h a casa dos segundos não
 * ajuda ninguém a decidir nada, só pisca.
 */
export function tempoRestanteEmTexto(ms: number): string {
  const totalMinutos = Math.max(0, Math.floor(ms / 60_000));
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  if (horas <= 0 && minutos <= 0) return "a qualquer momento";
  if (horas <= 0) return `${minutos} min`;
  return `${horas} h ${String(minutos).padStart(2, "0")} min`;
}

export function FaixaDemonstracao() {
  const { provider } = useAuth();

  // Sempre chamado, mesmo quando a faixa não vai renderizar nada — hooks não
  // podem depender de um `return` condicional antes deles.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), INTERVALO_DE_ATUALIZACAO_MS);
    return () => window.clearInterval(id);
  }, []);

  const ehSandbox = PADRAO_SUBDOMINIO_SANDBOX.test(provider?.subdomain ?? "");
  if (!ehSandbox) return null;

  const criadoEm = provider?.createdAt ? new Date(provider.createdAt).getTime() : null;
  const restanteMs = criadoEm != null && Number.isFinite(criadoEm)
    ? Math.max(0, criadoEm + VIDA_DO_SANDBOX_MS - agora)
    : null;

  return (
    <div
      role="region"
      aria-label="Demonstração"
      /* `shrink-0`: empurra o cabeçalho para baixo, nunca cobre — mesma lógica
         estrutural de `FaixaSuporte`, no mesmo lugar (a primeira linha da
         coluna de conteúdo, acima do cabeçalho fixo). */
      className="shrink-0 flex items-center gap-x-3 gap-y-1 flex-wrap px-3 py-2 bg-[var(--mock-bg)] text-[var(--text)] border-b border-[var(--border)]"
      data-testid="faixa-demonstracao"
    >
      <FlaskConical aria-hidden="true" className="w-4 h-4 shrink-0 text-[var(--mock)]" />
      <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
        <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.08em]">
          Demonstração — dados fictícios
        </span>
        <span className="text-[12.5px] text-[var(--text-muted)]">
          Sandbox exclusivo desta visita, sem dado real de nenhum provedor
          {restanteMs != null && (
            <>
              {" "}· expira em{" "}
              <span
                className="font-mono tabular-nums text-[var(--text)]"
                data-testid="text-demonstracao-restante"
              >
                {tempoRestanteEmTexto(restanteMs)}
              </span>
            </>
          )}
        </span>
      </div>

      <a
        href={URL_CADASTRO_REAL}
        target="_blank"
        rel="noopener noreferrer"
        className={`ml-auto shrink-0 ${ALVO_TEXTO} ${FOCO} px-3 rounded text-[12.5px] font-medium bg-[var(--action)] text-[var(--text-on-brand)] hover:opacity-90 motion-safe:transition-opacity active:scale-[0.97]`}
        data-testid="link-demonstracao-cadastro"
      >
        Quero no meu provedor
      </a>
    </div>
  );
}
