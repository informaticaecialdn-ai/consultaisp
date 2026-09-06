-- 0030 — o tempo do caso NA COLUNA: desde quando ele esta neste status (06/09/2026)
--
-- Pedido do dono: "o kanban precisa ser uma esteira de resolucao da cobranca".
-- Numa esteira o que importa e onde o trabalho EMPACA, e isso nao se ve sem
-- saber ha quanto tempo o caso esta parado na coluna. `updated_at` nao serve:
-- ele muda quando o valor da divida e recalculado, quando o responsavel troca,
-- quando a proxima acao e escrita — um caso parado ha 40 dias em "Negociando"
-- aparece como "mexido hoje". `status_desde` responde uma pergunta so, e o
-- storage a escreve em TODA transicao de status.
--
-- BACKFILL — E APROXIMACAO, NAO MEDICAO. Para as linhas que ja existem o
-- sistema nunca gravou essa data; ela e reconstruida do que ha:
--   * caso em `aberto`  -> `aberto_em` (o caso nasce aberto e, se nunca saiu
--     de la, o nascimento E a entrada no status: esse dado e exato);
--   * qualquer outro    -> `updated_at` (a ultima escrita conhecida no caso).
--     Aqui o numero e um PISO chutado: se o caso mudou de status em julho e o
--     job recalculou o valor ontem, o quadro vai dizer "1 dia" para um caso
--     parado ha dois meses. A partir desta migracao os numeros sao medidos;
--     os casos antigos so contam a verdade depois da primeira transicao.
--
-- A ordem importa: a coluna entra SEM default (senao o Postgres ja preenche
-- todas as linhas com now() e o backfill honesto nunca acontece), so depois
-- ganha o default para os inserts futuros.
--
-- Idempotente: aplica no boot da API (server/migrate.ts).

ALTER TABLE cobranca_casos ADD COLUMN IF NOT EXISTS status_desde timestamp;

UPDATE cobranca_casos
   SET status_desde = CASE WHEN status = 'aberto' THEN aberto_em ELSE coalesce(updated_at, aberto_em) END
 WHERE status_desde IS NULL;

ALTER TABLE cobranca_casos ALTER COLUMN status_desde SET DEFAULT now();
ALTER TABLE cobranca_casos ALTER COLUMN status_desde SET NOT NULL;
