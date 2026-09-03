-- O catalogo passa a ter DOIS planos: Gratuito e Profissional.
--
-- Decisao do dono em 03/09/2026: "so vai ter os dois planos que tem na landing
-- page". `basic` e `enterprise` saem do catalogo — nao aparecem em seletor, em
-- preco, em fatura nova nem em cadastro.
--
-- Em producao havia 5 provedores em `free`, 2 em `enterprise` (NsLink e O L I
-- Telecomunicacoes) e nenhum em `basic`. Os dois do Enterprise vao para
-- `pro`, tambem por decisao do dono. Isso e seguro porque:
--   · nenhuma fatura foi emitida ate hoje (`provider_invoices` vazia), entao
--     nao ha cobranca passada para recalcular;
--   · credito de plano nunca foi concedido automaticamente — quem creditava
--     era o superadmin, na mao — entao ninguem perde saldo nesta troca.
--
-- Deixar alguem em `enterprise` depois desta versao seria pior do que mover:
-- a chave nao existe mais no catalogo, e a tela renderizaria um plano sem
-- preco e sem rotulo.
--
-- Idempotente: rodar de novo nao encontra mais nenhuma linha.

UPDATE providers SET plan = 'pro' WHERE plan IN ('basic', 'enterprise');

-- O historico de troca de plano guarda o rotulo do que existia na epoca e NAO
-- e reescrito: `plan_changes` e registro do que aconteceu, nao do catalogo de
-- hoje. O mesmo vale para `provider_invoices.plan_at_time`, que e a foto do
-- plano no momento da emissao.
