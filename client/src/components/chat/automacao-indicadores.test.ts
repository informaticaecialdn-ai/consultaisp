import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DIAS_DA_RECUPERACAO,
  ROTULO_ORIGEM_DO_CONTATO,
  lerAutomacaoDoPrimeiroContato,
  lerRecuperacao,
} from "@/components/cobranca/tipos";

/**
 * O QUE A AUTOMACAO FEZ E QUANTO A COBRANCA RECUPEROU — o contrato das duas
 * telas (fase 3; C6 e C8 do 2Safe).
 *
 * O vitest daqui nao monta .tsx, entao o contrato e travado pelo FONTE: a tela
 * consome a rota que o servidor publica, e nao uma copia escrita a mao (foi um
 * caminho divergente que fez a tela de cobertura "funcionar" nos testes e nao
 * funcionar no navegador). Os leitores `ler*` sao logica pura e rodam de
 * verdade.
 *
 * A regra que mais importa aqui e a do dono: AUSENCIA DE DADO E TRACO. O
 * contador de contatos e o valor recuperado nascem nulos, e a tela precisa
 * mostrar "—" com o motivo — nunca zero, que afirmaria que a equipe nao fez
 * nada e que nada foi recuperado.
 */
const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), "utf8");
const painel = ler("./AutomacaoPrimeiroContato.tsx");
const kanban = ler("../../pages/cobranca/kanban.tsx");
const tipos = ler("../cobranca/tipos.ts");
const rota = ler("../../../../server/routes/cobranca-indicadores.routes.ts");
const montagem = ler("../../../../server/routes/index.ts");

describe("os dois lados falam do mesmo endereco", () => {
  it("as constantes do client sao as rotas que o servidor publica", () => {
    expect(tipos).toContain('export const API_INDICADOR_AUTOMACAO = "/api/cobranca/indicadores/automacao"');
    expect(tipos).toContain('export const API_INDICADOR_RECUPERACAO = "/api/cobranca/indicadores/recuperacao"');
    expect(rota).toContain('export const API_AUTOMACAO = "/api/cobranca/indicadores/automacao"');
    expect(rota).toContain('export const API_RECUPERACAO = "/api/cobranca/indicadores/recuperacao"');
  });

  it("o router esta montado — rota que ninguem monta e 404 com cara de SPA", () => {
    expect(montagem).toContain('import { registerCobrancaIndicadoresRoutes } from "./cobranca-indicadores.routes"');
    expect(montagem).toContain("app.use(registerCobrancaIndicadoresRoutes());");
  });

  it("as duas rotas exigem sessao de provedor", () => {
    const chamadas = Array.from(rota.matchAll(/router\.get\(([^,]+), ([^)]+)\)/g)).map(m => m[2]);
    expect(chamadas).toHaveLength(2);
    for (const c of chamadas) expect(c).toContain("requireAuth, requireProvider");
  });
});

describe("o contador da automacao", () => {
  it("a tela le a rota nova, e nao inventa a contagem no navegador", () => {
    expect(painel).toContain("API_INDICADOR_AUTOMACAO");
    expect(painel).toContain("lerAutomacaoDoPrimeiroContato(");
    // Contar no cliente seria somar `envios` — que e so o diario dos ultimos 20.
    expect(painel).not.toMatch(/envios\.length \/|envios\.filter\(.*\)\.length/);
  });

  it("sem contagem, traco COM MOTIVO — e nunca zero", () => {
    expect(painel).toContain("indicador.data?.hoje ?? (");
    expect(painel).toContain("<Traco");
    expect(painel).toContain("indicador.data?.motivo ??");
    expect(painel).not.toContain("hoje ?? 0");
  });

  it("a tela afirma o teto por rodada com o numero do servidor, e nao um chute", () => {
    expect(painel).toContain("indicador.data?.porRodada ?? CONTATOS_POR_RODADA");
    expect(rota).toContain("export const CONTATOS_POR_RODADA = 5;");
    expect(rota).toContain("export const SEGUNDOS_ENTRE_RODADAS = 60;");
  });

  it("o diario mostra quando, quem, frente, canal e resultado", () => {
    for (const coluna of ["Quando", "Cliente", "Frente", "Canal", "Resultado"]) {
      expect(painel).toContain(`>${coluna}<`);
    }
    // Carga demorada e skeleton, nunca "Carregando...".
    expect(painel).toContain("<Skeleton");
    expect(painel).not.toContain("Carregando");
  });

  it("o texto diz o que o dado NAO separa: automacao e clique do operador contam juntos", () => {
    expect(painel).toMatch(/n[aã]o separa o disparo autom[aá]tico/i);
  });
});

