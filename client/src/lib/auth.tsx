import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { User, Provider } from "@shared/schema";
import { apiRequest } from "./queryClient";

interface VerificationResult {
  requiresVerification: true;
  email: string;
  userId: number;
  message: string;
}

interface AuthState {
  user: { id: number; email: string; name: string; role: string } | null;
  provider: Provider | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<VerificationResult | void>;
  register: (data: { email: string; password: string; name: string; providerName: string; cnpj: string }) => Promise<VerificationResult | void>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
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

  const login = async (email: string, password: string): Promise<VerificationResult | void> => {
    const res = await apiRequest("POST", "/api/auth/login", { email, password });
    const data = await res.json();
    if (data.requiresVerification) {
      return data as VerificationResult;
    }
    setUser(data.user);
    setProvider(data.provider);
  };

  const register = async (data: { email: string; password: string; name: string; providerName: string; cnpj: string }): Promise<VerificationResult | void> => {
    const res = await apiRequest("POST", "/api/auth/register", data);
    const d = await res.json();
    if (d.requiresVerification) {
      return d as VerificationResult;
    }
    setUser(d.user);
    setProvider(d.provider);
  };

  const verifyEmail = async (email: string, code: string) => {
    const res = await apiRequest("POST", "/api/auth/verify-email", { email, code });
    const data = await res.json();
    setUser(data.user);
    setProvider(data.provider);
  };

  const resendCode = async (email: string) => {
    await apiRequest("POST", "/api/auth/resend-code", { email });
  };

  const logout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    setUser(null);
    setProvider(null);
  };

  return (
    <AuthContext.Provider value={{ user, provider, isLoading, login, register, verifyEmail, resendCode, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
