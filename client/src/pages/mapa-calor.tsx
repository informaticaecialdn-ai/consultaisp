import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useState } from "react";
import {
  MapPin,
  Search,
  ShieldAlert,
  Wifi,
  UserPlus,
  Settings,
} from "lucide-react";

export default function MapaCalorPage() {
  const { provider } = useAuth();
  const [radius, setRadius] = useState([40]);

  const { data: defaulters } = useQuery<any[]>({
    queryKey: ["/api/defaulters"],
  });

  const uniqueDefaulters = [...new Set((defaulters || []).map(d => d.customerId))].length;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="mapa-calor-page">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
          <MapPin className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-mapa-calor-title">Mapa de Calor</h1>
          <p className="text-sm text-muted-foreground">Visualizacao geografica de inadimplentes</p>
        </div>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              Meu Provedor
            </Badge>
            <Badge variant="secondary" className="gap-1.5">
              <Settings className="w-3 h-3" />
              Benchmarking Regional
            </Badge>
          </div>
        </div>

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>{provider?.name}</span>
          </div>
          <span className="text-sm font-medium" data-testid="text-mapa-defaulters">
            {uniqueDefaulters} clientes inadimplentes
          </span>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <Settings className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Raio de Influencia</span>
          <div className="flex-1">
            <Slider
              value={radius}
              onValueChange={setRadius}
              max={100}
              min={5}
              step={5}
              data-testid="slider-radius"
            />
          </div>
          <span className="text-sm font-medium w-8 text-right">{radius[0]}</span>
        </div>

        <div className="bg-muted/50 rounded-lg p-12 flex flex-col items-center justify-center text-muted-foreground">
          <MapPin className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-medium">Mapa de Calor</p>
          <p className="text-sm mt-1">Integracao com Google Maps necessaria para visualizacao</p>
          <p className="text-xs mt-2">Configure a chave da API do Google Maps nos segredos da aplicacao</p>
        </div>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-blue-600" />
          Acoes Rapidas
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-5 text-center hover-elevate cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-3">
              <Search className="w-6 h-6 text-blue-600" />
            </div>
            <span className="text-sm font-medium">Consultar Clientes</span>
          </Card>
          <Card className="p-5 text-center hover-elevate cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center mx-auto mb-3">
              <ShieldAlert className="w-6 h-6 text-rose-600" />
            </div>
            <span className="text-sm font-medium">Anti-Fraude</span>
          </Card>
          <Card className="p-5 text-center hover-elevate cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-3">
              <Wifi className="w-6 h-6 text-amber-600" />
            </div>
            <span className="text-sm font-medium">Equipamentos</span>
          </Card>
          <Card className="p-5 text-center hover-elevate cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
              <UserPlus className="w-6 h-6 text-emerald-600" />
            </div>
            <span className="text-sm font-medium">Novo Cliente</span>
          </Card>
        </div>
      </div>
    </div>
  );
}
