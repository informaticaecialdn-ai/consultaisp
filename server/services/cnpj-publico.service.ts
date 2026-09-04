/**
 * Cadastro publico de CNPJ, na Receita Federal, por tres fontes com queda.
 *
 * Morava inteiro dentro de `GET /api/admin/cnpj/:cnpj` — 110 linhas de parser
 * dentro de um handler, alcancaveis so pelo superadmin. O provedor, que precisa
 * exatamente do mesmo dado para preencher a propria ficha, tinha uma SEGUNDA
 * implementacao no NAVEGADOR (painel-provedor.tsx chamava a BrasilAPI direto),
 * com uma fonte so e sem queda: bastava a BrasilAPI estar fora do ar ou nao
 * conhecer aquele CNPJ para a tela dizer "servico indisponivel" e o provedor
 * concluir que o sistema nao busca nada.
 *
 * As tres fontes sao gratuitas e cada uma tem um limite de chamadas por minuto
 * diferente; a ordem e por qualidade do retorno, e a queda existe porque uma
 * delas responder 429 e o caso comum, nao a excecao.
 *
 * NAO ha cache: a ficha e preenchida uma vez por provedor, na vida. Cache aqui
 * seria complexidade para um caminho que quase nunca repete.
 */
import { logger } from "../logger";

export interface SocioPublico {
  nome: string;
  qualificacao: string;
  cpf: string;
}

/** O cadastro, num formato so — cada fonte devolve o seu e e traduzida para este. */
export interface EmpresaPublica {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  naturezaJuridica: string;
  dataAbertura: string;
  atividadePrincipal: string;
  telefone: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  situacao: string;
  socios: SocioPublico[];
  /** Qual fonte respondeu. Vai para o log e para o diagnostico, nao para a tela. */
  fonte?: string;
}

interface Fonte {
  nome: string;
  url: (cnpj: string) => string;
  parse: (d: any, cnpj: string) => EmpresaPublica;
}

const FONTES: Fonte[] = [
  {
    nome: "ReceitaWS",
    url: cnpj => `https://receitaws.com.br/v1/cnpj/${cnpj}`,
    parse: (d, cnpj) => ({
      razaoSocial: d.nome || "",
      nomeFantasia: d.fantasia || "",
      cnpj: d.cnpj?.replace(/\D/g, "") || cnpj,
      naturezaJuridica: d.natureza_juridica || "",
      dataAbertura: d.abertura || "",
      atividadePrincipal: d.atividade_principal?.[0]?.text || "",
      telefone: d.telefone || "",
      email: d.email || "",
      cep: d.cep?.replace(/\D/g, "") || "",
      logradouro: d.logradouro || "",
      numero: d.numero || "",
      complemento: d.complemento || "",
      bairro: d.bairro || "",
      cidade: d.municipio || "",
      uf: d.uf || "",
      situacao: d.situacao || "",
      socios: (d.qsa || []).map((s: any) => ({
        nome: s.nome || "",
        qualificacao: s.qual || "",
        cpf: "",
      })),
    }),
  },
  {
    nome: "BrasilAPI",
    url: cnpj => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
    parse: (d, cnpj) => ({
      razaoSocial: d.razao_social || "",
      nomeFantasia: d.nome_fantasia || "",
      cnpj: String(d.cnpj || cnpj).replace(/\D/g, ""),
      naturezaJuridica: d.natureza_juridica || "",
      dataAbertura: d.data_inicio_atividade || "",
      atividadePrincipal: d.cnae_fiscal_descricao || "",
      telefone: d.ddd_telefone_1 ? `(${d.ddd_telefone_1.slice(0, 2)}) ${d.ddd_telefone_1.slice(2)}` : "",
      email: d.email || "",
      cep: String(d.cep || "").replace(/\D/g, ""),
      // A BrasilAPI separa o tipo do logradouro ("RUA", "AVENIDA") do nome. Sem
      // juntar aqui, o endereco chega a ficha como "DAS FLORES".
      logradouro: [d.descricao_tipo_logradouro, d.logradouro].filter(Boolean).join(" ").trim(),
      numero: d.numero || "",
      // O ponto sozinho e como a Receita marca "sem complemento". Copiado
      // literalmente, ele vira um ponto no meio do endereco da nota fiscal.
      complemento: d.complemento && d.complemento !== "." ? d.complemento : "",
      bairro: d.bairro || "",
      cidade: d.municipio || "",
      uf: d.uf || "",
      situacao: d.descricao_situacao_cadastral || "",
      socios: (d.qsa || []).map((s: any) => ({
        nome: s.nome_socio || "",
        qualificacao: s.qualificacao_socio || "",
        cpf: s.cnpj_cpf_do_socio || "",
      })),
    }),
  },
  {
    nome: "Publica",
    url: cnpj => `https://publica.cnpj.ws/cnpj/${cnpj}`,
    parse: (d, cnpj) => ({
      razaoSocial: d.razao_social || "",
      nomeFantasia: d.estabelecimento?.nome_fantasia || "",
      cnpj,
      naturezaJuridica: d.natureza_juridica?.descricao || "",
      dataAbertura: d.estabelecimento?.data_inicio_atividade || "",
      atividadePrincipal: d.estabelecimento?.atividade_principal?.descricao || "",
      telefone:
        d.estabelecimento?.ddd1 && d.estabelecimento?.telefone1
          ? `(${d.estabelecimento.ddd1}) ${d.estabelecimento.telefone1}`
          : "",
      email: d.estabelecimento?.email || "",
      cep: String(d.estabelecimento?.cep || "").replace(/\D/g, ""),
      logradouro: [d.estabelecimento?.tipo_logradouro, d.estabelecimento?.logradouro]
        .filter(Boolean).join(" ").trim(),
      numero: d.estabelecimento?.numero || "",
      complemento:
        d.estabelecimento?.complemento && d.estabelecimento.complemento !== "."
          ? d.estabelecimento.complemento
          : "",
      bairro: d.estabelecimento?.bairro || "",
      cidade: d.estabelecimento?.cidade?.nome || "",
      uf: d.estabelecimento?.estado?.sigla || "",
      situacao: d.estabelecimento?.situacao_cadastral || "",
      socios: (d.socios || []).map((s: any) => ({
        nome: s.nome || "",
        qualificacao: s.qualificacao?.descricao || "",
        cpf: s.cpf_cnpj_socio || "",
      })),
    }),
  },
];

