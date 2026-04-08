import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Shield, CheckCircle, Loader2 } from "lucide-react";

const TIPOS_SOLICITACAO = [
  { value: "acesso", label: "Acesso aos meus dados" },
  { value: "correcao", label: "Correcao de dados" },
  { value: "exclusao", label: "Exclusao de dados" },
  { value: "portabilidade", label: "Portabilidade de dados" },
  { value: "revogacao", label: "Revogacao de consentimento" },
];

export default function MeusDadosPage() {
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [tipoSolicitacao, setTipoSolicitacao] = useState("");
  const [descricao, setDescricao] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultado, setResultado] = useState<{ protocolo: string; message: string; prazoResposta: string } | null>(null);
  const [erro, setErro] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");
    setResultado(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/public/titular-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpfCnpj, nome, email, tipoSolicitacao, descricao }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.message || "Erro ao enviar solicitacao");
      } else {
        setResultado(data);
      }
    } catch {
      setErro("Erro de conexao. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Meus Dados - LGPD</h1>
          <p className="text-sm text-muted-foreground">
            Exerca seus direitos como titular de dados pessoais conforme a Lei Geral de Protecao de Dados (Art. 18).
          </p>
        </div>

        {resultado ? (
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-emerald-500" />
              <div>
                <h2 className="font-semibold text-lg">Solicitacao Registrada</h2>
                <p className="text-sm text-muted-foreground">{resultado.message}</p>
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Protocolo:</span>
                <span className="font-mono font-semibold">{resultado.protocolo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Prazo de resposta:</span>
                <span>{resultado.prazoResposta}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Guarde o numero do protocolo para acompanhamento. Atualizacoes serao enviadas ao email informado.
            </p>
            <Button variant="outline" className="w-full" onClick={() => { setResultado(null); setCpfCnpj(""); setNome(""); setEmail(""); setTipoSolicitacao(""); setDescricao(""); }}>
              Nova Solicitacao
            </Button>
          </Card>
        ) : (
          <Card className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {erro && (
                <Alert variant="destructive">
                  <AlertDescription>{erro}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="cpfCnpj">CPF ou CNPJ</Label>
                <Input
                  id="cpfCnpj"
                  placeholder="000.000.000-00"
                  value={cpfCnpj}
                  onChange={(e) => setCpfCnpj(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nome">Nome completo</Label>
                <Input
                  id="nome"
                  placeholder="Seu nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email para contato</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Tipo de solicitacao</Label>
                <Select value={tipoSolicitacao} onValueChange={setTipoSolicitacao} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_SOLICITACAO.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="descricao">Descricao (opcional)</Label>
                <Textarea
                  id="descricao"
                  placeholder="Descreva detalhes da sua solicitacao..."
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  rows={3}
                />
              </div>

              <Button type="submit" className="w-full gap-2" disabled={isSubmitting || !tipoSolicitacao}>
                {isSubmitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Enviando...</>
                ) : (
                  <><Shield className="w-4 h-4" />Enviar Solicitacao</>
                )}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Base legal: LGPD Art. 18. Prazo de resposta: 15 dias uteis (Art. 18, §5).
              </p>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
