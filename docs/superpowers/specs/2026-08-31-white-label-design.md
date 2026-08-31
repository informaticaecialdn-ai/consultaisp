# White label — design

**Data:** 2026-08-31
**Status:** aprovado, em implementação

## Problema

Pessoas querem revender o Consulta ISP com a marca delas. Hoje o nome, o logo, as
cores, o favicon, os e-mails e o domínio são fixos — um revendedor não tem por
onde começar.

## A decisão que governa todo o resto

**White label aqui é pele, não instância.**

O produto é a base colaborativa: um CPF vale porque vários provedores relataram
sobre ele. Um revendedor com banco próprio venderia uma base vazia — o produto
não existe fora da rede. Então todo revendedor opera sobre o **mesmo bureau**, e
os provedores dele alimentam e leem a mesma base de todos.

Isso é bom comercialmente (cada revendedor engorda a base de todos) e tem uma
consequência de LGPD que a seção própria trata: o white label **não pode** ser
invisível na tela de consentimento.

## Escopo

| Entra | Não entra |
|---|---|
| Marca do login pra dentro | Landing page por revendedor |
| Domínio próprio com HTTPS | Painel comercial de revenda |
| Logo, cores, nome, favicon, OG | Cobrança do revendedor pela plataforma |
| E-mails com a marca | Preço próprio por revendedor |
| Texto de LGPD com o responsável certo | |

Landing e painel de revenda ficam para a fase 2.

## Modelo de dados

Uma tabela nova, `marcas`, e `providers.marcaId` apontando pra ela. Nulo = marca
da plataforma.

A marca ser entidade própria — e não um punhado de colunas em `providers` —
cobre os dois casos com a mesma estrutura:

- um **revendedor** com 10 ISPs é uma marca com 10 provedores apontando pra ela;
- um **ISP grande** que quer a própria cara é uma marca com um provedor só.

Não é preciso escolher agora entre "revenda" e "auto-branding".

```
marcas
  id, slug (unique), ativo, createdAt

  -- identidade
  nomeProduto            "CredNet"            substitui "Consulta ISP"
  assinatura             linha de apoio sob o nome

  -- domínio
  dominio (unique)       "app.crednet.com.br"  null = usa subdomínio da plataforma
  dominioStatus          pendente | ativo      só vira ativo com certificado emitido

  -- visual
  logoSvg / logoPng      SVG preferido; PNG aceito com ressalva (não segue o tema escuro)
  faviconSvg
  corBrand, corBrandHover, corBrandSoft, corBrandInk        tema claro
  corBrandDark, corBrandDarkHover, corBrandDarkSoft, ...    tema escuro

  -- e-mail
  emailRemetente         null = domínio verificado da plataforma
  emailNomeExibicao

  -- suporte
  suporteEmail, suporteWhatsapp, site

  -- LGPD: quem responde pelo tratamento
  responsavelRazaoSocial, responsavelCnpj
```

## Resolução: o host decide, no servidor

Middleware resolve `req.hostname` → marca, com cache em memória invalidado na
gravação. Três caminhos:

| Host | Resolve para |
|---|---|
| `consultaisp.com.br`, `www.` | marca da plataforma (padrão embutido) |
| `*.consultaisp.com.br` | subdomínio → provedor → `provider.marcaId` |
| qualquer outro | busca por `marcas.dominio` |

Host desconhecido cai na marca da plataforma.

## Entrega ao cliente: injeção no HTML

O caminho óbvio seria o React buscar a marca numa rota e aplicar depois de
montar. Isso pinta a tela com a marca errada e troca em seguida — **flash de
marca concorrente na tela de login de um revendedor é inaceitável**.

Então a marca é injetada no HTML no momento de servir: `<title>`, favicon,
`theme-color`, Open Graph, um `<style>` com os tokens de cor e um
`window.__MARCA__`. Existe exatamente um ponto onde o `index.html` é servido em
dev (`server/vite.ts`) e um em produção (`server/static.ts`) — os dois passam
pelo mesmo transform.

Zero flash, zero requisição extra, zero estado de carregando.

### As cores precisam sair em dois formatos

Os tokens da pele (`--brand`, `--action`, `--brand-hover`, `--brand-bg`,
`--brand-soft`, `--brand-ink`) são **hex**. O `--primary` e o `--sidebar-accent`
do shadcn são **HSL em tripla** (`246 23% 36%`). Sobrescrever só um dos formatos
deixa metade dos botões na cor antiga. A conversão hex→HSL acontece no servidor.

### Injeção é vetor de XSS

