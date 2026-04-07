export const FATOR_LABELS: Record<string, { icon: string; label: string }> = {
  f1_historicoPagamento: { icon: "💳", label: "Historico de Pagamento" },
  f2_tempoSetor: { icon: "📅", label: "Tempo no Setor ISP" },
  f3_inadimplenciaAtiva: { icon: "⚠️", label: "Inadimplencia" },
  f4_padraoConsultas: { icon: "🔍", label: "Padrao de Consultas" },
  f5_riscoEndereco: { icon: "📍", label: "Risco do Endereco" },
  f6_consistenciaCadastral: { icon: "📋", label: "Dados Cadastrais" },
};

export const LOADING_STEPS = [
  { id: 1, label: "Validando documento", detail: "Verificando CPF/CNPJ/CEP na base federal", duration: 1200 },
  { id: 2, label: "Consultando ERPs parceiros", detail: "Buscando em paralelo na rede de provedores", duration: 3500 },
  { id: 3, label: "Analisando historico", detail: "Consolidando contratos, debitos e equipamentos", duration: 2000 },
  { id: 4, label: "Calculando score de risco", detail: "Aplicando modelo de scoring ISP", duration: 1500 },
];
