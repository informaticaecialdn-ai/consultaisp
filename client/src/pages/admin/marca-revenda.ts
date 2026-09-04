/**
 * O lado comercial da marca: o que a aba Comercial envia, o que ela avisa antes
 * de o operador errar, e como a trilha de eventos vira texto.
 *
 * Mora fora do componente pelo mesmo motivo de `marca-form.ts`: a página é
 * `.tsx`, este projeto não roda componente em DOM (ver o `include` do
 * vitest.config.ts), e lógica escrita lá dentro não é coberta por ninguém.
 *
 * ── POR QUE O COMERCIAL NÃO ENTRA NO `form` DA IDENTIDADE ──────────────────
 *
 * `marca-form.ts` monta o corpo do PATCH a partir de `FORMULARIO_VAZIO`, que é
 * um `Record<string, string>`: todo campo é texto, e vazio vira `null`. Os
 * campos comerciais não são texto — `revendaAtiva` é booleano e
 * `comissaoPercentual` é número —, e enfiá-los ali obrigaria o diff genérico a
 * conhecer exceções por nome de campo.
 *
 * A separação também é a garantia que este arquivo mais preza: como
 * `camposDoDetalhe` devolve `{ ...FORMULARIO_VAZIO, ... }`, nenhum campo
 * comercial existe no `form` da identidade, e o "Salvar marca" da aba
 * Identidade não tem como zerar a comissão de uma marca por omissão. É o mesmo
 * defeito que apagava o logo do revendedor, no campo em que ele custaria
 * dinheiro.
 */

/**
 * O que a aba Comercial edita. Tudo em texto, como o campo do formulário
 * guarda; a conversão para booleano e número acontece uma vez só, em
 * `corpoComercial`, na hora de montar o PATCH.
 *
 * `revendaAtiva` é a exceção e é booleano aqui porque a fonte dele é um
 * interruptor, não uma caixa de texto — não há estado intermediário para
 * representar.
 */
export type FormComercial = {
  /**
   * A marca esta NO AR. Nao e campo comercial, e mora aqui porque e booleano:
   * `FORMULARIO_VAZIO` da aba Identidade e `Record<string, string>` e trata
   * vazio como `null`, entao um booleano ali sairia como nulo a cada omissao.
   *
   * Nao havia controle nenhum para ele — a tela so mostrava o selo "Inativa" —
   * e isso ficou caro: desligar a marca derruba a sessao do revendedor
   * (`requireRevendedor`) e impede criar acesso novo (422 `MARCA_DESLIGADA`), e
   * religar so pelo banco. E tambem a unica saida NAO destrutiva para a marca
   * que o 409 de historico impede de excluir.
   */
  ativo: boolean;
  revendaAtiva: boolean;
  /** "ativo" | "suspenso" — o CHECK `marcas_status_comercial_valido` no banco. */
  statusComercial: string;
  comissaoPercentual: string;
  repasseRazaoSocial: string;
  repasseCnpj: string;
  repasseChavePix: string;
  repasseEmail: string;
};

/** Os quatro campos de quem RECEBE a comissão. Diferentes de `responsavel*`,
 *  que é quem responde ao titular pela LGPD e pode ser outra pessoa jurídica. */
export const CAMPOS_DE_REPASSE = [
  "repasseRazaoSocial",
  "repasseCnpj",
  "repasseChavePix",
  "repasseEmail",
] as const;

/** Os mesmos padrões do banco (migração 0013): revenda desligada, comercial
 *  ativo, comissão zero. Marca que já existia não vira revenda sozinha. */
export const COMERCIAL_VAZIO: FormComercial = {
  // Marca nasce LIGADA: e o default da coluna e o unico estado util para uma
  // marca recem-criada.
  ativo: true,
  revendaAtiva: false,
  statusComercial: "ativo",
  comissaoPercentual: "0",
  repasseRazaoSocial: "",
  repasseCnpj: "",
  repasseChavePix: "",
  repasseEmail: "",
};

