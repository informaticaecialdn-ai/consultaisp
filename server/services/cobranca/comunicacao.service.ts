import { comOrcamentoContato, contatoComResultado } from "./gestao-operacional.service";
import { pool } from "../../db";
import { storage } from "../../storage";
import { logger } from "../../logger";
import { CobrancaPreventivoStorage } from "../../storage/cobranca-preventivo.storage";
import * as diario from "../../storage/cobranca-comunicacao.storage";
import { destinatarioComunicacao, motivoExclusaoComunicacao, textoComunicacao } from "@shared/cobranca/comunicacao";
import { janelaDoChat } from "@shared/cobranca/automacao-chat";
import { resolverEtapas } from "@shared/cobranca/regua";
import { planejarPreAviso } from "@shared/cobranca/preventivo";
import { comTravaDoChat } from "../chat/chat-trava";
import { executarPreAviso } from "../chat/chat-preventivo.service";
import { enviarComunicacaoCobranca, obterConfiguracaoCanais } from "./canais-comunicacao.service";
import { obterPagamentoFatura } from "./pagamento-fatura.service";
import { executarReforcosMulticanal } from '../chat/chat-multicanal.service';

export async function previaComunicacao(providerId:number,agora=new Date()) {
  const config=await diario.configComunicacao(providerId);
  const politica=await storage.getPoliticaDeCobranca(providerId);
  const canais=await obterConfiguracaoCanais(providerId);
  const janela=janelaDoChat(agora,politica?.janelaContato);
  const candidatos=await diario.candidatosComunicacao(providerId);
  const motivos:Record<string,number>={};
  const canal=canais[config.canal];
  const itens=candidatos.slice(0,10000).map(c=>{
    const motivo=motivoExclusaoComunicacao(c,config,agora,resolverEtapas(politica)) ?? (!destinatarioComunicacao(c,config.canal)?'Contato inválido para o canal selecionado':null);
    if(motivo) motivos[motivo]=(motivos[motivo]??0)+1;
    return {customerId:c.customerId,cliente:c.nome,casoId:c.casoId,carteira:c.carteira,elegivel:!motivo,motivo};
  });
  return {config,janelaPermitida:janela.permitida,politicaPausada:politica?.pausada===true,canalPronto:canal.ativado&&canal.configurado,
    elegiveis:itens.filter(i=>i.elegivel).length,avaliados:itens.length,limitado:candidatos.length>10000,motivos,itens:itens.slice(0,100),
    usadosHoje:await diario.consumoComunicacao(providerId,janela.dia,'cobranca')};
}

