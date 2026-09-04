import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { User, Provider } from "@shared/schema";
import { apiRequest } from "./queryClient";

/**
 * Os quatro papeis de `users.role`. O quarto, `revendedor`, nasceu na fase 1 do
 * white label e nao e um provedor: ele nao tem `providerId` (o banco proibe, no
 * CHECK `users_papel_coerente`) e o tenant dele e a MARCA.
 *
 * Uniao em vez de `string` para que o compilador reprove `role === "revendor"`.
 * A conversao acontece na fronteira — o corpo de `/api/auth/me` chega sem tipo
 * —, entao isto nao valida o que o servidor mandou: documenta e trava o que o
 * client COMPARA.
 */
export type Papel = "user" | "admin" | "superadmin" | "revendedor";

/**
 * A marca do revendedor logado, como `GET /api/auth/me` a devolve.
 *
 * CONTRATO: o tipo `MarcaDaSessao` de `server/routes/auth.routes.ts`. Repetido
 * aqui, e nao importado, porque o client nunca importa de `server/` — e o que
 * mantem o bundle do navegador longe do codigo que abre o banco.
 *
 * O QUE NAO ESTA AQUI, e nao por esquecimento: os SVG/PNG da marca (servidos
 * por URL em `/api/marca/:id/logo`, para nao trafegar centenas de KB em cada
 * `/me`) e os quatro `repasse_*` — chave PIX e CNPJ de quem recebe a comissao,
 * que a decisao 6 do dono reserva ao superadmin. O servidor nao os manda; este
 * tipo existe tambem para que nenhuma tela os espere.
 */
export type MarcaDaSessao = {
  id: number;
  nomeProduto: string;
  slug: string;
  dominio: string | null;
  /** "pendente" | "ativo" (HTTPS emitido). Coluna `marcas.dominio_status`. */
  dominioStatus: string;
  revendaAtiva: boolean;
  /** Ja convertido para numero pelo servidor: a coluna e `numeric(5,2)` e o
   *  driver do Postgres a entrega como string ("20.00"). */
  comissaoPercentual: number;
};

interface AuthState {
  user: { id: number; email: string; name: string; role: Papel } | null;
  provider: Provider | null;
  /**
   * A marca de quem REVENDE, e so dela: para provedor e superadmin o servidor
   * nem manda a chave, e aqui o valor fica `null`.
   *
   * Nao confundir com `useMarca()` (client/src/lib/marca.ts), que e a pele
   * resolvida por HOST e vale para qualquer visitante, logado ou nao. Esta e a
   * marca da SESSAO — a que o painel `/revenda` administra. Hoje as duas
   * coincidem, porque o revendedor so consegue entrar pelo dominio proprio da
   * propria marca (`hostPertenceAMarca`); se um dia divergirem, quem responde
   * "o que eu administro" e esta, e quem responde "que cara a tela tem" e a
   * outra.
   */
  marca: MarcaDaSessao | null;
  /** "Seu codigo", para o suporte — nao e o que os parceiros veem para voce. */
  partnerCode: string | null;
  /**
   * Um superadmin esta conectado DENTRO da conta de `provider` por uma janela de
   * acesso de suporte. Vem de `GET /api/auth/me`, que le `session.suporte`.
   *
   * Existe porque `role` continua "superadmin" durante a personificacao, de
   * proposito (server/auth.ts): sem este campo nao ha como a interface saber se
   * a sessao esta na plataforma ou dentro de um tenant.
   */
  personificando: boolean;
  mustChangePassword: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ code?: string; email?: string } | void>;
  register: (data: { email: string; password: string; name: string; phone?: string; responsavelCpf: string; providerName: string; cnpj: string; subdomain: string; lgpdAccepted?: boolean }) => Promise<{ needsVerification: boolean; email: string }>;
  logout: () => Promise<void>;
  clearMustChangePassword: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthState["user"]>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [marca, setMarca] = useState<MarcaDaSessao | null>(null);
  const [partnerCode, setPartnerCode] = useState<string | null>(null);
  const [personificando, setPersonificando] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setProvider(data.provider);
        setMarca(data.marca ?? null);
        setPartnerCode(data.partnerCode || null);
        setPersonificando(data.personificando === true);
        setMustChangePassword(data.mustChangePassword || false);
      }
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message || "Email ou senha incorretos") as any;
      err.code = data.code;
      err.email = data.email;
      throw err;
    }
    setUser(data.user);
    setProvider(data.provider);
    // `?? null` faz as duas coisas de uma vez.
    //
    // ZERA: o corpo do login so traz `marca` para revendedor, entao quem entra
    // como provedor apaga a marca de quem estava logado antes nesta aba. Sem
    // isso, um login de provedor por cima da sessao de um revendedor herdaria a
    // marca do anterior — o mesmo acidente que a linha de `personificando`
    // logo abaixo evita, no outro eixo.
    //
    // E GUARDA: para o revendedor, aproveitar o corpo do login em vez de
    // esperar o proximo `/api/auth/me` evita o quadro em que ele ja esta dentro
    // e a marca ainda e `null`. A barra lateral dele nasce dessa marca.
    setMarca(data.marca ?? null);
    // Login encerra qualquer personificacao no servidor (`encerrarPersonificacao`
    // em auth.routes.ts), entao o estado local tem de acompanhar: uma aba que
    // fizesse login por cima de uma sessao de suporte continuaria desenhando a
    // navegacao do tenant anterior.
    setPersonificando(false);
    setMustChangePassword(data.mustChangePassword || false);
  };

  const register = async (data: { email: string; password: string; name: string; phone?: string; responsavelCpf: string; providerName: string; cnpj: string; subdomain: string; lgpdAccepted?: boolean }) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: "include",
    });
    const d = await res.json();
    if (!res.ok) {
      throw new Error(d.message || "Nao foi possivel concluir o cadastro. Tente novamente.");
    }
    return { needsVerification: d.needsVerification as boolean, email: d.email as string };
  };

  const logout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    setUser(null);
    setProvider(null);
    setMarca(null);
    setPersonificando(false);
  };

  const clearMustChangePassword = () => setMustChangePassword(false);

  return (
    <AuthContext.Provider value={{ user, provider, marca, partnerCode, personificando, mustChangePassword, isLoading, login, register, logout, clearMustChangePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
