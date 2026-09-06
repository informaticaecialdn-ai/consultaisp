/**
 * A autonomia do chat na aba Chat, travada pelo fonte (o vitest daqui nao
 * coleta .tsx): fala com as tres rotas certas, o admin e o unico que grava,
 * a fila mostra o traco quando a rota nao responde (nunca zero inventado),
 * o texto diz o que a IA NUNCA faz, e o componente esta montado na aba.
 * A leitura da fila e dos rotulos tem prova propria abaixo, em codigo.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lerConfigAutonomia, lerFilaDaAutonomia, O_QUE_A_IA_NUNCA_FAZ, ROTULOS_DA_FILA, STATUS_DA_FILA } from "@shared/chat-autonomia";

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), "utf8");
/** A fonte sem comentário — o que a tela realmente executa. */
const executavel = (fonte: string) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const tela = executavel(ler("./AutonomiaDoChat.tsx"));
const aba = executavel(ler("../painel/AbaChat.tsx"));

describe("AutonomiaDoChat", () => {
  it("le a configuracao e a fila, e grava, pelas rotas da autonomia", () => {
    expect(tela).toContain('export const API_AUTONOMIA = "/api/chat-bullq/autonomia";');
    expect(tela).toContain("export const API_AUTONOMIA_ESTADO = `${API_AUTONOMIA}/estado`;");
    expect(tela).toContain("useQuery<unknown>({ queryKey: [API_AUTONOMIA]");
    expect(tela).toContain("useQuery<unknown>({ queryKey: [API_AUTONOMIA_ESTADO]");
    expect(tela).toContain('apiRequest("PUT", API_AUTONOMIA, config)');
    expect(tela).not.toMatch(/fetch\(/);
  });
  it("oferece liga/desliga, os tipos de conversa, o maximo de rodadas e as tres permissoes", () => {
    expect(tela).toContain('data-testid="autonomia-ativa"');
    expect(tela).toContain("TIPOS_DE_AGENTE.map(tipo =>");
    expect(tela).toContain('data-testid="autonomia-max-turnos"');
    expect(tela).toContain("min={1} max={20}");
    for (const chave of ["permitirSegundaVia", "permitirPromessa", "permitirAgendamento"]) expect(tela).toContain(`chave: "${chave}"`);
    expect(tela).toContain('data-testid={`autonomia-${p.chave}`}');
  });
  it("so o administrador grava; a leitura e de todos", () => {
    expect(tela).toContain("const bloqueado = !podeAdministrar || estado.isPending || estado.isError || salvar.isPending;");
    expect(tela).toContain("<fieldset disabled={bloqueado}");
    expect(tela).toContain("só o administrador configura a autonomia");
  });
  it("a fila e contada por status, em mono tabular, e mostra o traco quando a rota nao respondeu", () => {
    expect(tela).toContain("STATUS_DA_FILA.map(s =>");
    expect(tela).toContain('{filaLida ? filaLida.porStatus[s] : "—"}');
    expect(tela).toMatch(/font-mono text-\[18px\] font-medium tabular-nums/);
    expect(tela).toContain('fila.isError ? "fila indisponível"');
    expect(tela).toContain("const filaLida = fila.data ? lerFilaDaAutonomia(fila.data) : null;");
  });
  it("diz, em portugues, o que a IA nunca faz — vindo da rota, com o catalogo como piso", () => {
    expect(tela).toContain('data-testid="autonomia-nunca"');
    expect(tela).toContain("O que a IA nunca faz, ligada ou não");
    expect(tela).toContain("nuncaDaRota(estado.data).map(item =>");
    expect(tela).toContain("Negativar, dar baixa e desconto fora da política são decisões do atendente.");
    expect(tela).toContain("o modelo só escolhe a intenção; texto, valor e data são do servidor");
  });
  it("carrega com esqueleto e respeita o sistema de desenho (sem paleta crua, sombra, pill ou 'Carregando')", () => {
    expect(tela).toContain("<LinhasSkeleton linhas={3} />");
    expect(tela).not.toMatch(/Carregando/);
    expect(tela).not.toMatch(/\b(?:bg|text|border)-(?:slate|gray|blue|emerald|red|green|amber|zinc|neutral)-\d{2,3}\b/);
    expect(tela).not.toMatch(/shadow-(?:md|lg|xl)/);
    expect(tela).not.toMatch(/rounded-(?:full|xl|2xl)/);
    expect(tela).not.toMatch(/localStorage|console\.log/);
  });
  it("esta montado na aba Chat do painel, com a permissao da aba", () => {
    expect(aba).toContain('import { AutonomiaDoChat } from "@/components/chat/AutonomiaDoChat";');
    expect(aba).toContain("<AutonomiaDoChat podeAdministrar={podeAdministrar} />");
  });
});

describe("a leitura compartilhada", () => {
  it("todo status tem rotulo em portugues", () => {
    for (const s of STATUS_DA_FILA) expect(ROTULOS_DA_FILA[s]).toMatch(/^[a-zà-ú ]+$/);
  });
  it("a fila so e aceita inteira: buraco ou numero invalido vira null (traco), nunca zero", () => {
    expect(lerFilaDaAutonomia(null)).toBeNull();
    expect(lerFilaDaAutonomia({ porStatus: { pendente: 1 } })).toBeNull();
    expect(lerFilaDaAutonomia({ porStatus: { pendente: 1, processando: 0, enviando: 0, concluido: "3", humano: 0, cancelado: 0 } })).toBeNull();
    expect(lerFilaDaAutonomia({ porStatus: { pendente: 1, processando: 0, enviando: 0, concluido: -1, humano: 0, cancelado: 0 } })).toBeNull();
    expect(lerFilaDaAutonomia({ porStatus: { pendente: 1, processando: 0, enviando: 0, concluido: 3, humano: 2, cancelado: 0 }, lidoEm: "2026-09-06T15:00:00.000Z" }))
      .toEqual({ porStatus: { pendente: 1, processando: 0, enviando: 0, concluido: 3, humano: 2, cancelado: 0 }, total: 6, lidoEm: "2026-09-06T15:00:00.000Z" });
  });
  it("a configuracao lida de lixo cai no padrao desligado; o catalogo do 'nunca' cobre negativar, baixar e desconto", () => {
    expect(lerConfigAutonomia(undefined)).toMatchObject({ ativa: false, maxTurnos: 12 });
    expect(lerConfigAutonomia({ ativa: true, maxTurnos: 99 })).toMatchObject({ ativa: false });
    expect(Object.keys(O_QUE_A_IA_NUNCA_FAZ)).toEqual(expect.arrayContaining(["negativar", "baixar", "desconto_fora_da_politica"]));
    for (const frase of Object.values(O_QUE_A_IA_NUNCA_FAZ)) expect(frase).toMatch(/^[a-zà-úA-Z ]{6,}$/);
  });
});
