import { ComunicacoesCobranca } from '@/components/cobranca/ComunicacoesCobranca';
import { Link,useSearch } from 'wouter';
export default function ComunicacoesPage(){const carteira=new URLSearchParams(useSearch()).get('carteira')==='ex_cliente'?'ex_cliente':'ativo';return <main className="space-y-4 p-4 lg:p-6"><Link href={`/cobranca/esteira?carteira=${carteira}`} className="text-sm text-[var(--brand)]">← Gestão de cobranças · {carteira==='ativo'?'Clientes ativos':'Ex-clientes'}</Link><ComunicacoesCobranca operacao carteira={carteira}/></main>;}
