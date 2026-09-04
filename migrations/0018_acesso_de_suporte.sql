-- O suporte passa a entrar NA CONTA do provedor, e isso precisa deixar rastro.
--
-- O provedor libera; enquanto a janela vale, o superadmin faz tudo o que o admin
-- dele faz — inclusive ver CPF, nome, endereco e telefone dos clientes, que sao
-- dados de titulares que nunca ouviram falar do suporte. O isolamento por
-- `provider_id`, que e a invariante central do produto, e atravessado DE
-- PROPOSITO. Uma travessia autorizada continua sendo uma travessia: o que a
-- torna aceitavel nao e o consentimento sozinho, e o consentimento com prova.
--
-- Duas colunas em `providers` (`suporte_liberado_ate`, `suporte_liberado_por`)
-- resolveriam a funcionalidade e nada mais. Coluna guarda o AGORA: a segunda
-- liberacao escreve por cima da primeira e a primeira deixa de ter existido. A
-- pergunta que a LGPD faz nao e sobre agora — e "em marco, quem olhou o dado de
-- quem, autorizado por quem, e por quanto tempo?". Uma tabela responde porque
-- cada linha e uma janela que existiu, e nenhuma linha e reescrita por cima.
--
-- TIMESTAMPTZ, e nao o TIMESTAMP do resto do schema. Nas outras tabelas o fuso e
-- cosmetico — muda como a data aparece num relatorio. Aqui ele decide se um
-- estranho enxerga dado pessoal: `timestamp without time zone` compara paredes
-- de relogio, e o resultado depende do fuso da sessao que gravou e do fuso da
-- que le. Uma janela de 2 horas nao pode virar 5 porque o processo Node e o
-- Postgres discordaram de fuso. Com TIMESTAMPTZ os dois lados falam de instante.
--
-- Nao ha `ON DELETE CASCADE` em nenhuma das FKs, e e deliberado. Apagar o
-- provedor ou o usuario que liberou nao pode apagar a prova de que alguem olhou
-- o dado de terceiros — a trilha existe justamente para sobreviver a quem a
-- gerou. O efeito pratico e que `deleteProvider` passa a esbarrar aqui se
-- houver historico, o que e a conversa certa para se ter naquele momento.
--
-- Idempotente: IF NOT EXISTS na tabela e nos dois indices.

CREATE TABLE IF NOT EXISTS acessos_suporte (
  id              SERIAL PRIMARY KEY,

  -- De quem e o dado que foi aberto.
  provider_id     INTEGER     NOT NULL REFERENCES providers(id),

  -- O consentimento: quem autorizou, e quando.
  liberado_por    INTEGER     NOT NULL REFERENCES users(id),
  liberado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ate quando valia. Sem default: quem libera decide a duracao, e um default
  -- silencioso aqui viraria a duracao real no dia em que a aplicacao esquecesse
  -- de mandar a dela.
  expira_em       TIMESTAMPTZ NOT NULL,

  -- Se foi cortada antes da hora, e por quem. NULL = correu ate o fim do prazo,
  -- que e diferente de ter sido interrompida — a distincao importa numa
  -- auditoria e por isso o par nunca e preenchido em janela ja expirada.
  revogado_em     TIMESTAMPTZ,
  revogado_por    INTEGER     REFERENCES users(id),

  -- Quem de fato entrou, e quando entrou a primeira vez. Ficam NULL enquanto
  -- ninguem usa: janela autorizada e nunca aberta e a informacao de que nenhum
  -- dado pessoal foi visto, e ela se perde se a coluna nascer preenchida.
  usado_por       INTEGER     REFERENCES users(id),
  primeiro_uso_em TIMESTAMPTZ,

  -- Ate quando ficou, e com que intensidade.
  ultimo_uso_em   TIMESTAMPTZ,
  usos            INTEGER     NOT NULL DEFAULT 0
);

-- A pergunta quente: "existe liberacao valida para o provedor X agora?", feita a
-- cada requisicao de uma sessao de suporte. Parcial em `revogado_em IS NULL`
-- porque janela revogada nunca volta a ser valida — mante-la fora do indice faz
-- ele parar de crescer junto com o historico. `expira_em DESC` porque a consulta
-- pede a de prazo mais longo e para na primeira linha.
--
-- O predicado NAO pode incluir `expira_em > NOW()`: um indice parcial exige
-- expressao imutavel, e NOW() muda a cada instante. O prazo e filtrado na
-- consulta; o indice so entrega as candidatas ja ordenadas.
CREATE INDEX IF NOT EXISTS acessos_suporte_vigente
  ON acessos_suporte (provider_id, expira_em DESC)
  WHERE revogado_em IS NULL;

-- A outra pergunta, fria: a trilha daquele provedor, da mais recente para tras.
CREATE INDEX IF NOT EXISTS acessos_suporte_historico
  ON acessos_suporte (provider_id, liberado_em DESC);
