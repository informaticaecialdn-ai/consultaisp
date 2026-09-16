import FieldOperations from "@/components/recuperacao/FieldOperations";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
export default function RecoveryOperationsPage() {
  const { user } = useAuth();
  return <><div className="px-6 pt-4"><Link href="/recuperacao">← Kanban de recuperação</Link></div><FieldOperations manager={user?.role === "admin" || user?.role === "superadmin"} /></>;
}
