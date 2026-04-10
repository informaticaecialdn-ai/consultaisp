import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AddressRiskAlertProps {
  data: {
    type: string;
    message: string;
    matches: {
      cpfMasked: string;
      overdueRange: string;
      maxDaysOverdue: number;
      status: string;
    }[];
  };
}

export default function AddressRiskAlert({ data }: AddressRiskAlertProps) {
  return (
    <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-orange-600" />
        <h3 className="font-semibold text-sm text-orange-800 dark:text-orange-300">
          Alerta de Endereco
        </h3>
        <Badge className="bg-orange-200 text-orange-800 dark:bg-orange-900 dark:text-orange-300 text-xs ml-auto">
          {data.matches.length} registro(s)
        </Badge>
      </div>
      <p className="text-sm text-orange-700 dark:text-orange-400">{data.message}</p>
      <div className="space-y-2">
        {data.matches.map((match, i) => (
          <div key={i} className="flex items-center justify-between text-sm bg-white/60 dark:bg-black/20 rounded px-3 py-2">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-muted-foreground">{match.cpfMasked}</span>
              <Badge variant="outline" className="text-xs">
                {match.status}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-right">
              <span className="text-xs text-muted-foreground">{match.maxDaysOverdue}d atraso</span>
              <span className="font-semibold text-sm">{match.overdueRange}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
