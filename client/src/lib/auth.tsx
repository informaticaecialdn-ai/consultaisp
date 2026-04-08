import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { User, Provider } from "@shared/schema";
import { apiRequest } from "./queryClient";

interface AuthState {
  user: { id: number; email: string; name: string; role: string } | null;
  provider: Provider | null;
  partnerCode: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ code?: string; email?: string } | void>;
  register: (data: { email: string; password: string; name: string; phone?: string; providerName: string; cnpj: string; subdomain: string; lgpdAccepted?: boolean }) => Promise<{ needsVerification: boolean; email: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthState["user"]>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [partnerCode, setPartnerCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setProvider(data.provider);
        setPartnerCode(data.partnerCode || null);
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
  };

  const register = async (data: { email: string; password: string; name: string; phone?: string; providerName: string; cnpj: string; subdomain: string; lgpdAccepted?: boolean }) => {
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
  };

  return (
    <AuthContext.Provider value={{ user, provider, partnerCode, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
