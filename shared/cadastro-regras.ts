/**
 * A REGUA DO CADASTRO DO PROVEDOR — o pedaco que as DUAS fichas usam.
 *
 * A mesma empresa e editada por duas portas: o painel do provedor
 * (`PATCH /api/provider/profile`) e a ficha do superadmin
 * (`PATCH /api/admin/providers/:id`). Ate 05/09/2026 cada uma tinha a sua copia
 * da regra, e as copias divergiram do jeito que copia sempre diverge: o painel
 * passou a recusar "17/05/2017" e "206-2 - Sociedade Empresaria Limitada" — os
 * dois valores que o lote de limpeza estava tirando do banco —, e a ficha do
 * superadmin, o escritor de MAIOR privilegio, continuou aceitando os dois. Uma
 * regra que so vale na porta menos poderosa nao e regra; e um degrau.
 *
 * O modulo mora em `shared/` porque as listas daqui sao tambem as opcoes do
 * `<select>` das telas. Nada aqui importa servidor, banco ou zod, de proposito:
 * o dia em que o client parar de ter a terceira e a quarta copia das listas,
 * elas vem daqui sem arrastar nada junto.
 *
 * REGRA DE USO, e ela nao e opcional: estas funcoes julgam **o valor que alguem
 * acabou de digitar**, nunca o cadastro inteiro. Quem chama compara com o que ja
 * esta gravado e so julga o campo que MUDOU. As colunas guardam anos de valor
 * livre; julgar o cadastro inteiro trancaria o dono dele do lado de fora — ele
 * nao consegue corrigir o telefone sem antes arrumar dois campos que nem sabe
 * que estao errados, recusados por frases que nao explicam de onde vieram.
 */

/**
 * O veredito de uma regra: ou o valor CANONICO a gravar, ou a frase que a pessoa
 * le. A frase e o que aparece na tela — o painel do provedor imprime so
 * `message` num toast e a ficha do superadmin imprime debaixo do campo —, entao
 * ela nomeia o campo e diz o que fazer.
 */
export type Veredito = { ok: true; valor: string | null } | { ok: false; frase: string };

export const aceita = (valor: string | null): Veredito => ({ ok: true, valor });
export const recusa = (frase: string): Veredito => ({ ok: false, frase });

/**
 * As sete opcoes do `<select>` de tipo societario — as mesmas nas duas telas
 * (`LEGAL_TYPES` em painel-provedor.tsx, `TIPOS_SOCIETARIOS` em
 * cadastro-provedor.ts).
 */
export const TIPOS_SOCIETARIOS: readonly string[] = ["MEI", "ME", "EPP", "LTDA", "S/A", "EIRELI", "Outro"];

/** Os cinco segmentos do `<select>` (`SEGMENTS` / `SEGMENTOS` nas telas). */
export const SEGMENTOS: readonly string[] = [
  "ISP / Provedor de Internet", "Telecom", "Data Center", "TV por Assinatura", "Outro",
];

/**
 * Um dos valores da lista, ou nada.
 *
 * A frase enumera as opcoes porque o valor recusado costuma vir da Receita
 * ("Sociedade Empresaria Limitada", o CNAE por extenso) e quem le precisa saber
 * o que vale no lugar — dizer so "valor invalido" manda a pessoa adivinhar.
 */
export const umaDasOpcoes = (opcoes: readonly string[], rotulo: string) => (valor: string | null): Veredito =>
  valor === null || opcoes.includes(valor)
    ? aceita(valor)
    : recusa(`${rotulo} precisa ser uma destas opções: ${opcoes.join(", ")}.`);

/**
 * Coluna TEXT em ISO (aaaa-mm-dd), e nao `date`. O `<input type="date">` do
 * painel ja manda ISO e a importacao pelo CNPJ passa por `dataEmIso` — o
 * "17/05/2017" que esta gravado veio de uma versao anterior das duas coisas.
 *
 * A conferencia vai alem do formato porque "2017-02-31" casa com o regex e nao
 * existe no calendario; o `Date` em UTC transborda para marco e a comparacao de
 * volta pega isso.
 */
export const dataDeAbertura = (valor: string | null): Veredito => {
  if (valor === null) return aceita(null);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!iso) {
    return recusa("A data de abertura precisa estar no formato AAAA-MM-DD (ex.: 2014-03-21).");
  }
  const d = new Date(`${valor}T00:00:00Z`);
  const mesmoDia = !Number.isNaN(d.getTime())
    && d.getUTCFullYear() === Number(iso[1])
    && d.getUTCMonth() + 1 === Number(iso[2])
    && d.getUTCDate() === Number(iso[3]);
  return mesmoDia ? aceita(valor) : recusa("A data de abertura não existe no calendário.");
};

/** O teto da coluna `website`, aqui para as duas fichas cobrarem o mesmo. */
export const SITE_MAX = 500;

/**
 * O site tem esquema aceitavel? — a UNICA coisa que se cobra dele.
 *
 * Site e texto livre: a coluna ja guarda "www.exemplo.com.br", digitado pelo
 * proprio provedor. Fica uma recusa so — esquema que nao seja http/https —,
 * porque este valor e candidato natural a virar href numa tela futura e
 * "javascript:..." num href e XSS. Hoje ele so e impresso como texto, o que
 * torna a trava barata e preventiva.
 *
 * O REGEX NAO TEM PONTO NA CLASSE, e o ponto que saiu dali custava um Salvar
 * inteiro. Com `/^[a-z][a-z0-9+.-]*:/i`, "meuisp.net.br:8080" casava — o regex
 * lia "meuisp.net.br" como nome de esquema — e, como o valor nao comeca com
 * http://, a regra RECUSAVA um endereco com porta. E o formulario e
 * tudo-ou-nada: o provedor perdia o Salvar dos outros quinze campos junto.
 *
 * Sobra um caso que continua sendo lido como esquema: host SEM PONTO seguido de
 * porta ("localhost:3000"). E conhecido e barato de conviver — ninguem publica o
 * site da empresa nesse formato —, e fechar so ele exigiria olhar o que vem
 * depois dos dois pontos, complexidade que a trava nao paga. O que a regra
 * existe para barrar ("javascript:", "data:", "vbscript:") nao tem ponto nem
 * porta e continua sendo pego.
 */
export const siteComEsquemaAceito = (valor: string): boolean =>
  !/^[a-z][a-z0-9+-]*:/i.test(valor) || /^https?:\/\//i.test(valor);

/**
 * O site como regra de cadastro. Nao ha normalizacao: prefixar "https://" no que
 * a pessoa digitou e o comeco de um campo que mente sobre o que ela informou.
 */
export const site = (valor: string | null): Veredito => {
  if (valor === null) return aceita(null);
  if (valor.length > SITE_MAX) return recusa(`O site deve ter no máximo ${SITE_MAX} caracteres.`);
  return siteComEsquemaAceito(valor)
    ? aceita(valor)
    : recusa("O site precisa começar com http:// ou https://, ou vir sem esquema (ex.: www.exemplo.com.br).");
};
