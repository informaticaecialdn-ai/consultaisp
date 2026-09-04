-- White Label Fase 2 — revenda por comissão sobre venda direta.
-- Spec: docs/superpowers/specs/2026-09-02-white-label-fase2-comissao.md
-- (decisões do dono de 02/09/2026; migração aprovada inteira, decisão 1).
--
-- A marca (`marcas`, fase 1) É o revendedor: a camada comercial pendura nela.
-- Nenhuma tabela de DADOS (customers, consultas, alertas, equipamentos) ganha
-- marca_id — a marca não é eixo de isolamento; o bureau continua único e
-- isolado por provider_id. Tudo aqui é nullable ou tem default: nada existente
-- muda de sentido, e nada é escrito nas tabelas novas até a fase que as usa.
--
-- Escrita à mão e idempotente (IF NOT EXISTS em tudo; CHECKs dentro de DO
-- porque o Postgres não tem ADD CONSTRAINT IF NOT EXISTS), sem ON DELETE
-- CASCADE: apagar marca com histórico é decisão de gente, não de FK.
-- Roda no boot por server/migrate.ts dentro de uma transação.

-- 1) users — único vínculo pessoa ↔ marca. O papel `revendedor` (fase 1)
--    tem marca e não tem provedor; user/admin têm provedor e não têm marca;
--    superadmin não tem marca. O CHECK é bidirecional de propósito: é ele
--    que impede o estado "usuário sem provedor" que o requireAuth assumia
--    como impossível.
ALTER TABLE users ADD COLUMN IF NOT EXISTS marca_id INTEGER REFERENCES marcas(id);
CREATE INDEX IF NOT EXISTS idx_users_marca_id ON users (marca_id);
DO $$
DECLARE
  orfaos INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_papel_coerente') THEN
    -- ADD CONSTRAINT ... CHECK (sem NOT VALID) VALIDA AS LINHAS QUE JA EXISTEM,
    -- e a migracao roda em transacao no boot: uma unica linha incoerente
    -- derruba o deploy inteiro com o texto cru do Postgres ("violates check
    -- constraint"), que nao diz QUAL linha nem o que fazer.
    --
    -- A linha incoerente e plausivel: `user`/`admin` sem provedor e exatamente
    -- o estado que a fase 0 descobriu que o `requireAuth` assumia impossivel —
    -- ele virou fail-closed por causa disso. Se sobrou alguma no banco, ela
    -- aparece aqui, com contagem e instrucao, ANTES do erro ilegivel.
    --
    -- NAO se conserta o dado sozinho: apagar ou remendar linha de usuario e
    -- decisao de gente, e um UPDATE silencioso numa migracao e a pior forma de
    -- descobrir que alguem perdeu o acesso.
    SELECT count(*) INTO orfaos FROM users
     WHERE NOT (
       (role = 'revendedor' AND marca_id IS NOT NULL AND provider_id IS NULL)
       OR (role IN ('user', 'admin') AND provider_id IS NOT NULL AND marca_id IS NULL)
       OR (role = 'superadmin' AND marca_id IS NULL)
     );
    IF orfaos > 0 THEN
      RAISE EXCEPTION
        'A 0013 nao pode criar users_papel_coerente: % linha(s) de users violam a regra de papel. '
        'Rode: SELECT id, email, role, provider_id, marca_id FROM users WHERE NOT ('
        '(role = ''revendedor'' AND marca_id IS NOT NULL AND provider_id IS NULL) OR '
        '(role IN (''user'',''admin'') AND provider_id IS NOT NULL AND marca_id IS NULL) OR '
        '(role = ''superadmin'' AND marca_id IS NULL)); '
        'e decida caso a caso (o tipico e operador sem provedor, que ja nao consegue logar desde a fase 0).',
        orfaos;
    END IF;

    ALTER TABLE users ADD CONSTRAINT users_papel_coerente CHECK (
      (role = 'revendedor' AND marca_id IS NOT NULL AND provider_id IS NULL)
      OR (role IN ('user', 'admin') AND provider_id IS NOT NULL AND marca_id IS NULL)
      OR (role = 'superadmin' AND marca_id IS NULL)
    );
  END IF;
END $$;

-- 2) marcas — camada comercial. revenda_ativa=false é marca "só pele" (ISP
--    grande com a própria cara): não comissiona nem tem painel comercial.
--    status_comercial pausa comissão e trava preço SEM derrubar a pele nem
--    os provedores (decisão 14: provedor nunca é punido por dívida do
--    revendedor). Dados de repasse são de quem recebe a comissão: só o
--    superadmin lê e escreve; nunca vão para window.__MARCA__.
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS revenda_ativa BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS status_comercial TEXT NOT NULL DEFAULT 'ativo';
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS comissao_percentual NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS repasse_razao_social TEXT;
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS repasse_cnpj TEXT;
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS repasse_chave_pix TEXT;
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS repasse_email TEXT;
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS cadastro_aberto BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS landing_ativa BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS landing JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE marcas ADD COLUMN IF NOT EXISTS og_image_png TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marcas_status_comercial_valido') THEN
    ALTER TABLE marcas ADD CONSTRAINT marcas_status_comercial_valido
      CHECK (status_comercial IN ('ativo', 'suspenso'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marcas_comissao_faixa') THEN
    -- 0–50 (decisão 3): acima disso a plataforma fica com menos da metade e
    -- o piso de preço deixa de proteger a margem.
    ALTER TABLE marcas ADD CONSTRAINT marcas_comissao_faixa
      CHECK (comissao_percentual >= 0 AND comissao_percentual <= 50);
  END IF;
END $$;

-- 3) marca_precos — camada 1 do preço (fase 3). Tabela, e não JSONB, para
--    ter histórico por linha, validar a chave contra o catálogo e fazer JOIN
--    direto no generate-monthly. Vazia = todo mundo na tabela da plataforma.
CREATE TABLE IF NOT EXISTS marca_precos (
  id                 SERIAL PRIMARY KEY,
  marca_id           INTEGER NOT NULL REFERENCES marcas(id),
  tipo               TEXT NOT NULL CHECK (tipo IN ('pacote', 'plano')),
  chave              TEXT NOT NULL,
  preco_centavos     INTEGER NOT NULL CHECK (preco_centavos >= 0),
  ativo              BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_por_id  INTEGER REFERENCES users(id),
  atualizado_em      TIMESTAMP DEFAULT NOW(),
  UNIQUE (marca_id, tipo, chave)
);
CREATE INDEX IF NOT EXISTS idx_marca_precos_marca ON marca_precos (marca_id);

-- 4) e 5) FOTO da marca no pedido e na fatura. A comissão é calculada sobre
--    a marca que o provedor vestia QUANDO pagou, nunca sobre a atual: trocar
--    de marca não reescreve comissão passada (invariante da spec). Sem
--    backfill: histórico fica null = plataforma (decisão 7, sem retroativo).
ALTER TABLE credit_orders ADD COLUMN IF NOT EXISTS marca_id INTEGER REFERENCES marcas(id);
ALTER TABLE credit_orders ADD COLUMN IF NOT EXISTS preco_unitario_centavos INTEGER;
ALTER TABLE provider_invoices ADD COLUMN IF NOT EXISTS marca_id INTEGER REFERENCES marcas(id);

