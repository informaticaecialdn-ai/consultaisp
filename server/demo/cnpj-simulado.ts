/**
 * O cadastro da Receita de mentira da demonstração pública.
 *
 * O botão "buscar na Receita" da ficha do provedor consulta três fontes
 * públicas de terceiros (`consultarCnpjPublico`). No sandbox o CNPJ é
 * inventado (`cnpjDoSandbox`): cada clique de visitante virava tráfego para
 * fora da demonstração, e as fontes recusavam o número — a tela respondia 502
 * dizendo que "a Receita recusou", sobre um CNPJ que nunca existiu.
 *
 * Aqui a resposta é local e fixa, coerente com o sandbox: o mesmo nome do
 * provedor que `tentarCriarSandbox` grava, na cidade-sede do mundo base
 * (Londrina/PR), com o CNPJ que foi pedido. Sem telefone: nada que pareça
 * contato de uma empresa real.
 *
 * Os sócios existem desde a rodada 2 da demo (13/09/2026): sem eles o
 * importador de QSA da ficha nunca aparecia, e a ficha semeada do sandbox
 * (`sociosDaDemo`, semeadura-ficha.ts) passou a ter dois — que são estes, lidos
 * daqui, para "buscar na Receita" e a ficha nunca discordarem. Nome fictício e
 * CPF mascarado do jeito que a própria Receita publica o QSA: nenhum documento
 * inteiro existe para ser confundido com o de alguém.
 */
import type { EmpresaPublica } from "../services/cnpj-publico.service";

export function empresaPublicaSimulada(cnpj: string): EmpresaPublica {
  return {
    razaoSocial: "PROVEDOR DEMONSTRACAO LTDA",
    nomeFantasia: "Provedor Demonstração",
    cnpj,
    naturezaJuridica: "Sociedade Empresária Limitada",
    dataAbertura: "2015-03-10",
    atividadePrincipal: "Provedores de acesso às redes de comunicações",
    telefone: "",
    email: "contato@demo.consultaisp.com.br",
    cep: "86010000",
    logradouro: "RUA DA DEMONSTRACAO",
    numero: "100",
    complemento: "",
    bairro: "CENTRO",
    cidade: "LONDRINA",
    uf: "PR",
    situacao: "ATIVA",
    socios: [
      { nome: "MARINA DEMONSTRACAO ALVES", qualificacao: "Sócio-Administrador", cpf: "***.318.604-**" },
      { nome: "CARLOS EXEMPLO FERREIRA", qualificacao: "Sócio", cpf: "***.527.913-**" },
    ],
    fonte: "demonstracao",
  };
}
