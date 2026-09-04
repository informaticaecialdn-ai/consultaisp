/**
 * /revenda — a primeira tela do revendedor.
 *
 * Ela responde duas perguntas, e só essas duas: quantos provedores existem sob
 * a minha marca e em que estado eles estão; e o que andou acontecendo na marca.
 *
 * ── O QUE NÃO ESTÁ AQUI, E POR QUÊ ─────────────────────────────────────────
 *
 * Comissão, créditos vendidos, consumo do mês e o gráfico de 6 meses são das
 * fases 3 e 4 — não existe lançamento gravado, nem preço de marca, nem
 * fechamento. Um card "Comissão: R$ 0,00" seria indistinguível do caso real em
 * que o revendedor vendeu e não recebeu: a tela afirmaria zero onde a verdade é
 * "ninguém calculou ainda". Card vazio prometendo número que ninguém calcula é
 * pior do que card ausente, então eles entram junto com o cálculo.
 *
 * ── SOBRE O ESTADO VAZIO ───────────────────────────────────────────────────
 *
 * Marca recém-criada tem zero provedores, e quatro zeros não dizem o que fazer.
 * O CTA aponta para /revenda/marca porque é a única ação que o revendedor
 * consegue tomar sozinho nesta fase: quem cria e vincula provedor é a
 * plataforma (o painel de provedores é a fase 2). Prometer um botão "Novo
 * provedor" que ainda não existe seria mentir para quem acabou de entrar.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import {
  CabecalhoPainel, CartaoMetrica, KickerSecao, EstadoVazio, LinhasSkeleton,
  AvisoNaoCarregou, TabelaPainel, Th, Td, BOTAO_SECUNDARIO,
} from "@/components/painel/ui";
import { Building2, Clock, PauseCircle, UserPlus, History, Palette } from "lucide-react";
import {
  rotuloDaAcao, quemFez, complementoDoEvento, dataHoraDoEvento, type EventoNaTela,
} from "./eventos";

/**
 * O que `GET /api/revenda/visao-geral` devolve nesta fase.
 *
 * Os números vêm agrupados por assunto porque as fases seguintes acrescentam
 * grupos inteiros (`creditos`, `consumo`, `comissao`) — com tudo plano, a
 * chegada de `pendente` (comissão) ao lado de `suspensos` (provedores) obrigaria
 * a renomear campo já em uso.
 *
 * Só agregados: o escopo do revendedor não inclui uma única linha de titular.
 */
type VisaoGeralDaRevenda = {
  provedores: {
    /**
     * O `count(*)` da mesma varredura. Vem do servidor porque os outros
     * contadores SE SOBREPÕEM: `aguardandoAprovacao` conta
     * `verification_status = 'pending'` e `ativos` conta `status = 'active'` —
     * eixos diferentes. Somá-los contava duas vezes o provedor recém-criado
     * (ativo e ainda pendente) e nenhuma vez o cancelado.
     */
    total: number;
    ativos: number;
    aguardandoAprovacao: number;
    suspensos: number;
    novosNoMes: number;
  };
};

const QUANTOS_EVENTOS = 8;

