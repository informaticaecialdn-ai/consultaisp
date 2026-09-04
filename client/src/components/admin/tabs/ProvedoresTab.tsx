import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, STALE_LISTS } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  Plus, Search, SearchX, Ban, CheckCircle, Globe, Users, ChevronRight, Building2,
} from "lucide-react";
import {
  Selo, EstadoVazio, LinhasSkeleton, TITULO_CARTAO, LadrilhoInicial,
  ALVO_CONTROLE, BOTAO_SECUNDARIO, BOTAO_MARCA, DESABILITAVEL,
} from "@/components/painel/ui";
import { PLAN_LABELS } from "../constants";
import { acaoReativarProvedor, acaoSuspenderProvedor, type AcaoProvedor } from "../acoes-provedor";
import NewProviderWizard from "../NewProviderWizard";
import ProviderDrawer from "../ProviderDrawer";

/**
 * Lista de provedores do superadmin, vestida na MESMA linguagem do Painel do
 * Provedor — a rodada e de VOCABULARIO VISUAL. Nenhuma rota, queryKey,
 * permissao, data-testid ou regra mudou aqui; o que mudou e que a tela agora
 * fala por `@/components/painel/ui` em vez de repetir classes proprias e a API
 * antiga de token (a familia `color`), que era o que fazia os dois paineis nao
 * parecerem o mesmo produto.
 *
 * O molde e `tabs/VisaoGeralTab.tsx`, a primeira aba traduzida: cabecalho de
 * cartao em `--surface-2`, linhas separadas por `--border-faint`, avatar em
 * `--surface-inset`, todo numero em mono tabular.
 *
 * TRES ESTADOS DE LISTA, e nao um. A versao anterior tinha carregamento
 * (spinner centralizado, proibido pela secao 6) e mais nada: lista vazia
 * renderizava um cartao em branco, e busca sem resultado renderizava o mesmo
 * cartao em branco. Sao situacoes diferentes e agora dizem coisas diferentes —
 * "ainda nao ha provedor" tem CTA de cadastro, "a busca nao achou" tem CTA de
 * limpar a busca.
 */

/** SITUACAO DO PROVEDOR, em portugues (secao 8: nada de valor cru de banco).
 *
 *  `providers.status` e TEXT livre; o produto escreve 'active', 'suspended' e
 *  'cancelled'. Um quarto valor (linha antiga, escrita por fora) cai no ramo
 *  desconhecido, que nao afirma saude nem bloqueio que ninguem mediu.
 *
 *  Só `active` acende o ponto: o dot e o unico `rounded-full` permitido — e um
 *  ponto de status, nao um badge. */
const SITUACAO: Record<string, string> = {
  active: "Ativo",
  suspended: "Suspenso",
  cancelled: "Cancelado",
};

const SITUACAO_DESCONHECIDA = "Situação desconhecida";

/** Concordancia de numero. "1 provedor(es)" e o tipo de texto que denuncia que
 *  ninguem leu a tela em voz alta. */
function plural(n: number, um: string, muitos: string) {
  return n === 1 ? um : muitos;
}

/** Botao de acao com cor de estado. Nasce da primitiva — geometria, alvo de
 *  toque e anel de foco vem de `BOTAO_SECUNDARIO`, e so a tinta e trocada
 *  (`cn` faz o merge, entao a cor base nao briga com a semantica).
 *
 *  Suspender e reativar SAO risco e liberacao de acesso, que e exatamente o
 *  eixo onde a secao 3 autoriza saturacao. */
function botaoDeAcao(tom: "danger" | "ok") {
  return cn(
    BOTAO_SECUNDARIO,
    tom === "danger"
      ? "text-[var(--danger)] hover:bg-[var(--danger-bg)]"
      : "text-[var(--ok)] hover:bg-[var(--ok-bg)]",
    DESABILITAVEL,
  );
}

