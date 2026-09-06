/**
 * ERP Connector Engine — Type Definitions
 *
 * Contracts and interfaces for all ERP connectors.
 * Every connector (IXC, MK, SGP, Hubsoft, Voalle, RBX) implements ErpConnector.
 */

/** Configuration field descriptor for dynamic ERP setup forms */
export interface ErpConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  required: boolean;
  placeholder?: string;
}

/** Connection configuration passed to every connector method */
export interface ErpConnectionConfig {
  apiUrl: string;
  apiToken: string;
  apiUser?: string;
  clientId?: string;
  clientSecret?: string;
  mkContraSenha?: string;
  extra: Record<string, string>;
}

/** ERP config fields for dynamic frontend forms */
export const ERP_CONFIG_FIELDS: Record<string, {
  field: string;
  label: string;
  type: "text" | "password" | "url";
  required: boolean;
  placeholder?: string;
  helpText?: string;
}[]> = {
  ixc: [
    { field: "apiUrl", label: "URL do Servidor IXC", type: "url", required: true, placeholder: "https://suainstancia.ixcsoft.com.br" },
    { field: "apiUser", label: "ID do Usuario (numerico)", type: "text", required: true, placeholder: "123" },
    { field: "apiToken", label: "Token do Usuario", type: "password", required: true, helpText: "Gerado em Configuracoes > Usuarios > campo Token" },
  ],
  mk: [
    { field: "apiUrl", label: "URL do Servidor MK", type: "url", required: true, placeholder: "http://192.168.1.100:8311" },
    { field: "apiToken", label: "Token do Usuario MK", type: "password", required: true, helpText: "Token cadastrado no usuario de integracao" },
    { field: "mkContraSenha", label: "Contra-Senha do Perfil Webservice", type: "password", required: true, helpText: "Criada em Integradores > Gerenciador de Webservices" },
  ],
  sgp: [
    { field: "apiUrl", label: "URL do Servidor SGP", type: "url", required: true, placeholder: "https://provedor.sgp.net.br" },
    { field: "apiToken", label: "Token SGP", type: "password", required: true, helpText: "Gerado em Administracao > Integracoes > Tokens. Deixe o token ativo e sem restricao de host/rota." },
    { field: "extra.sgpApp", label: "Nome do App", type: "text", required: true, placeholder: "consultaisp", helpText: "O campo App do mesmo cadastro de token, escrito igual" },
  ],
  hubsoft: [
    { field: "apiUrl", label: "URL da API Hubsoft", type: "url", required: true, placeholder: "https://api.seudominio.com.br" },
    { field: "clientId", label: "Client ID", type: "text", required: true, helpText: "Gerado no painel de integracoes Hubsoft" },
    { field: "clientSecret", label: "Client Secret", type: "password", required: true },
    { field: "apiUser", label: "Usuario (e-mail)", type: "text", required: true, placeholder: "api@seudominio.com.br" },
    { field: "apiToken", label: "Senha da conta de integracao", type: "password", required: true },
  ],
  voalle: [
    { field: "apiUrl", label: "URL do Voalle ERP", type: "url", required: true, placeholder: "https://erp.seudominio.com.br" },
    { field: "apiUser", label: "Usuario de Integracao", type: "text", required: true, helpText: "Usuario do tipo Integracao criado no Voalle" },
    { field: "apiToken", label: "Senha", type: "password", required: true },
    { field: "extra.voalleClientId", label: "Client ID (opcional)", type: "text", required: false, placeholder: "tger", helpText: "Deixe vazio para usar o padrao" },
  ],
  rbx: [
    { field: "apiUrl", label: "URL do RBX ISP", type: "url", required: true, placeholder: "https://erp.seudominio.com.br" },
    { field: "apiToken", label: "Chave de Integracao", type: "password", required: true, helpText: "Empresa > Parametros > Web Services no RBX" },
  ],
  topsapp: [
    { field: "apiUrl", label: "URL da API TopSApp", type: "url", required: true, placeholder: "https://seudominio.topsapp.com.br" },
    { field: "apiToken", label: "Token de Integracao", type: "password", required: true },
  ],
  radiusnet: [
    { field: "apiUrl", label: "URL da API RadiusNet", type: "url", required: true, placeholder: "https://seudominio.radiusnet.com.br" },
    { field: "apiToken", label: "Token de Integracao", type: "password", required: true },
  ],
  gere: [
    { field: "apiUrl", label: "URL da API Gere", type: "url", required: true, placeholder: "https://seudominio.gere.com.br" },
    { field: "apiToken", label: "Token de Integracao", type: "password", required: true },
  ],
  receitanet: [
    { field: "apiUrl", label: "URL da API ReceitaNet", type: "url", required: true, placeholder: "https://seudominio.receitanet.com.br" },
    { field: "apiToken", label: "Token de Integracao", type: "password", required: true },
  ],
};

