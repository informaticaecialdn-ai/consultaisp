import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Settings,
  Users,
  Wifi,
  Key,
  Building2,
  UserCog,
} from "lucide-react";

export default function AdministracaoPage() {
  const { user, provider } = useAuth();

  const { data: customers } = useQuery<any[]>({
    queryKey: ["/api/customers"],
  });

  const { data: equipment } = useQuery<any[]>({
    queryKey: ["/api/equipment"],
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" data-testid="administracao-page">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center">
          <Settings className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-admin-title">Administracao</h1>
          <p className="text-sm text-muted-foreground">Gerencie configuracoes do seu provedor</p>
        </div>
      </div>

      <Tabs defaultValue="provedor" className="space-y-4">
        <TabsList>
          <TabsTrigger value="provedor" className="gap-1.5">
            <Building2 className="w-3.5 h-3.5" />
            Provedor
          </TabsTrigger>
          <TabsTrigger value="usuarios" className="gap-1.5">
            <UserCog className="w-3.5 h-3.5" />
            Usuarios
          </TabsTrigger>
          <TabsTrigger value="equipamentos" className="gap-1.5">
            <Wifi className="w-3.5 h-3.5" />
            Equipamentos
          </TabsTrigger>
          <TabsTrigger value="api" className="gap-1.5">
            <Key className="w-3.5 h-3.5" />
            API
          </TabsTrigger>
        </TabsList>

        <TabsContent value="provedor">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Dados do Provedor</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Nome do Provedor</label>
                <Input value={provider?.name || ""} readOnly />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">CNPJ</label>
                <Input value={provider?.cnpj || ""} readOnly />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Plano</label>
                <Input value={provider?.plan || ""} readOnly />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Status</label>
                <div className="flex items-center gap-2 h-9">
                  <Badge variant={provider?.status === "active" ? "default" : "destructive"} className={provider?.status === "active" ? "bg-emerald-500 border-0" : ""}>
                    {provider?.status === "active" ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="usuarios">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Usuarios do Sistema</h2>
              <Button size="sm" className="gap-1.5">
                <Users className="w-4 h-4" />
                Novo Usuario
              </Button>
            </div>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">{user?.name}</TableCell>
                    <TableCell>{user?.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {user?.role === "admin" ? "Administrador" : "Usuario"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-emerald-500 border-0 text-white text-xs">Ativo</Badge>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="equipamentos">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Equipamentos</h2>
              <Button size="sm" className="gap-1.5">
                <Wifi className="w-4 h-4" />
                Novo Equipamento
              </Button>
            </div>
            {equipment?.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Wifi className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Nenhum equipamento cadastrado</p>
              </div>
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Marca</TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead>Serial</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {equipment?.map((eq) => (
                      <TableRow key={eq.id} data-testid={`equipment-${eq.id}`}>
                        <TableCell className="font-medium">{eq.type}</TableCell>
                        <TableCell>{eq.brand}</TableCell>
                        <TableCell>{eq.model}</TableCell>
                        <TableCell className="font-mono text-xs">{eq.serialNumber}</TableCell>
                        <TableCell>
                          <Badge
                            variant={eq.status === "in_use" ? "secondary" : "destructive"}
                            className="text-xs"
                          >
                            {eq.status === "in_use" ? "Em uso" : eq.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          R$ {Number(eq.value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="api">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Configuracoes de API</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Chave da API</label>
                <div className="flex gap-2">
                  <Input value="cis_****************************" readOnly className="font-mono text-sm" />
                  <Button variant="secondary">Regenerar</Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Use esta chave para integracoes externas</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Webhook URL</label>
                <Input placeholder="https://seu-dominio.com/webhook" />
                <p className="text-xs text-muted-foreground mt-1">URL para receber notificacoes de eventos</p>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