export default function ProvedoresTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [providerSearch, setProviderSearch] = useState("");
  const [showNewProvider, setShowNewProvider] = useState(false);
  const [drawerProviderId, setDrawerProviderId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: allProviders = [], isLoading: providersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/providers"],
    staleTime: STALE_LISTS,
  });

  // Este controle bloqueia o acesso; ele NAO apaga o provedor. A exclusao
  // definitiva (DELETE, cascata sem desfazer) vive na aba Cadastros, com o
  // rotulo e o aviso dela. Ver client/src/components/admin/acoes-provedor.ts.
  const statusMutation = useMutation({
    mutationFn: async (acao: AcaoProvedor) => {
      const res = await apiRequest(acao.metodo, acao.caminho, acao.corpo);
      if (!res.ok) throw new Error((await res.json()).message);
      return { acao, body: await res.json() };
    },
    onSuccess: ({ acao }) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      toast({ title: acao.sucesso });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const executar = (acao: AcaoProvedor) => {
    if (acao.confirmacao && !confirm(acao.confirmacao)) return;
    statusMutation.mutate(acao);
  };

  const filteredProviders = allProviders.filter((p: any) =>
    p.name.toLowerCase().includes(providerSearch.toLowerCase()) ||
    (p.subdomain || "").toLowerCase().includes(providerSearch.toLowerCase())
  );

  const openDrawer = (id: number) => {
    setDrawerProviderId(id);
    setDrawerOpen(true);
  };

  const buscando = providerSearch.trim().length > 0;
  const filtrando = buscando && filteredProviders.length !== allProviders.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-faint)] pointer-events-none"
            strokeWidth={2}
            aria-hidden
          />
          {/* ALVO_CONTROLE tambem no campo: no dedo, o alvo sobe para 44px
              (secao 7, nao negociavel); no mouse a densidade fica. */}
          <Input
            placeholder="Buscar por nome ou subdomínio"
            className={`pl-9 ${ALVO_CONTROLE}`}
            value={providerSearch}
            onChange={(e) => setProviderSearch(e.target.value)}
            data-testid="input-search-provider"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowNewProvider(!showNewProvider)}
          className={BOTAO_MARCA}
          data-testid="button-new-provider"
        >
          <Plus className="w-4 h-4 flex-none" strokeWidth={2} aria-hidden />
          Novo provedor
        </button>
      </div>

      <NewProviderWizard open={showNewProvider} onOpenChange={setShowNewProvider} />
      <ProviderDrawer providerId={drawerProviderId} open={drawerOpen} onOpenChange={setDrawerOpen} />

      <Card className="p-0 overflow-hidden">
        {/* A contagem virou cabecalho do proprio cartao, no lugar da faixa cinza
            solta que flutuava acima dele — e o mesmo tratamento de
            "Integracoes ativas" no Painel Geral. Sob busca ele diz "N de M",
            porque o numero sozinho esconderia que a lista esta filtrada. */}
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <h3 className={`${TITULO_CARTAO} flex items-center gap-2`}>
            <Users className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} aria-hidden />
            Provedores cadastrados
            {!providersLoading && (
              <span
                className="font-mono text-[11px] font-normal tabular-nums text-[var(--text-muted)]"
                data-testid="text-provider-count"
              >
                {filtrando
                  ? `${filteredProviders.length} de ${allProviders.length}`
                  : `${filteredProviders.length} ${plural(filteredProviders.length, "provedor", "provedores")}`}
              </span>
            )}
          </h3>
        </div>

        {providersLoading ? (
          <div className="p-4">
            <LinhasSkeleton linhas={5} />
          </div>
        ) : allProviders.length === 0 ? (
          <EstadoVazio
            Icone={Building2}
            titulo="Nenhum provedor cadastrado"
            descricao="Assim que o primeiro provedor entrar — pelo site ou cadastrado aqui — ele aparece nesta lista com plano, subdomínio e saldo."
            cta={
              <button
                type="button"
                className={BOTAO_SECUNDARIO}
                onClick={() => setShowNewProvider(true)}
                data-testid="button-empty-new-provider"
              >
                Cadastrar provedor
              </button>
            }
            testId="empty-provedores"
          />
        ) : filteredProviders.length === 0 ? (
          /* Busca sem resultado nao e lista vazia: ha provedores, so nenhum
             com este texto. Dizer "nenhum provedor cadastrado" aqui seria
             mentira, e o caminho de volta e limpar a busca. */
          <EstadoVazio
            Icone={SearchX}
            titulo="Nenhum provedor encontrado"
            descricao={<>A busca por “{providerSearch}” não encontrou nada em nome nem em subdomínio.</>}
            cta={
              <button
                type="button"
                className={BOTAO_SECUNDARIO}
                onClick={() => setProviderSearch("")}
                data-testid="button-clear-provider-search"
              >
                Limpar busca
              </button>
            }
            testId="empty-busca-provedores"
          />
        ) : (
          <div>
            {filteredProviders.map((p: any) => {
              const situacao = SITUACAO[p.status] ?? SITUACAO_DESCONHECIDA;
              const ativo = p.status === "active";
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-[var(--border-faint)] last:border-0 hover:bg-[var(--surface-2)] motion-safe:transition-colors"
                  data-testid={`admin-provider-row-${p.id}`}
                  onClick={() => openDrawer(p.id)}
                >
                  {/* Ladrilho de canto seco, e nao circulo: quem esta na linha
                      e uma empresa, e empresa nao tem rosto. A caixa alta da
                      inicial vem de dentro da primitiva — a copia daqui a
                      esquecia, e a mesma lista mostrava "A" e "j". */}
                  <LadrilhoInicial nome={p.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-[var(--text)] truncate">{p.name}</p>
                      {/* Ponto de situacao: o unico rounded-full permitido — e
                          um dot, nao um badge. So `Ativo` acende. */}
                      <span
                        className={`w-2 h-2 rounded-full flex-none ${ativo ? "bg-[var(--ok)]" : "bg-[var(--text-faint)]"}`}
                        title={situacao}
                      />
                      <span className="sr-only">{situacao}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap text-[12px] text-[var(--text-muted)]">
                      <span className="flex items-center gap-1 min-w-0">
                        <Globe className="w-3 h-3 flex-none" strokeWidth={2} aria-hidden />
                        <span className="font-mono truncate">{p.subdomain}.consultaisp.com.br</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3 flex-none" strokeWidth={2} aria-hidden />
                        <span className="font-mono tabular-nums">{p.userCount}</span>
                        {plural(p.userCount, "usuário", "usuários")}
                      </span>
                      {/* Saldo sem valor vira tracinho, nunca zero: "0 credito"
                          e uma afirmacao sobre dinheiro que a tela nao mediu. */}
                      <span>
                        créditos{" "}
                        <span className="font-mono tabular-nums text-[var(--text-2)]">{p.ispCredits ?? "—"}</span> ISP
                        {" · "}
                        <span className="font-mono tabular-nums text-[var(--text-2)]">{p.spcCredits ?? "—"}</span> SPC
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-none" onClick={(e) => e.stopPropagation()}>
                    {/* Contrato novo de `PLAN_LABELS`: o tom vem do catalogo e o
                        corpo do selo vem da primitiva. Chave fora do catalogo
                        cai na propria chave, que ao menos e verdade. */}
                    <Selo tom={PLAN_LABELS[p.plan]?.tom ?? "neutro"}>
                      {PLAN_LABELS[p.plan]?.label ?? p.plan}
                    </Selo>
                    {/* "Painel" deixou de ser botao cheio de marca: a linha
                        inteira ja abre a ficha, e um CTA saturado repetido em
                        toda linha da lista transforma a coluna de acao em
                        ruido. A acao continua a mesma. */}
                    <button
                      type="button"
                      className={BOTAO_SECUNDARIO}
                      onClick={() => openDrawer(p.id)}
                      data-testid={`button-painel-provider-${p.id}`}
                    >
                      <ChevronRight className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                      Painel
                    </button>
                    {ativo ? (
                      <button
                        type="button"
                        className={botaoDeAcao("danger")}
                        onClick={() => executar(acaoSuspenderProvedor(p.id, p.name))}
                        disabled={statusMutation.isPending}
                        data-testid={`button-suspend-provider-${p.id}`}
                      >
                        <Ban className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                        Suspender
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={botaoDeAcao("ok")}
                        onClick={() => executar(acaoReativarProvedor(p.id, p.name))}
                        disabled={statusMutation.isPending}
                        data-testid={`button-reactivate-provider-${p.id}`}
                      >
                        <CheckCircle className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                        Reativar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