/** Agenda complementar ao WhatsApp. Serializada pela mesma trava de provedor, sem abrir transação durante rede. */
export async function executarComunicacoes(agora=new Date()) {
  // Preserva o relógio injetado em ensaios, mas avança durante chamadas lentas.
  const inicio=Date.now();
  const relogio=()=>new Date(agora.getTime()+Math.max(0,Date.now()-inicio));
  for(const providerId of await diario.provedoresComunicacao()) {
    try {await comTravaDoChat(`agenda:${providerId}`,async()=>{
      const politica=await storage.getPoliticaDeCobranca(providerId);
      if(politica?.pausada) return;
      const janela=janelaDoChat(relogio(),politica?.janelaContato);
      if(!janela.permitida) return;
      const pr=await pool.query<{name:string}>("select name from providers where id=$1 and status='active'",[providerId]);
      const nome=pr.rows[0]?.name;
      if(!nome) return;
      const config=await diario.configComunicacao(providerId);
      const fila=new CobrancaPreventivoStorage();
      const avisosConfig=await fila.obterConfigAvisos(providerId);
      // No máximo cinco requisições externas por rodada/provedor, com limites diários distintos.
      let vagas=5;
      if(avisosConfig?.ligada) {
        await fila.prepararPreAvisos(providerId,agora,resolverEtapas(politica),avisosConfig.diasAntes);
        const avisos=await fila.listarPreAvisosPendentes(providerId,janela.dia,100);
        const admin=avisosConfig.canal==='whatsapp'?(await storage.getUsersByProvider(providerId)).find(u=>u.role==='admin'):null;
        for(const aviso of avisos) {
          if(vagas<=0 || await diario.consumoComunicacao(providerId,janela.dia,'preventivo')>=avisosConfig.limiteDiario) break;
          const vigente=await fila.obterConfigAvisos(providerId);
          if(!vigente?.ligada || vigente.canal!==avisosConfig.canal) break;
          const politicaAtual=await storage.getPoliticaDeCobranca(providerId);
          const atual=janelaDoChat(relogio(),politicaAtual?.janelaContato);
          if(politicaAtual?.pausada||!atual.permitida||atual.dia!==janela.dia)break;
          if(!planejarPreAviso(providerId,{id:aviso.faturaId,status:aviso.status,vencimento:aviso.vencimento,valor:Number(aviso.valor)},janela.dia,undefined,vigente.diasAntes))continue;
          const candidato=(await diario.candidatosComunicacao(providerId,aviso.customerId))[0];
          if(!candidato || candidato.naoContatar || candidato.conversaAtiva || candidato.statusCliente!=='active'||candidato.saldo>0
            || (candidato.pausaAte&&new Date(candidato.pausaAte)>relogio())
            || (candidato.ultimoContato&&new Date(candidato.ultimoContato)>=atual.inicioDoDia)) continue;
          if(vigente.canal==='whatsapp') {
            if(await fila.contatosReservadosNoDia(providerId,janela.dia)>=vigente.limiteDiario) break;
            if(!admin) break;
            const r=await executarPreAviso(providerId,aviso.id,admin.id,janela.dia);
            if(r.enviado) vagas--;
            continue;
          }
          const destino=destinatarioComunicacao(candidato,vigente.canal);
          if(!destino) continue;
          const canais=await obterConfiguracaoCanais(providerId);
          if(!canais[vigente.canal].ativado||!canais[vigente.canal].configurado) break;
          // Reserva por pessoa/dia impede um disparo por cada título do mesmo cliente.
          const chave=`preventivo:${aviso.faturaId}:${janela.dia}`;
          const id=await diario.reservarComunicacao({providerId,customerId:aviso.customerId,casoId:null,faturaId:aviso.faturaId,canal:vigente.canal,finalidade:'preventivo',dia:janela.dia,chave});
          if(!id)continue;
          if(!await fila.reservarPreAviso(providerId,aviso.id,janela.dia)) {await diario.concluirComunicacao(providerId,id,{status:'ignorado',motivo:'Fatura mudou antes do envio'});continue;}
          // A leitura ERP pode demorar: todas as permissões e o relógio são
          // conferidos DEPOIS dela, nunca reaproveitados do início da chamada.
          const pagamento=vigente.incluirLinkFatura?await obterPagamentoFatura(providerId,aviso.customerId,aviso.faturaId):null;
          const [finalConfig,finalPolitica,finalCanais,finalClientes,fatura]=await Promise.all([
            fila.obterConfigAvisos(providerId),storage.getPoliticaDeCobranca(providerId),obterConfiguracaoCanais(providerId),
            diario.candidatosComunicacao(providerId,aviso.customerId,{comunicacaoId:id,preAvisoId:aviso.id}),
            diario.faturaAtualComunicacao(providerId,aviso.customerId,aviso.faturaId),
          ]);
          const finalHora=relogio();
          const finalJanela=janelaDoChat(finalHora,finalPolitica?.janelaContato);
          const cliente=finalClientes[0];
          const destinoFinal=cliente?destinatarioComunicacao(cliente,vigente.canal):null;
          const podeEnviar=finalConfig?.ligada&&finalConfig.canal===vigente.canal&&!finalPolitica?.pausada
            &&finalJanela.permitida&&finalJanela.dia===janela.dia&&cliente&&!cliente.naoContatar&&!cliente.conversaAtiva
            &&cliente.statusCliente==='active'&&cliente.saldo<=0&&(!cliente.pausaAte||new Date(cliente.pausaAte)<=finalHora)
            &&(!cliente.ultimoContato||new Date(cliente.ultimoContato)<finalJanela.inicioDoDia)
            &&finalCanais[vigente.canal].ativado&&finalCanais[vigente.canal].configurado&&fatura
            &&planejarPreAviso(providerId,fatura,janela.dia,undefined,finalConfig.diasAntes)
            &&await diario.consumoComunicacao(providerId,janela.dia,'preventivo')<=finalConfig.limiteDiario;
          if(!podeEnviar||!destinoFinal||!finalConfig){
            const motivo='Fatura, contato, janela ou configuração mudou antes do envio';
            await diario.concluirComunicacao(providerId,id,{status:'ignorado',motivo});
            await fila.concluirPreAviso(providerId,aviso.id,{status:'ignorado',motivo});continue;
          }
          let texto=textoComunicacao(nome,'preventivo');
          if(finalConfig.incluirLinkFatura){
            const j=janelaDoChat(relogio(),finalPolitica?.janelaContato);
            if(!pagamento||!j.permitida||j.dia!==janela.dia){
              const motivo='Link da fatura não confirmado no ERP ou janela de contato encerrada';
              await diario.concluirComunicacao(providerId,id,{status:'ignorado',motivo});
              await fila.concluirPreAviso(providerId,aviso.id,{status:'ignorado',motivo});continue;
            }
            texto+=` Consulte sua fatura: ${pagamento.link}`;
          }
          if(!janelaDoChat(relogio(),finalPolitica?.janelaContato).permitida){
            const motivo='Janela de contato encerrada antes do envio';
            await diario.concluirComunicacao(providerId,id,{status:'ignorado',motivo});
            await fila.concluirPreAviso(providerId,aviso.id,{status:'ignorado',motivo});continue;
          }
          const canalEnvio=vigente.canal;
          const r=await contatoComResultado(()=>comOrcamentoContato(providerId,aviso.customerId,canalEnvio,true,()=>enviarComunicacaoCobranca(providerId,{canal:canalEnvio,destinatario:destinoFinal,assunto:`Faturas · ${nome}`,texto,idempotencyKey:`cisp:${providerId}:${id}`}),`diario:${id}`));
          await diario.concluirComunicacao(providerId,id,r);
          // Bloqueio anterior ao transporte não tem id do fornecedor: nada saiu.
          await fila.concluirPreAviso(providerId,aviso.id,{status:r.status==='enviado'?'enviado':r.status==='incerto'?'incerto':'ignorado',messageId:'providerMessageId' in r?r.providerMessageId:undefined,motivo:r.motivo??'Mensagem aceita pelo fornecedor; entrega não confirmada'});
          vagas--;
        }
      }
      if(!config.ligada||vagas<=0) return;
      const etapas=resolverEtapas(politica);
      // A carteira inteira é filtrada em memória; somente elegíveis são relidos.
      // O teto impede milhares de consultas quando reservas concorrentes vencem.
      const selecionados=(await diario.candidatosComunicacao(providerId))
        .filter(c=>!motivoExclusaoComunicacao(c,config,relogio(),etapas)&&destinatarioComunicacao(c,config.canal)).slice(0,100);
      for(const item of selecionados) {
        if(vagas<=0)break;
        const vigente=await diario.configComunicacao(providerId);
        if(!vigente.ligada||vigente.canal!==config.canal||await diario.consumoComunicacao(providerId,janela.dia,'cobranca')>=vigente.limiteDiario)break;
        const politicaAtual=await storage.getPoliticaDeCobranca(providerId);
        const atual=janelaDoChat(relogio(),politicaAtual?.janelaContato);
        if(politicaAtual?.pausada||!atual.permitida||atual.dia!==janela.dia) break;
        const c=(await diario.candidatosComunicacao(providerId,item.customerId))[0];
        if(!c||motivoExclusaoComunicacao(c,vigente,relogio(),resolverEtapas(politicaAtual)))continue;
        const destino=destinatarioComunicacao(c,vigente.canal);
        if(!destino)continue;
        const canais=await obterConfiguracaoCanais(providerId);
        if(!canais[vigente.canal].ativado||!canais[vigente.canal].configurado)break;
        const id=await diario.reservarComunicacao({providerId,customerId:c.customerId,casoId:c.casoId,faturaId:null,canal:vigente.canal,finalidade:'cobranca',dia:janela.dia,chave:`cobranca:${c.casoId}:${janela.dia}`});
        if(!id)continue;
        const [finalConfig,finalPolitica,finalCanais,finalClientes]=await Promise.all([
          diario.configComunicacao(providerId),storage.getPoliticaDeCobranca(providerId),obterConfiguracaoCanais(providerId),
          diario.candidatosComunicacao(providerId,c.customerId,{comunicacaoId:id}),
        ]);
        const finalHora=relogio();
        const finalJanela=janelaDoChat(finalHora,finalPolitica?.janelaContato);
        const cliente=finalClientes[0];
        const destinoFinal=cliente?destinatarioComunicacao(cliente,vigente.canal):null;
        const podeEnviar=finalConfig.ligada&&finalConfig.canal===vigente.canal&&!finalPolitica?.pausada
          &&finalJanela.permitida&&finalJanela.dia===janela.dia&&cliente&&cliente.casoId===c.casoId
          &&!motivoExclusaoComunicacao(cliente,finalConfig,finalHora,resolverEtapas(finalPolitica))
          &&finalCanais[vigente.canal].ativado&&finalCanais[vigente.canal].configurado
          &&await diario.consumoComunicacao(providerId,janela.dia,'cobranca')<=finalConfig.limiteDiario;
        if(!podeEnviar||!destinoFinal){await diario.concluirComunicacao(providerId,id,{status:'ignorado',motivo:'Saldo, contato, janela ou configuração mudou antes do envio'});continue;}
        if(!janelaDoChat(relogio(),finalPolitica?.janelaContato).permitida){await diario.concluirComunicacao(providerId,id,{status:'ignorado',motivo:'Janela de contato encerrada antes do envio'});continue;}
        const r=await contatoComResultado(()=>comOrcamentoContato(providerId,c.customerId,vigente.canal,true,()=>enviarComunicacaoCobranca(providerId,{canal:vigente.canal,destinatario:destinoFinal,assunto:`Atendimento · ${nome}`,texto:textoComunicacao(nome,'cobranca'),idempotencyKey:`cisp:${providerId}:${id}`}),`diario:${id}`));
        await diario.concluirComunicacao(providerId,id,r);
        vagas--;
      }
    });}catch {logger.warn({providerId},'Comunicação interrompida; reservas preservadas para conferência no diário');}
  }
}

let timer: ReturnType<typeof setInterval> | null=null;
let rodada: Promise<void> | null=null;
export function iniciarComunicacoes() {
  if(timer)return;
  timer=setInterval(()=>{if(!rodada)rodada=executarComunicacoes().then(()=>executarReforcosMulticanal()).catch(()=>logger.warn('Agenda de comunicação indisponível')).finally(()=>{rodada=null;});},60000);
  timer.unref();
}
export async function pararComunicacoes(){if(timer)clearInterval(timer);timer=null;await rodada;}