`nomeProduto`, `logoSvg` e as cores vêm do banco e são controlados pelo
revendedor. Injetados sem tratamento em `<title>`, `<style>` e `<script>`, um
revendedor malicioso executa script no navegador dos clientes de outro.

Regras, por contexto de injeção:

- **texto em HTML** — escapar `& < > " '`
- **dentro de `<script>`** — serializar com `JSON.stringify` e escapar `<`, `>`,
  U+2028 e U+2029. `JSON.stringify` sozinho não basta: deixa `</script>`
  intacto, e o parser de HTML fecha a tag antes de o JS rodar.
- **cor em `<style>`** — validar contra `/^#[0-9a-f]{6}$/i` e **rejeitar** o que
  não casar. Não sanitizar: rejeitar. Cor não tem forma livre. Uma cor inválida
  derruba o bloco de cor **inteiro** — meia paleta aplicada mistura a marca do
  revendedor com a da plataforma, o que é pior que nenhuma.
- **caminhos internos** — só `/…`, e **`//evil.com/x` é recusado**: começa com
  barra, passa em qualquer teste ingênuo de "é caminho local", e o navegador
  busca em `evil.com`. Foi um teste que pegou.

### O logo não é sanitizado — ele nunca é embutido

O design original previa uma allowlist de elementos e atributos para o
`logoSvg`. **Descartado durante a implementação**: sanitizador de SVG escrito à
mão é notoriamente furado, e o projeto não tem DOMPurify.

A garantia passou a vir do **navegador**: SVG carregado por `<img src>` tem
script desligado por especificação. Basta nunca embutir — e não há lugar que
precise: logo e favicon são referenciados por URL. Quem abrir a URL direto vê o
SVG como documento, e para esse caso a resposta leva
`Content-Security-Policy: default-src 'none'` mais `X-Content-Type-Options:
nosniff`, o que a deixa inerte.

Isso elimina a classe inteira de XSS por logo, em vez de tentar filtrá-la.

### Sem logo, monograma — nunca o símbolo da plataforma

Encontrado ao olhar a tela pronta: um revendedor cadastrado mas **sem logo**
caía no hexágono do Consulta ISP, e a porta de entrada dele exibia a marca de
outra empresa. Agora cai num monograma com a inicial, na cor dele.

## Dois pontos que quebram com domínio próprio

Não são melhorias; são regressões que o domínio próprio cria.

**1. O `App.tsx` mostraria a landing.** A regra atual é
`if (!getSubdomain()) → landing`. Em `app.crednet.com.br` isso dá nulo, e o
cliente do revendedor cairia na landing do Consulta ISP em vez do login. Passa a
vir do servidor: a marca injetada diz se o host é plataforma ou tenant.

**2. O login seria recusado.** `server/routes/auth.routes.ts` valida que o
subdomínio da requisição bate com o do provedor — é a checagem que impede alguém
logar no tenant de outro. Num domínio próprio ela reprova todo mundo.

A regra passa a aceitar **duas** provas de pertencimento:

```
host é o subdomínio do provedor        OU        host é o domínio da marca do provedor
```

A validação **não é afrouxada** — ganha uma segunda prova, igualmente estrita. O
teste que garante isso: provedor da marca A tentando logar no domínio da marca B
tem que falhar.

## E-mail

`emailTemplate` passa a receber a marca: logo, cores, nome do produto, rodapé,
links absolutos apontando para o domínio da marca.

Duas coisas a corrigir de passagem:

- Os e-mails ainda usam a paleta **terracota `#C96442`** do design v3.0, que foi
  abandonado. O sistema hoje é berinjela `#4A4670` e laranja `#F26201`.
- O **remetente** depende de o Resend ter o domínio verificado. Na v1 o nome de
  exibição é da marca e o envelope sai do domínio verificado da plataforma; o
  campo `emailRemetente` fica pronto para quando o revendedor verificar o dele.
  Isso aparece no cabeçalho do e-mail — o revendedor precisa ser avisado.

## LGPD: o único lugar onde o white label não pode ser invisível

Se o cliente final comprou da "CredNet" e a tela de consentimento diz "Consulta
ISP", ele não sabe a quem está consentindo, e o consentimento é defeituoso.

Por isso a marca carrega `responsavelRazaoSocial` e `responsavelCnpj`, e os
textos de LGPD passam a nomear **o controlador de verdade, com a plataforma
nomeada como operadora**. Esconder a plataforma não deixa o white label mais
bonito; deixa o consentimento inválido.

## Domínio próprio e TLS: onde a aplicação para

