/**
 * A cobertura da base de endereços vira ROTINA — quem chama, quando, e a trava.
 *
 * POR QUE ISTO EXISTE. Medido na Amplinet (provedor 6) em 04/09/2026: a tela de
 * Localização dizia "184 clientes esperam plotagem · carteira sem
 * geocodificação", e a causa era que a base do IBGE carregada no servidor
 * cobria 9 municípios do Paraná — a região de OUTRO provedor. A região da
 * Amplinet nunca tinha sido carregada porque carregar era um script que alguém
 * com acesso ao servidor rodava a mão. Nas palavras do dono: *"não só o que
 * acha... precisa criar essas rotinas para ser mostrada"*.
 *
 * `cobertura-geo.service.ts` sabe MEDIR e CARREGAR. Este arquivo é o outro
 * lado: quem aciona (o relógio do worker e o botão da tela), com que cadência,
 * e a garantia de que os dois nunca baixem a mesma cidade ao mesmo tempo.
 *
 * ── Cadência: 24h, e não junto da plotagem ─────────────────────────────────
 *
 * A plotagem roda a cada 6h. Esta passada NÃO pode acompanhá-la: a carga baixa
 * dezenas de MB por município do FTP do IBGE. E não precisa — a MEDIÇÃO é uma
 * query agregada e custa quase nada, mas ela só tem o que fazer quando aparece
 * cidade nova na carteira, o que acontece quando um provedor entra ou passa a
 * atender outra praça: escala de dias, não de horas. O arquivo do outro lado é
 * o Censo de 2022; ele não muda entre uma passada e a seguinte. Quem não quer
 * esperar o dia seguinte tem o botão na tela, que chama exatamente isto aqui.
 *
 * ── A trava, e por que ela NÃO é a mesma da plotagem ───────────────────────
 *
 * O worker e a API são dois processos (ver worker.ts), e a tela dispara do
 * processo da API. Sem trava compartilhada, os dois baixam o mesmo município ao
 * mesmo tempo e o segundo reescreve as linhas que o primeiro estava gravando.
 * A trava é um advisory lock do Postgres, o único estado que os dois enxergam.
 *
 * A CHAVE é diferente da chave da plotagem de propósito: são trabalhos
 * independentes, e uma chave só faria a passada diária de cobertura esperar
 * (ou perder a vez para) uma varredura de plotagem que dura até 25 minutos.
 * Rodar os dois juntos, no pior caso, faz a plotagem ler uma cidade em meio de
 * carga — o cliente que não resolver volta na passada seguinte, que é o
 * comportamento normal da fila. Não há dado corrompido nisso.
 */
import type { PoolClient } from "pg";
import { pool } from "../db";
import { logger } from "../logger";
import { carregarBasesFaltantes } from "./cobertura-geo.service";

/** De 24 em 24 horas. Ver "Cadência" no cabeçalho. */
export const INTERVALO_DA_AGENDA_MS = 24 * 60 * 60 * 1000;

/**
 * Teto de cidades por passada.
 *
 * Um município grande passa de 40 MB e o download tem timeout de 15 minutos
 * (ver `baixarCnefe`), então uma passada sem teto poderia segurar o FTP do IBGE
 * por horas. Doze é folgado para a realidade — um provedor atende de uma a dez
 * praças —, e o que sobrar entra na passada seguinte, que só tenta o que ainda
 * falta.
 */
export const LIMITE_POR_PASSADA = 12;

/**
 * Quanto o worker espera pela PRIMEIRA passada antes de soltar a plotagem.
 *
 * A ordem certa é base primeiro, plotagem depois — plotar sem base gasta
 * Nominatim (uma consulta por segundo) para fazer pior o que a base local faz
 * melhor. Mas "depois" não pode virar "nunca": se o FTP do IBGE estiver lento,
 * a plotagem sai assim mesmo e a carga continua ao fundo.
 */
