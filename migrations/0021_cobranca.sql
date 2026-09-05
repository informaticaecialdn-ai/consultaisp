-- Cobranca — o funcionario no lugar do agente.
--
-- Pedido do dono em 05/09/2026: trazer do Provedor.ai a carteira, a ficha 360,
-- a regua e o DNA 3x3, "mas ao inves de agentes vai ser o funcionario, usuario
-- do sistema" — um sistema mais simples, que organize o provedor que cobra a
-- mao com um funcionario interno: negociacoes, parcelamentos e o
-- acompanhamento total da vida do cliente que entra na cobranca.
--
-- MEDIDO em producao no mesmo dia, e e o que define o desenho:
--
--   · NAO existe fatura a fatura. `invoices` tem 3 linhas (de teste) e
--     `contracts` uma. O sync do ERP grava so AGREGADOS em `customers`:
--     status, payment_status, total_overdue_amount, max_days_overdue,
--     overdue_invoices_count, motivo_corte, cortado_em. Por isso o caso e POR
--     CLIENTE e a regua da fase 1 anda sobre `max_days_overdue`. Fatura a
--     fatura e a fase 2 — o preventivo D-7..D0 fica no catalogo, pulado.
--   · Duas carteiras, iguais em importancia: ~590 clientes ativos ou
--     suspensos com divida, e ~7.300 EX-clientes devendo R$ 4,8 mi (a NG
--     sozinha: 6.034 clientes, R$ 3,9 mi). Cada uma tem a sua regua — o
--     ex-cliente nao passa por aviso de suspensao, porque nao ha o que
--     suspender.
--   · `customers` nao guarda a data do contrato. O conector traz
--     `contractStartDate` e ninguem gravava. Sem ela o DNA nao tem
--     FIDELIDADE (novo ate 11 meses, medio ate 36, fiel acima) e todo cliente
--     vira "novo" — o tom para um cliente de dez anos sairia igual ao de quem
--     entrou mes passado.
--
-- O molde e o CRM de recuperacao de equipamento (migracao 0005): um CASO por
-- cliente, uma LINHA DO TEMPO de eventos, `user_id` nulo quando foi o sistema.
-- Negociacao e parcela sao tabelas proprias porque um caso pode ter mais de um
-- acordo — o primeiro quebra, o segundo cumpre — e a ficha conta os dois.
--
-- Nao ha `ON DELETE CASCADE`, como em 0018: a trilha de quem cobrou quem, com
-- que tom e que resultado, e o que um dia responde a reclamacao de assedio
-- (CDC art. 42/71). Ela nao pode sumir junto com o usuario que a produziu.
--
-- Idempotente: IF NOT EXISTS em tabela, coluna e indice.

-- ── customers.contract_start_date ───────────────────────────────────────────
-- DATE, nao TIMESTAMP: o ERP diz o dia. Um horario inventado so serviria para
-- virar o dia errado quando o fuso do processo Node e o do Postgres
-- discordam. Gravada como `YYYY-MM-DD` a partir das partes locais da data que
-- `dataDoErp` montou (server/erp/data-do-erp.ts), sem passar por UTC.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_start_date DATE;