export default function VisaoGeralDaRevenda() {
  const resumo = useQuery<VisaoGeralDaRevenda>({
    queryKey: ["/api/revenda/visao-geral"],
    staleTime: 30_000,
  });

  const eventos = useQuery<EventoNaTela[]>({
    queryKey: [`/api/revenda/eventos?limite=${QUANTOS_EVENTOS}`],
    staleTime: 30_000,
  });

  const p = resumo.data?.provedores;
  /* Enquanto a resposta não chega, `total` fica nulo — e não zero. Zero aqui
     abriria o estado vazio ("nenhum provedor ainda") por um instante em toda
     carga, inclusive na marca que tem cinquenta.

     O número vem do servidor e não é somado aqui: este `total` é o portão do
     estado vazio, e a soma dos três contadores errava nos dois sentidos —
     contava duas vezes o provedor ativo e ainda pendente de aprovação, e
     nenhuma vez o cancelado. Uma marca com três provedores cancelados via
     "Nenhum provedor na sua marca ainda", que é a tela afirmando um fato falso
     sobre a marca de quem está lendo. */
  const total = p ? p.total : null;

  return (
    <div className="p-4 lg:p-6 pb-10 max-w-[1100px] mx-auto space-y-6" data-testid="revenda-visao-geral">
      <CabecalhoPainel
        titulo="Visão geral"
        descricao="Os provedores que operam sob a sua marca e o que mudou nela. Os dados de consulta continuam na base colaborativa — a marca muda o que o cliente vê, não o que o sistema consulta."
        testIdTitulo="text-revenda-titulo"
      />

      {resumo.isError && (
        <AvisoNaoCarregou
          aoTentarDeNovo={() => resumo.refetch()}
          testId="aviso-resumo-falhou"
        >
          Os números dos seus provedores não carregaram. Nada foi alterado — é só a leitura que falhou.
        </AvisoNaoCarregou>
      )}

      {total === 0 ? (
        <Card>
          <EstadoVazio
            Icone={Building2}
            titulo="Nenhum provedor na sua marca ainda"
            descricao="Assim que a plataforma cadastrar ou vincular o primeiro provedor, ele aparece aqui com o estado dele. Enquanto isso, deixe a marca pronta para quem chegar."
            testId="vazio-sem-provedores"
            cta={
              <Link href="/revenda/marca">
                <button type="button" className={BOTAO_SECUNDARIO} data-testid="button-ir-para-marca">
                  <Palette className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                  Ajustar minha marca
                </button>
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <CartaoMetrica
            Icone={Building2}
            rotulo="Provedores ativos"
            valor={p ? p.ativos : "—"}
            carregando={resumo.isLoading}
            sub="operando normalmente"
            testId="card-provedores-ativos"
            testIdValor="value-provedores-ativos"
          />
          <CartaoMetrica
            Icone={Clock}
            rotulo="Aguardando aprovação"
            valor={p ? p.aguardandoAprovacao : "—"}
            carregando={resumo.isLoading}
            /* Quem aprova é a plataforma, sempre: o KYC protege a base
               colaborativa de todos os provedores, não só os desta marca. Sem
               esta linha o revendedor fica esperando um botão que não é dele. */
            sub="conferência da plataforma"
            testId="card-provedores-pendentes"
            testIdValor="value-provedores-pendentes"
          />
          <CartaoMetrica
            Icone={PauseCircle}
            rotulo="Suspensos"
            valor={p ? p.suspensos : "—"}
            carregando={resumo.isLoading}
            sub="sem acesso ao sistema"
            testId="card-provedores-suspensos"
            testIdValor="value-provedores-suspensos"
          />
          <CartaoMetrica
            Icone={UserPlus}
            rotulo="Novos no mês"
            valor={p ? p.novosNoMes : "—"}
            carregando={resumo.isLoading}
            sub="entradas desde o dia 1º"
            testId="card-provedores-novos"
            testIdValor="value-provedores-novos"
          />
        </div>
      )}

      {/* Fases 3 e 4 entram aqui: créditos vendidos, consumo do mês, comissão
          pendente/a receber e o gráfico de 6 meses (bruto × comissão). Ver o
          comentário do topo — nada disso é calculado ainda. */}

      <div>
        <KickerSecao testId="kicker-eventos">Últimos eventos da marca</KickerSecao>
        {/* `p-0 overflow-hidden`: o cabeçalho da tabela tem fundo próprio
            (--surface-2) e, sem o recorte, ele passa por cima do canto
            arredondado do card. */}
        <Card className="p-0 overflow-hidden">
          {eventos.isError ? (
            <div className="p-3">
              <AvisoNaoCarregou aoTentarDeNovo={() => eventos.refetch()} testId="aviso-eventos-falhou">
                A trilha da marca não carregou. Ela é o registro de quem mexeu em quê — vale tentar de novo antes de concluir que nada aconteceu.
              </AvisoNaoCarregou>
            </div>
          ) : eventos.isLoading ? (
            <div className="p-3">
              <LinhasSkeleton linhas={4} />
            </div>
          ) : (eventos.data?.length ?? 0) === 0 ? (
            <EstadoVazio
              Icone={History}
              titulo="Nada registrado ainda"
              descricao="Toda alteração na marca, nos provedores e na equipe fica registrada aqui, com quem fez e quando — inclusive o que a plataforma faz pela sua marca."
              testId="vazio-eventos"
            />
          ) : (
            <TabelaPainel testId="tabela-eventos">
              <thead>
                <tr>
                  <Th>quando</Th>
                  <Th>o que aconteceu</Th>
                  <Th>quem</Th>
                </tr>
              </thead>
              <tbody>
                {eventos.data!.map(evento => {
                  const complemento = complementoDoEvento(evento);
                  return (
                    <tr key={evento.id} data-testid={`evento-${evento.id}`}>
                      {/* Data é dado: mono tabular, alinhada à esquerda porque se
                          lê como carimbo e não como quantidade. */}
                      <Td num alinhamento="esquerda" className="whitespace-nowrap text-[var(--text-muted)]">
                        {dataHoraDoEvento(evento.createdAt)}
                      </Td>
                      <Td>
                        <span className="text-[var(--text)]">{rotuloDaAcao(evento.acao)}</span>
                        {complemento && (
                          <span className="block text-[11.5px] text-[var(--text-muted)] leading-snug">
                            {complemento}
                          </span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">{quemFez(evento.atorRole, evento.atorNome)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </TabelaPainel>
          )}
        </Card>
      </div>

      {/* O bloco "próxima ação" (sem e-mail verificado, sem ERP, sem consulta em
          30 dias) precisa da lista de provedores da marca, que é a fase 2. */}
    </div>
  );
}
