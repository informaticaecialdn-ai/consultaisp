/**
 * /importacao — a importação manual ACABOU (decisão do dono, 08/09/2026:
 * "tirar qq possibilidade de importação na mão... os dados têm que vir dos ERPs").
 *
 * Esta tela não importa nada. Ela existe porque o endereço existia: quem tem o
 * link salvo, o favorito ou a mensagem antiga merece ler POR QUE a porta fechou
 * e para onde ir — não cair num painel em branco nem ser jogado no dashboard
 * sem explicação.
 *
 * O que saiu junto: a página das três abas de planilha, as três rotas de
 * importação, o `ImportStorage` inteiro, a rota de criação de cliente por API
 * (escrita sem tela e sem validação) e o diálogo de planilha dos equipamentos.
 * A lista completa e a trava que impede a volta estão em
 * `server/sem-importacao-manual.test.ts`.
 *
 * A razão não é arrumação: cliente digitado ou colado de planilha entra no score
 * da REDE, que é o produto que os outros provedores consultam. Dado que ninguém
 * consegue verificar contamina a decisão de crédito de quem não teve nada a ver
 * com a digitação.
 */
import { Link } from "wouter";
import { PlugZap } from "lucide-react";
import { CabecalhoPainel, EstadoVazio, BOTAO_MARCA } from "@/components/painel/ui";

export default function ImportacaoEncerradaPage() {
  return (
    <div className="space-y-5 p-4 sm:p-6" data-testid="pagina-importacao-encerrada">
      <CabecalhoPainel
        titulo="Importação de dados"
        descricao="A carteira vem do seu ERP, e só dele."
        testIdTitulo="titulo-importacao-encerrada"
      />

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <EstadoVazio
          Icone={PlugZap}
          titulo="A importação por planilha foi encerrada"
          descricao={
            <>
              Cliente, fatura e equipamento entram por uma via só: a sincronização do seu ERP.
              Dado digitado ou colado de planilha entra no score da rede — que é o que os outros
              provedores consultam — e ninguém consegue conferir de onde veio.
            </>
          }
          cta={
            <Link href="/painel-provedor?tab=integracao" className={BOTAO_MARCA} data-testid="link-integracao-erp">
              Ver a integração do meu ERP
            </Link>
          }
          testId="importacao-encerrada"
        />
      </div>

      <p className="text-[12px] leading-5 text-[var(--text-muted)]">
        Se o seu ERP ainda não está integrado, fale com o suporte: hoje o Consulta ISP conversa
        com IXC Soft, MK Solutions, SGP, Hubsoft, Voalle e RBX ISP.
      </p>
    </div>
  );
}
