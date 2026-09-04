import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, FileSearch, AlertCircle, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import {
  ALVO_CONTROLE, BOTAO_MARCA, DESABILITAVEL, EstadoVazio, FOCO, KickerSecao,
  ROTULO_CAMPO, Selo, type TomSelo,
} from "@/components/painel/ui";
import { cn } from "@/lib/utils";
import CopiarBotao from "@/components/consulta/CopiarBotao";
import {
  codigoParaUrl, desfechoDaFicha, linhasDaFicha, mensagemDoErro,
  ROTULO_DO_TIPO, type FichaDeConsulta, type TomDoDesfecho,
} from "./consulta-por-codigo";

/**
 * A tela onde o suporte cola o codigo e ve a consulta.
 *
 * Existe porque o codigo sozinho e decoracao: o provedor liga dizendo "a
 * consulta CI-2609-K7F3M2 deu erro" e, ate aqui, nao havia nenhuma rota nem
 * nenhuma tela que aceitasse isso.
 *
 * A busca e MUTATION, nao query: e uma acao que quem atende dispara ao apertar
 * Enter, com o resultado descartado ao digitar outro codigo. `useQuery` guarda
 * o resultado por chave e reexecutaria sozinho — dois comportamentos que numa
 * caixa de busca aparecem como a ficha do chamado ANTERIOR reaparecendo na
 * tela enquanto se digita o proximo.
 *
 * A ficha NAO tem o relatorio da consulta, de proposito: ver o comentario de
 * LGPD em GET /api/admin/consultas?codigo=. Quem atende ve metadados e o
 * protocolo a apresentar ao bureau; o dado do titular fica onde esta.
 *
 * RODADA DE LINGUAGEM VISUAL. A tela desenhava tudo em estilo inline com as
 * primitivas do RELATORIO de consulta (`components/consulta/report-ui`), que e
 * outro vocabulario — o do documento que o provedor le. Aqui e painel de
 * operacao, e agora ela fala pelas primitivas de `@/components/painel/ui`,
 * como o resto do painel. Nenhuma rota, endpoint, parametro ou data-testid
 * mudou; `consulta-por-codigo.ts`, que e onde mora a logica testada, nao foi
 * tocado.
 *
 * DUAS DECISOES, declaradas:
 *
 * 1. O CODIGO GANHOU BOTAO DE COPIAR. Ele existe para ser colado num ticket ou
 *    num e-mail, e ate aqui quem atende tinha de selecionar o texto com o
 *    mouse. Reaproveita `CopiarBotao`, que ja tem o estado honesto de tres
 *    valores (parado / copiado / NAO copiado) — um botao que diz "copiado" sem
 *    ter copiado faz o operador colar outra coisa no chamado.
 *
 * 2. O DESFECHO "recusa" VIRA `danger`, NAO `past`. No vocabulario do relatorio
 *    ele era `past`, o tom de divida vencida; o `Selo` do painel nao tem esse
 *    tom, e nem deveria — aqui a leitura e "a consulta recusou", que e porta
 *    fechada. `danger` e o tom que a secao 3 reserva para isso.
 *
 * O ROTULO DAS LINHAS DA FICHA CONTINUA MONO, e nao vira `KickerSecao`: as
 * linhas sao uma lista de dados (secao 2 do DESIGN_SYSTEM manda IBM Plex Mono
 * em dado e rotulo de dado, e a `.ds-table th` da secao 6 e exatamente este
 * desenho). `KickerSecao` e titulo de secao, e um `<h2>` — nao cabe num `<dt>`.
 *
 * SEGUNDA RODADA — AS COPIAS LOCAIS FORAM APAGADAS
 * O anel de foco estava redigitado por extenso em dois controles, o rotulo do
 * `<dt>` era a quinta voz de rotulo do painel e o desabilitado era o quarto
 * valor. Os tres agora vem de `painel/ui`, com duas mudancas de pixel:
 *
 * a) O ROTULO DO `<dt>` TROCA `--text-faint` POR `--text-muted` e o peso 500
 *    pelo 400 da primitiva. Mesma familia, mesmo corpo, mesmo tracking; a tinta
 *    muda para cima, porque a 10px o faint fica abaixo do minimo de contraste
 *    da secao 7 — e o que ele perde de peso, ganha de contraste. O `mb-0`
 *    cancela a margem
 *    que a primitiva traz para campo de formulario; aqui a linha e uma grade de
 *    duas colunas alinhada pela linha de base, e a margem a desalinharia.
 *
 * b) O BOTAO "BUSCAR" DESLIGADO PASSA A SER A MARCA A 50%, e nao mais fundo
 *    afundado com tinta fraca. O tratamento anterior era mais explicito, mas
 *    era o quarto desabilitado diferente do painel — e a caixa vazia e o estado
 *    em que esta aba ABRE, entao ela era a vitrine da divergencia. O
 *    `cursor-not-allowed` continua, e e ele que avisa que o controle esta
 *    travado.
 */

/** O tom do desfecho no vocabulario do selo do painel. */
const TOM_PARA_SELO: Record<TomDoDesfecho, TomSelo> = {
  ok: "ok",
  atencao: "gated",
  recusa: "danger",
  neutro: "neutro",
};

