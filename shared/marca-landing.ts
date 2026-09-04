/**
 * O conteudo editavel da landing de uma marca — o JSONB `marcas.landing`.
 *
 * Fica em `shared/` porque as duas pontas precisam da MESMA regra: a rota
 * `PATCH /api/revenda/marca` valida o que o revendedor mandou, e o formulario
 * avisa antes de mandar. Duas copias da regra divergem no primeiro ajuste.
 *
 * Todo campo e opcional e o objeto inteiro tem default `{}` no banco: marca que
 * nasceu antes desta fase (e toda marca existente nasceu) carrega `{}`, e
 * `parse({})` tem de devolver um conteudo valido — com a landing mostrando os
 * textos padrao da tela, nao um erro.
 *
 * ── SOBRE OS LIMITES DE TAMANHO ────────────────────────────────────────────
 * Cada string vai parar dentro do HTML servido por `server/marca-html.ts`. O
 * limite aqui NAO e o que impede injecao — quem impede sao `escaparHtml` e
 * `paraScript` daquele arquivo, e eles continuam obrigatorios. O limite existe
 * por dois outros motivos, ambos concretos: um texto de 40 KB no `__MARCA__`
 * entra em CADA pageview do dominio da marca, e um titulo de 300 caracteres
 * destroi o layout do hero de quem paga pela pele bonita.
 *
 * `.strict()` recusa chave desconhecida de proposito: este objeto e serializado
 * inteiro para dentro da pagina, entao aceitar chave livre seria deixar o
 * revendedor escolher o que a plataforma publica.
 *
 * Quem usa e a fase 5 (landing e cadastro sob a marca). Aqui so mora a regra.
 */
import { z } from "zod";

/**
 * Texto opcional ja aparado. Campo esvaziado no formulario chega como `""` e
 * vira `undefined` — "apagar o titulo" e uma edicao legitima, e devolver 400
 * nela obrigaria a tela a inventar um caso especial.
 */
const textoOpcional = (max: number, campo: string) =>
  z
    .string()
    .trim()
    .max(max, `${campo}: maximo de ${max} caracteres`)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

export const esquemaLandingDaMarca = z
  .object({
    /** Manchete do hero. Substitui a frase da plataforma. */
    headline: textoOpcional(120, "Titulo"),
    /** Linha de apoio logo abaixo da manchete. */
    subtitulo: textoOpcional(240, "Subtitulo"),
    /**
     * Rotulo do botao de acao do hero ("Falar com a gente", "Criar conta").
     * E um ROTULO, nao um paragrafo — dai o limite curto: acima disso o botao
     * quebra em duas linhas em qualquer largura de telefone.
     */
    chamada: textoOpcional(80, "Chamada"),
    /**
     * Ligado por padrao (decisao 12 do dono). Quem esconde preco na landing
     * costuma esconder porque nao tem preco definido — e a marca tem: o preco
     * dela e resolvido no servidor, com piso e teto.
     */
    mostrarPrecos: z.boolean().default(true),
    /**
     * Desligado por padrao, e nao por timidez: os depoimentos da landing sao de
     * provedores que compraram da PLATAFORMA. Exibi-los sob outra marca seria
     * atribuir a ela uma prova social que nao e dela.
     */
    mostrarDepoimentos: z.boolean().default(false),
    /**
     * WhatsApp de contato do revendedor — o destino do CTA quando o cadastro
     * self-service esta fechado.
     *
     * Vira href (`wa.me/<so digitos>`), entao o formato e restrito de
     * proposito: aceita a pontuacao que um humano digita e nada alem disso.
     * Quem monta o link tira os nao-digitos; qualquer outro caractere aqui
     * seria caminho para href que nao e telefone.
     */
    whatsapp: textoOpcional(20, "WhatsApp")
      .refine(
        (v) => v === undefined || /^\+?[\d\s().-]+$/.test(v),
        "WhatsApp: use apenas numeros, espacos e os sinais + ( ) - .",
      )
      .refine(
        (v) => v === undefined || (v.replace(/\D/g, "").length >= 10 && v.replace(/\D/g, "").length <= 15),
        "WhatsApp: informe DDD e numero (10 a 15 digitos)",
      ),
  })
  // Mensagem propria porque a do zod sai em ingles, e esta chega ao formulario
  // do revendedor como texto de erro de campo.
  .strict("Campo desconhecido na landing da marca");

/** O conteudo ja parseado — `mostrarPrecos` e `mostrarDepoimentos` sempre presentes. */
export type ConteudoDaLanding = z.infer<typeof esquemaLandingDaMarca>;

/**
 * O que pode estar GRAVADO na coluna: os dois booleanos podem faltar, porque a
 * linha foi escrita antes de existirem. E o tipo certo para quem escreve o
 * PATCH; para quem le, use `ConteudoDaLanding` depois do parse.
 */
export type ConteudoDaLandingBruto = z.input<typeof esquemaLandingDaMarca>;
