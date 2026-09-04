/**
 * /revenda/marca — a pele que o revendedor vende, do lado dele.
 *
 * A mesma marca tem dois donos de campo, e a tela precisa deixar isso óbvio:
 *
 *  - o REVENDEDOR decide como a marca se parece e por onde falam com ele:
 *    nome, linha de apoio, cor, logo, favicon, suporte, site e o nome que
 *    aparece no remetente dos e-mails;
 *  - a PLATAFORMA decide o que tem efeito jurídico ou de infraestrutura:
 *    identificador, domínio, certificado e responsável LGPD.
 *
 * O segundo grupo aparece aqui, em somente leitura, COM O MOTIVO ESCRITO. A
 * alternativa — escondê-lo — deixaria o revendedor sem saber qual domínio está
 * no ar nem quem responde perante o titular, que é justamente o que ele precisa
 * conferir. E a rota `PATCH /api/revenda/marca` recusa esses campos de qualquer
 * forma: a tela explica uma regra que o servidor impõe, não uma que ela inventa.
 *
 * ── O QUE NÃO ESTÁ AQUI ────────────────────────────────────────────────────
 *
 * Landing (título, subtítulo, chamada, mostrar preços) e cadastro aberto são da
 * fase 5, junto com a página que eles alimentam. Editor de landing sem landing
 * publicada é um formulário que grava num lugar que ninguém lê.
 *
 * ── SOBRE A PRÉVIA DE COR ──────────────────────────────────────────────────
 *
 * A paleta derivada (hover, fundo, tinta) é calculada NO SERVIDOR
 * (server/utils/marca-cores.ts) e chega pronta em `previa`. Recalcular no
 * client criaria uma segunda cópia da regra de contraste, e a primeira vez que
 * as duas divergissem o revendedor veria uma cor na prévia e outra no ar. O
 * preço é que a paleta é a da cor GRAVADA, não a da cor digitada — e a tela diz
 * isso com todas as letras em vez de fingir que acompanha.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, type ErroDaApi } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  CabecalhoPainel, KickerSecao, Selo, Campo, RotuloCampo, LadrilhoIcone,
  TITULO_CARTAO, CONTROLE_CAMPO, BOTAO_MARCA, BOTAO_SECUNDARIO, DESABILITAVEL,
} from "@/components/painel/ui";
import {
  AlertTriangle, Check, Globe, Loader2, Lock, Mail, Palette, Save, ShieldCheck,
} from "lucide-react";
import {
  camposDoDetalhe, corpoParcial, problemasDoFormulario, corValida,
  type MarcaDoRevendedor, type PaletaDaMarca,
} from "./marca-form";

/* ------------------------------------------------------------------ */
/* Peças locais                                                        */
/* ------------------------------------------------------------------ */

/**
 * Campo que o revendedor não edita — e o motivo, ao lado.
 *
 * O poço (`--surface-inset`) é o mesmo tratamento que a seção 3.1 reserva a
 * "campo, poço": lê como área de dado, não como caixa que se preenche. Sem a
 * borda de área editável (`--border-strong`), que é o que separa os dois à
 * primeira vista.
 */
function CampoTravado({
  rotulo, valor, motivo, mono = false, extra, testId,
}: {
  rotulo: string;
  valor: React.ReactNode;
  /** Por que está travado. Sem isto o campo parece um defeito da tela. */
  motivo: string;
  mono?: boolean;
  /** Selo de estado à direita do valor (HTTPS ativo, certificado pendente). */
  extra?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId}>
      <RotuloCampo>
        <span className="inline-flex items-center gap-1">
          <Lock className="w-2.5 h-2.5 flex-none" strokeWidth={2.5} aria-hidden />
          {rotulo}
        </span>
      </RotuloCampo>
      <div className="min-h-[36px] flex items-center gap-2 flex-wrap rounded border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2">
        <span className={cn("text-[12.5px] text-[var(--text-2)]", mono && "font-mono tabular-nums")}>
          {valor}
        </span>
        {extra}
      </div>
      <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">{motivo}</p>
    </div>
  );
}

