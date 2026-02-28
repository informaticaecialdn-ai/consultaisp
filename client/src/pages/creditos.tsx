import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CreditCard,
  Package,
  Zap,
  Crown,
  CheckCircle,
  ShoppingCart,
} from "lucide-react";

const packages = [
  { name: "Basico", ispCredits: 50, spcCredits: 20, price: "R$ 49,90", icon: Package, color: "blue" },
  { name: "Profissional", ispCredits: 200, spcCredits: 100, price: "R$ 149,90", icon: Zap, color: "purple", popular: true },
  { name: "Enterprise", ispCredits: 500, spcCredits: 300, price: "R$ 299,90", icon: Crown, color: "amber" },
];

export default function CreditosPage() {
  const { provider } = useAuth();

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="creditos-page">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
          <CreditCard className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-creditos-title">Comprar Creditos</h1>
          <p className="text-sm text-muted-foreground">Recarregue seu saldo para consultas ISP e SPC</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-5 bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-200/50 dark:border-blue-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground font-medium">Creditos ISP</span>
            <CreditCard className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-3xl font-bold" data-testid="text-isp-credits-balance">{provider?.ispCredits || 0}</p>
          <p className="text-xs text-muted-foreground mt-1">Creditos disponiveis</p>
        </Card>
        <Card className="p-5 bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/20 border-purple-200/50 dark:border-purple-800/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-sm text-muted-foreground font-medium">Creditos SPC</span>
            <CreditCard className="w-5 h-5 text-purple-500" />
          </div>
          <p className="text-3xl font-bold" data-testid="text-spc-credits-balance">{provider?.spcCredits || 0}</p>
          <p className="text-xs text-muted-foreground mt-1">Creditos disponiveis</p>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Pacotes Disponiveis</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {packages.map((pkg) => (
            <Card
              key={pkg.name}
              className={`p-6 relative ${pkg.popular ? "ring-2 ring-blue-500" : ""}`}
              data-testid={`package-${pkg.name.toLowerCase()}`}
            >
              {pkg.popular && (
                <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-blue-600 border-0 text-white text-xs">
                  Mais Popular
                </Badge>
              )}
              <div className="text-center mb-4">
                <div className={`w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center ${
                  pkg.color === "blue" ? "bg-blue-100 dark:bg-blue-900/30" :
                  pkg.color === "purple" ? "bg-purple-100 dark:bg-purple-900/30" :
                  "bg-amber-100 dark:bg-amber-900/30"
                }`}>
                  <pkg.icon className={`w-7 h-7 ${
                    pkg.color === "blue" ? "text-blue-600" :
                    pkg.color === "purple" ? "text-purple-600" :
                    "text-amber-600"
                  }`} />
                </div>
                <h3 className="text-lg font-bold">{pkg.name}</h3>
                <p className="text-2xl font-bold mt-2">{pkg.price}</p>
              </div>
              <div className="space-y-2 mb-6">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  <span>{pkg.ispCredits} Creditos ISP</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  <span>{pkg.spcCredits} Creditos SPC</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  <span>Suporte prioritario</span>
                </div>
              </div>
              <Button className="w-full gap-2" variant={pkg.popular ? "default" : "secondary"}>
                <ShoppingCart className="w-4 h-4" />
                Comprar
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
