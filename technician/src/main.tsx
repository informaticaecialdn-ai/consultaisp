import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FieldOperations, { fieldRequest } from "../../client/src/components/recuperacao/FieldOperations";
import "./shell.css";
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });
type Session = { user: { id: number; name: string; role: string }; provider: { id: number; name: string } | null };
function App() {
  const [session, setSession] = useState<Session | null>(null); const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    fieldRequest<Session>("/api/auth/me", undefined, false).then(data => { if (active) setSession(data); }).catch(() => { if (active) setSession(null); }).finally(() => { if (active) setLoading(false); });
    if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js").catch(() => { if (active) setError("Não foi possível ativar a instalação do app. O acesso pelo navegador continua disponível."); });
    const expired = () => { queryClient.clear(); setSession(null); setError("Sua sessão terminou. Entre novamente para continuar."); };
    window.addEventListener("field:session-expired", expired);
    return () => { active = false; window.removeEventListener("field:session-expired", expired); };
  }, []);
  const login = async (e: React.FormEvent) => { e.preventDefault(); setError(""); setPending(true); try { const data = await fieldRequest<Session>("/api/auth/login", { email, password }, false); queryClient.clear(); setSession(data); setPassword(""); } catch (e) { setError((e as Error).message); } finally { setPending(false); } };
  const logout = async () => { setPending(true); try { await fieldRequest("/api/auth/logout", {}); queryClient.clear(); setSession(null); } catch (e) { setError((e as Error).message); } finally { setPending(false); } };
  if (loading) return <div className="tech-login"><h1>Carregando sua sessão…</h1></div>;
  if (!session?.user) return <main className="tech-login"><span>CONSULTA ISP · TÉCNICO</span><h1>Seu trabalho de campo, organizado.</h1><p>Entre com o usuário que o provedor atribuiu às retiradas.</p><form onSubmit={login}><label>E-mail<input type="email" autoComplete="username" value={email} required onChange={e => setEmail(e.target.value)} /></label><label>Senha<input type="password" autoComplete="current-password" value={password} required onChange={e => setPassword(e.target.value)} /></label>{error && <p role="alert">{error}</p>}<button disabled={pending}>{pending ? "Entrando…" : "Entrar na minha agenda"}</button></form><small>Para instalar, use “Adicionar à tela inicial” no menu do navegador.</small></main>;
  if (!session.provider?.id || !["user", "admin"].includes(session.user.role)) return <main className="tech-login"><h1>Acesso de equipe necessário</h1><p>Use uma conta vinculada ao provedor responsável pelas atividades.</p><button onClick={() => void logout()}>Trocar conta</button></main>;
  return <><div className="tech-topbar"><strong>Técnico ISP</strong><span>{session.provider?.name} · {session.user.name}</span><button disabled={pending} onClick={() => void logout()}>Sair</button></div>{error && <p role="alert">{error}</p>}<FieldOperations key={`${session.provider.id}:${session.user.id}`} manager={false} /></>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>);