/** A frase de erro de um campo. Afirmativa e útil, como manda a seção 8. */
function ProblemaDoCampo({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-[11px] text-[var(--danger)] mt-1 leading-snug">{children}</p>;
}

/** Uma amostra da paleta derivada: o quadrado da cor e o papel dela. */
function Amostra({ cor, nome }: { cor: string; nome: string }) {
  return (
    <div className="text-center">
      <div
        className="w-11 h-11 rounded border border-[var(--border)]"
        style={{ background: cor }}
        aria-hidden
      />
      <p className="font-mono text-[9px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)] mt-1">
        {nome}
      </p>
      <p className="font-mono text-[9px] tabular-nums text-[var(--text-faint)]">{cor}</p>
    </div>
  );
}

function LinhaDaPaleta({ titulo, paleta }: { titulo: string; paleta: PaletaDaMarca }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)] mb-2">
        {titulo}
      </p>
      <div className="flex gap-3">
        <Amostra cor={paleta.brand} nome="marca" />
        <Amostra cor={paleta.hover} nome="hover" />
        <Amostra cor={paleta.soft} nome="fundo" />
        <Amostra cor={paleta.ink} nome="texto" />
      </div>
    </div>
  );
}

/** O formulário enquanto o cadastro não chega. Nunca a palavra "carregando". */
function EsqueletoDoFormulario() {
  return (
    <div className="space-y-5" aria-busy="true" data-testid="marca-carregando">
      {[0, 1, 2].map(bloco => (
        <Card key={bloco} className="p-4 space-y-3">
          <Skeleton className="h-3 w-32" />
          <div className="grid sm:grid-cols-2 gap-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A tela                                                              */
/* ------------------------------------------------------------------ */

export default function MinhaMarca() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const consulta = useQuery<MarcaDoRevendedor>({
    queryKey: ["/api/revenda/marca"],
    staleTime: 60_000,
  });
  const marca = consulta.data;

  const [form, setForm] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [carregadoDe, setCarregadoDe] = useState<number | null>(null);

  /**
   * O formulário carrega UMA VEZ, e nunca é reescrito por uma releitura.
   *
   * A tela anterior desta família (`pages/admin/marca-form.ts`) foi consertada
   * por causa disto: quem clicava em Editar e começava a digitar via o texto
   * sumir quando a resposta do servidor chegava por cima. Aqui há uma
   * releitura garantida — a que roda logo depois de salvar, para trazer a
   * paleta derivada e o estado dos arquivos — e ela cairia exatamente em cima
   * de quem já voltou a digitar.
   *
   * A trava é possível porque as duas metades da tela têm fontes separadas: o
   * que se DIGITA sai do formulário, e o que se LÊ (prévia, HTTPS, logo
   * gravado, responsável LGPD) sai direto de `marca` e continua acompanhando
   * cada releitura.
   */
  useEffect(() => {
    if (!marca || carregadoDe === marca.id) return;
    const campos = camposDoDetalhe(marca);
    setForm(campos);
    setOriginal(campos);
    setCarregadoDe(marca.id);
  }, [marca, carregadoDe]);

  const problemas = problemasDoFormulario(form);
  const corpo = corpoParcial(form, original);
  const sujo = Object.keys(corpo).length > 0;
  const impedido = Object.keys(problemas).length > 0;

  const salvar = useMutation({
    /* O corpo é VARIÁVEL da mutation, e não uma leitura do `corpo` do
       fechamento: é assim que o `onSuccess` sabe o que de fato foi enviado. */
    mutationFn: async (enviado: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", "/api/revenda/marca", enviado);
      return res.json();
    },
    onSuccess: (_resposta, enviado) => {
      toast({
        title: "Marca atualizada",
        description: "Quem abrir o seu endereço já vê o novo visual — a troca vale no próximo carregamento.",
      });
      /* RECONCILIA CONTRA O QUE FOI ENVIADO, e não contra o formulário de
         agora.

         Os campos não são desabilitados durante o envio — só o botão é —, e um
         PATCH com logo PNG carrega até 512 KB, então a janela é real. Enquanto
         o `onSuccess` copiava o `form` do momento da resposta, tudo que fosse
         digitado durante a viagem entrava no novo `original` como se tivesse
         sido gravado: o selo de "alterações não salvas" sumia, o rodapé passava
         a dizer "nada mudou", e o próximo Salvar também não mandava aquilo —
         porque para `corpoParcial` já não era diff. Recarregar a página é que
         mostrava o valor antigo.

         Só as chaves de `enviado` avançam; o que o operador digitou depois
         continua sendo diferença, e continua pendente.

         Os campos de arquivo saem vazios porque o conteúdo deles JÁ FOI
         gravado: mantê-los preenchidos faria o próximo salvamento reenviar o
         mesmo SVG por causa de uma vírgula trocada em outro campo. */
      /* `enviado` manda `null` onde o campo foi esvaziado, e é isso que o
         servidor gravou. `corpoParcial` compara com `original[campo] ?? ""`,
         então o `null` que entra aqui equivale ao campo vazio do formulário —
         que é exatamente o estado em que ele ficou. */
      setOriginal(atual => ({
        ...atual,
        ...(enviado as Record<string, string>),
        logoSvg: "", logoPng: "", faviconSvg: "",
      }));
      setForm(atual => ({ ...atual, logoSvg: "", logoPng: "", faviconSvg: "" }));
      /* A releitura traz a paleta derivada e o estado dos arquivos, que o
         formulário não tem como calcular sozinho — e não reescreve o que está
         digitado, por causa da trava de `carregadoDe`. */
      qc.invalidateQueries({ queryKey: ["/api/revenda/marca"] });
    },
    onError: (erro: ErroDaApi) => {
      toast({
        variant: "destructive",
        title: "Nada foi salvo",
        /* `status`/`codigo` são campos do erro desde a fase 0 — a mensagem é
           texto para gente ler, e é ela que vai para o toast. */
        description: erro.message || "Não foi possível gravar as alterações. Tente de novo.",
      });
    },
  });

  /** Lê o arquivo escolhido: SVG vira texto, PNG vira data URI. */
  function carregarArquivo(arquivo: File, campo: "logoSvg" | "logoPng" | "faviconSvg") {
    const leitor = new FileReader();
    leitor.onload = () => {
      const valor = String(leitor.result ?? "");
      /* Escolher SVG limpa o PNG e vice-versa: com os dois preenchidos fica
         ambíguo qual é o logo, e o servidor prefere o SVG em silêncio. */
      if (campo === "logoSvg") setForm(f => ({ ...f, logoSvg: valor, logoPng: "" }));
      else if (campo === "logoPng") setForm(f => ({ ...f, logoPng: valor, logoSvg: "" }));
      else setForm(f => ({ ...f, faviconSvg: valor }));
    };
    leitor.onerror = () => {
      toast({
        variant: "destructive",
        title: "Arquivo não pôde ser lido",
        description: "Escolha o arquivo de novo. Nada foi alterado na marca.",
      });
    };
    if (campo === "logoPng") leitor.readAsDataURL(arquivo);
    else leitor.readAsText(arquivo);
  }

  const campo = (nome: string) => ({
    value: form[nome] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [nome]: e.target.value })),
  });

  const botaoSalvar = (testId: string) => (
    <button
      type="button"
      className={cn(BOTAO_MARCA, DESABILITAVEL)}
      disabled={!sujo || impedido || salvar.isPending}
      onClick={() => salvar.mutate(corpo)}
      data-testid={testId}
    >
      {salvar.isPending
        ? <Loader2 className="w-3.5 h-3.5 flex-none motion-safe:animate-spin" strokeWidth={2} aria-hidden />
        : <Save className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />}
      Salvar alterações
    </button>
  );

  const dominioAtivo = marca?.dominioStatus === "ativo";

  return (
    <div className="p-4 lg:p-6 pb-10 max-w-[1000px] mx-auto space-y-6" data-testid="revenda-marca">
      <CabecalhoPainel
        titulo="Minha marca"
        descricao="É o que o provedor cliente vê: o nome no topo, a cor dos botões, o logo na tela de login e o remetente dos e-mails."
        testIdTitulo="text-marca-titulo"
        /* Sem cadastro carregado não há o que salvar: um botão inerte no topo
           durante a carga só ensina que clicar ali não faz nada. */
        acoes={
          marca ? (
            <div className="flex items-center gap-2">
              {sujo && !salvar.isPending && (
                <Selo tom="gated" testId="selo-nao-salvo">alterações não salvas</Selo>
              )}
              {botaoSalvar("button-salvar-marca-topo")}
            </div>
          ) : undefined
        }
      />

      {consulta.isLoading ? (
        <EsqueletoDoFormulario />
      ) : consulta.isError || !marca ? (
        /* Não é estado vazio — é falha. Sem o cadastro atual não há formulário:
           editar por cima do que não chegou gravaria vazio no que está no ar. */
        <div
          className="flex flex-col items-center text-center gap-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-6 py-8"
          data-testid="marca-erro"
        >
          <LadrilhoIcone Icone={AlertTriangle} tom="risco" tamanho="lg" />
          <p className={TITULO_CARTAO}>Não foi possível carregar a sua marca</p>
          <p className="mx-auto max-w-[46ch] text-[12px] leading-snug text-[var(--text-2)]">
            Os campos não abrem sem o cadastro atual — editar por cima do que não chegou apagaria o que está gravado.
          </p>
          <button
            type="button"
            className={cn(BOTAO_SECUNDARIO, "mt-2")}
            onClick={() => consulta.refetch()}
            data-testid="button-tentar-marca"
          >
            Tentar de novo
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Identidade ─────────────────────────────────────────────── */}
          <Card className="p-4 space-y-3">
            <KickerSecao className="mb-0">Identidade</KickerSecao>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Campo rotulo="nome do produto">
                  <Input {...campo("nomeProduto")} placeholder="CredNet" className={CONTROLE_CAMPO} maxLength={60} />
                </Campo>
                <ProblemaDoCampo>{problemas.nomeProduto}</ProblemaDoCampo>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">
                  Substitui “Consulta ISP” onde ele é o nome da plataforma. Onde “Consulta ISP”
                  é o nome do <em>tipo de consulta</em>, permanece.
                </p>
              </div>
              <CampoTravado
                rotulo="identificador"
                valor={marca.slug}
                mono
                motivo="Compõe endereços internos do sistema; mudá-lo quebraria links já enviados. Alterações pelo suporte da plataforma."
                testId="campo-slug"
              />
              <div className="sm:col-span-2">
                <Campo rotulo="linha de apoio">
                  <Input {...campo("assinatura")} placeholder="Crédito para provedores" className={CONTROLE_CAMPO} maxLength={120} />
                </Campo>
                <ProblemaDoCampo>{problemas.assinatura}</ProblemaDoCampo>
              </div>
            </div>
          </Card>

          {/* ── Cor ────────────────────────────────────────────────────── */}
          <Card className="p-4 space-y-3">
            <KickerSecao className="mb-0">Cor da marca</KickerSecao>
            <p className="text-[12px] text-[var(--text-muted)] leading-snug max-w-[70ch]">
              Uma cor por tema. Hover, fundo e tinta saem derivados dela — pedir quatro tons
              harmônicos produz paleta ruim, e a derivação acerta sempre.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Campo rotulo="cor no tema claro">
                  <div className="flex items-center gap-2">
                    <Input {...campo("corBrand")} placeholder="#4A4670" className={cn(CONTROLE_CAMPO, "font-mono")} />
                    {/* Amostra crua da cor DIGITADA — nada derivado, então não
                        há regra duplicada aqui. */}
                    <span
                      className="w-9 h-9 flex-none rounded border border-[var(--border)]"
                      style={{ background: corValida(form.corBrand ?? "") ? form.corBrand : "transparent" }}
                      aria-hidden
                    />
                  </div>
                </Campo>
                <ProblemaDoCampo>{problemas.corBrand}</ProblemaDoCampo>
              </div>
              <div>
                <Campo rotulo="cor no tema escuro">
                  <div className="flex items-center gap-2">
                    <Input {...campo("corBrandDark")} placeholder="opcional" className={cn(CONTROLE_CAMPO, "font-mono")} />
                    <span
                      className="w-9 h-9 flex-none rounded border border-[var(--border)]"
                      style={{ background: corValida(form.corBrandDark ?? "") ? form.corBrandDark : "transparent" }}
                      aria-hidden
                    />
                  </div>
                </Campo>
                <ProblemaDoCampo>{problemas.corBrandDark}</ProblemaDoCampo>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">
                  Em branco, a cor clara é clareada até ficar legível no fundo escuro.
                </p>
              </div>
            </div>

            {marca.previa ? (
              <>
                <div className="flex gap-8 flex-wrap pt-1" data-testid="previa-cores">
                  <LinhaDaPaleta titulo="Tema claro" paleta={marca.previa.claro} />
                  <LinhaDaPaleta titulo="Tema escuro" paleta={marca.previa.escuro} />
                </div>
                {form.corBrand !== original.corBrand && (
                  <p className="text-[11px] text-[var(--text-muted)] leading-snug" data-testid="aviso-previa-antiga">
                    A paleta acima ainda é da cor gravada. Salve para ver a derivação da cor nova.
                  </p>
                )}
                {marca.previa.claro.ajustada && (
                  <div className="flex gap-2 items-start rounded p-2.5 bg-[var(--gated-bg)] border border-[var(--gated-border)]">
                    <AlertTriangle className="w-4 h-4 text-[var(--gated)] flex-none mt-0.5" strokeWidth={2} aria-hidden />
                    <p className="text-[12px] text-[var(--gated)] leading-relaxed">
                      A cor escolhida foi escurecida para o texto continuar legível. Ela também é a
                      cor de link e de aba ativa — na tonalidade original, sumiria no fundo claro.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[11px] text-[var(--text-muted)]" data-testid="sem-previa">
                A paleta derivada aparece aqui depois que uma cor válida for salva.
              </p>
            )}
          </Card>

          {/* ── Arquivos ───────────────────────────────────────────────── */}
          <Card className="p-4 space-y-3">
            <KickerSecao className="mb-0">Logo e favicon</KickerSecao>
            <p className="text-[12px] text-[var(--text-muted)] leading-snug max-w-[70ch]">
              SVG é o formato preferido: fica nítido em qualquer tamanho. PNG é aceito, mas não
              acompanha o tema escuro — logo claro some no fundo escuro, e não há o que fazer
              sobre isso num bitmap. Deixar em branco mantém o arquivo que já está gravado.
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <Campo rotulo="logo svg">
                  <Input
                    type="file" accept=".svg,image/svg+xml" className={CONTROLE_CAMPO}
                    onChange={e => e.target.files?.[0] && carregarArquivo(e.target.files[0], "logoSvg")}
                  />
                </Campo>
                <ProblemaDoCampo>{problemas.logoSvg}</ProblemaDoCampo>
                {form.logoSvg
                  ? <p className="text-[11px] text-[var(--ok)] mt-1 inline-flex items-center gap-1"><Check className="w-3 h-3 flex-none" strokeWidth={2} aria-hidden />carregado</p>
                  : <p className="text-[11px] text-[var(--text-muted)] mt-1">{marca.temLogo && !marca.logoEhPng ? "já enviado — escolher outro substitui" : "nenhum enviado"}</p>}
              </div>
              <div>
                <Campo rotulo="logo png">
                  <Input
                    type="file" accept="image/png" className={CONTROLE_CAMPO}
                    onChange={e => e.target.files?.[0] && carregarArquivo(e.target.files[0], "logoPng")}
                  />
                </Campo>
                <ProblemaDoCampo>{problemas.logoPng}</ProblemaDoCampo>
                {form.logoPng
                  ? <p className="text-[11px] text-[var(--ok)] mt-1 inline-flex items-center gap-1"><Check className="w-3 h-3 flex-none" strokeWidth={2} aria-hidden />carregado</p>
                  : <p className="text-[11px] text-[var(--text-muted)] mt-1">{marca.temLogo && marca.logoEhPng ? "já enviado — escolher outro substitui" : "nenhum enviado"}</p>}
              </div>
              <div>
                <Campo rotulo="favicon svg">
                  <Input
                    type="file" accept=".svg,image/svg+xml" className={CONTROLE_CAMPO}
                    onChange={e => e.target.files?.[0] && carregarArquivo(e.target.files[0], "faviconSvg")}
                  />
                </Campo>
                <ProblemaDoCampo>{problemas.faviconSvg}</ProblemaDoCampo>
                {form.faviconSvg
                  ? <p className="text-[11px] text-[var(--ok)] mt-1 inline-flex items-center gap-1"><Check className="w-3 h-3 flex-none" strokeWidth={2} aria-hidden />carregado</p>
                  : <p className="text-[11px] text-[var(--text-muted)] mt-1">{marca.temFavicon ? "já enviado — escolher outro substitui" : "nenhum enviado"}</p>}
              </div>
            </div>
          </Card>

          {/* ── Suporte ────────────────────────────────────────────────── */}
          <Card className="p-4 space-y-3">
            <KickerSecao className="mb-0">Suporte e site</KickerSecao>
            <p className="text-[12px] text-[var(--text-muted)] leading-snug max-w-[70ch]">
              É por aqui que o provedor cliente fala com você. O que estiver preenchido aparece
              para ele; o que ficar em branco simplesmente não é oferecido.
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <Campo rotulo="e-mail de suporte">
                  <Input {...campo("suporteEmail")} type="email" placeholder="suporte@crednet.com.br" className={CONTROLE_CAMPO} />
                </Campo>
                <ProblemaDoCampo>{problemas.suporteEmail}</ProblemaDoCampo>
              </div>
              <div>
                <Campo rotulo="whatsapp">
                  <Input {...campo("suporteWhatsapp")} placeholder="5531999998888" className={cn(CONTROLE_CAMPO, "font-mono")} maxLength={30} />
                </Campo>
                <ProblemaDoCampo>{problemas.suporteWhatsapp}</ProblemaDoCampo>
              </div>
              <div>
                <Campo rotulo="site">
                  <Input {...campo("site")} placeholder="https://crednet.com.br" className={CONTROLE_CAMPO} />
                </Campo>
                <ProblemaDoCampo>{problemas.site}</ProblemaDoCampo>
              </div>
            </div>
          </Card>

          {/* ── E-mails ────────────────────────────────────────────────── */}
          <Card className="p-4 space-y-3">
            <KickerSecao className="mb-0">Remetente dos e-mails</KickerSecao>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Campo rotulo="nome de exibição">
                  <Input {...campo("emailNomeExibicao")} placeholder="CredNet" className={CONTROLE_CAMPO} maxLength={60} />
                </Campo>
                <ProblemaDoCampo>{problemas.emailNomeExibicao}</ProblemaDoCampo>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">
                  O nome que o destinatário vê antes do endereço, na caixa de entrada dele.
                </p>
              </div>
              <CampoTravado
                rotulo="endereço remetente"
                valor={marca.emailRemetente ?? "domínio da plataforma"}
                mono={Boolean(marca.emailRemetente)}
                motivo="Só a plataforma troca este endereço, e só depois de o seu domínio ser verificado no provedor de e-mail."
                testId="campo-remetente"
              />
            </div>
            {!marca.emailRemetente && (
              <div className="flex gap-2 items-start rounded p-2.5 bg-[var(--info-bg)] border border-[var(--info-border)]" data-testid="aviso-remetente">
                <Mail className="w-4 h-4 text-[var(--info)] flex-none mt-0.5" strokeWidth={2} aria-hidden />
                <p className="text-[12px] text-[var(--info)] leading-relaxed">
                  Por enquanto os e-mails saem do domínio da plataforma com o nome da sua marca no
                  remetente. Para que saiam do seu próprio domínio, ele precisa ser verificado no
                  Resend — fale com o suporte da plataforma; a verificação é feita lá.
                </p>
              </div>
            )}
          </Card>

          {/* ── Domínio ────────────────────────────────────────────────── */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <KickerSecao className="mb-0">Endereço da marca</KickerSecao>
              {marca.dominio && (
                dominioAtivo
                  ? <Selo tom="ok" Icone={ShieldCheck} testId="selo-https">HTTPS ativo</Selo>
                  : <Selo tom="gated" testId="selo-https">certificado pendente</Selo>
              )}
            </div>
            <CampoTravado
              rotulo="domínio próprio"
              valor={marca.dominio ?? "nenhum configurado"}
              mono={Boolean(marca.dominio)}
              motivo="Quem emite o certificado é a plataforma, no servidor — por isso o campo não se edita por aqui. Para trocar de domínio, fale com o suporte."
              testId="campo-dominio"
            />

            {marca.dominio && !dominioAtivo && (
              /* A instrução só serve enquanto o certificado não saiu; depois
                 disso ela vira ruído — e pior, sugere que algo está pendente. */
              <div className="rounded p-3 bg-[var(--surface-2)] border border-[var(--border)]" data-testid="instrucao-dns">
                <p className="text-[12px] text-[var(--text-2)] leading-relaxed">
                  <Globe className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5 text-[var(--text-faint)]" strokeWidth={2} aria-hidden />
                  No painel de DNS de <span className="font-mono">{marca.dominio}</span>, crie um
                  registro <span className="font-mono">A</span> apontando para{" "}
                  {marca.dnsIp ? (
                    <span className="font-mono tabular-nums text-[var(--text)]">{marca.dnsIp}</span>
                  ) : (
                    <span className="text-[var(--text-muted)]">o IP que o suporte da plataforma informar</span>
                  )}
                  . Assim que o endereço responder, a plataforma emite o certificado e este bloco
                  passa a “HTTPS ativo”.
                </p>
              </div>
            )}

            {!marca.dominio && (
              <p className="text-[11px] text-[var(--text-muted)] leading-snug">
                Sem domínio próprio, os provedores da sua marca entram pelo subdomínio deles. Peça
                o domínio ao suporte da plataforma para que a marca tenha endereço próprio.
              </p>
            )}
          </Card>

          {/* ── LGPD ───────────────────────────────────────────────────── */}
          <Card className="p-4 space-y-3">
            <KickerSecao className="mb-0">Responsável pelos dados (LGPD)</KickerSecao>
            <p className="text-[12px] text-[var(--text-muted)] leading-snug max-w-[70ch]">
              É este nome que aparece ao titular como responsável pela relação comercial. Se o
              cliente final comprou da sua marca e a tela de consentimento diz outro nome, ele não
              sabe a quem está consentindo — por isso o dado não se edita sem conferência.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <CampoTravado
                rotulo="razão social"
                valor={marca.responsavelRazaoSocial ?? "não informada"}
                motivo="Alterações pelo suporte da plataforma."
                testId="campo-lgpd-razao"
              />
              <CampoTravado
                rotulo="cnpj"
                valor={marca.responsavelCnpj ?? "não informado"}
                mono={Boolean(marca.responsavelCnpj)}
                motivo="Alterações pelo suporte da plataforma."
                testId="campo-lgpd-cnpj"
              />
            </div>
            {!(marca.responsavelRazaoSocial && marca.responsavelCnpj) && (
              <div className="flex gap-2 items-start rounded p-2.5 bg-[var(--gated-bg)] border border-[var(--gated-border)]">
                <AlertTriangle className="w-4 h-4 text-[var(--gated)] flex-none mt-0.5" strokeWidth={2} aria-hidden />
                <p className="text-[12px] text-[var(--gated)] leading-relaxed">
                  Sem razão social e CNPJ, quem responde perante o titular continua sendo a
                  plataforma. Envie os dois ao suporte antes de vender sob esta marca.
                </p>
              </div>
            )}
          </Card>

          {/* Fase 5 entra aqui: landing (título, subtítulo, chamada, mostrar
              preços), cadastro aberto e imagem de compartilhamento. */}

          <div className="flex items-center gap-3 flex-wrap">
            {botaoSalvar("button-salvar-marca")}
            {impedido && (
              <span className="text-[12px] text-[var(--danger)]" data-testid="texto-impedido">
                Corrija os campos marcados para salvar.
              </span>
            )}
            {!sujo && !impedido && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                <Palette className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                Nada mudou desde o último salvamento.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
