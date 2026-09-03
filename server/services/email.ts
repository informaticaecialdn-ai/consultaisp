/**
 * E-mails transacionais: QUANDO se manda e O QUE se diz.
 *
 * A aparencia mora em `email-ui.ts` — envelope, blocos, cores e as regras que
 * a caixa de entrada impoe. Aqui ficam so as mensagens.
 *
 * ── WHITE LABEL ────────────────────────────────────────────────────────────
 * Todo e-mail sai com a marca de quem o cliente contratou. Um alerta de fraude
 * que chega assinado "Consulta ISP" para quem comprou da "CredNet" entrega o
 * revendedor — e e o unico canal do sistema que sai do navegador e vai parar na
 * caixa de entrada, onde nao ha CSS nem host para consertar depois.
 *
 * Toda funcao aceita uma `marca` opcional. Sem ela, e a plataforma — o que
 * mantem compativel quem ainda nao passa o parametro.
 *
 * LIMITE HONESTO DO REMETENTE: o endereco do envelope depende de o dominio
 * estar verificado no Resend. Enquanto o revendedor nao verificar o dele, o
 * e-mail sai do dominio da plataforma com o NOME de exibicao da marca — e isso
 * aparece no cabecalho para quem recebe. O campo `emailRemetente` existe para
 * quando ele verificar.
 *
 * ── COMO ESCREVEMOS ────────────────────────────────────────────────────────
 * Assunto diz o que aconteceu, nao vende. Primeira frase repete o assunto em
 * palavras humanas. Uma acao por e-mail. O que o sistema gravou vai em bloco de
 * dados, para o provedor conferir sem abrir o painel. Nada de exclamacao.
 */
import { Resend } from "resend";
import { MARCA_PLATAFORMA, urlDaMarca, type MarcaResolvida } from "./marca.service";
import {
  alerta, blocoDeDados, botao, brl, divisor, envelope, esc, kicker,
  linkDeReserva, linkSecundario, paragrafo, passos, saudacao, titulo,
  DANGER, GOLD, INK, MONO, MUTED, OK, SANS, TEXT_2,
  type LinhaDeDado,
} from "./email-ui";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_EMAIL = process.env.EMAIL_FROM || "onboarding@resend.dev";

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Monta o remetente. Ver o limite honesto no topo do arquivo: sem dominio
 * verificado no Resend, so o NOME de exibicao e da marca.
 *
 * Exportado para ser conferido de fora: e a unica funcao daqui que produz um
 * CABECALHO, e cabecalho aceita coisas que o corpo nao aceita.
 */
