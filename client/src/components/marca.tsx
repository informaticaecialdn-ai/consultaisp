/**
 * A marca do Consulta ISP: /consulta.isp (brand kit de 10/09/2026).
 *
 * Duas peças, cada uma no formato que a mantém fiel ao kit:
 *
 * 1. O WORDMARK é texto vivo em JetBrains Mono — a fonte já vem pelo
 *    `index.html`. É o mesmo desenho da landing: peso 700 com tracking de -4%
 *    no nome, "/" e ".isp" no cinza de destaque, tagline em 500 com o filete
 *    antes. Texto, e não imagem, porque a marca aparece de ~17px (barra
 *    lateral) a ~24px e precisa trocar de tinta no tema escuro — um PNG
 *    exigiria dois arquivos e borraria fora do tamanho em que foi exportado.
 * 2. O SÍMBOLO "/c" — o favicon do kit, para espaço pequeno — é vetor com os
 *    glifos CONVERTIDOS EM CONTORNO a partir do `JetBrainsMono-Bold.ttf` (os
 *    mesmos caminhos de `client/public/marca/favicon.svg`, centrados pela
 *    tinta). Os SVGs do kit desenham `<text>` com a fonte puxada por
 *    `@import`; favicon e `<img>` não carregam recurso externo, e o "/c"
 *    cairia na monoespaçada do sistema.
 *
 * Regras do kit que o código segue: nunca deformar; só dois modos (tinta
 * grafite no claro, creme no escuro — o cinza não muda); em espaço pequeno, o
 * "/c" no lugar do wordmark. Os tokens são `--marca-*` no `index.css`.
 *
 * WHITE LABEL: nada muda para o revendedor. O logo dele vem por `<img>`; sem
 * logo, o monograma com a cor dele — nunca a marca da plataforma.
 */

import { useMarca } from "@/lib/marca";

type Props = {
  /** Só o símbolo, ou a marca completa (wordmark da plataforma; símbolo + nome do revendedor). */
  variante?: "simbolo" | "completa";
  /** Altura de referência em px — a do símbolo. O wordmark sai proporcional a ela. */
  tamanho?: number;
  /** Mostra a tagline ("Rede Colaborativa") ou a assinatura do revendedor. */
  comAssinatura?: boolean;
  className?: string;
  /**
   * Ignora a marca do revendedor e desenha sempre a da plataforma.
   *
   * Para as telas que são da PLATAFORMA e não do tenant — o painel do
   * superadmin, a fatura da plataforma. Ali a marca de um revendedor seria mentira.
   */
  sempreDaPlataforma?: boolean;
};

/** A tagline do kit, palavra por palavra. */
export const TAGLINE_DA_MARCA = "Rede Colaborativa";

/* O "/c" do favicon do kit em contorno, no quadrado de 64: JetBrains Mono Bold,
   corpo 44, espaçamento -3, linha de base 47, deslocado 1,5 px para a tinta
   ficar no centro (o <text> do kit ancora pelo avanço e sobra à direita). */
const CONTORNO_BARRA = "M15.46 51.84L9.74 51.84L25.14 10.48L30.86 10.48L15.46 51.84Z";
const CONTORNO_C =
  "M44.10 47.44L44.10 47.44Q40.97 47.44 38.66 46.27Q36.35 45.11 35.08 42.97Q33.80 40.84 33.80 37.94L33.80 37.94L33.80 31.86Q33.80 28.96 35.08 26.83Q36.35 24.69 38.66 23.53Q40.97 22.36 44.10 22.36L44.10 22.36Q48.63 22.36 51.38 24.71Q54.13 27.07 54.26 31.12L54.26 31.12L48.85 31.12Q48.72 29.22 47.42 28.19Q46.12 27.16 44.10 27.16L44.10 27.16Q41.85 27.16 40.58 28.37Q39.30 29.58 39.30 31.82L39.30 31.82L39.30 37.94Q39.30 40.18 40.58 41.41Q41.85 42.64 44.10 42.64L44.10 42.64Q46.16 42.64 47.44 41.61Q48.72 40.58 48.85 38.68L48.85 38.68L54.26 38.68Q54.13 42.73 51.38 45.09Q48.63 47.44 44.10 47.44Z";

