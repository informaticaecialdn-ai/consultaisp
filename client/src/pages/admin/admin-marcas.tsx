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
 * ── AS QUATRO ABAS ─────────────────────────────────────────────────────────
 *
 * A marca deixou de ser só aparência: ela É o revendedor, e o lado comercial
 * dela mora aqui porque só o superadmin pode mexer nele.
 *
 *  - IDENTIDADE — o que existia: nome, cor, arquivos, domínio, LGPD, contato e
 *    os provedores vinculados.
 *  - COMERCIAL  — liga a revenda, define o percentual e diz para quem o
 *    fechamento é pago. Percentual e repasse NÃO aparecem em nenhuma rota do
 *    revendedor: a chave PIX de quem recebe não passa por lá.
 *  - EQUIPE     — os acessos que entram pelo domínio da marca. O botão de criar
 *    fica travado com o motivo à vista enquanto o HTTPS não estiver confirmado,
 *    porque a prova de login do revendedor É o domínio próprio ativo.
 *  - EVENTOS    — a trilha `marca_eventos`, append-only, só leitura.
 *
 * Numa marca NOVA as três últimas nascem desabilitadas: elas dependem de um id
 * que ainda não existe, e o acesso do revendedor depende do domínio, que
 * depende da marca estar gravada. A ordem está escrita embaixo das abas.
 *
 * ── POR QUE O PATCH É PARCIAL ──────────────────────────────────────────────
 *
 * O formulário nunca carrega logo nem favicon: são três SVGs que ninguém edita
 * como texto. Enviando o formulário inteiro, esses campos saíam vazios e o
 * servidor os gravava como nulos — abrir a edição para corrigir um telefone
 * apagava o logo do revendedor. Agora só o que MUDOU é enviado, e o que o
 * formulário não mostra ele também não toca.
 *
 * A aba Comercial segue a MESMA regra, com diff próprio (`corpoComercial`): os
 * campos dela não vivem no `form` da identidade, então o "Salvar marca" não tem
 * como zerar uma comissão por omissão — que seria o mesmo defeito do logo, no
 * campo em que ele custaria dinheiro.
 *
 * ── E POR QUE ELE ESPERA O DETALHE ─────────────────────────────────────────
 *
 * O formulário nascia da LISTA e um efeito o completava com o detalhe. A
 * primeira entrega reescrevia tudo, digitado ou não: quem clicava em "Editar" e
 * começava a escrever no mesmo instante via o texto sumir. Agora os campos só
 * existem depois da resposta — antes dela há esqueleto. Ver `faseDoFormulario`.
 *
 * ── A LINGUAGEM VISUAL ─────────────────────────────────────────────────────
 *
 * A tela fala por `@/components/painel/ui`, a primitiva extraída do Painel do
 * Provedor, em vez de repetir classes próprias. Nada de rota, queryKey,
 * mutação, permissão ou `data-testid` mudou naquela passagem — só quem fala.
 *
 * O que saiu: o "Carregando…" solto e o vazio escrito à mão (a seção 6 chama
 * os dois de estado real, e agora são `LinhasSkeleton` e `EstadoVazio`); os
 * `Badge` do shadcn com `variant="outline"` (viraram `Selo`, retangular e
 * mono); os `Button` de 32px, abaixo do alvo mínimo de toque da seção 7.
 *
 * E, nesta segunda passagem, as quatro classes que ainda moravam aqui: rótulo
 * de campo, botão só de ícone, estado desabilitado e anel de foco. Eram cópias
 * locais — a semente de que a divergência voltasse pelo mesmo caminho — e agora
 * vêm de `Campo`, `BotaoIcone`, `DESABILITAVEL` e `FOCO`. Muda de aparência de
 * propósito: o rótulo troca Inter por mono (seção 2 não deixa margem) e o botão
 * de ícone vai de 32px para 36px no mouse, a altura de controle destes painéis.
 *
 * E, na terceira, a última que restava: a CAIXA do campo. Era uma constante
 * local que vestia os 17 campos desta tela sem borda de área editável, sem raio
 * e sem anel de foco — hoje é `CONTROLE_CAMPO`, a definição única do painel.
 * Ver o comentário na altura em que ela morava.
 *
 * UMA RESSALVA DE COR: o ladrilho de cada marca na lista é pintado com a cor
 * DELA — é dado, não decoração, e é a única cor desta tela que não vem de
 * token. Ver o comentário no próprio ladrilho.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  CabecalhoPainel, KickerSecao, Selo, EstadoVazio, LinhasSkeleton, LadrilhoIcone,
  Campo, BotaoIcone, TITULO_CARTAO, ALVO_CONTROLE, FOCO, CONTROLE_CAMPO,
  BOTAO_SECUNDARIO, BOTAO_MARCA, DESABILITAVEL, AvisoNaoCarregou,
  TabelaPainel, Th, Td, LISTA_ABAS, ABA,
} from "@/components/painel/ui";
import { corpoParcial, faseDoFormulario, FORMULARIO_VAZIO as VAZIA } from "./marca-form";
import {
  camposComerciais, corpoComercial, erroDoComercial, avisosDaRevenda,
  motivoParaNaoCriarRevendedor, rotuloDaAcao, nomeDoAtor, nomeDoProvedor,
  dataHoraCurta, percentualDaMarca, COMERCIAL_VAZIO,
  type FormComercial, type EventoDaMarca,
} from "./marca-revenda";
import {
  Palette, Plus, Globe, ShieldCheck, AlertTriangle, Trash2,
  Link2, Check, X, Image as ImageIcon, Users, History, Percent, Info,
} from "lucide-react";

type MarcaLista = {
  id: number; slug: string; ativo: boolean; nomeProduto: string; assinatura: string | null;
  dominio: string | null; dominioStatus: string; corBrand: string; corBrandDark: string | null;
  temLogo: boolean; logoEhPng: boolean; temFavicon: boolean;
  responsavelRazaoSocial: string | null; responsavelCnpj: string | null;
  suporteEmail: string | null; emailRemetente: string | null; site: string | null;
  /* A camada comercial vem junto: `GET /api/admin/marcas` devolve a linha
     inteira menos os três SVGs, então o selo da lista não custa uma requisição
     a mais. Só o superadmin lê esta rota. */
  revendaAtiva: boolean; statusComercial: string; comissaoPercentual: string | null;
};

type Paleta = { brand: string; hover: string; soft: string; ink: string; textOnBrand: string; ajustada: boolean };

/** Um acesso de revenda, como a tela o consome. Ver o aviso da entrega sobre o
 *  que desta forma ainda é contrato combinado e não contrato observado. */
type UsuarioDaMarca = {
  id: number; name: string; email: string;
  createdAt?: string | null; mustChangePassword?: boolean;
};

type Aba = "identidade" | "comercial" | "equipe" | "eventos";

/* ------------------------------------------------------------------ */
/* O que sobrou de local nesta tela                                     */
/* ------------------------------------------------------------------ */

/* O rótulo de campo, o botão só de ícone e o estado desabilitado eram quatro
   constantes escritas aqui, com valores próprios. Saíram: agora vêm de
   `painel/ui` (`Campo`, `BotaoIcone`, `DESABILITAVEL`, `FOCO`). O rótulo troca
   Inter por mono e o botão de ícone sobe de 32px para 36px no mouse — mudança
   de aparência de propósito, é o valor que o DESIGN_SYSTEM manda. */

