import { useState } from 'react';
import { useQuery,useMutation,useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Dialog,DialogContent,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { taxaCoorte,type PainelGestao } from '@shared/cobranca/gestao-operacional';
import { lerEquipe } from './tipos';

const BASE='/api/cobranca/gestao';
const dinheiro=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dia=(v:string)=>v.slice(0,10).split('-').reverse().join('/');
const btn='rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-2)] disabled:opacity-50';
const campo='w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';
async function ler<T>(url:string):Promise<T>{const r=await apiRequest('GET',url);return r.json();}
const secoes=[['agenda','Agenda de recebimentos'],['contestacoes','Contestações'],['diagnostico','Conferência do ERP'],['economia','Prioridade econômica'],['resultados','Resultados'],['preventivo','Avisos de vencimento']] as const;
type Secao=typeof secoes[number][0];

export function CentroGestao({carteira}:{carteira:'ativo'|'ex_cliente'}){
  const [aberto,setAberto]=useState(false),[secao,setSecao]=useState<Secao>('agenda');
  return <section className="gestao-centro">
    <button className={btn} type="button" aria-expanded={aberto} onClick={()=>setAberto(v=>!v)}>{aberto?'Recolher acompanhamento':'Acompanhamento financeiro e operacional'}</button>
    {aberto&&<div className="mt-4">
      <div role="tablist" aria-label="Acompanhamento da cobrança" className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2">{secoes.filter(([id])=>carteira==='ativo'||id!=='preventivo').map(([id,nome])=><button key={id} role="tab" aria-selected={secao===id} className={`${btn} ${secao===id?'bg-[var(--brand)] text-white':''}`} onClick={()=>setSecao(id)}>{nome}</button>)}</div>
      <ConteudoCentro key={carteira} carteira={carteira} secao={secao}/>
    </div>}
  </section>;
}
function ConteudoCentro({carteira,secao}:{carteira:'ativo'|'ex_cliente';secao:Secao}){
  const q=useQuery({queryKey:[BASE,carteira],queryFn:()=>ler<PainelGestao>(`${BASE}?carteira=${carteira}`),staleTime:15000});
  const [nova,setNova]=useState(false),[resolver,setResolver]=useState<number|null>(null);
  const [decisao,setDecisao]=useState('improcedente'),[justificativa,setJustificativa]=useState('');
  const qc=useQueryClient(),{toast}=useToast();
  const concluir=useMutation({mutationFn:()=>apiRequest('POST',`${BASE}/contestacoes/${resolver}/resolver`,{decisao,justificativa}),onSuccess:()=>{setResolver(null);setJustificativa('');void qc.invalidateQueries({queryKey:[BASE]});toast({title:'Decisão registrada',description:'A fatura não foi alterada. Confira as pendências no ERP.'});},onError:(e:Error)=>toast({title:'Não foi possível concluir',description:e.message,variant:'destructive'})});
  if(q.isPending)return <p className="py-6">Carregando acompanhamento…</p>;
  if(q.isError)return <div className="py-6"><p>Não foi possível carregar o acompanhamento.</p><button className={btn} onClick={()=>q.refetch()}>Tentar novamente</button></div>;
  const d=q.data; if(!d)return null;
  const cliente=(id:number,nome:string)=><Link className="text-[var(--brand)] underline underline-offset-2" href={`/cobranca/cliente/${id}?carteira=${carteira}`}>{nome}</Link>;
  const stats=(itens:[string,string][]) => <dl className="gestao-centro-metricas">{itens.map(([nome,valor])=><div key={nome}><dt>{nome}</dt><dd>{valor}</dd></div>)}</dl>;
  const tabela=(cabecalhos:string[],linhas:React.ReactNode[][])=><div className="gestao-centro-tabela"><table><thead><tr>{cabecalhos.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{linhas.length?linhas.map((l,i)=><tr key={i}>{l.map((c,j)=><td key={j}>{c}</td>)}</tr>):<tr><td colSpan={cabecalhos.length}>Nenhum registro neste recorte.</td></tr>}</tbody></table></div>;
  const taxa=(n:number,total:number)=>{const t=taxaCoorte(n,total);return t===null?'Sem base':`${t}% (${n}/${total})`;};
  const hoje=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return <div className="py-4 space-y-4" role="tabpanel">
    <p className="text-xs text-[var(--text-muted)]">Toda a carteira de {carteira==='ativo'?'clientes ativos':'ex-clientes'} · filtros do Kanban não alteram este acompanhamento · atualizado às {new Date(d.geradoEm).toLocaleTimeString('pt-BR')}</p>
    {Object.values(d.limites).some(Boolean)&&<p className="text-sm text-[var(--gated)]">Há mais registros que o limite desta consulta. Listas e simulações são parciais; indicadores de resultados usam consulta completa.</p>}
    {secao==='agenda'&&<>
      <h2 className="font-semibold text-lg">Compromissos e recebimentos</h2>
      <p className="text-sm text-[var(--text-muted)]">Parcelas de acordos aceitos, dos últimos 30 aos próximos 90 dias. Previsão não é dinheiro recebido. Promessas sem valor registrado aparecem separadas.</p>
      {stats([['Previsto em parcelas abertas',dinheiro(d.agenda.filter(p=>['pendente','atrasada'].includes(p.status)).reduce((s,p)=>s+Math.max(0,p.valor-(p.valorPago??0)),0))],['Confirmado em parcelas',dinheiro(d.agenda.filter(p=>p.pagoEm&&p.valorPago!==null).reduce((s,p)=>s+(p.valorPago??0),0))],['Promessas sem valor registrado',String(d.promessas.length)]])}
      {tabela(['Vencimento','Cliente','Acordo','Previsto','Confirmado','Situação'],d.agenda.map(p=>[dia(p.data),cliente(p.customerId,p.nome),`#${p.acordoId}`,dinheiro(p.valor),p.pagoEm?dinheiro(p.valorPago):'—',p.status==='paga'?'Pago':p.data<hoje?'Vencido':p.status==='pendente'?'A vencer':p.status]))}
      <h3 className="font-semibold">Promessas a conferir</h3>
      <p className="text-sm">Estas promessas não identificam fatura e valor. Confira o pagamento no Cliente 360; não presumimos cumprimento.</p>
      {tabela(['Data prometida','Cliente','Próxima ação'],d.promessas.map(p=>[dia(p.data),cliente(p.customerId,p.nome),p.data<hoje?'Conferir pagamento antes de retomar':'Respeitar a data combinada']))}
    </>}
    {secao==='contestacoes'&&<>
      <div className="flex justify-between gap-3 flex-wrap"><h2 className="font-semibold text-lg">Contestações por fatura</h2><button className={btn} onClick={()=>setNova(true)}>Registrar contestação</button></div>
      <p className="text-sm">Uma contestação aberta bloqueia novos envios ao cliente em WhatsApp, SMS e e-mail, mesmo após o prazo de análise. Mensagens já em trânsito podem concluir. A decisão não altera a fatura no ERP.</p>
      {stats([['Em análise',String(d.contestacoes.filter(c=>c.status==='aberta').length)],['Valor em análise',dinheiro(d.contestacoes.filter(c=>c.status==='aberta').reduce((s,c)=>s+c.valor,0))],['Análises com prazo vencido',String(d.contestacoes.filter(c=>c.status==='aberta'&&c.prazo<hoje).length)]])}
      {d.contestacoes.length===0&&<p className="text-sm py-4">Nenhuma contestação registrada nesta carteira.</p>}
      {d.contestacoes.map(c=><details className="rounded border border-[var(--border)] p-3" key={c.id}><summary className="cursor-pointer text-sm"><strong>{c.nome}</strong> · fatura #{c.faturaId} · {dinheiro(c.valor)} · {c.status} · prazo {dia(c.prazo)}</summary><div className="mt-3 space-y-2 text-sm"><p>Responsável: {c.responsavel} · motivo: {c.motivo}</p><p className="whitespace-pre-wrap">{c.relato}</p><p className="whitespace-pre-wrap">Evidência/referência: {c.evidencia||'Não informada'}</p>{c.justificativa&&<p>Decisão: {c.justificativa}</p>}{cliente(c.customerId,'Conferir Cliente 360')}{c.status==='aberta'&&<button className={`${btn} ml-3`} onClick={()=>setResolver(c.id)}>Registrar decisão</button>}</div></details>)}
      <NovaContestacao aberta={nova} fechar={()=>setNova(false)} carteira={carteira}/>
      <Dialog open={resolver!==null} onOpenChange={v=>!v&&setResolver(null)}><DialogContent><DialogHeader><DialogTitle>Concluir contestação #{resolver}</DialogTitle></DialogHeader><p className="text-sm">Conclusão disponível para administradores. Se procedente, corrija o ERP e retome o contato explicitamente no diário de comunicação.</p><label>Decisão<select className={campo} value={decisao} onChange={e=>setDecisao(e.target.value)}><option value="improcedente">Improcedente — cobrança validada</option><option value="procedente">Procedente — corrigir no ERP</option><option value="cancelada">Cancelada — registrar motivo</option></select></label><label>Justificativa<textarea className={campo} value={justificativa} onChange={e=>setJustificativa(e.target.value)} maxLength={4000}/></label><button className={btn} disabled={concluir.isPending||justificativa.trim().length<10} onClick={()=>concluir.mutate()}>Confirmar decisão</button></DialogContent></Dialog>
    </>}
    {secao==='diagnostico'&&<>
      <h2 className="font-semibold text-lg">Conferência do ERP</h2><p className="text-sm">Divergências entre dívida agregada e faturas exigem conferência. Sincronização acima de {d.config.syncMaxHoras} horas ou sem data é sinalizada. No máximo 200 clientes nesta lista; nenhuma baixa é feita aqui.</p>
      {tabela(['Cliente','Dívida no cadastro','Faturas vencidas','Em análise','Pontos a conferir'],d.diagnostico.map(c=>[cliente(c.id,c.nome),dinheiro(c.saldo),dinheiro(c.saldoFaturas),dinheiro(c.valorContestado),[c.divergencia?'Valores divergentes':null,c.syncPendente?'Sincronização antiga/ausente':null,c.aguardandoConfirmacao?`${c.aguardandoConfirmacao} baixa(s) sem confirmação`:null,c.pagamentosParciais?`${c.pagamentosParciais} pagamento(s) parcial(is)`:null].filter(Boolean).join(' · ')]))}
    </>}
    {secao==='economia'&&<>
      <h2 className="font-semibold text-lg">Prioridade econômica · simulação</h2><p className="text-sm">Cenário informado pelo provedor, aplicado igualmente à carteira. Não é previsão individual nem substitui a Economia do Cliente 360. Contestações abertas são excluídas da sugestão.</p>
      {stats([['Probabilidade hipotética',`${d.config.probabilidadeSimulada}%`],['Custo por contato',dinheiro(d.config.custoContato)],['Margem mensal hipotética',carteira==='ativo'?dinheiro(d.config.margemMensalSimulada):'Não se aplica']])}
      <p className="text-sm">Resultado = saldo × probabilidade − custo{carteira==='ativo'?` + margem mensal × ${d.config.mesesRetencao} meses × probabilidade`:''}. Probabilidade e margem são premissas, não dados observados. <Link className="underline" href="/painel-provedor?tab=cobranca#gestao-operacional">Ajustar premissas</Link></p>
      {tabela(['Cliente','Saldo elegível','Recuperação estimada','Margem preservada estimada','Resultado líquido simulado'],d.prioridades.map(c=>[cliente(c.id,c.nome),dinheiro(c.elegivel),dinheiro(c.simulacao.recuperacaoEsperada),dinheiro(c.simulacao.retencaoEstimada),dinheiro(c.simulacao.resultado)]))}
    </>}
    {secao==='resultados'&&<>
      <h2 className="font-semibold text-lg">Resultados observados</h2><p className="text-sm">Pagamentos com valor e data confirmados pelo ERP nos últimos 30 dias. Não atribuímos o recebimento a uma mensagem. A medição de contatos começa com esta atualização.</p>
      {stats([['Confirmado pelo ERP',dinheiro(d.resultados.confirmado)],['Faturas com pagamento confirmado',String(d.resultados.faturasPagas)],['Parcelas cumpridas no prazo',taxa(d.resultados.parcelasCumpridas,d.resultados.parcelasVencidas)],['Tempo médio de conferência',d.resultados.diasConferencia==null?'Sem base':`${d.resultados.diasConferencia.toFixed(1)} dias`]])}
      <h3 className="font-semibold">Cobertura do valor de abertura em 7 e 30 dias</h3><p className="text-sm">Casos abertos nos últimos 180 dias, com janela já concluída. Considera pagamentos confirmados dentro da janela que somam ao menos o valor de abertura. Exclui casos reabertos dentro da mesma janela. Não comprova quitação de títulos específicos nem retenção do cliente.</p>
      {tabela(['Janela concluída','Casos elegíveis','Valor coberto por pagamentos','Taxa'],[7,30].map(dias=>{const c=d.coortes.find(c=>c.dias===dias);return [`${dias} dias`,String(c?.elegiveis??0),String(c?.regularizados??0),taxa(c?.regularizados??0,c?.elegiveis??0)];}))}
      <h3 className="font-semibold">Uso dos canais · últimos 30 dias</h3>{tabela(['Canal','Tentativas','Aceitas pelo canal','Falhas','Pendentes/incertas'],d.contatos.map(c=>[c.canal,String(c.tentativas),String(c.enviados),String(c.falhas),String(c.incertos)]))}
      <p className="text-sm">Mensagens por fatura com pagamento confirmado: {d.resultados.faturasPagas? (d.contatos.reduce((s,c)=>s+c.enviados,0)/d.resultados.faturasPagas).toFixed(2):'sem base'}. Relação entre totais do período, sem vínculo causal. Promessas verbais sem fatura/valor não entram na taxa de cumprimento.</p>
    </>}
    {secao==='preventivo'&&d.preventivo&&<>
      <h2 className="font-semibold text-lg">Avisos de vencimento · próximos 7 dias</h2><p className="text-sm">Somente clientes ativos sem dívida vencida. {d.preventivo.config.ligada?'Opção habilitada pelo provedor.':'Opção desativada; nenhum disparo preventivo será iniciado por esta tela.'} <Link className="underline" href="/painel-provedor?tab=cobranca">Configurar avisos no Painel do Provedor</Link></p>
      {stats([['Faturas próximas',String(d.preventivo.faturas)],['Clientes',String(d.preventivo.clientes)],['Faturas com aviso enviado',String(d.preventivo.avisadas)],['Faturas com contato pausado',String(d.preventivo.pausadas)]])}
      <p className="text-sm">Canal configurado: {d.preventivo.config.canal??'WhatsApp'}. Faturas de clientes sem telefone completo: {d.preventivo.semTelefone}. Limite diário: {d.preventivo.config.limiteDiario??'conferir configuração'}.</p>
      <p className="text-sm">{d.preventivo.config.incluirLinkFatura?'Link da fatura solicitado na configuração.':'Envio do link da fatura não habilitado.'} Boleto/PIX depende de confirmação no ERP na hora do envio; não inferimos disponibilidade só pela existência da fatura. A automação mantém as verificações de opt-out, identificação e janela de contato.</p>
      <Link className="underline text-sm" href={`/cobranca/comunicacoes?carteira=${carteira}`}>Consultar falhas e histórico no diário</Link>
    </>}
  </div>;
}
function NovaContestacao({aberta,fechar,carteira}:{aberta:boolean;fechar:()=>void;carteira:string}){
  const [busca,setBusca]=useState(''),[termo,setTermo]=useState(''),[faturaId,setFatura]=useState(''),[motivo,setMotivo]=useState('valor'),[relato,setRelato]=useState(''),[evidencia,setEvidencia]=useState(''),[responsavelId,setResponsavel]=useState(''),[prazo,setPrazo]=useState('');
  const qc=useQueryClient(),{toast}=useToast();
  const faturas=useQuery({queryKey:[BASE,'faturas',termo,carteira],queryFn:()=>ler<{id:number;nome:string;valor:number}[]>(`${BASE}/faturas?busca=${encodeURIComponent(termo)}&carteira=${carteira}`),enabled:aberta&&termo.length>=2});
  const equipe=useQuery({queryKey:['/api/cobranca/equipe'],queryFn:()=>ler<unknown>('/api/cobranca/equipe'),enabled:aberta});
  const membros=lerEquipe(equipe.data);
  const gravar=useMutation({mutationFn:()=>apiRequest('POST',`${BASE}/contestacoes`,{faturaId:Number(faturaId),motivo,relato,evidencia,responsavelId:Number(responsavelId),prazo}),onSuccess:()=>{void qc.invalidateQueries({queryKey:[BASE]});setRelato('');setEvidencia('');setFatura('');fechar();toast({title:'Contestação registrada',description:'Novos envios ao cliente estão bloqueados até a análise.'});},onError:(e:Error)=>toast({title:'Não foi possível registrar',description:e.message,variant:'destructive'})});
  return <Dialog open={aberta} onOpenChange={v=>!v&&fechar()}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Registrar contestação</DialogTitle></DialogHeader>
    <label>Localizar fatura pelo cliente ou número<div className="flex gap-2"><input className={campo} value={busca} onChange={e=>setBusca(e.target.value)} /><button className={btn} disabled={busca.trim().length<2||faturas.isFetching} onClick={()=>{setFatura('');setTermo(busca.trim());}}>Buscar</button></div></label>
    {faturas.isError&&<p role="alert">Falha ao consultar as faturas.</p>}
    <label>Fatura<select className={campo} value={faturaId} onChange={e=>setFatura(e.target.value)}><option value="">Selecione a fatura</option>{faturas.data?.map(f=><option key={f.id} value={f.id}>#{f.id} · {f.nome} · {dinheiro(f.valor)}</option>)}</select></label>
    <label>Motivo<select className={campo} value={motivo} onChange={e=>setMotivo(e.target.value)}>{[['valor','Valor divergente'],['pagamento','Pagamento já realizado'],['servico','Serviço contestado'],['duplicidade','Duplicidade'],['titularidade','Titularidade'],['outro','Outro']].map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
    <label>Relato<textarea className={campo} value={relato} onChange={e=>setRelato(e.target.value)} maxLength={4000}/></label>
    <label>Evidência ou referência do atendimento<textarea className={campo} value={evidencia} onChange={e=>setEvidencia(e.target.value)} maxLength={2000} placeholder="Descreva a evidência e o protocolo ou localização do comprovante."/></label>
    <div className="grid grid-cols-2 gap-3"><label>Responsável<select className={campo} value={responsavelId} onChange={e=>setResponsavel(e.target.value)}><option value="">Selecione</option>{membros.map(m=><option key={m.id} value={m.id}>{m.nome}</option>)}</select></label><label>Prazo de análise<input className={campo} type="date" value={prazo} onChange={e=>setPrazo(e.target.value)}/></label></div>
    <p className="text-xs">Bloqueia novos envios ao cliente. Não dá baixa nem reduz o saldo da fatura. Evidências são referências textuais; arquivos permanecem no atendimento de origem.</p>
    <button className={btn} disabled={gravar.isPending||!faturaId||!responsavelId||!prazo||relato.trim().length<10} onClick={()=>gravar.mutate()}>Registrar e pausar contatos</button>
  </DialogContent></Dialog>;
}
