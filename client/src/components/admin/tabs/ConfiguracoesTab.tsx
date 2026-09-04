import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  KickerSecao, TITULO_CARTAO, Selo, EstadoVazio, LinhasSkeleton, LadrilhoInicial,
  Campo, RotuloCampo, BotaoIcone, BOTAO_ICONE, CONTROLE_CAMPO,
  ALVO_CONTROLE, BOTAO_MARCA, BOTAO_SECUNDARIO, FOCO,
} from "@/components/painel/ui";
import {
  Plus, Save, X, Pencil, Trash2, Database, ImagePlus,
  ToggleLeft, ToggleRight,
} from "lucide-react";
import type { ErpCatalog } from "@shared/schema";

/**
 * Catálogo de ERPs do superadmin, vestido na MESMA linguagem do Painel do
 * Provedor. Rodada de LINGUAGEM VISUAL: nenhuma rota, queryKey, endpoint ou
 * permissão mudou.
 *
 * UM `data-testid` SAIU, e de propósito: `select-erp-gradient`, o seletor "Cor
 * do gradiente". Ele identificava um campo que deixou de existir — gradiente é
 * proibido pela seção 7, e o bloco 1 abaixo conta por quê. Identificador de
 * teste não é contrato quando o que ele aponta foi removido: mantê-lo pediria
 * manter o campo. Todos os outros continuam onde estavam.
 *
 * ===================================================================
 * 1. O GRADIENTE SAIU — e ele nunca chegou a existir na tela
 * ===================================================================
 * A tela pintava três coisas com `erp.gradient` (coluna `erp_catalog.gradient`,
 * texto livre cujo default é um par de paradas de cor da paleta padrão do
 * Tailwind): uma tarja de 1.5px no
 * topo do card, o fundo do ladrilho quando o ERP não tem logotipo, e a caixa de
 * pré-visualização do formulário. Havia ainda um seletor "Cor do gradiente" com
 * doze opções, todas da paleta default do Tailwind.
 *
 * Duas proibições da seção 7 de uma vez (paleta default + gradiente), e o
 * DESIGN_SYSTEM é explícito: profundidade vem de borda de 1px, e uma cor de
 * marca só. Um catálogo com dez tarjas coloridas diferentes é exatamente o
 * ruído que a pele Bureau existe para não ter.
 *
 * MAIS QUE ISSO: o gradiente NÃO RENDERIZAVA. O valor guardado é só o par de
 * paradas de cor, sem a classe utilitária de direção que produz o
 * `background-image`. Sem ela o Tailwind só define as variáveis
 * `--tw-gradient-from/to` e nada é desenhado — a tarja era invisível e o
 * ladrilho de fallback era um quadrado transparente com a inicial em BRANCO
 * sobre o branco do card, ou seja, letra invisível. Quem cuidava do catálogo
 * escolhia uma cor que a tela nunca mostrou. Substituído pelo ladrilho neutro
 * abaixo, que de fato aparece.
 *
 * O QUE ACONTECE COM O DADO: nada. A coluna continua no schema (que não se
 * altera sem autorização) e continua sendo lida por quem já a lia. O formulário
 * apenas parou de MANDAR o campo:
 *   - no PATCH, `erpCatalogUpdateSchema` é um `z.object` com `gradient`
 *     opcional; ausente, a chave não entra em `parsed.data` e o UPDATE não
 *     toca a coluna — cada ERP existente mantém o valor que já tinha;
 *   - no POST, `insertErpCatalogSchema` também aceita a ausência (coluna
 *     `notNull().default(...)`, e drizzle-zod torna opcional o que tem default
 *     — conferido rodando o parse), então o ERP novo nasce com o default
 *     declarado no próprio schema em vez de com um valor que esta tela
 *     inventava.
 * Ver o aviso do relatório: a coluna só pode morrer quando o painel do provedor
 * (frente vizinha) parar de consumi-la, e isso mexe em schema.
 *
 * ===================================================================
 * 2. O LOGOTIPO FICOU — ele é dado, não decoração
 * ===================================================================
 * `logoBase64` é a marca real do fabricante do ERP, servida ao provedor em
 * `GET /api/public/erp-catalog` e mostrada na hora em que ele escolhe qual
 * sistema integrar. Apagar o envio de logotipo seria apagar uma capacidade, não
 * traduzir uma linguagem — fora do escopo desta rodada, e prejudicaria outra
 * tela. O que mudou é a MOLDURA: fundo `--surface-inset`, borda de 1px, raio de
 * 8px, o mesmo ladrilho do resto da casa.
 *
 * SEM LOGOTIPO, A INICIAL — e não um ícone genérico. `LadrilhoIcone` é a forma
 * da casa quando o conteúdo é um ícone NOSSO; aqui o ladrilho tem de
 * IDENTIFICAR um ERP, e dez ladrilhos com o mesmo ícone de banco de dados não
 * identificam nada. A inicial em ladrilho neutro é o tratamento que o painel já
 * usa para entidade sem imagem, e agora vem da primitiva `LadrilhoInicial` em
 * vez da cópia local que estava aqui. `LadrilhoIcone` continua sendo usado onde
 * cabe: dentro do `EstadoVazio`, que já o traz.
 *
 * ===================================================================
 * 3. Outras decisões
 * ===================================================================
 * - O `opacity-60` do card de ERP inativo SAIU. Ele derrubava nome, descrição e
 *   chave abaixo do contraste mínimo, e a seção 7 chama contraste de não
 *   negociável. Quem diz que o ERP está oculto é o selo, que é para isso.
 * - O carregamento era um `RefreshCw` girando no meio da área. Virou a forma do
 *   que vem (`LinhasSkeleton` dentro de cards), como manda a seção 6.
 * - O vazio era texto solto com um ícone apagado. Virou `EstadoVazio`, com ação.
 * - Rótulos das opções de autenticação traduzidos, VALORES intactos
 *   (`bearer`/`basic`/`apikey` continuam sendo o que se grava em `auth_type`).
 */

