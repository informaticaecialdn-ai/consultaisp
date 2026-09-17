/**
 * Grava nos tres perfis do assistente de um provedor as FUNCIONARIAS do
 * Provedor.ai (spec docs/superpowers/specs/2026-09-16-funcionario-digital-design.md,
 * §8, D2 e D3): Clara (+ trechos da Bianca a partir de D+15) para clientes ativos,
 * Sofia para ex-clientes e Mariana (+ a doutrina de recuperacao de ativos) para
 * equipamentos — o TEXTO do Provedor.ai, montado por
 * `server/services/chat/personas-provedor-ai.ts` a partir de
 * `integrations/provedor-ai/origem/` e `adaptacoes.json`. Nada de persona escrita
 * aqui: quem quiser mudar o que a funcionaria recebe muda a origem ou as
 * adaptacoes, regenera os .md e ve o diff.
 *
 * Cada perfil recebe: descricao (a do YAML, adaptada), instrucoes (a persona),
 * nomeDaPersona (Clara, Leonora e Eduarda por padrao — os nomes do dono),
 * modelo openai/gpt-4.1, temperatura 0.3 e maxTokens 1000. O contexto operacional
 * (avisos do dia) e do provedor e fica como esta — com uma excecao: se ele e
 * exatamente o texto que a versao anterior deste script gravava, sai (as regras
 * dele ja estao na casa e na persona).
 *
 * Depois dos perfis, garante as skills da ponte no fork: cria
 * `consultarEquipamento` (GET /equipamento da API do agente) se faltar, atualiza
 * SO descricao e instrucao das tres existentes (rota, parametros, corpo e mapa de
 * resposta sao copiados da linha atual — o PATCH do fork e upsert do DTO inteiro),
 * liga o conjunto certo a cada perfil e marca aprovacao humana em
 * registrarPromessa. As skills nao rodam no motor autonomo; rodam so quando o
 * runner do fork executa o agente (canal AUTONOMOUS/COPILOT), que a ponte deixa
 * DISABLED. Idempotente: rodar de novo nao cria nada em dobro.
 *
 * Uso (na VPS, no checkout de producao):
 *   npx tsx script/configurar-personas-provedor-ai.ts <providerId>
 *   npx tsx script/configurar-personas-provedor-ai.ts <providerId> --nomes clara,sofia,mariana   # os nomes do Provedor.ai
 *   npx tsx script/configurar-personas-provedor-ai.ts <providerId> --versao-anterior             # a volta: as personas de c68c5211
 *   npx tsx script/configurar-personas-provedor-ai.ts --conferir    # sem banco: tamanhos e limites no pior caso
 *   npx tsx script/configurar-personas-provedor-ai.ts --gerar       # sem banco: regrava integrations/provedor-ai/personas/*.md
 *
 * `CHAT_BULLQ_PERSONAS_MODELO` troca o modelo dos tres (a bateria da spec §11 compara
 * modelos em agentes de TESTE, nunca nos vivos).
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { emModoDemo } from "../server/demo/modo-demo";
import { configurarAgenteDoChat, provisionarAgenteDoChat, listarAgentesDoChat, promptDoAgenteDoChat, promptFinalDoAgente } from "../server/services/chat/chat-agentes.service";
import { clienteDoChat, urlDaApiDoAgente } from "../server/services/chat/chat-ponte.service";
import { listarSkillsDoConsole, listarToolsDoConsole, skillsDoAgenteDoConsole } from "../server/services/chat/chat-console.service";
import {
  CONFIGURACAO_DAS_FUNCIONARIAS, DIRETORIO_PADRAO, NOMES_DO_DONO, PERSONAS_DE_ORIGEM, PERSONA_DO_TIPO,
  arquivoDaPersona, carregarFonteDasPersonas, montarDescricao, montarPersona, type NomesDasPersonas,
} from "../server/services/chat/personas-provedor-ai";
import { storage } from "../server/storage";
import { pool } from "../server/db";
import { AGENT_PROMPT_MAX, LIMITES_DO_AGENTE, NOME_DA_PERSONA_MAX, TIPOS_DE_AGENTE, type TipoDeAgente } from "@shared/chat-agentes";
import { nomesSegurosDaAbertura } from "@shared/chat-templates";

const MODELO = process.env.CHAT_BULLQ_PERSONAS_MODELO || CONFIGURACAO_DAS_FUNCIONARIAS.modelo;
const milhar = (n: number) => n.toLocaleString("pt-BR");

/* ── argumentos ──────────────────────────────────────────────────────────── */

