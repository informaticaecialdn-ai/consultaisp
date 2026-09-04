import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Cobertura da base de endereços: a rotina que descobre quais cidades a
 * carteira atende e baixa do IBGE a base que falta.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Medido na Amplinet (provedor 6) em 04/09/2026:
 * a tela dizia "184 clientes esperam plotagem · carteira sem geocodificação" e
 * a causa era invisível — a base carregada no servidor cobria 9 municípios do
 * Paraná, a região de OUTRO provedor. O que se prova aqui não é "a rota
 * responde 200", é que ao tornar isso visível e acionável pelo provedor não
 * abrimos três buracos:
 *
 *   · o provedor A não enxerga nem manda carregar a praça de B — a lista de
 *     cidades de uma carteira diz onde aquele provedor opera;
 *   · quem dispara um download de dezenas de MB do FTP do IBGE é o ADMIN, e
 *     nunca o operador comum;
 *   · duas cargas não se atropelam. A trava é global de propósito: o recurso
 *     disputado (o FTP do IBGE e as tabelas de endereço) é um só para toda a
 *     plataforma, e o worker carrega do OUTRO processo.
 *
 * Os middlewares de `../auth` entram COMO OS REAIS — `requireAdmin` é a linha
 * que separa o operador do botão, e mocká-la provaria só que a rota chama
 * alguma coisa. O AGENDADOR (`cobertura-geo-agenda.service`) também é real: a
 * trava em teste é justamente ele.
 *
 * O que é dublado é `cobertura-geo.service`, que fala com o banco e com o IBGE.
 * O duble tem semântica de verdade — carteiras por provedor, uma carga que de
 * fato marca a cidade como carregada, um portão para segurar a passada em voo —
 * porque metade dos casos abaixo depende de uma carga estar acontecendo AGORA.
 * A classificação em si (grafia → município) já é testada em
 * `cobertura-geo.service.test.ts`; repeti-la aqui não provaria nada novo.
 */

vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-vitest";
});