/**
 * O "/c" em ladrilho grafite. O raio sai do tamanho em px, com teto de 8 px —
 * o limite do DESIGN_SYSTEM (o ícone de app do kit tem 22% de raio, pensado
 * para a máscara do celular, não para a interface).
 */
export function SimboloConsultaISP({ tamanho = 32, className }: { tamanho?: number; className?: string }) {
  const raioPx = Math.min(8, Math.max(3, Math.round(tamanho * 0.18)));
  const raio = (raioPx * 64) / tamanho;
  return (
    <svg
      viewBox="0 0 64 64"
      width={tamanho}
      height={tamanho}
      className={className}
      style={{ flex: "none" }}
      role="img"
      aria-label="Consulta ISP"
    >
      <rect width="64" height="64" rx={raio} fill="var(--marca-ladrilho)" />
      <path d={CONTORNO_BARRA} fill="var(--marca-destaque)" />
      <path d={CONTORNO_C} fill="var(--marca-ladrilho-tinta)" />
    </svg>
  );
}

/**
 * O wordmark /consulta.isp, com a tagline opcional embaixo.
 *
 * `tamanho` é o corpo do nome em px. A tagline tem piso de 9 px: a proporção
 * do kit (20% do nome) é de peça impressa, e a 17 px de nome daria 3 px de
 * letra — ilegível, e na barra lateral ela diz em que painel você está.
 *
 * O leitor de tela ouve "Consulta ISP", não "barra consulta ponto isp".
 */
export function WordmarkConsultaISP({
  tamanho = 20, tagline, className, sobreEscuro = false,
}: {
  tamanho?: number; tagline?: string | null; className?: string;
  /**
   * Sobre fundo escuro FIXO (o painel da tela de login, o bloco escuro da
   * landing): a tinta vira creme nos dois temas. Sem isto a tinta segue o tema
   * do app, e no tema claro o nome sairia grafite sobre grafite.
   */
  sobreEscuro?: boolean;
}) {
  const corpoDaTagline = Math.max(9, Math.round(tamanho * 0.41));
  return (
    <span
      className={`inline-flex flex-col items-start min-w-0 ${className ?? ""}`}
      style={{ fontFamily: "var(--marca-fonte)", lineHeight: 1 }}
    >
      <span className="sr-only">Consulta ISP</span>
      <span
        aria-hidden="true"
        style={{
          fontSize: tamanho, fontWeight: 700, letterSpacing: "-0.04em",
          color: sobreEscuro ? "var(--marca-ladrilho-tinta)" : "var(--marca-tinta)", whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: "var(--marca-destaque)" }}>/</span>consulta<span style={{ color: "var(--marca-destaque)" }}>.isp</span>
      </span>
      {tagline && (
        <span
          className="flex items-center uppercase truncate max-w-full"
          style={{
            gap: Math.round(corpoDaTagline * 0.8),
            marginTop: Math.max(5, Math.round(tamanho * 0.3)),
            fontSize: corpoDaTagline, fontWeight: 500, letterSpacing: "0.2em",
            color: "var(--marca-destaque)",
          }}
        >
          <span aria-hidden="true" style={{ width: Math.round(corpoDaTagline * 1.3), height: 1, background: "currentColor", flex: "none" }} />
          {tagline}
        </span>
      )}
    </span>
  );
}

/**
 * O símbolo da marca vigente.
 *
 * Com marca de revendedor, o logo dele vem por `<img>` — nunca embutido. SVG
 * carregado como imagem tem script desligado pelo navegador, o que é garantia
 * mais forte que qualquer sanitizador que eu escrevesse. Ver
 * server/routes/marca.routes.ts.
 *
 * A contrapartida honesta: um logo em `<img>` não lê as variáveis CSS, então
 * não acompanha o tema escuro. Vale para SVG e para PNG. O revendedor que
 * quiser as duas versões precisa de uma marca que funcione nos dois fundos.
 */
