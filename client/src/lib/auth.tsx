import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { User, Provider } from "@shared/schema";
import { apiRequest } from "./queryClient";

interface AuthState {
  user: { id: number; email: string; name: string; role: string } | null;
  provider: Provider | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; name: string; providerName: string; cnpj: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthState["user"]>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setProvider(data.provider);
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
    const res = await apiRequest("POST", "/api/auth/login", { email, password });
    const data = await res.json();
    setUser(data.user);
    setProvider(data.provider);
  };

  const register = async (data: { email: string; password: string; name: string; providerName: string; cnpj: string }) => {
    const res = await apiRequest("POST", "/api/auth/register", data);
    const d = await res.json();
    setUser(d.user);
    setProvider(d.provider);
  };

  const logout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    setUser(null);
    setProvider(null);
  };

  return (
    <AuthContext.Provider value={{ user, provider, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