function valorDe(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
/** `--nomes clara,sofia,mariana` na ordem ativos, ex-clientes, equipamentos. Minúsculas viram nome próprio. */
function lerNomes(): NomesDasPersonas {
  const bruto = valorDe("--nomes");
  if (bruto === undefined) return { ...NOMES_DO_DONO };
  const partes = bruto.split(",").map(s => s.trim());
  if (partes.length !== PERSONAS_DE_ORIGEM.length || partes.some(p => !p)) throw new Error("--nomes precisa de tres nomes separados por virgula: ativos,ex-clientes,equipamentos");
  const proprio = (s: string) => s.split(" ").map(p => p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1)).join(" ");
  return Object.fromEntries(PERSONAS_DE_ORIGEM.map((p, i) => [p, proprio(partes[i])])) as NomesDasPersonas;
}

/* ── a versão anterior (volta) ───────────────────────────────────────────── */

interface PersonasAnteriores {
  commit: string; modelo: string; temperatura: number; maxTokens: number;
  perfis: Record<TipoDeAgente, { descricao: string; instrucoes: string; contextoOperacional: string }>;
}
const ARQUIVO_ANTERIOR = path.join(DIRETORIO_PADRAO, "personas", "anteriores", "c68c5211.json");
function anteriores(): PersonasAnteriores {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), ARQUIVO_ANTERIOR), "utf8"));
}
const comProvedor = (texto: string, provedor: string) => texto.split("$PROVEDOR").join(provedor);

/* ── conferência e geração (sem banco) ───────────────────────────────────── */

/** Pior caso: nome de provedor no teto aceito pela casa, nome de funcionária no teto e avisos do dia no máximo. */
function conferir(nomes: NomesDasPersonas): boolean {
  const provedor = "Provedor de Internet Fibra Otica Exemplo Regional do Interior Paulista Ltda ME";
  if (nomesSegurosDaAbertura({ nomeCliente: "", nomeProvedor: provedor }).nomeProvedor !== provedor) throw new Error("o nome de provedor do pior caso nao passa na casa");
  const fonte = carregarFonteDasPersonas();
  let ok = true;
  console.log(`  adaptacoes ${fonte.versao}: ${fonte.adaptacoes.length} · teto do prompt final ${milhar(AGENT_PROMPT_MAX)} · limite das instrucoes ${milhar(LIMITES_DO_AGENTE.instrucoes)}`);
  for (const tipo of TIPOS_DE_AGENTE) {
    const instrucoes = montarPersona(tipo, { nomeProvedor: provedor, nomes });
    const descricao = montarDescricao(tipo, fonte);
    const final = promptFinalDoAgente(tipo, provedor, { instrucoes, contextoOperacional: "c".repeat(LIMITES_DO_AGENTE.contextoOperacional), nomeDaPersona: "N".repeat(NOME_DA_PERSONA_MAX) });
    const excesso = [
      descricao.length > LIMITES_DO_AGENTE.descricao && "descricao",
      instrucoes.length > LIMITES_DO_AGENTE.instrucoes && "instrucoes",
      final.caracteres > AGENT_PROMPT_MAX && "prompt final",
    ].filter(Boolean);
    console.log(`  ${tipo} (${nomes[PERSONA_DO_TIPO[tipo]]}): descricao=${descricao.length}c instrucoes=${milhar(instrucoes.length)}c casa=${milhar(final.caracteresDaCasa)}c prompt final no pior caso=${milhar(final.caracteres)}c${excesso.length ? `  !! ACIMA DO LIMITE: ${excesso.join(", ")}` : ""}`);
    if (excesso.length) ok = false;
  }
  const antes = anteriores();
  for (const tipo of TIPOS_DE_AGENTE) {
    const p = antes.perfis[tipo];
    if (!p || comProvedor(p.instrucoes, provedor).length > LIMITES_DO_AGENTE.instrucoes) { console.log(`  !! versao anterior ${tipo} ausente ou acima do limite`); ok = false; }
  }
  console.log(`  versao anterior (${antes.commit.slice(0, 8)}) legivel para --versao-anterior`);
  return ok;
}

function gerar() {
  const fonte = carregarFonteDasPersonas();
  const dir = path.resolve(process.cwd(), DIRETORIO_PADRAO, "personas");
  mkdirSync(dir, { recursive: true });
  for (const tipo of TIPOS_DE_AGENTE) {
    const arquivo = path.join(dir, `${tipo}.md`);
    writeFileSync(arquivo, arquivoDaPersona(tipo, fonte), "utf8");
    console.log(`  gravado ${path.relative(process.cwd(), arquivo)}`);
  }
}

