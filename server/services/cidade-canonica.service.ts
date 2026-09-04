/**
 * A cidade escrita pelo ERP → o nome OFICIAL do município, para ser gravada.
 *
 * POR QUE ISTO EXISTE. Carregar a base de endereços da cidade não conserta o
 * CLIENTE: o geocodificador casa `customers.city` normalizada contra a cidade
 * da base, e os 23 cadastros da Amplinet escritos "EMBUGUAÇU" — sem a barra de
 * espaço — continuavam fora do mapa mesmo com a base de Embu-Guaçu carregada,
 * porque "embuguacu" e "embu guacu" são chaves normalizadas diferentes e só a
 * segunda regra do resolvedor as junta. Na barra de filtros da Localização, as
 * sete grafias da mesma cidade viravam sete chips, o que o dono lê — com razão
 * — como sistema quebrado. Gravar canonizado resolve os dois de uma vez.
 *
 * Módulo puro, e fora da camada de storage de propósito: os três consumidores —
 * o upsert do sync, a importação por CSV e o script de correção — precisam da
 * MESMA regra, e uma regra que mora dentro de uma classe de storage só é
 * alcançável por quem já carregou a camada de dados inteira.
 *
 * (Até 04/09/2026 havia um segundo motivo, hoje resolvido: `area-atendida`
 * importava o barril `server/storage/index.ts` no topo, e este caminho fechava
 * um ciclo que estourava em TDZ para quem importasse `customers.storage`
 * direto. O barril agora entra lá dentro de `resolverAreaAtendida`.)
 */
import {
  municipioUnicoNoPais, pareceNomeTruncadoNaUf, resolverMunicipioDaCidade, ufNoNomeDaCidade,
  type Municipio,
} from "./municipio.service";

/**
 * SEMPRE ESTRITO. A canonização decide o que vai para `customers.city`, e a
 * expansão por prefixo ("CAMPINA"/SP → Campina do Monte Alegre) é casamento por
 * semelhança: aqui ela reescreveria o cadastro do provedor e plantaria o
 * cliente noutra cidade, sem caminho de volta. Ver "DUAS RÉGUAS" em
 * `municipio.service`.
 */
const ESTRITO = { estrito: true } as const;

/** Por que uma grafia não virou nome oficial. É o relatório para o provedor. */
export type MotivoSemCanonizacao =
  /** Campo de cidade vazio — não há o que reconhecer. */
  | "sem_cidade"
  /**
   * O campo de estado e a sigla escrita no nome discordam, e obedecer a uma
   * delas trocaria o estado gravado do cliente.
   */
  | "uf_em_conflito"
  /** Sem UF nenhuma, "ITAPECERICA" pode ser SP ou MG. */
  | "sem_uf"
  /**
   * A cidade existe e está escrita certo — só não no estado informado. O campo
   * a corrigir no ERP é o ESTADO, e não o nome: são os quatro cadastros
   * "ITAPECERICA DA SERRA" com RN, SE e SC numa carteira toda de SP.
   */
  | "uf_nao_bate"
  /** Erro de digitação ou bairro no campo de cidade. */
  | "nao_encontrada";

export interface CidadeDoCadastro {
  /** O que deve ser gravado em `customers.city`. */
  city: string | null;
  /** O que deve ser gravado em `customers.state`. */
  state: string | null;
  /** O município reconhecido, ou null quando a grafia não é cidade nenhuma. */
  municipio: Municipio | null;
  /** Preenchido só quando `municipio` é null. */
  motivo: MotivoSemCanonizacao | null;
  /**
   * Só em `uf_nao_bate`: o município que este nome designa no país. É material
   * de relatório — nunca é gravado —, e serve para o provedor saber para onde
   * olhar no ERP.
   */
  candidato: Municipio | null;
}

/**
 * "SP" → "SP". "São Paulo", "XX", "S" e vazio → null.
 *
 * A régua de "isto é uma UF" NÃO é redigitada aqui de propósito: se esta lista
 * divergisse da que `municipio.service` usa para resolver, este arquivo
 * aceitaria uma sigla que o resolvedor recusa e a cidade ficaria num limbo
 * silencioso — nem canonizada, nem apontada como cadastro a corrigir.
 * `ufNoNomeDaCidade` já responde exatamente essa pergunta contra a lista
 * oficial de municípios; como ela lê a sigla do FIM de um texto, o valor vai
 * atrás de um prefixo qualquer.
 */
function siglaDeUf(bruto: string | null | undefined): string | null {
  return ufNoNomeDaCidade(`uf ${(bruto || "").trim()}`);
}