/**
 * O percentual como o campo mostra.
 *
 * A coluna é `numeric(5,2)` e o driver do Postgres entrega STRING — 20 chega
 * como `"20.00"`. Sem esta normalização, o operador que digita "20" produz um
 * diff contra `"20.00"` e o PATCH sai a cada visita à aba, gravando um evento
 * `alterar_comissao` que não alterou comissão nenhuma.
 */
export function percentualDaMarca(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "0";
  const numero = Number(valor);
  return Number.isFinite(numero) ? String(numero) : "0";
}

/** O detalhe do servidor virando o formulário comercial. */
export function camposComerciais(detalhe: Record<string, any> | null | undefined): FormComercial {
  if (!detalhe) return { ...COMERCIAL_VAZIO };
  return {
    // `!== false` e nao `Boolean(...)`: a lista da tela pode nao trazer o campo,
    // e ausencia de dado nao pode virar "marca desligada" num interruptor que
    // grava.
    ativo: detalhe.ativo !== false,
    revendaAtiva: Boolean(detalhe.revendaAtiva),
    statusComercial: detalhe.statusComercial === "suspenso" ? "suspenso" : "ativo",
    comissaoPercentual: percentualDaMarca(detalhe.comissaoPercentual),
    repasseRazaoSocial: detalhe.repasseRazaoSocial ?? "",
    repasseCnpj: detalhe.repasseCnpj ?? "",
    repasseChavePix: detalhe.repasseChavePix ?? "",
    repasseEmail: detalhe.repasseEmail ?? "",
  };
}

/**
 * O que impede o envio, em português e antes do erro do servidor.
 *
 * A faixa de 0 a 50 não é gosto: é o CHECK `marcas_comissao_faixa` no banco
 * (decisão 3 do dono). Acima de 50 a plataforma fica com menos da metade e o
 * piso de preço deixa de proteger a margem.
 */
export function erroDoComercial(form: FormComercial): string | null {
  const texto = form.comissaoPercentual.trim();
  if (texto === "") return "Informe a comissão — use 0 para marca sem comissão.";

  const numero = Number(texto);
  if (!Number.isFinite(numero)) return "A comissão precisa ser um número.";
  if (numero < 0 || numero > 50) return "A comissão vai de 0 a 50%.";

  const email = form.repasseEmail.trim();
  if (email !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return "E-mail de repasse inválido.";
  }
  return null;
}

/**
 * Só o que mudou, já no tipo que o servidor espera.
 *
 * Mesma regra do PATCH da identidade — ausente mantém, `null` apaga —, com as
 * duas conversões que o diff genérico não faria: o interruptor vira booleano e
 * o percentual vira número.
 *
 * O percentual em branco NÃO entra no corpo. `Number("")` é 0, e sem esta
 * guarda um campo apagado por engano gravaria comissão zero em silêncio, que é
 * um valor legítimo e por isso ninguém questionaria depois. Quem impede o envio
 * é `erroDoComercial`; esta guarda existe para o caso de alguém chamar a função
 * sem passar por ele.
 */
export function corpoComercial(form: FormComercial, original: FormComercial): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};

  if (form.ativo !== original.ativo) corpo.ativo = form.ativo;
  if (form.revendaAtiva !== original.revendaAtiva) corpo.revendaAtiva = form.revendaAtiva;
  if (form.statusComercial !== original.statusComercial) corpo.statusComercial = form.statusComercial;

  const texto = form.comissaoPercentual.trim();
  const numero = Number(texto);
  if (texto !== "" && Number.isFinite(numero) && numero !== Number(original.comissaoPercentual)) {
    corpo.comissaoPercentual = numero;
  }

  for (const campo of CAMPOS_DE_REPASSE) {
    const valor = form[campo].trim();
    if (valor === (original[campo] ?? "").trim()) continue;
    corpo[campo] = valor === "" ? null : valor;
  }

  return corpo;
}

export type AvisoDaRevenda = { tom: "gated" | "info"; texto: string };

