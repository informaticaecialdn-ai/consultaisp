/**
 * A FICHA do provedor do sandbox: a empresa que o Painel do Provedor, /creditos
 * e /nfse mostram. A auditoria da demo (rodada 2, 13/09/2026) achou a ficha
 * vazia com o selo "Verificado" — sem nome fantasia, endereço, sócio ou
 * documento, um usuário só —, a integração "Nunca sincronizou / 0" em cima de
 * 1.500 clientes sincronizados, o histórico de sync vazio, nenhum pedido de
 * crédito e a NFS-e emitida pelo CNPJ da plataforma em São Paulo.
 *
 * Módulo PURO, no molde dos outros semeadores: devolve linhas prontas e quem
 * insere, na mesma transação, é `tentarCriarSandbox`. Nada de banco aqui — e
 * por isso `PREFIXO_SANDBOX` aparece repetido abaixo em vez de importado de
 * `sandbox.service.ts`, que carrega o banco.
 *
 * Três regras que valem para o arquivo inteiro:
 *
 * 1. UMA EMPRESA SÓ. Nome, endereço, e-mail e sócios saem de
 *    `empresaPublicaSimulada` (cnpj-simulado.ts): clicar em "buscar na Receita"
 *    sobre a ficha semeada não muda nenhum campo.
 * 2. NADA TRAVA A LIMPEZA. Toda linha daqui é apagada por `apagarSandbox` /
 *    `storage.deleteProvider`, e nenhum usuário extra encosta no e-mail do
 *    administrador da demo — é o segundo sinal sem o qual a limpeza recusa o
 *    sandbox e ele vira zumbi.
 * 3. NADA APONTA PARA FORA. Pedido de crédito sem campo do Asaas, documento
 *    sem link, e-mail no domínio da demonstração, telefone numa faixa que não
 *    existe.
 */
import type { creditOrders, erpIntegrations, erpSyncLogs, providerDocuments, users } from "@shared/schema";
import { CREDIT_PACKAGES } from "@shared/planos";
import { FONTE_ERP_DEMO } from "../erp/fonte-demo";
import { empresaPublicaSimulada } from "./cnpj-simulado";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** O mesmo prefixo de `PREFIXO_SANDBOX` (sandbox.service.ts). */
const PREFIXO_SANDBOX = "sandbox-";
const DOMINIO_DA_DEMO = "demo.consultaisp.com.br";

/**
 * Tudo aqui descreve o provedor fictício; um subdomínio sem o prefixo é um
 * provedor de verdade, e a ficha de mentira nunca pode ser gravada nele.
 */
function exigirSubdominioDeSandbox(subdomain: string, quem: string): void {
  if (!String(subdomain ?? "").startsWith(PREFIXO_SANDBOX)) {
    throw new Error(`${quem}: "${subdomain}" nao e subdomain de sandbox`);
  }
}

// ── Ficha da empresa ─────────────────────────────────────────────────────────

/**
 * Londrina (DDD 43) com o número começando por 1. No plano de numeração o
 * assinante fixo começa por 2 a 5 e o móvel por 9; o 1 fica com os códigos de
 * serviço — nenhuma linha de verdade atende este número.
 */
const TELEFONE_DA_DEMO = "(43) 1000-2026";

export interface FichaDoProvedorDaDemo {
  tradeName: string;
  legalType: string;
  openingDate: string;
  businessSegment: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  addressZip: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  addressNeighborhood: string;
  addressCity: string;
  addressState: string;
}

/**
 * Os campos da aba Empresa, para o `insert` de `providers` (o nome, o CNPJ e o
 * `verificationStatus` continuam com `tentarCriarSandbox`).
 *
 * O endereço fica na caixa alta da Receita, e não "bonito": é o que o botão
 * "buscar na Receita" gravaria, e a regra 1 vale mais que a estética.
 * `legalType` é "LTDA" porque é o que `tipoSocietario` (painel-provedor.tsx)
 * tira da natureza "Sociedade Empresária Limitada" do cadastro simulado.
 * O segmento é uma das opções do `<select>` da ficha (`SEGMENTS`).
 */