/** Um numero de CNPJ so, sem pontuacao, ou null se nao for um. */
export function normalizarCnpj(bruto: string | null | undefined): string | null {
  const so = String(bruto ?? "").replace(/\D/g, "");
  return so.length === 14 ? so : null;
}

/**
 * A natureza juridica sem o codigo do IBGE na frente.
 *
 * A ReceitaWS devolve "206-2 - Sociedade Empresaria Limitada"; a BrasilAPI
 * devolve so o texto. Medido em producao com o CNPJ da Amplisinal em
 * 04/09/2026: quem consome isso e um `<select>` de tipo societario que casa por
 * TEXTO, entao o prefixo fazia o campo ficar vazio sempre que a ReceitaWS
 * respondesse primeiro — que e o caso comum, ja que ela e a primeira da fila.
 */
export function naturezaSemCodigo(bruto: string | null | undefined): string {
  return String(bruto ?? "").replace(/^\s*\d{3,4}-\d\s*-\s*/, "").trim();
}

/**
 * O complemento, ou vazio quando a Receita esta dizendo que nao ha.
 *
 * Ela marca "sem complemento" com um ponto sozinho — as vezes com espacos em
 * volta, e a Publica usa hifen. Copiado literalmente, isso vira um ponto no
 * meio do endereco impresso na nota fiscal do provedor.
 */
export function semComplemento(bruto: string | null | undefined): string {
  const s = String(bruto ?? "").trim();
  return s === "." || s === "-" || s === "--" ? "" : s;
}

/**
 * A data de abertura em ISO (yyyy-mm-dd), que e o unico formato que um
 * `<input type="date">` aceita.
 *
 * As fontes discordam: a BrasilAPI e a Publica devolvem ISO, a ReceitaWS
 * devolve "15/01/2016". Sem esta traducao, cair na ReceitaWS — o que acontece
 * sempre que ela responde primeiro — enchia o campo com um valor que o
 * navegador descarta em silencio, e o provedor via a data sumir sozinha.
 */
export function dataEmIso(bruto: string | null | undefined): string {
  const s = String(bruto ?? "").trim();
  if (!s) return "";
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
}

/**
 * O cadastro do CNPJ, na primeira fonte que responder algo utilizavel.
 *
 * "Utilizavel" exige razao social preenchida: as tres fontes respondem 200 com
 * corpo vazio ou com `{status:"ERROR"}` para CNPJ que elas nao conhecem, e sem
 * essa checagem a primeira delas encerraria a busca com um objeto de campos
 * vazios — que na tela vira "encontramos, e nao tem nada", pior que nao achar.
 *
 * Devolve null quando nenhuma fonte serviu. Nao lanca: para quem chama, "nao
 * achei" e uma resposta normal, e nao um defeito.
 */
export async function consultarCnpjPublico(cnpjBruto: string): Promise<EmpresaPublica | null> {
  const cnpj = normalizarCnpj(cnpjBruto);
  if (!cnpj) return null;

  const recusas: string[] = [];

  for (const fonte of FONTES) {
    try {
      const resposta = await fetch(fonte.url(cnpj), { signal: AbortSignal.timeout(8000) });
      if (!resposta.ok) {
        recusas.push(`${fonte.nome}:${resposta.status}`);
        continue;
      }
      const dados = await resposta.json();
      if (dados?.status === "ERROR" || dados?.error) {
        recusas.push(`${fonte.nome}:erro-no-corpo`);
        continue;
      }
      const bruta = fonte.parse(dados, cnpj);
      if (!bruta.razaoSocial) {
        recusas.push(`${fonte.nome}:sem-razao-social`);
        continue;
      }
      // As duas normalizacoes que valem para TODA fonte ficam aqui, e nao
      // repetidas em cada parser: repetidas, uma delas fica de fora quando
      // alguem acrescentar a quarta fonte — foi exatamente o que aconteceu com
      // o complemento, que so a BrasilAPI e a Publica limpavam.
      const empresa: EmpresaPublica = {
        ...bruta,
        dataAbertura: dataEmIso(bruta.dataAbertura),
        complemento: semComplemento(bruta.complemento),
        naturezaJuridica: naturezaSemCodigo(bruta.naturezaJuridica),
      };
      // Quatro digitos bastam para correlacionar com o provedor no log sem
      // publicar o documento inteiro em arquivo.
      logger.info({ cnpj: `${cnpj.slice(0, 4)}***`, fonte: fonte.nome, recusas }, "[cnpj] cadastro encontrado");
      return { ...empresa, fonte: fonte.nome };
    } catch (err: unknown) {
      recusas.push(`${fonte.nome}:${err instanceof Error ? err.name : "falha"}`);
    }
  }

  // As recusas vao juntas: "nenhuma fonte respondeu" e "as tres disseram que
  // este CNPJ nao existe" pedem acoes diferentes de quem for investigar.
  logger.warn({ cnpj: `${cnpj.slice(0, 4)}***`, recusas }, "[cnpj] nenhuma fonte devolveu o cadastro");
  return null;
}
