/**
 * Política de privacidade — página PÚBLICA, em qualquer host.
 *
 * Quem mais precisa dela é quem não tem conta: o titular que quer saber quem
 * trata os dados dele. Por isso ela é servida antes da sessão (ver o desvio em
 * App.tsx) e por isso ela veste a marca do HOST — num domínio de revendedor, o
 * controlador nomeado aqui é o revendedor, e a plataforma aparece como
 * operadora. Quem decide isso é `GET /api/public/lgpd-info`, no servidor.
 *
 * A cor sai de token, não de classe do Tailwind: `--brand` é sobrescrito por
 * host (server/marca-html.ts), então a página pintada em azul cravado seria
 * azul no domínio de todo revendedor — a única página pública do produto
 * ignorando a marca de quem a serve.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMarca } from "@/lib/marca";
import { Shield, Mail, Clock, Users, FileText, Globe } from "lucide-react";

export default function LgpdPage() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/public/lgpd-info"] });
  const marca = useMarca();

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">

        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 rounded bg-[var(--brand-soft)] text-[var(--brand-ink)] font-mono text-[10px] uppercase tracking-[var(--track-wide)] px-2.5 py-1.5">
            <Shield className="w-3.5 h-3.5" />
            Privacidade e conformidade
          </div>
          <h1 className="text-4xl font-light tracking-[-0.028em] text-[var(--text)]">Política de Privacidade</h1>
          <p className="text-[var(--text-muted)] max-w-2xl mx-auto text-base leading-relaxed">
            Em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018)
            e o Código de Defesa do Consumidor.
          </p>
          {/* Qual serviço é este. Num domínio de revendedor o titular contratou
              a marca dele, e a página tem de dizer o nome que ele reconhece. */}
          <p className="text-[var(--text-faint)] text-[12px]">
            Aplicável ao serviço {marca.nomeProduto}.
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map(i => <div key={i} className="h-32 rounded-lg bg-[var(--surface-inset)] animate-pulse" />)}
          </div>
        ) : (
          <div className="grid gap-6">
            <Card data-testid="lgpd-card-empresa">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="w-4 h-4 text-[var(--brand)]" />
                  Identificação do Responsável
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-[var(--text-2)]">
                <div className="flex justify-between gap-4"><span className="text-[var(--text-muted)]">Empresa:</span><span className="font-semibold text-right">{data?.empresa}</span></div>
                <div className="flex justify-between gap-4"><span className="text-[var(--text-muted)]">CNPJ:</span><span className="font-mono tabular-nums font-medium">{data?.cnpj}</span></div>
                <div className="flex justify-between items-center gap-4"><span className="text-[var(--text-muted)]">Encarregado (DPO):</span>
                  <a href={`mailto:${data?.encarregado}`} className="font-semibold text-[var(--brand)] flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" />{data?.encarregado}
                  </a>
                </div>

                {/* White label: quando o controlador é um revendedor, a
                    plataforma que opera a infraestrutura precisa ser nomeada.
                    Omitir não deixa o white label mais bonito — deixa o titular
                    sem saber quem, de fato, processa os dados dele, que é
                    exatamente o que a LGPD manda informar. */}
                {data?.operador && (
                  <div className="pt-3 mt-1 border-t border-[var(--border)] space-y-1.5">
                    <p className="text-[var(--text-muted)] text-xs">
                      Operadora (processa os dados em nome do responsável acima):
                    </p>
                    <div className="flex justify-between gap-4">
                      <span className="text-[var(--text-muted)]">Empresa:</span>
                      <span className="font-semibold text-right">{data.operador.empresa}</span>
                    </div>
                    {data.operador.cnpj && (
                      <div className="flex justify-between gap-4">
                        <span className="text-[var(--text-muted)]">CNPJ:</span>
                        <span className="font-mono tabular-nums font-medium">{data.operador.cnpj}</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="lgpd-card-finalidade">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="w-4 h-4 text-[var(--brand)]" />
                  Finalidade e Base Legal
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-[var(--text-2)]">
                <div>
                  <p className="text-[var(--text-muted)] mb-1">Finalidade do tratamento:</p>
                  <p className="bg-[var(--surface-inset)] rounded-lg p-3 leading-relaxed">{data?.finalidade}</p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] mb-1">Base legal (LGPD):</p>
                  <p className="bg-[var(--surface-inset)] rounded-lg p-3 leading-relaxed">{data?.base_legal}</p>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="lgpd-card-direitos">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="w-4 h-4 text-[var(--ok)]" />
                  Seus Direitos como Titular
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  {data?.direitos?.map((d: string) => (
                    <Badge key={d} variant="secondary" className="rounded text-xs" data-testid={`badge-direito-${d}`}>{d}</Badge>
                  ))}
                </div>
                <p className="text-sm text-[var(--text-muted)]">
                  Para exercer seus direitos, entre em contato via{" "}
                  <a href={`mailto:${data?.canal_solicitacao}`} className="text-[var(--brand)] font-medium">{data?.canal_solicitacao}</a>.
                  Prazo máximo de resposta:{" "}
                  <strong className="font-mono tabular-nums text-[var(--text)]">{data?.prazo_resposta_dias}</strong> dias.
                </p>
              </CardContent>
            </Card>

            <Card data-testid="lgpd-card-retencao">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="w-4 h-4 text-[var(--gated)]" />
                  Retenção e Compartilhamento de Dados
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-[var(--text-2)]">
                <div className="flex justify-between items-start gap-4">
                  <span className="text-[var(--text-muted)]">Prazo de retenção:</span>
                  <span className="font-semibold text-right max-w-xs">{data?.tempo_retencao}</span>
                </div>
                <div className="bg-[var(--gated-bg)] border border-[var(--gated-border)] rounded-lg p-3">
                  <p className="text-[var(--gated)] text-xs leading-relaxed">
                    Os dados compartilhados entre ISPs da rede são <strong>anonimizados</strong> —
                    apenas indicadores de adimplência (dias de atraso, faixa de valor, equipamentos pendentes).
                    Nunca nome, CPF, endereço ou dados pessoais identificáveis são expostos a terceiros.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="lgpd-card-autoridade">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3 text-sm text-[var(--text-2)]">
                  <Shield className="w-5 h-5 text-[var(--text-muted)] flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium mb-0.5">Autoridade Supervisora</p>
                    <p className="text-[var(--text-muted)]">{data?.autoridade}</p>
                    <a href="https://www.gov.br/anpd" target="_blank" rel="noopener noreferrer"
                      className="text-[var(--brand)] text-xs mt-1 inline-block hover:underline">
                      www.gov.br/anpd ↗
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <p className="text-center text-xs text-[var(--text-faint)]">
          Última atualização: março de 2026 · Versão 2.0
        </p>
      </div>
    </div>
  );
}
