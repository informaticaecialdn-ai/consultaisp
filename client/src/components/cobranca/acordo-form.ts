/**
 * O formulário da POLÍTICA DE ACORDO (a seção "Acordo" de /cobranca/politica).
 *
 * Mesma divisão do resto da tela: número vive como TEXTO na caixa e vira
 * número na saída; caixa vazia ou com lixo cai no valor gravado, nunca em
 * NaN. O `ateDias` é a exceção proposital — vazio ali significa "sem teto",
 * que é a última faixa.
 *
 * `acimaDeDias` não aparece no formulário: ele é INFERIDO do teto da faixa
 * anterior (`normalizarFaixas`), e o servidor devolve as faixas ordenadas e
 * com o piso explícito. Pedir os dois lados ao admin seria pedir que ele
 * mantivesse dois números sincronizados à mão.
 *
 * Quem valida de verdade é o servidor (`validarPolitica` → 400 com o campo);
 * `avisosDasFaixas` roda a MESMA função aqui só para o admin ver o buraco
 * antes de gravar.
 */
import {
  ACORDO_PADRAO,
  CARTEIRAS,
  normalizarFaixas,
  rotuloDaFaixa,
  type Acordo,
  type Carteira,
  type FaixaDeAcordo,
  type OrigemDaCobranca,
} from "@shared/cobranca";

export interface FaixaDoForm {
  /** Vazio = sem teto (a última faixa). */
  ateDias: string;
  descontoMaxPct: string;
  maxParcelas: string;
  entradaMinimaPct: string;
}

export interface AcordoDaCarteiraDoForm {
  origemDaCobranca: OrigemDaCobranca;
  janelaVencimentoDias: string;
  tetoDeExcecaoPct: string;
  parcelasDeExcecao: string;
  faixas: FaixaDoForm[];
}

export type FormAcordo = Record<Carteira, AcordoDaCarteiraDoForm>;

const texto = (n: number) => String(n);

export function formDoAcordo(acordo: Acordo): FormAcordo {
  const porCarteira = (c: Carteira): AcordoDaCarteiraDoForm => ({
    origemDaCobranca: acordo[c].origemDaCobranca,
    janelaVencimentoDias: texto(acordo[c].janelaVencimentoDias),
    tetoDeExcecaoPct: texto(acordo[c].tetoDeExcecaoPct),
    parcelasDeExcecao: texto(acordo[c].parcelasDeExcecao),
    faixas: acordo[c].faixas.map(f => ({
      ateDias: f.ateDias === null ? "" : texto(f.ateDias),
      descontoMaxPct: texto(f.descontoMaxPct),
      maxParcelas: texto(f.maxParcelas),
      entradaMinimaPct: texto(f.entradaMinimaPct),
    })),
  });
  return { ativo: porCarteira("ativo"), ex_cliente: porCarteira("ex_cliente") };
}

/** Texto → número; vazio ou lixo devolve o que estava gravado. */
function numeroOu(valor: string, gravado: number): number {
  const n = Number(String(valor).replace(",", "."));
  return valor.trim() !== "" && Number.isFinite(n) ? n : gravado;
}

