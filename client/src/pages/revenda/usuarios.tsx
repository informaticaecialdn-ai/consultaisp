/**
 * /revenda/usuarios — a equipe da marca.
 *
 * Quem aparece aqui é gente do REVENDEDOR, não do provedor: são as contas que
 * entram pelo domínio próprio da marca e enxergam este painel. Usuário de
 * provedor cliente é outra lista, em outra tela (fase 2).
 *
 * ── A SENHA TEMPORÁRIA, E POR QUE ELA APARECE UMA VEZ SÓ ───────────────────
 *
 * Quem cria a conta é um terceiro, então a senha nasce no servidor e vem na
 * resposta do POST. Ela vive em estado local e some ao fechar a caixa: não
 * entra no cache do React Query (onde ficaria até a aba ser recarregada, ao
 * alcance de qualquer devtool aberta), não vai para a URL e não é relida. A
 * trilha `marca_eventos` também não a guarda — o serviço reda qualquer chave
 * com cara de credencial antes do INSERT.
 *
 * ── AS DUAS REMOÇÕES PROIBIDAS ─────────────────────────────────────────────
 *
 * Ninguém remove a própria conta, e ninguém remove a última. O servidor recusa
 * as duas; a tela desabilita o botão e escreve o motivo, porque um botão que só
 * o servidor recusa transforma a regra em toast de erro depois do clique. Ver
 * `motivoParaNaoRemover`.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest, type ErroDaApi } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  CabecalhoPainel, EstadoVazio, LinhasSkeleton, AvisoNaoCarregou, MolduraModal,
  TabelaPainel, Th, Td, Selo, Campo, BotaoIcone, LadrilhoInicial, LadrilhoIcone,
  TITULO_MODAL, TITULO_CARTAO, CONTROLE_CAMPO, BOTAO_MARCA, BOTAO_SECUNDARIO,
  DESABILITAVEL, FOCO,
} from "@/components/painel/ui";
import { Users, UserPlus, Trash2, Copy, Check, KeyRound, Loader2, AlertTriangle } from "lucide-react";
import {
  motivoParaNaoRemover, problemasDoConvite, dataDeEntrada, type PessoaDaEquipe,
} from "./equipe";

/** O que o `POST /api/revenda/usuarios` devolve. A senha só existe aqui. */
type ConviteCriado = {
  usuario: PessoaDaEquipe;
  /** Gerada no servidor. Mostrada uma vez e descartada. */
  senhaTemporaria: string;
  /**
   * O `https://<domínio da marca>/login`, ou `null` enquanto o domínio não
   * estiver ativo. Vale mostrar ao lado da senha: quem convida precisa passar
   * as duas coisas, e o endereço de entrada do revendedor NÃO é a raiz da
   * plataforma — lá o login dele é recusado, com mensagem genérica.
   */
  urlDeAcesso: string | null;
  /**
   * Se o e-mail de convite saiu. O envio é best-effort (o membro já existe
   * quando ele sai), então a tela precisa saber a diferença entre "a pessoa já
   * recebeu o endereço" e "só você tem como avisá-la".
   */
  emailEnviado: boolean;
};