export function SimboloDaMarca({ tamanho, className, sempreDaPlataforma }: {
  tamanho: number; className?: string; sempreDaPlataforma?: boolean;
}) {
  const marca = useMarca();

  if (!sempreDaPlataforma && marca.logoUrl) {
    return (
      <img
        src={marca.logoUrl}
        alt={marca.nomeProduto}
        height={tamanho}
        style={{ height: tamanho, width: "auto", maxWidth: tamanho * 4, objectFit: "contain" }}
        className={className}
      />
    );
  }

  /**
   * Revendedor cadastrado mas sem logo: monograma, nunca o "/c" da casa.
   *
   * Com marca ativa e sem logo, a porta de entrada de um revendedor exibiria a
   * marca de outra empresa — o que derruba a razão de existir do white label.
   * O monograma usa a cor dele e não afirma nada que seja falso.
   */
  if (!sempreDaPlataforma && marca.marcaId !== null) {
    const inicial = marca.nomeProduto.trim().charAt(0).toUpperCase() || "?";
    return (
      <span
        className={className}
        aria-label={marca.nomeProduto}
        role="img"
        style={{
          width: tamanho, height: tamanho, flex: "none",
          display: "grid", placeItems: "center",
          background: "var(--brand)", color: "var(--text-on-brand)",
          borderRadius: Math.max(4, Math.round(tamanho * 0.18)),   /* teto de 8px do design */
          fontFamily: "var(--font-sans)", fontWeight: 700,
          fontSize: Math.round(tamanho * 0.52), lineHeight: 1,
        }}
      >
        {inicial}
      </span>
    );
  }

  return <SimboloConsultaISP tamanho={tamanho} className={className} />;
}

/**
 * A marca completa.
 *
 * PLATAFORMA: só o wordmark — é o que o kit usa em nav e documento; o "/c" ao
 * lado repetiria "/c" duas vezes. REVENDEDOR: símbolo + nome, como sempre.
 * `comAssinatura` acrescenta a linha de apoio, que só cabe quando a marca é
 * grande — abaixo de ~28px ela vira borrão.
 */
export default function Marca({
  variante = "completa", tamanho = 32, comAssinatura = false, className, sempreDaPlataforma,
}: Props) {
  const marca = useMarca();
  const daPlataforma = sempreDaPlataforma || marca.marcaId === null;

  if (variante === "simbolo") {
    return <SimboloDaMarca tamanho={tamanho} className={className} sempreDaPlataforma={sempreDaPlataforma} />;
  }

  if (daPlataforma) {
    return (
      <WordmarkConsultaISP
        tamanho={Math.round(tamanho * 0.62)}
        tagline={comAssinatura ? TAGLINE_DA_MARCA : null}
        className={className}
      />
    );
  }

  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <SimboloDaMarca tamanho={tamanho} />
      <span className="flex flex-col leading-none">
        {/* O nome do revendedor sai em Inter, na cor dele (`--marca-nome`,
            injetada por server/marca-html.ts): a fonte da marca-mãe não é dele. */}
        <span
          style={{
            fontFamily: "var(--font-sans)", fontWeight: 700,
            fontSize: Math.round(tamanho * 0.54), letterSpacing: "-0.01em",
            color: "var(--marca-nome)",
          }}
        >
          {marca.nomeProduto}
        </span>
        {comAssinatura && marca.assinatura && (
          <span
            className="uppercase"
            style={{
              fontFamily: "var(--font-sans)", fontWeight: 500,
              fontSize: Math.max(8, Math.round(tamanho * 0.2)),
              letterSpacing: "0.1em",
              color: "var(--marca-assinatura)",
              marginTop: Math.round(tamanho * 0.16),
            }}
          >
            {marca.assinatura}
          </span>
        )}
      </span>
    </span>
  );
}
