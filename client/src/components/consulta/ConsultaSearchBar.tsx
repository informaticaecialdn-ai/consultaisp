import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Info, MapPin, FileText, Building2, ChevronDown, ChevronUp } from "lucide-react";
import type { CepData } from "./types";
import { getDetectedType } from "./utils";

interface SearchPayload {
  cpfCnpj: string;
  addressNumber?: string;
  addressComplement?: string;
  addressStreet?: string;
  addressCity?: string;
  addressState?: string;
}

interface Props {
  onSearch: (payload: SearchPayload) => void;
  isLoading: boolean;
  hasResult: boolean;
  autoAddressCrossRef?: boolean;
  onClear: () => void;
}

export default function ConsultaSearchBar({ onSearch, isLoading, hasResult, autoAddressCrossRef, onClear }: Props) {
  const [query, setQuery] = useState("");
  const [cepData, setCepData] = useState<CepData | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [addressComplement, setAddressComplement] = useState("");

  const [showInstallAddr, setShowInstallAddr] = useState(false);
  const [installCepQuery, setInstallCepQuery] = useState("");
  const [installCepData, setInstallCepData] = useState<CepData | null>(null);
  const [installCepLoading, setInstallCepLoading] = useState(false);
  const [installCepError, setInstallCepError] = useState("");
  const [installNumber, setInstallNumber] = useState("");
  const [installComplement, setInstallComplement] = useState("");

  const detectedType = getDetectedType(query);

  useEffect(() => {
    const digits = query.replace(/\D/g, "");
    if (digits.length === 8) {
      setCepData(null);
      setCepError("");
      setCepLoading(true);
      fetch(`https://viacep.com.br/ws/${digits}/json/`)
        .then(r => r.json())
        .then((d: CepData) => {
          if (d.erro) {
            setCepError("CEP não encontrado. Verifique o número.");
          } else {
            setCepData(d);
          }
        })
        .catch(() => setCepError("Erro ao buscar CEP. Tente novamente."))
        .finally(() => setCepLoading(false));
    } else {
      setCepData(null);
      setCepError("");
      setAddressNumber("");
      setAddressComplement("");
    }
  }, [query]);

  useEffect(() => {
    const digits = installCepQuery.replace(/\D/g, "");
    if (digits.length === 8) {
      setInstallCepData(null);
      setInstallCepError("");
      setInstallCepLoading(true);
      fetch(`https://viacep.com.br/ws/${digits}/json/`)
        .then(r => r.json())
        .then((d: CepData) => {
          if (d.erro) {
            setInstallCepError("CEP não encontrado. Verifique o número.");
          } else {
            setInstallCepData(d);
          }
        })
        .catch(() => setInstallCepError("Erro ao buscar CEP. Tente novamente."))
        .finally(() => setInstallCepLoading(false));
    } else {
      setInstallCepData(null);
      setInstallCepError("");
      setInstallNumber("");
      setInstallComplement("");
    }
  }, [installCepQuery]);

  const handleSearch = () => {
    if (!query.trim()) return;
    const digits = query.replace(/\D/g, "");
    const isCep = digits.length === 8;

    const payload: SearchPayload = {
      cpfCnpj: query,
      addressNumber: isCep ? addressNumber.trim() : undefined,
      addressComplement: isCep ? addressComplement.trim() : undefined,
      addressStreet: isCep && cepData ? cepData.logradouro : undefined,
      addressCity: isCep && cepData ? cepData.localidade : undefined,
      addressState: isCep && cepData ? cepData.uf : undefined,
    };
    onSearch(payload);
  };

  const handleClear = () => {
    setQuery("");
    setCepData(null);
    setAddressNumber("");
    setAddressComplement("");
    setShowInstallAddr(false);
    setInstallCepQuery("");
    setInstallCepData(null);
    setInstallCepError("");
    setInstallNumber("");
    setInstallComplement("");
    onClear();
  };

  const isCepMode = detectedType === "CEP" && cepData;
  const cepNumberRequired = isCepMode && !addressNumber.trim();

  return (
    <Card className="overflow-hidden shadow-lg rounded-lg">
      <div className="bg-[var(--color-bg)] border-b px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-[var(--color-navy)] flex items-center justify-center">
          <Search className="w-4 h-4 text-white" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">Realizar Consulta ISP</h2>
      </div>
      <div className="p-6 space-y-4">
        {/* Main input */}
        <div className="flex gap-3 items-start flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <div className="relative">
              <Input
                data-testid="input-isp-search"
                placeholder="CPF, CNPJ ou CEP (apenas números)"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (hasResult) onClear();
                }}
                onKeyDown={(e) => e.key === "Enter" && !cepData ? handleSearch() : undefined}
                className="h-12 text-base pr-10 rounded-md border-[var(--color-border)]"
              />
              {cepLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-[var(--color-steel)] border-t-transparent animate-spin" />
              )}
              {!cepLoading && detectedType && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {detectedType === "CEP" && <MapPin className="w-4 h-4 text-[var(--color-steel)]" />}
                  {detectedType === "CPF" && <FileText className="w-4 h-4 text-[var(--color-success)]" />}
                  {detectedType === "CNPJ" && <Building2 className="w-4 h-4 text-[var(--color-steel)]" />}
                </div>
              )}
            </div>
            {detectedType && !cepData && !cepLoading && (
              <p className={`text-xs mt-1 font-medium ${
                detectedType === "CEP" ? "text-[var(--color-steel)]"
                : detectedType === "CPF" ? "text-[var(--color-success)]"
                : "text-[var(--color-steel)]"
              }`} data-testid="text-detected-type">
                {detectedType === "CEP" ? "Buscando CEP..." : `${detectedType} detectado`}
              </p>
            )}
            {cepError && <p className="text-xs mt-1 text-[var(--color-danger)] font-medium">{cepError}</p>}
          </div>

          {!cepData && (
            <>
              <Button
                variant="outline"
                className="h-12 px-5 rounded-md"
                onClick={handleClear}
                data-testid="button-clear-isp"
              >
                Limpar
              </Button>
              <Button
                onClick={handleSearch}
                disabled={!query.trim() || isLoading || cepLoading}
                className="h-12 px-8 rounded-md bg-[var(--color-navy)] hover:opacity-90 text-white font-medium"
                data-testid="button-consultar-isp"
              >
                {isLoading ? "Consultando..." : "Consultar"}
              </Button>
            </>
          )}
        </div>

        {/* CEP expanded */}
        {cepData && (
          <div className="border-2 border-[var(--color-steel)]/30 bg-[var(--color-navy-bg)] rounded-lg p-4 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200" data-testid="cep-expanded-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-[var(--color-steel)] font-bold uppercase tracking-wide mb-0.5">Endereço localizado</p>
                <p className="text-base font-black text-[var(--color-ink)]">{cepData.logradouro}</p>
                <p className="text-sm text-[var(--color-muted)]">{cepData.bairro} · {cepData.localidade}/{cepData.uf}</p>
              </div>
              <div className="bg-[var(--color-navy)] text-white text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap">
                CEP confirmado
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[var(--color-ink)] mb-1 block">
                  Número <span className="text-[var(--color-danger)]">*</span>
                </label>
                <Input
                  data-testid="input-address-number"
                  placeholder="Ex: 142"
                  value={addressNumber}
                  onChange={(e) => setAddressNumber(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="h-10 rounded-md border-[var(--color-border)] bg-[var(--color-surface)]"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--color-ink)] mb-1 block">
                  Complemento <span className="text-[var(--color-muted)] font-normal">(opcional)</span>
                </label>
                <Input
                  data-testid="input-address-complement"
                  placeholder="Apto 12, Bloco B..."
                  value={addressComplement}
                  onChange={(e) => setAddressComplement(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="h-10 rounded-md border-[var(--color-border)] bg-[var(--color-surface)]"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="h-10 px-4 rounded-md text-sm"
                onClick={handleClear}
                data-testid="button-clear-isp"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSearch}
                disabled={!addressNumber.trim() || isLoading}
                className="h-10 flex-1 rounded-md bg-[var(--color-navy)] hover:opacity-90 text-white font-semibold gap-2"
                data-testid="button-consultar-isp"
              >
                <MapPin className="w-4 h-4" />
                {isLoading ? "Buscando endereço..." : "Buscar risco por endereço"}
              </Button>
            </div>

            <div className="flex items-start gap-2 bg-[var(--color-navy-bg)] border border-[var(--color-steel)]/20 rounded-lg p-3">
              <Info className="w-3.5 h-3.5 text-[var(--color-steel)] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[var(--color-navy)]">
                <span className="font-semibold">Busca por endereço:</span> Cruzamos esse endereço com todos os provedores parceiros.
                CPF limpo não significa bom pagador — o inadimplente troca de CPF, mas o endereço fica.
              </p>
            </div>
          </div>
        )}

        {/* Default hint */}
        {!cepData && !detectedType && (
          <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg p-4 flex items-start gap-3">
            <Info className="w-4 h-4 text-[var(--color-muted)] mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-[var(--color-ink)]">
                <span className="font-semibold">Busca inteligente:</span> Digite CPF (11 dígitos), CNPJ (14 dígitos) ou CEP (8 dígitos) para consulta por endereço.
              </p>
              <p className="text-xs text-[var(--color-muted)] mt-1">
                CEP → resolve o logradouro automaticamente → informe o número → busca cruzada em todos os provedores.
              </p>
            </div>
          </div>
        )}

        {/* Install address fallback */}
        {(detectedType === "CPF" || detectedType === "CNPJ") && (!hasResult || autoAddressCrossRef !== true) && (
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-[var(--color-bg)] hover:opacity-90 transition-colors text-left"
              onClick={() => setShowInstallAddr(prev => !prev)}
            >
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[var(--color-muted)]" />
                <span className="text-sm font-medium text-[var(--color-ink)]">Verificar também por endereço de instalação</span>
              </div>
              {showInstallAddr ? <ChevronUp className="w-4 h-4 text-[var(--color-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" />}
            </button>

            {showInstallAddr && (
              <div className="px-4 py-3 space-y-3 border-t border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-muted)]">
                  Informe o CEP de instalação para cruzar com a base ISP. Útil quando o ERP não retorna endereço automaticamente.
                </p>

                <div className="relative">
                  <Input
                    placeholder="CEP de instalação (8 dígitos)"
                    value={installCepQuery}
                    onChange={(e) => setInstallCepQuery(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    className="h-10 rounded-md border-[var(--color-border)] pr-10"
                    data-testid="input-install-cep"
                  />
                  {installCepLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-[var(--color-steel)] border-t-transparent animate-spin" />
                  )}
                </div>
                {installCepError && <p className="text-xs text-[var(--color-danger)] font-medium">{installCepError}</p>}

                {installCepData && (
                  <div className="bg-[var(--color-navy-bg)] border border-[var(--color-steel)]/20 rounded-md p-3 space-y-2">
                    <div>
                      <p className="text-xs text-[var(--color-steel)] font-bold uppercase tracking-wide mb-0.5">Endereço localizado</p>
                      <p className="text-sm font-semibold text-[var(--color-ink)]">{installCepData.logradouro}</p>
                      <p className="text-xs text-[var(--color-muted)]">{installCepData.bairro} · {installCepData.localidade}/{installCepData.uf}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-semibold text-[var(--color-ink)] mb-1 block">
                          Número <span className="text-[var(--color-danger)]">*</span>
                        </label>
                        <Input
                          placeholder="Ex: 142"
                          value={installNumber}
                          onChange={(e) => setInstallNumber(e.target.value)}
                          className="h-9 rounded-md border-[var(--color-border)] bg-[var(--color-surface)]"
                          data-testid="input-install-number"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-[var(--color-ink)] mb-1 block">
                          Complemento <span className="text-[var(--color-muted)] font-normal">(opcional)</span>
                        </label>
                        <Input
                          placeholder="Apto 12..."
                          value={installComplement}
                          onChange={(e) => setInstallComplement(e.target.value)}
                          className="h-9 rounded-md border-[var(--color-border)] bg-[var(--color-surface)]"
                          data-testid="input-install-complement"
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="w-full gap-2 bg-[var(--color-navy)] hover:opacity-90 text-white"
                      disabled={!installNumber.trim() || isLoading}
                      onClick={() => {
                        if (!installCepData || !installNumber.trim()) return;
                        onSearch({
                          cpfCnpj: query,
                          addressNumber: installNumber.trim(),
                          addressComplement: installComplement.trim() || undefined,
                          addressStreet: installCepData.logradouro,
                          addressCity: installCepData.localidade,
                          addressState: installCepData.uf,
                        });
                      }}
                      data-testid="button-install-addr-search"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      {isLoading ? "Consultando..." : "Consultar com endereço"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
