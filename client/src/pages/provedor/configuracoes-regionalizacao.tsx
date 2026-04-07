import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { MapPin, X, Save, Users, Loader2, Search, Globe, ChevronDown, ChevronUp } from "lucide-react";

const BRAZILIAN_UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

interface CityOption {
  label: string;
  value: string;
  ibge: string;
  mesorregiao?: string;
}

interface Mesoregion {
  name: string;
  cities: number;
}

interface MyCidadesResponse {
  cidadesAtendidas: string[];
  mesorregioes?: string[];
}

interface RegionalProvider {
  id: number;
  name: string;
  cidadesAtendidas: string[];
}

export default function ConfiguracoesRegionalizacaoPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { provider } = useAuth();

  const [selectedUf, setSelectedUf] = useState<string>("");
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showMesoregions, setShowMesoregions] = useState(false);
  const [loadingMeso, setLoadingMeso] = useState<string | null>(null);
  const commandRef = useRef<HTMLDivElement>(null);

  // Auto-select UF from provider profile
  useEffect(() => {
    if (provider?.addressState && !selectedUf) {
      setSelectedUf(provider.addressState.toUpperCase());
    }
  }, [provider?.addressState]);

  // Debounce search term (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (commandRef.current && !commandRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Load current cities
  const { data: myCidades, isLoading: isLoadingCidades } = useQuery<MyCidadesResponse>({
    queryKey: ["/api/regional/my-cidades"],
  });

  // Sync loaded cities to local state
  useEffect(() => {
    if (myCidades?.cidadesAtendidas) {
      setSelectedCities(myCidades.cidadesAtendidas);
      setHasChanges(false);
    }
  }, [myCidades]);

  // Search cities autocomplete
  const { data: searchResults, isFetching: isSearching } = useQuery<CityOption[]>({
    queryKey: ["/api/regional/cities", `?q=${encodeURIComponent(debouncedSearch)}&limit=20`],
    enabled: debouncedSearch.length >= 2,
  });

  // Filter out already selected cities
  const filteredResults = (searchResults || []).filter(
    (city) => !selectedCities.includes(city.value)
  );

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (cidades: string[]) => {
      const res = await apiRequest("PUT", "/api/regional/cidades", { cidades });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/regional/my-cidades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/regional/providers"] });
      setHasChanges(false);
      toast({
        title: "Cidades salvas",
        description: "As cidades atendidas foram atualizadas com sucesso.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao salvar",
        description: error.message || "Nao foi possivel salvar as cidades.",
        variant: "destructive",
      });
    },
  });

  // Regional providers
  const { data: providers, isLoading: isLoadingProviders } = useQuery<RegionalProvider[]>({
    queryKey: ["/api/regional/providers"],
  });

  const addCity = (cityValue: string) => {
    if (!selectedCities.includes(cityValue)) {
      setSelectedCities((prev) => [...prev, cityValue]);
      setHasChanges(true);
    }
    setSearchTerm("");
    setDebouncedSearch("");
    setShowResults(false);
  };

  const removeCity = (cityValue: string) => {
    setSelectedCities((prev) => prev.filter((c) => c !== cityValue));
    setHasChanges(true);
  };

  const handleSave = () => {
    saveMutation.mutate(selectedCities);
  };

  // Mesoregions for selected UF
  const { data: mesoregions } = useQuery<Mesoregion[]>({
    queryKey: ["/api/regional/mesorregioes", `?uf=${selectedUf}`],
    enabled: selectedUf.length === 2,
  });

  const addMesoregion = async (mesoName: string) => {
    setLoadingMeso(mesoName);
    try {
      const res = await fetch(`/api/regional/mesorregioes/${encodeURIComponent(mesoName)}/cities?uf=${selectedUf}`, { credentials: "include" });
      const cities: string[] = await res.json();
      const newCities = cities.filter(c => !selectedCities.includes(c));
      if (newCities.length > 0) {
        setSelectedCities(prev => [...prev, ...newCities]);
        setHasChanges(true);
        toast({ title: `${mesoName}`, description: `${newCities.length} cidades adicionadas` });
      } else {
        toast({ title: mesoName, description: "Todas as cidades desta regiao ja estao selecionadas" });
      }
    } catch {
      toast({ title: "Erro", description: "Nao foi possivel carregar cidades da regiao", variant: "destructive" });
    } finally {
      setLoadingMeso(null);
    }
  };

  // Find shared cities between current provider and a regional provider
  const getSharedCities = (providerCities: string[]) => {
    return providerCities.filter((c) => selectedCities.includes(c));
  };

  if (isLoadingCidades) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MapPin className="w-6 h-6 text-blue-600" />
          Regionalizacao
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure as cidades atendidas pelo seu provedor
        </p>
      </div>

      {/* City Configuration Card */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Cidades Atendidas</h2>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saveMutation.isPending}
            size="sm"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Salvar
          </Button>
        </div>

        {/* City Search with Autocomplete */}
        <div className="relative" ref={commandRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar cidade... (minimo 2 caracteres)"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => {
                if (debouncedSearch.length >= 2) setShowResults(true);
              }}
              className="pl-9"
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Autocomplete Dropdown */}
          {showResults && debouncedSearch.length >= 2 && (
            <div className="absolute z-50 w-full mt-1 border rounded-md bg-popover shadow-md">
              <Command shouldFilter={false}>
                <CommandList>
                  {filteredResults.length === 0 && !isSearching && (
                    <CommandEmpty>Nenhuma cidade encontrada</CommandEmpty>
                  )}
                  {isSearching && (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                      Buscando...
                    </div>
                  )}
                  {filteredResults.length > 0 && (
                    <CommandGroup>
                      {filteredResults.map((city) => (
                        <CommandItem
                          key={city.ibge || city.value}
                          value={city.value}
                          onSelect={() => addCity(city.value)}
                          className="cursor-pointer"
                        >
                          <MapPin className="w-4 h-4 text-muted-foreground" />
                          <span>{city.label}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </div>
          )}
        </div>

        {/* UF Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Estado (UF)</label>
          <Select value={selectedUf} onValueChange={(value) => { setSelectedUf(value); setShowMesoregions(false); }}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Selecione o estado" />
            </SelectTrigger>
            <SelectContent>
              {BRAZILIAN_UFS.map((uf) => (
                <SelectItem key={uf} value={uf}>{uf}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Mesoregion Quick-Select */}
        {selectedUf.length === 2 && mesoregions && mesoregions.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => setShowMesoregions(!showMesoregions)}
              className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
            >
              <Globe className="w-4 h-4" />
              Adicionar por Regiao
              {showMesoregions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showMesoregions && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {mesoregions.map((meso) => {
                  const isLoading = loadingMeso === meso.name;
                  return (
                    <button
                      key={meso.name}
                      onClick={() => addMesoregion(meso.name)}
                      disabled={isLoading}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left text-sm"
                    >
                      {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 flex-shrink-0" /> : <Globe className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
                      <div className="min-w-0">
                        <p className="font-medium text-slate-700 truncate">{meso.name}</p>
                        <p className="text-xs text-slate-400">{meso.cities} cidades</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Selected Cities as Badges */}
        {selectedCities.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selectedCities.map((city) => (
              <Badge
                key={city}
                variant="secondary"
                className="pl-2 pr-1 py-1.5 text-sm flex items-center gap-1"
              >
                <MapPin className="w-3 h-3" />
                {city}
                <button
                  onClick={() => removeCity(city)}
                  className="ml-1 rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive transition-colors"
                  aria-label={`Remover ${city}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>Nenhuma cidade configurada.</p>
            <p className="text-sm">Adicione as cidades onde seu provedor atua.</p>
          </div>
        )}

        {hasChanges && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Alteracoes nao salvas. Clique em Salvar para persistir.
          </p>
        )}

        {/* Derived mesoregions info */}
        {myCidades?.mesorregioes && myCidades.mesorregioes.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
            <Globe className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-blue-800">Mesorregioes de atuacao</p>
              <p className="text-xs text-blue-600 mt-0.5">
                {myCidades.mesorregioes.join(", ")}
              </p>
              <p className="text-[10px] text-blue-500 mt-1">
                Consultas ISP buscarao apenas provedores destas regioes
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Regional Providers Section */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-600" />
          Provedores Regionais
        </h2>
        <p className="text-sm text-muted-foreground">
          Outros provedores que atendem as mesmas cidades que voce
        </p>

        {isLoadingProviders ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : providers && providers.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {providers.map((provider) => {
              const shared = getSharedCities(provider.cidadesAtendidas);
              return (
                <Card key={provider.id} className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center text-sm font-bold text-indigo-700 dark:text-indigo-300">
                      {provider.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium text-sm">{provider.name}</span>
                  </div>
                  {shared.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {shared.map((city) => (
                        <Badge
                          key={city}
                          variant="outline"
                          className="text-xs border-indigo-200 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300"
                        >
                          {city}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {provider.cidadesAtendidas.length} cidade{provider.cidadesAtendidas.length !== 1 ? "s" : ""} atendida{provider.cidadesAtendidas.length !== 1 ? "s" : ""}
                    {shared.length > 0 && ` (${shared.length} em comum)`}
                  </p>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>Nenhum provedor regional encontrado.</p>
            <p className="text-sm">
              Outros provedores que atendem as mesmas cidades aparecerao aqui.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
