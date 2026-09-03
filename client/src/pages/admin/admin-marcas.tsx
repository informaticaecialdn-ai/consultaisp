/**
 * Gestão de marcas white label — área do superadmin.
 *
 * Uma marca é a "pele" que um revendedor veste sobre o MESMO bureau. Ela não
 * isola dados: o isolamento continua sendo `providerId`. Todos os provedores,
 * de todas as marcas, alimentam e leem a mesma base — que é o produto.
 *
 * Duas coisas nesta tela existem para evitar surpresa depois do ar:
 *
 *  1. a PRÉVIA de cor mostra a paleta derivada e avisa quando a cor teve de ser
 *     escurecida para passar contraste. O revendedor descobre aqui, não quando
 *     um cliente reclamar que o link some no fundo;
 *  2. o domínio nasce PENDENTE e só um humano confirma. A aplicação não emite
 *     certificado, então não pode afirmar que o domínio responde em HTTPS.
 *
 * ── POR QUE O PATCH É PARCIAL ──────────────────────────────────────────────
 *
 * O formulário nasce da LISTA, que não carrega logo, favicon, WhatsApp nem nome
 * de exibição do e-mail — a listagem os corta de propósito, para não trafegar
 * três SVGs por linha. Enviando o formulário inteiro, esses campos saíam vazios
 * e o servidor os gravava como nulos: abrir a edição para corrigir um telefone
 * apagava o logo do revendedor. Agora só o que MUDOU é enviado, e o que o
 * formulário não mostra ele também não toca.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { corpoParcial } from "./marca-form";
import {
  Palette, Plus, Globe, ShieldCheck, AlertTriangle, Trash2,
  Link2, Upload, Check, X, Image as ImageIcon,
} from "lucide-react";

type MarcaLista = {
  id: number; slug: string; ativo: boolean; nomeProduto: string; assinatura: string | null;
  dominio: string | null; dominioStatus: string; corBrand: string; corBrandDark: string | null;
  temLogo: boolean; logoEhPng: boolean; temFavicon: boolean;
  responsavelRazaoSocial: string | null; responsavelCnpj: string | null;
  suporteEmail: string | null; emailRemetente: string | null; site: string | null;
};

type Paleta = { brand: string; hover: string; soft: string; ink: string; textOnBrand: string; ajustada: boolean };

const VAZIA = {
  slug: "", nomeProduto: "", assinatura: "", dominio: "", corBrand: "#4A4670",
  corBrandDark: "", suporteEmail: "", suporteWhatsapp: "", site: "",
  emailRemetente: "", emailNomeExibicao: "",
  responsavelRazaoSocial: "", responsavelCnpj: "",
  logoSvg: "", logoPng: "", faviconSvg: "",
};

/** Gera o slug a partir do nome, como no resto do sistema. */
function slugificar(nome: string): string {
  return nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 40);
}

/**
 * Diz se o arquivo já está gravado. Sem isto o campo de upload aparece vazio
 * numa marca que TEM logo, e o operador não sabe se ele existe — nem que deixar
 * o campo em branco agora o preserva.
 */
function ArquivoAtual({ presente }: { presente: boolean }) {
  return (
    <p className="text-[11px] text-[var(--text-muted)] mt-1">
      {presente ? "já enviado — escolher outro substitui" : "nenhum enviado"}
    </p>
  );
}

function Amostra({ cor, nome }: { cor: string; nome: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-9 h-9 rounded" style={{ background: cor, boxShadow: "0 0 0 1px var(--border)" }} />
      <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-[var(--text-muted)]">{nome}</span>
    </div>
  );
}

