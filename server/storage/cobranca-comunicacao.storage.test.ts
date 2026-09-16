import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),release:vi.fn()}));
vi.mock("../db",()=>({pool:m}));
import { configComunicacao,candidatosComunicacao,reservarComunicacao,concluirComunicacao,faturaAtualComunicacao,diarioComunicacao,pausarComunicacao,baseLegalDaEtapa } from "./cobranca-comunicacao.storage";
beforeEach(()=>{vi.resetAllMocks();m.query.mockResolvedValue({rows:[],rowCount:0});m.connect.mockResolvedValue(m);});
describe("persistência da comunicação",()=>{
  it("configuração ausente ou corrompida falha fechada",async()=>{
    expect((await configComunicacao(7)).ligada).toBe(false);
    m.query.mockResolvedValue({rows:[{config:{ligada:true,limiteDiario:0}}]});
    expect((await configComunicacao(7)).ligada).toBe(false);
  });
  it("releitura exclui somente as reservas do próprio envio, no mesmo tenant",async()=>{
    await candidatosComunicacao(7,11,{comunicacaoId:50,preAvisoId:30});
    const [sql,params]=m.query.mock.calls[0];
    expect(params).toEqual([7,11,50,30]);
    expect(sql).toContain("m.provider_id=c.provider_id");expect(sql).toContain("a.provider_id=c.provider_id");
    expect(sql).toContain("m.id<>$3");expect(sql).toContain("a.id<>$4");expect(sql).toContain("b.status<>'CLOSED'");
  });
  it("reserva protege vínculos de caso e fatura e prefere conflito a duplicação",async()=>{
    expect(await reservarComunicacao({providerId:7,customerId:11,casoId:22,faturaId:40,canal:"sms",finalidade:"cobranca",dia:"2026-09-14",chave:"chave"})).toBeNull();
    const [sql,params]=m.query.mock.calls[0];
    expect(params).toEqual([7,11,22,40,"sms","cobranca","chave","2026-09-14"]);
    expect(sql).toContain("cobranca_casos where provider_id=$1 and customer_id=$2 and id=$3");
    expect(sql).toContain("invoices where provider_id=$1 and customer_id=$2 and id=$4");
    expect(sql).toContain("on conflict do nothing");expect(sql).toContain("nao_contatar or pausa_ate>now()");
  });
  it("resultado, evento e último contato do caso são transacionais",async()=>{
    await concluirComunicacao(7,50,{status:"incerto",motivo:"Verifique"});
    expect(m.query.mock.calls[0]).toEqual(["begin"]);
    const [sql,params]=m.query.mock.calls[1];
    expect(sql).toContain("where provider_id=$1 and id=$2 and status='enviando'");
    expect(sql).toContain("update cobranca_casos k set ultimo_contato_em");
    expect(sql).toContain("a.status in ('enviado','incerto')");
    expect(params.slice(0,5)).toEqual([7,50,"incerto","Verifique",null]);
    expect(m.query.mock.calls[2]).toEqual(["commit"]);expect(m.release).toHaveBeenCalled();
  });
  it("evento de SMS/e-mail carrega a etapa do caso e a base legal da régua",async()=>{
    await concluirComunicacao(7,50,{status:"enviado",providerMessageId:"SM1"});
    const [sql,params]=m.query.mock.calls[1];
    // A etapa vem do CASO, não do chamador: quem envia não precisa conhecer a régua,
    // e o evento fica auditável mesmo quando o serviço que disparou já mudou.
    expect(sql).toContain("left join cobranca_casos k on k.provider_id=a.provider_id and k.id=a.caso_id and k.customer_id=a.customer_id");
    expect(sql).toContain("'etapa',k.etapa_atual");
    expect(sql).toContain("$6::jsonb->k.carteira->k.etapa_atual");
    expect(sql).toContain("'baseLegal'");expect(sql).toContain("'motivoLegal'");
    const catalogo=JSON.parse(params[5]);
    expect(catalogo.ativo.aviso_suspensao.baseLegal).toContain("765/2023");
    expect(catalogo.ativo.pre_negativacao.baseLegal).toContain("359");
    expect(catalogo.ativo.lembrete_atraso).toEqual({baseLegal:null,motivoLegal:'Etapa "Lembrete de atraso" da régua de cobrança'});
    expect(catalogo.ativo.fim_de_linha.motivoLegal).toContain("CC art. 206");
    // Ex-cliente: a conciliação não é o aviso formal da Súmula 359, e não há serviço a suspender.
    expect(catalogo.ex_cliente.pre_negativacao.baseLegal).toBeNull();
    expect(catalogo.ex_cliente.pre_negativacao.motivoLegal).toContain("Conciliação de pendências");
    expect(catalogo.ex_cliente).not.toHaveProperty("aviso_suspensao");
    expect(catalogo.ex_cliente).not.toHaveProperty("lembrete_pre_vencimento");
  });
  it("a base legal derivada em JS é a MESMA do catálogo que vai ao SQL — para o evento gravado fora da régua",async()=>{
    // Envio manual de SMS/e-mail, reforço multicanal e primeiro contato por WhatsApp gravam
    // o evento sem passar por concluirComunicacao; a derivação é uma só.
    await concluirComunicacao(7,50,{status:"enviado"});
    const catalogo=JSON.parse(m.query.mock.calls[1][1][5]);
    for(const carteira of ["ativo","ex_cliente"] as const)for(const etapa of Object.keys(catalogo[carteira]))
      expect(baseLegalDaEtapa(carteira,etapa)).toEqual({etapa,...catalogo[carteira][etapa]});
    const semEtapa={etapa:null,baseLegal:null,motivoLegal:"Caso sem etapa da régua definida no envio"};
    expect(baseLegalDaEtapa("ativo",null)).toEqual(semEtapa);
    expect(baseLegalDaEtapa(null,"aviso_suspensao")).toEqual({...semEtapa,etapa:"aviso_suspensao"});
    expect(baseLegalDaEtapa("ex_cliente","aviso_suspensao")).toEqual({...semEtapa,etapa:"aviso_suspensao"});
    expect(baseLegalDaEtapa("outra","aviso_suspensao")).toEqual({...semEtapa,etapa:"aviso_suspensao"});
    expect(m.query.mock.calls[1][0]).toContain(`'motivoLegal','${semEtapa.motivoLegal}'`);
  });
  it("erro na conclusão desfaz a transação e preserva reserva",async()=>{
    m.query.mockImplementation(async(sql:string)=>{if(sql.startsWith("with atualizado"))throw new Error("DB falhou");return {rows:[]};});
    await expect(concluirComunicacao(7,50,{status:"enviado"})).rejects.toThrow("DB falhou");
    expect(m.query).toHaveBeenCalledWith("rollback");expect(m.query).not.toHaveBeenCalledWith("commit");
  });
  it("fatura final exige mesmo tenant, cliente, referência ERP e ausência de atraso",async()=>{
    expect(await faturaAtualComunicacao(7,11,40)).toBeNull();
    const [sql,params]=m.query.mock.calls[0];expect(params).toEqual([7,11,40]);
    expect(sql).toContain("f.provider_id=$1 and f.customer_id=$2 and f.id=$3");
    expect(sql).toContain("coalesce(c.total_overdue_amount,0)<=0");expect(sql).toContain("f.erp_ref is not null");
  });
  it("diário por carteira exige situação do cliente e carteira do caso concordantes",async()=>{
    await diarioComunicacao(7,"ex_cliente");
    const [sql,params]=m.query.mock.calls[0];expect(params).toEqual([7,"ex_cliente"]);
    expect(sql).toContain("c.status in ('inactive','cancelled')");expect(sql).toContain("k.carteira=$2");
    expect(sql).toContain("k.provider_id=m.provider_id");
  });
  it("resposta não remove opt-out: somente retomar o faz",async()=>{
    m.query.mockResolvedValue({rows:[{customer_id:11}],rowCount:1});
    await pausarComunicacao(7,11,8,"respondeu");
    expect(m.query.mock.calls[1][0]).toContain("when excluded.motivo='retomar' then false else cobranca_preferencias_contato.nao_contatar or excluded.nao_contatar");
  });
  it("o evento da preferência tipa o parâmetro dentro de jsonb_build_object",async()=>{
    // jsonb_build_object é VARIADIC "any": o Postgres não infere o tipo de um parâmetro solto ali e recusa o
    // statement inteiro (42P18 "could not determine data type of parameter $5", medido no banco local em 16/09/2026).
    // A rota engolia como 503 e o opt-out pela tela morria — o cliente pedia para não ser contatado e nada gravava.
    m.query.mockResolvedValue({rows:[{customer_id:11}],rowCount:1});
    await pausarComunicacao(7,11,8,"nao_contatar");
    const evento=m.query.mock.calls.map(([sql])=>String(sql)).find(sql=>sql.includes("insert into cobranca_eventos"));
    expect(evento).toContain("jsonb_build_object('acaoContato',$5::text)");
  });
  it("cliente alheio não produz evento nem alteração de preferência",async()=>{
    expect(await pausarComunicacao(7,999,8,"nao_contatar")).toBe(false);
    expect(m.query).toHaveBeenCalledWith("rollback");
    expect(m.query.mock.calls.some(([sql])=>String(sql).includes("insert into cobranca_eventos"))).toBe(false);
  });
});