/* E A QUINTA SAIU AGORA: a CAIXA do campo.
   Vivia aqui como `const CAMPO = cn(ALVO_CONTROLE, "text-[12.5px]")` e vestia
   os 17 campos desta tela. Era a quarta definição de caixa de campo do painel,
   e a mais pobre das quatro: sem a borda `--border-strong` (§3.1 reserva esse
   token ao input justamente para a caixa ler como área editável), sem raio
   declarado e — o que não se negocia — SEM ANEL DE FOCO. Dezessete campos que o
   teclado percorria às cegas.
   A primitiva `CONTROLE_CAMPO` é a definição única, e traz os três. Muda de
   aparência de propósito: a caixa cai de 40px para 36px no mouse (a altura de
   controle destes painéis, a mesma dos botões ao lado), ganha borda de área
   editável e ganha o anel de foco da marca. O alvo de toque continua inteiro —
   44px no ponteiro grosso, que já vinha de `ALVO_CONTROLE` e continua dentro de
   `CONTROLE_CAMPO`. */


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

/**
 * A faixa de aviso desta tela, nos dois tons que ela usa.
 *
 * `gated` é a porta que ainda não abriu: o estado grava sem reclamar e não
 * produz o efeito que o operador imagina (revenda ligada com 0%, repasse
 * faltando, domínio sem HTTPS). `info` é estado explicado, não alerta —
 * saturação é reservada a risco (§3), e pintar de amarelo uma marca que o dono
 * decidiu deixar sem revenda ensinaria o operador a ignorar o amarelo seguinte.
 *
 * Nasceu do bloco do "cor escurecida", que já era esta forma escrita à mão.
 */
function AvisoDaMarca({ tom, children }: { tom: "gated" | "info"; children: ReactNode }) {
  const alerta = tom === "gated";
  const Icone = alerta ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        "flex gap-2 items-start rounded p-2.5 border",
        alerta
          ? "bg-[var(--gated-bg)] border-[var(--gated-border)]"
          : "bg-[var(--info-bg)] border-[var(--info-border)]",
      )}
    >
      <Icone
        className={cn("w-4 h-4 flex-none mt-0.5", alerta ? "text-[var(--gated)]" : "text-[var(--info)]")}
        strokeWidth={2}
        aria-hidden
      />
      <p className={cn("text-[12px] leading-relaxed", alerta ? "text-[var(--gated)]" : "text-[var(--info)]")}>
        {children}
      </p>
    </div>
  );
}

/**
 * O formulário enquanto o detalhe não chega.
 *
 * Não é enfeite: é o que garante que não exista campo para o operador digitar
 * antes de a resposta do servidor estar completa — ver `faseDoFormulario`.
 */
function EsqueletoDoFormulario() {
  return (
    <div className="space-y-5" aria-busy="true" data-testid="form-marca-carregando">
      <section className="grid sm:grid-cols-2 gap-3">
        {["", "", "", ""].map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="h-9 w-full rounded" />
          </div>
        ))}
      </section>
      <Skeleton className="h-9 w-40 rounded" />
      <section className="grid sm:grid-cols-3 gap-3">
        {["", "", ""].map((_, i) => <Skeleton key={i} className="h-9 w-full rounded" />)}
      </section>
    </div>
  );
}

function Amostra({ cor, nome }: { cor: string; nome: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-9 h-9 rounded" style={{ background: cor, boxShadow: "0 0 0 1px var(--border)" }} />
      {/* Tracking pelo token, não pelo valor cravado: kicker, pilula e rótulo
          mono têm de abrir na mesma medida, senão dois estilos de rótulo
          convivem no mesmo card. */}
      <span className="font-mono text-[9px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">{nome}</span>
    </div>
  );
}

