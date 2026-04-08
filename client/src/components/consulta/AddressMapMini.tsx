import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { STALE_STATIC } from "@/lib/queryClient";
import { MapPin } from "lucide-react";

interface AddressMapMiniProps {
  cep: string;
  addressNumber?: string;
}

export default function AddressMapMini({ cep, addressNumber }: AddressMapMiniProps) {
  const [addressQuery, setAddressQuery] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data: keyData, isLoading: keyLoading, isError: keyError } = useQuery<{ key: string }>({
    queryKey: ["/api/config/maps-key"],
    staleTime: STALE_STATIC,
  });

  const apiKey = keyData?.key ?? "";
  const keyResolved = !keyLoading;
  const keyUnavailable = keyResolved && (!apiKey || keyError);

  useEffect(() => {
    if (!cep) { setFailed(true); return; }

    const cleanCep = cep.replace(/\D/g, "");
    if (cleanCep.length !== 8) { setFailed(true); return; }

    let cancelled = false;
    setFailed(false);
    setAddressQuery(null);

    (async () => {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        const data = await res.json();
        if (cancelled) return;
        if (data.erro || !data.localidade) { setFailed(true); return; }

        const { logradouro, localidade, uf } = data;
        if (logradouro && addressNumber) {
          setAddressQuery(`${logradouro} ${addressNumber}, ${localidade}, ${uf}, Brasil`);
        } else if (logradouro) {
          setAddressQuery(`${logradouro}, ${localidade}, ${uf}, Brasil`);
        } else {
          setAddressQuery(`${localidade}, ${uf}, Brasil`);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => { cancelled = true; };
  }, [cep, addressNumber]);

  // Unavailable: geocode failed, CEP invalid, or API key not available
  if (failed || keyUnavailable) {
    return (
      <div className="relative rounded overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col items-center justify-center gap-2" style={{ height: "220px" }}>
        <MapPin className="w-8 h-8 text-[var(--color-muted)]" />
        <span className="text-sm text-[var(--color-muted)] font-medium">Localização indisponível</span>
        {cep && <span className="text-xs text-[var(--color-muted)] max-w-[200px] text-center truncate">CEP {cep}{addressNumber ? `, nº ${addressNumber}` : ""}</span>}
      </div>
    );
  }

  // Loading: ViaCEP still resolving or API key still loading
  if (!apiKey || !addressQuery) {
    return (
      <div className="relative rounded overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-center" style={{ height: "220px" }}>
        <div className="w-5 h-5 border-2 border-[var(--color-muted)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative rounded overflow-hidden border border-[var(--color-border)]">
      <iframe
        src={`https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${encodeURIComponent(addressQuery)}&zoom=15`}
        width="100%"
        height="220"
        style={{ border: 0 }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title="Mapa do endereço"
      />
    </div>
  );
}
