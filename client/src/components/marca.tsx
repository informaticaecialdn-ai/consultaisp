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

import { useMarca } from "@/lib/marca";

type Props = {
  /** Só o símbolo, ou o símbolo com o nome ao lado. */
  variante?: "simbolo" | "completa";
  /** Altura do símbolo em px. A largura sai da proporção. */
  tamanho?: number;
  /** Mostra a linha de apoio sob o nome. */
  comAssinatura?: boolean;
  className?: string;
  /**
   * Ignora a marca do revendedor e desenha sempre a da plataforma.
   *
   * Para as telas que são da PLATAFORMA e não do tenant — o painel do
   * superadmin, por exemplo. Ali a marca de um revendedor seria mentira.
   */
  sempreDaPlataforma?: boolean;
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
   * Revendedor cadastrado mas sem logo: monograma, nunca o hexágono da casa.
   *
   * Encontrado ao olhar a tela: com marca ativa e sem logo, a versão anterior
   * caía no símbolo da plataforma — e a porta de entrada de um revendedor
   * exibia a marca de outra empresa. Isso derruba a razão de existir da
   * feature. O monograma usa a cor dele e não afirma nada que seja falso.
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
          fontFamily: "var(--marca-fonte)", fontWeight: 700,
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
 * Símbolo + nome. `comAssinatura` acrescenta a linha de apoio, que só cabe
 * quando a marca é grande — abaixo de ~28px ela vira borrão.
 */
export default function Marca({
  variante = "completa", tamanho = 32, comAssinatura = false, className, sempreDaPlataforma,
}: Props) {
  const marca = useMarca();
  const daPlataforma = sempreDaPlataforma || marca.marcaId === null;

  if (variante === "simbolo") {
    return <SimboloDaMarca tamanho={tamanho} className={className} sempreDaPlataforma={sempreDaPlataforma} />;
  }

  const nome = daPlataforma ? "Consulta ISP" : marca.nomeProduto;
  const assinatura = daPlataforma ? "Base colaborativa de crédito" : marca.assinatura;

  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <SimboloDaMarca tamanho={tamanho} sempreDaPlataforma={sempreDaPlataforma} />
      <span className="flex flex-col leading-none">
        <span
          style={{
            fontFamily: "var(--marca-fonte)", fontWeight: 700,
            fontSize: Math.round(tamanho * 0.54), letterSpacing: "-0.01em",
            color: "var(--marca-nome)",
          }}
        >
          {daPlataforma ? (
            /* Montserrat Bold 700, cores do brief: "Consulta" em azul-ardósia no
               tema claro e branco no escuro; "ISP" em laranja nos dois. O corte
               em duas cores é ajustado à mão para ESTE nome — um nome de
               revendedor sai numa cor só, que é o que não erra. */
            <>Consulta <span style={{ color: "var(--marca-no)" }}>ISP</span></>
          ) : nome}
        </span>
        {comAssinatura && assinatura && (
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
            {assinatura}
          </span>
        )}
      </span>
    </span>
  );
}