/** Result of a connection test */
export interface ErpTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

/**
 * Uma fatura EM ABERTO no ERP, do jeito que a varredura grava em `invoices`.
 *
 * Nasceu na fase 2 da cobranca (05/09/2026): o agregado por cliente
 * (totalOverdueAmount, maxDaysOverdue) responde "quanto deve", mas nao "qual
 * mes ficou sem pagar" nem "quem ficou sem fatura este mes" — isso exige a
 * fatura com o vencimento dela. Vai VENCIDA e A VENCER: a vencer nao e atraso,
 * mas e fatura do mes, e sem ela o resumo diria que o cliente em dia ficou
 * sem faturamento.
 */
export interface FaturaAbertaDoErp {
  /**
   * Id da fatura no ERP — a chave de (provedor, fonte). E o que faz a
   * varredura seguinte reconhecer a MESMA fatura em vez de duplica-la, e o
   * que prova que ela sumiu dos pendentes quando deixa de vir. Nunca vazio.
   */
  ref: string;
  /** Vencimento como AAAA-MM-DD — dia de calendario, sem hora e sem fuso. */
  vencimento: string;
  valor: number;
  descricao?: string | null;
}

/** Normalized customer record — common shape across all ERPs */
export interface NormalizedErpCustomer {
  cpfCnpj: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  cep?: string;
  /** Latitude returned directly by ERP (if available) — e.g. MK Solutions */
  latitude?: string;
  /** Longitude returned directly by ERP (if available) */
  longitude?: string;
  totalOverdueAmount: number;
  maxDaysOverdue: number;
  overdueInvoicesCount?: number;
  /**
   * As faturas em aberto deste cliente, uma a uma — vencidas E a vencer, so as
   * de data legivel. Nao altera a divida: `totalOverdueAmount` continua sendo
   * a soma das VENCIDAS. Ausente = o conector nao le fatura a fatura (o sync
   * entao nao grava nem baixa nada de `invoices` para ele).
   */
  faturasAbertas?: FaturaAbertaDoErp[];
  hasUnreturnedEquipment?: boolean;
  unreturnedEquipmentCount?: number;
  equipmentDetails?: Array<{
    type: string;
    brand: string;
    model: string;
    /** Vazio quando o ERP so conhece o MAC — o storage entao casa por `mac`. */
    serialNumber: string;
    /**
     * MAC do aparelho, so hexadecimal, maiusculo, sem separador (12 chars).
     *
     * Vai SEPARADO do serial, e nao no lugar dele, porque a fase 3 cruza o que
     * a OLT informa (serial da ONU, via SNMP) com o que o RADIUS autenticou
     * (MAC) — e isso exige os dois na MESMA linha. O SGP traz ambos por
     * servico, e ate 05/09/2026 o conector escolhia um e descartava o outro:
     * 322 aparelhos da Amplinet gravados, zero com MAC.
     */
    mac?: string;
    value: string;
    inRecoveryProcess: boolean;
  }>;
  /** Status do contrato no ERP. "active" = tem contrato vigente, "cancelled" = ex-cliente (pode ter fatura rescisória/equipamento). Mapeado para customers.status no DB. */
  contractStatus?: "active" | "cancelled" | "suspended";
  /**
   * POR QUE o contrato foi suspenso ou cancelado, no TEXTO CRU do ERP.
   *
   * `contractStatus` diz que o servico acabou; este campo diz se foi calote ou
   * se o cliente pediu para sair — e para um bureau de credito e a diferenca
   * que importa. Medido no SGP da Amplinet em 04/09/2026: 214 contratos
   * cancelados por "Administrativo" contra 66 por "Financeiro", mais 222
   * clientes suspensos por "Financeiro". Os 288 cortados por dinheiro entravam
   * na base indistinguiveis dos 206 que so encerraram o servico.
   *
   * Cru, e nao normalizado: cada ERP escreve com a redacao dele ("Financeiro",
   * "Financeiro - SPC"). A traducao para as duas familias mora em
   * `shared/motivo-corte.ts`.
   *
   * AUSENTE E DIFERENTE DE VAZIO. Conector que nao sabe ler o motivo deixa
   * `undefined`, e o storage nao pode apagar o que ja estava gravado — este
   * repositorio ja perdeu a divida de uma carteira inteira assim, em
   * 31/08/2026 (ver `skipPaymentStatus` em storage/customers.storage.ts).
   */
  motivoCorte?: string;
  /** Quando o contrato passou ao status atual, como o ERP devolve. */
  cortadoEm?: string;
  /** Nome do plano contratado (se ativo) — ex "Combo 800MB + Deezer". */
  contractPlan?: string;
  /**
   * Data de inicio do contrato, como o ERP devolve — ISO (YYYY-MM-DD) ou BR
   * (DD/MM/AAAA). E o unico jeito de saber que o contrato tem menos de 90 dias,
   * condicao (b) do anti-fraude. Nem todo conector consegue informar.
   */
  contractStartDate?: string;
  erpSource: string;
}

