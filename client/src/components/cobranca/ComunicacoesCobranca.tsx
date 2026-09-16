import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { type ComunicacaoConfig } from "@shared/cobranca/comunicacao";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, CONTROLE_CAMPO } from "@/components/painel/ui";
import { invalidarCobranca } from "@/components/cobranca/ui";

const API='/api/cobranca/comunicacoes';
interface Item {id:number;customerId:number;cliente:string;canal:string;finalidade:string;status:string;motivo:string|null;criadoEm:string;casoId:number|null}
interface Resposta {config:ComunicacaoConfig;itens:Item[]}
interface Previa {elegiveis:number;avaliados:number;limitado:boolean;janelaPermitida:boolean;canalPronto:boolean;politicaPausada:boolean;usadosHoje:number;motivos:Record<string,number>}
const NOMES:Record<string,string>={enviando:'Aguardando confirmação',enviado:'Aceita pelo fornecedor',falhou:'Falha no envio',incerto:'Conferir envio',ignorado:'Não enviado'};

export function ComunicacoesCobranca({podeEditar=false,operacao=false,carteira}:{podeEditar?:boolean;operacao?:boolean;carteira?:'ativo'|'ex_cliente'}) {
  const {toast}=useToast();const qc=useQueryClient();
  const q=useQuery<Resposta>({queryKey:[carteira?`${API}?carteira=${carteira}`:API],staleTime:15000});
  const [rascunho,setRascunho]=useState<ComunicacaoConfig|null>(null);
  const config=rascunho??q.data?.config;
  const [previa,setPrevia]=useState<Previa|null>(null);
  const erro=(e:Error)=>toast({title:'Não foi possível concluir',description:e.message,variant:'destructive'});
  const salvar=useMutation({mutationFn:async()=>{const r=await apiRequest('PUT',`${API}/config`,config);return r.json() as Promise<ComunicacaoConfig>;},onSuccess:c=>{setRascunho(c);setPrevia(null);qc.invalidateQueries({queryKey:[API]});toast({title:'Configuração salva'});},onError:erro});
  const simular=useMutation({mutationFn:async()=>{const r=await apiRequest('POST',`${API}/simular`,{});return r.json() as Promise<Previa>;},onSuccess:setPrevia,onError:erro});
  const preferencia=useMutation({mutationFn:async(d:{id:number;acao:string})=>{const r=await apiRequest('POST',`${API}/clientes/${d.id}/preferencia`,{acao:d.acao});return r.json();},onSuccess:()=>{invalidarCobranca();qc.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith(API)});toast({title:'Preferência registrada',description:'Nenhuma baixa financeira realizada.'});},onError:erro});
  if(q.isLoading)return <p>Carregando comunicações…</p>;
  if(q.isError||!config)return <p role="alert">Não foi possível carregar as comunicações. <button onClick={()=>q.refetch()} className="underline">Tentar novamente</button></p>;
  const editar=(patch:Partial<ComunicacaoConfig>)=>setRascunho({...config,...patch});
  return <section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5" data-testid="comunicacoes-cobranca">
    <div><h2 className="text-lg font-semibold">{operacao?'Diário de comunicação':'Cobrança por SMS e e-mail'}</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Acompanhe mensagens e pausas por cliente. Aceitação pelo fornecedor não confirma entrega, resposta ou pagamento.</p></div>
    {!operacao&&<>
      <fieldset disabled={!podeEditar||salvar.isPending} className="space-y-4 disabled:opacity-70">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.ligada} onChange={e=>editar({ligada:e.target.checked})}/>Ativar contatos automáticos de cobrança neste provedor</label>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm">Canal<select className={`${CONTROLE_CAMPO} mt-1 w-full`} value={config.canal} onChange={e=>editar({canal:e.target.value as 'sms'|'email'})}><option value="email">E-mail</option><option value="sms">SMS</option></select></label>
          <label className="text-sm">Limite diário<input type="number" min={1} max={10000} className={`${CONTROLE_CAMPO} mt-1 w-full`} value={config.limiteDiario} onChange={e=>editar({limiteDiario:Number(e.target.value)})}/></label>
          <label className="text-sm">Intervalo mínimo entre contatos (dias)<input type="number" min={1} max={30} className={`${CONTROLE_CAMPO} mt-1 w-full`} value={config.intervaloDias} onChange={e=>editar({intervaloDias:Number(e.target.value)})}/></label>
        </div>
        <div className="flex gap-5 text-sm">{(['ativo','ex_cliente'] as const).map(c=><label key={c} className="flex items-center gap-2"><input type="checkbox" checked={config.carteiras.includes(c)} onChange={e=>editar({carteiras:e.target.checked?[...config.carteiras,c]:config.carteiras.filter(x=>x!==c)})}/>{c==='ativo'?'Clientes ativos':'Ex-clientes'}</label>)}</div>
        <button type="button" onClick={()=>salvar.mutate()} className={BOTAO_MARCA}>{salvar.isPending?'Salvando…':'Salvar configuração'}</button>
      </fieldset>
      <p className="text-xs text-[var(--text-muted)]">Primeiro contato sem valores ou documentos. A régua seleciona os casos; acordos, revisões humanas, conversas abertas e pausas impedem o envio automático. Respostas de e-mail seguem para a caixa configurada (ou para o chat, com domínio e webhook de recebimento); respostas de SMS entram no chat quando a URL de recebimento estiver configurada na Twilio e aqui — sem ela, o canal é só envio.</p>
      <button type="button" disabled={simular.isPending} className={BOTAO_SECUNDARIO} onClick={()=>simular.mutate()}>Simular configuração salva · sem enviar</button>
      {previa&&<div className="rounded-lg bg-[var(--surface-2)] p-4 text-sm" role="status"><b>{previa.elegiveis} elegíveis de {previa.avaliados} clientes avaliados</b><p>{previa.canalPronto?'Canal configurado':'Canal ainda não está pronto'} · {previa.janelaPermitida?'Dentro do horário':'Fora do horário de contato'}{previa.politicaPausada?' · Política pausada':''} · {previa.usadosHoje} reservas hoje</p>{previa.limitado&&<p>Amostra limitada a 10.000 clientes.</p>}<ul className="mt-2 space-y-1">{Object.entries(previa.motivos).map(([motivo,n])=><li key={motivo}>{n} · {motivo}</li>)}</ul></div>}
    </>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--border)]"><th className="p-2">Cliente / data</th><th className="p-2">Canal</th><th className="p-2">Situação</th><th className="p-2">Acompanhamento</th></tr></thead><tbody>{q.data?.itens.map(i=><tr key={i.id} className="border-b border-[var(--border)]"><td className="p-2 font-medium">{i.cliente}<span className="block text-xs font-normal text-[var(--text-muted)]">{new Date(i.criadoEm).toLocaleString('pt-BR')}</span></td><td className="p-2">{i.canal==='email'?'E-mail':i.canal.toUpperCase()}<span className="block text-xs">{i.finalidade==='preventivo'?'Aviso de fatura':'Cobrança'}</span></td><td className="p-2">{NOMES[i.status]??i.status}<span className="block max-w-xs text-xs text-[var(--text-muted)]">{i.motivo}</span></td><td className="p-2"><select aria-label={`Registrar atendimento de ${i.cliente}`} value="" disabled={preferencia.isPending} onChange={e=>{if(e.target.value)preferencia.mutate({id:i.customerId,acao:e.target.value});}} className={CONTROLE_CAMPO}><option value="">Registrar ação…</option><option value="respondeu">Cliente respondeu · pausar 48h</option><option value="pagamento_informado">Informou pagamento · conferir em 48h</option><option value="nao_contatar">Não contatar automaticamente</option><option value="retomar">Retomar automação</option></select></td></tr>)}</tbody></table></div>
    {!q.data?.itens.length&&<p className="py-4 text-sm text-[var(--text-muted)]">Nenhum envio registrado. Conecte o canal, simule os contatos e configure a automação no Painel do Provedor.</p>}
    <p className="text-xs text-[var(--text-muted)]">Últimos 100 registros. Envios sem confirmação ficam reservados para evitar repetição. <Link href="/painel-provedor?tab=cobranca" className="underline">Configurações de cobrança</Link></p>
  </section>;
}