/**
 * O que a combinação de estados significa na prática — dito na tela, não
 * descoberto no fim do mês.
 *
 * Cada linha aqui corresponde a um estado que grava no banco sem reclamar e não
 * produz o efeito que o operador imagina: revenda ligada com 0% lança comissão
 * zerada; sem dados de repasse o fechamento fica sem como ser pago; suspenso
 * para de lançar sem derrubar nada, que é justamente o que confunde.
 */
export function avisosDaRevenda(form: FormComercial): AvisoDaRevenda[] {
  if (!form.revendaAtiva) {
    return [{
      tom: "info",
      texto: "Revenda desligada: esta marca é só a pele. Nada é comissionado e ninguém recebe acesso de revendedor — é o caso do ISP grande que quis a própria cara.",
    }];
  }

  const avisos: AvisoDaRevenda[] = [];

  if (form.statusComercial === "suspenso") {
    avisos.push({
      tom: "gated",
      texto: "Comercial suspenso: a comissão para de ser lançada e o preço da marca fica travado. A pele continua no ar e os provedores seguem operando e pagando a plataforma.",
    });
  }
  if (Number(form.comissaoPercentual) === 0) {
    avisos.push({
      tom: "gated",
      texto: "Revenda ligada com comissão em 0%: os lançamentos nascem zerados e não há o que fechar no fim do mês.",
    });
  }
  if (!form.repasseRazaoSocial.trim() || !form.repasseCnpj.trim() || !form.repasseChavePix.trim()) {
    avisos.push({
      tom: "gated",
      texto: "Faltam dados de repasse. A comissão continua sendo apurada, mas o fechamento é pago fora do sistema e sem razão social, CNPJ e chave PIX não há para quem pagar.",
    });
  }

  return avisos;
}

/**
 * Por que ainda não dá para criar o acesso do revendedor.
 *
 * A ordem do onboarding (decisão 10) é domínio → HTTPS confirmado → revenda
 * ativa → usuário, e o servidor devolve 422 antes disso. A causa é a prova de
 * login: `hostPertenceAMarca` só aceita origem "dominio-proprio" com o
 * `dominioStatus` ativo, então um revendedor criado antes disso simplesmente
 * não teria por onde entrar — nem pelo subdomínio da plataforma.
 *
 * Devolve o motivo para a tela desabilitar o botão COM ele à vista. Descobrir a
 * regra pelo erro do servidor é o que esta função existe para evitar.
 *
 * OS QUATRO DEGRAUS SÃO OS QUATRO DO SERVIDOR, na mesma ordem. Enquanto
 * `revendaAtiva` e `ativo` ficavam de fora, a tela exibia um aviso dizendo que
 * "o acesso é criado e o login funciona" e deixava o botão clicável — e o
 * servidor respondia 422. Um aviso que contradiz o servidor é pior que aviso
 * nenhum: ele convence o operador a tentar.
 */
export function motivoParaNaoCriarRevendedor(
  marca: { dominio?: string | null; dominioStatus?: string | null; revendaAtiva?: boolean | null; ativo?: boolean | null },
): string | null {
  if (!marca.dominio) {
    return "Esta marca ainda não tem domínio próprio. O acesso do revendedor só existe pelo domínio dele — pelo subdomínio da plataforma o login recusa.";
  }
  if (marca.dominioStatus !== "ativo") {
    return "O HTTPS deste domínio ainda não foi confirmado. Aponte o DNS, rode o script e confirme o certificado na lista de marcas antes de criar o acesso.";
  }
  // `ativo === false` e não `!ativo`: quem chama pode não ter o campo, e
  // ausência de dado não é prova de marca desligada.
  if (marca.ativo === false) {
    return "Esta marca está desligada, e uma marca desligada não responde no domínio dela. Religue a marca antes de criar o acesso — o servidor recusa enquanto ela estiver assim.";
  }
  if (marca.revendaAtiva === false) {
    return "A revenda desta marca está desligada. Ligue-a na aba Comercial antes de criar o acesso — o servidor recusa a criação enquanto ela estiver desligada, e sem revenda o painel não teria função comercial.";
  }
  return null;
}