/** Result of fetching customers/delinquents from an ERP */
export interface ErpFetchResult {
  ok: boolean;
  message: string;
  customers: NormalizedErpCustomer[];
  totalRecords?: number;
  /**
   * Quantos clientes o conector NAO conseguiu ler, e nem sequer identificar.
   *
   * `ok: true` sozinho nao distingue "li a base inteira e estes sao os
   * inadimplentes" de "li metade dela". A diferenca importa porque o sync usa a
   * lista como prova NEGATIVA: quem nao esta nela tem a divida baixada. Com
   * leitura incompleta isso apaga o debito de quem so nao foi lido, e no bureau
   * "nada consta" para devedor real e o erro que entrega o caloteiro limpo ao
   * provedor vizinho.
   *
   * Use `docsNaoLidos` sempre que o documento for conhecido — la a falha custa
   * um cliente, aqui custa a limpeza do provedor inteiro. Este contador e para
   * o que nem da para nomear.
   */
  leiturasFalhas?: number;

  /**
   * Documentos que o conector NAO conseguiu ler nesta passada, mas sabe quem
   * sao.
   *
   * O sync os trata como "ainda devendo": nao entram na lista de inadimplentes,
   * mas tambem nao tem a divida baixada. E a leitura certa de "nao sei" —
   * preserva o que ja havia sobre eles e deixa a limpeza rodar normalmente para
   * todo o resto, em vez de desligar a baixa do provedor inteiro por causa de um
   * timeout em 3.226 clientes.
   */
  docsNaoLidos?: string[];

  /**
   * `true` quando o conector SABE que esta lista nao cobre a base inteira, sem
   * conseguir dizer quem ficou de fora.
   *
   * O caso concreto e o caminho legado do MK: `WSMKFaturasAbertas` devolve
   * FATURAS num periodo, nao clientes, e por isso nunca pode provar que fulano
   * NAO deve. Usar essa lista como prova negativa apagaria divida de quem o
   * endpoint simplesmente nao mencionou.
   *
   * Ausente significa "nao informado", que o sync le como cobertura completa —
   * e o comportamento que os demais conectores ja tinham. Sinalizar e opt-in.
   */
  leituraParcial?: boolean;

  /**
   * Faturas em aberto de quem NAO esta em `customers` por estar EM DIA — o
   * cliente com a mensalidade do mes ainda a vencer e nada vencido.
   *
   * `fetchDelinquents` devolve so quem deve, e e a decisao certa para a divida.
   * Mas o resumo do mes precisa da fatura a vencer de quem esta em dia — sem
   * ela, todo cliente pagante apareceria como "sem fatura no mes", que e o
   * buraco de faturamento que a tela existe para apontar. O MK le a fatura de
   * cada cliente na varredura e ja tem esse dado na mao; entrega por aqui em
   * vez de inflar a lista de inadimplentes com gente que nao deve. O sync
   * resolve o cliente pelo documento e grava as faturas.
   */
  faturasDeClientesEmDia?: Array<{ cpfCnpj: string; faturasAbertas: FaturaAbertaDoErp[] }>;

  /**
   * `true` quando o conector TENTOU ler as faturas em aberto e nao conseguiu —
   * `faturasAbertas` ausente nesta resposta nao significa "sem fatura".
   *
   * O sync usa a lista de faturas vistas como prova NEGATIVA: a que estava
   * aberta e nao apareceu e marcada `baixada_no_erp`. Com a leitura das
   * faturas falha, essa prova nao existe, e nada pode ser baixado — o mesmo
   * raciocinio de `leituraParcial`, so que para a fatura e nao para o cliente.
   */
  faturasNaoLidas?: boolean;
}

/**
 * Core ERP Connector interface.
 *
 * Every ERP integration must implement this contract.
 * Connectors register themselves in the registry on import.
 */
