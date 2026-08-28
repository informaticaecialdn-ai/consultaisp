/**
 * Cruzamento do endereço de instalação com os endereços dos parentes.
 *
 * A FRAUDE QUE ISTO PEGA: o cliente leva o calote, o provedor corta, e meses
 * depois chega um pedido de instalação no MESMO imóvel com outro CPF — o
 * cônjuge, o filho, o irmão. O documento é limpo porque a dívida não é dele. O
 * imóvel é o mesmo, e o equipamento vai para o mesmo lugar de onde não voltou.
 *
 * Nenhum dado de crédito responde isso. `related_people` sozinho também não:
 * `TotalHousehold` e `TotalNeighbors`, que o comentário do combo vendia como a
 * resposta, vieram ZERO em 8 de 8 medições. Quem responde é
 * `related_people_addresses`, que devolve o endereço de cada relacionado.
 *
 * A comparação usa a MESMA identidade de imóvel do resto do sistema
 * (`endereco-chave.ts`): logradouro + número + cidade, com bairro e UF só
 * desempatando, e CEP como reforço — nunca como requisito. Chavear por CEP
 * deixaria 39% da carteira de fora, que foi o que a medição de 27/08/2026
 * mostrou no cruzamento da Consulta ISP.
 *
 * ── LGPD ─────────────────────────────────────────────────────────────────────
 * Endereço de terceiro é dado pessoal de quem NÃO pediu a consulta. A regra,
 * que vale no servidor e não só na tela: sem coincidência, o resultado é
 * CONTAGEM — quantos relacionados têm endereço, quantos na mesma cidade,
 * quantos domicílios distintos. Nenhum logradouro, nenhum número, nenhum nome
 * sai daqui.
 *
 * O que abre o dado é a coincidência: um parente morando no endereço onde o
 * provedor vai instalar deixa de ser informação sobre um terceiro qualquer e
 * passa a ser informação sobre o imóvel em contratação. Aí sai o vínculo, o
 * nome e o endereço que bateu — e só o que bateu.
 *
 * O CPF do parente NUNCA sai inteiro, nem na coincidência. Ele vem embutido no
 * campo `Type` da API ("RELATED - 77115210900 - SPOUSE - HOME") e é o que
 * permite juntar este bloco ao `related_people` para achar o nome. Sai
 * mascarado: serve para o operador conferir contra o próprio cadastro, não para
 * alimentar outra base.
 */
import { chaveDeEndereco, mesmoEndereco, type EnderecoBruto } from "./endereco-chave";

export interface EnderecoRelacionado {
  /** MOTHER, SPOUSE, BROTHER, SON... como a Receita e a BigData classificam. */
  vinculo: string;
  cidade?: string;
  uf?: string;
  /** Hash do domicílio, da própria BigData. Agrupa parentes no mesmo imóvel. */
  codigoDomicilio?: string;

  /* ── Abaixo, SÓ preenchido quando o endereço bate com a instalação. ────── */
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  nome?: string;
  /** "123.***.***-45" — confere identidade sem entregar o documento. */
  documentoMascarado?: string;
}

export interface CruzamentoDomicilio {
  /** Relacionados com endereço conhecido. Sempre visível. */
  totalComEndereco: number;
  /** Quantos deles estão na mesma cidade da instalação. */
  naMesmaCidade: number;
  /** Domicílios distintos que os relacionados ocupam, por HouseholdCode. */
  domiciliosDistintos: number;
  /** true quando algum parente mora no endereço da instalação. */
  bateComInstalacao: boolean;
  /**
   * Os que batem, com vínculo, nome e endereço abertos. Vazio é o estado
   * normal — e é a ausência de coincidência, não ausência de dado.
   */
  coincidencias: EnderecoRelacionado[];
  /** false quando a busca não trouxe endereço de instalação para comparar. */
  cruzou: boolean;
}

/** Extrai o CPF que a BigData embute em `Type`. Só dígitos, 11 posições. */
function documentoDoType(tipo: unknown): string | undefined {
  const m = String(tipo ?? "").match(/\b(\d{11})\b/);
  return m ? m[1] : undefined;
}

/** "12345678901" -> "123.***.***-01". Confere identidade sem entregar o doc. */
export function mascararDocumento(doc?: string): string | undefined {
  if (!doc || doc.length !== 11) return undefined;
  return `${doc.slice(0, 3)}.***.***-${doc.slice(9)}`;
}

const txt = (v: unknown): string | undefined => {
  const t = String(v ?? "").trim();
  return t ? t : undefined;
};

/**
 * Junta o tipo do logradouro ao nome, para o endereço ficar na mesma forma que
 * o resto do sistema usa.
 *
 * `chaveLogradouro` já expande a abreviação ("R" vira "RUA", "AV" vira
 * "AVENIDA"), então basta prefixar. Typology ausente ou desconhecida devolve só
 * o nome — perder o tipo é falso negativo raro; inventar um seria pior.
 */
function composicaoLogradouro(typology: unknown, nome: unknown): string | undefined {
  const n = txt(nome);
  if (!n) return undefined;
  const t = txt(typology);
  if (!t) return n;
  // Já veio composto (algumas capturas trazem "RUA JANDAIA" no AddressMain).
  if (n.toUpperCase().startsWith(t.toUpperCase() + " ")) return n;
  return `${t} ${n}`;
}

