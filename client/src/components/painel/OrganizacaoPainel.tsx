import { useState } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowUpRight, Building2, Cable, CreditCard, ShieldCheck, Sparkles, Search, LayoutDashboard, X } from "lucide-react";

export const CATEGORIAS_PAINEL = [
 {id:"empresa",titulo:"Empresa e identidade",icon:Building2,descricao:"Cadastro, documentos e endereço do seu portal.",itens:[
  {id:"empresa",titulo:"Dados da empresa",descricao:"Dados fiscais, contato e endereço.",busca:"cnpj razão social telefone cep email",ajuda:"Confira os dados cadastrais e o endereço. O CNPJ é somente leitura; use Salvar dados ao terminar."},
  {id:"socios",titulo:"Sócios e responsáveis",descricao:"Quem representa a empresa.",busca:"socio cpf responsável",ajuda:"Cadastre os responsáveis e revise as informações antes de adicionar ou editar um sócio."},
  {id:"documentos",titulo:"Documentos",descricao:"Arquivos e verificação cadastral.",busca:"contrato comprovante upload kyc",ajuda:"Escolha o tipo do documento, confira o arquivo e acompanhe o resultado da verificação."},
  {id:"subdominio",titulo:"Portal e endereço web",descricao:"Endereço de acesso da sua empresa.",busca:"site dominio subdomínio marca",ajuda:"Confira o endereço do portal e as opções disponíveis no seu plano."}]},
 {id:"conexoes",titulo:"Conexões e canais",icon:Cable,descricao:"Integre os dados e conecte o atendimento.",itens:[
  {id:"integracao",titulo:"ERP e sincronização",descricao:"Conexões e atualização dos clientes.",busca:"ixc mk sga api token integração",ajuda:"Confira o estado das conexões, a última sincronização e as pendências de cada ERP."},
  {id:"chat",titulo:"WhatsApp e chat",descricao:"Números, canais e provedores de mensagens.",busca:"zappfy uazapi datafy webhook qr token",ajuda:"Escolha o provedor do canal, informe os dados da conexão e confirme o pareamento do número."}]},
 {id:"operacao",titulo:"Cobrança e automação",icon:Sparkles,descricao:"Defina as regras e o trabalho dos agentes.",itens:[
  {id:"cobranca",titulo:"Políticas de cobrança",descricao:"Condições, limites e regras de operação.",busca:"regua dna juros multa desconto acordo",ajuda:"Defina as condições permitidas antes de ativar as automações. Confira o alcance de cada regra."},
  {id:"agentes",titulo:"Agentes de IA",descricao:"Comportamento, autonomia e atendimento humano.",busca:"prompt bot inteligência transferência autonomia",ajuda:"Configure o comportamento e os limites de cada agente. Conecte o canal em WhatsApp e chat antes de operar."}]},
 {id:"seguranca",titulo:"Equipe e segurança",icon:ShieldCheck,descricao:"Controle acessos e proteja a operação.",itens:[
  {id:"usuarios",titulo:"Usuários e acessos",descricao:"Pessoas e permissões da equipe.",busca:"senha operador convite email administrador",ajuda:"Escolha a função de cada pessoa antes de adicionar o usuário. As permissões definem o que ela pode alterar."},
  {id:"anti-fraude",titulo:"Proteção antifraude",descricao:"Alertas e monitoramento de risco.",busca:"fraude fuga alerta risco",ajuda:"Revise os critérios dos alertas e os controles disponíveis para o provedor."},
  {id:"suporte",titulo:"Acesso do suporte",descricao:"Autorizações de atendimento técnico.",busca:"suporte sessão temporária permissão",ajuda:"Confira o alcance e a duração antes de autorizar o acesso do suporte."}]},
 {id:"plano",titulo:"Plano e consumo",icon:CreditCard,descricao:"Acompanhe créditos, uso e assinatura.",itens:[
  {id:"creditos",titulo:"Créditos e assinatura",descricao:"Saldo, consumo e condições do plano.",busca:"saldo preço pagamento plano financeiro",ajuda:"Consulte o saldo e o consumo antes de comprar créditos ou avaliar um plano."}]},
];
const normalizar=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
export function categoriasDoPainel(busca:string,podeSuporte:boolean) {
 return CATEGORIAS_PAINEL.map(c=>({...c,itens:c.itens.filter(i=>(podeSuporte||i.id!=="suporte")&&normalizar(c.titulo+' '+i.titulo+' '+i.busca).includes(normalizar(busca.trim())))})).filter(c=>c.itens.length);
}
export function NavegacaoPainel({podeSuporte}:{podeSuporte:boolean}) {
 const [busca,setBusca]=useState("");const categorias=categoriasDoPainel(busca,podeSuporte);
 return <aside className="pp-nav" aria-label="Categorias de configurações">
  <label className="pp-search"><Search size={16}/><input aria-label="Buscar configuração" placeholder="Buscar configuração…" value={busca} onChange={e=>setBusca(e.target.value)}/>{busca&&<button type="button" aria-label="Limpar busca" onClick={()=>setBusca("")}><X size={14}/></button>}</label>
  <TabsList className="pp-nav-list" aria-label="Configurações do provedor">
   <TabsTrigger value="visao-geral" className="pp-nav-item pp-home" data-testid="tab-visao-geral"><LayoutDashboard size={17}/>Início do painel</TabsTrigger>
   {categorias.map(c=><div className="pp-nav-group" data-category={c.id} key={c.id}><p><c.icon size={14}/>{c.titulo}</p>{c.itens.map(i=><TabsTrigger key={i.id} value={i.id} className="pp-nav-item" data-testid={'tab-'+i.id}>{i.titulo}</TabsTrigger>)}</div>)}
  </TabsList>
  {!categorias.length&&<p className="pp-no-results">Nenhuma configuração encontrada. Tente “WhatsApp”, “usuários” ou “CNPJ”.</p>}
 </aside>;
}
export function CabecalhoConfiguracao({aba}:{aba:string}) {
 const categoria=CATEGORIAS_PAINEL.find(c=>c.itens.some(i=>i.id===aba));const item=categoria?.itens.find(i=>i.id===aba);
 if(!categoria||!item)return null;
 return <header className="pp-section-heading" data-category={categoria.id}><span className="pp-category-icon"><categoria.icon size={24}/></span><div><p className="pp-eyebrow">{categoria.titulo}</p><h2>{item.titulo}</h2><p>{item.ajuda}</p></div></header>;
}
export function InicioConfiguracoes({onAbrir,podeSuporte}:{onAbrir:(aba:string)=>void;podeSuporte:boolean}) {
 return <section aria-label="Central de configurações" className="pp-start"><div className="pp-start-heading"><p className="pp-eyebrow">Tudo no lugar certo</p><h2>Como você quer configurar o provedor?</h2><p>Comece pelo cadastro, conecte seus canais e depois ajuste a operação.</p></div>
 <div className="pp-journey">{[{id:'empresa',passo:'01',nome:'Cadastre a empresa'},{id:'integracao',passo:'02',nome:'Conecte seus dados'},{id:'chat',passo:'03',nome:'Prepare o atendimento'},{id:'cobranca',passo:'04',nome:'Defina as regras'}].map(s=><button key={s.id} onClick={()=>onAbrir(s.id)}><span>{s.passo}</span>{s.nome}<ArrowUpRight size={15}/></button>)}</div>
 <div className="pp-category-grid">{categoriasDoPainel('',podeSuporte).map(c=><article key={c.id} data-category={c.id} className="pp-category-card"><span className="pp-category-icon"><c.icon size={23}/></span><h3>{c.titulo}</h3><p>{c.descricao}</p><div>{c.itens.map(i=><button key={i.id} onClick={()=>onAbrir(i.id)}><span><strong>{i.titulo}</strong><small>{i.descricao}</small></span><ArrowUpRight size={16}/></button>)}</div></article>)}</div></section>;
}
