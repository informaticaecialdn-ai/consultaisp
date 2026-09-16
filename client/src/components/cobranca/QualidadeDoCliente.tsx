import { diagnosticarCliente } from '@shared/cobranca/qualidade-cliente';
import type { ClienteDo360, SnapshotAoVivo } from './tipos';
import { brl } from '@shared/cobranca';

export function QualidadeDoCliente({cliente,snapshot,lendo,onConsultar}:{cliente:ClienteDo360;snapshot?:SnapshotAoVivo;lendo:boolean;onConsultar:()=>void}) {
 const vivo=snapshot?.ok&&snapshot.encontrado&&!snapshot.leituraParcial?snapshot.cliente:null;
 const sinais=diagnosticarCliente(cliente,new Date(),vivo);
 return <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4" aria-label="Confiabilidade dos dados">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Confiabilidade dos dados</h2><p className="mt-1 text-xs text-[var(--text-muted)]">{sinais.length ? `${sinais.length} ponto(s) para conferir antes do próximo contato` : 'Sem divergências nos campos verificados'} · Base sincronizada {cliente.lastSyncAt ? new Date(cliente.lastSyncAt).toLocaleString('pt-BR') : 'sem data confirmada'}</p></div><button type="button" disabled={lendo} onClick={onConsultar} className="rounded-md border border-[var(--border)] px-3 py-2 text-xs font-medium disabled:opacity-50">{lendo?'Consultando…':'Conferir no ERP'}</button></div>
  {vivo&&<p className="mt-3 rounded-md bg-[var(--surface-2)] p-3 text-xs">ERP consultado: <strong>{brl(vivo.dividaAtual)}</strong> vencidos · {vivo.diasAtraso} dias de atraso. Base sincronizada: <strong>{brl(cliente.dividaAtual)}</strong> · {cliente.diasAtraso} dias. {snapshot?.lidoEm&&`Leitura: ${new Date(snapshot.lidoEm).toLocaleString('pt-BR')}.`}</p>}
  {snapshot?.leituraParcial&&<p className="mt-2 text-xs text-[var(--gated)]">Leitura parcial do ERP: os dados recebidos não permitem confirmar o saldo completo.</p>}
  {snapshot&&!snapshot.ok&&<p className="mt-2 text-xs text-[var(--gated)]">O ERP não confirmou os dados nesta tentativa. O resumo continua mostrando a base sincronizada.</p>}
  {snapshot?.ok&&!snapshot.encontrado&&<p className="mt-2 text-xs text-[var(--gated)]">Cliente não encontrado na consulta ao ERP. Confira o vínculo antes de usar os dados sincronizados.</p>}
  {sinais.length>0&&<details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-[var(--brand)]">Ver pontos de atenção</summary><ul className="mt-3 grid gap-2 md:grid-cols-2">{sinais.map(s=><li key={s.titulo} className="rounded-lg border border-[var(--gated-border)] bg-[var(--gated-bg)] p-3"><h3 className="text-xs font-semibold">{s.titulo}</h3><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{s.orientacao}</p></li>)}</ul></details>}
 </section>;
}
