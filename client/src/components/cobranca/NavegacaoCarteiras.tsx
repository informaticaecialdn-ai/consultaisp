import { Link } from "wouter";
import { LayoutDashboard, KanbanSquare, Route, MessageSquare } from "lucide-react";
import type { Carteira } from "@shared/cobranca";
import { cn } from "@/lib/utils";
import { caminhoNaCarteira, NOME_DA_CARTEIRA, retornoDaCarteira } from "./carteiras";

/** A carteira só muda no menu principal. Aqui cada destino mantém o mesmo escopo. */
export function NavegacaoCarteiras({ carteira, destino }: { carteira: Carteira; destino?: string }) {
  const paginas = [
    { rota: retornoDaCarteira(carteira), rotulo: "Carteira", Icone: LayoutDashboard },
    { rota: "/cobranca/esteira", rotulo: "Esteira", Icone: KanbanSquare },
    { rota: "/cobranca/regua", rotulo: "Régua e DNA", Icone: Route },
    { rota: "/cobranca/chat", rotulo: "Conversas", Icone: MessageSquare },
  ];
  const atual = destino?.split("?")[0] ?? retornoDaCarteira(carteira);
  return (
    <nav aria-label={`Operação · ${NOME_DA_CARTEIRA[carteira]}`} className="flex flex-wrap gap-1 border-b border-[var(--border)]" data-testid="navegacao-carteiras">
      {paginas.map(({ rota, rotulo, Icone }) => {
        const selecionada = rota === atual;
        return (
          <Link key={rota} href={caminhoNaCarteira(rota, carteira)}
            aria-current={selecionada ? "page" : undefined}
            className={cn("flex min-h-[44px] items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]",
              selecionada ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]")}
          >
            <Icone className="h-4 w-4" aria-hidden />{rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
