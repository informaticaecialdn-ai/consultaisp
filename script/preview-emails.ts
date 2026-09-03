/**
 * Pre-visualizacao dos e-mails transacionais.
 *
 *   npx tsx script/preview-emails.ts [pasta-de-saida]
 *
 * Renderiza TODOS os e-mails com o codigo real (`montar*`, que sao funcoes
 * puras) e grava um HTML por mensagem, mais um `indice.json`. Nao envia nada e
 * nao toca no banco.
 *
 * Existe porque, antes da divisao entre montar e enviar, a unica forma de ver
 * um e-mail era manda-lo para alguem — e ninguem revisa texto assim. Com isto,
 * qualquer mudanca de copy ou de layout pode ser conferida no navegador antes
 * de chegar na caixa de entrada de um provedor.
 *
 * Os dados sao de exemplo, escolhidos para exercitar os casos dificeis: nome
 * longo, valor com centavos, CPF mascarado, motivo de reprovacao com frase
 * inteira.
 */
import fs from "fs";
import path from "path";
import { MARCA_PLATAFORMA } from "../server/services/marca.service";
import * as email from "../server/services/email";

const SAIDA = process.argv[2] || path.resolve("tmp-emails");

/** O endereco de um provedor real: subdominio, que e por onde ele entra. */
const URL_DO_PROVEDOR = "https://nslink.consultaisp.com.br";

export interface ExemploDeEmail {
  chave: string;
  nome: string;
  /** Em que momento da vida do provedor esta mensagem sai. */
  quando: string;
  assunto: string;
  html: string;
}

export function exemplos(marca = MARCA_PLATAFORMA, url = URL_DO_PROVEDOR): ExemploDeEmail[] {
  const monte = (chave: string, nome: string, quando: string, m: email.Mensagem): ExemploDeEmail =>
    ({ chave, nome, quando, assunto: m.assunto, html: m.html });

  return [
    monte("verificacao", "Confirmação de cadastro",
      "Assim que o provedor se cadastra, e de novo a cada pedido de reenvio.",
      email.montarVerificacao("financeiro@nslink.com.br", "Emerson Queiroz", "tok-exemplo-1234567890abcdef", marca, url)),

    monte("boas-vindas", "Boas-vindas",
      "Quando o e-mail é confirmado e a conta fica ativa. É o e-mail que o provedor guarda.",
      email.montarBoasVindas("financeiro@nslink.com.br", {
        nome: "Emerson Queiroz",
        provedor: "NsLink Provedor",
        cnpj: "12.345.678/0001-90",
        plano: "Gratuito",
        creditos: 50,
        emailDeAcesso: "financeiro@nslink.com.br",
      }, marca, url)),

    monte("reset", "Redefinição de senha",
      "Quando alguém pede um link para criar uma nova senha.",
      email.montarRedefinicaoDeSenha("financeiro@nslink.com.br", "Emerson Queiroz", "tok-reset-abcdef1234567890", marca, url)),

    monte("senha-alterada", "Senha alterada",
      "Logo depois de a senha mudar. É a defesa do provedor contra troca silenciosa.",
      email.montarSenhaAlterada("financeiro@nslink.com.br", "Emerson Queiroz", marca, url, new Date(2026, 8, 3, 14, 32))),

    monte("anti-fraude", "Alerta anti-fraude",
      "Quando um cliente ativo e inadimplente é consultado por outro provedor da rede.",
      email.montarAlertaAntiFraude("NsLink Provedor", "123.***.**9-04", "Karina B. dos S.", marca, {
        valor: 526,
        dias: 76,
        contrato: "Cinco Conjuntos · 300 MB",
        motivo: "Cliente ativo com fatura vencida foi consultado por um provedor parceiro",
        resumo: "Ele está com 76 dias de atraso e acaba de ser avaliado por outro provedor da rede.",
      }, url)),

    monte("kyc-aprovado", "Cadastro aprovado",
      "Quando a plataforma conclui a análise do cadastro e aprova.",
      email.montarCadastroAprovado("NsLink Provedor", "Emerson Queiroz", marca, url)),

    monte("kyc-reprovado", "Cadastro em pendência",
      "Quando a análise não pode ser concluída. O motivo é obrigatório.",
      email.montarCadastroReprovado("NsLink Provedor", "Emerson Queiroz",
        "O contrato social enviado está ilegível na página das assinaturas. Reenvie o documento completo e nítido.", marca, url)),

    monte("suspenso", "Acesso suspenso",
      "Quando o provedor é suspenso — chega antes de ele descobrir na tela de login.",
      email.montarAcessoSuspenso("NsLink Provedor", "Emerson Queiroz",
        "Fatura de agosto em aberto há mais de 30 dias.", marca, url)),

    monte("reativado", "Acesso restabelecido",
      "Quando a suspensão é levantada.",
      email.montarAcessoReativado("NsLink Provedor", "Emerson Queiroz", marca, url)),

    monte("creditos", "Créditos liberados",
      "Quando o pagamento do pedido de créditos é confirmado e o saldo entra.",
      email.montarCreditosLiberados("Emerson Queiroz", {
        pedido: "CR-202609-0042", pacote: "250 créditos", creditos: 250, valor: 250, saldo: 479,
      }, marca, url)),

    monte("fatura", "Fatura disponível",
      "Quando a fatura mensal da assinatura é emitida.",
      email.montarFaturaGerada("Emerson Queiroz", {
        numero: "NF-2026-000128", competencia: "setembro de 2026", plano: "Profissional",
        valor: 99, vencimento: "10/09/2026", linkDePagamento: "https://www.asaas.com/i/exemplo",
      }, marca, url)),

    monte("fatura-paga", "Pagamento confirmado",
      "Quando a fatura é quitada.",
      email.montarFaturaPaga("Emerson Queiroz", {
        numero: "NF-2026-000128", competencia: "setembro de 2026", valor: 99,
      }, marca, url)),

    monte("plano", "Plano alterado",
      "Quando o plano da assinatura muda.",
      email.montarPlanoAlterado("Emerson Queiroz", {
        de: "Gratuito", para: "Profissional", creditosDoPlano: 0,
        observacao: "A cobrança passa a valer a partir da próxima fatura.",
      }, marca, url)),

    monte("usuario", "Acesso criado para um usuário",
      "Quando o provedor adiciona alguém à equipe. A senha nunca vai por e-mail.",
      email.montarUsuarioAdicionado("Karina Souza", "NsLink Provedor", "Emerson Queiroz",
        "karina@nslink.com.br", marca, url)),
  ];
}

function main(): void {
  const lista = exemplos();
  fs.mkdirSync(SAIDA, { recursive: true });
  for (const x of lista) fs.writeFileSync(path.join(SAIDA, `${x.chave}.html`), x.html, "utf8");
  fs.writeFileSync(
    path.join(SAIDA, "indice.json"),
    JSON.stringify(lista.map(({ html, ...resto }) => ({ ...resto, bytes: Buffer.byteLength(html, "utf8") })), null, 1),
    "utf8",
  );
  console.log(`${lista.length} e-mails em ${SAIDA}`);
  for (const x of lista) console.log(` · ${x.chave.padEnd(16)} ${x.assunto}`);
}

// Só roda quando chamado direto; importar daqui (testes, artefato) não escreve nada.
if (process.argv[1] && process.argv[1].endsWith("preview-emails.ts")) main();