export default function EquipeDaRevenda() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const meuId = user?.id ?? null;

  const lista = useQuery<PessoaDaEquipe[]>({
    queryKey: ["/api/revenda/usuarios"],
    staleTime: 60_000,
  });
  const equipe = lista.data ?? [];

  const [abrindoConvite, setAbrindoConvite] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [criada, setCriada] = useState<ConviteCriado | null>(null);
  const [aRemover, setARemover] = useState<PessoaDaEquipe | null>(null);
  const [copiada, setCopiada] = useState(false);

  const problemas = problemasDoConvite({ nome, email });
  const podeEnviar = Object.keys(problemas).length === 0;

  function fecharConvite() {
    setAbrindoConvite(false);
    setNome("");
    setEmail("");
  }

  const criar = useMutation({
    mutationFn: async (): Promise<ConviteCriado> => {
      const res = await apiRequest("POST", "/api/revenda/usuarios", {
        name: nome.trim(),
        email: email.trim(),
      });
      return res.json();
    },
    onSuccess: (resposta) => {
      fecharConvite();
      setCopiada(false);
      setCriada(resposta);
      qc.invalidateQueries({ queryKey: ["/api/revenda/usuarios"] });
    },
    onError: (erro: ErroDaApi) => {
      toast({
        variant: "destructive",
        title: "Ninguém foi adicionado",
        /* 409 é o caso comum: e-mail já usado em alguma conta do sistema. A
           frase vem do servidor, que é quem sabe qual foi a colisão — e o
           `status` está no erro como campo desde a fase 0, sem procurar
           substring em mensagem. */
        description: erro.message || "Não foi possível criar o acesso. Tente de novo.",
      });
    },
  });

  const remover = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/revenda/usuarios/${id}`),
    onSuccess: () => {
      setARemover(null);
      toast({ title: "Acesso removido", description: "A pessoa não entra mais no painel da marca." });
      qc.invalidateQueries({ queryKey: ["/api/revenda/usuarios"] });
    },
    onError: (erro: ErroDaApi) => {
      setARemover(null);
      toast({
        variant: "destructive",
        title: "Nada foi removido",
        description: erro.message || "Não foi possível remover este acesso. Tente de novo.",
      });
    },
  });

  async function copiarSenha(senha: string) {
    try {
      await navigator.clipboard.writeText(senha);
      setCopiada(true);
    } catch {
      /* `navigator.clipboard` não existe fora de contexto seguro, e o navegador
         pode negar a permissão. Falhar em silêncio faria o operador achar que
         copiou — e ele fecharia a caixa com a senha que não foi a lugar nenhum. */
      toast({
        title: "Copie manualmente",
        description: "O navegador não liberou a área de transferência. Selecione a senha e copie.",
      });
    }
  }

  return (
    <div className="p-4 lg:p-6 pb-10 max-w-[900px] mx-auto space-y-6" data-testid="revenda-usuarios">
      <CabecalhoPainel
        titulo="Equipe"
        descricao="Quem entra no painel da sua marca. Cada pessoa recebe uma senha temporária e é obrigada a trocá-la no primeiro acesso."
        testIdTitulo="text-equipe-titulo"
        acoes={
          <button
            type="button"
            className={BOTAO_MARCA}
            onClick={() => setAbrindoConvite(true)}
            data-testid="button-nova-pessoa"
          >
            <UserPlus className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
            Adicionar pessoa
          </button>
        }
      />

      {lista.isError && (
        <AvisoNaoCarregou aoTentarDeNovo={() => lista.refetch()} testId="aviso-equipe-falhou">
          A equipe não carregou. Ninguém foi adicionado nem removido — é só a leitura que falhou.
        </AvisoNaoCarregou>
      )}

      <Card className="p-0 overflow-hidden">
        {lista.isLoading ? (
          <div className="p-4">
            <LinhasSkeleton linhas={3} />
          </div>
        ) : equipe.length === 0 ? (
          /* Na prática não acontece — você está logado, logo existe ao menos uma
             conta. Fica de pé para o caso de a leitura voltar vazia por engano:
             uma tabela sem linhas e sem explicação parece defeito. */
          <EstadoVazio
            Icone={Users}
            titulo="Nenhuma conta na equipe"
            descricao="Adicione as pessoas que vão acompanhar os provedores da sua marca. Cada uma entra pelo endereço próprio da marca, com senha própria."
            testId="vazio-equipe"
            cta={
              <button type="button" className={BOTAO_MARCA} onClick={() => setAbrindoConvite(true)}>
                <UserPlus className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />
                Adicionar pessoa
              </button>
            }
          />
        ) : (
          <TabelaPainel testId="tabela-equipe">
            <thead>
              <tr>
                <Th>pessoa</Th>
                <Th>situação</Th>
                <Th alinhamento="esquerda">entrou em</Th>
                <Th alinhamento="direita">ações</Th>
              </tr>
            </thead>
            <tbody>
              {equipe.map(pessoa => {
                const impedimento = motivoParaNaoRemover({
                  alvoId: pessoa.id,
                  meuId,
                  totalDaEquipe: equipe.length,
                });
                return (
                  <tr key={pessoa.id} data-testid={`pessoa-${pessoa.id}`}>
                    <Td>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <LadrilhoInicial nome={pessoa.name} forma="avatar" tamanho="sm" />
                        <div className="min-w-0">
                          <p className="text-[12.5px] text-[var(--text)] truncate">
                            {pessoa.name}
                            {pessoa.id === meuId && (
                              <span className="text-[var(--text-muted)]"> · você</span>
                            )}
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)] truncate">{pessoa.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {pessoa.mustChangePassword
                        ? <Selo tom="gated" testId={`selo-provisoria-${pessoa.id}`}>senha provisória</Selo>
                        : <Selo tom="ok">ativa</Selo>}
                    </Td>
                    <Td num alinhamento="esquerda" className="whitespace-nowrap text-[var(--text-muted)]">
                      {dataDeEntrada(pessoa.createdAt)}
                    </Td>
                    <Td alinhamento="direita">
                      <div className="flex items-center justify-end gap-1">
                        {/* `title` do BotaoIcone recebe o motivo: é o único
                            lugar onde a regra cabe numa linha de tabela sem
                            empurrar a coluna de dado para fora da tela. */}
                        <BotaoIcone
                          Icone={Trash2}
                          tom="risco"
                          rotulo={impedimento ?? `Remover o acesso de ${pessoa.name}`}
                          disabled={Boolean(impedimento) || remover.isPending}
                          onClick={() => setARemover(pessoa)}
                          testId={`button-remover-${pessoa.id}`}
                        />
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TabelaPainel>
        )}
      </Card>

      {/* A regra escrita por extenso, fora do `title`: quem navega por teclado
          ou leitor de tela não passa o mouse em botão desabilitado. */}
      {equipe.length === 1 && (
        <p className="text-[11.5px] text-[var(--text-muted)] leading-snug" data-testid="nota-ultima-pessoa">
          Esta é a única conta com acesso à marca, por isso ela não pode ser removida. Adicione
          outra pessoa antes de remover esta — marca sem nenhuma conta só volta pelo suporte da
          plataforma.
        </p>
      )}

      {/* ── Adicionar pessoa ─────────────────────────────────────────── */}
      {abrindoConvite && (
        <MolduraModal rotulo="Adicionar pessoa à equipe" onFechar={fecharConvite}>
          <h2 className={TITULO_MODAL}>
            <UserPlus className="w-4 h-4 flex-none text-[var(--brand)]" strokeWidth={2} aria-hidden />
            Adicionar pessoa
          </h2>
          <p className="text-[12px] text-[var(--text-muted)] mt-1.5 leading-snug">
            A senha temporária é gerada agora e aparece uma única vez, na tela seguinte.
          </p>

          <div className="space-y-3 mt-4">
            <div>
              <Campo rotulo="nome">
                <Input
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  placeholder="Ana Prado"
                  className={CONTROLE_CAMPO}
                  maxLength={200}
                  autoFocus
                />
              </Campo>
              {problemas.nome && nome !== "" && (
                <p className="text-[11px] text-[var(--danger)] mt-1">{problemas.nome}</p>
              )}
            </div>
            <div>
              <Campo rotulo="e-mail de acesso">
                <Input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  type="email"
                  placeholder="ana@crednet.com.br"
                  className={CONTROLE_CAMPO}
                  maxLength={254}
                />
              </Campo>
              {problemas.email && email !== "" && (
                <p className="text-[11px] text-[var(--danger)] mt-1">{problemas.email}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button type="button" className={BOTAO_SECUNDARIO} onClick={fecharConvite}>
              Cancelar
            </button>
            <button
              type="button"
              className={cn(BOTAO_MARCA, DESABILITAVEL)}
              disabled={!podeEnviar || criar.isPending}
              onClick={() => criar.mutate()}
              data-testid="button-confirmar-pessoa"
            >
              {criar.isPending && (
                <Loader2 className="w-3.5 h-3.5 flex-none motion-safe:animate-spin" strokeWidth={2} aria-hidden />
              )}
              Criar acesso
            </button>
          </div>
        </MolduraModal>
      )}

      {/* ── A senha, uma vez só ──────────────────────────────────────── */}
      {criada && (
        <MolduraModal
          rotulo="Senha temporária criada"
          onFechar={() => { setCriada(null); setCopiada(false); }}
        >
          <h2 className={TITULO_MODAL}>
            <KeyRound className="w-4 h-4 flex-none text-[var(--brand)]" strokeWidth={2} aria-hidden />
            Acesso criado
          </h2>
          <p className="text-[12px] text-[var(--text-muted)] mt-1.5 leading-snug">
            Entregue esta senha a <span className="text-[var(--text-2)]">{criada.usuario.name}</span>.
            {criada.emailEnviado
              ? " O e-mail de convite já saiu, com o endereço de entrada — mas ele não leva a senha, e por isso ela está aqui."
              : " O e-mail de convite NÃO saiu, então o endereço de entrada também precisa ir por você."}
            {" "}O sistema exige a troca da senha no primeiro acesso.
          </p>

          {/* O endereço vale tanto quanto a senha: o login do revendedor é
              recusado na raiz da plataforma e no subdomínio de qualquer
              provedor, com mensagem genérica de propósito. Quem convida tem de
              passar os dois. */}
          {criada.urlDeAcesso && (
            <p className="text-[12px] text-[var(--text-muted)] mt-1.5 leading-snug">
              Endereço de entrada:{" "}
              <span className="font-mono text-[var(--text-2)] break-all" data-testid="text-url-de-acesso">
                {criada.urlDeAcesso}
              </span>
            </p>
          )}

          <div className="mt-4 rounded border border-[var(--border-strong)] bg-[var(--surface-inset)] p-3">
            <p className="font-mono text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">
              {criada.usuario.email}
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              {/* `select-all` para quem não pode usar a área de transferência
                  conseguir marcar a senha inteira com um clique. */}
              <code
                className="font-mono tabular-nums text-[15px] text-[var(--text)] select-all break-all"
                data-testid="text-senha-temporaria"
              >
                {criada.senhaTemporaria}
              </code>
              <button
                type="button"
                className={cn(
                  "ml-auto inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11.5px]",
                  "text-[var(--text-2)] hover:bg-[var(--surface-3)] flex-none",
                  "[@media(pointer:coarse)]:min-h-11", FOCO,
                )}
                onClick={() => copiarSenha(criada.senhaTemporaria)}
                data-testid="button-copiar-senha"
              >
                {copiada
                  ? <><Check className="w-3.5 h-3.5 flex-none text-[var(--ok)]" strokeWidth={2} aria-hidden />copiada</>
                  : <><Copy className="w-3.5 h-3.5 flex-none" strokeWidth={2} aria-hidden />copiar</>}
              </button>
            </div>
          </div>

          <div className="flex gap-2 items-start rounded p-2.5 mt-3 bg-[var(--gated-bg)] border border-[var(--gated-border)]">
            <AlertTriangle className="w-4 h-4 text-[var(--gated)] flex-none mt-0.5" strokeWidth={2} aria-hidden />
            <p className="text-[12px] text-[var(--gated)] leading-relaxed">
              Esta senha não é guardada e não será mostrada de novo. Se ela se perder, remova o
              acesso e crie outro.
            </p>
          </div>

          <div className="flex justify-end mt-5">
            <button
              type="button"
              className={BOTAO_MARCA}
              onClick={() => { setCriada(null); setCopiada(false); }}
              data-testid="button-fechar-senha"
            >
              Anotei, fechar
            </button>
          </div>
        </MolduraModal>
      )}

      {/* ── Remover ──────────────────────────────────────────────────── */}
      {aRemover && (
        <MolduraModal rotulo="Remover acesso da equipe" onFechar={() => setARemover(null)}>
          <div className="flex items-start gap-3">
            <LadrilhoIcone Icone={Trash2} tom="risco" />
            <div className="min-w-0">
              <h2 className={TITULO_CARTAO}>Remover o acesso de {aRemover.name}?</h2>
              <p className="text-[12px] text-[var(--text-muted)] mt-1 leading-snug">
                <span className="font-mono">{aRemover.email}</span> deixa de entrar no painel da
                marca imediatamente. Os registros do que essa pessoa fez continuam na trilha da
                marca — a remoção não apaga histórico.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setARemover(null)}>
              Manter acesso
            </button>
            <button
              type="button"
              className={cn(
                BOTAO_SECUNDARIO, DESABILITAVEL,
                "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
                "hover:bg-[var(--danger-bg)] hover:border-[var(--danger)]",
              )}
              disabled={remover.isPending}
              onClick={() => remover.mutate(aRemover.id)}
              data-testid="button-confirmar-remocao"
            >
              {remover.isPending && (
                <Loader2 className="w-3.5 h-3.5 flex-none motion-safe:animate-spin" strokeWidth={2} aria-hidden />
              )}
              Remover acesso
            </button>
          </div>
        </MolduraModal>
      )}
    </div>
  );
}