/** Texto de apoio abaixo do campo. */
const AJUDA_CAMPO = "text-[11.5px] text-[var(--text-muted)] mt-1";

/** Botão que envolve um SELO, e por isso não é `BotaoIcone`: a primitiva de
 *  botão de ícone é quadrada e cortaria a pílula. O que se aproveita dela é o
 *  que importa — a altura de controle da casa, o anel de foco e a transição —,
 *  composto por `cn()` e não por texto grudado, para que uma classe de fora
 *  possa vencer sem depender da ordem em que o Tailwind emite o CSS. */
const BOTAO_SELO = cn(
  ALVO_CONTROLE,
  "inline-grid place-items-center rounded px-1",
  FOCO,
  "motion-safe:transition-colors",
);

/* A caixa do seletor era uma terceira cópia da mesma constante — e a que mais
   tinha derivado: já havia perdido a transição de cor e trocado a ordem das
   classes em relação às outras duas. Agora é `CONTROLE_CAMPO`, da primitiva,
   a mesma caixa dos campos de texto deste formulário. */

/** O formulário em branco. Sem `gradient`: ver o bloco 1 acima. */
const BLANK_ERP_FORM = {
  key: "", name: "", description: "",
  authType: "bearer", authHint: "", active: true, logoBase64: "",
};

/** Tipos de autenticação, em português. As CHAVES são os valores gravados em
 *  `erp_catalog.auth_type` e não mudam; só o rótulo é de gente. O termo técnico
 *  fica entre parênteses de propósito: quem cadastra o ERP precisa casar a
 *  escolha com a documentação do fabricante, e essa documentação diz "Bearer". */
const TIPOS_AUTENTICACAO: { valor: string; rotulo: string }[] = [
  { valor: "bearer", rotulo: "Token (Bearer)" },
  { valor: "basic", rotulo: "Usuário e token (Basic)" },
  { valor: "apikey", rotulo: "Chave de API" },
];

/** Moldura do ladrilho do ERP: raio de 8px e hairline, para o logotipo do
 *  fabricante não flutuar solto sobre o cartão. */