export const ESPERA_MAXIMA_DA_PRIMEIRA_PASSADA_MS = 30 * 60 * 1000;

/** Distinta da chave da plotagem (`geocode-backfill.service`). Ver cabeçalho. */
const CHAVE_DA_TRAVA = 4820_1178;

export interface CidadeQueFalhou {
  cidade: string;
  uf: string;
  erro: string;
}

export interface EstadoDaCobertura {
  emAndamento: boolean;
  /** Carteira medida na última passada. null = a base inteira (o worker). */
  alvo: number | null;
  iniciadoEm: string | null;
  terminadoEm: string | null;
  /** Cidades sem base quando a passada começou. */
  faltavam: number;
  /** Cidades que ESTA passada vai tentar — `faltavam` limitado pelo teto. */
  aCarregar: number;
  /**
   * Município que está baixando agora. A carga leva minutos e a tela ficaria
   * idêntica do começo ao fim sem isto — foi o que fez o operador clicar de
   * novo no botão de plotagem. Volta a null quando a passada termina.
   */
  cidadeAtual: string | null;
  carregadas: number;
  falhas: number;
  ultimasFalhas: CidadeQueFalhou[];
}

const estado: EstadoDaCobertura = {
  emAndamento: false,
  alvo: null,
  iniciadoEm: null,
  terminadoEm: null,
  faltavam: 0,
  aCarregar: 0,
  cidadeAtual: null,
  carregadas: 0,
  falhas: 0,
  ultimasFalhas: [],
};

/** Cópia — quem lê não mexe no estado da passada em voo. */
export function estadoDaCobertura(): EstadoDaCobertura {
  return { ...estado, ultimasFalhas: estado.ultimasFalhas.map(f => ({ ...f })) };
}

/**
 * Falha aberta de propósito, como na plotagem: se o banco não conceder a trava
 * por um motivo inesperado, a passada roda assim mesmo. Trabalho duplicado é
 * desperdício; rotina que nunca roda é o defeito que estamos consertando.
 */
async function tentarTravar(): Promise<{ obtida: boolean; liberar: () => Promise<void> }> {
  let conn: PoolClient | null = null;
  try {
    conn = await pool.connect();
    const r = await conn.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [CHAVE_DA_TRAVA]);
    if (!r.rows[0]?.ok) {
      conn.release();
      return { obtida: false, liberar: async () => {} };
    }
    const c = conn;
    return {
      obtida: true,
      liberar: async () => {
        try { await c.query("select pg_advisory_unlock($1)", [CHAVE_DA_TRAVA]); } catch {}
        c.release();
      },
    };
  } catch (err) {
    conn?.release();
    logger.warn({ err }, "Cobertura geo: trava indisponível — seguindo sem ela");
    return { obtida: true, liberar: async () => {} };
  }
}

/**
 * Há carga rodando em QUALQUER processo?
 *
 * `estado.emAndamento` só enxerga este processo, e em produção a API e o worker
 * são dois — a tela perguntaria ao processo errado. Pega-e-solta a trava, para
 * não segurar nada.
 */
export async function cargaDeCoberturaAtiva(): Promise<boolean> {
  if (estado.emAndamento) return true;
  let conn: PoolClient | null = null;
  try {
    conn = await pool.connect();
    const r = await conn.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [CHAVE_DA_TRAVA]);
    if (r.rows[0]?.ok) {
      await conn.query("select pg_advisory_unlock($1)", [CHAVE_DA_TRAVA]);
      return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    conn?.release();
  }
}

/**
 * Uma passada: mede a carteira e baixa a base de cada cidade que falta.
 *
 * `alvo` null mede a base inteira — é a passada do worker. Com um providerId,
 * mede só a carteira daquele provedor: é o botão da tela, e é o que mantém o
 * isolamento por tenant também aqui.
 *
 * NUNCA lança. Quem chama é um timer ou uma rota que já respondeu; uma cidade
 * que falha é tratada cidade a cidade dentro de `carregarBasesFaltantes`, e o
 * que chega aqui é só o que derrubaria a passada inteira (banco fora do ar).
 */
