/**
 * O console RENDERIZADO — as cinco abas montadas de verdade.
 *
 * Existe porque foi olhando isto que apareceu o bug que nenhum teste de unidade
 * pegava: `useLocation` do wouter devolve só o caminho, então ler `?aba=` de
 * dentro dele deixava a tela presa na Visão geral. Os cinco botões apareciam e
 * nenhum trocava o corpo — sem erro, sem aviso, sem falha de teste.
 *
 * Com `PREVIA_AGENTES_SAIDA` apontando para um arquivo, ele também grava o HTML
 * das cinco abas lado a lado, para conferência visual sem precisar de sessão.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { name: "Emerson", role: "admin" }, provider: { name: "NsLink" } }) }));

const SAIDA = process.env.PREVIA_AGENTES_SAIDA ?? "";

async function paginaEmHtml(caminho: string, busca: string, semear: (qc: QueryClient) => void) {
  const { AbaAgentesDeIa } = await import("../painel/AbaAgentesDeIa");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  semear(qc);
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc },
      createElement(Router, { ssrPath: caminho, ssrSearch: busca }, createElement(AbaAgentesDeIa, { podeAdministrar: true }))),
  );
  qc.clear();
  return html;
}

describe("prévia do console", () => {
  it("desenha as cinco abas e o corpo de cada uma", async () => {
    const agentes = {
      agentes: [
        {
          id: "ag-1", nome: "Cobrança · primeiro contato", descricao: "Abre o contato do dia seguindo a régua.",
          tipo: "WORKER", categoria: "recuperação", capacidades: [], modelo: "openai/gpt-4o-mini",
          instrucoes: "…", contextoOperacional: null, contextoAtualizadoEm: null, temperatura: 0.3, maxTokens: 600,
          respondeDireto: false, ativo: true, reportaA: null, departamento: "COBRANCA", squad: "squad inadimplência",
          criadoEm: null, atualizadoEm: null, canais: [{ id: "c1", canalId: "ch1", nome: "WhatsApp NsLink", modo: "COPILOT", gatilho: "ALWAYS" }],
          daPonte: true,
        },
        {
          id: "ag-2", nome: "Suporte nível 1", descricao: null, tipo: "ORCHESTRATOR", categoria: null,
          capacidades: [], modelo: "openai/gpt-4o", instrucoes: "…", contextoOperacional: null,
          contextoAtualizadoEm: null, temperatura: 0.4, maxTokens: 800, respondeDireto: true, ativo: false,
          reportaA: "ag-1", departamento: "SUPORTE", squad: null, criadoEm: null, atualizadoEm: null,
          canais: [], daPonte: false,
        },
      ],
    };
    const skills = {
      skills: [{
        id: "s-1", nome: "consultarCaso", descricao: "Lê o caso do cliente no Consulta ISP antes de citar valor.",
        categoria: "cobrança", instrucoes: null, origem: "HTTP", parametros: {}, toolId: "t-1",
        toolNome: "API do Consulta ISP", metodo: "POST", caminho: "/caso", corpo: null, timeoutMs: 10000,
        versao: 2, ativa: true, agentes: [{ id: "ag-1", nome: "Cobrança · primeiro contato" }], daPonte: true,
      }],
    };
    const tools = {
      tools: [{
        id: "t-1", nome: "API do Consulta ISP", descricao: "As skills do caso, da promessa e da transferência.",
        baseUrl: "https://consultaisp.com.br/api/chat-bullq/agente", headers: ["x-agente-chave"], ativa: true,
        skills: 3, daPonte: true,
      }],
      hostsPermitidos: ["consultaisp.com.br"],
    };

    const abas: Record<string, [string, unknown][]> = {
      cobranca: [],
      resumo: [["/api/chat-bullq/console/resumo?periodo=7d", {
        periodo: "7d",
        execucoes: { total: 128, concluidas: 121, falhas: 5, puladas: 2, taxaSucesso: 0.945 },
        tokens: 412_300, custoUsd: 0.9126, custoMedioUsd: 0.0071,
        latencia: { p50: 1840, p95: 4210 },
        porAgente: [{ agenteId: "ag-1", nome: "Cobrança · primeiro contato", execucoes: 118, tokens: 380_000, custoUsd: 0.84 }],
        porDesfecho: { TRANSFERRED_TO_HUMAN: 96, REPLIED: 25, NO_ACTION: 7 },
        ferramentas: [{ nome: "consultarCaso", chamadas: 118 }, { nome: "registrarTransferencia", chamadas: 96 }],
      }]],
      agentes: [["/api/chat-bullq/console/agentes", agentes]],
      skills: [["/api/chat-bullq/console/skills", skills], ["/api/chat-bullq/console/tools", tools]],
      conexoes: [["/api/chat-bullq/console/tools", tools]],
      execucoes: [["/api/chat-bullq/console/execucoes?periodo=7d&soComErro=0", {
        execucoes: [
          {
            id: "r-1", agenteId: "ag-1", agenteNome: "Cobrança · primeiro contato", conversaId: "cv-1",
            modelo: "openai/gpt-4o-mini", status: "COMPLETED", desfecho: "TRANSFERRED_TO_HUMAN", erro: null,
            tokens: 3120, custoUsd: 0.0071, duracaoMs: 2140, iniciadaEm: "2026-09-07T12:31:00.000Z",
            chamadas: [{ id: "tc1", ferramenta: "consultarCaso", erro: null, duracaoMs: 210, falhou: false }],
            falhasDeFerramenta: 0,
          },
          {
            id: "r-2", agenteId: "ag-1", agenteNome: "Cobrança · primeiro contato", conversaId: "cv-2",
            modelo: "openai/gpt-4o-mini", status: "COMPLETED", desfecho: "REPLIED", erro: null,
            tokens: 2880, custoUsd: 0.0064, duracaoMs: 5390, iniciadaEm: "2026-09-07T11:02:00.000Z",
            chamadas: [{ id: "tc2", ferramenta: "consultarCaso", erro: "HTTP 502", duracaoMs: 9800, falhou: true }],
            falhasDeFerramenta: 1,
          },
        ],
      }]],
    };

    /**
     * A MARCA de cada aba: um trecho que SÓ o corpo daquela aba imprime.
     *
     * A primeira versão deste teste afirmava `toContain("Agentes de IA")` por
     * aba — o título do cabeçalho, que sai igual nas cinco. Com a aba travada
     * na Visão geral ele passava cinco vezes e o teste ficava verde justamente
     * na regressão que ele diz existir para pegar. Cada render agora tem que
     * conter a própria marca e NENHUMA das outras.
     */
    const MARCA: Record<string, string> = {
      cobranca: 'data-testid="console-operacao-cobranca"',
      resumo: 'data-testid="console-kpi-sucesso"',
      agentes: 'data-testid="console-agente-ag-2"',
      skills: 'data-testid="console-skill-consultarCaso"',
      conexoes: 'data-testid="console-conexao-t-1"',
      execucoes: 'data-testid="console-execucao-r-1"',
    };

    const partes: string[] = [];
    for (const [aba, dados] of Object.entries(abas)) {
      const html = await paginaEmHtml("/painel-provedor", `tab=agentes&aba=${aba}`, qc => {
        qc.setQueryData(["/api/chat-bullq/integracao"], { ligado: true });
        for (const [chave, valor] of dados) qc.setQueryData([chave], valor);
      });
      expect(html, `?aba=${aba} não renderizou o corpo da própria aba`).toContain(MARCA[aba]);
      for (const [outra, marca] of Object.entries(MARCA)) {
        if (outra !== aba) expect(html, `?aba=${aba} renderizou o corpo de ${outra}`).not.toContain(marca);
      }
      expect(html).toContain("Agentes de IA");
      partes.push(`<section class="previa"><h2 class="previa-titulo">?aba=${aba}</h2>${html}</section>`);
    }

    expect(partes.join("")).toContain("Cobrança · primeiro contato");

    if (SAIDA) {
      mkdirSync(dirname(SAIDA), { recursive: true });
      writeFileSync(SAIDA, `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600;700&display=swap">
<link rel="stylesheet" href="http://localhost:${process.env.PREVIA_AGENTES_PORTA ?? 61179}/src/index.css?direct">
<style>body{margin:0;background:var(--bg)}.previa{border-top:2px dashed var(--border-strong)}.previa-titulo{font:500 11px/1 "IBM Plex Mono",monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);padding:14px 24px 0}</style>
${partes.join("\n")}`, "utf8");
    }
  });
});
