/** Rótulos do motor de score legado (0-100, seis fatores). Lidos apenas pelo
 *  ramo FatoresLegado do ScoreBreakdownPanel, para consultas gravadas antes do
 *  motor v2. Sem ícone: o design system não usa emoji. */
export const FATOR_LABELS: Record<string, { icon: string; label: string }> = {
  f1_historicoPagamento: { icon: "", label: "Histórico de pagamento" },
  f2_tempoSetor: { icon: "", label: "Tempo no setor ISP" },
  f3_inadimplenciaAtiva: { icon: "", label: "Inadimplência ativa" },
  f4_padraoConsultas: { icon: "", label: "Padrão de consultas" },
  f5_riscoEndereco: { icon: "", label: "Risco do endereço" },
  f6_consistenciaCadastral: { icon: "", label: "Consistência cadastral" },
};

/**
 * Passos da espera. Os rótulos descrevem o que o backend REALMENTE faz na
 * ordem em que faz — consultar os ERPs da mesorregião, cruzar o endereço,
 * calcular o score. Não existe "validação na base federal": nada aqui bate na
 * Receita, e dizer isso na tela do operador seria mentir sobre a origem do dado.
 */
export const LOADING_STEPS = [
  { id: 1, label: "Consultando rede ISP colaborativa", detail: "Abrindo as integrações da sua mesorregião", duration: 700 },
  { id: 2, label: "Cruzando ERPs de provedores parceiros", detail: "Busca em paralelo, com timeout por provedor", duration: 900 },
  { id: 3, label: "Verificando endereço de instalação", detail: "Mesmo imóvel, documentos diferentes", duration: 700 },
  { id: 4, label: "Calculando score e parecer", detail: "Deduções nomeadas sobre a base de 700", duration: 700 },
];
