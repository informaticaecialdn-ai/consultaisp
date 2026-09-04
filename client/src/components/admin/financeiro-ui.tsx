/**
 * Vocabulário comum das TRÊS telas financeiras do superadmin.
 *
 * POR QUE ESTE ARQUIVO EXISTE, E POR QUE ELE MORA AQUI
 *
 * `pages/admin/admin-financeiro.tsx` (a página) e `components/admin/tabs/
 * FinanceiroTab.tsx` (a aba do painel do sistema) cobrem o mesmo assunto e
 * carregavam as MESMAS peças escritas duas vezes. Os dois modais do Asaas —
 * "Cobrar via Asaas" e "QR Code PIX" — eram iguais no texto e no layout e
 * divergiam no resto: um tinha `role="dialog"` e o outro não, um chamava o
 * boleto de cartão e o outro de código de barras, e o título saía em dois
 * corpos tipográficos diferentes. Dinheiro, chip de filtro e altura de campo
 * também tinham duas versões. Duas telas do mesmo painel contando a mesma
 * coisa de dois jeitos é o defeito que a rodada de linguagem existia para
 * eliminar — e ele voltou pelo caminho de sempre: faltava um lugar comum.
 *
 * A TERCEIRA TELA, E O DEFEITO QUE ELA REVELOU
 *
 * O arquivo nasceu desenhado para DUAS telas, e `pages/admin/admin-creditos.tsx`
 * — que cobra pedido de crédito pelo MESMO gateway, com a MESMA lista filtrada e
 * o MESMO formulário de emissão — ficou de fora. O resultado foi o padrão de
 * sempre, uma camada acima: os dois modais do Asaas voltaram a existir em
 * triplicata, com a terceira cópia divergindo em título (13,5px contra 15px),
 * padding (24px contra 20px), acessibilidade (sem `role`, sem `aria-modal`,
 * sem `aria-label`), no `data-testid` das opções de cobrança e num QR Code
 * cinza de enfeite onde a versão compartilhada explica que o gateway não
 * devolveu a imagem. O chip de filtro tinha DOIS valores opostos, e cada lado
 * citava o DESIGN_SYSTEM para justificar o contrário. Um arquivo comum só
 * termina o serviço quando ele cobre todas as telas do assunto — e o assunto
 * aqui é "cobrança do superadmin", não "fatura do superadmin".
 *
 * O NOME CONTINUA VALENDO: `financeiro-ui` descreve o financeiro do painel do
 * superadmin, e pedido de crédito é financeiro do superadmin. O que cresceu foi
 * a cobertura, não o assunto.
 *
 * ONDE ELE MORA, E POR QUÊ. Três camadas, e esta é a do meio:
 *   1. `components/painel/ui.tsx` — vocabulário VISUAL, comum aos dois painéis
 *      (provedor e superadmin). Nada de domínio entra lá: cobrança do Asaas não
 *      é assunto do painel do provedor, e empurrar isso para a primitiva
 *      compartilhada obrigaria o outro painel a carregar regra que não é dele.
 *   2. ESTE arquivo — vocabulário do FINANCEIRO do superadmin: o que as duas
 *      telas financeiras, e só elas, precisam falar igual.
 *   3. As duas telas — o que é de cada uma.
 * Fica em `components/admin/` porque é onde o painel do superadmin já guarda o
 * que suas telas compartilham (`InvoiceTable`, `constants`), e o nome em
 * minúsculas com hífen acompanha os outros módulos não-componente da pasta.
 *
 * A RODADA DE CONSOLIDAÇÃO, E OS TRÊS HOMÔNIMOS QUE ELA MATOU
 *
 * O padrão voltou uma camada acima: desta vez a divergência estava DENTRO deste
 * arquivo, contra a primitiva de painel.
 *
 *   1. `CONTROLE_CAMPO` existia AQUI e em `painel/ui.tsx`, com o mesmo nome e
 *      valores diferentes — e era esta cópia, sem anel de foco e sem o padding
 *      horizontal, que as três telas financeiras importavam. Ou seja, campo e
 *      seletor delas ficavam sem foco visível, que a §7 chama de não
 *      negociável, e o defeito era invisível na revisão porque o símbolo
 *      importado tinha o nome certo. A definição agora é uma só, na primitiva;
 *      aqui ela é apenas REEXPORTADA, para as três telas ganharem o anel sem
 *      precisarem ser tocadas.
 *   2. `MolduraModal` e `TITULO_MODAL` eram PRIVADOS deste arquivo. O efeito
 *      foi que a acessibilidade dos dois modais do Asaas — `role="dialog"`,
 *      `aria-modal`, `aria-label` — não chegou a nenhum outro modal do painel.
 *      Modal é vocabulário de painel, não de cobrança: subiram para a camada 1
 *      e este arquivo passou a consumi-los de lá.
 *   3. `Dinheiro` e `textoDeReal` nasceram aqui, e por morarem no vocabulário
 *      do FINANCEIRO DO SUPERADMIN as telas do painel do provedor não podiam
 *      consumi-los sem importar cobrança do Asaas junto — então reescreviam o
 *      formatador. Eram quatro formatadores de real no produto. Formatar
 *      dinheiro é apresentação de número, não assunto de cobrança: subiu para a
 *      camada 1, e aqui fica a reexportação.
 *
 * O que sobrou neste arquivo é o que de fato só o financeiro do superadmin
 * fala: o chip de filtro de cobrança e os dois modais do Asaas.
 *
 * AS DECISÕES DE DESEMPATE, uma a uma, estão no comentário de cada peça.
 * Nenhuma delas muda rota, consulta, permissão, dado ou `data-testid`.
 */
