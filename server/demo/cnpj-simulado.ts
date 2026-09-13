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
 * (Londrina/PR), com o CNPJ que foi pedido. Sem telefone e sem sócio com
 * documento: nada que pareça dado de uma pessoa ou empresa real.
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
    socios: [],
    fonte: "demonstracao",
  };
}