export default function AdminMarcasPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editando, setEditando] = useState<number | "nova" | null>(null);
  const [aba, setAba] = useState<Aba>("identidade");
  const [form, setForm] = useState<Record<string, string>>({ ...VAZIA });
  /** O que o servidor tem hoje. O PATCH é a diferença entre `form` e isto. */
  const [original, setOriginal] = useState<Record<string, string>>({ ...VAZIA });
  /** Qual marca já está carregada no formulário. Antes disso os campos nem existem. */
  const [carregada, setCarregada] = useState<number | null>(null);
  /** O comercial tem estado próprio pelo mesmo motivo que tem diff próprio:
      booleano e número não cabem no `Record<string, string>` da identidade. */
  const [comercial, setComercial] = useState<FormComercial>({ ...COMERCIAL_VAZIO });
  const [comercialOriginal, setComercialOriginal] = useState<FormComercial>({ ...COMERCIAL_VAZIO });
  const [novoRevendedor, setNovoRevendedor] = useState({ nome: "", email: "" });
  /** A senha temporária, quando o servidor a devolve. Vive só enquanto a aba
      está aberta: é credencial, e guardá-la em query cache a espalharia. */
  const [senhaTemporaria, setSenhaTemporaria] = useState<{ email: string; senha: string } | null>(null);

  const { data: marcas = [], isLoading } = useQuery<MarcaLista[]>({ queryKey: ["/api/admin/marcas"] });
  const { data: detalhe, isError: detalheFalhou, refetch: recarregarDetalhe } = useQuery<any>({
    queryKey: ["/api/admin/marcas", editando],
    // O `res.ok` importa: sem ele, um 401 ou 500 vira um objeto de erro sem
    // `id`, a query nunca falha e o formulario fica em esqueleto para sempre.
    queryFn: async () => {
      const res = await fetch(`/api/admin/marcas/${editando}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: typeof editando === "number",
  });
  const { data: semMarca = [] } = useQuery<{ id: number; name: string; subdomain: string | null }[]>({
    queryKey: ["/api/admin/provedores-sem-marca"],
  });

  /* Equipe e eventos só saem do servidor quando a aba abre. São as duas
     leituras mais caras da tela (uma delas varre uma tabela append-only) e
     nenhuma das duas é necessária para editar a identidade da marca. */
  const equipe = useQuery<UsuarioDaMarca[]>({
    queryKey: ["/api/admin/marcas", editando, "usuarios"],
    enabled: typeof editando === "number" && aba === "equipe",
  });
  const eventos = useQuery<EventoDaMarca[]>({
    queryKey: ["/api/admin/marcas", editando, "eventos"],
    enabled: typeof editando === "number" && aba === "eventos",
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
      /**
       * "Salvar marca" salva a IDENTIDADE. Fechar o formulário aqui descartava
       * em silêncio o rascunho da aba Comercial — e o botão que o descartava
       * ficava em outra aba, então o operador não via nada acontecer.
       *
       * Quando há pendência, a tela fica aberta com o ponto ainda aceso no
       * gatilho da aba: o próximo passo é dele, e a tela não decide por ele.
       */
      if (comercialSujo || senhaTemporaria) invalidar();
      else { fecharEdicao(); invalidar(); }
    },
    onError: (e: any) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  /**
   * O comercial salva sozinho, e não junto do "Salvar marca".
   *
   * Não é preferência de layout: é o mesmo PATCH, mas o corpo comercial grava
   * `alterar_comissao` na trilha da marca. Um botão só faria todo ajuste de
   * telefone carregar junto um evento de comissão que ninguém pediu, numa
   * tabela que é append-only e não se limpa depois.
   */
  const salvarComercial = useMutation({
    mutationFn: async () => {
      const corpo = corpoComercial(comercial, comercialOriginal);
      if (Object.keys(corpo).length === 0) return "sem-mudanca" as const;
      await apiRequest("PATCH", `/api/admin/marcas/${editando}`, corpo);
      return "salvo" as const;
    },
    onSuccess: (resultado) => {
      toast({ title: resultado === "sem-mudanca" ? "Nada mudou" : "Dados comerciais salvos" });
      // O que acabou de ser gravado vira o "hoje" do diff. A hidratação não
      // roda de novo (a fase já é "pronto"), então sem esta linha o próximo
      // clique reenviaria a mesma alteração — e outro evento na trilha.
      if (resultado === "salvo") setComercialOriginal({ ...comercial });
      invalidar();
    },
    onError: (e: any) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const criarRevendedor = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/marcas/${editando}/usuarios`, {
        name: novoRevendedor.nome.trim(),
        email: novoRevendedor.email.trim().toLowerCase(),
      });
      return res.json().catch(() => null);
    },
    onSuccess: (criado: any) => {
      /**
       * O TEXTO DIZ O QUE O SERVIDOR FEZ, e nada além.
       *
       * A primeira redação prometia "o e-mail de boas-vindas sai com a marca e
       * com o endereço de entrada" — e naquele momento nenhum e-mail saía. Hoje
       * ele sai, mas pode falhar (Resend fora do ar, domínio não verificado), e
       * a rota responde `emailEnviado` justamente para a tela não ter de
       * escolher uma frase fixa que estaria errada metade das vezes.
       *
       * E, em qualquer um dos dois casos, o e-mail NÃO leva a senha: quem cria
       * entrega por outro canal. Por isso a instrução de copiar vem primeiro,
       * antes da informação sobre o e-mail.
       */
      toast({
        title: "Acesso criado",
        description: criado?.emailEnviado === false
          ? "Copie a senha abaixo e entregue por um canal seguro — ela não aparece de novo. O e-mail com o endereço de entrada não saiu; avise a pessoa por onde entrar."
          : "Copie a senha abaixo e entregue por um canal seguro — ela não aparece de novo. O e-mail que saiu leva o endereço de entrada, não a senha.",
      });
      setNovoRevendedor({ nome: "", email: "" });
      // A senha só existe aqui: no banco fica o hash, e o e-mail não a carrega.
      setSenhaTemporaria(
        criado?.senhaTemporaria
          ? { email: criado.email ?? novoRevendedor.email.trim().toLowerCase(), senha: String(criado.senhaTemporaria) }
          : null,
      );
      qc.invalidateQueries({ queryKey: ["/api/admin/marcas", editando, "usuarios"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/marcas", editando, "eventos"] });
    },
    onError: (e: any) => toast({ title: "Não foi possível criar o acesso", description: e.message, variant: "destructive" }),
  });

  const removerRevendedor = useMutation({
    mutationFn: (userId: number) => apiRequest("DELETE", `/api/admin/marcas/${editando}/usuarios/${userId}`, {}),
    onSuccess: () => {
      toast({ title: "Acesso removido" });
      setSenhaTemporaria(null);
      qc.invalidateQueries({ queryKey: ["/api/admin/marcas", editando, "usuarios"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/marcas", editando, "eventos"] });
    },
    onError: (e: any) => toast({ title: "Não foi possível remover", description: e.message, variant: "destructive" }),
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

  /**
   * Abrir a edição não preenche mais nada com o que a LISTA tem. O formulário
   * só nasce quando o detalhe chega — ver `faseDoFormulario`.
   */
  function abrirEdicao(m: MarcaLista) {
    limparFormulario();
    setEditando(m.id);
  }

  function fecharEdicao() {
    limparFormulario();
    setEditando(null);
  }

  /**
   * Fechar a edição perde duas coisas que não voltam, e nenhuma delas está na
   * aba que o operador está vendo na hora de clicar no X.
   *
   * 1. O rascunho da aba Comercial. `limparFormulario` zera `comercial` e
   *    `comercialOriginal`; o ponto no gatilho da aba avisa que existe
   *    alteração pendente, mas não avisa nada no instante em que ela some.
   * 2. A senha temporária que ainda não foi copiada. Ela só existe em estado
   *    local — no banco fica o hash, e o e-mail não a carrega —, então fechar
   *    sem copiar deixa o acesso sem caminho, e a recuperação é remover e
   *    criar de novo.
   *
   * `confirm` é o mesmo recurso que esta tela já usa para remover marca e
   * remover acesso; trocar por um modal próprio seria mudança de outra ordem.
   */
  function pedirParaFechar(): boolean {
    const perdas: string[] = [];
    if (comercialSujo) perdas.push("as alterações não salvas da aba Comercial");
    if (senhaTemporaria) perdas.push("a senha temporária que ainda não foi copiada");
    if (perdas.length > 0 && !confirm(`Fechar agora descarta ${perdas.join(" e ")}. Fechar mesmo assim?`)) return false;
    fecharEdicao();
    return true;
  }

  /** O estado que não pode atravessar a troca de marca. A aba volta para a
      identidade porque abrir a Equipe de uma marca e cair na Equipe de outra
      esconde de quem clicou que o contexto mudou. */
  function limparFormulario() {
    setForm({ ...VAZIA });
    setOriginal({ ...VAZIA });
    setCarregada(null);
    setComercial({ ...COMERCIAL_VAZIO });
    setComercialOriginal({ ...COMERCIAL_VAZIO });
    setNovoRevendedor({ nome: "", email: "" });
    setSenhaTemporaria(null);
    setAba("identidade");
  }

  // Memo para o efeito abaixo não disparar a cada render — a fase só muda
  // quando muda o que a decide.
  const fase = useMemo(
    () => faseDoFormulario(editando, detalhe, carregada, detalheFalhou),
    [editando, detalhe, carregada, detalheFalhou],
  );

  /**
   * Carrega o formulário com o detalhe, uma vez por marca aberta.
   *
   * Antes, o formulário abria com os campos da lista e este efeito o
   * "completava": a primeira entrega reescrevia tudo, e quem clicava em Editar
   * e já começava a digitar via o texto sumir. Agora não há campo antes de
   * `carregar`, então não há digitação a perder — e depois dela a fase é
   * "pronto", que nem um refetch reabre.
   */
  useEffect(() => {
    if (fase.fase !== "carregar" || typeof editando !== "number") return;
    setOriginal(fase.campos);
    setForm(fase.campos);
    const comercialDoServidor = camposComerciais(detalhe);
    setComercialOriginal(comercialDoServidor);
    setComercial(comercialDoServidor);
    setCarregada(editando);
  }, [fase, editando, detalhe]);

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
  /** Só para o título enquanto o formulário ainda não carregou. */
  const marcaEmEdicao = typeof editando === "number" ? marcas.find(m => m.id === editando) : undefined;
  const novaMarca = editando === "nova";
  const erroComercial = erroDoComercial(comercial);
  const avisosComerciais = avisosDaRevenda(comercial);
  /* O comercial salva por um botão próprio, então dá para sair da aba com
     alteração pendente e fechar o formulário sem ela ir a lugar nenhum. O ponto
     no gatilho é o que avisa antes de a perda acontecer — e sem ele o operador
     acharia que "Salvar marca" tinha salvado tudo. */
  const comercialSujo = Object.keys(corpoComercial(comercial, comercialOriginal)).length > 0;
  /* O motivo sai do DETALHE, e não da lista: confirmar o HTTPS é a ação de
     outro botão desta mesma tela, e a lista pode estar um invalidate atrás. */
  const bloqueioDaEquipe = motivoParaNaoCriarRevendedor({
    dominio: detalhe?.dominio ?? null,
    dominioStatus: detalhe?.dominioStatus ?? null,
    ativo: detalhe?.ativo ?? null,
    /* O que vale é o valor GRAVADO, e não o do formulário: ligar a chave sem
       salvar não muda o que o servidor vai responder ao POST. */
    revendaAtiva: comercialOriginal.revendaAtiva,
  });
  const revendedorPronto = Boolean(novoRevendedor.nome.trim()) && novoRevendedor.email.includes("@");

  return (
    <div className="p-4 lg:p-6 pb-10 max-w-[1100px] mx-auto space-y-6" data-testid="admin-marcas">
      {/* O título perdeu o ícone e os 24px de corpo: `CabecalhoPainel` é a
          mesma voz de todas as outras telas dos dois painéis (19px, peso 500),
          e o ícone já identifica o item na sidebar. Duas páginas com títulos de
          tamanhos diferentes é como a divergência aparece primeiro. */}
      <CabecalhoPainel
        titulo="Marcas white label"
        descricao="Cada marca é a aparência que um revendedor vende. Os dados continuam na mesma base colaborativa — a marca muda o que o cliente vê, não o que o sistema consulta."
        testIdTitulo="text-marcas-title"
        acoes={
          <button
            type="button"
            className={BOTAO_MARCA}
            onClick={() => { if (pedirParaFechar()) setEditando("nova"); }}
            data-testid="button-nova-marca"
          >
            <Plus className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
            Nova marca
          </button>
        }
      />

      {/* ── Lista ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <Card className="p-4">
          <LinhasSkeleton linhas={3} />
        </Card>
      ) : marcas.length === 0 ? (
        <Card className="p-0">
          <EstadoVazio
            Icone={Palette}
            titulo="Nenhuma marca cadastrada"
            descricao="Sem marca, todo provedor vê o Consulta ISP. Crie uma para que um revendedor venda o sistema com o nome e as cores dele."
            cta={
              <button
                type="button"
                className={BOTAO_MARCA}
                onClick={() => { if (pedirParaFechar()) setEditando("nova"); }}
              >
                <Plus className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
                Nova marca
              </button>
            }
            testId="empty-marcas"
          />
        </Card>
      ) : (
        <div className="grid gap-2.5">
          {marcas.map(m => (
            <Card key={m.id} className="p-3.5 flex items-center gap-3.5 flex-wrap" data-testid={`marca-${m.id}`}>
              {/* A ÚNICA cor desta tela fora de token, e de propósito: é a cor
                  da própria marca, ou seja, dado. O branco por cima é o mesmo
                  que o servidor deriva para o texto sobre a marca; a lista não
                  carrega esse campo, então aqui ele é assumido — ver aviso.
                  NÃO é `LadrilhoInicial`: a primitiva pinta o fundo por classe
                  (`--surface-inset` fixo) e não aceita cor vinda do dado. Trocar
                  por ela apagaria a cor da marca, que é justamente o que este
                  ladrilho existe para mostrar. Fica como está, declarado. */}
              <div
                className="w-10 h-10 rounded grid place-items-center flex-none font-semibold text-[17px]"
                style={{ background: m.corBrand, color: "#fff" }}
                aria-hidden
              >
                {m.nomeProduto.charAt(0).toUpperCase()}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={TITULO_CARTAO}>{m.nomeProduto}</span>
                  <span className="font-mono text-[10px] text-[var(--text-faint)]">{m.slug}</span>
                  {!m.ativo && <Selo tom="neutro">Inativa</Selo>}
                  {/* Revenda é IDENTIDADE do modelo, não estado de risco: tom
                      `marca`. O `gated` ao lado é que é estado — comissão
                      pausada —, e só faz sentido onde há revenda. */}
                  {m.revendaAtiva && <Selo tom="marca" testId={`selo-revenda-${m.id}`}>revenda ativa</Selo>}
                  {m.revendaAtiva && m.statusComercial === "suspenso" && (
                    <Selo tom="gated">comercial suspenso</Selo>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--text-muted)] flex-wrap">
                  {m.dominio ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Globe className="w-3 h-3 flex-none" strokeWidth={2} />
                      <span className="font-mono">{m.dominio}</span>
                      {/* Certificado emitido é a porta aberta; pendente é a
                          porta que ainda não abriu — `ok` e `gated` dizem
                          exatamente isso, e não é decoração. */}
                      {m.dominioStatus === "ativo"
                        ? <Selo tom="ok">HTTPS ativo</Selo>
                        : <Selo tom="gated">Certificado pendente</Selo>}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <Globe className="w-3 h-3 flex-none" strokeWidth={2} /> só subdomínio
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <ImageIcon className="w-3 h-3 flex-none" strokeWidth={2} />
                    {m.temLogo ? (m.logoEhPng ? "logo PNG" : "logo SVG") : "sem logo"}
                  </span>
                  {m.revendaAtiva && (
                    /* Percentual é número: mono e tabular, como manda a §2. */
                    <span className="inline-flex items-center gap-1.5">
                      <Percent className="w-3 h-3 flex-none" strokeWidth={2} />
                      <span className="font-mono tabular-nums">{percentualDaMarca(m.comissaoPercentual)}%</span>
                      de comissão
                    </span>
                  )}
                  {!(m.responsavelRazaoSocial && m.responsavelCnpj && m.suporteEmail) && (
                    /* Saturação legítima: sem os três dados do responsável, a
                       plataforma continua sendo o controlador — a marca não
                       pode ser vendida assim. */
                    <span className="inline-flex items-center gap-1.5 text-[var(--gated)]">
                      <AlertTriangle className="w-3 h-3 flex-none" strokeWidth={2} /> responsável LGPD incompleto
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {m.dominio && m.dominioStatus !== "ativo" && (
                  <button
                    type="button"
                    className={BOTAO_SECUNDARIO}
                    onClick={() => confirmarDominio.mutate(m.id)}
                    data-testid={`confirmar-dominio-${m.id}`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
                    Confirmar HTTPS
                  </button>
                )}
                <button type="button" className={BOTAO_SECUNDARIO} onClick={() => abrirEdicao(m)}>
                  Editar
                </button>
                {/* `rotulo` vira `aria-label` e `title` de uma vez: um botão só
                    de ícone não tem texto, e sem ele o leitor de tela anuncia
                    "botão" e nada mais. */}
                <BotaoIcone
                  Icone={Trash2}
                  tom="risco"
                  rotulo={`Remover a marca ${m.nomeProduto}`}
                  onClick={() => {
                    if (confirm(`Remover a marca "${m.nomeProduto}"? Os provedores dela voltam para a marca da plataforma.`)) apagar.mutate(m.id);
                  }}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Formulário ──────────────────────────────────────────────────── */}
      {editando !== null && (
        <Card className="p-5 space-y-5" data-testid="form-marca">
          <div className="flex items-center justify-between gap-3">
            <h2 className={TITULO_CARTAO}>
              {novaMarca
                ? "Nova marca"
                : `Editando ${form.nomeProduto || marcaEmEdicao?.nomeProduto || ""}`}
            </h2>
            <BotaoIcone Icone={X} rotulo="Fechar o formulário" onClick={pedirParaFechar} />
          </div>

          {fase.fase === "erro" ? (
            /* Não é estado VAZIO — é falha, e o ladrilho `risco` da primitiva
               é o que diz isso sem repetir o bloco inteiro à mão. */
            <div className="flex flex-col items-center text-center gap-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-6 py-8" data-testid="form-marca-erro">
              <LadrilhoIcone Icone={AlertTriangle} tom="risco" tamanho="lg" />
              <p className={TITULO_CARTAO}>Não foi possível carregar esta marca</p>
              <p className="mx-auto max-w-[46ch] text-[12px] leading-snug text-[var(--text-2)]">
                Os campos não abrem sem o cadastro atual — editar por cima do que não chegou apagaria o que está gravado.
              </p>
              <button type="button" className={cn(BOTAO_SECUNDARIO, "mt-2")} onClick={() => recarregarDetalhe()}>
                Tentar de novo
              </button>
            </div>
          ) : fase.fase === "aguardando" ? <EsqueletoDoFormulario /> : (
          <Tabs value={aba} onValueChange={v => setAba(v as Aba)}>
            <TabsList className={LISTA_ABAS}>
              <TabsTrigger value="identidade" className={ABA} data-testid="tab-marca-identidade">Identidade</TabsTrigger>
              {/* Desabilitadas numa marca nova: as três dependem de um id que
                  ainda não existe. O `title` não vale como aviso aqui — o
                  gatilho desabilitado do shadcn traz `pointer-events-none`, e
                  tooltip que não abre não avisa ninguém. Daí a linha abaixo. */}
              <TabsTrigger value="comercial" className={ABA} disabled={novaMarca} data-testid="tab-marca-comercial">
                Comercial
                {comercialSujo && (
                  <>
                    {/* Ponto, não selo: um dos poucos redondos que a §5.1
                        autoriza, e ele não pode competir com o rótulo da aba. */}
                    <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-[var(--gated)] flex-none" aria-hidden />
                    <span className="sr-only">— alteração não salva</span>
                  </>
                )}
              </TabsTrigger>
              <TabsTrigger value="equipe" className={ABA} disabled={novaMarca} data-testid="tab-marca-equipe">Equipe</TabsTrigger>
              <TabsTrigger value="eventos" className={ABA} disabled={novaMarca} data-testid="tab-marca-eventos">Eventos</TabsTrigger>
            </TabsList>

            {novaMarca && (
              <p className="mt-2 text-[11px] text-[var(--text-muted)] leading-snug max-w-[74ch]">
                Comercial, equipe e eventos abrem depois que a marca existir. A ordem é: criar a
                marca, apontar o domínio e confirmar o HTTPS, ligar a revenda e só então criar o
                acesso do revendedor.
              </p>
            )}

            {/* ── Identidade ─────────────────────────────────────────────── */}
            <TabsContent value="identidade" className="mt-4 space-y-5" data-testid="aba-marca-identidade">
              <section>
                <KickerSecao>Identidade</KickerSecao>
                <div className="grid sm:grid-cols-2 gap-3">
                  {/* `Campo` põe o controle DENTRO do `<label>`: sem `htmlFor` nem
                      aninhamento, clicar no rótulo não focava a caixa e o leitor de
                      tela anunciava o campo sem nome. A explicação fica FORA do
                      rótulo — parágrafo dentro de `<label>` viraria parte do nome
                      anunciado. */}
                  <div>
                    <Campo rotulo="nome do produto">
                      <Input value={form.nomeProduto} placeholder="CredNet" className={CONTROLE_CAMPO}
                             onChange={e => setForm(f => ({
                               ...f, nomeProduto: e.target.value,
                               slug: novaMarca ? slugificar(e.target.value) : f.slug,
                             }))} />
                    </Campo>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">
                      Substitui “Consulta ISP” onde ele é o nome da plataforma. Onde “Consulta ISP”
                      é o nome do <em>tipo de consulta</em>, permanece.
                    </p>
                  </div>
                  {/* Identificador é dado que se lê caractere a caractere: mono. */}
                  <Campo rotulo="identificador">
                    <Input value={form.slug} className={cn(CONTROLE_CAMPO, "font-mono")}
                           onChange={e => setForm(f => ({ ...f, slug: slugificar(e.target.value) }))} />
                  </Campo>
                  <Campo rotulo="linha de apoio" className="sm:col-span-2">
                    <Input value={form.assinatura} placeholder="Crédito para provedores" className={CONTROLE_CAMPO}
                           onChange={e => setForm(f => ({ ...f, assinatura: e.target.value }))} />
                  </Campo>
                </div>
              </section>

              {/* Cor + prévia */}
              <section className="space-y-2">
                <KickerSecao className="mb-0">Cor da marca</KickerSecao>
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="color" value={form.corBrand} aria-label="Cor da marca"
                         onChange={e => setForm(f => ({ ...f, corBrand: e.target.value }))}
                         className={cn("w-11 rounded cursor-pointer border border-[var(--border-strong)] bg-transparent", ALVO_CONTROLE, FOCO)} />
                  <Input value={form.corBrand} aria-label="Cor da marca em hexadecimal"
                         className={cn(CONTROLE_CAMPO, "w-32 font-mono uppercase")}
                         onChange={e => setForm(f => ({ ...f, corBrand: e.target.value }))} />
                  <span className="text-[11px] text-[var(--text-muted)] max-w-[42ch] leading-snug">
                    Hover, fundo e texto sobre a cor saem derivados. Salve para ver a prévia conferida.
                  </span>
                </div>

                {previa && (
                  <div className="flex gap-8 flex-wrap pt-2">
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)] mb-2">Tema claro</p>
                      <div className="flex gap-3">
                        <Amostra cor={previa.claro.brand} nome="marca" />
                        <Amostra cor={previa.claro.hover} nome="hover" />
                        <Amostra cor={previa.claro.soft} nome="fundo" />
                        <Amostra cor={previa.claro.ink} nome="texto" />
                      </div>
                    </div>
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)] mb-2">Tema escuro</p>
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
                  <AvisoDaMarca tom="gated">
                    A cor escolhida foi escurecida para o texto continuar legível. Ela também é a cor
                    de link e de aba ativa — na tonalidade original, sumiria no fundo claro.
                  </AvisoDaMarca>
                )}
              </section>

              {/* Arquivos */}
              <section>
                <KickerSecao>Logo e favicon</KickerSecao>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <Campo rotulo="logo svg">
                      <Input type="file" accept=".svg,image/svg+xml" className={CONTROLE_CAMPO}
                             onChange={e => e.target.files?.[0] && carregarArquivo(e.target.files[0], "logoSvg")} />
                    </Campo>
                    {form.logoSvg
                      ? <p className="text-[11px] text-[var(--ok)] mt-1 inline-flex items-center gap-1"><Check className="w-3 h-3 flex-none" strokeWidth={2} />carregado</p>
                      : <ArquivoAtual presente={Boolean(detalhe?.logoSvg)} />}
                  </div>
                  <div>
                    <Campo rotulo="logo png">
                      <Input type="file" accept="image/png" className={CONTROLE_CAMPO}
                             onChange={e => e.target.files?.[0] && carregarArquivo(e.target.files[0], "logoPng")} />
                    </Campo>
                    {form.logoPng
                      ? <p className="text-[11px] text-[var(--ok)] mt-1 inline-flex items-center gap-1"><Check className="w-3 h-3 flex-none" strokeWidth={2} />carregado</p>
                      : <ArquivoAtual presente={Boolean(detalhe?.logoPng)} />}
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">Não acompanha o tema escuro.</p>
                  </div>
                  <div>
                    <Campo rotulo="favicon svg">
                      <Input type="file" accept=".svg,image/svg+xml" className={CONTROLE_CAMPO}
                             onChange={e => e.target.files?.[0] && carregarArquivo(e.target.files[0], "faviconSvg")} />
                    </Campo>
                    {form.faviconSvg
                      ? <p className="text-[11px] text-[var(--ok)] mt-1 inline-flex items-center gap-1"><Check className="w-3 h-3 flex-none" strokeWidth={2} />carregado</p>
                      : <ArquivoAtual presente={Boolean(detalhe?.faviconSvg)} />}
                  </div>
                </div>
              </section>

              {/* Domínio */}
              <section>
                <KickerSecao>Domínio próprio</KickerSecao>
                {/* O kicker é <h2> e não rotula campo — quem nomeia o input para o
                    leitor de tela é o aria-label. */}
                <Input value={form.dominio} placeholder="app.crednet.com.br"
                       aria-label="Domínio próprio da marca" className={cn(CONTROLE_CAMPO, "font-mono")}
                       onChange={e => setForm(f => ({ ...f, dominio: e.target.value }))} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1 max-w-[70ch] leading-snug">
                  Depois de salvar, o revendedor aponta o DNS para o servidor e alguém roda{" "}
                  <code className="font-mono text-[10px] bg-[var(--surface-inset)] rounded px-1 py-0.5">script/dominio-whitelabel.sh {form.dominio || "dominio"}</code>{" "}
                  — só então confirme o HTTPS na lista. Enquanto isso, o subdomínio da plataforma já funciona.
                </p>
              </section>

              {/* LGPD */}
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <KickerSecao className="mb-0">Responsável pelos dados (LGPD)</KickerSecao>
                  <Selo tom="gated">obrigatório para vender</Selo>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Campo rotulo="razão social">
                    <Input value={form.responsavelRazaoSocial} placeholder="CredNet Serviços Ltda" className={CONTROLE_CAMPO}
                           onChange={e => setForm(f => ({ ...f, responsavelRazaoSocial: e.target.value }))} />
                  </Campo>
                  <Campo rotulo="cnpj">
                    <Input value={form.responsavelCnpj} placeholder="00.000.000/0001-00" className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")}
                           onChange={e => setForm(f => ({ ...f, responsavelCnpj: e.target.value }))} />
                  </Campo>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] max-w-[74ch] leading-snug">
                  Quem o titular vê como controlador na página de privacidade e no consentimento.
                  <strong> As três informações andam juntas — razão social, CNPJ e o e-mail de
                  suporte abaixo.</strong> Faltando qualquer uma, a plataforma continua sendo o
                  controlador, porque nomear o revendedor e mandar o titular escrever para o DPO
                  da plataforma seria pior: quem recebe não tem os dados, e quem tem não recebe.
                  A plataforma segue nomeada como operadora, sempre.
                </p>
              </section>

              {/* Contato */}
              <section>
                <KickerSecao>Contato e e-mail</KickerSecao>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Campo rotulo="e-mail de suporte">
                    <Input value={form.suporteEmail} className={CONTROLE_CAMPO}
                           onChange={e => setForm(f => ({ ...f, suporteEmail: e.target.value }))} />
                  </Campo>
                  <Campo rotulo="whatsapp de suporte">
                    <Input value={form.suporteWhatsapp} placeholder="5531999998888"
                           className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")}
                           onChange={e => setForm(f => ({ ...f, suporteWhatsapp: e.target.value }))} />
                  </Campo>
                  <Campo rotulo="site">
                    <Input value={form.site} placeholder="https://crednet.com.br" className={CONTROLE_CAMPO}
                           onChange={e => setForm(f => ({ ...f, site: e.target.value }))} />
                  </Campo>
                  <div>
                    <Campo rotulo="remetente de e-mail">
                      <Input value={form.emailRemetente} placeholder="nao-responda@crednet.com.br" className={CONTROLE_CAMPO}
                             onChange={e => setForm(f => ({ ...f, emailRemetente: e.target.value }))} />
                    </Campo>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">
                      Só funciona com o domínio verificado no Resend. Vazio = sai pelo domínio da
                      plataforma com o nome da marca.
                    </p>
                  </div>
                  <div>
                    <Campo rotulo="nome de exibição do e-mail">
                      <Input value={form.emailNomeExibicao} placeholder="CredNet" className={CONTROLE_CAMPO}
                             onChange={e => setForm(f => ({ ...f, emailNomeExibicao: e.target.value }))} />
                    </Campo>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">
                      Vazio = o nome do produto.
                    </p>
                  </div>
                </div>
              </section>

              <div className="flex gap-2 pt-1 flex-wrap">
                <button
                  type="button"
                  className={cn(BOTAO_MARCA, DESABILITAVEL)}
                  onClick={() => salvar.mutate()}
                  disabled={salvar.isPending || !form.nomeProduto}
                  data-testid="button-salvar-marca"
                >
                  {salvar.isPending ? "Salvando…" : "Salvar marca"}
                </button>
                <button type="button" className={BOTAO_SECUNDARIO} onClick={pedirParaFechar}>
                  Cancelar
                </button>
              </div>

              {/* Provedores vinculados */}
              {typeof editando === "number" && (
                <section className="border-t border-[var(--border)] pt-4 space-y-2">
                  <KickerSecao className="mb-0 flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden /> Provedores nesta marca
                  </KickerSecao>
                  {detalhe?.provedores?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {detalhe.provedores.map((p: any) => (
                        /* O nome do provedor é dado, não estado: o chip fica
                           neutro, como manda a seção 3.5 para identidade. */
                        <Selo key={p.id} tom="neutro">
                          {p.name}
                          <button
                            type="button"
                            onClick={() => vincular.mutate({ providerId: p.id, marcaId: null })}
                            aria-label={`Desvincular ${p.name}`}
                            title={`Desvincular ${p.name}`}
                            /* Não é `BotaoIcone`: este vive DENTRO do selo, e o
                               quadrado de 36px da primitiva estouraria o chip. O que
                               ele toma emprestado é o que não pode divergir — o anel
                               de foco. */
                            className={cn("rounded hover:text-[var(--danger)] motion-safe:transition-colors", FOCO)}
                          >
                            <X className="w-3 h-3" strokeWidth={2} />
                          </button>
                        </Selo>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-[var(--text-muted)] leading-snug max-w-[64ch]">
                      Nenhum ainda. Sem provedor vinculado, esta marca só aparece se alguém acessar o
                      domínio dela.
                    </p>
                  )}

                  {semMarca.length > 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <Select onValueChange={v => vincular.mutate({ providerId: Number(v), marcaId: editando })}>
                        {/* A MESMA caixa dos campos acima: um seletor que escolhe
                            provedor é área de entrada como qualquer outra, e com a
                            composição solta ele ficava sem borda de área editável e
                            sem anel de foco enquanto o campo ao lado tinha os dois. */}
                        <SelectTrigger className={cn(CONTROLE_CAMPO, "w-72")} aria-label="Vincular um provedor a esta marca">
                          <SelectValue placeholder="Vincular um provedor…" />
                        </SelectTrigger>
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
            </TabsContent>

            {/* ── Comercial ──────────────────────────────────────────────── */}
            <TabsContent value="comercial" className="mt-4 space-y-5" data-testid="aba-marca-comercial">
              <section className="space-y-3">
                <KickerSecao className="mb-0">Situação</KickerSecao>
                {/* A CHAVE GERAL DA MARCA. A API sempre aceitou `ativo`, mas não
                    havia controle nenhum: a tela só mostrava o selo "Inativa", e
                    religar uma marca exigia mexer no banco.
                    Fica aqui, e não na aba Identidade, porque aquele formulário
                    é `Record<string, string>` e trata vazio como `null` — um
                    booleano ali sairia nulo a cada omissão. */}
                <div className="flex items-start gap-3">
                  <Switch
                    id="marca-ativa"
                    checked={comercial.ativo}
                    onCheckedChange={v => setComercial(c => ({ ...c, ativo: v }))}
                    data-testid="switch-marca-ativa"
                  />
                  <div className="min-w-0">
                    <label htmlFor="marca-ativa" className="text-[13px] font-medium text-[var(--text)] cursor-pointer">
                      Marca no ar
                    </label>
                    <p className="text-[11px] text-[var(--text-muted)] leading-snug max-w-[74ch] mt-0.5">
                      Desligada, a marca deixa de responder no domínio dela: o revendedor perde o
                      painel em até 30 segundos e nenhum acesso novo pode ser criado. Os provedores
                      continuam operando e pagando — eles voltam a ver a plataforma, não param.
                      É também a saída para uma marca que tem histórico e por isso não pode ser
                      excluída.
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <KickerSecao className="mb-0">Modelo</KickerSecao>
                <div className="flex items-start gap-3">
                  {/* `htmlFor` apontando para o interruptor, e não um `<label>`
                      em volta dele: o controle do Radix é um `<button>`, e um
                      botão dentro do próprio rótulo recebe o clique dele e o
                      clique que o rótulo encaminha — o par por `id` é a
                      composição que a biblioteca documenta e não depende de o
                      navegador acertar essa desambiguação. */}
                  <Switch
                    id="marca-revenda-ativa"
                    checked={comercial.revendaAtiva}
                    onCheckedChange={v => setComercial(c => ({ ...c, revendaAtiva: v }))}
                    data-testid="switch-revenda-ativa"
                  />
                  <div className="min-w-0">
                    <label htmlFor="marca-revenda-ativa" className="text-[13px] font-medium text-[var(--text)] cursor-pointer">
                      Revenda ativa
                    </label>
                    <p className="text-[11px] text-[var(--text-muted)] leading-snug max-w-[74ch] mt-0.5">
                      Liga o modelo de comissão e o painel do revendedor. Desligada, a marca é só a
                      pele: o provedor vê outro nome e outras cores, e a plataforma continua sozinha
                      na relação comercial.
                    </p>
                  </div>
                </div>
              </section>

              {avisosComerciais.map((aviso, i) => (
                <AvisoDaMarca key={i} tom={aviso.tom}>{aviso.texto}</AvisoDaMarca>
              ))}

              <section className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Campo rotulo="status comercial">
                    <Select
                      value={comercial.statusComercial}
                      onValueChange={v => setComercial(c => ({ ...c, statusComercial: v }))}
                    >
                      <SelectTrigger className={CONTROLE_CAMPO} data-testid="select-status-comercial">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ativo">Ativo</SelectItem>
                        <SelectItem value="suspenso">Suspenso</SelectItem>
                      </SelectContent>
                    </Select>
                  </Campo>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">
                    Suspender pausa a comissão e trava o preço da marca. Não derruba a pele nem
                    suspende provedor nenhum — dívida do revendedor não pune quem é cliente dele.
                  </p>
                </div>
                <div>
                  <Campo rotulo="comissão (%)">
                    <Input
                      type="number" min={0} max={50} step="0.5"
                      value={comercial.comissaoPercentual}
                      className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")}
                      onChange={e => setComercial(c => ({ ...c, comissaoPercentual: e.target.value }))}
                      data-testid="input-comissao-percentual"
                    />
                  </Campo>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">
                    De 0 a 50, sobre o valor que o provedor efetivamente pagou. Só aqui se define —
                    o revendedor não vê este campo. Mudar o percentual não reescreve o que já foi
                    lançado.
                  </p>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <KickerSecao className="mb-0">Dados de repasse</KickerSecao>
                  <Selo tom="neutro">quem recebe a comissão</Selo>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] max-w-[74ch] leading-snug">
                  <strong>Não é o responsável pelos dados (LGPD).</strong> Aquele é quem responde ao
                  titular e aparece na política de privacidade; este é quem emite a nota de comissão
                  contra a plataforma e recebe o PIX do fechamento. Podem ser pessoas jurídicas
                  diferentes, e nada disto sai em rota do revendedor nem na pele da marca.
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Campo rotulo="razão social">
                    <Input value={comercial.repasseRazaoSocial} placeholder="CredNet Participações Ltda"
                           className={CONTROLE_CAMPO}
                           onChange={e => setComercial(c => ({ ...c, repasseRazaoSocial: e.target.value }))} />
                  </Campo>
                  <Campo rotulo="cnpj">
                    <Input value={comercial.repasseCnpj} placeholder="00.000.000/0001-00"
                           className={cn(CONTROLE_CAMPO, "font-mono tabular-nums")}
                           onChange={e => setComercial(c => ({ ...c, repasseCnpj: e.target.value }))} />
                  </Campo>
                  <Campo rotulo="chave pix">
                    <Input value={comercial.repasseChavePix} placeholder="financeiro@crednet.com.br"
                           className={cn(CONTROLE_CAMPO, "font-mono")}
                           onChange={e => setComercial(c => ({ ...c, repasseChavePix: e.target.value }))} />
                  </Campo>
                  <Campo rotulo="e-mail do financeiro">
                    <Input value={comercial.repasseEmail} placeholder="financeiro@crednet.com.br"
                           className={CONTROLE_CAMPO}
                           onChange={e => setComercial(c => ({ ...c, repasseEmail: e.target.value }))} />
                  </Campo>
                </div>
              </section>

              {erroComercial && (
                /* `role="alert"` porque o texto aparece depois de o operador já
                   ter digitado: sem ele, quem usa leitor de tela descobre o
                   impedimento só ao chegar no botão travado. */
                <p role="alert" className="text-[12px] text-[var(--danger)]" data-testid="erro-comercial">
                  {erroComercial}
                </p>
              )}

              <div className="flex gap-2 pt-1 flex-wrap">
                <button
                  type="button"
                  className={cn(BOTAO_MARCA, DESABILITAVEL)}
                  onClick={() => salvarComercial.mutate()}
                  disabled={salvarComercial.isPending || Boolean(erroComercial)}
                  data-testid="button-salvar-comercial"
                >
                  {salvarComercial.isPending ? "Salvando…" : "Salvar dados comerciais"}
                </button>
              </div>
            </TabsContent>

            {/* ── Equipe revendedora ─────────────────────────────────────── */}
            <TabsContent value="equipe" className="mt-4 space-y-4" data-testid="aba-marca-equipe">
              <p className="text-[12px] text-[var(--text-muted)] leading-snug max-w-[74ch]">
                Quem entra pelo domínio desta marca e enxerga o painel de revenda. Estes acessos não
                pertencem a provedor nenhum e não veem dado de titular — nem consulta, nem CPF, nem
                carteira.
              </p>

              {equipe.isError ? (
                <AvisoNaoCarregou aoTentarDeNovo={() => equipe.refetch()} testId="erro-equipe">
                  Não foi possível carregar a equipe desta marca. Sem a lista não dá para saber
                  quem já tem acesso pelo domínio dela.
                </AvisoNaoCarregou>
              ) : equipe.isLoading ? (
                <LinhasSkeleton linhas={2} />
              ) : equipe.data?.length ? (
                <TabelaPainel testId="tabela-equipe-revenda">
                  <thead>
                    <tr>
                      <Th>nome</Th>
                      <Th>e-mail</Th>
                      <Th>criado em</Th>
                      <Th alinhamento="direita">ação</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {equipe.data.map(u => (
                      <tr key={u.id} data-testid={`revendedor-${u.id}`}>
                        <Td className="text-[var(--text)]">
                          <span className="flex items-center gap-2 flex-wrap">
                            {u.name}
                            {u.mustChangePassword && <Selo tom="gated">senha temporária</Selo>}
                          </span>
                        </Td>
                        {/* E-mail é identificador: mono, mas alinhado à esquerda
                            como texto — número à direita forma coluna, endereço
                            à direita só quebra a leitura. */}
                        <Td num alinhamento="esquerda">{u.email}</Td>
                        <Td num alinhamento="esquerda">{dataHoraCurta(u.createdAt)}</Td>
                        <Td alinhamento="direita">
                          <BotaoIcone
                            Icone={Trash2}
                            tom="risco"
                            rotulo={`Remover o acesso de ${u.name}`}
                            onClick={() => {
                              if (confirm(`Remover o acesso de "${u.name}" (${u.email})? Ele perde a entrada pelo domínio da marca.`)) {
                                removerRevendedor.mutate(u.id);
                              }
                            }}
                            testId={`remover-revendedor-${u.id}`}
                          />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TabelaPainel>
              ) : (
                <EstadoVazio
                  Icone={Users}
                  titulo="Nenhum acesso de revenda"
                  descricao="Enquanto ninguém tiver acesso, esta marca é operada só pela plataforma."
                  testId="empty-equipe-revenda"
                />
              )}

              <section className="border-t border-[var(--border)] pt-4 space-y-3">
                <KickerSecao className="mb-0">Novo acesso</KickerSecao>

                {/* O motivo vem ANTES dos campos, e não como tooltip do botão:
                    o botão fica desabilitado, e tooltip de controle desabilitado
                    não abre. O servidor devolve 422 nesta mesma situação — a
                    tela existe para o operador não descobrir a regra pelo erro. */}
                {/* Um aviso só, e ele é o mesmo que desabilita o botão.
                    Antes havia um segundo bloco para "revenda desligada" que
                    dizia "o acesso é criado e o login funciona" e deixava o
                    botão clicável — e o servidor respondia 422. A regra virou
                    o quarto degrau de `motivoParaNaoCriarRevendedor`, que é o
                    caminho que já desabilita. */}
                {bloqueioDaEquipe && <AvisoDaMarca tom="gated">{bloqueioDaEquipe}</AvisoDaMarca>}

                <div className="grid sm:grid-cols-2 gap-3">
                  <Campo rotulo="nome">
                    <Input
                      value={novoRevendedor.nome} placeholder="Maria Souza" className={CONTROLE_CAMPO}
                      onChange={e => setNovoRevendedor(u => ({ ...u, nome: e.target.value }))}
                      data-testid="input-revendedor-nome"
                    />
                  </Campo>
                  <Campo rotulo="e-mail">
                    <Input
                      value={novoRevendedor.email} placeholder="maria@crednet.com.br" className={CONTROLE_CAMPO}
                      onChange={e => setNovoRevendedor(u => ({ ...u, email: e.target.value }))}
                      data-testid="input-revendedor-email"
                    />
                  </Campo>
                </div>

                <button
                  type="button"
                  className={cn(BOTAO_MARCA, DESABILITAVEL)}
                  onClick={() => criarRevendedor.mutate()}
                  disabled={Boolean(bloqueioDaEquipe) || !revendedorPronto || criarRevendedor.isPending}
                  data-testid="button-criar-revendedor"
                >
                  <Plus className="w-3.5 h-3.5 flex-none" strokeWidth={2} />
                  {criarRevendedor.isPending ? "Criando…" : "Criar acesso"}
                </button>

                {senhaTemporaria && (
                  <div className="rounded border border-[var(--gated-border)] bg-[var(--gated-bg)] p-3 space-y-2" data-testid="senha-temporaria">
                    <p className="text-[12px] text-[var(--gated)] leading-relaxed">
                      Senha temporária de <span className="font-mono">{senhaTemporaria.email}</span>.
                      {" "}<strong>Ela não vai por e-mail</strong> e não volta a aparecer aqui — copie
                      agora e entregue por um canal seguro. Se ela se perder, o caminho é remover o
                      acesso e criar outro.
                    </p>
                    <p className="font-mono text-[13px] text-[var(--text)] select-all">{senhaTemporaria.senha}</p>
                    {/* Dispensar é uma AÇÃO, e não um efeito colateral de fechar
                        a tela: enquanto esta caixa estiver aberta, sair da
                        edição pede confirmação (ver `pedirParaFechar`). */}
                    <button
                      type="button"
                      className={cn(BOTAO_SECUNDARIO, "text-[11px]")}
                      onClick={() => setSenhaTemporaria(null)}
                      data-testid="button-senha-copiada"
                    >
                      Já copiei a senha
                    </button>
                  </div>
                )}
              </section>
            </TabsContent>

            {/* ── Eventos ────────────────────────────────────────────────── */}
            <TabsContent value="eventos" className="mt-4 space-y-3" data-testid="aba-marca-eventos">
              <p className="text-[12px] text-[var(--text-muted)] leading-snug max-w-[74ch]">
                O que foi feito nesta marca, pelo revendedor e pela plataforma. A trilha é
                append-only: nada aqui se edita nem se apaga, e é ela que responde “quem suspendeu
                meu provedor?”.
              </p>

              {eventos.isError ? (
                <AvisoNaoCarregou aoTentarDeNovo={() => eventos.refetch()} testId="erro-eventos">
                  Não foi possível carregar a trilha desta marca. Uma lista vazia diria que ninguém
                  mexeu em nada, e não é isso que aconteceu.
                </AvisoNaoCarregou>
              ) : eventos.isLoading ? (
                <LinhasSkeleton linhas={4} />
              ) : eventos.data?.length ? (
                <TabelaPainel testId="tabela-eventos-marca">
                  <thead>
                    <tr>
                      <Th>quando</Th>
                      <Th>quem</Th>
                      <Th>o que</Th>
                      <Th>provedor</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventos.data.map(ev => (
                      <tr key={ev.id} data-testid={`evento-${ev.id}`}>
                        <Td num alinhamento="esquerda">{dataHoraCurta(ev.createdAt)}</Td>
                        <Td>
                          <span className="text-[var(--text)]">{nomeDoAtor(ev)}</span>
                          <span className="block font-mono text-[9.5px] uppercase tracking-[var(--track-wide)] text-[var(--text-faint)]">
                            {ev.atorRole}
                          </span>
                        </Td>
                        <Td className="text-[var(--text)]">{rotuloDaAcao(ev.acao)}</Td>
                        <Td>{nomeDoProvedor(ev, detalhe?.provedores ?? []) ?? "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TabelaPainel>
              ) : (
                <EstadoVazio
                  Icone={History}
                  titulo="Nenhum evento ainda"
                  descricao="A trilha começa no primeiro ato sobre esta marca — ligar a revenda, criar um acesso, mexer em preço."
                  testId="empty-eventos-marca"
                />
              )}
            </TabsContent>
          </Tabs>
          )}
        </Card>
      )}
    </div>
  );
}
