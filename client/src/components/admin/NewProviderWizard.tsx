import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PLANOS_DO_CATALOGO, rotuloDoPlano } from "@/lib/planos";
import {
  BOTAO_MARCA, BOTAO_SECUNDARIO, Campo, CONTROLE_CAMPO, DESABILITAVEL,
  EstadoVazio, KickerSecao, LadrilhoIcone, ROTULO_CAMPO, TITULO_CARTAO,
} from "@/components/painel/ui";
import { cn } from "@/lib/utils";
import {
  Building2, Plus, Search, RefreshCw, Check, ChevronRight,
  Settings2, MapPin, Users, User, Crown, AlertTriangle,
} from "lucide-react";

/**
 * Cadastro de provedor em tres passos, vestido na MESMA linguagem do Painel do
 * Provedor (`@/components/painel/ui`).
 *
 * Rodada de LINGUAGEM VISUAL: nenhuma rota, consulta, permissao, campo enviado
 * ou data-testid mudou. O que mudou foi como a tela fala.
 *
 * O QUE ESTAVA ERRADO, ponto a ponto
 * - Um roxo da paleta default do Tailwind pintava o titulo e o icone do passo 1:
 *   paleta proibida pela secao 7, e a cor de marca deste produto nem e aquela.
 * - Toda a familia de tokens da API antiga e os apelidos de cor do shadcn (os
 *   que apontam para o canvas e para o texto base) trocados pelos canonicos.
 * - O indicador de passo era um circulo de 9999px com numero em Inter. Virou quadrado
 *   de 4px com numero mono tabular — a geometria seca e a identidade do sistema
 *   (secao 5.1), e todo numero e mono (secao 2). Circulo de 9999px so para
 *   avatar, dot e spinner; um chip numerado nao e nenhum dos tres.
 * - O resumo final imprimia `form.plan` CRU ("free", "pro"), valor de banco na
 *   tela — secao 8. `rotuloDoPlano` ja estava importado no arquivo.
 * - "BrasilAPI" saiu do texto: e o nome do fornecedor que o produto usa por
 *   dentro, nao a resposta a "de onde vem esse dado" (a resposta e a Receita
 *   Federal, e essa ficou). Os acentos que faltavam voltaram todos.
 *
 * SOMBRA: o passo 5.2 do DESIGN_SYSTEM diz que o unico caso com elevacao e o
 * flutuante — e o `DialogContent` do shadcn ja carrega exatamente o par certo
 * (anel de 1px + lift). Este arquivo nao acrescenta sombra nenhuma; so corrige
 * o fundo do painel, que apontava para o canvas quando o certo
 * para uma superficie que flutua e `--surface`.
 *
 * SEGUNDA RODADA — AS COPIAS LOCAIS FORAM APAGADAS
 * O rotulo de campo, o par rotulo+controle, o anel de foco e o desabilitado
 * eram todos locais aqui, com a nota "quando a primitiva ganhar um campo de
 * formulario, os dois viram um". Ela ganhou: `ROTULO_CAMPO`, `Campo`, o anel de
 * foco e `DESABILITAVEL` agora vem de `painel/ui`, e o local sumiu.
 *
 * TERCEIRA RODADA — A CAIXA DO CAMPO TAMBEM SUBIU
 * Sobravam duas constantes locais para a mesma coisa: uma para o campo de texto
 * e outra para o seletor nativo, com alturas e corpos diferentes na MESMA grade.
 * Viraram `CONTROLE_CAMPO`, da primitiva. Tres mudancas de pixel vem junto e
 * estao justificadas la: a caixa de texto cai de 40px para os 36px que todo
 * controle deste painel ja tem, o corpo do texto digitado passa a 12,5px em
 * todos os campos (era 14px no campo de texto e 13px no seletor) e o campo
 * ganha o anel de foco da casa. Um `text-[13px]` cravado no subdominio saiu
 * pelo mesmo motivo: um campo com corpo proprio no meio da grade e a
 * divergencia recomecando.
 *
 * UMA MUDANCA DE PIXEL: o botao desligado passa de 40% para 50% de opacidade e
 * troca `pointer-events-none` por `cursor-not-allowed`. Sao os valores da
 * primitiva, e os dois melhoram o mesmo caso — o rotulo do botao travado e o
 * que explica o que ainda falta preencher, entao ele precisa continuar legivel,
 * e o cursor e a unica coisa que avisa que o controle esta travado. Nada muda
 * no clique: `<button disabled>` ja o ignora sozinho.
 */

