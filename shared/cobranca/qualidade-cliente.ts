export function textoCorrompido(texto: string | null | undefined): boolean {
  return !!texto && /\uFFFD|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â[€€™œž]/u.test(texto);
}
export interface SinalDeQualidade { titulo: string; orientacao: string }
export function diagnosticarCliente(d: { nome: string; telefone?: string | null; email?: string | null; lastSyncAt?: string | null; dividaAtual: number; diasAtraso: number; contractStartDate?: string | null }, agora: Date, vivo?: { dividaAtual: number; diasAtraso: number } | null): SinalDeQualidade[] {
  const sinais: SinalDeQualidade[] = [];
  if (textoCorrompido(d.nome)) sinais.push({ titulo: 'Nome com caracteres inválidos', orientacao: 'Confira o cadastro e a codificação no ERP antes de gerar mensagens ou contratos. A grafia não foi alterada automaticamente.' });
  if (!d.telefone && !d.email) sinais.push({ titulo: 'Cliente sem canal de contato', orientacao: 'Atualize telefone ou e-mail no ERP para iniciar o atendimento.' });
  if (!d.contractStartDate) sinais.push({ titulo: 'Data de início não informada', orientacao: 'O tempo de relacionamento não pode ser confirmado. Confira o contrato no ERP.' });
  const sincronizado = d.lastSyncAt ? Date.parse(d.lastSyncAt) : NaN;
  if (!Number.isFinite(sincronizado)) sinais.push({ titulo: 'Sincronização sem data confirmada', orientacao: 'Consulte o ERP antes de usar este saldo em uma negociação.' });
  else if (agora.getTime() - sincronizado > 48 * 3600000) sinais.push({ titulo: 'Cadastro sem atualização há mais de 48 horas', orientacao: 'Compare com o ERP antes de cobrar; pagamentos recentes podem não estar refletidos.' });
  if (vivo && (Math.round(vivo.dividaAtual * 100) !== Math.round(d.dividaAtual * 100) || vivo.diasAtraso !== d.diasAtraso)) sinais.push({ titulo: 'Saldo ou atraso diverge do ERP consultado', orientacao: 'O resumo usa a base sincronizada. Confira os valores do ERP apresentados abaixo antes de negociar.' });
  return sinais;
}