export function acordoDoForm(form: FormAcordo, gravado: Acordo): Acordo {
  const porCarteira = (c: Carteira) => {
    const f = form[c];
    const base = gravado[c] ?? ACORDO_PADRAO[c];
    return {
      origemDaCobranca: f.origemDaCobranca,
      faixas: f.faixas.map((linha, i): FaixaDeAcordo => {
        const anterior = base.faixas[i] ?? { ateDias: null, descontoMaxPct: 0, maxParcelas: 1, entradaMinimaPct: 0 };
        return {
          ateDias: linha.ateDias.trim() === "" ? null : Math.round(numeroOu(linha.ateDias, anterior.ateDias ?? 1)),
          descontoMaxPct: numeroOu(linha.descontoMaxPct, anterior.descontoMaxPct),
          maxParcelas: Math.round(numeroOu(linha.maxParcelas, anterior.maxParcelas)),
          entradaMinimaPct: numeroOu(linha.entradaMinimaPct, anterior.entradaMinimaPct),
        };
      }),
      janelaVencimentoDias: Math.round(numeroOu(f.janelaVencimentoDias, base.janelaVencimentoDias)),
      tetoDeExcecaoPct: numeroOu(f.tetoDeExcecaoPct, base.tetoDeExcecaoPct),
      parcelasDeExcecao: Math.round(numeroOu(f.parcelasDeExcecao, base.parcelasDeExcecao)),
    };
  };
  return { ativo: porCarteira("ativo"), ex_cliente: porCarteira("ex_cliente") };
}

export function editarCarteira(form: FormAcordo, carteira: Carteira, mudanca: Partial<AcordoDaCarteiraDoForm>): FormAcordo {
  return { ...form, [carteira]: { ...form[carteira], ...mudanca } };
}

export function editarFaixa(form: FormAcordo, carteira: Carteira, indice: number, campo: keyof FaixaDoForm, valor: string): FormAcordo {
  const faixas = form[carteira].faixas.map((f, i) => (i === indice ? { ...f, [campo]: valor } : f));
  return editarCarteira(form, carteira, { faixas });
}

/**
 * A faixa nova entra ANTES da última (a sem teto), porque a última é a cauda
 * e nada vem depois dela. Nasce copiando a que ficou acima, com um teto
 * sugerido — o admin ajusta o número, não a estrutura.
 */
export function adicionarFaixa(form: FormAcordo, carteira: Carteira): FormAcordo {
  const faixas = [...form[carteira].faixas];
  const ultima = faixas.length - 1;
  const anterior = faixas[Math.max(0, ultima - 1)];
  const tetoAnterior = Number(anterior?.ateDias ?? 0);
  const nova: FaixaDoForm = {
    ateDias: String(Number.isFinite(tetoAnterior) && tetoAnterior > 0 ? tetoAnterior + 30 : 30),
    descontoMaxPct: anterior?.descontoMaxPct ?? "0",
    maxParcelas: anterior?.maxParcelas ?? "1",
    entradaMinimaPct: anterior?.entradaMinimaPct ?? "20",
  };
  faixas.splice(Math.max(0, ultima), 0, nova);
  return editarCarteira(form, carteira, { faixas });
}

/** A última faixa não sai: sem ela ninguém cobre o atraso mais longo. */
export function removerFaixa(form: FormAcordo, carteira: Carteira, indice: number): FormAcordo {
  const faixas = form[carteira].faixas;
  if (faixas.length <= 1 || indice === faixas.length - 1) return form;
  return editarCarteira(form, carteira, { faixas: faixas.filter((_, i) => i !== indice) });
}

/** O que o servidor recusaria, dito antes de gravar. Vazio = a régua fecha. */
export function avisosDasFaixas(form: FormAcordo, gravado: Acordo): Partial<Record<Carteira, string[]>> {
  const acordo = acordoDoForm(form, gravado);
  const avisos: Partial<Record<Carteira, string[]>> = {};
  for (const carteira of CARTEIRAS) {
    const r = normalizarFaixas(acordo[carteira].faixas);
    if (!r.ok) avisos[carteira] = r.erros;
  }
  return avisos;
}

/** O rótulo de cada linha ("até 30 dias", "de 31 a 60 dias"), na ordem da tela. */
export function rotulosDasFaixas(form: FormAcordo, carteira: Carteira, gravado: Acordo): string[] {
  const faixas = acordoDoForm(form, gravado)[carteira].faixas;
  const r = normalizarFaixas(faixas);
  return r.ok ? r.faixas.map(rotuloDaFaixa) : faixas.map((_, i) => `faixa ${i + 1}`);
}