import * as React from "react";
import { Wallet, QrCode, ScanLine, Copy, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  BotaoIcone,
  Dinheiro,
  LadrilhoIcone,
  MolduraModal,
  RotuloCampo,
  ALVO_CONTROLE,
  BOTAO_SECUNDARIO,
  DESABILITAVEL,
  FOCO,
  TITULO_MODAL,
} from "@/components/painel/ui";

/** REEXPORTAÇÃO, e não redefinição. As três telas financeiras importam estes
 *  três símbolos daqui desde antes de eles subirem para a primitiva; mantê-los
 *  visíveis neste endereço é o que permitiu unificar as definições sem tocar em
 *  nenhuma das três. Código novo deve importar de `@/components/painel/ui`. */
export { CONTROLE_CAMPO, Dinheiro, textoDeReal } from "@/components/painel/ui";

/* ------------------------------------------------------------------ */
/* Chip de filtro                                                      */
/* ------------------------------------------------------------------ */

/** Filtro de situação de uma lista de cobranças (faturas, pedidos de crédito).
 *
 *  A ARBITRAGEM DO CHIP ATIVO — o caso em que os dois lados citavam o
 *  DESIGN_SYSTEM para dizer o contrário um do outro.
 *
 *  A tese da marca cheia era a §3.4: o mapa de uso dá `--brand` ao "CTA, link,
 *  aba ativa, item de nav selecionado", e um filtro escolhido é estado ativo. A
 *  tese do soft era a §3.1, que descreve `--brand-soft` como "item ativo de nav,
 *  chip de marca".
 *
 *  VENCE O SOFT, por três razões nesta ordem:
 *  1. A §3.4 mapeia FAMÍLIA de token (marca contra semântica), não intensidade —
 *     ela responde "qual cor", e as duas leituras usam a mesma. Quem responde
 *     "quão cheia" é a §3.1, e ali `--brand-soft` está nomeado, com todas as
 *     letras, como o fundo de chip de marca e de item ativo. O token mais
 *     específico ganha do mapa geral.
 *  2. A §3 abre a paleta com "uma cor de marca só… saturação apenas quando
 *     significa risco". A marca cheia é a voz do CTA — a §6 a reserva ao
 *     `.btn-primary`, e é o que `BOTAO_MARCA` já veste. As três telas põem a
 *     barra de filtros na mesma linha, ou logo acima, de um botão cheio de marca
 *     ("Nova fatura", "Novo pedido"): dois cheios disputando a mesma atenção, e o
 *     filtro escolhido não é a ação principal de nenhuma delas.
 *  3. O chip ativo é ESTADO, e não convite. Pintado como CTA, ele promete uma
 *     ação a quem já está nela.
 *
 *  O par soft ainda carrega a borda de `--brand-soft`, e não de `--border`: sem
 *  ela o chip ativo encolhe um pixel em relação aos vizinhos e a fila desalinha.
 *
 *  `contagem` é opcional porque as telas contam coisas diferentes (uma não
 *  mostra número no "Todas"), e contagem é dado — não se unifica aqui. */