export async function rodarCargaDeCobertura(
  alvo: number | null = null,
  opcoes: { limite?: number } = {},
): Promise<EstadoDaCobertura> {
  // Antes de QUALQUER await. A rota decide entre "iniciei" e "já está rodando"
  // olhando este sinal, e entre a decisão dela e esta linha não pode caber um
  // tick do laço de eventos — dois cliques em sequência viram duas passadas
  // sobre o mesmo FTP.
  if (estado.emAndamento) return estadoDaCobertura();
  estado.emAndamento = true;
  estado.alvo = alvo;
  estado.iniciadoEm = new Date().toISOString();
  estado.terminadoEm = null;
  estado.faltavam = 0;
  estado.aCarregar = 0;
  estado.cidadeAtual = null;
  estado.carregadas = 0;
  estado.falhas = 0;
  estado.ultimasFalhas = [];

  const trava = await tentarTravar();
  try {
    if (!trava.obtida) {
      logger.info({ alvo }, "Cobertura geo: outra instância já está carregando");
    } else {
      const r = await carregarBasesFaltantes(alvo, {
        limite: opcoes.limite ?? LIMITE_POR_PASSADA,
        aoIniciar: (municipio, _indice, total) => {
          estado.aCarregar = total;
          estado.cidadeAtual = `${municipio.nome} · ${municipio.uf}`;
        },
        aoTerminar: carga => {
          if (carga.ok) {
            estado.carregadas++;
          } else {
            estado.falhas++;
            estado.ultimasFalhas.push({
              cidade: carga.municipio.nome,
              uf: carga.municipio.uf,
              erro: carga.erro || "falha desconhecida",
            });
          }
        },
      });
      estado.faltavam = r.faltavam;
      if (r.tentadas > 0 || r.faltavam > 0) {
        logger.info(
          { alvo, faltavam: r.faltavam, tentadas: r.tentadas,
            carregadas: r.carregadas.length, falhas: r.falhas.length },
          "Cobertura geo: passada concluída",
        );
      }
    }
  } catch (err) {
    logger.warn({ err, alvo }, "Cobertura geo: a passada inteira falhou — a próxima tenta de novo");
  } finally {
    await trava.liberar();
    estado.emAndamento = false;
    // Sem isto a tela continuaria dizendo "baixando Embu-Guaçu" depois de
    // pronto — o último nome ficaria pendurado no estado para sempre.
    estado.cidadeAtual = null;
    estado.terminadoEm = new Date().toISOString();
  }
  return estadoDaCobertura();
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Liga o relógio diário. NÃO roda a primeira passada: quem a roda é o worker,
 * que precisa esperá-la terminar antes de soltar a plotagem (ver worker.ts).
 * Uma passada aqui dentro faria a ordem depender de quem chamou primeiro.
 */
export function iniciarAgendaDeCobertura(): void {
  if (timer) return;
  timer = setInterval(() => {
    rodarCargaDeCobertura().catch(err =>
      logger.warn({ err }, "Cobertura geo: passada agendada falhou"));
  }, INTERVALO_DA_AGENDA_MS);
  timer.unref?.();
}

/** O estado é de módulo; sem isto um teste enxerga a passada do anterior. */
export function _reiniciarCoberturaParaTestes(): void {
  if (timer) clearInterval(timer);
  timer = null;
  estado.emAndamento = false;
  estado.alvo = null;
  estado.iniciadoEm = null;
  estado.terminadoEm = null;
  estado.faltavam = 0;
  estado.aCarregar = 0;
  estado.cidadeAtual = null;
  estado.carregadas = 0;
  estado.falhas = 0;
  estado.ultimasFalhas = [];
}