export function remetente(marca: MarcaResolvida): string {
  const endereco = marca.emailRemetente || FROM_EMAIL;
  const nome = marca.emailNomeExibicao || marca.nomeProduto;
  // Aspas e sinais quebrariam o cabecalho; nome de marca nao precisa deles.
  const nomeLimpo = nome.replace(/["<>\r\n]/g, "").trim();
  return nomeLimpo ? `${nomeLimpo} <${endereco}>` : endereco;
}

/**
 * O endereco reduzido ao que basta para depurar: `fin***@nslink.com.br`.
 *
 * Log de servidor e retido, agregado e lido por gente que nao precisa saber
 * quem recebeu o quê. Vale ainda mais desde que os e-mails de LGPD passaram
 * por aqui: ali o destinatario e o TITULAR de dados, e o endereco dele no log
 * de erro seria tratamento de dado pessoal sem finalidade.
 */
function mascarar(email: string): string {
  const [usuario, dominio] = String(email || "").split("@");
  if (!dominio) return "***";
  return `${(usuario || "").slice(0, 3)}***@${dominio}`;
}

/**
 * Quanto tempo se espera o Resend antes de desistir.
 *
 * O SDK nao tem limite proprio: uma chamada pendurada segurava quem chamou
 * para sempre. Isso e caro em tres lugares — o webhook do Asaas (que responde
 * 200 so depois, e o Asaas reentrega o evento se demorar), a confirmacao de
 * e-mail (a tela fica em "Verificando...") e a geracao mensal de faturas (um
 * provedor lento atrasa a fila inteira).
 *
 * Estourar o tempo vira falha de envio comum: quem chama ja trata isso e
 * segue. A requisicao pode ate chegar ao Resend depois; o que se abandona e a
 * espera.
 */
const LIMITE_DE_ENVIO_MS = 10_000;

async function comLimite<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    temporizador = setTimeout(() => rejeitar(new Error(`Resend nao respondeu em ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promessa, limite]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

async function send(to: string, subject: string, html: string, marca: MarcaResolvida): Promise<void> {
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY nao configurada. Email para ${mascarar(to)} nao enviado.`);
    return;
  }
  // Assunto e CABECALHO, e quebra de linha em cabecalho e injecao. Os assuntos
  // montam com o nome do provedor e o da marca sem escape (e nao teriam como
  // escapar: assunto nao e HTML), e nenhum dos dois e validado contra caractere
  // de controle na entrada — `nomeProduto` e so `z.string().min(1).max(60)`.
  // Hoje o Resend recebe isto como campo JSON e nao como cabecalho cru, entao e
  // defesa em profundidade; o custo de mante-la e uma linha.
  const assunto = subject.replace(/[\r\n]+/g, " ").trim();
  const { data, error } = await comLimite(
    resend.emails.send({ from: remetente(marca), to, subject: assunto, html }),
    LIMITE_DE_ENVIO_MS,
  );
  if (error) {
    console.error(`[email] Erro ao enviar para ${mascarar(to)}:`, JSON.stringify(error));
    throw new Error(`Falha ao enviar email: ${error.message || JSON.stringify(error)}`);
  }
  console.log(`[email] Email enviado para ${mascarar(to)}, id: ${data?.id}`);
}

/**
 * Uma mensagem pronta, antes de sair.
 *
 * Cada e-mail se divide em `montar*` (puro: devolve isto) e `send*` (manda).
 * A divisao existe para a tela de pre-visualizacao e os testes trabalharem
 * sobre o HTML EXATO que o provedor recebe. Enquanto montagem e envio eram a
 * mesma funcao, so dava para conferir o e-mail enviando-o a alguem.
 */
export interface Mensagem {
  assunto: string;
  html: string;
}

/** O endereco por onde ESTE destinatario entra. Ver `urlDeEntrada`. */
function base(marca: MarcaResolvida, urlBase?: string): string {
  return (urlBase || urlDaMarca(marca)).replace(/\/+$/, "");
}

/** So a cor da marca, para quando o bloco pede um hex e nao o objeto inteiro. */
function acentoDaMarca(marca: MarcaResolvida): string {
  return marca.cores?.claro?.brand ?? "#4A4670";
}

/** "nslink.consultaisp.com.br" — endereco legivel, sem o protocolo. */
function enderecoLegivel(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

// ── 1. Confirmacao de cadastro ───────────────────────────────────────────────

/**
 * `urlBase` existe porque a base da MARCA nem sempre e um endereco onde o
 * destinatario consegue entrar: sem dominio proprio ativo, `urlDaMarca` cai na
 * raiz da plataforma, e la o login e recusado por desenho. Quem sabe o
 * endereco certo e quem conhece o provedor — ver `urlDeEntrada`.
 */
export function montarVerificacao(
  to: string, name: string, token: string, marca: MarcaResolvida = MARCA_PLATAFORMA,
  urlBase?: string,
): Mensagem {
  const raiz = base(marca, urlBase);
  const verifyUrl = `${raiz}/verificar-email?token=${token}`;
  const nomeProduto = esc(marca.nomeProduto);
  const html = envelope(`
    ${kicker("confirmação de cadastro")}
    ${titulo("Confirme seu e-mail para ativar a conta")}
    ${saudacao(name)}
    ${paragrafo(`Sua conta no ${nomeProduto} foi criada e falta um passo: confirmar que este e-mail é seu. É o mesmo endereço que vai receber os alertas do seu provedor, então ele precisa estar certo.`)}
    ${botao(verifyUrl, "Confirmar e-mail", marca)}
    ${blocoDeDados([
      { rotulo: "e-mail cadastrado", valor: esc(to), mono: true },
      { rotulo: "endereço de acesso", valor: esc(enderecoLegivel(raiz)), mono: true },
    ])}
    ${alerta(`<strong>O link vale por 24 horas.</strong> Depois disso, pe&ccedil;a um novo na tela de cadastro — o bot&atilde;o "Reenviar e-mail" est&aacute; l&aacute;.`)}
    ${divisor()}
    ${linkDeReserva(verifyUrl, marca)}
    ${paragrafo(`<span style="color:#918EA0;font-size:12px;">Se você não criou esta conta, ignore esta mensagem: sem a confirmação, nada é ativado.</span>`, 0)}
  `, `Confirme seu e-mail para ativar o acesso ao ${marca.nomeProduto}`, marca);
  return { assunto: `Confirme seu cadastro — ${marca.nomeProduto}`, html };
}

export async function sendVerificationEmail(
  to: string, name: string, token: string, marca: MarcaResolvida = MARCA_PLATAFORMA,
  urlBase?: string,
): Promise<void> {
  const m = montarVerificacao(to, name, token, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

// ── 2. Boas-vindas ───────────────────────────────────────────────────────────

export interface DadosDeBoasVindas {
  /** Nome de quem recebe. */
  nome: string;
  /** Razao social ou nome fantasia do provedor. */
  provedor: string;
  cnpj?: string | null;
  /** Rotulo do plano, ja em portugues ("Gratuito", "Profissional"). */
  plano: string;
  /** Saldo com que a conta comeca. */
  creditos: number;
  /** E-mail que serve de login. */
  emailDeAcesso: string;
}

/**
 * Boas-vindas — enviado quando a conta fica ATIVA, nao quando e criada.
 *
 * A diferenca importa: entre criar e confirmar o e-mail, a conta nao entra.
 * Mandar "bem-vindo, aproveite" antes disso e prometer um acesso que ainda nao
 * existe, e o provedor tenta entrar e nao consegue.
 *
 * Ele carrega os DADOS do cadastro de proposito. Este e o unico e-mail que o
 * provedor guarda; e nele que ele volta meses depois para lembrar por qual
 * endereco entra e com qual e-mail.
 */
export function montarBoasVindas(
  to: string, dados: DadosDeBoasVindas, marca: MarcaResolvida = MARCA_PLATAFORMA,
  urlBase?: string,
): Mensagem {
  const raiz = base(marca, urlBase);
  const endereco = enderecoLegivel(raiz);
  const nomeProduto = esc(marca.nomeProduto);
  const cor = marca.cores?.claro?.brand ?? "#4A4670";

  const linhas: LinhaDeDado[] = [
    { rotulo: "provedor", valor: esc(dados.provedor) },
  ];
  if (dados.cnpj) linhas.push({ rotulo: "cnpj", valor: esc(dados.cnpj), mono: true });
  linhas.push(
    { rotulo: "endereço de acesso", valor: `<a href="${esc(raiz)}" style="color:${cor};text-decoration:none;">${esc(endereco)}</a>`, mono: true },
    { rotulo: "e-mail de acesso", valor: esc(dados.emailDeAcesso), mono: true },
    { rotulo: "plano", valor: esc(dados.plano) },
    { rotulo: "créditos disponíveis", valor: String(dados.creditos), mono: true, cor: OK },
  );

  const html = envelope(`
    ${kicker("conta ativa")}
    ${titulo(`Sua conta no ${nomeProduto} está pronta`)}
    ${saudacao(dados.nome)}
    ${paragrafo(`O e-mail foi confirmado e o acesso do <strong style="color:${INK};">${esc(dados.provedor)}</strong> está liberado. Guarde esta mensagem: é nela que estão o endereço de entrada e os dados do cadastro.`)}
    ${blocoDeDados(linhas)}
    ${botao(raiz, "Entrar no painel", marca)}
    ${divisor()}
    ${kicker("por onde começar")}
    ${passos([
      `<strong style="color:${INK};font-weight:600;">Consulte um CPF antes de instalar.</strong> O score sai em segundos e já mostra se a pessoa deixou dívida em outro provedor da rede.`,
      `<strong style="color:${INK};font-weight:600;">Conecte seu ERP.</strong> IXC, MK Solutions, SGP, Hubsoft, Voalle e RBX. É o que faz sua base entrar sozinha, sem digitação.`,
      `<strong style="color:${INK};font-weight:600;">Ligue o anti-fraude.</strong> Você é avisado quando um cliente seu, ativo e em atraso, é consultado por outro provedor.`,
    ], marca)}
    ${alerta(`Consultar a <strong>sua própria base</strong> não gasta crédito. Crédito só é consumido quando a pergunta vai para a rede.`, "info")}
    ${marca.suporteEmail ? paragrafo(`Qualquer dúvida, responda este e-mail ou fale com <a href="mailto:${esc(marca.suporteEmail)}" style="color:${cor};text-decoration:none;font-weight:600;">${esc(marca.suporteEmail)}</a>.`, 0) : ""}
  `, `Conta ativa: ${dados.provedor} já pode consultar a rede`, marca);
  return { assunto: `Bem-vindo ao ${marca.nomeProduto} — sua conta está ativa`, html };
}

export async function sendWelcomeEmail(
  to: string, dados: DadosDeBoasVindas, marca: MarcaResolvida = MARCA_PLATAFORMA,
  urlBase?: string,
): Promise<void> {
  const m = montarBoasVindas(to, dados, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

// ── 3. Redefinicao de senha ──────────────────────────────────────────────────

/** `urlBase`: mesma razao do e-mail de verificacao, logo acima. */
export function montarRedefinicaoDeSenha(
  to: string, name: string, token: string, marca: MarcaResolvida = MARCA_PLATAFORMA,
  urlBase?: string,
): Mensagem {
  const raiz = base(marca, urlBase);
  const resetUrl = `${raiz}/login?reset=${token}`;
  const html = envelope(`
    ${kicker("segurança da conta")}
    ${titulo("Criar uma nova senha")}
    ${saudacao(name)}
    ${paragrafo(`Alguém pediu para redefinir a senha desta conta. Se foi você, use o botão abaixo — a senha atual continua valendo até você escolher a nova.`)}
    ${botao(resetUrl, "Criar nova senha", marca)}
    ${blocoDeDados([
      { rotulo: "conta", valor: esc(to), mono: true },
      { rotulo: "o link expira em", valor: "1 hora", mono: true, cor: GOLD },
    ])}
    ${alerta(`<strong>Se não foi você, ignore esta mensagem.</strong> A senha só muda depois que alguém abre este link, e ele vale por uma hora. Se isso se repetir, avise o suporte.`, "aviso")}
    ${divisor()}
    ${linkDeReserva(resetUrl, marca)}
  `, `Link para criar uma nova senha no ${marca.nomeProduto}`, marca);
  return { assunto: `Redefinição de senha — ${marca.nomeProduto}`, html };
}

export async function sendPasswordResetEmail(
  to: string, name: string, token: string, marca: MarcaResolvida = MARCA_PLATAFORMA,
  urlBase?: string,
): Promise<void> {
  const m = montarRedefinicaoDeSenha(to, name, token, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

/**
 * Aviso de que a senha MUDOU.
 *
 * E o par do e-mail acima e a unica defesa do provedor contra troca silenciosa:
 * quem tomou a conta muda a senha e, sem este aviso, o dono so descobre quando
 * tenta entrar. Nao tem botao de acao — tem o caminho para reagir.
 */
export function montarSenhaAlterada(
  to: string, name: string, marca: MarcaResolvida = MARCA_PLATAFORMA,
  urlBase?: string, quando: Date = new Date(),
): Mensagem {
  const raiz = base(marca, urlBase);
  const carimbo = quando.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
  const contato = marca.suporteEmail
    ? `<a href="mailto:${esc(marca.suporteEmail)}" style="color:${DANGER};text-decoration:none;font-weight:600;">${esc(marca.suporteEmail)}</a>`
    : "o suporte";
  const html = envelope(`
    ${kicker("segurança da conta")}
    ${titulo("A senha desta conta foi alterada")}
    ${saudacao(name)}
    ${paragrafo("A senha foi trocada agora. Se foi você, não precisa fazer nada — esta mensagem existe só para registrar.")}
    ${blocoDeDados([
      { rotulo: "conta", valor: esc(to), mono: true },
      { rotulo: "quando", valor: esc(carimbo), mono: true },
    ])}
    ${alerta(`<strong>Se não foi você, aja agora.</strong> Peça uma nova redefinição de senha em ${esc(enderecoLegivel(raiz))} e fale com ${contato}. Quem trocou a senha entra com ela até você trocar de novo.`, "perigo")}
    ${linkSecundario(`${raiz}/login`, "Ir para a tela de acesso", marca)}
  `, "A senha da sua conta foi alterada", marca);
  return { assunto: `Sua senha foi alterada — ${marca.nomeProduto}`, html };
}

export async function sendPasswordChangedEmail(
  to: string, name: string, marca: MarcaResolvida = MARCA_PLATAFORMA,
  urlBase?: string, quando: Date = new Date(),
): Promise<void> {
  const m = montarSenhaAlterada(to, name, marca, urlBase, quando);
  await send(to, m.assunto, m.html, marca);
}

// ── 4. Alerta anti-fraude ────────────────────────────────────────────────────

/**
 * `urlBase`: a outra metade do mesmo buraco do e-mail de verificacao. O botao
 * "Ver o alerta" apontava para a base da MARCA, e sem dominio proprio ativo —
 * praticamente a base inteira hoje — essa base e a RAIZ da plataforma. La o
 * cookie de sessao (host-only, emitido no subdominio do provedor) nao existe e
 * o app serve a LANDING PAGE: o dono do alerta clicava e caia numa pagina de
 * vendas. Quem sabe por onde ESTE provedor entra e quem conhece o provedor —
 * ver `urlDeEntrada`.
 */
export function montarAlertaAntiFraude(
  providerName: string,
  maskedCpf: string,
  maskedCustomerName: string,
  marca: MarcaResolvida = MARCA_PLATAFORMA,
  /** A foto do momento: e o que diz POR QUE o aviso existe. */
  detalhes?: { valor: number; dias: number; contrato: string; motivo?: string; resumo?: string },
  urlBase?: string,
): Mensagem {
  const alertaUrl = `${base(marca, urlBase)}/anti-fraude`;

  const linhas: LinhaDeDado[] = [
    { rotulo: "cliente", valor: esc(maskedCustomerName) },
    { rotulo: "cpf", valor: esc(maskedCpf), mono: true },
  ];
  if (detalhes) {
    linhas.push({ rotulo: "contrato", valor: esc(detalhes.contrato) });
    linhas.push(
      detalhes.valor > 0
        ? { rotulo: "em aberto", valor: `${brl(detalhes.valor)} <span style="color:${MUTED};font-size:12px;">há ${detalhes.dias} dia${detalhes.dias === 1 ? "" : "s"}</span>`, mono: true, cor: DANGER }
        : { rotulo: "em aberto", valor: "sem fatura vencida", mono: true },
    );
  }

  const html = envelope(`
    ${kicker("alerta anti-fraude", GOLD)}
    ${titulo("Um cliente seu foi consultado por outro provedor")}
    ${saudacao(providerName)}
    ${paragrafo(
      detalhes?.motivo
        ? `<strong style="color:${INK};font-weight:600;">${esc(detalhes.motivo)}</strong>`
        : `Um cliente ativo da sua base acabou de ser avaliado por outro provedor da rede.`,
      10,
    )}
    ${blocoDeDados(linhas)}
    ${paragrafo(
      detalhes?.resumo
        ? esc(detalhes.resumo)
        : "Na prática, ele está procurando outro fornecedor. É a janela para agir: cobrar, renegociar, recolher o equipamento ou reter — antes que ele instale em outro lugar.",
    )}
    ${botao(alertaUrl, "Ver o alerta no painel", marca)}
    ${divisor()}
    ${paragrafo(`<span style="color:#918EA0;font-size:12px;">Quem consultou não é identificado: a rede troca risco, não nome de concorrente. Você escolhe o que vigiar na aba Anti-Fraude do painel.</span>`, 0)}
  `, `${maskedCustomerName} foi consultado por outro provedor da rede`, marca);
  return { assunto: `Alerta: cliente consultado por outro provedor — ${marca.nomeProduto}`, html };
}

export async function sendProactiveAlertEmail(
  to: string,
  providerName: string,
  maskedCpf: string,
  maskedCustomerName: string,
  marca: MarcaResolvida = MARCA_PLATAFORMA,
  detalhes?: { valor: number; dias: number; contrato: string; motivo?: string; resumo?: string },
  urlBase?: string,
): Promise<void> {
  const m = montarAlertaAntiFraude(providerName, maskedCpf, maskedCustomerName, marca, detalhes, urlBase);
  await send(to, m.assunto, m.html, marca);
}

// ── 5. Cadastro analisado (KYC) ──────────────────────────────────────────────

/**
 * Aprovacao do cadastro.
 *
 * Ate hoje o provedor descobria que passou na analise tentando entrar. Quem
 * analisa e a plataforma, o prazo nao e prometido em lugar nenhum, e do lado de
 * fora isso e indistinguivel de "esqueceram de mim".
 */
export function montarCadastroAprovado(
  provedor: string, nome: string, marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Mensagem {
  const raiz = base(marca, urlBase);
  const html = envelope(`
    ${kicker("cadastro aprovado", OK)}
    ${titulo("Cadastro aprovado")}
    ${saudacao(nome)}
    ${paragrafo(`Terminamos a análise do cadastro do <strong style="color:${INK};">${esc(provedor)}</strong> e está tudo certo. O acesso completo já está liberado.`)}
    ${blocoDeDados([
      { rotulo: "provedor", valor: esc(provedor) },
      { rotulo: "situação", valor: "aprovado", mono: true, cor: OK },
    ])}
    ${botao(raiz, "Entrar no painel", marca)}
    ${paragrafo(`<span style="color:#918EA0;font-size:12px;">A partir de agora seu provedor também contribui com a rede: o que você marca como inadimplente ajuda outro provedor a não levar o mesmo calote, e vice-versa.</span>`, 0)}
  `, `O cadastro do ${provedor} foi aprovado`, marca);
  return { assunto: `Cadastro aprovado — ${marca.nomeProduto}`, html };
}

export async function sendCadastroAprovadoEmail(
  to: string, provedor: string, nome: string, marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Promise<void> {
  const m = montarCadastroAprovado(provedor, nome, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

/**
 * Reprovacao do cadastro.
 *
 * O motivo e obrigatorio na chamada, e nao opcional, porque "seu cadastro foi
 * reprovado" sem motivo transforma um problema resolvivel — documento ilegivel,
 * CNPJ com pendencia — numa porta fechada sem maçaneta.
 */
export function montarCadastroReprovado(
  provedor: string, nome: string, motivo: string,
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Mensagem {
  const raiz = base(marca, urlBase);
  const contato = marca.suporteEmail
    ? ` ou escreva para <a href="mailto:${esc(marca.suporteEmail)}" style="color:${acentoDaMarca(marca)};text-decoration:none;font-weight:600;">${esc(marca.suporteEmail)}</a>`
    : "";
  const html = envelope(`
    ${kicker("cadastro em pendência", DANGER)}
    ${titulo("Precisamos de um ajuste no seu cadastro")}
    ${saudacao(nome)}
    ${paragrafo(`A análise do cadastro do <strong style="color:${INK};">${esc(provedor)}</strong> não pôde ser concluída como está. Isso não encerra nada: é só o que falta acertar.`)}
    ${alerta(`<strong>Motivo:</strong> ${esc(motivo)}`, "perigo")}
    ${paragrafo(`Corrija o que foi apontado no Painel do Provedor${contato}. Assim que você reenviar, a análise recomeça.`)}
    ${botao(`${raiz}/painel-provedor`, "Abrir o painel do provedor", marca)}
  `, `Falta um ajuste no cadastro do ${provedor}`, marca);
  return { assunto: `Cadastro em pendência — ${marca.nomeProduto}`, html };
}

export async function sendCadastroReprovadoEmail(
  to: string, provedor: string, nome: string, motivo: string,
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Promise<void> {
  const m = montarCadastroReprovado(provedor, nome, motivo, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

// ── 6. Acesso suspenso e reativado ───────────────────────────────────────────

/**
 * Suspensao.
 *
 * O provedor tem que saber ANTES de tentar entrar e ver "acesso suspenso" numa
 * tela de login — e tem que ficar claro que os dados continuam onde estavam.
 * Suspensao e ato comercial, nao apagamento.
 */
export function montarAcessoSuspenso(
  provedor: string, nome: string, motivo: string | undefined,
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Mensagem {
  const contato = marca.suporteEmail
    ? `<a href="mailto:${esc(marca.suporteEmail)}" style="color:${acentoDaMarca(marca)};text-decoration:none;font-weight:600;">${esc(marca.suporteEmail)}</a>`
    : "o suporte";
  const html = envelope(`
    ${kicker("acesso suspenso", DANGER)}
    ${titulo("O acesso do seu provedor foi suspenso")}
    ${saudacao(nome)}
    ${paragrafo(`O acesso do <strong style="color:${INK};">${esc(provedor)}</strong> ao painel está suspenso. Ninguém do seu time consegue entrar enquanto estiver assim.`)}
    ${motivo ? alerta(`<strong>Motivo:</strong> ${esc(motivo)}`, "perigo") : ""}
    ${blocoDeDados([
      { rotulo: "provedor", valor: esc(provedor) },
      { rotulo: "situação", valor: "suspenso", mono: true, cor: DANGER },
      { rotulo: "seus dados", valor: "preservados", mono: true },
    ])}
    ${paragrafo(`Nada foi apagado: clientes, consultas, equipamentos e histórico continuam exatamente como estavam e voltam no mesmo lugar quando o acesso for restabelecido. Para resolver, fale com ${contato}.`, 0)}
  `, `O acesso do ${provedor} foi suspenso`, marca);
  return { assunto: `Acesso suspenso — ${marca.nomeProduto}`, html };
}

export async function sendAcessoSuspensoEmail(
  to: string, provedor: string, nome: string, motivo: string | undefined,
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Promise<void> {
  const m = montarAcessoSuspenso(provedor, nome, motivo, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

export function montarAcessoReativado(
  provedor: string, nome: string, marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Mensagem {
  const raiz = base(marca, urlBase);
  const html = envelope(`
    ${kicker("acesso restabelecido", OK)}
    ${titulo("O acesso do seu provedor voltou")}
    ${saudacao(nome)}
    ${paragrafo(`A suspensão do <strong style="color:${INK};">${esc(provedor)}</strong> foi levantada. Seu time já pode entrar normalmente, e tudo está onde ficou.`)}
    ${botao(raiz, "Entrar no painel", marca)}
  `, `O acesso do ${provedor} foi restabelecido`, marca);
  return { assunto: `Acesso restabelecido — ${marca.nomeProduto}`, html };
}

export async function sendAcessoReativadoEmail(
  to: string, provedor: string, nome: string, marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Promise<void> {
  const m = montarAcessoReativado(provedor, nome, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

// ── 7. Creditos liberados ────────────────────────────────────────────────────

export interface DadosDeCredito {
  /** Numero do pedido, como aparece no painel (CR-AAAAMM-NNNN). */
  pedido: string;
  pacote: string;
  creditos: number;
  valor: number;
  /** Saldo depois da liberacao. */
  saldo: number;
}

/**
 * Confirmacao de que o pagamento entrou e o credito esta na conta.
 *
 * O provedor paga um PIX e fecha a aba. Sem este e-mail, a unica forma de saber
 * se caiu e abrir o painel e conferir o saldo — e e a duvida que mais gera
 * mensagem no suporte.
 */
export function montarCreditosLiberados(
  nome: string, dados: DadosDeCredito, marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Mensagem {
  const raiz = base(marca, urlBase);
  const html = envelope(`
    ${kicker("pagamento confirmado", OK)}
    ${titulo("Seus créditos já estão na conta")}
    ${saudacao(nome)}
    ${paragrafo("O pagamento foi confirmado e os créditos entraram no saldo. Não precisa fazer mais nada.")}
    ${blocoDeDados([
      { rotulo: "pedido", valor: esc(dados.pedido), mono: true },
      { rotulo: "pacote", valor: esc(dados.pacote) },
      { rotulo: "créditos adicionados", valor: `+${dados.creditos}`, mono: true, cor: OK },
      { rotulo: "valor pago", valor: brl(dados.valor), mono: true },
      { rotulo: "saldo atual", valor: String(dados.saldo), mono: true },
    ])}
    ${botao(`${raiz}/consulta-isp`, "Fazer uma consulta", marca)}
    ${paragrafo(`<span style="color:#918EA0;font-size:12px;">Consultar a sua própria base continua gratuito. Crédito só é usado quando a pergunta vai para a rede.</span>`, 0)}
  `, `${dados.creditos} créditos adicionados ao seu saldo`, marca);
  return { assunto: `Créditos liberados — ${marca.nomeProduto}`, html };
}

export async function sendCreditosLiberadosEmail(
  to: string, nome: string, dados: DadosDeCredito,
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Promise<void> {
  const m = montarCreditosLiberados(nome, dados, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

// ── 8. Fatura ────────────────────────────────────────────────────────────────

export interface DadosDeFatura {
  numero: string;
  /** Competencia como o provedor le: "setembro de 2026". */
  competencia: string;
  plano: string;
  valor: number;
  /** Vencimento ja formatado em dd/mm/aaaa. */
  vencimento: string;
  /** Link de pagamento do Asaas, quando existir. */
  linkDePagamento?: string | null;
}

export function montarFaturaGerada(
  nome: string, dados: DadosDeFatura, marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Mensagem {
  const raiz = base(marca, urlBase);
  const html = envelope(`
    ${kicker("fatura disponível")}
    ${titulo(`Fatura de ${esc(dados.competencia)}`)}
    ${saudacao(nome)}
    ${paragrafo(`A fatura da sua assinatura foi emitida. Abaixo está o que ela cobre.`)}
    ${blocoDeDados([
      { rotulo: "número", valor: esc(dados.numero), mono: true },
      { rotulo: "plano", valor: esc(dados.plano) },
      { rotulo: "competência", valor: esc(dados.competencia) },
      { rotulo: "valor", valor: brl(dados.valor), mono: true },
      { rotulo: "vencimento", valor: esc(dados.vencimento), mono: true, cor: GOLD },
    ])}
    ${dados.linkDePagamento
      ? botao(dados.linkDePagamento, "Pagar agora", marca)
      : botao(`${raiz}/nfse`, "Ver a fatura no painel", marca)}
    ${dados.linkDePagamento ? linkSecundario(`${raiz}/nfse`, "Ver todas as faturas no painel", marca) : ""}
  `, `Fatura de ${dados.competencia}: ${brl(dados.valor)}, vence em ${dados.vencimento}`, marca);
  return { assunto: `Fatura de ${dados.competencia} — ${marca.nomeProduto}`, html };
}

export async function sendFaturaGeradaEmail(
  to: string, nome: string, dados: DadosDeFatura,
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Promise<void> {
  const m = montarFaturaGerada(nome, dados, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

export function montarFaturaPaga(
  nome: string, dados: Pick<DadosDeFatura, "numero" | "competencia" | "valor">,
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Mensagem {
  const raiz = base(marca, urlBase);
  const html = envelope(`
    ${kicker("pagamento confirmado", OK)}
    ${titulo("Recebemos o pagamento da sua fatura")}
    ${saudacao(nome)}
    ${paragrafo("Está quitada. Guardamos o registro no painel, na aba de faturas.")}
    ${blocoDeDados([
      { rotulo: "número", valor: esc(dados.numero), mono: true },
      { rotulo: "competência", valor: esc(dados.competencia) },
      { rotulo: "valor pago", valor: brl(dados.valor), mono: true, cor: OK },
    ])}
    ${linkSecundario(`${raiz}/nfse`, "Ver no painel", marca)}
  `, `Fatura ${dados.numero} quitada`, marca);
  return { assunto: `Pagamento confirmado — ${marca.nomeProduto}`, html };
}

export async function sendFaturaPagaEmail(
  to: string, nome: string, dados: Pick<DadosDeFatura, "numero" | "competencia" | "valor">,
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Promise<void> {
  const m = montarFaturaPaga(nome, dados, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

// ── 9. Plano alterado ────────────────────────────────────────────────────────

export function montarPlanoAlterado(
  nome: string,
  dados: { de: string; para: string; creditosDoPlano?: number; observacao?: string | null },
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Mensagem {
  const raiz = base(marca, urlBase);
  const linhas: LinhaDeDado[] = [
    { rotulo: "plano anterior", valor: esc(dados.de) },
    { rotulo: "plano atual", valor: esc(dados.para), cor: OK },
  ];
  if (dados.creditosDoPlano && dados.creditosDoPlano > 0) {
    linhas.push({ rotulo: "créditos inclusos por mês", valor: String(dados.creditosDoPlano), mono: true });
  }
  const html = envelope(`
    ${kicker("assinatura")}
    ${titulo("Seu plano foi alterado")}
    ${saudacao(nome)}
    ${paragrafo("A mudança já está valendo na sua conta.")}
    ${blocoDeDados(linhas)}
    ${dados.observacao ? alerta(esc(dados.observacao), "info") : ""}
    ${linkSecundario(`${raiz}/painel-provedor`, "Ver os detalhes no painel", marca)}
  `, `Plano alterado de ${dados.de} para ${dados.para}`, marca);
  return { assunto: `Plano alterado — ${marca.nomeProduto}`, html };
}

export async function sendPlanoAlteradoEmail(
  to: string, nome: string,
  dados: { de: string; para: string; creditosDoPlano?: number; observacao?: string | null },
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Promise<void> {
  const m = montarPlanoAlterado(nome, dados, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

// ── 10. Usuario adicionado ao provedor ───────────────────────────────────────

/**
 * Alguem foi incluido na equipe do provedor.
 *
 * A SENHA NAO VAI NESTE E-MAIL, de proposito. Hoje quem cria escolhe a senha e
 * a entrega por fora — e-mail nao e canal seguro para senha: fica na caixa de
 * entrada, no backup, no encaminhamento. O que este e-mail da e o endereco
 * certo de entrada e o caminho para definir a propria senha.
 */
export function montarUsuarioAdicionado(
  nome: string, provedor: string, quemAdicionou: string, emailDeAcesso: string,
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Mensagem {
  const raiz = base(marca, urlBase);
  const html = envelope(`
    ${kicker("acesso criado")}
    ${titulo(`Você foi adicionado ao ${esc(provedor)}`)}
    ${saudacao(nome)}
    ${paragrafo(`<strong style="color:${INK};">${esc(quemAdicionou)}</strong> criou um acesso para você no ${esc(marca.nomeProduto)}, dentro do provedor <strong style="color:${INK};">${esc(provedor)}</strong>.`)}
    ${blocoDeDados([
      { rotulo: "endereço de acesso", valor: esc(enderecoLegivel(raiz)), mono: true },
      { rotulo: "e-mail de acesso", valor: esc(emailDeAcesso), mono: true },
    ])}
    ${botao(`${raiz}/login`, "Entrar", marca)}
    ${alerta(`A senha inicial é definida por quem criou o acesso e <strong>não viaja por e-mail</strong>. Se você não a recebeu, use "Esqueci minha senha" na tela de acesso e defina a sua.`, "info")}
  `, `Seu acesso ao ${provedor} foi criado`, marca);
  return { assunto: `Seu acesso ao ${provedor} — ${marca.nomeProduto}`, html };
}

export async function sendUsuarioAdicionadoEmail(
  to: string, nome: string, provedor: string, quemAdicionou: string, emailDeAcesso: string,
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Promise<void> {
  const m = montarUsuarioAdicionado(nome, provedor, quemAdicionou, emailDeAcesso, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

// ── 11. Sincronizacao com o ERP pausada ──────────────────────────────────────

export interface DadosDeErpPausado {
  /** O ERP como ele aparece na tela: "IXC Soft", "MK Solutions". */
  erp: string;
  /** Quantas varreduras seguidas terminaram em erro antes da pausa. */
  falhasSeguidas: number;
  /** A ultima mensagem que a leitura devolveu. Opcional: nem sempre ha uma. */
  ultimoErro?: string;
}

/**
 * O freio automatico avisando quem pode consertar o ERP.
 *
 * Este e-mail nasceu junto com a decisao de tirar a configuracao do ERP do
 * painel do provedor: ele deixou de ter botao de salvar, testar e sincronizar,
 * e com isso deixou de existir o humano que, do lado dele, desligava uma
 * integracao morta na mao. Sem aviso, um ERP fora do ar viraria uma base que
 * envelhece em silencio — foi o que aconteceu com a NG em 31/08/2026.
 *
 * O e-mail nao promete religar sozinho, de proposito. Quem religa e o suporte,
 * porque a credencial agora so se edita no painel da plataforma; dizer outra
 * coisa mandaria o provedor procurar um botao que nao existe mais.
 */
export function montarErpPausado(
  nome: string, dados: DadosDeErpPausado,
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Mensagem {
  const raiz = base(marca, urlBase);
  // "1 vez seguidas" nao existe em portugues, e o limiar ja foi outro numero
  // antes — o texto tem de sobreviver a proxima mudanca dele.
  const vezes = dados.falhasSeguidas === 1
    ? "1 vez"
    : `${dados.falhasSeguidas} vezes seguidas`;
  const contato = marca.suporteEmail
    ? `<a href="mailto:${esc(marca.suporteEmail)}" style="color:${acentoDaMarca(marca)};text-decoration:none;font-weight:600;">${esc(marca.suporteEmail)}</a>`
    : "o suporte";

  const html = envelope(`
    ${kicker("sincronização pausada", DANGER)}
    ${titulo("Pausamos a sincronização com o seu ERP")}
    ${saudacao(nome)}
    ${paragrafo(`A leitura automática da sua base no <strong style="color:${INK};">${esc(dados.erp)}</strong> falhou ${vezes}. Para não continuar batendo num sistema que não responde, a sincronização foi pausada.`)}
    ${blocoDeDados([
      { rotulo: "erp", valor: esc(dados.erp), mono: true },
      { rotulo: "falhas seguidas", valor: String(dados.falhasSeguidas), mono: true, cor: DANGER },
      { rotulo: "situação", valor: "pausada", mono: true, cor: DANGER },
    ])}
    ${dados.ultimoErro ? alerta(`<strong>Último erro:</strong> ${esc(dados.ultimoErro)}`, "perigo") : ""}
    ${paragrafo("Nada foi apagado. Enquanto estiver pausada, o painel continua mostrando o que já foi lido — o que para de acontecer é a atualização: quem pagar ou atrasar a partir de agora não aparece.")}
    ${passos([
      `Confirme se o ${esc(dados.erp)} está no ar e respondendo.`,
      "Se o acesso mudou — endereço, usuário, token — ou se o IP do nosso servidor precisa ser liberado no painel do ERP, ajuste por lá.",
      `Avise ${contato} para religar a sincronização.`,
    ], marca)}
    ${botao(`${raiz}/painel-provedor`, "Ver a situação no painel", marca)}
    ${paragrafo(`<span style="color:${MUTED};font-size:12px;">A configuração da integração é feita pela nossa equipe, então religar passa pelo suporte. No painel você acompanha a situação e a data da última leitura.</span>`, 0)}
  `, `A leitura da sua base no ${dados.erp} falhou ${vezes}`, marca);
  return { assunto: `Sincronização com o ERP pausada — ${marca.nomeProduto}`, html };
}

export async function sendErpPausadoEmail(
  to: string, nome: string, dados: DadosDeErpPausado,
  marca: MarcaResolvida = MARCA_PLATAFORMA, urlBase?: string,
): Promise<void> {
  const m = montarErpPausado(nome, dados, marca, urlBase);
  await send(to, m.assunto, m.html, marca);
}

// ── Exposto para a pre-visualizacao ──────────────────────────────────────────

/**
 * Os blocos visuais tambem saem daqui para que a tela de pre-visualizacao e os
 * testes montem exatamente o mesmo HTML que o provedor recebe — e nao uma
 * imitacao que envelhece.
 */
export { envelope, blocoDeDados, botao, titulo, kicker, paragrafo, alerta, passos } from "./email-ui";
export { SANS, MONO, INK, TEXT_2 } from "./email-ui";

/**
 * O unico ponto do sistema que fala com o Resend.
 *
 * Exposto para o e-mail de LGPD, que mantinha um segundo cliente e um segundo
 * remetente — e o segundo saia do `EMAIL_FROM` cru, ignorando a marca. Duas
 * copias da mesma regra e como o revendedor acaba entregue por um cabecalho.
 *
 * LANCA quando o Resend recusa. Quem chama decide o que fazer com isso: os
 * gatilhos de provedor passam por `avisarProvedor`, que engole e registra,
 * porque o ato que disparou o aviso ja terminou.
 */
export { send as enviarEmail };