const MOLDURA_LADRILHO = "rounded-lg border border-[var(--border)]";

/** Ladrilho do ERP: logotipo quando existe, inicial do nome quando não.
 *
 *  A inicial vem de `LadrilhoInicial` — a cópia local daqui era a quarta do
 *  painel, e cada uma recortava e maiusculava o nome do seu jeito. `name` é
 *  `notNull` no schema, mas nada impede a string vazia: a primitiva deixa o
 *  ladrilho VAZIO nesse caso, em vez do "?" que esta tela inventava. Vazio ao
 *  menos mantém a coluna alinhada sem afirmar um caractere que ninguém digitou.
 *
 *  ERP é uma COISA (um sistema, um fabricante), então canto seco: o círculo da
 *  primitiva é reservado a pessoa. */
function LadrilhoErp({
  nome,
  logo,
  testIdLogo,
}: {
  nome: string;
  logo?: string | null;
  testIdLogo?: string;
}) {
  if (!logo) {
    return <LadrilhoInicial nome={nome} tamanho="lg" className={MOLDURA_LADRILHO} />;
  }
  return (
    <div
      className={cn(
        "w-10 h-10 grid place-items-center flex-none overflow-hidden bg-[var(--surface-inset)]",
        MOLDURA_LADRILHO,
      )}
    >
      <img src={logo} alt={nome} className="w-full h-full object-contain p-1" data-testid={testIdLogo} />
    </div>
  );
}