/* ------------------------------------------------------------------ */
/* Vocabulario local                                                   */
/* ------------------------------------------------------------------ */

/* A caixa de campo nao mora mais aqui. Havia duas locais — uma para o campo de
   texto (so o alvo de toque, sobre a altura fixa de 40px do `Input`) e outra
   para o seletor nativo (36px, escrita a mao) —, e as duas dividiam a mesma
   grade no passo 2 com 4px de diferenca. Agora e `CONTROLE_CAMPO`, uma so, e a
   decisao de altura, corpo e foco esta escrita na primitiva. */

/** Titulo de bloco dentro do passo, na voz do kicker de secao. */
function BlocoSecao({
  Icone,
  titulo,
  children,
}: {
  Icone: React.ElementType;
  titulo: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-[var(--border)] pt-3">
      <KickerSecao className="flex items-center gap-1.5">
        <Icone className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
        {titulo}
      </KickerSecao>
      {children}
    </section>
  );
}

/** Os tres passos, na ordem. Rotulo curto: ele divide a largura com a trilha. */
const PASSOS = ["CNPJ", "Dados da empresa", "Administrador"];

function generateSubdomainSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);
}

export default function NewProviderWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [, setSubdomainEdited] = useState(false);
  const [cnpjInput, setCnpjInput] = useState("");
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjData, setCnpjData] = useState<any>(null);
  const [form, setForm] = useState({
    name: "", tradeName: "", cnpj: "", subdomain: "", plan: "free",
    contactEmail: "", contactPhone: "",
    addressZip: "", addressStreet: "", addressNumber: "",
    addressComplement: "", addressNeighborhood: "", addressCity: "", addressState: "",
    legalType: "", openingDate: "", businessSegment: "",
    adminName: "", adminEmail: "", adminPassword: "",
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/admin/providers", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Provedor criado com sucesso!" });
      onOpenChange(false);
      resetForm();
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const resetForm = () => {
    setStep(1);
    setCnpjInput("");
    setCnpjData(null);
    setSubdomainEdited(false);
    setForm({
      name: "", tradeName: "", cnpj: "", subdomain: "", plan: "free",
      contactEmail: "", contactPhone: "", addressZip: "", addressStreet: "",
      addressNumber: "", addressComplement: "", addressNeighborhood: "",
      addressCity: "", addressState: "", legalType: "", openingDate: "",
      businessSegment: "", adminName: "", adminEmail: "", adminPassword: "",
    });
  };

  const formatCnpj = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 14);
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`;
    if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`;
    if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`;
    return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  };

  const lookupCnpj = async () => {
    const clean = cnpjInput.replace(/\D/g, "");
    if (clean.length !== 14) { toast({ title: "CNPJ deve ter 14 dígitos", variant: "destructive" }); return; }
    setCnpjLoading(true);
    try {
      const res = await apiRequest("GET", `/api/admin/cnpj/${clean}`);
      if (!res.ok) throw new Error((await res.json()).message);
      const data = await res.json();
      setCnpjData(data);
      const slug = generateSubdomainSlug(data.nomeFantasia || data.razaoSocial);
      setForm(p => ({
        ...p,
        name: data.razaoSocial, tradeName: data.nomeFantasia, cnpj: clean,
        subdomain: slug, contactEmail: data.email, contactPhone: data.telefone,
        addressZip: data.cep, addressStreet: data.logradouro, addressNumber: data.numero,
        addressComplement: data.complemento, addressNeighborhood: data.bairro,
        addressCity: data.cidade, addressState: data.uf,
        legalType: data.naturezaJuridica, openingDate: data.dataAbertura,
        businessSegment: data.atividadePrincipal,
      }));
      setStep(2);
    } catch (e: any) {
      toast({ title: "Erro ao consultar CNPJ", description: e.message, variant: "destructive" });
    } finally { setCnpjLoading(false); }
  };

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const handleSubdomainChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSubdomainEdited(true);
    setForm(p => ({ ...p, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30) }));
  };

  const canProceedStep2 = form.name && form.cnpj && form.subdomain;
  const canProceedStep3 = form.adminName && form.adminEmail && form.adminPassword.length >= 6;

  /* Cidade/UF: sem os dois, "/" sozinho na tela nao e informacao. */
  const cidadeUf = form.addressCity && form.addressState
    ? `${form.addressCity}/${form.addressState}`
    : form.addressCity || form.addressState || "—";

  const RESUMO: Array<{ rotulo: string; valor: React.ReactNode; mono?: boolean }> = [
    { rotulo: "Empresa", valor: form.tradeName || form.name || "—" },
    { rotulo: "CNPJ", valor: formatCnpj(form.cnpj) || "—", mono: true },
    { rotulo: "Subdomínio", valor: `${form.subdomain}.consultaisp.com.br`, mono: true },
    /* Rotulo do plano, nao a chave de banco. */
    { rotulo: "Plano", valor: rotuloDoPlano(form.plan) },
    { rotulo: "Cidade", valor: cidadeUf },
    { rotulo: "Telefone", valor: form.contactPhone || "—", mono: !!form.contactPhone },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[var(--surface)] border-[var(--border)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">
            <Building2 className="w-4 h-4 flex-none text-[var(--text-faint)]" strokeWidth={2} aria-hidden />
            Novo provedor
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[var(--text-muted)]">
            Cadastre um provedor em três passos
          </DialogDescription>
        </DialogHeader>

        {/* Indicador de passo. Quadrado de 4px, numero mono tabular, trilha de
            1px — a mesma geometria do resto do sistema. Concluido em --ok,
            atual em --brand, futuro em --surface-inset: saturacao so onde ela
            significa alguma coisa. */}
        <ol className="flex items-center gap-2 py-1" aria-label="Etapas do cadastro">
          {PASSOS.map((rotulo, i) => {
            const numero = i + 1;
            const concluido = step > numero;
            const atual = step === numero;
            return (
              <li
                key={rotulo}
                className="flex items-center gap-2 flex-1 min-w-0"
                aria-current={atual ? "step" : undefined}
              >
                <span
                  className={cn(
                    "w-7 h-7 rounded grid place-items-center flex-none font-mono text-[11px] font-medium tabular-nums motion-safe:transition-colors",
                    concluido
                      ? "bg-[var(--ok)] text-[var(--text-on-brand)]"
                      : atual
                        ? "bg-[var(--brand)] text-[var(--text-on-brand)]"
                        : "bg-[var(--surface-inset)] text-[var(--text-faint)]",
                  )}
                >
                  {concluido ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden /> : numero}
                </span>
                <span
                  className={cn(
                    "text-[12px] font-medium truncate",
                    atual ? "text-[var(--text)]" : "text-[var(--text-muted)]",
                  )}
                >
                  {rotulo}
                </span>
                {i < PASSOS.length - 1 && (
                  <span
                    className={cn(
                      "flex-1 h-px min-w-[8px]",
                      concluido ? "bg-[var(--ok)]" : "bg-[var(--border)]",
                    )}
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ol>

        {/* Passo 1: busca do CNPJ.
            E literalmente um estado vazio — nao ha dado nenhum ainda e a tela
            precisa dizer o que fazer a seguir —, entao usa a primitiva
            `EstadoVazio` em vez de repetir icone solto + paragrafo centralizado.
            O par campo+botao entra como CTA. */}
        {step === 1 && (
          <EstadoVazio
            Icone={Search}
            titulo="Buscar a empresa pelo CNPJ"
            descricao="Os dados cadastrais vêm do registro da Receita Federal e já preenchem o próximo passo."
            cta={
              <div className="flex gap-2 w-full max-w-md">
                <Input
                  placeholder="00.000.000/0000-00"
                  value={cnpjInput}
                  onChange={(e) => setCnpjInput(formatCnpj(e.target.value))}
                  onKeyDown={(e) => e.key === "Enter" && lookupCnpj()}
                  className={cn(CONTROLE_CAMPO, "text-center font-mono text-[15px] tabular-nums tracking-[var(--track-wide)]")}
                  aria-label="CNPJ do provedor"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={lookupCnpj}
                  disabled={cnpjLoading}
                  className={cn(BOTAO_MARCA, DESABILITAVEL, "px-5")}
                >
                  {cnpjLoading
                    ? <RefreshCw className="w-4 h-4 motion-safe:animate-spin" strokeWidth={2} aria-hidden />
                    : <Search className="w-4 h-4" strokeWidth={2} aria-hidden />}
                  Buscar
                </button>
              </div>
            }
          />
        )}

        {/* Passo 2: dados vindos da Receita, abertos para correcao */}
        {step === 2 && (
          <div className="space-y-4 py-1">
            {cnpjData?.situacao && cnpjData.situacao !== "ATIVA" && (
              /* A situacao cadastral sai como a Receita a escreve: e o termo
                 dela, publico e em portugues, e traduzir mudaria o fato. O que
                 mudou foi a moldura — `gated` e a porta que ainda nao abriu. */
              <p
                className="flex items-center gap-2 rounded border border-[var(--gated-border)] bg-[var(--gated-bg)] px-3 py-2 text-[12.5px] text-[var(--gated)]"
                role="status"
              >
                <AlertTriangle className="w-4 h-4 flex-none" strokeWidth={2} aria-hidden />
                Situação cadastral na Receita Federal:{" "}
                <strong className="font-mono font-medium uppercase tracking-[var(--track-wide)]">
                  {cnpjData.situacao}
                </strong>
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo rotulo="Razão social" className="sm:col-span-2">
                <Input value={form.name} onChange={f("name")} className={CONTROLE_CAMPO} />
              </Campo>
              <Campo rotulo="Nome fantasia">
                <Input value={form.tradeName} onChange={f("tradeName")} className={CONTROLE_CAMPO} />
              </Campo>
              <Campo rotulo="CNPJ">
                <Input
                  value={formatCnpj(form.cnpj)}
                  disabled
                  className={cn(CONTROLE_CAMPO, "bg-[var(--surface-inset)] font-mono tabular-nums")}
                />
              </Campo>
              <Campo rotulo="Telefone">
                <Input
                  value={form.contactPhone}
                  onChange={f("contactPhone")}
                  placeholder="(00) 0000-0000"
                  className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")}
                />
              </Campo>
              <Campo rotulo="E-mail">
                <Input
                  value={form.contactEmail}
                  onChange={f("contactEmail")}
                  placeholder="contato@provedor.com"
                  className={CONTROLE_CAMPO}
                />
              </Campo>
            </div>

            <BlocoSecao Icone={MapPin} titulo="Endereço">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <Campo rotulo="CEP">
                  <Input
                    value={form.addressZip}
                    onChange={f("addressZip")}
                    className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")}
                  />
                </Campo>
                <Campo rotulo="Logradouro" className="sm:col-span-2">
                  <Input value={form.addressStreet} onChange={f("addressStreet")} className={CONTROLE_CAMPO} />
                </Campo>
                <Campo rotulo="Número">
                  <Input
                    value={form.addressNumber}
                    onChange={f("addressNumber")}
                    className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")}
                  />
                </Campo>
                <Campo rotulo="Complemento">
                  <Input value={form.addressComplement} onChange={f("addressComplement")} className={CONTROLE_CAMPO} />
                </Campo>
                <Campo rotulo="Bairro">
                  <Input value={form.addressNeighborhood} onChange={f("addressNeighborhood")} className={CONTROLE_CAMPO} />
                </Campo>
                <Campo rotulo="Cidade">
                  <Input value={form.addressCity} onChange={f("addressCity")} className={CONTROLE_CAMPO} />
                </Campo>
                <Campo rotulo="UF">
                  <Input
                    value={form.addressState}
                    onChange={f("addressState")}
                    maxLength={2}
                    className={cn(CONTROLE_CAMPO, "uppercase font-mono")}
                  />
                </Campo>
              </div>
            </BlocoSecao>

            <BlocoSecao Icone={Settings2} titulo="Configuração">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Campo rotulo="Subdomínio">
                  <span className="flex items-center gap-1.5">
                    <Input
                      value={form.subdomain}
                      onChange={handleSubdomainChange}
                      className={cn(CONTROLE_CAMPO, "font-mono")}
                    />
                    <span className="font-mono text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                      .consultaisp.com.br
                    </span>
                  </span>
                </Campo>
                <Campo rotulo="Plano inicial">
                  <select className={CONTROLE_CAMPO} value={form.plan} onChange={f("plan")}>
                    {PLANOS_DO_CATALOGO.map(p => <option key={p} value={p}>{rotuloDoPlano(p)}</option>)}
                  </select>
                </Campo>
              </div>
            </BlocoSecao>

            {cnpjData?.socios?.length > 0 && (
              <BlocoSecao Icone={Users} titulo="Sócios encontrados">
                <div className="space-y-1">
                  {cnpjData.socios.map((s: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded bg-[var(--surface-inset)] px-2.5 py-2 text-[12.5px]"
                    >
                      <User className="w-3.5 h-3.5 flex-none text-[var(--text-faint)]" strokeWidth={2} aria-hidden />
                      <span className="font-medium text-[var(--text)]">{s.nome}</span>
                      <span className="text-[var(--text-muted)] truncate">— {s.qualificacao}</span>
                    </div>
                  ))}
                </div>
              </BlocoSecao>
            )}
          </div>
        )}

        {/* Passo 3: usuario administrador + conferencia */}
        {step === 3 && (
          <div className="space-y-4 py-1">
            {/* Ladrilho `vazio`, nunca `marca`: nao ha dado atras dele e o bloco
                nao leva a lugar nenhum — quem convida sao os campos abaixo. */}
            <div className="flex flex-col items-center text-center gap-2">
              <LadrilhoIcone Icone={Crown} tom="vazio" tamanho="lg" />
              <p className={TITULO_CARTAO}>Administrador do provedor</p>
              <p className="text-[12px] text-[var(--text-muted)] leading-snug max-w-[46ch]">
                Este usuário terá acesso total ao painel do provedor.
              </p>
            </div>

            <div className="max-w-md mx-auto space-y-3">
              <Campo rotulo="Nome completo">
                <Input
                  value={form.adminName}
                  onChange={f("adminName")}
                  placeholder="Nome do administrador"
                  className={CONTROLE_CAMPO}
                  autoFocus
                />
              </Campo>
              <Campo rotulo="E-mail">
                <Input
                  type="email"
                  value={form.adminEmail}
                  onChange={f("adminEmail")}
                  placeholder="admin@provedor.com"
                  className={CONTROLE_CAMPO}
                />
              </Campo>
              <Campo rotulo="Senha">
                <Input
                  type="password"
                  value={form.adminPassword}
                  onChange={f("adminPassword")}
                  placeholder="Mínimo de 6 caracteres"
                  className={CONTROLE_CAMPO}
                />
                {form.adminPassword.length > 0 && form.adminPassword.length < 6 && (
                  <span className="mt-1 block text-[11.5px] text-[var(--danger)]" role="alert">
                    A senha precisa ter no mínimo 6 caracteres.
                  </span>
                )}
              </Campo>
            </div>

            <section className="border-t border-[var(--border)] pt-3">
              <KickerSecao>Resumo</KickerSecao>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg bg-[var(--surface-inset)] p-3">
                {RESUMO.map(item => (
                  <div key={item.rotulo} className="min-w-0">
                    <dt className={ROTULO_CAMPO}>{item.rotulo}</dt>
                    <dd
                      className={cn(
                        "text-[12.5px] text-[var(--text)] truncate",
                        item.mono && "font-mono tabular-nums",
                      )}
                    >
                      {item.valor}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step > 1 && (
            <button type="button" onClick={() => setStep(s => s - 1)} className={BOTAO_SECUNDARIO}>
              Voltar
            </button>
          )}
          <div className="flex-1" />
          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!canProceedStep2}
              className={cn(BOTAO_MARCA, DESABILITAVEL)}
            >
              Próximo
              <ChevronRight className="w-4 h-4" strokeWidth={2} aria-hidden />
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              onClick={() => mutation.mutate(form)}
              disabled={!canProceedStep3 || mutation.isPending}
              className={cn(BOTAO_MARCA, DESABILITAVEL)}
            >
              {mutation.isPending
                ? <RefreshCw className="w-4 h-4 motion-safe:animate-spin" strokeWidth={2} aria-hidden />
                : <Plus className="w-4 h-4" strokeWidth={2} aria-hidden />}
              Criar provedor
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