/**
 * O verbo gravado em `marca_eventos` virando frase.
 *
 * O catálogo do servidor (`ACOES_DE_MARCA`, em
 * `server/services/marca-eventos.service.ts`) não é importável daqui — o client
 * só alcança `@shared` —, então esta é uma segunda cópia declarada, na ordem do
 * catálogo para a conferência ser visual.
 *
 * O DESCONHECIDO É MOSTRADO, e não escondido: a trilha é append-only e o
 * catálogo do servidor cresce fase a fase (comissão é a fase 4). Uma tela que
 * escrevesse "ação desconhecida" apagaria da vista exatamente a evidência que
 * alguém foi procurar ali; o verbo cru, legível, é melhor prova do que um
 * rótulo bonito que não existe.
 */
const ROTULOS_DE_ACAO: Record<string, string> = {
  criar_provedor: "Criou provedor",
  editar_provedor: "Editou provedor",
  suspender: "Suspendeu provedor",
  reativar: "Reativou provedor",
  criar_usuario_provedor: "Criou usuário do provedor",
  remover_usuario_provedor: "Removeu usuário do provedor",
  vincular_por_convite: "Vinculou provedor por convite",
  editar_marca: "Editou a marca",
  editar_preco: "Editou preço",
  criar_usuario_revenda: "Criou acesso de revenda",
  remover_usuario_revenda: "Removeu acesso de revenda",
  alterar_comissao: "Alterou a comissão",
  fechar_fechamento: "Fechou a competência",
  aprovar_fechamento: "Aprovou o fechamento",
  pagar_fechamento: "Pagou o fechamento",
  cancelar_fechamento: "Cancelou o fechamento",
  ajuste_comissao: "Lançou ajuste de comissão",
  cadastro_publico: "Cadastro pela landing da marca",
};

export function rotuloDaAcao(acao: string): string {
  const conhecido = ROTULOS_DE_ACAO[acao];
  if (conhecido) return conhecido;
  const cru = acao.replace(/_/g, " ").trim();
  if (cru === "") return "—";
  return cru.charAt(0).toUpperCase() + cru.slice(1);
}

/** Uma linha da trilha, como a tela a recebe. Os campos `atorNome`/`provedorNome`
 *  são opcionais de propósito: hoje a rota devolve a linha crua da tabela, que
 *  guarda só os ids. Ver o aviso da entrega. */
export type EventoDaMarca = {
  id: number;
  userId: number;
  atorRole: string;
  acao: string;
  providerId: number | null;
  createdAt: string | null;
  atorNome?: string | null;
  provedorNome?: string | null;
};

/** Quem fez. Sem o nome, o id — que ainda identifica a pessoa no banco e é
 *  melhor do que "—" numa trilha de auditoria. */
export function nomeDoAtor(evento: EventoDaMarca): string {
  const nome = evento.atorNome?.trim();
  return nome || `usuário #${evento.userId}`;
}

/**
 * Sobre qual provedor foi a ação. Nulo quando a ação é sobre a própria marca —
 * e aí a tela mostra um traço, e não um provedor inventado.
 *
 * `provedores` é a lista que o detalhe da marca já traz: enquanto a rota não
 * devolver o nome junto do evento, um provedor ainda vinculado é resolvido aqui
 * mesmo. Provedor já desvinculado cai no id.
 */
export function nomeDoProvedor(
  evento: EventoDaMarca,
  provedores: { id: number; name: string }[] = [],
): string | null {
  if (evento.providerId == null) return null;
  const nome = evento.provedorNome?.trim();
  if (nome) return nome;
  const vinculado = provedores.find(p => p.id === evento.providerId);
  return vinculado?.name ?? `provedor #${evento.providerId}`;
}

/** Data e hora curtas. Data ausente ou impossível vira traço: numa trilha, um
 *  "Invalid Date" na coluna do horário é pior do que a ausência declarada. */
export function dataHoraCurta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "—";
  return data.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