export default function ConfiguracoesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: erpCatalogList = [], isLoading: erpCatalogLoading } = useQuery<ErpCatalog[]>({
    queryKey: ["/api/erp-catalog"],
  });

  const [showErpForm, setShowErpForm] = useState(false);
  const [editingErp, setEditingErp] = useState<ErpCatalog | null>(null);
  const [erpForm, setErpForm] = useState({ ...BLANK_ERP_FORM });
  const [erpLogoPreview, setErpLogoPreview] = useState<string>("");

  const createErpMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/erp-catalog", data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/erp-catalog"] });
      setShowErpForm(false);
      setEditingErp(null);
      setErpForm({ ...BLANK_ERP_FORM });
      setErpLogoPreview("");
      toast({ title: "ERP cadastrado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao cadastrar ERP", description: e.message, variant: "destructive" }),
  });

  const updateErpMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/erp-catalog/${id}`, data);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/erp-catalog"] });
      setShowErpForm(false);
      setEditingErp(null);
      setErpForm({ ...BLANK_ERP_FORM });
      setErpLogoPreview("");
      toast({ title: "ERP atualizado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao atualizar ERP", description: e.message, variant: "destructive" }),
  });

  const deleteErpMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/erp-catalog/${id}`, undefined);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/erp-catalog"] });
      toast({ title: "ERP removido" });
    },
    onError: (e: any) => toast({ title: "Erro ao remover", description: e.message, variant: "destructive" }),
  });

  const toggleErpActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/erp-catalog/${id}`, { active });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/erp-catalog"] }),
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const handleErpLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast({ title: "Imagem muito grande", description: "Máximo 2 MB", variant: "destructive" }); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setErpLogoPreview(base64);
      setErpForm(f => ({ ...f, logoBase64: base64 }));
    };
    reader.readAsDataURL(file);
  };

  const abrirNovoErp = () => {
    setEditingErp(null);
    setErpForm({ ...BLANK_ERP_FORM });
    setErpLogoPreview("");
    setShowErpForm(true);
  };

  const fecharErpForm = () => {
    setShowErpForm(false);
    setEditingErp(null);
  };

  const openEditErp = (erp: ErpCatalog) => {
    setEditingErp(erp);
    setErpForm({
      key: erp.key, name: erp.name, description: erp.description ?? "",
      authType: erp.authType, authHint: erp.authHint ?? "",
      active: erp.active, logoBase64: erp.logoBase64 ?? "",
    });
    setErpLogoPreview(erp.logoBase64 ?? "");
    setShowErpForm(true);
  };

  const handleErpSubmit = () => {
    if (!erpForm.key || !erpForm.name) {
      toast({ title: "Campos obrigatórios", description: "Chave e nome são obrigatórios", variant: "destructive" });
      return;
    }
    const payload = { ...erpForm, logoBase64: erpForm.logoBase64 || null };
    if (editingErp) { updateErpMutation.mutate({ id: editingErp.id, data: payload }); }
    else { createErpMutation.mutate(payload); }
  };

  const salvando = createErpMutation.isPending || updateErpMutation.isPending;
  const total = erpCatalogList.length;

  return (
    <div className="space-y-6" data-testid="admin-configuracoes">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-[var(--text-muted)] max-w-[62ch]">
          <span className="font-mono tabular-nums text-[var(--text)]">{total}</span>
          {total === 1 ? " sistema no catálogo" : " sistemas no catálogo"}. O logotipo é o que o
          provedor vê na hora de escolher qual sistema integrar.
        </p>
        <button type="button" className={BOTAO_MARCA} onClick={abrirNovoErp} data-testid="button-new-erp">
          <Plus className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
          Novo ERP
        </button>
      </div>

      {showErpForm && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className={TITULO_CARTAO}>{editingErp ? "Editar ERP" : "Cadastrar novo ERP"}</h3>
            <BotaoIcone
              Icone={X}
              rotulo="Fechar o formulário"
              onClick={fecharErpForm}
              testId="button-close-erp-form"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              {/* `Campo` põe o controle DENTRO do `<label>`: sem `htmlFor` nem
                  aninhamento — que era o caso aqui —, clicar no rótulo não foca
                  a caixa e o leitor de tela anuncia o campo sem nome. O rótulo
                  fica em minúsculas no código e a caixa alta é do CSS, como a
                  primitiva pede. */}
              <div>
                <Campo rotulo="chave *">
                  <Input
                    value={erpForm.key}
                    onChange={e => setErpForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))}
                    placeholder="ex.: ixc, sgp, mk"
                    disabled={!!editingErp}
                    data-testid="input-erp-key"
                    className={cn(CONTROLE_CAMPO, "font-mono")}
                  />
                </Campo>
                <p className={AJUDA_CAMPO}>
                  Identificador único, sem espaços. {editingErp ? "Não muda depois de criado." : "Não poderá ser alterado depois."}
                </p>
              </div>
              <Campo rotulo="nome do ERP *">
                <Input
                  value={erpForm.name}
                  onChange={e => setErpForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="ex.: iXC Soft"
                  data-testid="input-erp-name"
                  className={CONTROLE_CAMPO}
                />
              </Campo>
              <Campo rotulo="descrição">
                <Input
                  value={erpForm.description}
                  onChange={e => setErpForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="ex.: ERP para provedores de internet"
                  data-testid="input-erp-description"
                  className={CONTROLE_CAMPO}
                />
              </Campo>
              <Campo rotulo="tipo de autenticação">
                <select
                  className={CONTROLE_CAMPO}
                  value={erpForm.authType}
                  onChange={e => setErpForm(f => ({ ...f, authType: e.target.value }))}
                  data-testid="select-erp-auth-type"
                >
                  {TIPOS_AUTENTICACAO.map(t => (
                    <option key={t.valor} value={t.valor}>{t.rotulo}</option>
                  ))}
                </select>
              </Campo>
              <div>
                <Campo rotulo="dica de autenticação">
                  <Input
                    value={erpForm.authHint}
                    onChange={e => setErpForm(f => ({ ...f, authHint: e.target.value }))}
                    placeholder="ex.: token: chave de API do sistema"
                    data-testid="input-erp-auth-hint"
                    className={CONTROLE_CAMPO}
                  />
                </Campo>
                <p className={AJUDA_CAMPO}>Aparece para o provedor ao preencher as credenciais.</p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Aqui o rótulo é `RotuloCampo` e não `Campo`: o bloco abaixo já
                  contém o `<label>` do seletor de arquivo, e um `<label>` dentro
                  de outro não é HTML válido. O que nomeia o grupo é o `role` +
                  `aria-label`; a voz do rótulo continua sendo a mesma dos
                  demais campos. */}
              <div role="group" aria-label="Logotipo do ERP">
                <RotuloCampo>logotipo</RotuloCampo>
                <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-inset)] p-4 flex flex-col items-center gap-3">
                  {erpLogoPreview ? (
                    <img
                      src={erpLogoPreview}
                      alt="Prévia do logotipo"
                      className="w-20 h-20 object-contain rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1.5"
                      data-testid="img-erp-logo-preview"
                    />
                  ) : (
                    /* A prévia mostra exatamente o que o catálogo mostrará se
                       ninguém enviar logotipo: a MESMA primitiva de inicial,
                       ampliada. Antes era um quadrado com gradiente que a tela
                       nunca desenhou e uma letra branca invisível — e, depois
                       disso, uma segunda cópia da inicial ao lado da do
                       ladrilho, que podiam divergir. */
                    <LadrilhoInicial
                      nome={erpForm.name}
                      tamanho="lg"
                      className={cn("w-20 h-20 text-[26px] bg-[var(--surface)]", MOLDURA_LADRILHO)}
                    />
                  )}
                  <div className="flex items-center gap-2 flex-wrap justify-center">
                    {/* O input era `className="hidden"`, e `display:none` tira o
                        campo da ordem de tabulação: pelo teclado não havia como
                        enviar logotipo nenhum. `sr-only` esconde sem remover, e
                        o `peer` leva o anel de foco para o rótulo, que é a
                        superfície que a pessoa enxerga. Por isso o input é
                        IRMÃO do label e não filho — `peer` só alcança irmão. */}
                    <input
                      id="erp-logo-file"
                      type="file"
                      accept="image/*"
                      className="sr-only peer"
                      onChange={handleErpLogoUpload}
                      data-testid="input-erp-logo-file"
                    />
                    <label
                      htmlFor="erp-logo-file"
                      className={`${BOTAO_SECUNDARIO} cursor-pointer peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--brand)]`}
                      data-testid="label-upload-logo"
                    >
                      <ImagePlus className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                      {erpLogoPreview ? "Trocar logotipo" : "Enviar logotipo"}
                    </label>
                    {erpLogoPreview && (
                      <button
                        type="button"
                        /* `cn()` e não texto grudado: `BOTAO_SECUNDARIO` já traz
                           uma tinta, e duas utilidades de cor na mesma string
                           não se resolvem pela ordem em que foram escritas. */
                        className={cn(BOTAO_SECUNDARIO, "text-[var(--danger)]")}
                        onClick={() => { setErpLogoPreview(""); setErpForm(f => ({ ...f, logoBase64: "" })); }}
                      >
                        <Trash2 className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                        Remover
                      </button>
                    )}
                  </div>
                  <p className="text-[11.5px] text-[var(--text-muted)] text-center leading-snug">
                    PNG, JPG ou SVG, até <span className="font-mono tabular-nums">2 MB</span>.
                    <br />
                    Sem logotipo, o catálogo mostra a inicial do nome.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Aproveita a casca de `BOTAO_ICONE` (alvo, foco, hover) mas
                    desenha o próprio ícone, que aqui tem 28px e é a chave em si,
                    não um adorno. A tinta de estado precisa vencer também no
                    hover, senão a chave ligada escurece ao passar o ponteiro. */}
                <button
                  type="button"
                  onClick={() => setErpForm(f => ({ ...f, active: !f.active }))}
                  className={cn(
                    BOTAO_ICONE,
                    erpForm.active && "text-[var(--ok)] hover:text-[var(--ok)]",
                  )}
                  role="switch"
                  aria-checked={erpForm.active}
                  aria-label="Exibir este ERP para os provedores"
                  data-testid="toggle-erp-active"
                >
                  {erpForm.active
                    ? <ToggleRight className="w-7 h-7" strokeWidth={2} aria-hidden />
                    : <ToggleLeft className="w-7 h-7" strokeWidth={2} aria-hidden />}
                </button>
                <span className="text-[13px] text-[var(--text-2)]">
                  {erpForm.active ? "Visível para os provedores" : "Oculto para os provedores"}
                </span>
              </div>

              {/* Grade, e nao flex, porque `BOTAO_MARCA` ja traz `flex-none`:
                  somar `flex-1` a ele deixaria duas declaracoes de `flex` na
                  mesma classe, e quem vence depende da ordem em que o Tailwind
                  emite as regras, nao da ordem que se escreve aqui. */}
              <div className="grid grid-cols-[1fr_auto] gap-2 pt-1">
                <button
                  type="button"
                  className={BOTAO_MARCA}
                  onClick={handleErpSubmit}
                  disabled={salvando}
                  data-testid="button-save-erp"
                >
                  <Save className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                  {editingErp ? "Salvar alterações" : "Cadastrar ERP"}
                </button>
                <button type="button" className={BOTAO_SECUNDARIO} onClick={fecharErpForm}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <section>
        <KickerSecao>Sistemas no catálogo</KickerSecao>

        {erpCatalogLoading ? (
          /* A forma do que vem, nunca um spinner no meio da área (seção 6). */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="p-4">
                <LinhasSkeleton linhas={2} />
              </Card>
            ))}
          </div>
        ) : total === 0 ? (
          <Card>
            <EstadoVazio
              Icone={Database}
              titulo="Nenhum ERP no catálogo"
              descricao="O catálogo é a lista de sistemas que o provedor pode escolher para integrar. Cadastre o primeiro para que ele apareça lá."
              cta={
                <button type="button" className={BOTAO_SECUNDARIO} onClick={abrirNovoErp}>
                  <Plus className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                  Cadastrar ERP
                </button>
              }
              testId="empty-erp-catalog"
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {erpCatalogList.map(erp => (
              /* Sem `opacity-60` no ERP inativo: contraste é não negociável
                 (seção 7), e quem informa o estado é o selo do rodapé. */
              <Card key={erp.id} className="p-4 flex flex-col" data-testid={`card-erp-${erp.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <LadrilhoErp nome={erp.name} logo={erp.logoBase64} testIdLogo={`img-erp-logo-${erp.id}`} />
                  <div className="flex gap-1 flex-none">
                    <BotaoIcone
                      Icone={Pencil}
                      rotulo={`Editar ${erp.name}`}
                      onClick={() => openEditErp(erp)}
                      testId={`button-edit-erp-${erp.id}`}
                    />
                    <BotaoIcone
                      Icone={Trash2}
                      tom="risco"
                      rotulo={`Remover ${erp.name}`}
                      onClick={() => { if (confirm(`Remover "${erp.name}"?`)) deleteErpMutation.mutate(erp.id); }}
                      testId={`button-delete-erp-${erp.id}`}
                    />
                  </div>
                </div>

                <h3 className={`${TITULO_CARTAO} mt-3`} data-testid={`text-erp-name-${erp.id}`}>
                  {erp.name}
                </h3>
                {erp.description && (
                  <p className="text-[12px] text-[var(--text-muted)] leading-snug mt-0.5" data-testid={`text-erp-desc-${erp.id}`}>
                    {erp.description}
                  </p>
                )}

                <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-[var(--border-faint)]">
                  <code
                    className="font-mono text-[11px] text-[var(--text-muted)] bg-[var(--surface-inset)] rounded px-1.5 py-0.5 truncate"
                    data-testid={`text-erp-key-${erp.id}`}
                  >
                    {erp.key}
                  </code>
                  <button
                    type="button"
                    className={BOTAO_SELO}
                    onClick={() => toggleErpActiveMutation.mutate({ id: erp.id, active: !erp.active })}
                    title={erp.active ? "Ocultar dos provedores" : "Exibir aos provedores"}
                    aria-label={`${erp.name}: ${erp.active ? "visível para os provedores" : "oculto para os provedores"}. Clique para alternar.`}
                    data-testid={`toggle-erp-status-${erp.id}`}
                  >
                    <Selo tom={erp.active ? "ok" : "neutro"}>{erp.active ? "Ativo" : "Inativo"}</Selo>
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
