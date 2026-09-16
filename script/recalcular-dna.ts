/**
 * Recalcula somente o snapshot de DNA dos casos vivos de um provedor.
 * Prévia: npx tsx script/recalcular-dna.ts --provider 1
 * Gravar: npx tsx script/recalcular-dna.ts --provider 1 --aplicar
 * Não inicia agendas, não sincroniza ERP e não executa ações da régua.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { classificarDnaDaCarteira, mesesDaRelacao, tomEfetivo, TOM_VULNERAVEL } from "../shared/cobranca/dna";
import type { Carteira } from "../shared/cobranca/estados";
import type { HistoricoDnaDaRelacao } from "../server/storage/faturas.storage";
import type { DnaDoCaso } from "../server/storage/cobranca.storage";

export interface OpcoesDoRecalculo { providerId: number; aplicar: boolean }
export interface CasoParaRecalculo {
  id: number;
  quadranteDna: string | null;
  tom: string | null;
  cliente: { id: number; statusErp: string; contractStartDate: string | null; diasAtraso: number; faturasAbertas: number };
}
export interface DependenciasDoRecalculo {
  comTrava<T>(chave: string, executar: () => Promise<T>): Promise<T | null>;
  historicos(providerId: number, hoje: Date): Promise<Map<number, HistoricoDnaDaRelacao>>;
  listar(providerId: number, pagina: number, porPagina: number): Promise<{ linhas: CasoParaRecalculo[]; total: number }>;
  atualizar(providerId: number, casoId: number, dna: DnaDoCaso): Promise<void>;
}

export function lerArgumentos(args: string[]): OpcoesDoRecalculo {
  let providerId: number | undefined;
  let aplicar = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--provider" && providerId === undefined && /^\d+$/.test(args[i + 1] ?? "")) {
      providerId = Number(args[++i]);
    } else if (args[i] === "--aplicar" && !aplicar) {
      aplicar = true;
    } else {
      throw new Error("Uso: npx tsx script/recalcular-dna.ts --provider N [--aplicar]");
    }
  }
  if (!Number.isSafeInteger(providerId) || !providerId || providerId <= 0) throw new Error("Informe um provedor válido com --provider N.");
  return { providerId, aplicar };
}

export async function recalcularDna(opcoes: OpcoesDoRecalculo, deps: DependenciasDoRecalculo, hoje = new Date()) {
  if (!Number.isSafeInteger(opcoes.providerId) || opcoes.providerId <= 0) throw new Error("Provedor inválido.");
  const resultado = await deps.comTrava(`dna-recalculo:${opcoes.providerId}`, async () => {
    const historicos = await deps.historicos(opcoes.providerId, hoje);
    // Lê todas as páginas antes das escritas para a paginação ficar estável.
    const casos: CasoParaRecalculo[] = [];
    const ids = new Set<number>();
    let terminou = false;
    for (let pagina = 1; pagina <= 500; pagina++) {
      const lote = await deps.listar(opcoes.providerId, pagina, 200);
      for (const caso of lote.linhas) {
        if (ids.has(caso.id)) throw new Error("A paginação repetiu um caso; recálculo interrompido antes de gravar.");
        ids.add(caso.id);
        casos.push(caso);
      }
      if (lote.linhas.length < 200 || casos.length >= lote.total) { terminou = true; break; }
    }
    if (!terminou) throw new Error("Limite de leitura atingido; recálculo interrompido antes de gravar.");
    const resumo = {
      providerId: opcoes.providerId, modo: opcoes.aplicar ? "aplicar" : "previa",
      examinados: casos.length, alteracoes: 0, aplicados: 0, semMudanca: 0,
      vulneraveisPreservados: 0, exClientesSemDna: 0,
      porCarteira: { ativo: { examinados: 0, alteracoes: 0 }, ex_cliente: { examinados: 0, alteracoes: 0 } },
      transicoes: {} as Record<string, number>,
    };
    for (const caso of casos) {
      const carteira: Carteira = ["active", "suspended"].includes(caso.cliente.statusErp) ? "ativo" : "ex_cliente";
      const h = historicos.get(caso.cliente.id);
      const meses = mesesDaRelacao(caso.cliente.contractStartDate, hoje, carteira, h?.encerramentoConfirmadoEm);
      const dna = meses === null ? null : classificarDnaDaCarteira({
        mesesComoCliente: meses, diasAtrasoMax: caso.cliente.diasAtraso, faturasAbertas: caso.cliente.faturasAbertas,
        historicoInsuficiente: h?.historicoInsuficiente ?? true,
        faturasPagas: h?.faturasPagas, faturasPagasComAtraso: h?.faturasPagasComAtraso,
      }, carteira);
      const vulneravel = caso.tom === TOM_VULNERAVEL;
      const novo: DnaDoCaso = { quadranteDna: dna?.quadrante ?? null, tom: tomEfetivo(dna, vulneravel), arbitrado: false };
      resumo.porCarteira[carteira].examinados++;
      if (vulneravel) resumo.vulneraveisPreservados++;
      if (carteira === "ex_cliente" && novo.quadranteDna === null) resumo.exClientesSemDna++;
      if (caso.quadranteDna === novo.quadranteDna && caso.tom === novo.tom) { resumo.semMudanca++; continue; }
      resumo.alteracoes++;
      resumo.porCarteira[carteira].alteracoes++;
      const transicao = `${carteira}: ${caso.quadranteDna ?? "sem DNA"}/${caso.tom ?? "sem tom"} → ${novo.quadranteDna ?? "sem DNA"}/${novo.tom ?? "sem tom"}`;
      resumo.transicoes[transicao] = (resumo.transicoes[transicao] ?? 0) + 1;
      if (opcoes.aplicar) {
        await deps.atualizar(opcoes.providerId, caso.id, novo);
        resumo.aplicados++;
      }
    }
    return resumo;
  });
  if (!resultado) throw new Error(`Recálculo do provedor ${opcoes.providerId} já está em andamento.`);
  return resultado;
}

async function executarCli() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  // Apenas .env local: não carrega ecosystem, rede do ERP ou configuração da VPS.
  await import("dotenv/config");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada neste ambiente.");
  const [{ pool }, { storage }, { FaturasStorage }, { comTravaDoChat }] = await Promise.all([
    import("../server/db"), import("../server/storage"), import("../server/storage/faturas.storage"), import("../server/services/chat/chat-trava"),
  ]);
  try {
    if (!await storage.getProvider(opcoes.providerId)) throw new Error("Provedor não encontrado neste ambiente.");
    const faturas = new FaturasStorage();
    const resumo = await recalcularDna(opcoes, {
      comTrava: comTravaDoChat,
      historicos: (providerId, hoje) => faturas.historicosDePagamentosDoProvedor(providerId, undefined, { paraDna: true, hoje }),
      listar: (providerId, pagina, porPagina) => storage.listarCasosDeCobranca(providerId, {}, { pagina, porPagina }),
      atualizar: async (providerId, casoId, dna) => {
        const atualizado = await storage.atualizarDnaDoCaso(providerId, casoId, dna, null);
        if (!atualizado) throw new Error(`Caso ${casoId} não encontrado ao atualizar DNA.`);
      },
    });
    process.stdout.write(`${JSON.stringify(resumo, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  executarCli().catch(() => {
    // Erro de conexão pode carregar credencial: não imprimir stack/objeto bruto.
    process.stderr.write("Não foi possível recalcular o DNA. Confira os argumentos, o provedor, a conexão local e a disponibilidade da trava.\n");
    process.exitCode = 1;
  });
}
