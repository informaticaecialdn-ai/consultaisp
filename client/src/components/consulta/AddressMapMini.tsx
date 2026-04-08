import { useQuery } from "@tanstack/react-query";
import { STALE_STATIC } from "@/lib/queryClient";
import { MapPin } from "lucide-react";

interface AddressMapMiniProps {
  /** CEP (fallback se nao tiver endereco completo) */
  cep?: string;
  addressNumber?: string;
  /** Endereco completo: rua, numero, bairro, cidade, estado */
  address?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
}

export default function AddressMapMini({ cep, addressNumber, address, city, state, neighborhood }: AddressMapMiniProps) {
  const { data: keyData, isLoading: keyLoading, isError: keyError } = useQuery<{ key: string }>({
    queryKey: ["/api/config/maps-key"],
    staleTime: STALE_STATIC,
  });

  const apiKey = keyData?.key ?? "";
  const keyResolved = !keyLoading;
  const keyUnavailable = keyResolved && (!apiKey || keyError);

  // Montar query de busca: priorizar endereco completo, fallback CEP
  let searchQuery = "";
  if (address && city && state) {
    // Endereco completo disponivel
    const parts = [address];
    if (addressNumber) parts[0] = `${address} ${addressNumber}`;
    if (neighborhood) parts.push(neighborhood);
    parts.push(city);
    parts.push(state);
    parts.push("Brasil");
    searchQuery = parts.join(", ");
  } else if (city && state) {
    // Cidade + estado
    searchQuery = `${city}, ${state}, Brasil`;
  } else if (cep) {
    // Fallback: buscar por CEP
    const clean = cep.replace(/\D/g, "");
    if (clean.length === 8) {
      searchQuery = `CEP ${clean}, Brasil`;
    }
  }

  if (!searchQuery || keyUnavailable) {
    return (
      <div className="relative rounded overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col items-center justify-center gap-2" style={{ height: "220px" }}>
        <MapPin className="w-8 h-8 text-[var(--color-muted)]" />
        <span className="text-sm text-[var(--color-muted)] font-medium">Localizacao indisponivel</span>
        {cep && <span className="text-xs text-[var(--color-muted)]">CEP {cep}</span>}
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className="relative rounded overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-center" style={{ height: "220px" }}>
        <div className="w-5 h-5 border-2 border-[var(--color-muted)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative rounded overflow-hidden border border-[var(--color-border)]">
      <iframe
        src={`https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${encodeURIComponent(searchQuery)}&zoom=15`}
        width="100%"
        height="220"
        style={{ border: 0 }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title="Mapa do endereco"
      />
    </div>
  );
}