export function ChipFiltro({
  ativo,
  contagem,
  onClick,
  testId,
  children,
}: {
  ativo: boolean;
  contagem?: number;
  onClick: () => void;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      className={cn(
        ALVO_CONTROLE,
        "inline-flex items-center gap-1.5 px-3 rounded text-[12.5px] font-medium border motion-safe:transition-colors",
        FOCO,
        ativo
          ? "bg-[var(--brand-soft)] text-[var(--brand-ink)] border-[var(--brand-soft)]"
          : "bg-[var(--surface)] text-[var(--text-2)] border-[var(--border-strong)] hover:bg-[var(--surface-2)]",
      )}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
      {contagem !== undefined && (
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums",
            ativo ? "text-[var(--brand-ink)]" : "text-[var(--text-faint)]",
          )}
        >
          {contagem}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Modais do Asaas                                                     */
/* ------------------------------------------------------------------ */

/* A casca (`MolduraModal`) e o título (`TITULO_MODAL`) eram privados daqui e
   hoje vêm da primitiva de painel — ver o item 2 do cabeçalho deste arquivo.
   O que continua sendo assunto exclusivo do financeiro é o que vai DENTRO
   deles: as formas de cobrança do Asaas e o QR Code do PIX. */

/** As três formas de cobrar.
 *
 *  O BOLETO usa `ScanLine` (código de barras) e não `CreditCard`: boleto não é
 *  cartão, e o ícone de cartão já significa "créditos" em outro cartão da mesma
 *  tela — um desenho não pode nomear duas coisas no mesmo painel.
 *
 *  "Livre — o provedor escolhe" com travessão, e não entre parênteses: a §8 pede
 *  frase direta, e o parêntese sussurra a metade que explica a escolha. */
const FORMAS_DE_COBRANCA = [
  { tipo: "UNDEFINED", rotulo: "Livre — o provedor escolhe", Icone: Wallet },
  { tipo: "PIX", rotulo: "PIX", Icone: QrCode },
  { tipo: "BOLETO", rotulo: "Boleto bancário", Icone: ScanLine },
] as const;

/** Escolha da forma de cobrança no Asaas — de uma fatura ou de um pedido de
 *  crédito.
 *
 *  `rotuloDoDocumento` existe porque a terceira tela cobra PEDIDO, e não fatura:
 *  a peça é a mesma, o substantivo é que muda. O padrão é "Fatura", que é o que
 *  as duas telas de fatura já diziam.
 *
 *  `valor` é opcional porque só a tela de pedidos mostra quanto está sendo
 *  cobrado nesta caixa — nas de fatura o valor já está na linha de onde o modal
 *  foi aberto, e repeti-lo seria ruído. Quando vem, passa por `<Dinheiro>`: um
 *  "R$" escrito à mão ao lado de um número não-tabular era o defeito da cópia.
 *
 *  `data-testid` de cada opção: `button-charge-undefined` | `-pix` | `-boleto`.
 *  A terceira tela emitia `button-modal-charge-*` e passou a emitir estes — ver
 *  a decisão registrada em `admin-creditos.tsx`. */
export function ModalCobrancaAsaas({
  numeroDaFatura,
  rotuloDoDocumento = "Fatura",
  valor,
  emAndamento,
  onEscolher,
  onFechar,
}: {
  /** O número do documento cobrado. O nome do parâmetro é anterior à terceira
   *  tela e ficou mais estreito do que o que ele carrega — ver o aviso da
   *  entrega; renomear exige tocar os três pontos de chamada de uma vez. */
  numeroDaFatura: string;
  rotuloDoDocumento?: string;
  valor?: unknown;
  emAndamento: boolean;
  onEscolher: (formaDeCobranca: string) => void;
  onFechar: () => void;
}) {
  return (
    <MolduraModal rotulo="Cobrar via Asaas" onFechar={onFechar}>
      <h2 className={TITULO_MODAL}>
        <Wallet className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
        Cobrar via Asaas
      </h2>
      <p className="text-[12px] text-[var(--text-muted)] mb-4 mt-0.5">
        {rotuloDoDocumento}{" "}
        <span className="font-mono tabular-nums text-[var(--text-2)]">{numeroDaFatura}</span>
        {valor !== undefined && valor !== null && (
          <>
            {" · "}
            <Dinheiro valor={valor} className="text-[var(--text-2)]" />
          </>
        )}
      </p>
      <div className="space-y-2">
        {FORMAS_DE_COBRANCA.map(forma => (
          <button
            key={forma.tipo}
            type="button"
            className={cn(
              ALVO_CONTROLE,
              DESABILITAVEL,
              "w-full flex items-center gap-3 px-4 py-3 rounded text-left text-[13px] font-medium text-[var(--text)]",
              "bg-[var(--surface)] border border-[var(--border-strong)] hover:bg-[var(--surface-2)] motion-safe:transition-colors",
              FOCO,
            )}
            disabled={emAndamento}
            onClick={() => onEscolher(forma.tipo)}
            data-testid={`button-charge-${forma.tipo.toLowerCase()}`}
          >
            {emAndamento ? (
              <RefreshCw
                className="w-4 h-4 flex-none text-[var(--text-faint)] motion-safe:animate-spin"
                strokeWidth={2}
              />
            ) : (
              <forma.Icone className="w-4 h-4 flex-none text-[var(--text-faint)]" strokeWidth={2} />
            )}
            {forma.rotulo}
          </button>
        ))}
      </div>
      <button type="button" className={cn(BOTAO_SECUNDARIO, "w-full mt-3")} onClick={onFechar}>
        Cancelar
      </button>
    </MolduraModal>
  );
}

/** QR Code do PIX de uma fatura já cobrada no Asaas.
 *
 *  SEM IMAGEM, A TELA DIZ ISSO. Uma das cópias mostrava um quadrado cinza com o
 *  desenho de um QR Code quando o gateway não devolvia a imagem — um placeholder
 *  mudo que se parece com o dado que falta. Vence a que explica: ladrilho de
 *  risco (§: porta fechada) mais a frase. */
export function ModalPixAsaas({
  pix,
  onFechar,
}: {
  pix: { encodedImage?: string; payload?: string } | null | undefined;
  onFechar: () => void;
}) {
  const { toast } = useToast();
  return (
    <MolduraModal rotulo="QR Code PIX" centralizado onFechar={onFechar}>
      <h2 className={cn(TITULO_MODAL, "justify-center")}>
        <QrCode className="w-4 h-4 text-[var(--text-faint)] flex-none" strokeWidth={2} />
        QR Code PIX
      </h2>
      {pix?.encodedImage ? (
        <img
          src={`data:image/png;base64,${pix.encodedImage}`}
          alt="QR Code PIX da fatura"
          className="mx-auto w-48 h-48 my-4 rounded-lg border border-[var(--border)]"
        />
      ) : (
        <div className="w-48 h-48 mx-auto my-4 rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] flex flex-col items-center justify-center gap-2 px-4">
          <LadrilhoIcone Icone={QrCode} tom="risco" tamanho="lg" />
          <p className="text-[12px] text-[var(--text-muted)] leading-snug">
            O Asaas não devolveu a imagem do QR Code para esta fatura.
          </p>
        </div>
      )}
      {pix?.payload && (
        <div className="mt-2 text-left">
          <RotuloCampo>código copia e cola</RotuloCampo>
          <div className="flex gap-2 items-center">
            <code className="font-mono text-[11px] bg-[var(--surface-inset)] text-[var(--text-2)] rounded px-2 py-1.5 flex-1 min-w-0 truncate">
              {pix.payload}
            </code>
            <BotaoIcone
              Icone={Copy}
              rotulo="Copiar o código PIX"
              onClick={() => {
                navigator.clipboard.writeText(pix.payload!);
                /* "Copiado!" saiu: a §8 proíbe exclamação, e o aviso fica mais
                   útil dizendo O QUE foi copiado. */
                toast({ title: "Código copiado" });
              }}
              testId="button-copy-pix"
            />
          </div>
        </div>
      )}
      <button type="button" className={cn(BOTAO_SECUNDARIO, "w-full mt-3")} onClick={onFechar}>
        Fechar
      </button>
    </MolduraModal>
  );
}