/**
 * A cidade que o ERP escreveu, trocada pelo nome oficial do município quando dá
 * para reconhecê-la — e intocada quando não dá.
 *
 * O QUE NÃO SE FAZ AQUI: adivinhar por semelhança. "EMBU GAUCU" e "SÃO PAUYLO"
 * não são reconhecidos e ficam exatamente como vieram. Plantar um cliente na
 * cidade errada é pior do que deixá-lo fora do mapa, e a medição de cobertura
 * já lista essas grafias para o provedor corrigir no ERP.
 *
 * ── A UF DO CADASTRO PODE SER LIXO, E ISSO FOI MEDIDO ─────────────────────
 *
 * Na Amplinet, "ITAPECERICA DA SERRA" aparece com SP em 207 cadastros e com
 * RN, SE e SC em quatro — numa carteira que é toda de SP. Aqui só existe UMA
 * linha por vez, e uma linha não tem a maioria que `ufDominante` enxerga na
 * carteira inteira. Daí as três decisões:
 *
 *  1. UF que contradiz a cidade não é corrigida: é obedecida. Como
 *     "Itapecerica da Serra" não existe no RN, o resolvedor não devolve
 *     município nenhum e a linha passa intacta — com o motivo `uf_nao_bate`,
 *     que diz ao provedor que o campo a consertar é o ESTADO. Escolher SP por
 *     conta própria seria mudar um cliente de estado sem nenhuma evidência
 *     DENTRO da linha; quem tem essa evidência é a medição da carteira, que vê
 *     as 207 contra as quatro.
 *  2. A sigla escrita junto do nome ("ITAPECERICA DA SERRA SP") vale como UF
 *     QUANDO O CAMPO DE ESTADO NÃO DIZ NADA. É evidência real, escrita pelo
 *     próprio provedor, e recupera o cadastro que diz o estado no campo errado.
 *  3. Quando o campo de estado e a sigla do nome discordam, nada é canonizado.
 *     São dois casos, e os dois trocariam o estado do cliente por causa de qual
 *     campo o código leu primeiro:
 *       · as duas leituras resolvem municípios diferentes — "BOM JESUS SC" com
 *         estado "PI" tem um Bom Jesus de cada lado;
 *       · só a sigla do nome resolve, e o campo de estado tem uma UF válida —
 *         "CAMPO GRANDE MS" com estado "RJ" viraria Campo Grande/MS, e o RJ que
 *         o ERP escreveu desapareceria.
 *     O conflito é entre o que os DOIS CAMPOS afirmam, e não entre siglas
 *     soltas: "SENTO SE" com estado "BA" termina numa sigla de UF de verdade
 *     (SE), mas quem resolve é a leitura pela BA — a outra não resolve nada —,
 *     e Sento Sé/BA é canonizada normalmente.
 *
 * Quando o município é reconhecido, a UF gravada é a DELE — e nesse caminho ela
 * ou é igual à que veio (o resolvedor exigiu que batesse) ou preenche um campo
 * que estava vazio. Nunca troca uma UF do ERP por outra.
 */
export function canonizarCidadeDoCadastro(
  cidade: string | null | undefined,
  uf: string | null | undefined,
): CidadeDoCadastro {
  const cidadeCrua = (cidade ?? "").trim() || null;
  const ufCrua = (uf ?? "").trim() || null;
  const comoVeio = (
    motivo: MotivoSemCanonizacao, candidato: Municipio | null = null,
  ): CidadeDoCadastro => ({ city: cidadeCrua, state: ufCrua, municipio: null, motivo, candidato });

  if (!cidadeCrua) return comoVeio("sem_cidade");

  const ufDoCampo = siglaDeUf(ufCrua);
  const ufNoNome = ufNoNomeDaCidade(cidadeCrua);

  const porCampo = resolverMunicipioDaCidade(cidadeCrua, ufDoCampo, ESTRITO);
  const porNome = ufNoNome && ufNoNome !== ufDoCampo
    ? resolverMunicipioDaCidade(cidadeCrua, ufNoNome, ESTRITO)
    : null;

  // Decisão 3. A segunda metade é a que impede a troca silenciosa de estado:
  // sem ela, `porCampo ?? porNome` gravaria a UF da sigla por cima de uma UF
  // que o ERP tinha preenchido.
  if (porNome && (porCampo ? porCampo.ibge !== porNome.ibge : !!ufDoCampo)) {
    return comoVeio("uf_em_conflito");
  }

  const municipio = porCampo ?? porNome;
  if (municipio) return { city: municipio.nome, state: municipio.uf, municipio, motivo: null, candidato: null };

  // Sem UF nenhuma no cadastro a pergunta nem chega a ser feita: "ITAPECERICA"
  // é nome único no país (Itapecerica/MG) e apontá-lo como candidato mandaria
  // o provedor mudar de estado o cliente de Itapecerica DA SERRA/SP.
  if (!ufDoCampo && !ufNoNome) return comoVeio("sem_uf");

  // Há UF, e ela não bate. Dois desfechos, e eles mandam o provedor a campos
  // DIFERENTES do ERP:
  //   · o nome está inteiro e designa um município único no país → o errado é o
  //     ESTADO ("ITAPECERICA DA SERRA"/RN);
  //   · o nome é prefixo de um município DA UF informada → o estado está certo e
  //     o nome é que foi escrito pela metade ("ITAPECERICA"/SP, "JANDAIA"/PR),
  //     e aí apontar "Itapecerica/MG" como candidato mandaria mudar de estado um
  //     cliente que só precisa do nome completo.
  const ufDoCadastro = ufDoCampo ?? ufNoNome;
  const candidato = pareceNomeTruncadoNaUf(cidadeCrua, ufDoCadastro)
    ? null
    : municipioUnicoNoPais(cidadeCrua);
  return candidato ? comoVeio("uf_nao_bate", candidato) : comoVeio("nao_encontrada");
}