/* ── as skills da ponte, como o console mostra ───────────────────────────── */

const TELEFONE = { type: "string", minLength: 10, maxLength: 15, description: "Telefone do cliente com DDD, so digitos (ex.: 5543999990000). Copie do campo Telefone do contexto." };
const SKILL_EQUIPAMENTO = {
  nome: "consultarEquipamento",
  descricao: "Lê no Consulta ISP a devolução de equipamento pendente do cliente pelo telefone: qual aparelho (tipo, marca, modelo, final da série), o prazo, se já existe retirada combinada, a forma de devolução e a instrução do que fazer. Nunca traz valor do aparelho, multa ou dívida. Chame SEMPRE antes de combinar qualquer coisa; se `encontrado` for false ou `caso` for nulo, não trate de aparelho.",
  categoria: "equipamentos",
  promptInstructions: "Use consultarEquipamento com o telefone do contexto (só dígitos) antes de falar do aparelho. Siga o campo `instrucao`. Se houver retirada combinada, confirme-a; se o cliente contestou, transfira.",
  parameters: { type: "object", required: ["telefone"], properties: { telefone: TELEFONE }, additionalProperties: false },
  httpMethod: "GET" as const,
  httpPath: "/equipamento?telefone={{input.telefone}}&conversaId={{ctx.conversationId}}",
  responseMap: { ok: "$.ok", encontrado: "$.encontrado", cliente: "$.cliente", caso: "$.caso", instrucao: "$.instrucao" },
  timeoutMs: 10_000,
};
/** Descricoes no padrao dos agentes do Provedor.ai (o que faz, quando chamar, o que nunca faz). So descricao e instrucao mudam. */
const DESCRICOES: Record<string, { descricao: string; promptInstructions: string }> = {
  consultarCaso: {
    descricao: "Lê no Consulta ISP a situação de cobrança do cliente pelo telefone: valor em aberto e há quantos dias (datado da última leitura do ERP), quantas faturas, etapa da régua, tom do DNA, as ofertas que a política do provedor autoriza para este caso, promessa já aberta e a instrução do que fazer. Chame SEMPRE antes de citar qualquer informação do contrato; se `encontrado` for false, não cobre. Não substitui a conferência ao vivo do saldo, que é do servidor.",
    promptInstructions: "Use consultarCaso com o telefone do contexto (só dígitos) antes de falar de valor. Siga o campo `instrucao` e ofereça somente o que vier em `acordo.ofertas`. Se `encontrado` for false, não cobre.",
  },
  registrarPromessa: {
    descricao: "Registra no Consulta ISP a promessa de pagamento que o cliente confirmou nesta conversa: a data (AAAA-MM-DD) e, quando combinado, o valor integral. O caso passa a esperar essa data e a equipe a vê na fila. Chame só depois do sim explícito do cliente, uma vez por combinado; se já existe promessa aberta, não registre outra.",
    promptInstructions: "Antes de registrarPromessa, repita data e valor e espere o cliente confirmar. Data no formato AAAA-MM-DD. Não registre a mesma promessa duas vezes.",
  },
  registrarTransferencia: {
    descricao: "Passa a conversa para a equipe do provedor e registra no caso o motivo padronizado (pagamento informado, contestação, dificuldade, pedido de atendente, técnico, equipamento, confissão de dívida, fora da política) e um resumo factual do que o cliente disse, sem opinião. Chame sempre que uma porta de transferência se abrir e ao final de um combinado que a equipe precisa executar.",
    promptInstructions: "Ao transferir, informe o motivo em poucas palavras e um resumo factual; depois encerre com o cliente dizendo que a equipe continua.",
  },
};
const SKILLS_DO_PERFIL: Record<TipoDeAgente, string[]> = {
  cobranca_ativos: ["consultarCaso", "registrarPromessa", "registrarTransferencia"],
  cobranca_ex_clientes: ["consultarCaso", "registrarPromessa", "registrarTransferencia"],
  recuperacao_equipamentos: ["consultarEquipamento", "registrarTransferencia"],
};
const EXIGE_APROVACAO = new Set(["registrarPromessa"]);

const g = (o: unknown, k: string) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);