-- 6) comissao_fechamentos — antes de lancamentos, pela FK. Um por marca e
--    competência (YYYY-MM); aberto → aprovado → pago fora do sistema
--    (decisão 6: PIX/TED contra NF do revendedor, mínimo R$ 100).
CREATE TABLE IF NOT EXISTS comissao_fechamentos (
  id               SERIAL PRIMARY KEY,
  marca_id         INTEGER NOT NULL REFERENCES marcas(id),
  competencia      TEXT NOT NULL,
  valor_bruto      NUMERIC(10,2) NOT NULL,
  valor_comissao   NUMERIC(10,2) NOT NULL,
  qtd_lancamentos  INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'aprovado', 'pago', 'cancelado')),
  aprovado_em      TIMESTAMP,
  pago_em          TIMESTAMP,
  comprovante      TEXT,
  nota_fiscal_ref  TEXT,
  observacoes      TEXT,
  fechado_por_id   INTEGER REFERENCES users(id),
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE (marca_id, competencia)
);

-- 7) comissao_lancamentos — um por entrada de dinheiro (pedido de crédito
--    pago, fatura de plano paga), com o percentual VIGENTE naquele instante.
--    plan_changes é ledger de crédito, não de dinheiro; sem esta tabela a
--    comissão seria recalculada e mudaria junto com o percentual. Só ids —
--    nenhum CPF. O índice único parcial em (origem, origem_id) é o que torna
--    a reentrega do webhook do Asaas inofensiva.
CREATE TABLE IF NOT EXISTS comissao_lancamentos (
  id              SERIAL PRIMARY KEY,
  marca_id        INTEGER NOT NULL REFERENCES marcas(id),
  provider_id     INTEGER NOT NULL REFERENCES providers(id),
  origem          TEXT NOT NULL CHECK (origem IN ('credit_order', 'provider_invoice', 'estorno', 'ajuste')),
  origem_id       INTEGER,
  competencia     TEXT NOT NULL,
  valor_bruto     NUMERIC(10,2) NOT NULL,
  percentual      NUMERIC(5,2) NOT NULL,
  valor_comissao  NUMERIC(10,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'fechado', 'estornado')),
  fechamento_id   INTEGER REFERENCES comissao_fechamentos(id),
  descricao       TEXT,
  criado_por_id   INTEGER REFERENCES users(id),
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS comissao_lancamentos_origem_uq
  ON comissao_lancamentos (origem, origem_id)
  WHERE origem IN ('credit_order', 'provider_invoice');
CREATE INDEX IF NOT EXISTS idx_comissao_lancamentos_marca_comp ON comissao_lancamentos (marca_id, competencia);
CREATE INDEX IF NOT EXISTS idx_comissao_lancamentos_provider ON comissao_lancamentos (provider_id);

-- 8) marca_eventos — trilha obrigatória (decisão 15). O revendedor vai
--    suspender provedores, criar usuários de terceiros e mudar preço; o
--    superadmin age sobre a marca. Append-only, INSERT best-effort (nunca
--    derruba a ação), `detalhe` com redação de senha/token/pix antes de
--    gravar. ator_role registra quem fez (revendedor ou superadmin).
CREATE TABLE IF NOT EXISTS marca_eventos (
  id           SERIAL PRIMARY KEY,
  marca_id     INTEGER NOT NULL REFERENCES marcas(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  ator_role    TEXT NOT NULL,
  acao         TEXT NOT NULL,
  provider_id  INTEGER REFERENCES providers(id),
  detalhe      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marca_eventos_marca_data ON marca_eventos (marca_id, created_at DESC);

-- 9) Origem por marca no chat de visitante e no pedido de titular (LGPD).
--    Usados só na fase 5 (landing e cadastro sob a marca); entram aqui para
--    não abrir uma terceira migração. Nullable, inertes até lá.
ALTER TABLE visitor_chats ADD COLUMN IF NOT EXISTS marca_id INTEGER REFERENCES marcas(id);
ALTER TABLE titular_requests ADD COLUMN IF NOT EXISTS marca_id INTEGER REFERENCES marcas(id);
