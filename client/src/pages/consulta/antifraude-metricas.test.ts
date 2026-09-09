import { describe, it, expect } from "vitest";
import { resumirAlertas, type AntiFraudAlert } from "./antifraude-metricas";
const a = (patch: Partial<AntiFraudAlert> = {}): AntiFraudAlert => ({ id:1, providerId:1, customerId:1, customerProviderId:1, consultingProviderId:null, consultingProviderName:null, customerName:"Teste", customerCpfCnpj:"11111111111", type:"defaulter_consulted", severity:"high", message:"Consulta", riskScore:null, riskLevel:null, riskFactors:null, daysOverdue:5, overdueAmount:"100", equipmentNotReturned:0, equipmentValue:"0", recentConsultations:1, resolved:false, status:"new", createdAt:"2026-09-01T10:00:00Z", ...patch });
describe("indicadores de proteção da carteira", () => {
  it("não multiplica a dívida quando vários provedores consultaram a mesma pessoa", () => {
    expect(resumirAlertas([a(),a({id:2, consultingProviderId:3})])).toMatchObject({ abertos:2,clientes:1,divida:100 });
  });
  it("usa o valor atual disponível e exclui alertas encerrados", () => {
    expect(resumirAlertas([a({ atual:{contractStatus:"active",overdueAmount:"0",daysOverdue:0,emRisco:false} }), a({id:2,customerCpfCnpj:"22222222222",resolved:true,status:"resolved"})])).toMatchObject({divida:0,clientes:1,abertos:1});
  });
  it("não soma valores de outro dono nem valores inválidos", () => {
    expect(resumirAlertas([a({customerProviderId:2}),a({id:2,overdueAmount:"NaN"})]).divida).toBe(0);
  });
  it("usa a foto mais recente quando não existe atualização", () => {
    expect(resumirAlertas([a(),a({id:2,overdueAmount:"75",createdAt:"2026-09-02T10:00:00Z"})]).divida).toBe(75);
  });
});