async function garantirSkillsDaPonte(providerId: number) {
  console.log("\n== skills da ponte no fork");
  const c = clienteDoChat();
  const intg = await storage.getIntegracaoDoChat(providerId);
  if (!c || !intg) throw new Error("ponte indisponivel");
  const org = intg.organizationId;
  const { tools } = await listarToolsDoConsole(providerId);
  const tool = tools.find(t => t.daPonte) ?? tools.find(t => (t.baseUrl ?? "").replace(/\/+$/, "") === urlDaApiDoAgente());
  if (!tool) throw new Error("conexao da ponte (API do agente) nao encontrada no fork — a integracao ainda nao foi provisionada");
  console.log(`  conexao: ${tool.nome} (${tool.baseUrl}) headers=[${tool.headers.join(",")}] skills=${tool.skills}`);
  const lerSkills = async () => {
    const r = await c.listarSkills(org);
    if (!r.ok) throw new Error("nao foi possivel listar as skills: " + r.erro);
    const porNome = new Map<string, Record<string, unknown>>();
    for (const s of r.valor as unknown[]) if (typeof g(s, "name") === "string" && !g(s, "deletedAt")) porNome.set(g(s, "name") as string, s as Record<string, unknown>);
    return porNome;
  };
  let porNome = await lerSkills();
  if (!porNome.has(SKILL_EQUIPAMENTO.nome)) {
    const criada = await c.criarSkill(org, { ...SKILL_EQUIPAMENTO, toolId: tool.id, changeNote: "Skill do perfil de equipamentos" });
    if (!criada.ok) throw new Error("nao foi possivel criar consultarEquipamento: " + criada.erro);
    console.log(`  criada ${SKILL_EQUIPAMENTO.nome} id=${criada.valor.id}`);
    porNome = await lerSkills();
  } else console.log(`  ${SKILL_EQUIPAMENTO.nome} ja existe id=${porNome.get(SKILL_EQUIPAMENTO.nome)!.id}`);

  for (const [nomeDaSkill, d] of Object.entries(DESCRICOES)) {
    const s = porNome.get(nomeDaSkill);
    if (!s) { console.log(`  !! ${nomeDaSkill} nao existe no fork — pulada`); continue; }
    if (s.description === d.descricao && s.promptInstructions === d.promptInstructions) { console.log(`  ${nomeDaSkill}: descricao ja atualizada`); continue; }
    const corpo: Record<string, unknown> = {
      name: s.name, description: d.descricao, source: "HTTP", toolId: s.toolId ?? tool.id, parameters: s.parameters ?? { type: "object", properties: {} },
      httpMethod: s.httpMethod, httpPath: s.httpPath, promptInstructions: d.promptInstructions, isActive: true, changeNote: "Descricao no padrao dos agentes do Provedor.ai",
      ...(s.category ? { category: s.category } : {}), ...(s.httpBodyTemplate ? { httpBodyTemplate: s.httpBodyTemplate } : {}),
      ...(s.responseMap ? { responseMap: s.responseMap } : {}), ...(typeof s.timeoutMs === "number" ? { timeoutMs: s.timeoutMs } : {}),
    };
    const r = await c.atualizarSkill(org, String(s.id), corpo);
    console.log(`  ${nomeDaSkill}: ${r.ok ? "descricao atualizada (nova versao)" : "!! NAO atualizada: " + r.erro}`);
  }

  console.log("\n== vinculos e aprovacao");
  const { agentes } = await listarAgentesDoChat(providerId);
  for (const [tipo, nomes] of Object.entries(SKILLS_DO_PERFIL) as [TipoDeAgente, string[]][]) {
    const a = agentes.find(x => x.tipo === tipo);
    if (!a?.id) { console.log(`  !! ${tipo} sem id no fork`); continue; }
    const ids = nomes.map(n => porNome.get(n)?.id).filter((id): id is string => typeof id === "string");
    if (ids.length !== nomes.length) { console.log(`  !! ${tipo}: skill faltando (${nomes.join(",")})`); continue; }
    const lig = await c.ligarSkillsAoAgente(org, a.id, ids);
    if (!lig.ok) { console.log(`  !! ${tipo}: vinculo falhou: ${lig.erro}`); continue; }
    for (const n of nomes) {
      const ap = await c.definirAprovacaoDaSkill(org, a.id, porNome.get(n)!.id as string, EXIGE_APROVACAO.has(n));
      if (!ap.ok) console.log(`  !! ${tipo}/${n}: aprovacao nao gravada: ${ap.erro}`);
    }
    const { ligadas } = await skillsDoAgenteDoConsole(providerId, a.id);
    console.log(`  ${tipo} (${a.id}): ${ligadas.map(l => l.nome + (l.exigeAprovacao ? "[aprovacao]" : "")).join(", ")}`);
  }
  const { skills } = await listarSkillsDoConsole(providerId);
  for (const s of skills) console.log(`  skill ${s.nome} v${s.versao} ${s.metodo} ${s.caminho} daPonte=${s.daPonte} agentes=${s.agentes.length} desc=${s.descricao.length}c`);
}