export default function BuscaConsulta() {
  const [texto, setTexto] = useState("");

  const busca = useMutation<FichaDeConsulta, Error, string>({
    mutationFn: async (codigo: string) => {
      const res = await apiRequest("GET", `/api/admin/consultas?codigo=${encodeURIComponent(codigo)}`);
      return res.json();
    },
  });

  const procurar = () => {
    const codigo = codigoParaUrl(texto);
    // Caixa vazia nao dispara pedido: o servidor devolveria 404 da rota, e nao
    // o 400 que explica o formato — o operador leria a mensagem errada.
    if (!codigo) return;
    busca.mutate(codigo);
  };

  const ficha = busca.data;
  const impedido = busca.isPending || !codigoParaUrl(texto);
  const desfecho = ficha ? desfechoDaFicha(ficha) : null;

  return (
    <div className="flex flex-col gap-3.5 max-w-[760px]">
      {/* Campo */}
      <Card className="px-5 py-4">
        <KickerSecao className="mb-1.5">buscar consulta pelo código</KickerSecao>
        <p className="text-[13px] text-[var(--text-muted)] mb-3">
          O código que o provedor apresenta ao suporte. Pode colar como veio — minúsculas,
          com espaço ou sem traço.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex-none text-[var(--text-faint)] pointer-events-none"
              strokeWidth={2}
              aria-hidden
            />
            <input
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") procurar(); }}
              placeholder="CI-2609-K7F3M2"
              aria-label="Código da consulta"
              spellCheck={false}
              autoComplete="off"
              data-testid="input-busca-consulta"
              className={`w-full ${ALVO_CONTROLE} pl-9 pr-3 rounded bg-[var(--surface-inset)] border border-[var(--border-strong)] font-mono text-[13px] tabular-nums tracking-[0.02em] uppercase text-[var(--text)] placeholder:text-[var(--text-faint)] ${FOCO}`}
            />
          </div>
          <button
            type="button"
            onClick={procurar}
            disabled={impedido}
            data-testid="button-busca-consulta"
            className={cn(BOTAO_MARCA, DESABILITAVEL)}
          >
            {busca.isPending
              ? <><Loader2 className="w-4 h-4 flex-none motion-safe:animate-spin" strokeWidth={2} aria-hidden />Buscando</>
              : "Buscar"}
          </button>
        </div>
      </Card>

      {/* Ocioso — o estado em que a aba abre */}
      {!busca.isPending && !busca.data && !busca.error && (
        <Card data-testid="busca-consulta-ocioso">
          <EstadoVazio
            Icone={FileSearch}
            titulo="Nenhuma consulta aberta"
            descricao="Cole o código que o provedor informou. A ficha mostra quando a consulta foi feita, quem a fez, quanto custou e qual protocolo apresentar à origem do dado."
          />
        </Card>
      )}

      {/* Não encontrado e erro: a própria mensagem do servidor é o que ensina */}
      {busca.error && (
        <div
          data-testid="busca-consulta-erro"
          role="status"
          className="flex items-start gap-3 rounded-lg px-5 py-4 bg-[var(--gated-bg)] border border-[var(--gated-border)]"
        >
          <AlertCircle className="w-4 h-4 flex-none mt-0.5 text-[var(--gated)]" strokeWidth={2} aria-hidden />
          <p className="text-[13px] leading-relaxed text-[var(--text-2)]">
            {mensagemDoErro(busca.error)}
          </p>
        </div>
      )}

      {/* A ficha */}
      {ficha && desfecho && (
        <Card data-testid="busca-consulta-ficha" className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4 bg-[var(--surface-2)] border-b border-[var(--border)]">
            <div className="min-w-0">
              <KickerSecao className="mb-0">identificação</KickerSecao>
              <div className="flex items-center gap-2 mt-1">
                <span
                  data-testid="text-ficha-codigo"
                  className="font-mono text-[18px] font-medium tabular-nums tracking-[0.02em] text-[var(--text)]"
                >
                  {ficha.consultaId}
                </span>
                <CopiarBotao
                  texto={ficha.consultaId}
                  rotulo="identificador desta consulta"
                  testId="button-copiar-codigo-consulta"
                />
              </div>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <Selo>{ROTULO_DO_TIPO[ficha.tipo] ?? ficha.tipo}</Selo>
              <Selo tom={TOM_PARA_SELO[desfecho.tom]}>{desfecho.texto}</Selo>
            </div>
          </div>

          <dl className="m-0">
            {linhasDaFicha(ficha).map((linha, i) => (
              <div
                key={linha.rotulo}
                className={`grid grid-cols-[minmax(120px,200px)_1fr] gap-3.5 px-5 py-2.5 items-baseline ${
                  i === 0 ? "" : "border-t border-[var(--border-faint)]"
                }`}
              >
                <dt className={cn(ROTULO_CAMPO, "mb-0")}>{linha.rotulo}</dt>
                <dd className="m-0 min-w-0">
                  <span
                    className={`text-[var(--text)] break-words ${
                      linha.mono ? "font-mono text-[12.5px] tabular-nums" : "text-[13px]"
                    }`}
                  >
                    {linha.valor}
                  </span>
                  {linha.nota && (
                    <span className="text-[11.5px] text-[var(--text-muted)] ml-2">{linha.nota}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <p className="px-5 py-3 border-t border-[var(--border)] bg-[var(--surface-2)] text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            O relatório da consulta não é exibido aqui: o código circula por e-mail e ticket, e
            ele identifica a consulta, não autoriza a leitura do dado do titular.
          </p>
        </Card>
      )}
    </div>
  );
}
