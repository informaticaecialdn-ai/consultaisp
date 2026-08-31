-- White label: uma marca que um revendedor veste sobre o MESMO bureau.
--
-- Escrito a mao de proposito. `drizzle-kit push` e interativo e, ao encontrar a
-- tabela nova, ofereceu como alternativa "renomear session -> marcas" — o que
-- destruiria todas as sessoes ativas. Tabela nova nao e ambigua; nao vale
-- deixar uma heuristica escolher.
--
-- Nao ha isolamento de dados aqui: `provider_id` continua sendo o unico eixo de
-- tenant. A marca so decide como o sistema se APRESENTA. Todos os provedores,
-- de todas as marcas, alimentam e leem a mesma base — que e o produto.

CREATE TABLE IF NOT EXISTS marcas (
  id                       serial PRIMARY KEY,
  slug                     text NOT NULL UNIQUE,
  ativo                    boolean NOT NULL DEFAULT true,

  -- Identidade
  nome_produto             text NOT NULL,
  assinatura               text,

  -- Dominio proprio. `pendente` ate alguem rodar script/dominio-whitelabel.sh:
  -- a aplicacao nao emite certificado, entao nao pode afirmar que o dominio
  -- responde em HTTPS.
  dominio                  text UNIQUE,
  dominio_status           text NOT NULL DEFAULT 'pendente',

  -- Visual. SVG e servido por URL e carregado em <img>, nunca embutido na
  -- pagina: e o navegador que desliga script em SVG-como-imagem, e essa
  -- garantia vale mais que qualquer sanitizador escrito a mao.
  logo_svg                 text,
  logo_png                 text,
  favicon_svg              text,

  -- UMA cor por tema; hover, soft e ink saem derivados em
  -- server/utils/marca-cores.ts, ja com correcao de contraste AA.
  cor_brand                text NOT NULL DEFAULT '#4A4670',
  cor_brand_dark           text,

  -- E-mail. `email_remetente` so pode ser usado com o dominio verificado no
  -- Resend; nulo = sai do dominio da plataforma com o nome da marca.
  email_remetente          text,
  email_nome_exibicao      text,

  -- Suporte
  suporte_email            text,
  suporte_whatsapp         text,
  site                     text,

  -- LGPD: quem responde pelo tratamento perante o titular. Se o cliente
  -- contratou da "CredNet" e a tela de consentimento diz outro nome, ele nao
  -- sabe a quem esta consentindo — e o consentimento fica defeituoso.
  responsavel_razao_social text,
  responsavel_cnpj         text,

  created_at               timestamp DEFAULT now()
);

-- Nulo = marca da plataforma. Fica ao lado de `subdomain` porque as duas sao as
-- formas de chegar a este tenant pelo host, e o login aceita as duas — e
-- nenhuma outra (server/services/marca.service.ts).
ALTER TABLE providers ADD COLUMN IF NOT EXISTS marca_id integer REFERENCES marcas(id);

-- A resolucao de marca roda em toda requisicao de HTML; o join
-- subdominio -> provedor -> marca nao deve varrer a tabela.
CREATE INDEX IF NOT EXISTS idx_providers_marca_id ON providers(marca_id);