export function fichaDoProvedorDaDemo(subdomain: string): FichaDoProvedorDaDemo {
  exigirSubdominioDeSandbox(subdomain, "fichaDoProvedorDaDemo");
  const receita = empresaPublicaSimulada("");
  return {
    tradeName: receita.nomeFantasia,
    legalType: "LTDA",
    openingDate: receita.dataAbertura,
    businessSegment: "ISP / Provedor de Internet",
    contactEmail: receita.email,
    contactPhone: TELEFONE_DA_DEMO,
    website: `https://${DOMINIO_DA_DEMO}`,
    addressZip: receita.cep,
    addressStreet: receita.logradouro,
    addressNumber: receita.numero,
    addressComplement: receita.complemento,
    addressNeighborhood: receita.bairro,
    addressCity: receita.cidade,
    addressState: receita.uf,
  };
}

// ── Sócios ───────────────────────────────────────────────────────────────────

/** Participação de cada sócio, na ordem do QSA simulado. Soma 100. */
const PARTICIPACOES = ["60.00", "40.00"];

export interface SocioDaDemo {
  name: string;
  cpf: string;
  role: string;
  sharePercentage: string;
}

/**
 * Os sócios do QSA simulado, no formato de `provider_partners` e SEM
 * `providerId` (a fiação põe o do sandbox). Nome, qualificação e CPF mascarado
 * são os mesmos que o importador de QSA mostraria — o mapeamento é o de
 * `handleCnpjLookup` (nome → name, qualificação → role, cpf → cpf).
 */
export function sociosDaDemo(): SocioDaDemo[] {
  const qsa = empresaPublicaSimulada("").socios;
  if (qsa.length !== PARTICIPACOES.length) {
    throw new Error(`sociosDaDemo: o QSA simulado tem ${qsa.length} socios e ha ${PARTICIPACOES.length} participacoes`);
  }
  return qsa.map((s, i) => ({ name: s.nome, cpf: s.cpf, role: s.qualificacao, sharePercentage: PARTICIPACOES[i] }));
}

// ── Documentos do KYC ────────────────────────────────────────────────────────

/**
 * Um PDF de uma página, do tamanho mínimo que um leitor abre: catálogo,
 * páginas, página, conteúdo e fonte padrão (Helvetica, que todo leitor tem).
 * Os deslocamentos da tabela xref são contados, e não digitados, para o
 * arquivo continuar válido se o texto mudar. Texto só em ASCII: a fonte padrão
 * sem codificação declarada não garante acento.
 */
