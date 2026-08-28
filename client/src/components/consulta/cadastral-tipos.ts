/**
 * Tipos do resultado da consulta cadastral, como a rota entrega.
 *
 * Vivem aqui, e não dentro da página, porque agora três consumidores leem a
 * mesma resposta: a página, o relatório e o gerador de PDF. Enquanto o tipo
 * morava no `consulta-cadastral.tsx`, cada novo consumidor redeclarava a forma
 * — e foi assim que `patrimonio` e `vizinhos` continuaram declarados na tela
 * depois de a rota parar de enviá-los.
 */

export interface EnderecoCadastro {
  logradouro: string; numero?: string; complemento?: string; bairro?: string;
  cidade?: string; uf?: string; cep?: string;
  ratificado: boolean; ativo: boolean; principal: boolean; naReceita: boolean;
  ultimaPassagem?: string | null; passagens: number; passagensRuins: number;
}

export interface TelefoneCadastro {
  numero: string; ddd?: string; tipo?: string; operadora?: string;
  ativo: boolean; principal: boolean; prioridade?: number;
  naoPerturbe: boolean; ultimaPassagem?: string | null; passagensRuins: number;
}

export interface IdentidadeCadastro {
  nome?: string; nascimento?: string; idade?: number; nomeMae?: string;
  situacaoReceita?: string; dataSituacao?: string;
}

export interface SocioEmpresa {
  nome: string;
  vinculo?: string;
  cargo?: string;
  desde?: string;
  ate?: string;
  /** false quando a saída do quadro já foi averbada. */
  atual: boolean;
}

export interface DadosEmpresaCadastro {
  cnpj: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  situacao?: string;
  motivoSituacao?: string;
  aberturaEm?: string;
  idadeAnos?: number;
  matriz?: boolean;
  ufMatriz?: string;
  porte?: string;
  regime?: string;
  optanteSimples?: boolean;
  naturezaJuridica?: string;
  situacaoEspecial?: string;
  atividadePrincipal?: string;
  atividadesSecundarias: string[];
  socios: SocioEmpresa[];
}

export interface ProcessoCadastro {
  data?: string; tipo?: string; assunto?: string; tribunal?: string;
  uf?: string; status?: string; valor?: number;
  papel: "réu" | "autor" | "outro";
}

export interface ResultadoCadastral {
  id: number;
  cpfCnpj: string;
  /** Ausente nas consultas gravadas antes de o CNPJ existir — trate como CPF. */
  tipoDocumento?: "cpf" | "cnpj";
  veredito: "APROVAR" | "ATENCAO" | "RECUSAR" | "NAO_ENCONTRADO";
  motivos: string[];
  latenciaMs: number;
  consultasComFalha: number;
  consultasIndisponiveis: number;
  nivel?: string;
  creditosCobrados?: number;
  createdAt?: string;

  /** Só em CNPJ. */
  empresa?: DadosEmpresaCadastro;

  /** Só em CPF. */
  identidade?: IdentidadeCadastro;

  enderecos: EnderecoCadastro[];
  telefones: TelefoneCadastro[];
  emails: string[];
  processos?: ProcessoCadastro[];

  inadimplencia: {
    emCobrancaAgora: boolean; cobrancas365d: number; credores365d: number;
    mesesConsecutivos: number; ultimaCobranca?: string;
    processosTotal: number; processosComoReu: number; processos365d: number;
    temExecucao: boolean; naturezas: string[]; dividaAtiva: number;
  };

  /* ── Daqui para baixo, só pessoa física ─────────────────────────────────── */

  risco?: {
    score?: number; nivel?: string; empregado?: boolean; socio?: boolean;
    recebendoAuxilio?: boolean; inicioUltimaOcupacao?: string;
  };

  renda?: {
    faixa?: string; emReais: string | null; patrimonio?: string;
    fontes: Array<{ fonte: string; faixa: string; emReais: string | null; formal: boolean }>;
    rendaFormal: { fonte: string; faixa: string; emReais: string | null } | null;
    declaracoesIR: Array<{ ano: string; status?: string; banco?: string; agencia?: string; segmentoVip: boolean }>;
    declaraIrRecorrente: boolean; temSegmentoVip: boolean;
  };

  /**
   * `beneficio*` vem em REAIS, não em faixa: a faixa percentual da API
   * (`AssistanceIncomePercentageRange`) devolveu "SEM INFORMACAO" em 8 de 8
   * medições. `pessoasNaCasa` vem do bloco familiar, não do `related_people`.
   */
  capacidade?: {
    sobraMensal?: string; despesaMensal?: string; rendaFamiliar?: string;
    rendaMediaFamiliar?: string; pessoasNaCasa: number;
    dependentes: number; ehResponsavel?: boolean; ehDependente?: boolean;
    origemRenda?: string;
    recebeBeneficio: boolean; beneficiariosNaFamilia: number;
    beneficiariosHistoricos: number;
    beneficioUltimos12m: number; beneficioUltimos3m: number;
  };

  domicilio?: {
    totalRelacionados: number; noDomicilio: number;
    parentes: number; conjuges: number; socios: number; colegasTrabalho: number;
    nomes: Array<{ nome: string; vinculo: string; nivel: string }>;
    nomesLiberados: boolean;
  };

  riscoFamiliar?: {
    score?: number; nivel?: string; membros: number; empregados: number;
    emCobranca: number; ocorrencias365d: number;
    distribuicao: Record<string, number>; piorFaixa?: string;
  };

  rastro: {
    consultas30d: number; consultas365d: number; passagensRuins: number;
    primeiraPassagem?: string; ultimaPassagem?: string;
    buscaCredito?: string; usoCartao?: string; usoBancoDigital?: string;
    mudancasNome: number; mudancasStatus: number;
  };

  ocupacao?: {
    empregadoAgora?: boolean; empreendedor?: boolean;
    trocasTotal: number; trocas5Anos: number; trocas10Anos: number;
    mediaAnosPorVinculo?: number; idadePrimeiroEmprego?: number; primeiroVinculo?: string;
    setorPublico?: boolean; setorPrivado?: boolean; totalEmpregadores: number;
  };

  perfil?: { classeSocial?: string; faixaRenda?: string; escolaridade?: string; origem?: string };

  mercado?: Record<string, unknown>;
  riscoArea?: Array<{ endereco: string; ponto?: number; raio100m?: number }>;
  bureauIndisponivel?: boolean;
  nivelPedido?: string;

  dados?: {
    encontrado: boolean; taxIdStatus?: string; temObito?: boolean;
    nascimentoValidadoNaReceita?: boolean; homonimos?: number;
    badAddressPassages?: number; faixaRenda?: string;
  };
}