describe("lerAutomacaoDoPrimeiroContato", () => {
  it("resposta cheia entra inteira", () => {
    const r = lerAutomacaoDoPrimeiroContato({
      provisionado: true, ligada: true, dia: "2026-09-06", hoje: 3, limiteDiario: 12,
      motivo: null, porRodada: 5, segundosEntreRodadas: 60,
      envios: [{ em: "2026-09-06T13:00:00.000Z", origem: "cobranca", canal: "whatsapp", cliente: "Ana ***", resultado: null }],
    });
    expect(r).toMatchObject({ provisionado: true, ligada: true, hoje: 3, limiteDiario: 12, porRodada: 5 });
    expect(r.envios[0]).toEqual({ em: "2026-09-06T13:00:00.000Z", origem: "cobranca", canal: "whatsapp", cliente: "Ana ***", resultado: null });
  });

  it("nulo continua nulo: zero seria uma afirmacao que o servidor nao fez", () => {
    const r = lerAutomacaoDoPrimeiroContato({ provisionado: false, hoje: null, limiteDiario: null, motivo: "chat nao provisionado" });
    expect(r.hoje).toBeNull();
    expect(r.limiteDiario).toBeNull();
    expect(r.motivo).toBe("chat nao provisionado");
    expect(r.envios).toEqual([]);
  });

  it("lixo nao derruba a tela: rota antiga, array, nulo", () => {
    for (const cru of [null, undefined, [], "x", { envios: [{ semData: 1 }] }]) {
      const r = lerAutomacaoDoPrimeiroContato(cru);
      expect(r.hoje).toBeNull();
      expect(r.envios).toEqual([]);
    }
  });
});

describe("lerRecuperacao", () => {
  it("base falsa preserva o motivo e nao inventa valor", () => {
    const r = lerRecuperacao({ base: false, motivo: "Nenhuma fatura veio do ERP", valor: null, faturas: null, clientes: null, porOrigem: [], porCanal: [] });
    expect(r.base).toBe(false);
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe("Nenhuma fatura veio do ERP");
  });

  it("base verdadeira sem valor NAO e base: o traco e o padrao", () => {
    expect(lerRecuperacao({ base: true, valor: null }).base).toBe(false);
  });

  it("rotula origem e canal para leitura humana", () => {
    const r = lerRecuperacao({
      base: true, valor: 1234.5, faturas: 9, clientes: 6, dias: 30, janelaDias: 7,
      porOrigem: [{ chave: "assistente", valor: 834.5, faturas: 6, clientes: 4 }],
      porCanal: [{ chave: "whatsapp", valor: 1234.5, faturas: 9, clientes: 6 }],
    });
    expect(r.porOrigem[0].rotulo).toBe(ROTULO_ORIGEM_DO_CONTATO.assistente);
    expect(r.porCanal[0].rotulo).toBe("WhatsApp");
    expect(r.valor).toBe(1234.5);
  });
});

describe("o quinto indicador do kanban", () => {
  it("le a rota com o periodo escrito, e nao soma nada na pagina", () => {
    expect(kanban).toContain("apiRecuperacao(DIAS_DA_RECUPERACAO)");
    expect(kanban).toContain("lerRecuperacao(recuperacaoCrua)");
    expect(tipos).toContain("export const DIAS_DA_RECUPERACAO = 30;");
  });

  it("e uma celula da faixa, com o periodo e o escopo NO ROTULO", () => {
    /*
     * A faixa compacta (06/09/2026) trocou os cards por celulas de rotulo e
     * numero, entao o subtitulo de cada card sumiu. Para este indicador isso
     * importava: "recuperado" sozinho seria lido como recuperado DO QUADRO, e
     * ele e da carteira inteira. O periodo e o escopo vieram para o rotulo, que
     * fica sempre visivel; o resto da explicacao segue no title.
     */
    expect(kanban).toContain("rotulo: `recuperado ${DIAS_DA_RECUPERACAO}d · carteira`");
    expect(kanban).toContain("titulo: tituloDaRecuperacao");
  });

  it("sem base, TRACO com o motivo no titulo — jamais R$ 0,00", () => {
    expect(kanban).toContain("recuperacao?.base ? brl(recuperacao.valor) : TRACO");
    expect(kanban).toContain("recuperacao?.motivo ??");
  });

  it("diz que o numero e da carteira inteira, e nao do recorte do quadro", () => {
    expect(kanban).toMatch(/toda a carteira/);
    expect(kanban).toContain("tituloDaRecuperacao");
  });

  it("nao mexeu nos quatro indicadores que ja existiam", () => {
    for (const rotulo of ["casos vivos", "contato vencido", "para hoje", "sem próxima ação", "em aberto"]) {
      expect(kanban).toContain(`rotulo: "${rotulo}"`);
    }
  });
});

describe("a regra dura do recuperado esta escrita onde ela vale", () => {
  const storage = ler("../../../../server/storage/faturas.storage.ts");

  it("so varredura completa conta, e o comentario diz por que nao ha filtro disso na consulta", () => {
    expect(storage).toContain("SO VARREDURA COMPLETA CONTA");
    expect(storage).toContain("const varreduraCompleta = leituraCompleta && errors === 0");
  });

  it("a atribuicao e de ultimo toque: a mesma fatura nao conta duas vezes", () => {
    expect(storage).toContain("ATRIBUICAO DE ULTIMO TOQUE");
    expect(storage).toContain("row_number() over (partition by");
  });

  it("o rotulo `assistente` promete so o que o dado tem: quem escreveu a mensagem", () => {
    expect(storage).toContain("o banco NAO distingue as duas iniciativas");
    expect(ROTULO_ORIGEM_DO_CONTATO.indefinido).toBe("Não identificado");
  });
});
