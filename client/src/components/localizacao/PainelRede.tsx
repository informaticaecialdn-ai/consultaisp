import { Globe2 } from "lucide-react";
import { Kicker, MONO, CARD, num } from "./ui";

/**
 * O painel da rede — o que o mapa é, e por que não há lista.
 *
 * Substitui o ranking de bairros da rede. Regra do dono (02/09/2026): dados da
 * rede são só o ponto no mapa, sem informações — nenhum nome de bairro, valor
 * ou provedor sai do servidor. Sem isso não há o que ranquear; o que este
 * painel faz é dizer ao operador o que ele está vendo e o que ficou de fora,
 * porque mapa vazio sem explicação parece ferramenta quebrada.
 */
export default function PainelRede({
  casos, bairros, pontos, ocultas, semPonto, minPorBairro, carregando, semArea, porPonto,
}: {
  casos: number;
  bairros: number;
  pontos: number;
  ocultas: number;
  semPonto: number;
  minPorBairro: number;
  carregando: boolean;
  semArea: boolean;
  porPonto: boolean;
}) {
  const Linha = ({ rotulo, valor }: { rotulo: string; valor: number }) => (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border-faint)" }}>
      <span style={{ fontSize: 12, color: "var(--text-2)" }}>{rotulo}</span>
      <span style={{ ...MONO, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{num(valor)}</span>
    </div>
  );

  return (
    <div
      style={{ ...CARD, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}
      data-testid="painel-rede"
    >
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border-faint)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <Globe2 size={14} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
          <Kicker style={{ fontSize: 11 }}>Rede · só o ponto no mapa</Kicker>
        </span>
        <p style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 8, lineHeight: 1.55 }}>
          Ex-clientes com dívida de <strong>todos os provedores</strong> nas suas cidades.
          Nenhum nome, documento, valor, bairro ou provedor sai do servidor — só a posição
          e a contagem. É o que a LGPD permite compartilhar entre provedores.
        </p>
      </div>

      <div style={{ padding: "6px 14px 12px", overflow: "auto" }}>
        {carregando && (
          <p style={{ padding: "24px 0", fontSize: 12.5, color: "var(--text-muted)", textAlign: "center" }}>
            Consultando a rede…
          </p>
        )}

        {!carregando && semArea && (
          <p style={{ padding: "24px 0", fontSize: 12.5, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.6 }}>
            Configure as cidades atendidas para ver a rede — sem recorte, isto seria a base
            inteira do país, não a sua região.
          </p>
        )}

        {!carregando && !semArea && (
          <>
            <Linha rotulo="casos na rede" valor={casos} />
            <Linha rotulo={`bairros com ${minPorBairro}+ casos`} valor={bairros} />
            {porPonto && <Linha rotulo="pontos no mapa" valor={pontos} />}
            {porPonto && semPonto > 0 && <Linha rotulo="só na bolha (sem coordenada confiável)" valor={semPonto} />}
            {ocultas > 0 && <Linha rotulo={`fora do mapa (bairros com menos de ${minPorBairro})`} valor={ocultas} />}

            {casos === 0 && (
              <p style={{ padding: "18px 0 6px", fontSize: 12.5, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.6 }}>
                {ocultas > 0
                  ? `Nenhum bairro chegou a ${minPorBairro} casos. A rede tem ${num(ocultas)} ${ocultas === 1 ? "ocorrência espalhada" : "ocorrências espalhadas"}, poucas demais para agregar sem apontar alguém.`
                  : "Nenhum ex-cliente com dívida na rede, nas suas cidades."}
              </p>
            )}

            <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.55 }}>
              <p>A bolha fica no centro do bairro pelo censo de endereços do IBGE (CNEFE 2022), com área proporcional ao número de casos.</p>
              <p style={{ marginTop: 6 }}>O ponto é uma ocorrência com o local deslocado em até ~150 m — o bastante para tirar o número da casa e manter a quadra.</p>
              <p style={{ marginTop: 6 }}>Cliente ativo de outro provedor nunca aparece: só contrato encerrado com dívida.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
