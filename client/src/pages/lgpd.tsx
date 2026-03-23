import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Mail, Clock, Users, FileText, Globe } from "lucide-react";

export default function LgpdPage() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/public/lgpd-info"] });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">

        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full">
            <Shield className="w-3.5 h-3.5" />
            Privacidade & Conformidade
          </div>
          <h1 className="text-4xl font-black text-slate-900">Política de Privacidade</h1>
          <p className="text-slate-600 max-w-2xl mx-auto text-base leading-relaxed">
            Em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018)
            e o Código de Defesa do Consumidor.
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map(i => <div key={i} className="h-32 rounded-xl bg-slate-200 animate-pulse" />)}
          </div>
        ) : (
          <div className="grid gap-6">
            <Card className="border-blue-100" data-testid="lgpd-card-empresa">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="w-4 h-4 text-blue-600" />
                  Identificação do Responsável
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                <div className="flex justify-between"><span className="text-muted-foreground">Empresa:</span><span className="font-semibold">{data?.empresa}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">CNPJ:</span><span className="font-semibold">{data?.cnpj}</span></div>
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Encarregado (DPO):</span>
                  <a href={`mailto:${data?.encarregado}`} className="font-semibold text-blue-600 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" />{data?.encarregado}
                  </a>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="lgpd-card-finalidade">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="w-4 h-4 text-violet-600" />
                  Finalidade e Base Legal
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-700">
                <div>
                  <p className="text-muted-foreground mb-1">Finalidade do tratamento:</p>
                  <p className="bg-slate-50 rounded-lg p-3 leading-relaxed">{data?.finalidade}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Base legal (LGPD):</p>
                  <p className="bg-slate-50 rounded-lg p-3 leading-relaxed">{data?.base_legal}</p>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="lgpd-card-direitos">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="w-4 h-4 text-emerald-600" />
                  Seus Direitos como Titular
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  {data?.direitos?.map((d: string) => (
                    <Badge key={d} variant="secondary" className="text-xs" data-testid={`badge-direito-${d}`}>{d}</Badge>
                  ))}
                </div>
                <p className="text-sm text-slate-600">
                  Para exercer seus direitos, entre em contato via{" "}
                  <a href={`mailto:${data?.canal_solicitacao}`} className="text-blue-600 font-medium">{data?.canal_solicitacao}</a>.
                  Prazo máximo de resposta: <strong>{data?.prazo_resposta_dias} dias</strong>.
                </p>
              </CardContent>
            </Card>

            <Card data-testid="lgpd-card-retencao">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="w-4 h-4 text-orange-600" />
                  Retenção e Compartilhamento de Dados
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-700">
                <div className="flex justify-between items-start">
                  <span className="text-muted-foreground">Prazo de retenção:</span>
                  <span className="font-semibold text-right max-w-xs">{data?.tempo_retencao}</span>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                  <p className="text-amber-800 text-xs leading-relaxed">
                    Os dados compartilhados entre ISPs da rede são <strong>anonimizados</strong> —
                    apenas indicadores de adimplência (dias de atraso, faixa de valor, equipamentos pendentes).
                    Nunca nome, CPF, endereço ou dados pessoais identificáveis são expostos a terceiros.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="lgpd-card-autoridade">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3 text-sm text-slate-700">
                  <Shield className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium mb-0.5">Autoridade Supervisora</p>
                    <p className="text-muted-foreground">{data?.autoridade}</p>
                    <a href="https://www.gov.br/anpd" target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 text-xs mt-1 inline-block hover:underline">
                      www.gov.br/anpd ↗
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Última atualização: março de 2026 · Versão 2.0
        </p>
      </div>
    </div>
  );
}
