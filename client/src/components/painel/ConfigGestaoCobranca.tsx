import { useState } from 'react';
import { useQuery,useMutation,useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { ConfigGestaoSchema,type ConfigGestao } from '@shared/cobranca/gestao-operacional';
const url='/api/cobranca/gestao/config';
const campos:{chave:keyof ConfigGestao;nome:string;ajuda:string}[]=[
 {chave:'maxMensagensDia',nome:'Mensagens por cliente/dia',ajuda:'Soma WhatsApp, SMS e e-mail, de humanos e agentes. De 1 a 100.'},
 {chave:'maxIniciativasSemana',nome:'Iniciativas por cliente/7 dias',ajuda:'Primeiros contatos e reforços automáticos. Respostas na conversa usam o limite diário. De 1 a 14.'},
 {chave:'syncMaxHoras',nome:'Alerta de sincronização (horas)',ajuda:'A partir de quantas horas sinalizar dados antigos. De 1 a 720.'},
 {chave:'custoContato',nome:'Custo estimado por contato (R$)',ajuda:'Premissa de simulação; não altera preço ou custo real.'},
 {chave:'probabilidadeSimulada',nome:'Probabilidade hipotética (%)',ajuda:'Cenário único para comparar casos. Não é score individual.'},
 {chave:'margemMensalSimulada',nome:'Margem mensal hipotética (R$)',ajuda:'Somente para clientes ativos; confira a economia real no Cliente 360.'},
 {chave:'mesesRetencao',nome:'Meses de retenção simulados',ajuda:'Horizonte da simulação, de 0 a 24 meses.'},
];
export function ConfigGestaoCobranca({podeEditar}:{podeEditar:boolean}){
 const q=useQuery({queryKey:[url],queryFn:async()=>ConfigGestaoSchema.parse(await (await apiRequest('GET',url)).json())});
 const [editado,setEditado]=useState<ConfigGestao|null>(null);const valor=editado??q.data;
 const qc=useQueryClient(),{toast}=useToast();
 const salvar=useMutation({mutationFn:async()=>{const p=ConfigGestaoSchema.parse(valor);return (await apiRequest('PUT',url,p)).json();},onSuccess:()=>{setEditado(null);void qc.invalidateQueries({queryKey:[url]});void qc.invalidateQueries({queryKey:['/api/cobranca/gestao']});toast({title:'Limites e premissas salvos'});},onError:()=>toast({title:'Não foi possível salvar',description:'Confira os limites informados e tente novamente.',variant:'destructive'})});
 return <details id="gestao-operacional" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><summary className="cursor-pointer font-semibold">Controle de contatos e prioridade econômica</summary><div className="mt-4 space-y-4"><p className="text-sm">Limites compartilhados pelos canais integrados. Contestações e opt-out bloqueiam novos envios; respostas e comprovantes pausam a iniciativa automática. A simulação econômica auxilia a equipe e não muda dívida, desconto ou dados do Cliente 360.</p>{q.isError?<button onClick={()=>q.refetch()}>Falha ao carregar · tentar novamente</button>:!valor?<p>Carregando…</p>:<><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{campos.map(c=><label key={c.chave} className="text-sm">{c.nome}<input className="block w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 mt-1" type="number" min={0} step="any" disabled={!podeEditar||salvar.isPending} value={Number.isFinite(valor[c.chave])?valor[c.chave]:''} onChange={e=>setEditado({...valor,[c.chave]:e.target.value===''?NaN:Number(e.target.value)})}/><span className="block text-xs text-[var(--text-muted)] mt-1">{c.ajuda}</span></label>)}</div><button className="rounded bg-[var(--brand)] text-white px-4 py-2 text-sm disabled:opacity-50" disabled={!podeEditar||!editado||salvar.isPending||!ConfigGestaoSchema.safeParse(valor).success} onClick={()=>salvar.mutate()}>Salvar limites e premissas</button></>}</div></details>;
}