export interface ErpConnector {
  readonly name: string;
  readonly label: string;
  readonly configFields: ErpConfigField[];

  /**
   * Se o conector busca comodato/ativos do ERP.
   * false = o provedor precisa usar planilha ou formulario.
   * Ao implementar equipamento para um ERP novo, vire para true aqui e
   * preencha equipmentDetails em NormalizedErpCustomer.
   */
  readonly supportsEquipment?: boolean;

  /**
   * `true` quando o conector esta registrado mas NAO fala com o ERP: todos os
   * metodos devolvem "ainda nao implementado".
   *
   * Existe porque `configFields` sozinho nao distingue um stub de um conector
   * que funciona, e a lista suspensa do painel SaaS se monta a partir dele. Sem
   * a marca, o caminho da falha e silencioso: o operador escolhe o ERP, digita
   * credencial e salva; a linha entra como "Configurado / Ativo" e o provedor
   * do outro lado passa a ler "Integrada", porque o selo depende de configurado
   * + isEnabled, e nao de o conector existir. So dias depois, na primeira
   * varredura automatica, alguem descobre — e o provedor achou que estava
   * integrado esse tempo todo.
   *
   * Ausente significa implementado, para nao obrigar os conectores que
   * funcionam a declarar nada. Ao trocar um stub por integracao real, apague o
   * campo em vez de virar para false.
   */
  readonly naoImplementado?: boolean;

  /** Test connectivity to the ERP API */
  testConnection(config: ErpConnectionConfig): Promise<ErpTestResult>;

  /** Fetch only delinquent/overdue customers */
  fetchDelinquents(config: ErpConnectionConfig, lastDays?: number): Promise<ErpFetchResult>;

  /** Fetch all customers (including non-delinquent) */
  fetchCustomers(config: ErpConnectionConfig): Promise<ErpFetchResult>;

  /** Fetch a single customer by CPF/CNPJ with overdue data already aggregated (optional) */
  fetchCustomerByCpf?(config: ErpConnectionConfig, cpfCnpj: string): Promise<ErpFetchResult>;


  /**
   * A coordenada da INSTALACAO de um cliente, quando o ERP so a entrega um a um.
   *
   * Existe porque a listagem em lote e a ficha do cliente nem sempre carregam a
   * mesma coisa. Medido no SGP da Amplinet em 04/09/2026: `/api/ura/clientes/`
   * devolve `latitude`/`longitude` VAZIAS para boa parte da base, e
   * `/api/ura/consultacliente/` devolve `endereco_ll` preenchido para os MESMOS
   * clientes — 9 de 25 dos que estavam fora do mapa tinham a coordenada
   * esperando ali. Sem este metodo eles iam para a geocodificacao por nome de
   * rua, que e adivinhacao, quando o ponto da instalacao existia.
   *
   * Fica FORA de `fetchCustomers` de proposito: e uma requisicao por cliente, e
   * a varredura em lote (usada tambem pelo mapa de calor e pela consulta ao
   * vivo) nao pode pagar esse preco. Quem chama e a fase de coordenadas, que
   * pergunta so por quem continua sem ponto.
   *
   * Devolve null quando o ERP nao tem a coordenada — o que e resposta, nao erro.
   */
  fetchCoordenadaPorCpf?(
    config: ErpConnectionConfig,
    cpfCnpj: string,
  ): Promise<{ latitude: string; longitude: string } | null>;

  /** Fetch customers by CEP prefix with overdue data aggregated (optional) */
  fetchCustomersByCep?(config: ErpConnectionConfig, cep: string): Promise<ErpFetchResult>;

  /**
   * Busca por ENDERECO, para o cruzamento da consulta (opcional).
   *
   * Existe porque o CEP nao serve como chave: medido em producao em
   * 27/08/2026, 39% da carteira da NsLink nao tem CEP de 8 digitos, e em cidade
   * pequena boa parte do cadastro carrega o CEP geral do municipio — que
   * juntaria imoveis diferentes no mesmo grupo.
   *
   * O conector deve filtrar pelo que conseguir (logradouro e cidade costumam
   * bastar) e devolver os candidatos; o casamento fino por numero e bairro fica
   * com `services/endereco-chave.ts`, que aplica a mesma regua para todos os
   * ERPs. Melhor devolver a mais e deixar o casador cortar do que devolver a
   * menos e esconder uma pendencia.
   */
  fetchCustomersByAddress?(
    config: ErpConnectionConfig,
    endereco: { logradouro: string; numero?: string; bairro?: string; cidade?: string; uf?: string; cep?: string },
  ): Promise<ErpFetchResult>;
}
