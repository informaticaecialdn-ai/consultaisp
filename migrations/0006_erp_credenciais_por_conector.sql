-- Credenciais que 4 dos 6 conectores exigem e que nao tinham onde morar.
--
-- O codigo inteiro ja as lia (buildConnectorConfig, SENSITIVE_FIELDS, o Zod da
-- rota, o handleSave da tela), mas erp_integrations nao as declarava. O Drizzle
-- montava `set "api_token" = $1` e descartava o resto sem erro: a tela aceitava
-- a contra-senha do MK, dizia "salvo", e o valor sumia.
ALTER TABLE erp_integrations
  ADD COLUMN IF NOT EXISTS mk_contra_senha text,
  ADD COLUMN IF NOT EXISTS client_id       text,
  ADD COLUMN IF NOT EXISTS client_secret   text,
  ADD COLUMN IF NOT EXISTS extra_config    jsonb;

-- Leva a contra-senha do MK para a coluna dela.
--
-- Sem coluna propria, a contra-senha do webservice era guardada em `api_user` —
-- o proprio conector documenta isso em server/erp/connectors/mk.ts:
--   "MK uses apiUser field to store the contra-senha (webservice password)"
--   config.mkContraSenha || config.apiUser || config.extra?.mkContraSenha
-- Funcionava, mas o campo "Contra-Senha Webservice" da tela lia mk_contra_senha
-- e aparecia SEMPRE vazio, como se nao tivesse salvado.
--
-- Copia o texto cifrado direto: `api_user` e `mk_contra_senha` estao os dois em
-- SENSITIVE_FIELDS e usam a mesma chave (PBKDF2 sobre SESSION_SECRET), entao o
-- valor decifra igual no destino. Decifrar aqui exigiria a chave, que o SQL nao
-- tem.
--
-- So MK, e so quando o destino esta vazio: em qualquer outro ERP `api_user` e
-- de fato o usuario da API (no IXC, por exemplo), e sobrescrever destruiria a
-- credencial. `api_user` fica onde esta — o conector segue caindo nele, entao
-- um rollback desta versao continua autenticando.
UPDATE erp_integrations
   SET mk_contra_senha = api_user
 WHERE erp_source = 'mk'
   AND nullif(btrim(coalesce(api_user, '')), '') IS NOT NULL
   AND nullif(btrim(coalesce(mk_contra_senha, '')), '') IS NULL;