/* ── principal ───────────────────────────────────────────────────────────── */

async function main() {
  const nomes = lerNomes();
  if (process.argv.includes("--gerar")) { gerar(); return; }
  if (process.argv.includes("--conferir")) {
    if (!conferir(nomes)) process.exit(1);
    console.log("  (so conferencia, sem banco)");
    return;
  }
  const providerId = Number(process.argv[2]);
  if (!Number.isInteger(providerId) || providerId <= 0) throw new Error("uso: npx tsx script/configurar-personas-provedor-ai.ts <providerId> [--nomes a,b,c] [--versao-anterior] | --conferir | --gerar");
  if (emModoDemo()) throw new Error("recusado: instancia de demonstracao");
  const provedor = await storage.getProvider(providerId);
  if (!provedor) throw new Error(`provedor ${providerId} nao encontrado`);
  const nomeCru = provedor.tradeName || provedor.name;
  const voltar = process.argv.includes("--versao-anterior");

  console.log(`== provedor ${providerId}${voltar ? " — VOLTA para as personas de c68c5211" : ""}`);
  const { agentes: atuais } = await listarAgentesDoChat(providerId);
  const antes = anteriores();

  console.log("\n== perfis");
  for (const tipo of TIPOS_DE_AGENTE) {
    const atual = atuais.find(a => a.tipo === tipo)!;
    let cfg: Parameters<typeof configurarAgenteDoChat>[2];
    if (voltar) {
      const p = antes.perfis[tipo];
      cfg = { modelo: antes.modelo, descricao: comProvedor(p.descricao, nomeCru), instrucoes: comProvedor(p.instrucoes, nomeCru), contextoOperacional: comProvedor(p.contextoOperacional, nomeCru), habilitado: true, temperatura: antes.temperatura, maxTokens: antes.maxTokens, nomeDaPersona: null };
    } else {
      // A persona leva o mesmo nome de provedor que a casa: se a casa o recusaria ("seu provedor"), a persona ficaria com dois nomes.
      const seguro = nomesSegurosDaAbertura({ nomeCliente: "", nomeProvedor: nomeCru }).nomeProvedor;
      if (seguro !== nomeCru.trim()) throw new Error("o nome fantasia do provedor nao passa na regra de nome seguro da abertura; ajuste o cadastro antes de gravar as personas");
      const textoAnterior = comProvedor(antes.perfis[tipo].contextoOperacional, nomeCru);
      cfg = {
        modelo: MODELO,
        descricao: montarDescricao(tipo),
        instrucoes: montarPersona(tipo, { nomeProvedor: seguro, nomes }),
        nomeDaPersona: nomes[PERSONA_DO_TIPO[tipo]],
        habilitado: true,
        temperatura: CONFIGURACAO_DAS_FUNCIONARIAS.temperatura,
        maxTokens: CONFIGURACAO_DAS_FUNCIONARIAS.maxTokens,
        // Avisos do dia sao do provedor. So sai o texto que a versao anterior deste script gravava ali.
        ...(atual.contextoOperacional === textoAnterior ? { contextoOperacional: "" } : {}),
      };
    }
    const salvo = await configurarAgenteDoChat(providerId, tipo, cfg);
    const prov = await provisionarAgenteDoChat(providerId, tipo);
    console.log(`  ${tipo}: nome=${salvo.nomeDaPersona ?? "-"} modelo=${salvo.modelo} instrucoes=${milhar(salvo.instrucoes.length)}c salvo etapa=${salvo.etapa} -> provisionado etapa=${prov.etapa} id=${prov.id} erro=${prov.erro ?? "-"}`);
  }

  await garantirSkillsDaPonte(providerId);

  console.log("\n== conferencia final");
  for (const tipo of TIPOS_DE_AGENTE) {
    const prompt = await promptDoAgenteDoChat(providerId, tipo);
    console.log(`  prompt final ${tipo}: ${milhar(prompt.caracteres)} caracteres (casa ${milhar(prompt.caracteresDaCasa)}) de ${milhar(prompt.limite)}${prompt.caracteres > prompt.limite ? "  !! ACIMA DO TETO — o planejador recusa" : ""}`);
  }
}
main().then(() => pool.end()).catch(async (e) => { console.error("ERRO: " + (e instanceof Error ? e.message : String(e))); await pool.end().catch(() => {}); process.exit(1); });