A aplicação **não** emite certificado. Rodar `certbot` a partir do Node exige
root e transforma um bug de aplicação em comprometimento do servidor.

1. superadmin cadastra o domínio no painel → `dominioStatus = pendente`
2. revendedor aponta o DNS para o servidor
3. operador roda `script/dominio-whitelabel.sh app.crednet.com.br` — bloco nginx
   + certbot → `dominioStatus = ativo`

O wildcard `*.consultaisp.com.br` já está no certificado servido, então o
subdomínio funciona de imediato enquanto o domínio próprio não sai.

## O que não muda

- **A base é a mesma para todos.** É o produto.
- **"Consulta ISP" como nome de consulta permanece.** Das ocorrências da string
  no código, boa parte é o *tipo de consulta* — que convive com "Consulta SPC" e
  "Consulta Cadastral" — e não a marca da plataforma. Trocar essas quebra tela.
  A distinção é feita ocorrência a ocorrência, não por substituição em massa.
- **O painel do superadmin continua da plataforma.**

## Testes

| O que | Por quê |
|---|---|
| Resolução host→marca: principal, www, subdomínio, domínio próprio, host desconhecido | é o ponto de entrada de tudo |
| Provedor da marca A logando no domínio da marca B **falha** | a regra de login é a peça de segurança da feature |
| Escape de `nomeProduto` com aspas e `</script>` | XSS na injeção |
| Cor inválida é rejeitada, não sanitizada | idem |
| `logoSvg` com `<script>` e com `on*` é recusado no cadastro | idem |
| Conversão hex→HSL bate com os valores atuais do `index.css` | evita regressão de cor na marca da plataforma |
| Marca não aparece em resposta de outro tenant | isolamento |

## Três defeitos que já existiam, encontrados no caminho

Nenhum é do white label. Os dois primeiros precisaram ser corrigidos porque a
feature se apoia neles.

**1. `extractSubdomainFromHost` contava rótulos.** `parts.length >= 3` sem nunca
comparar com o domínio da plataforma. Errava dos dois lados: `consultaisp.com.br`
devolvia `"consultaisp"` (é o próprio domínio raiz), e `nslink.evil.com` devolvia
`"nslink"`. O primeiro fazia o provedor receber "Email ou senha incorretos" ao
tentar entrar pelo domínio raiz — mensagem que mente sobre o motivo. Corrigido:
agora exige o sufixo da plataforma.

**2. `X-Forwarded-Host` era controlado pelo cliente.** O app roda com
`trust proxy 1`, então o Express prefere esse cabeçalho ao `Host` real; o nginx
define `Host` mas **não** `X-Forwarded-Host`, então o valor do cliente passava
direto. Medido em um Express local: o cabeçalho forjado vira `req.hostname`.
Hoje o efeito é pequeno (a checagem antiga já era fail-open); com white label o
cabeçalho passaria a **escolher o tenant**. `script/dominio-whitelabel.sh`
corrige a configuração, e `requireAuth` compara o host inteiro contra o do login
como segunda barreira.

**3. A política de privacidade pública publica um CNPJ de exemplo.**
`LGPD_CNPJ` não está no ambiente de produção, e `/api/public/lgpd-info` cai no
literal `00.000.000/0000-00`. Está no ar hoje, num documento com efeito
jurídico. Não foi corrigido aqui porque exige o CNPJ real — é uma variável de
ambiente a preencher.

## Notas de implementação

- **A migração é escrita à mão** (`migrations/0009_marcas_white_label.sql`).
  `drizzle-kit push` é interativo e, ao encontrar a tabela nova, ofereceu como
  alternativa renomear `session` → `marcas` — o que apagaria todas as sessões.
  Tabela nova não é ambígua; não vale deixar uma heurística escolher.
- **Tokens de cor:** além dos óbvios, a injeção cobre `--color-steel` (não tem
  "brand" no nome, mas é o hover de todo botão) e `--focus-ring` (guarda a cor em
  `rgba` literal, não deriva de `--brand`). Fica **de fora** `--cat-indigo`, que
  tem o mesmo valor da marca mas significa "ERP iXC Soft" — trocar mudaria o
  sentido de um dado.
- **`hostLogin` na sessão:** o host normalizado do login é comparado a cada
  requisição. Sessões abertas antes do deploy não o têm e caem na regra antiga
  até expirar (cookie de 48h); esse ramo pode sair depois disso.

## Fase 2 (fora deste design)

Landing por revendedor · painel comercial de revenda · preço próprio · cobrança
da plataforma para o revendedor.
