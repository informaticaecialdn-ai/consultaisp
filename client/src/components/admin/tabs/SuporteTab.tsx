import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import ChatPanel from "../ChatPanel";

export default function SuporteTab() {
  const [sub, setSub] = useState<"provedores" | "visitantes">("provedores");

  const { data: chatThreads = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/chat/threads"],
    refetchInterval: 10000,
  });

  const { data: visitorChats = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/visitor-chats"],
    refetchInterval: 10000,
  });

  const providerUnread = chatThreads.reduce((s: number, t: any) => s + (t.unreadCount || 0), 0);
  const visitorUnread = visitorChats.reduce((s: number, c: any) => s + (c.unreadCount || 0), 0);

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setSub("provedores")}
          className={`px-4 py-2 rounded text-sm font-medium transition-colors ${sub === "provedores" ? "bg-[var(--color-navy)] text-white" : "bg-muted text-[var(--color-muted)] hover:bg-muted/70"}`}
          data-testid="tab-support-providers"
        >
          Provedores
          {providerUnread > 0 && (
            <span className="ml-2 w-5 h-5 inline-flex items-center justify-center bg-[var(--color-danger-bg)]0 text-white text-xs rounded-full font-bold">
              {providerUnread}
            </span>
          )}
        </button>
        <button
          onClick={() => setSub("visitantes")}
          className={`px-4 py-2 rounded text-sm font-medium transition-colors ${sub === "visitantes" ? "bg-[var(--color-navy)] text-white" : "bg-muted text-[var(--color-muted)] hover:bg-muted/70"}`}
          data-testid="tab-support-visitors"
        >
          Visitantes do Site
          {visitorUnread > 0 && (
            <span className="ml-2 w-5 h-5 inline-flex items-center justify-center bg-[var(--color-danger-bg)]0 text-white text-xs rounded-full font-bold">
              {visitorUnread}
            </span>
          )}
        </button>
      </div>
      {sub === "provedores" && (
        <ChatPanel
          variant="provider"
          threads={chatThreads}
          baseEndpoint="/api/admin/chat/threads"
          threadsQueryKey={["/api/admin/chat/threads"]}
        />
      )}
      {sub === "visitantes" && (
        <ChatPanel
          variant="visitor"
          threads={visitorChats}
          baseEndpoint="/api/admin/visitor-chats"
          threadsQueryKey={["/api/admin/visitor-chats"]}
        />
      )}
    </div>
  );
}