-- ── cobranca_politica ───────────────────────────────────────────────────────
-- Uma por provedor. Ausente = tudo no padrao; por isso nao ha seed.
--
-- Os DEFAULTS abaixo sao os mesmos de POLITICA_DE_COBRANCA_PADRAO em
-- shared/schema.ts e de POLITICA_PADRAO em shared/cobranca/politica.ts, e
-- precisam continuar iguais (ha teste): e o que faz uma linha criada so com
-- `pausada = true` (o botao de pausar a regua antes de configurar o resto)
-- nascer utilizavel. Os valores sao os do Provedor.ai (buildDefaultPolicy),
-- em pontos percentuais.
--   negociacao      tetos de NEGOCIO, editaveis pelo provedor: 6x, 20% de
--                   entrada, 20% de desconto, nao se parcela abaixo de R$ 150
--   encargos        tetos LEGAIS: multa 2% (CDC art. 52 §1), juros 1%/mes
--                   (CC art. 406). A politica so pode descer.
--   janela_contato  CDC art. 42: dias uteis 8h-20h, sabado ate 14h, domingo
--                   e feriado nao.
--   etapas          `[]` = vale o catalogo padrao do motor da regua; a lista
--                   guarda SO as mudancas do provedor (EtapaConfig).
CREATE TABLE IF NOT EXISTS cobranca_politica (
  id              SERIAL PRIMARY KEY,
  provider_id     INTEGER NOT NULL REFERENCES providers(id),
  etapas          JSONB   NOT NULL DEFAULT '[]'::jsonb,
  negociacao      JSONB   NOT NULL DEFAULT '{"maxParcelas":6,"entradaMinimaPct":20,"descontoMaxPct":20,"saldoMinimoParcelar":150}'::jsonb,
  encargos        JSONB   NOT NULL DEFAULT '{"multaPct":2,"jurosMesPct":1}'::jsonb,
  janela_contato  JSONB   NOT NULL DEFAULT '{"horaInicio":8,"horaFim":20,"sabado":true,"sabadoHoraFim":14,"domingo":false,"feriado":false}'::jsonb,
  pausada         BOOLEAN NOT NULL DEFAULT FALSE,
  pausada_motivo  TEXT,
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS cobranca_politica_provider
  ON cobranca_politica (provider_id);

-- ── cobranca_casos ──────────────────────────────────────────────────────────
-- A vida do cliente na cobranca. Guarda a FOTO da abertura (dias, valor,
-- carteira) e o estado de hoje (etapa, valor atual, responsavel, DNA).
--
-- status: aberto | negociando | acordo_ativo | pago | baixado | negativado |
--         encerrado. Terminais: pago, baixado, encerrado.
--
-- `negativado` NAO e terminal, e e decisao: negativar e uma ETAPA da cobranca,
-- nao o fim dela — o nome sujo e o que faz o ex-cliente voltar para negociar,
-- e a campanha de divida antiga mira justamente esse cliente. Se fosse
-- terminal, o job de abertura veria cliente com divida e sem caso vivo e
-- abriria outro no dia seguinte, para sempre.
--
-- `carteira` (ativo | ex_cliente) e fixada na abertura porque o status do ERP
-- muda depois: um ativo cortado no meio da cobranca continua sendo o caso
-- que abriu como ativo, e o relatorio de recuperacao por carteira precisa
-- dessa estabilidade.
CREATE TABLE IF NOT EXISTS cobranca_casos (
  id                     SERIAL PRIMARY KEY,
  provider_id            INTEGER NOT NULL REFERENCES providers(id),
  customer_id            INTEGER NOT NULL REFERENCES customers(id),
  status                 TEXT    NOT NULL DEFAULT 'aberto',
  carteira               TEXT    NOT NULL,
  aberto_em              TIMESTAMP NOT NULL DEFAULT NOW(),
  etapa_atual            TEXT,
  dias_atraso_abertura   INTEGER NOT NULL DEFAULT 0,
  valor_abertura         DECIMAL(12, 2) NOT NULL DEFAULT 0,
  valor_atual            DECIMAL(12, 2) NOT NULL DEFAULT 0,
  -- NULL = fila geral: qualquer operador pega.
  responsavel_user_id    INTEGER REFERENCES users(id),
  prioridade             TEXT    NOT NULL DEFAULT 'normal',
  proximo_contato_em     TIMESTAMP,
  ultimo_contato_em      TIMESTAMP,
  quadrante_dna          TEXT,
  tom                    TEXT,
  encerrado_em           TIMESTAMP,
  motivo_encerramento    TEXT,
  created_at             TIMESTAMP DEFAULT NOW(),
  updated_at             TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cobranca_casos_provider_status
  ON cobranca_casos (provider_id, status);
CREATE INDEX IF NOT EXISTS idx_cobranca_casos_provider_customer
  ON cobranca_casos (provider_id, customer_id);

-- UM CASO VIVO POR CLIENTE. A lista de status e STATUS_CASO_FECHADO de
-- shared/schema.ts, repetida literalmente — ha teste que le este arquivo e
-- confere. Parcial porque o historico de casos fechados do mesmo cliente
-- precisa coexistir: pagou, voltou a dever, novo caso.
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_casos_um_aberto_por_cliente
  ON cobranca_casos (provider_id, customer_id)
  WHERE status NOT IN ('pago', 'baixado', 'encerrado');

-- A fila do operador: casos vivos, por responsavel, na ordem do proximo
-- contato. Parcial pelo mesmo motivo do indice acima — caso fechado nao
-- volta para a fila.
CREATE INDEX IF NOT EXISTS idx_cobranca_casos_fila
  ON cobranca_casos (provider_id, responsavel_user_id, proximo_contato_em)
  WHERE status NOT IN ('pago', 'baixado', 'encerrado');

-- ── cobranca_eventos ────────────────────────────────────────────────────────
-- A linha do tempo. `user_id` nulo = o sistema (job, cascata de acordo).
--
-- tipo:      contato | promessa | negociacao_proposta | acordo_aceito |
--            acordo_quebrado | parcela_paga | etapa_mudou | responsavel_mudou |
--            nota | suspensao | negativacao | encerramento
-- canal:     telefone | whatsapp | email | presencial | sistema
-- resultado: falou | nao_atendeu | caixa_postal | promessa_pagamento |
--            recusou | numero_errado
--
-- `customer_id` e repetido do caso de proposito: a ficha 360 le a vida
-- INTEIRA do cliente, atravessando casos fechados e reabertos, e sem a coluna
-- cada leitura teria de juntar com `cobranca_casos` so para descobrir de quem
-- e o evento.
CREATE TABLE IF NOT EXISTS cobranca_eventos (
  id            SERIAL PRIMARY KEY,
  provider_id   INTEGER NOT NULL REFERENCES providers(id),
  caso_id       INTEGER NOT NULL REFERENCES cobranca_casos(id),
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  user_id       INTEGER REFERENCES users(id),
  tipo          TEXT    NOT NULL,
  canal         TEXT,
  resultado     TEXT,
  notas         TEXT,
  metadata      JSONB,
  ocorrido_em   TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cobranca_eventos_caso
  ON cobranca_eventos (provider_id, caso_id, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_cobranca_eventos_cliente
  ON cobranca_eventos (provider_id, customer_id, ocorrido_em DESC);
-- "Contatados hoje", o KPI do cabecalho da carteira.
CREATE INDEX IF NOT EXISTS idx_cobranca_eventos_tipo_data
  ON cobranca_eventos (provider_id, tipo, ocorrido_em);

-- ── cobranca_negociacoes ────────────────────────────────────────────────────
-- tipo:   parcelamento | quitacao_desconto | baixa_negociada
-- status: proposta | aceita | ativa | cumprida | quebrada | cancelada
--
-- `parcelas` e a CONTAGEM e e igual ao numero de linhas em cobranca_parcelas
-- da negociacao — as duas nascem na mesma transacao.
CREATE TABLE IF NOT EXISTS cobranca_negociacoes (
  id                   SERIAL PRIMARY KEY,
  provider_id          INTEGER NOT NULL REFERENCES providers(id),
  caso_id              INTEGER NOT NULL REFERENCES cobranca_casos(id),
  customer_id          INTEGER NOT NULL REFERENCES customers(id),
  tipo                 TEXT    NOT NULL,
  valor_original       DECIMAL(12, 2) NOT NULL,
  valor_negociado      DECIMAL(12, 2) NOT NULL,
  desconto_pct         DECIMAL(5, 2)  NOT NULL DEFAULT 0,
  entrada              DECIMAL(12, 2) NOT NULL DEFAULT 0,
  parcelas             INTEGER NOT NULL DEFAULT 0,
  valor_parcela        DECIMAL(12, 2),
  primeiro_vencimento  DATE,
  status               TEXT    NOT NULL DEFAULT 'proposta',
  criado_por_user_id   INTEGER NOT NULL REFERENCES users(id),
  aceita_em            TIMESTAMP,
  quebrada_em          TIMESTAMP,
  created_at           TIMESTAMP DEFAULT NOW(),
  updated_at           TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cobranca_negociacoes_caso
  ON cobranca_negociacoes (provider_id, caso_id);

-- ── cobranca_parcelas ───────────────────────────────────────────────────────
-- status: pendente | paga | atrasada | cancelada
CREATE TABLE IF NOT EXISTS cobranca_parcelas (
  id              SERIAL PRIMARY KEY,
  provider_id     INTEGER NOT NULL REFERENCES providers(id),
  negociacao_id   INTEGER NOT NULL REFERENCES cobranca_negociacoes(id),
  numero          INTEGER NOT NULL,
  valor           DECIMAL(12, 2) NOT NULL,
  vencimento      DATE    NOT NULL,
  pago_em         TIMESTAMP,
  valor_pago      DECIMAL(12, 2),
  status          TEXT    NOT NULL DEFAULT 'pendente'
);

CREATE UNIQUE INDEX IF NOT EXISTS cobranca_parcelas_numero
  ON cobranca_parcelas (negociacao_id, numero);
-- O job que marca atrasadas, e o KPI de recuperado nos ultimos 30 dias.
CREATE INDEX IF NOT EXISTS idx_cobranca_parcelas_status_vencimento
  ON cobranca_parcelas (provider_id, status, vencimento);