function pdfMinimo(titulo: string): Buffer {
  const conteudo =
    `BT /F1 16 Tf 60 780 Td (${titulo}) Tj ` +
    "0 -26 Td /F1 10 Tf (Documento ficticio da demonstracao publica do Consulta ISP.) Tj " +
    "0 -14 Td (Nao tem valor legal e nao descreve nenhuma empresa real.) Tj ET";
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const deslocamentos: number[] = [];
  objetos.forEach((objeto, i) => {
    deslocamentos.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objeto}\nendobj\n`;
  });
  const inicioDaXref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const d of deslocamentos) pdf += `${String(d).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioDaXref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const DOCUMENTOS = [
  { documentType: "contrato_social", documentName: "contrato-social-provedor-demonstracao.pdf", titulo: "Contrato Social" },
  { documentType: "cartao_cnpj", documentName: "cartao-cnpj-provedor-demonstracao.pdf", titulo: "Cartao CNPJ" },
  { documentType: "comprovante_endereco", documentName: "comprovante-endereco-provedor-demonstracao.pdf", titulo: "Comprovante de Endereco" },
];

/**
 * Os três documentos que sustentam o selo "Verificado" da ficha, já aprovados.
 * `fileData` é data URL (o formato do upload da tela; a rota de download
 * decodifica o que vem depois da vírgula). `uploadedById = providerId` é o que
 * a rota de upload grava — e é a coluna pela qual `apagarSandbox` apaga.
 */
export function documentosDaDemo(providerId: number): Array<typeof providerDocuments.$inferInsert> {
  return DOCUMENTOS.map((d) => {
    const pdf = pdfMinimo(`${d.titulo} - Provedor Demonstracao LTDA`);
    return {
      providerId,
      uploadedById: providerId,
      documentType: d.documentType,
      documentName: d.documentName,
      documentMimeType: "application/pdf",
      documentSize: pdf.length,
      fileData: `data:application/pdf;base64,${pdf.toString("base64")}`,
      status: "approved",
      reviewerName: "Análise cadastral da demonstração",
    };
  });
}

// ── Equipe ───────────────────────────────────────────────────────────────────

const EQUIPE_EXTRA = [
  { prefixo: "gerencia", name: "Gerência da Demonstração", role: "admin" },
  { prefixo: "atendimento", name: "Atendimento da Demonstração", role: "user" },
  { prefixo: "financeiro", name: "Financeiro da Demonstração", role: "user" },
];

/**
 * A equipe além do administrador da demo, SEM `providerId` (a fiação põe o do
 * sandbox — e o CHECK `users_papel_coerente` recusa user/admin sem provedor).
 *
 * `hashInutilizavel` é o hash que `tentarCriarSandbox` já calculou para o
 * administrador, de uma senha aleatória que ninguém conhece: o visitante entra
 * pela sessão de GET /demo, nunca por senha. Reaproveitá-lo poupa um bcrypt por
 * usuário na fila serial de `criarSandbox`.
 *
 * O e-mail leva um prefixo ANTES do subdomínio, então nunca é o do
 * administrador (`<subdomain>@demo.consultaisp.com.br`, `emailDoAdminDaDemo`):
 * esse é o segundo sinal de `apagarSandbox` e fica intocado. Minúsculo e sem
 * espaço, a forma de `emailCanonico` (users.storage.ts).
 */
export function usuariosExtrasDaDemo(
  subdomain: string,
  hashInutilizavel: string,
): Array<Omit<typeof users.$inferInsert, "providerId">> {
  exigirSubdominioDeSandbox(subdomain, "usuariosExtrasDaDemo");
  if (!hashInutilizavel) throw new Error("usuariosExtrasDaDemo: hash vazio");
  return EQUIPE_EXTRA.map((p) => ({
    email: `${p.prefixo}.${subdomain}@${DOMINIO_DA_DEMO}`.trim().toLowerCase(),
    password: hashInutilizavel,
    name: p.name,
    role: p.role,
    emailVerified: true,
  }));
}

// ── Integração ERP e histórico de sync ──────────────────────────────────────

/** Brasília é UTC-3 o ano inteiro (sem horário de verão desde 2019). */
const FUSO_DE_BRASILIA_MS = -3 * HORA;
/** Duas varreduras por madrugada, com os minutos quebrados de uma rotina real. */
const MADRUGADAS = [{ hora: 2, minuto: 7 }, { hora: 4, minuto: 13 }];
const SINCRONIZACOES_NO_HISTORICO = 10;
/** Contando da mais recente (0): no meio do histórico, nunca a última — a integração diz "success". */
const POSICAO_DO_PARCIAL = 6;
const ERROS_DO_PARCIAL = 3;

/**
 * As 10 madrugadas mais recentes até `agora`, da mais nova para a mais velha.
 * Seis dias de candidatas bastam: se as duas de hoje ainda não passaram, as dos
 * cinco dias anteriores completam as dez — sempre dentro dos últimos 5 dias.
 */
function madrugadasAte(agora: Date): Date[] {
  const meiaNoiteDeHoje = Math.floor((agora.getTime() + FUSO_DE_BRASILIA_MS) / DIA) * DIA - FUSO_DE_BRASILIA_MS;
  const candidatas: number[] = [];
  for (let dias = 0; dias <= 5; dias++) {
    for (const m of MADRUGADAS) candidatas.push(meiaNoiteDeHoje - dias * DIA + m.hora * HORA + m.minuto * MINUTO);
  }
  return candidatas
    .filter((t) => t <= agora.getTime())
    .sort((a, b) => b - a)
    .slice(0, SINCRONIZACOES_NO_HISTORICO)
    .map((t) => new Date(t));
}

/**
 * O histórico de sincronização da aba Integração: varreduras automáticas da
 * fonte de demonstração, cada uma processando a carteira inteira. Uma delas
 * saiu parcial, com 3 registros recusados — a tela tem um selo para isso, e um
 * histórico só de sucesso não mostraria.
 */
export function logsDeSyncDaDemo(
  providerId: number,
  totalClientes: number,
  agora: Date,
): Array<typeof erpSyncLogs.$inferInsert> {
  if (!Number.isInteger(totalClientes) || totalClientes <= ERROS_DO_PARCIAL) {
    throw new Error(`logsDeSyncDaDemo: totalClientes invalido (${totalClientes})`);
  }
  return madrugadasAte(agora).map((syncedAt, i) => {
    const errors = i === POSICAO_DO_PARCIAL ? ERROS_DO_PARCIAL : 0;
    return {
      providerId,
      erpSource: FONTE_ERP_DEMO,
      syncedAt,
      upserted: totalClientes - errors,
      errors,
      status: errors > 0 ? "partial" : "success",
      syncType: "auto",
      recordsProcessed: totalClientes,
      recordsFailed: errors,
      ipAddress: null,
      payload: null,
    };
  });
}

/**
 * O resumo da integração que acompanha o histórico acima, para espalhar sobre
 * `linhaDaIntegracao` (mundo-base.ts): a última sincronização é o log mais
 * recente, com sucesso e a carteira inteira.
 */
export function integracaoErpSincronizada(
  agora: Date,
  totalClientes: number,
): Pick<typeof erpIntegrations.$inferInsert, "status" | "lastSyncAt" | "lastSyncStatus" | "totalSynced" | "totalErrors"> {
  return {
    status: "idle",
    lastSyncAt: madrugadasAte(agora)[0],
    lastSyncStatus: "success",
    totalSynced: totalClientes,
    totalErrors: 0,
  };
}

// ── Pedidos de crédito ───────────────────────────────────────────────────────

const PEDIDOS = [
  { sequencia: 1, pacote: "credits-250", status: "paid", diasAtras: 21 },
  { sequencia: 2, pacote: "credits-100", status: "cancelled", diasAtras: 9 },
  { sequencia: 3, pacote: "credits-50", status: "pending", diasAtras: 1 },
];

/**
 * Três pedidos: um pago, um cancelado e um aguardando pagamento. Nenhum campo
 * do Asaas — nem cobrança, nem link: a compra real é fora de escopo da
 * demonstração e a tela só mostra os botões de pagar quando esses campos
 * existem.
 *
 * `orderNumber` é UNIQUE na tabela inteira e a compra de verdade numera por
 * sequence (`CR-aaaamm-nnnn`, `getNextOrderNumber`). `CR-DEMO-<providerId>-n`
 * não colide com ela nem entre sandboxes (o id do provedor não se repete).
 * Pacote, valor e preço unitário saem de `CREDIT_PACKAGES`, como na rota.
 */
export function pedidosDeCreditoDaDemo(providerId: number, agora: Date): Array<typeof creditOrders.$inferInsert> {
  const receita = empresaPublicaSimulada("");
  return PEDIDOS.map((p) => {
    const pacote = CREDIT_PACKAGES.find((k) => k.id === p.pacote);
    if (!pacote) throw new Error(`pedidosDeCreditoDaDemo: pacote ${p.pacote} nao existe em CREDIT_PACKAGES`);
    const createdAt = new Date(agora.getTime() - p.diasAtras * DIA);
    return {
      orderNumber: `CR-DEMO-${providerId}-${p.sequencia}`,
      providerId,
      precoUnitarioCentavos: pacote.price / pacote.credits,
      providerName: receita.nomeFantasia,
      packageName: pacote.name,
      ispCredits: pacote.credits,
      spcCredits: 0,
      bigdataCredits: 0,
      amount: (pacote.price / 100).toFixed(2),
      status: p.status,
      creditType: "universal",
      paymentMethod: p.status === "paid" ? "PIX" : null,
      creditedAt: p.status === "paid" ? new Date(createdAt.getTime() + 12 * MINUTO) : null,
      notes: p.status === "cancelled" ? "Cancelado pelo provedor antes do pagamento (demonstração)" : null,
      createdByName: "Administrador da Demonstração",
      createdAt,
    };
  });
}

// ── NFS-e ────────────────────────────────────────────────────────────────────

export interface ConfigNfseDaDemo {
  configured: true;
  environment: "demonstracao";
  cnpjPrestador: string;
  razaoSocialPrestador: string;
  inscricaoMunicipal: string;
  codigoMunicipio: string;
  municipio: string;
  uf: string;
  aliquotaIss: number;
  codigoServico: string;
  descricaoPadrao: string;
}

/**
 * A configuração de NFS-e do sandbox: o prestador é o próprio provedor
 * fictício (o CNPJ gravado dele), na cidade-sede (Londrina, IBGE 4113700), com
 * um serviço de provedor de internet.
 *
 * AIDEV-NOTE: código de serviço e alíquota são ILUSTRATIVOS — nenhuma nota sai
 * da demonstração (`services/focusnfe.ts` desvia antes da rede). Não servem de
 * referência fiscal para um provedor de verdade.
 */
export function configNfseDaDemo(cnpjDoSandbox: string): ConfigNfseDaDemo {
  return {
    configured: true,
    environment: "demonstracao",
    cnpjPrestador: cnpjDoSandbox,
    razaoSocialPrestador: empresaPublicaSimulada(cnpjDoSandbox).razaoSocial,
    inscricaoMunicipal: "",
    codigoMunicipio: "4113700",
    municipio: "Londrina",
    uf: "PR",
    aliquotaIss: 2,
    codigoServico: "01.03",
    descricaoPadrao: "Serviço de valor adicionado — provimento de acesso à internet",
  };
}

export interface NotaFiscalDaDemo {
  ref: string;
  status: "authorized" | "cancelled" | "processing";
  numero?: string;
  tomadorNome: string;
  descricao: string;
  valor: number;
  emitidaEm: string;
  mensagem: string;
}

const NOTAS = [
  { diasAntes: 1, minutosAntes: 131, status: "processing", tomadorNome: "Condomínio Residencial Exemplo", descricao: "Link dedicado 300 Mbps", valor: 890 },
  { diasAntes: 4, minutosAntes: 322, status: "authorized", tomadorNome: "Mercado Fictício da Vila Ltda", descricao: "Internet empresarial 100 Mbps", valor: 349.9 },
  { diasAntes: 9, minutosAntes: 47, status: "authorized", tomadorNome: "Clínica Modelo de Fisioterapia Ltda", descricao: "Internet empresarial 500 Mbps com IP fixo", valor: 459.9 },
  { diasAntes: 13, minutosAntes: 205, status: "cancelled", tomadorNome: "Escola Demonstração de Idiomas Ltda", descricao: "Internet empresarial 200 Mbps", valor: 199.9 },
  { diasAntes: 18, minutosAntes: 96, status: "authorized", tomadorNome: "Escritório Contábil Exemplo", descricao: "Link dedicado 200 Mbps", valor: 720 },
  { diasAntes: 26, minutosAntes: 263, status: "authorized", tomadorNome: "Condomínio Edifício Fictício", descricao: "Link dedicado 1 Gbps", valor: 1290 },
] as const;

/**
 * A MESMA regra de `numeroSimulado` (services/focusnfe.ts, não exportada): o
 * número sai dos 6 últimos dígitos da referência. Por isso a nota da lista e a
 * consulta `GET /api/nfse/:ref` da mesma referência mostram o mesmo número.
 */
function numeroDaReferencia(ref: string): string {
  return (ref.replace(/\D/g, "").slice(-6) || "1").padStart(6, "0");
}

/**
 * O histórico de notas da tela de NFS-e, calculado na leitura (nada é gravado:
 * a tabela não existe e esta leva não cria tabela). Determinístico pelo
 * provedor e pelo nascimento do sandbox: a lista é a mesma durante as 24 h.
 *
 * A referência tem o formato da emissão simulada (`demo-<providerId>-<ms>`).
 * O `+ i + 1` em milissegundos garante número distinto entre notas: sem ele,
 * duas notas com 5 dias de diferença e o mesmo minuto teriam os mesmos 6
 * últimos dígitos (5 × 86.400.000 termina em 000000).
 *
 * Uma nota fica em processamento — é a única que mostra o "Verificar", e a
 * consulta simulada a devolve autorizada — e uma foi cancelada.
 */
export function notasFiscaisDaDemo(providerId: number, criadoEm: Date): NotaFiscalDaDemo[] {
  return NOTAS.map((n, i) => {
    const emitidaEm = criadoEm.getTime() - n.diasAntes * DIA - n.minutosAntes * MINUTO + i + 1;
    const ref = `demo-${providerId}-${emitidaEm}`;
    const base = { ref, tomadorNome: n.tomadorNome, descricao: n.descricao, valor: n.valor, emitidaEm: new Date(emitidaEm).toISOString() };
    if (n.status === "processing") {
      return { ...base, status: n.status, mensagem: "NFS-e simulada em processamento — use Verificar para consultar" };
    }
    const mensagem = n.status === "cancelled"
      ? "NFS-e simulada cancelada — nenhuma prefeitura foi acionada nesta demonstração"
      : "NFS-e simulada autorizada — nenhuma prefeitura foi acionada nesta demonstração";
    return { ...base, status: n.status, numero: numeroDaReferencia(ref), mensagem };
  });
}