export default function AdminMarcasPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editando, setEditando] = useState<number | "nova" | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ ...VAZIA });
  /** O que o servidor tem hoje. O PATCH é a diferença entre `form` e isto. */
  const [original, setOriginal] = useState<Record<string, string>>({ ...VAZIA });
  /** Qual marca já foi preenchida com o detalhe — para não sobrescrever digitação. */
  const hidratada = useRef<number | null>(null);

  const { data: marcas = [], isLoading } = useQuery<MarcaLista[]>({ queryKey: ["/api/admin/marcas"] });
  const { data: detalhe } = useQuery<any>({
    queryKey: ["/api/admin/marcas", editando],
    queryFn: async () => (await fetch(`/api/admin/marcas/${editando}`, { credentials: "include" })).json(),
    enabled: typeof editando === "number",
  });
  const { data: semMarca = [] } = useQuery<{ id: number; name: string; subdomain: string | null }[]>({
    queryKey: ["/api/admin/provedores-sem-marca"],
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["/api/admin/marcas"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/provedores-sem-marca"] });
  };

  const salvar = useMutation({
    mutationFn: async () => {
      if (editando === "nova") {
        const corpo: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(form)) corpo[k] = v === "" ? null : v;
        corpo.slug = form.slug || slugificar(form.nomeProduto);
        corpo.corBrand = form.corBrand;   // obrigatório: nunca vai como null
        return apiRequest("POST", "/api/admin/marcas", corpo);
      }

      // Só o que mudou. Campo que o formulário não carregou fica de fora e o
      // servidor o preserva — ver a nota no topo do arquivo e marca-form.ts.
      const corpo = corpoParcial(form, original);
      // Corpo vazio não é PATCH: o servidor responde 400 ("Nada a alterar"), e
      // aqui isso é só um aviso — não vale trocar o "Salvar" por um erro.
      if (Object.keys(corpo).length === 0) return "sem-mudanca";
      await apiRequest("PATCH", `/api/admin/marcas/${editando}`, corpo);
      return "salvo";
    },
    onSuccess: (resultado) => {
      toast({
        title: resultado === "sem-mudanca" ? "Nada mudou"
          : editando === "nova" ? "Marca criada" : "Marca atualizada",
      });
      setEditando(null); setForm({ ...VAZIA }); setOriginal({ ...VAZIA });
      hidratada.current = null; invalidar();
    },
    onError: (e: any) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const confirmarDominio = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/marcas/${id}/dominio-ativo`, {}),
    onSuccess: () => { toast({ title: "Domínio confirmado" }); invalidar(); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const apagar = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/marcas/${id}`, {}),
    onSuccess: () => { toast({ title: "Marca removida", description: "Os provedores dela voltaram para a marca da plataforma." }); invalidar(); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const vincular = useMutation({
    mutationFn: (v: { providerId: number; marcaId: number | null }) => apiRequest("POST", "/api/admin/marcas/vincular", v),
    onSuccess: () => { toast({ title: "Vínculo atualizado" }); invalidar(); qc.invalidateQueries({ queryKey: ["/api/admin/marcas", editando] }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  function abrirEdicao(m: MarcaLista) {
    setEditando(m.id);
    hidratada.current = null;
    // A lista não tem tudo; o resto chega pelo detalhe, no efeito abaixo.
    const daLista = {
      ...VAZIA, slug: m.slug, nomeProduto: m.nomeProduto, assinatura: m.assinatura ?? "",
      dominio: m.dominio ?? "", corBrand: m.corBrand, corBrandDark: m.corBrandDark ?? "",
      suporteEmail: m.suporteEmail ?? "", site: m.site ?? "", emailRemetente: m.emailRemetente ?? "",
      responsavelRazaoSocial: m.responsavelRazaoSocial ?? "", responsavelCnpj: m.responsavelCnpj ?? "",
    };
    setForm(daLista);
    setOriginal(daLista);
  }

  function fecharEdicao() {
    setEditando(null);
    setForm({ ...VAZIA });
    setOriginal({ ...VAZIA });
    hidratada.current = null;
  }

  /**
   * Completa o formulário com o que só o detalhe traz — WhatsApp de suporte e
   * nome de exibição do e-mail. Roda uma vez por marca aberta: sem a trava, a
   * resposta chegando depois do primeiro caractere digitado desfaria a edição.
   *
   * Os arquivos (logo, favicon) NÃO entram no formulário. Eles ficam vazios até
   * o operador escolher um arquivo novo, e por isso não aparecem no diff — que
   * é justamente o que os preserva.
   */
  useEffect(() => {
    if (typeof editando !== "number" || !detalhe || detalhe.id !== editando) return;
    if (hidratada.current === editando) return;
    hidratada.current = editando;

    const doServidor: Record<string, string> = {
      ...VAZIA,
      slug: detalhe.slug ?? "",
      nomeProduto: detalhe.nomeProduto ?? "",
      assinatura: detalhe.assinatura ?? "",
      dominio: detalhe.dominio ?? "",
      corBrand: detalhe.corBrand || VAZIA.corBrand,
      corBrandDark: detalhe.corBrandDark ?? "",
      suporteEmail: detalhe.suporteEmail ?? "",
      suporteWhatsapp: detalhe.suporteWhatsapp ?? "",
      site: detalhe.site ?? "",
      emailRemetente: detalhe.emailRemetente ?? "",
      emailNomeExibicao: detalhe.emailNomeExibicao ?? "",
      responsavelRazaoSocial: detalhe.responsavelRazaoSocial ?? "",
      responsavelCnpj: detalhe.responsavelCnpj ?? "",
    };
    setOriginal(doServidor);
    setForm(f => ({ ...doServidor, logoSvg: f.logoSvg, logoPng: f.logoPng, faviconSvg: f.faviconSvg }));
  }, [detalhe, editando]);

  /** Lê o arquivo escolhido: SVG vira texto, PNG vira data URI. */
  function carregarArquivo(arquivo: File, campo: "logoSvg" | "logoPng" | "faviconSvg") {
    const leitor = new FileReader();
    leitor.onload = () => {
      const valor = String(leitor.result ?? "");
      // Escolher SVG limpa o PNG e vice-versa: guardar os dois deixaria ambíguo
      // qual é o logo, e o servidor prefere o SVG em silêncio.
      if (campo === "logoSvg") setForm(f => ({ ...f, logoSvg: valor, logoPng: "" }));
      else if (campo === "logoPng") setForm(f => ({ ...f, logoPng: valor, logoSvg: "" }));
      else setForm(f => ({ ...f, faviconSvg: valor }));
    };
    if (campo === "logoPng") leitor.readAsDataURL(arquivo);
    else leitor.readAsText(arquivo);
  }

  const previa: { claro: Paleta; escuro: Paleta } | null = detalhe?.previa ?? null;

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-5" data-testid="admin-marcas">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text)] flex items-center gap-2">
            <Palette className="w-5 h-5 text-[var(--brand)]" /> Marcas white label
          </h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-1 max-w-[62ch]">
            Cada marca é a aparência que um revendedor vende. Os dados continuam na mesma base
            colaborativa — a marca muda o que o cliente vê, não o que o sistema consulta.
          </p>
        </div>
        <Button onClick={() => { fecharEdicao(); setEditando("nova"); }} data-testid="button-nova-marca">
          <Plus className="w-4 h-4 mr-1.5" /> Nova marca
        </Button>
      </header>

      {/* ── Lista ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <Card className="p-8 text-center text-[var(--text-muted)] text-sm">Carregando…</Card>
      ) : marcas.length === 0 ? (
        <Card className="p-10 text-center">
          <Palette className="w-8 h-8 mx-auto mb-3 text-[var(--text-faint)]" />
          <h2 className="font-semibold text-[var(--text)]">Nenhuma marca cadastrada</h2>
          <p className="text-[13px] text-[var(--text-muted)] mt-1 max-w-[46ch] mx-auto">
            Sem marca, todo provedor vê o Consulta ISP. Crie uma para que um revendedor
            venda o sistema com o nome e as cores dele.
          </p>
        </Card>
      ) : (
        <div className="grid gap-2.5">
          {marcas.map(m => (
            <Card key={m.id} className="p-3.5 flex items-center gap-3.5 flex-wrap" data-testid={`marca-${m.id}`}>
              <div
                className="w-10 h-10 rounded grid place-items-center flex-none font-bold text-[17px]"
                style={{ background: m.corBrand, color: "#fff" }}
              >
                {m.nomeProduto.charAt(0).toUpperCase()}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[var(--text)]">{m.nomeProduto}</span>
                  <span className="font-mono text-[10px] text-[var(--text-faint)]">{m.slug}</span>
                  {!m.ativo && <Badge variant="outline" className="rounded text-[10px]">inativa</Badge>}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[var(--text-muted)] flex-wrap">
                  {m.dominio ? (
                    <span className="inline-flex items-center gap-1">
                      <Globe className="w-3 h-3" /> {m.dominio}
                      {m.dominioStatus === "ativo"
                        ? <Badge className="rounded ml-1 text-[9px] bg-[var(--ok-bg)] text-[var(--ok)] border-0">HTTPS ativo</Badge>
                        : <Badge className="rounded ml-1 text-[9px] bg-[var(--gated-bg)] text-[var(--gated)] border-0">certificado pendente</Badge>}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1"><Globe className="w-3 h-3" /> só subdomínio</span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" />
                    {m.temLogo ? (m.logoEhPng ? "logo PNG" : "logo SVG") : "sem logo"}
                  </span>
                  {!(m.responsavelRazaoSocial && m.responsavelCnpj && m.suporteEmail) && (
                    <span className="inline-flex items-center gap-1 text-[var(--gated)]">
                      <AlertTriangle className="w-3 h-3" /> responsável LGPD incompleto
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {m.dominio && m.dominioStatus !== "ativo" && (
                  <Button size="sm" variant="outline" onClick={() => confirmarDominio.mutate(m.id)}
                          data-testid={`confirmar-dominio-${m.id}`}>
                    <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Confirmar HTTPS
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => abrirEdicao(m)}>Editar</Button>
                <Button size="sm" variant="ghost" onClick={() => {
                  if (confirm(`Remover a marca "${m.nomeProduto}"? Os provedores dela voltam para a marca da plataforma.`)) apagar.mutate(m.id);
                }}>
                  <Trash2 className="w-3.5 h-3.5 text-[var(--danger)]" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Formulário ──────────────────────────────────────────────────── */}
      {editando !== null && (
        <Card className="p-5 space-y-5" data-testid="form-marca">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-[var(--text)]">
              {editando === "nova" ? "Nova marca" : `Editando ${form.nomeProduto}`}
            </h2>
            <Button size="sm" variant="ghost" onClick={fecharEdicao}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <section className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Nome do produto</Label>
              <Input value={form.nomeProduto} placeholder="CredNet"
                     onChange={e => setForm(f => ({
                       ...f, nomeProduto: e.target.value,
                       slug: editando === "nova" ? slugificar(e.target.value) : f.slug,
                     }))} />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Substitui “Consulta ISP” onde ele é o nome da plataforma. Onde “Consulta ISP”
                é o nome do <em>tipo de consulta</em>, permanece.
              </p>
            </div>
            <div>
              <Label>Identificador</Label>
              <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: slugificar(e.target.value) }))} />
            </div>
            <div className="sm:col-span-2">
              <Label>Linha de apoio</Label>
              <Input value={form.assinatura} placeholder="Crédito para provedores"
                     onChange={e => setForm(f => ({ ...f, assinatura: e.target.value }))} />
            </div>
          </section>

          {/* Cor + prévia */}
          <section className="space-y-2">
            <Label>Cor da marca</Label>
            <div className="flex items-center gap-3 flex-wrap">
              <input type="color" value={form.corBrand} aria-label="Cor da marca"
                     onChange={e => setForm(f => ({ ...f, corBrand: e.target.value }))}
                     className="w-11 h-9 rounded cursor-pointer border border-[var(--border)] bg-transparent" />
              <Input value={form.corBrand} className="w-32 font-mono"
                     onChange={e => setForm(f => ({ ...f, corBrand: e.target.value }))} />
              <span className="text-[11px] text-[var(--text-muted)] max-w-[42ch]">
                Hover, fundo e texto sobre a cor saem derivados. Salve para ver a prévia conferida.
              </span>
            </div>

            {previa && (
              <div className="flex gap-8 flex-wrap pt-2">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-[var(--text-faint)] mb-2">Tema claro</p>
                  <div className="flex gap-3">
                    <Amostra cor={previa.claro.brand} nome="marca" />
                    <Amostra cor={previa.claro.hover} nome="hover" />
                    <Amostra cor={previa.claro.soft} nome="fundo" />
                    <Amostra cor={previa.claro.ink} nome="texto" />
                  </div>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-[var(--text-faint)] mb-2">Tema escuro</p>
                  <div className="flex gap-3">
                    <Amostra cor={previa.escuro.brand} nome="marca" />
                    <Amostra cor={previa.escuro.hover} nome="hover" />
                    <Amostra cor={previa.escuro.soft} nome="fundo" />
                    <Amostra cor={previa.escuro.ink} nome="texto" />
                  </div>
                </div>
              </div>
            )}

            {previa?.claro.ajustada && (
              <div className="flex gap-2 items-start rounded p-2.5 bg-[var(--gated-bg)] border border-[var(--gated-border)]">
                <AlertTriangle className="w-4 h-4 text-[var(--gated)] flex-none mt-0.5" />
                <p className="text-[12px] text-[var(--gated)] leading-relaxed">
                  A cor escolhida foi escurecida para o texto continuar legível. Ela também é a cor
                  de link e de aba ativa — na tonalidade original, sumiria no fundo claro.
                </p>
              </div>
            )}
          </section>

          {/* Arquivos */}
          <section className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label>Logo SVG</Label>
              <Input type="file" accept=".svg,image/svg+xml"
                     onChange={e => e.target.files?.[0] && carregarArquivo(e.target.files[0], "logoSvg")} />
              {form.logoSvg
                ? <p className="text-[11px] text-[var(--ok)] mt-1 inline-flex items-center gap-1"><Check className="w-3 h-3" />carregado</p>
                : <ArquivoAtual presente={Boolean(detalhe?.logoSvg)} />}
            </div>
            <div>
              <Label>Logo PNG</Label>
              <Input type="file" accept="image/png"
                     onChange={e => e.target.files?.[0] && carregarArquivo(e.target.files[0], "logoPng")} />
              {form.logoPng
                ? <p className="text-[11px] text-[var(--ok)] mt-1 inline-flex items-center gap-1"><Check className="w-3 h-3" />carregado</p>
                : <ArquivoAtual presente={Boolean(detalhe?.logoPng)} />}
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Não acompanha o tema escuro.</p>
            </div>
            <div>
              <Label>Favicon SVG</Label>
              <Input type="file" accept=".svg,image/svg+xml"
                     onChange={e => e.target.files?.[0] && carregarArquivo(e.target.files[0], "faviconSvg")} />
              {form.faviconSvg
                ? <p className="text-[11px] text-[var(--ok)] mt-1 inline-flex items-center gap-1"><Check className="w-3 h-3" />carregado</p>
                : <ArquivoAtual presente={Boolean(detalhe?.faviconSvg)} />}
            </div>
          </section>

          {/* Domínio */}
          <section>
            <Label>Domínio próprio</Label>
            <Input value={form.dominio} placeholder="app.crednet.com.br"
                   onChange={e => setForm(f => ({ ...f, dominio: e.target.value }))} />
            <p className="text-[11px] text-[var(--text-muted)] mt-1 max-w-[70ch]">
              Depois de salvar, o revendedor aponta o DNS para o servidor e alguém roda{" "}
              <code className="font-mono text-[10px]">script/dominio-whitelabel.sh {form.dominio || "dominio"}</code>{" "}
              — só então confirme o HTTPS na lista. Enquanto isso, o subdomínio da plataforma já funciona.
            </p>
          </section>

          {/* LGPD */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="m-0">Responsável pelos dados (LGPD)</Label>
              <Badge variant="outline" className="rounded text-[9px]">obrigatório para vender</Badge>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Input value={form.responsavelRazaoSocial} placeholder="CredNet Serviços Ltda"
                     onChange={e => setForm(f => ({ ...f, responsavelRazaoSocial: e.target.value }))} />
              <Input value={form.responsavelCnpj} placeholder="00.000.000/0001-00"
                     onChange={e => setForm(f => ({ ...f, responsavelCnpj: e.target.value }))} />
            </div>
            <p className="text-[11px] text-[var(--text-muted)] max-w-[74ch]">
              Quem o titular vê como controlador na página de privacidade e no consentimento.
              <strong> As três informações andam juntas — razão social, CNPJ e o e-mail de
              suporte abaixo.</strong> Faltando qualquer uma, a plataforma continua sendo o
              controlador, porque nomear o revendedor e mandar o titular escrever para o DPO
              da plataforma seria pior: quem recebe não tem os dados, e quem tem não recebe.
              A plataforma segue nomeada como operadora, sempre.
            </p>
          </section>

          {/* Contato */}
          <section className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label>E-mail de suporte</Label>
              <Input value={form.suporteEmail} onChange={e => setForm(f => ({ ...f, suporteEmail: e.target.value }))} />
            </div>
            <div>
              <Label>WhatsApp de suporte</Label>
              <Input value={form.suporteWhatsapp} placeholder="5531999998888"
                     onChange={e => setForm(f => ({ ...f, suporteWhatsapp: e.target.value }))} />
            </div>
            <div>
              <Label>Site</Label>
              <Input value={form.site} placeholder="https://crednet.com.br"
                     onChange={e => setForm(f => ({ ...f, site: e.target.value }))} />
            </div>
            <div>
              <Label>Remetente de e-mail</Label>
              <Input value={form.emailRemetente} placeholder="nao-responda@crednet.com.br"
                     onChange={e => setForm(f => ({ ...f, emailRemetente: e.target.value }))} />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Só funciona com o domínio verificado no Resend. Vazio = sai pelo domínio da
                plataforma com o nome da marca.
              </p>
            </div>
            <div>
              <Label>Nome de exibição do e-mail</Label>
              <Input value={form.emailNomeExibicao} placeholder="CredNet"
                     onChange={e => setForm(f => ({ ...f, emailNomeExibicao: e.target.value }))} />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Vazio = o nome do produto.
              </p>
            </div>
          </section>

          <div className="flex gap-2 pt-1">
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !form.nomeProduto}>
              {salvar.isPending ? "Salvando…" : "Salvar marca"}
            </Button>
            <Button variant="ghost" onClick={fecharEdicao}>Cancelar</Button>
          </div>

          {/* Provedores vinculados */}
          {typeof editando === "number" && (
            <section className="border-t border-[var(--border)] pt-4 space-y-2">
              <Label className="flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5" /> Provedores nesta marca</Label>
              {detalhe?.provedores?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {detalhe.provedores.map((p: any) => (
                    <Badge key={p.id} variant="outline" className="rounded gap-1.5 py-1">
                      {p.name}
                      <button onClick={() => vincular.mutate({ providerId: p.id, marcaId: null })}
                              aria-label={`Desvincular ${p.name}`} className="hover:text-[var(--danger)]">
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-[var(--text-muted)]">
                  Nenhum ainda. Sem provedor vinculado, esta marca só aparece se alguém acessar o
                  domínio dela.
                </p>
              )}

              {semMarca.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <Select onValueChange={v => vincular.mutate({ providerId: Number(v), marcaId: editando })}>
                    <SelectTrigger className="w-72"><SelectValue placeholder="Vincular um provedor…" /></SelectTrigger>
                    <SelectContent>
                      {semMarca.map(p => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}{p.subdomain ? ` · ${p.subdomain}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </section>
          )}
        </Card>
      )}
    </div>
  );
}
