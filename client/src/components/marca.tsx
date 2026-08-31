/**
 * A marca do Consulta ISP.
 *
 * Desenhada em SVG, e não servida como imagem, por três razões:
 *
 * 1. O PNG de origem tem 1254px e 897KB. O lugar mais frequente da marca é o
 *    quadrado de 32px da barra lateral — carregar 897KB para desenhar 32px sai
 *    caro em toda visita.
 * 2. Vetor é nítido em qualquer tamanho, e a marca aparece de 20px (favicon) a
 *    ~200px (tela de login).
 * 3. O traço estrutural precisa clarear no tema escuro. Num PNG isso exigiria
 *    dois arquivos; aqui é uma variável.
 *
 * O SIMBOLO segue o `icone-512.png` aprovado — traco escuro e anel laranja em
 * volta do verde. ATENCAO: a tabela do brief de vetorizacao descreve outra
 * construcao (tracos LARANJA, sem anel), que e a do `favicon.svg`. As duas
 * existem de proposito — a laranja e a simplificacao para 16px —, mas o brief
 * mistura as duas ao mandar seguir a tabela E usar o PNG como referencia. Quem
 * for vetorizar precisa saber qual das duas e o master.
 *
 * A geometria foi MEDIDA do arquivo original (client/public/marca/simbolo.png),
 * amostrando os pixels: centro dos seis nós, espessura de linha 31, raio do nó
 * 82,5, disco verde de raio 146,5 e anel laranja externo em 178,5 — tudo no
 * sistema de 1254px do arquivo, que é o que estes números usam. O hexágono do
 * original é levemente mais largo que um hexágono regular (nós laterais em
 * ±387 onde o regular pediria ±372); mantive o desenho como ele é, porque
 * fidelidade à marca vale mais que pureza geométrica.
 */

type Props = {
  /** Só o símbolo, ou o símbolo com o nome ao lado. */
  variante?: "simbolo" | "completa";
  /** Altura do símbolo em px. A largura sai da proporção. */
  tamanho?: number;
  /** Mostra a linha "Base colaborativa de crédito" sob o nome. */
  comAssinatura?: boolean;
  className?: string;
};

/* Centros dos seis nós e do miolo, no sistema do arquivo original. */
const NOS = [
  { x: 626, y: 175 },   // topo
  { x: 1013, y: 385 },  // direita superior
  { x: 1012, y: 822 },  // direita inferior
  { x: 626, y: 1034 },  // baixo
  { x: 238, y: 822 },   // esquerda inferior
  { x: 239, y: 385 },   // esquerda superior
];
const CENTRO = { x: 625, y: 604 };
const R_NO = 82.5;
const TRACO = 31;

export function SimboloConsultaISP({ tamanho = 32, className }: { tamanho?: number; className?: string }) {
  const largura = Math.round(tamanho * (951 / 1035));
  return (
    <svg
      viewBox="150 87 951 1035"
      width={largura}
      height={tamanho}
      className={className}
      role="img"
      aria-label="Consulta ISP"
    >
      {/* Perímetro e raios primeiro: os nós entram por cima e escondem as pontas. */}
      <g stroke="var(--marca-traco)" strokeWidth={TRACO} strokeLinecap="round" fill="none">
        {NOS.map((n, i) => {
          const p = NOS[(i + 1) % NOS.length];
          return <line key={`a${i}`} x1={n.x} y1={n.y} x2={p.x} y2={p.y} />;
        })}
        {NOS.map((n, i) => (
          <line key={`r${i}`} x1={CENTRO.x} y1={CENTRO.y} x2={n.x} y2={n.y} />
        ))}
      </g>

      {NOS.map((n, i) => (
        <circle key={`n${i}`} cx={n.x} cy={n.y} r={R_NO} fill="var(--marca-no)" />
      ))}

      {/* Miolo: disco verde com anel laranja da mesma espessura das linhas. */}
      <circle cx={CENTRO.x} cy={CENTRO.y} r={163} fill="var(--marca-no)" />
      <circle cx={CENTRO.x} cy={CENTRO.y} r={146.5} fill="var(--marca-ok)" />
      <path
        d="M 552 611 L 605 664 L 705 557"
        stroke="var(--marca-check)"
        strokeWidth={45}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Símbolo + nome. `comAssinatura` acrescenta a linha de apoio, que só cabe
 * quando a marca é grande — abaixo de ~28px ela vira borrão.
 */
export default function Marca({ variante = "completa", tamanho = 32, comAssinatura = false, className }: Props) {
  if (variante === "simbolo") return <SimboloConsultaISP tamanho={tamanho} className={className} />;

  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <SimboloConsultaISP tamanho={tamanho} />
      <span className="flex flex-col leading-none">
        {/* Montserrat Bold 700, cores do brief: "Consulta" em azul-ardosia no
            tema claro e branco no escuro; "ISP" em laranja nos dois. */}
        <span
          style={{
            fontFamily: "var(--marca-fonte)", fontWeight: 700,
            fontSize: Math.round(tamanho * 0.54), letterSpacing: "-0.01em",
            color: "var(--marca-nome)",
          }}
        >
          Consulta <span style={{ color: "var(--marca-no)" }}>ISP</span>
        </span>
        {comAssinatura && (
          <span
            className="uppercase"
            style={{
              fontFamily: "var(--marca-fonte)", fontWeight: 500,
              fontSize: Math.max(8, Math.round(tamanho * 0.2)),
              letterSpacing: "0.1em",           /* o brief pede +8% a +12% */
              color: "var(--marca-assinatura)",
              marginTop: Math.round(tamanho * 0.16),
            }}
          >
            Base colaborativa de crédito
          </span>
        )}
      </span>
    </span>
  );
}