/**
 * Nome do relacionado a partir do `related_people`, casando pelo CPF.
 *
 * O bloco de endereços não traz nome; o de relacionamentos traz nome e CPF. Sem
 * CPF nos dois lados o casamento seria por tipo de vínculo, e isso erra quando
 * há dois irmãos — melhor devolver sem nome do que devolver o nome errado ao
 * lado de um endereço.
 */
function indiceDeNomes(relacionados: any): Map<string, string> {
  const b = relacionados?.RelatedPeople ?? relacionados ?? {};
  const lista: any[] = Array.isArray(b.PersonalRelationships) ? b.PersonalRelationships : [];
  const m = new Map<string, string>();
  for (const r of lista) {
    const doc = String(r?.RelatedEntityTaxIdNumber ?? "").replace(/\D/g, "");
    const nome = txt(r?.RelatedEntityName);
    if (doc.length === 11 && nome) m.set(doc, nome);
  }
  return m;
}

interface Linha {
  vinculo: string;
  cidade?: string;
  uf?: string;
  codigoDomicilio?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  documento?: string;
}

/** Achata o bloco da API. O envelope pode vir como array cru ou nomeado. */
export function lerEnderecosRelacionados(bloco: any): Linha[] {
  const lista: any[] = Array.isArray(bloco)
    ? bloco
    : Array.isArray(bloco?.RelatedPeopleAddresses)
      ? bloco.RelatedPeopleAddresses
      : [];

  return lista
    .filter(e => e && typeof e === "object")
    .map(e => ({
      vinculo: String(e.RelationshipType ?? "").trim() || "RELATED",
      cidade: txt(e.City),
      uf: txt(e.State),
      codigoDomicilio: txt(e.HouseholdCode) ?? txt(e.BuildingCode),
      // O TIPO do logradouro vem num campo separado: `Typology: "R"` com
      // `AddressMain: "JANDAIA"`. Quem informa o endereco de instalacao — o
      // ViaCEP, ou o operador digitando — escreve "Rua Jandaia", tudo junto.
      // Sem recompor, "RUA JANDAIA" nunca casa com "JANDAIA" e o cruzamento
      // devolve "nenhum parente no imovel" com o parente na mao. Medido contra
      // a API em 28/08/2026, no endereco exato de um conjuge.
      //
      // Recompor aqui e nao afrouxar `mesmoEndereco` e deliberado: a identidade
      // de endereco e compartilhada com o cruzamento entre provedores, que
      // deriva hash dela. Isto conserta a fonte, nao a regua.
      logradouro: composicaoLogradouro(e.Typology, e.AddressMain),
      numero: txt(e.Number),
      complemento: txt(e.Complement),
      bairro: txt(e.Neighborhood),
      cep: txt(e.ZipCode),
      documento: documentoDoType(e.Type),
    }));
}

/**
 * Cruza os endereços dos relacionados com o endereço de instalação.
 *
 * `instalacao` nulo (busca sem endereço) devolve `cruzou: false` e só contagem
 * — não é falha, é a consulta que não pediu o cruzamento.
 */
export function cruzarDomicilio(
  blocoEnderecos: any,
  blocoRelacionados: any,
  instalacao: EnderecoBruto | null,
): CruzamentoDomicilio {
  const linhas = lerEnderecosRelacionados(blocoEnderecos);
  const nomes = indiceDeNomes(blocoRelacionados);

  const domicilios = new Set(linhas.map(l => l.codigoDomicilio).filter(Boolean) as string[]);
  const chaveInstalacao = instalacao ? chaveDeEndereco(instalacao) : null;

  const cidadeInstalacao = chaveInstalacao?.cidade ?? "";
  const naMesmaCidade = cidadeInstalacao
    ? linhas.filter(l => {
        const k = chaveDeEndereco({ address: l.logradouro, addressNumber: l.numero, city: l.cidade, state: l.uf });
        return k?.cidade === cidadeInstalacao;
      }).length
    : 0;

  const base: CruzamentoDomicilio = {
    totalComEndereco: linhas.length,
    naMesmaCidade,
    domiciliosDistintos: domicilios.size,
    bateComInstalacao: false,
    coincidencias: [],
    cruzou: !!chaveInstalacao,
  };

  if (!chaveInstalacao) return base;

  const coincidencias: EnderecoRelacionado[] = [];
  for (const l of linhas) {
    const k = chaveDeEndereco({
      address: l.logradouro, addressNumber: l.numero,
      neighborhood: l.bairro, city: l.cidade, state: l.uf, cep: l.cep,
    });
    if (!k || !mesmoEndereco(k, chaveInstalacao)) continue;

    // Aqui, e só aqui, o endereço e o nome saem do servidor.
    coincidencias.push({
      vinculo: l.vinculo,
      cidade: l.cidade,
      uf: l.uf,
      codigoDomicilio: l.codigoDomicilio,
      logradouro: l.logradouro,
      numero: l.numero,
      complemento: l.complemento,
      bairro: l.bairro,
      cep: l.cep,
      nome: l.documento ? nomes.get(l.documento) : undefined,
      documentoMascarado: mascararDocumento(l.documento),
    });
  }

  return { ...base, bateComInstalacao: coincidencias.length > 0, coincidencias };
}