vi.mock("express-session", () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("connect-pg-simple", () => ({ default: () => class MockPgStore {} }));
vi.mock("../db", () => ({ pool: {}, db: {} }));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const storageMock = vi.hoisted(() => ({
  getProvider: vi.fn(async (id: number): Promise<any> => ({ id, name: "Provedor", status: "active" })),
  getLocalizacao: vi.fn(async (): Promise<any> => ({ pontos: [], bairros: [] })),
  updateProviderProfile: vi.fn(async (): Promise<any> => ({})),
}));
vi.mock("../storage", () => ({ storage: storageMock }));

/** A plotagem é o vizinho de tela, não o assunto daqui — mas o disparo dela
 *  depois de uma carga bem-sucedida é, e por isso o espião. */
const plotagemMock = vi.hoisted(() => ({
  runGeocodeBackfill: vi.fn(async (_p?: number) => ({}) as any),
  varreduraAtiva: vi.fn(async () => false),
  getBackfillStatus: vi.fn(() => ({ geocoderIndisponivel: false, terminadoEm: null }) as any),
}));
vi.mock("../services/geocode-backfill.service", () => plotagemMock);

vi.mock("../services/rede-regional.service", () => ({
  bairrosDaRede: vi.fn(async () => ({ bairros: [], pontos: [], ocultas: 0 })),
  MIN_POR_BAIRRO: 5,
}));
vi.mock("../services/area-atendida", () => ({
  resolverAreaAtendida: vi.fn(async () => ({ cidades: [], uf: null })),
  normalizarCidade: (s: string) => (s || "").trim().toLowerCase(),
}));
vi.mock("../services/territorio-pontos.service", () => ({
  ehCamadaTerritorio: () => false,
  municipioDaCidade: vi.fn(async () => null),
  pontosDoTerritorio: vi.fn(async () => null),
}));

/* ── O duble de `cobertura-geo.service` ──────────────────────────────────── */

interface CidadeFake {
  nome: string; uf: string; ibge: string;
  clientes: number; semCoordenada: number;
  grafias: string[];
  temBase: boolean;
}

const AMPLINET = 6;
const VIZINHO = 9;

const duble = vi.hoisted(() => {
  /** A carteira real medida em 04/09/2026, do jeito que ela chega do ERP. */
  const MOLDE: Record<number, any[]> = {
    6: [
      { nome: "São Paulo", uf: "SP", ibge: "3550308", clientes: 40, semCoordenada: 2, grafias: ["SAO PAULO", "STRING:SAO PAULO"], temBase: true },
      { nome: "Embu-Guaçu", uf: "SP", ibge: "3515103", clientes: 128, semCoordenada: 100, grafias: ["EMBU-GUAÇU", "EMBU GUACU"], temBase: false },
      { nome: "Itapecerica da Serra", uf: "SP", ibge: "3522208", clientes: 207, semCoordenada: 82, grafias: ["ITAPECERICA DA SERRA SP"], temBase: false },
    ],
    9: [
      { nome: "Londrina", uf: "PR", ibge: "4113700", clientes: 800, semCoordenada: 0, grafias: ["LONDRINA"], temBase: true },
      { nome: "Cambé", uf: "PR", ibge: "4103305", clientes: 90, semCoordenada: 90, grafias: ["CAMBE"], temBase: false },
    ],
  };
  /** As grafias que não são cidade nenhuma — relatório de qualidade do ERP. */
  const SEM_MUNICIPIO: Record<number, any[]> = {
    6: [
      { chave: "embu gaucu", grafias: ["EMBU GAUCU"], clientes: 12, semCoordenada: 12, motivo: "nao_encontrada" },
      { chave: "itapecerica", grafias: ["ITAPECERICA"], clientes: 4, semCoordenada: 4, motivo: "sem_uf" },
    ],
    9: [],
  };

  const estado = {
    carteiras: {} as Record<number, any[]>,
    /** ibge das cidades cujo download falha nesta passada. */
    falham: new Set<string>(),
    /** Erro que derruba a passada inteira (banco fora do ar). */
    erroDaPassada: null as Error | null,
    /** Segura a carga em voo, para o teste bater na porta enquanto ela roda. */
    portao: null as { promessa: Promise<void>; abrir: () => void } | null,
    chamadas: [] as Array<{ providerId: number | null; limite?: number }>,
    medicoes: [] as Array<number | null>,
  };

  const reiniciar = () => {
    estado.carteiras = JSON.parse(JSON.stringify(MOLDE));
    estado.falham = new Set();
    estado.erroDaPassada = null;
    estado.portao = null;
    estado.chamadas = [];
    estado.medicoes = [];
  };
  reiniciar();

  const armarPortao = () => {
    let abrir!: () => void;
    const promessa = new Promise<void>(r => { abrir = r; });
    estado.portao = { promessa, abrir };
    return estado.portao;
  };

  const municipio = (c: any) => ({ nome: c.nome, uf: c.uf, ibge: c.ibge });
  const daCarteira = (c: any) => ({
    municipio: municipio(c), clientes: c.clientes, semCoordenada: c.semCoordenada,
    grafias: c.grafias, chaves: c.grafias.map((g: string) => g.toLowerCase()),
  });

  const coberturaDaCarteira = async (providerId?: number | null) => {
    const alvo = typeof providerId === "number" ? providerId : null;
    estado.medicoes.push(alvo);
    const lista: any[] = alvo === null
      ? Object.values(estado.carteiras).flat()
      : (estado.carteiras[alvo] ?? []);
    const sem: any[] = alvo === null ? [] : (SEM_MUNICIPIO[alvo] ?? []);
    return {
      providerId: alvo,
      cidades: lista.length + sem.length,
      clientes: lista.reduce((s, c) => s + c.clientes, 0) + sem.reduce((s, c) => s + c.clientes, 0),
      semCoordenada: lista.reduce((s, c) => s + c.semCoordenada, 0) + sem.reduce((s, c) => s + c.semCoordenada, 0),
      comBase: lista.filter(c => c.temBase).map(daCarteira),
      semBase: lista.filter(c => !c.temBase).map(daCarteira),
      semMunicipio: sem,
    };
  };

  const carregarBasesFaltantes = async (providerId?: number | null, opcoes: any = {}) => {
    const alvo = typeof providerId === "number" ? providerId : null;
    estado.chamadas.push({ providerId: alvo, limite: opcoes.limite });
    if (estado.erroDaPassada) throw estado.erroDaPassada;

    const lista: any[] = (alvo === null ? Object.values(estado.carteiras).flat() : (estado.carteiras[alvo] ?? []))
      .filter((c: any) => !c.temBase);
    const escolhidas = typeof opcoes.limite === "number" ? lista.slice(0, opcoes.limite) : lista;
    const carregadas: any[] = [];
    const falhas: any[] = [];

    for (const [i, c] of escolhidas.entries()) {
      opcoes.aoIniciar?.(municipio(c), i + 1, escolhidas.length);
      // O portão segura AQUI, com a primeira cidade já anunciada: é o instante
      // em que a tela pergunta "o que está baixando agora?".
      if (estado.portao) await estado.portao.promessa;
      let carga: any;
      if (estado.falham.has(c.ibge)) {
        carga = { municipio: municipio(c), ok: false, erro: "FTP do IBGE recusou a conexão" };
        falhas.push(carga);
      } else {
        c.temBase = true;
        c.semCoordenada = 0;
        carga = { municipio: municipio(c), ok: true, domicilios: 12_000, enderecos: 9_000 };
        carregadas.push(carga);
      }
      opcoes.aoTerminar?.(carga);
    }
    return { providerId: alvo, faltavam: lista.length, tentadas: escolhidas.length, carregadas, falhas };
  };

  return { estado, reiniciar, armarPortao, coberturaDaCarteira, carregarBasesFaltantes };
});

vi.mock("../services/cobertura-geo.service", () => ({
  coberturaDaCarteira: duble.coberturaDaCarteira,
  carregarBasesFaltantes: duble.carregarBasesFaltantes,
}));

import { esquecerStatusDeProvedor } from "../auth";
import { ROTA_COBERTURA } from "@/components/localizacao/CoberturaEnderecos";
import { registerLocalizacaoRoutes } from "./localizacao.routes";
import {
  _reiniciarCoberturaParaTestes, estadoDaCobertura, rodarCargaDeCobertura,
} from "../services/cobertura-geo-agenda.service";

/* ── Servidor ────────────────────────────────────────────────────────────── */

let server: Server;
let base: string;
let sessao: Record<string, any>;

const ADMIN = { userId: 5, role: "admin", providerId: AMPLINET };
const OPERADOR = { userId: 7, role: "user", providerId: AMPLINET };
const ADMIN_VIZINHO = { userId: 8, role: "admin", providerId: VIZINHO };
const SUPERADMIN = { userId: 1, role: "superadmin", providerId: 0 };

/**
 * Servidor NOVO a cada caso, de propósito: o limite de 6 cargas por hora vive
 * no router, e um servidor compartilhado faria o sétimo caso do arquivo
 * receber 429 sem nenhuma relação com o que ele testa.
 */
beforeEach(async () => {
  vi.clearAllMocks();
  duble.reiniciar();
  _reiniciarCoberturaParaTestes();
  esquecerStatusDeProvedor();
  storageMock.getProvider.mockImplementation(async (id: number) => ({ id, name: "Provedor", status: "active" }));
  plotagemMock.varreduraAtiva.mockResolvedValue(false);
  sessao = { ...ADMIN, save: (cb: (e?: unknown) => void) => cb() };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerLocalizacaoRoutes());

  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterEach(async () => {
  _reiniciarCoberturaParaTestes();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

/**
 * A ROTA VEM DO CLIENT, e não de uma cópia escrita aqui.
 *
 * O primeiro defeito desta entrega foi de endereço: a rota nasceu em
 * `/api/localizacao/cobertura/carregar`, o client fazia POST em
 * `/api/localizacao/cobertura`, e o teste batia no caminho do SERVIDOR — então
 * tudo passava aqui e o botão não funcionava lá. Em desenvolvimento nem 404
 * aparecia: o catch-all da SPA responde a qualquer método com 200 e o
 * index.html, o `throwIfResNotOk` do client deixa passar e o `.json()` estoura
 * num toast vermelho de erro de parser. Importar a constante DO CLIENT é o que
 * impede a próxima divergência — um renomeio de um lado só quebra aqui, em vez
 * de quebrar na mão do provedor.
 */
const verCobertura = () => fetch(`${base}${ROTA_COBERTURA}`);
const carregar = () => fetch(`${base}${ROTA_COBERTURA}`, { method: "POST" });

/** Espera a passada disparada pela rota terminar — ela roda solta, por desenho. */
async function aguardarACarga(): Promise<void> {
  for (let i = 0; i < 200 && estadoDaCobertura().emAndamento; i++) {
    await new Promise(r => setTimeout(r, 5));
  }
}

/* ── Um provedor não enxerga a praça do outro ────────────────────────────── */

describe("GET /api/localizacao/cobertura — a carteira da sessão, e só ela", () => {
  it("o provedor vê as próprias cidades, separadas entre com base e sem base", async () => {
    const corpo = await (await verCobertura()).json();

    expect(corpo.comBase.map((c: any) => c.municipio.nome)).toEqual(["São Paulo"]);
    expect(corpo.semBase.map((c: any) => c.municipio.nome))
      .toEqual(["Embu-Guaçu", "Itapecerica da Serra"]);
    // É o número que o dono leu como "o sistema não plota": 184 clientes fora
    // do mapa em duas cidades cuja base nunca foi carregada.
    expect(corpo.semBase.reduce((s: number, c: any) => s + c.semCoordenada, 0)).toBe(182);
    expect(duble.estado.medicoes).toEqual([AMPLINET]);
  });

  it("a mesma rota, na sessão do vizinho, devolve a carteira DELE", async () => {
    sessao = { ...ADMIN_VIZINHO, save: (cb: any) => cb() };

    const corpo = await (await verCobertura()).json();

    expect(corpo.comBase.map((c: any) => c.municipio.nome)).toEqual(["Londrina"]);
    expect(corpo.semBase.map((c: any) => c.municipio.nome)).toEqual(["Cambé"]);
    // A prova do isolamento: nenhuma cidade da Amplinet aparece aqui, e a
    // medição foi pedida com o providerId da sessão — não com o da URL, que
    // esta rota nem aceita.
    expect(JSON.stringify(corpo)).not.toContain("Embu");
    expect(duble.estado.medicoes).toEqual([VIZINHO]);
  });

  it("durante a PRÓPRIA carga, diz qual cidade está baixando e quantas faltam", async () => {
    // São minutos por município. Sem estes campos a tela ficaria idêntica do
    // clique ao fim, e o operador clicaria de novo — que é como a queixa
    // original ("o sistema não plota") nasceu.
    const portao = duble.armarPortao();
    await carregar();
    await new Promise(r => setTimeout(r, 10));

    const corpo = await (await verCobertura()).json();
    expect(corpo.carga.emAndamento).toBe(true);
    expect(corpo.carga.cidade).toBe("Embu-Guaçu · SP");
    expect(corpo.carga.total).toBe(2);
    expect(corpo.carga.concluidas).toBe(0);

    portao.abrir();
    await aguardarACarga();
    const depois = await (await verCobertura()).json();
    expect(depois.carga.concluidas).toBe(2);
    // O nome não fica pendurado depois do fim.
    expect(depois.carga.cidade).toBeNull();
  });

  it("sessão sem provedor não passa", async () => {
    sessao = { ...SUPERADMIN, save: (cb: any) => cb() };

    const res = await verCobertura();

    expect(res.status).toBe(403);
    expect(duble.estado.medicoes).toEqual([]);
  });

  it("diz o motivo de cada grafia que não é cidade — são correções diferentes", async () => {
    const corpo = await (await verCobertura()).json();

    expect(corpo.semMunicipio).toEqual([
      { chave: "embu gaucu", grafias: ["EMBU GAUCU"], clientes: 12, semCoordenada: 12, motivo: "nao_encontrada" },
      { chave: "itapecerica", grafias: ["ITAPECERICA"], clientes: 4, semCoordenada: 4, motivo: "sem_uf" },
    ]);
  });

  it("só agregado: nenhum campo de cliente atravessa a rota", async () => {
    const corpo = await (await verCobertura()).json();

    const permitidos = ["municipio", "clientes", "semCoordenada", "grafias", "chaves"];
    for (const c of [...corpo.comBase, ...corpo.semBase]) {
      expect(Object.keys(c).sort()).toEqual([...permitidos].sort());
      expect(Object.keys(c.municipio).sort()).toEqual(["ibge", "nome", "uf"]);
    }
    const texto = JSON.stringify(corpo).toLowerCase();
    for (const proibido of ["cpf", "cnpj", "latitude", "longitude", "email", "telefone"]) {
      expect(texto).not.toContain(proibido);
    }
  });

  it("a passada do WORKER é 'servidor ocupado', e não a carga deste provedor", async () => {
    /*
     * DOIS FATOS, e misturá-los custava caro. A passada do worker cobre a base
     * inteira: as cidades que falham nela são de outros provedores, e dizer
     * quais entregaria a praça de um tenant a outro.
     *
     * `emAndamento` diz "a carga DESTA carteira está rodando", e é o que
     * autoriza a tela a prometer progresso e a repetir a leitura de 10 em 10
     * segundos. Enquanto ele saía da trava GLOBAL, a passada do worker — que
     * roda em todo boot e a cada 24h, e pode durar horas — punha todo provedor
     * com a tela aberta num botão morto, com a frase "leva alguns minutos, pode
     * sair desta tela" para uma carga que não era dele, e a repolar sem parar.
     * `ocupado` carrega esse fato sem prometer nada e sem identificar ninguém.
     */
    duble.estado.falham.add("4103305");   // Cambé, do vizinho
    const portao = duble.armarPortao();
    const passadaDoWorker = rodarCargaDeCobertura(null);

    const corpo = await (await verCobertura()).json();
    expect(corpo.carga.emAndamento).toBe(false);
    expect(corpo.carga.ocupado).toBe(true);
    expect(corpo.carga.carregadas).toBeNull();
    expect(corpo.carga.cidadesComFalha).toEqual([]);

    portao.abrir();
    await passadaDoWorker;
    const depois = await (await verCobertura()).json();
    expect(depois.carga.emAndamento).toBe(false);
    expect(depois.carga.ocupado).toBe(false);
    expect(JSON.stringify(depois.carga)).not.toContain("Cambé");
  });

  it("na PRÓPRIA carga os dois sinais sobem — é minha, e o servidor está ocupado", async () => {
    const portao = duble.armarPortao();
    await carregar();
    await new Promise(r => setTimeout(r, 10));

    const corpo = await (await verCobertura()).json();
    expect(corpo.carga.emAndamento).toBe(true);
    expect(corpo.carga.ocupado).toBe(true);

    portao.abrir();
    await aguardarACarga();
  });

  it("o vizinho, durante a carga da Amplinet, vê ocupado — e nenhuma cidade dela", async () => {
    // A trava é global, então o botão dele tem de estar fora de serviço. Mas
    // "carregando Embu-Guaçu" é praça da Amplinet e não atravessa a rota.
    const portao = duble.armarPortao();
    await carregar();
    await new Promise(r => setTimeout(r, 10));

    sessao = { ...ADMIN_VIZINHO, save: (cb: any) => cb() };
    const corpo = await (await verCobertura()).json();

    expect(corpo.carga.ocupado).toBe(true);
    expect(corpo.carga.emAndamento).toBe(false);
    expect(corpo.carga.cidade).toBeNull();
    expect(JSON.stringify(corpo.carga)).not.toContain("Embu");

    portao.abrir();
    await aguardarACarga();
  });
});

/* ── Quem pode mandar baixar do IBGE ─────────────────────────────────────── */

describe("POST /api/localizacao/cobertura — quem pode", () => {
  it("o admin do provedor dispara, e a resposta volta na hora", async () => {
    const res = await carregar();
    const corpo = await res.json();

    // 202, e não 200: a carga leva minutos e o nginx corta em 60s.
    expect(res.status).toBe(202);
    expect(corpo.iniciado).toBe(true);

    await aguardarACarga();
    expect(duble.estado.chamadas).toEqual([{ providerId: AMPLINET, limite: 12 }]);
  });

  it("o operador comum NÃO dispara, e nada é baixado", async () => {
    sessao = { ...OPERADOR, save: (cb: any) => cb() };

    const res = await carregar();

    expect(res.status).toBe(403);
    await aguardarACarga();
    expect(duble.estado.chamadas).toEqual([]);
  });

  it("a carga é sempre da carteira da sessão — não há como pedir a de outro", async () => {
    sessao = { ...ADMIN_VIZINHO, save: (cb: any) => cb() };

    await carregar();
    await aguardarACarga();

    expect(duble.estado.chamadas.map(c => c.providerId)).toEqual([VIZINHO]);
    // E carregou Cambé, não Embu-Guaçu.
    expect(duble.estado.carteiras[AMPLINET].filter((c: any) => c.temBase).map((c: any) => c.nome))
      .toEqual(["São Paulo"]);
    expect(duble.estado.carteiras[VIZINHO].every((c: any) => c.temBase)).toBe(true);
  });

  it("mais de 6 disparos na mesma hora batem no limite", async () => {
    // A rota puxa arquivo de terceiro: o que se raciona aqui é o FTP do IBGE,
    // não o nosso CPU. Seis por hora cobre a repetição legítima (uma cidade
    // que falhou por rede) e nada além.
    for (let i = 0; i < 6; i++) {
      expect((await carregar()).status).toBe(202);
      await aguardarACarga();
    }

    const res = await carregar();

    expect(res.status).toBe(429);
  });
});

/* ── Duas cargas não se atropelam ────────────────────────────────────────── */

describe("uma carga por vez", () => {
  it("dois cliques seguidos: a segunda resposta diz que já está rodando", async () => {
    const portao = duble.armarPortao();

    const [primeira, segunda] = await Promise.all([carregar(), carregar()]);
    const corpo1 = await primeira.json();
    const corpo2 = await segunda.json();

    expect([corpo1.iniciado, corpo2.iniciado].sort()).toEqual([false, true]);
    portao.abrir();
    await aguardarACarga();
    // O que importa não é a resposta, é o FTP: uma passada só aconteceu.
    expect(duble.estado.chamadas).toHaveLength(1);
  });

  it("a tela é recusada enquanto o WORKER carrega — a trava vale entre processos", async () => {
    // O worker carrega a base INTEIRA (providerId null) no outro processo. A
    // trava é global porque o recurso é global: o FTP do IBGE e as tabelas de
    // endereço são uma só para toda a plataforma.
    const portao = duble.armarPortao();
    const passadaDoWorker = rodarCargaDeCobertura(null);

    const corpo = await (await carregar()).json();

    expect(corpo.iniciado).toBe(false);
    expect(corpo.mensagem).toContain("andamento");
    portao.abrir();
    await passadaDoWorker;
    expect(duble.estado.chamadas.map(c => c.providerId)).toEqual([null]);
  });

  it("terminada a carga, a próxima roda — a trava é devolvida", async () => {
    await carregar();
    await aguardarACarga();

    const corpo = await (await carregar()).json();
    await aguardarACarga();

    expect(corpo.iniciado).toBe(true);
    expect(duble.estado.chamadas).toHaveLength(2);
  });

  it("passada que falha inteira NÃO deixa a trava presa", async () => {
    // Banco fora do ar derruba a passada antes da primeira cidade. Se o sinal
    // ficasse de pé, o botão morreria até o próximo restart do processo — e o
    // provedor voltaria a depender de alguém com acesso ao servidor.
    duble.estado.erroDaPassada = new Error("banco fora do ar");
    await carregar();
    await aguardarACarga();
    expect(estadoDaCobertura().emAndamento).toBe(false);

    duble.estado.erroDaPassada = null;
    const corpo = await (await carregar()).json();
    await aguardarACarga();

    expect(corpo.iniciado).toBe(true);
    expect(duble.estado.chamadas).toHaveLength(2);
  });

  it("uma cidade que falha não impede as outras nem some da tela", async () => {
    duble.estado.falham.add("3515103");   // Embu-Guaçu

    await carregar();
    await aguardarACarga();
    const corpo = await (await verCobertura()).json();

    // Itapecerica entrou; Embu-Guaçu continua na lista do que falta, com o
    // motivo à vista em vez de um silêncio.
    expect(corpo.comBase.map((c: any) => c.municipio.nome))
      .toEqual(["São Paulo", "Itapecerica da Serra"]);
    expect(corpo.semBase.map((c: any) => c.municipio.nome)).toEqual(["Embu-Guaçu"]);
    expect(corpo.carga.falhas).toBe(1);
    expect(corpo.carga.cidadesComFalha).toEqual([
      { cidade: "Embu-Guaçu", uf: "SP", erro: "FTP do IBGE recusou a conexão" },
    ]);
  });
});

/* ── O que acontece depois da carga ──────────────────────────────────────── */

describe("carregada a base, os clientes entram no mapa", () => {
  it("base nova dispara a plotagem da carteira de quem pediu", async () => {
    await carregar();
    await aguardarACarga();
    // A plotagem é disparada no `.then` da passada; um tique basta.
    await new Promise(r => setTimeout(r, 5));

    expect(plotagemMock.runGeocodeBackfill).toHaveBeenCalledWith(AMPLINET);
  });

  it("sem base nova, não dispara plotagem nenhuma", async () => {
    // Tudo já carregado: repetir a plotagem seria repetir a passada que já
    // falhou, gastando Nominatim a uma consulta por segundo.
    for (const c of duble.estado.carteiras[AMPLINET] as CidadeFake[]) c.temBase = true;

    await carregar();
    await aguardarACarga();
    await new Promise(r => setTimeout(r, 5));

    expect(plotagemMock.runGeocodeBackfill).not.toHaveBeenCalled();
  });
});
