import { Link } from "wouter";
import { Users, UserX } from "lucide-react";
import type { Carteira } from "@shared/cobranca";
import { cn } from "@/lib/utils";
import { caminhoNaCarteira, NOME_DA_CARTEIRA, retornoDaCarteira } from "./carteiras";

/** Nas telas operacionais mantém a tela; na lista abre o espaço correspondente. */
export function NavegacaoCarteiras({ carteira, destino }: { carteira: Carteira; destino?: string }) {
  return (
    <nav aria-label="Carteiras de cobrança" className="flex flex-wrap gap-1 border-b border-[var(--border)]" data-testid="navegacao-carteiras">
      {(["ativo", "ex_cliente"] as const).map(c => {
        const Icone = c === "ativo" ? Users : UserX;
        return (
          <Link key={c} href={destino ? caminhoNaCarteira(destino, c) : retornoDaCarteira(c)}
            aria-current={carteira === c ? "page" : undefined}
            data-testid={`carteira-${c}`}
            className={cn("flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]",
              carteira === c ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]")}
          >
            <Icone className="h-4 w-4" aria-hidden />{NOME_DA_CARTEIRA[c]}
          </Link>
        );
      })}
    </nav>
  );
}
