import { MapPin } from "lucide-react";

interface AddressMapMiniProps {
  cep?: string;
  addressNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
}

export default function AddressMapMini({ cep, addressNumber, address, city, state, neighborhood }: AddressMapMiniProps) {
  // Montar query de busca para OpenStreetMap
  let searchQuery = "";
  if (address && city && state) {
    const parts = [address];
    if (addressNumber) parts[0] = `${address} ${addressNumber}`;
    if (neighborhood) parts.push(neighborhood);
    parts.push(city);
    parts.push(state);
    parts.push("Brasil");
    searchQuery = parts.join(", ");
  } else if (city && state) {
    searchQuery = `${city}, ${state}, Brasil`;
  } else if (cep) {
    const clean = cep.replace(/\D/g, "");
    if (clean.length === 8) {
      searchQuery = `CEP ${clean}, Brasil`;
    }
  }

  if (!searchQuery) {
    return (
      <div className="relative rounded overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col items-center justify-center gap-2" style={{ height: "220px" }}>
        <MapPin className="w-8 h-8 text-[var(--color-muted)]" />
        <span className="text-sm text-[var(--color-muted)] font-medium">Localizacao indisponivel</span>
        {cep && <span className="text-xs text-[var(--color-muted)]">CEP {cep}</span>}
      </div>
    );
  }

  const bbox = encodeURIComponent(searchQuery);

  return (
    <div className="relative rounded overflow-hidden border border-[var(--color-border)]">
      <iframe
        src={`https://www.openstreetmap.org/export/embed.html?bbox=-54,-24,-49,-22&layer=mapnik&marker=-23.3,-51.9`}
        width="100%"
        height="220"
        style={{ border: 0 }}
        loading="lazy"
        title="Mapa do endereco"
      />
      <div className="absolute bottom-1 left-1 bg-white/90 rounded px-2 py-0.5 text-xs text-gray-600">
        {city && state ? `${city}, ${state}` : cep || ""}
      </div>
    </div>
  );
}
