-- Uma integracao por provedor e por ERP. A tabela nunca teve isso, e agora ela
-- precisa.
--
-- `erp_integrations` nasceu sem UNIQUE em (provider_id, erp_source), e o upsert
-- do storage e um SELECT seguido de UPDATE-ou-INSERT em duas queries, sem
-- transacao. Enquanto so a tela do provedor escrevia, a janela entre as duas
-- queries era teorica. Nesta versao passam a existir DUAS rotas de escrita (a
-- do superadmin e o corte automatico por falhas), e a janela vira real: dois
-- salvamentos simultaneos do mesmo par gravam duas linhas.
--
-- Duas linhas nao dao erro em lugar nenhum — e esse e o problema. Todo mundo
-- que le a integracao faz `find(i => i.erpSource === source)`, que devolve a
-- PRIMEIRA que o banco entregar, e a ordem de um SELECT sem ORDER BY nao e
-- estavel. O provedor passa a ter uma credencial que "as vezes funciona": o
-- teste de conexao acerta a linha boa, o sync noturno pega a outra, e o corte
-- automatico pausa uma linha enquanto o scheduler segue rodando a irma.
--
-- A ordem aqui importa: limpar primeiro, indexar depois. Criar o indice com
-- duplicata no banco falha e derruba o boot.

-- ---------------------------------------------------------------------------
-- 1. Diz no log o que vai sair, antes de sair.
--
-- Depois do DELETE nao ha como pedir de volta: a tabela nao tem lixeira nem
-- coluna de exclusao logica. Entao os ids descartados vao para o log do boot,
-- onde ficam junto do backup do dia — se alguem reclamar de uma credencial que
-- sumiu, da para achar a linha no dump.
DO $$
DECLARE
  aviso text;
BEGIN
  SELECT string_agg(
           format('provider %s / %s: fica id=%s, sai %s',
                  provider_id, erp_source, vencedor, perdedores),
           E'\n')
    INTO aviso
    FROM (
      SELECT provider_id,
             erp_source,
             (array_agg(id ORDER BY pos))[1]                      AS vencedor,
             array_agg(id ORDER BY pos) FILTER (WHERE pos > 1)    AS perdedores
        FROM (
          SELECT id, provider_id, erp_source,
                 row_number() OVER (
                   PARTITION BY provider_id, erp_source
                   ORDER BY
                     (nullif(btrim(coalesce(api_url, '')), '') IS NOT NULL
                      AND nullif(btrim(coalesce(api_token, '')), '') IS NOT NULL) DESC,
                     last_sync_at DESC NULLS LAST,
                     is_enabled DESC,
                     id DESC
                 ) AS pos
            FROM erp_integrations
        ) r
       GROUP BY provider_id, erp_source
      HAVING count(*) > 1
    ) g;

  IF aviso IS NOT NULL THEN
    RAISE NOTICE E'[0017] integracoes ERP duplicadas encontradas:\n%', aviso;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Elege a linha verdadeira.
--
-- O criterio segue o que um operador chamaria de "a integracao dele", em ordem:
--
--   1) credencial completa (api_url E api_token preenchidos, AND e nao OR).
--      Linha sem os dois nao autentica em conector nenhum — nao e uma
--      integracao, e um rascunho. Nunca pode vencer de uma que funciona.
--   2) `last_sync_at` mais recente. E a unica prova, dentro da propria tabela,
--      de que aquela credencial chegou a falar com o ERP. Cheiro de teste ou
--      de tentativa abandonada e justamente nunca ter sincronizado.
--   3) `is_enabled`. Entre duas igualmente sem historico, a que o provedor
--      deixou ligada e a que ele espera que rode.
--   4) maior `id`. Empate so sobra quando as duas nasceram na mesma corrida;
--      ai vale a ultima escrita, que e a intencao mais recente de quem salvou.
--
-- Nao entra no criterio o `created_at`: ele e DEFAULT NOW() sem NOT NULL, entao
-- linhas antigas podem te-lo nulo, e duas linhas nascidas de uma corrida tem
-- praticamente o mesmo instante — desempataria por ruido de microssegundo.
--
-- ---------------------------------------------------------------------------
-- 3. Antes de apagar, resgata da perdedora o que a vencedora nao tem.
--
-- O caso que isso protege e concreto: o superadmin grava api_url + api_token
-- numa linha, e a outra linha ficou com o client_secret do Hubsoft ou a
-- contra-senha do MK que alguem digitou antes. Apagar direto perderia um
-- segredo que ninguem tem anotado, e o provedor voltaria a pedir a credencial
-- ao ERP dele. Cada coluna vazia da vencedora e preenchida com o primeiro
-- valor nao-vazio das perdedoras, na mesma ordem de eleicao acima.
--
-- Copia texto cifrado direto, sem decifrar: todas essas colunas usam a mesma
-- chave (PBKDF2 sobre SESSION_SECRET, ver SENSITIVE_FIELDS em
-- server/storage/erp.storage.ts), entao o valor decifra igual no destino — o
-- mesmo raciocinio da migracao 0006. Decifrar aqui exigiria a chave, que o SQL
-- nao tem.
--
-- NAO se resgata: `last_sync_at`, `last_sync_status`, `total_synced`,
-- `total_errors` e `status`. Sao a foto de UMA credencial em UMA execucao;
-- carregar o carimbo de sucesso da perdedora para a vencedora contaria uma
-- mentira ("essa credencial ja sincronizou"). O historico real de sync esta em
-- `erp_sync_logs`, que e por provedor e ERP e nao perde nada aqui.
WITH ranked AS (
  SELECT id, provider_id, erp_source,
         nullif(btrim(coalesce(api_url, '')), '')        AS c_api_url,
         nullif(btrim(coalesce(api_token, '')), '')      AS c_api_token,
         nullif(btrim(coalesce(api_user, '')), '')       AS c_api_user,
         nullif(btrim(coalesce(mk_contra_senha, '')), '') AS c_mk_contra_senha,
         nullif(btrim(coalesce(client_id, '')), '')      AS c_client_id,
         nullif(btrim(coalesce(client_secret, '')), '')  AS c_client_secret,
         nullif(btrim(coalesce(notes, '')), '')          AS c_notes,
         CASE WHEN extra_config IS NOT NULL AND extra_config::text NOT IN ('{}', 'null')
              THEN extra_config END                      AS c_extra_config,
         row_number() OVER (
           PARTITION BY provider_id, erp_source
           ORDER BY
             (nullif(btrim(coalesce(api_url, '')), '') IS NOT NULL
              AND nullif(btrim(coalesce(api_token, '')), '') IS NOT NULL) DESC,
             last_sync_at DESC NULLS LAST,
             is_enabled DESC,
             id DESC
         ) AS pos
    FROM erp_integrations
),
resgate AS (
  SELECT provider_id,
         erp_source,
         (array_agg(c_api_url         ORDER BY pos) FILTER (WHERE c_api_url         IS NOT NULL))[1] AS api_url,
         (array_agg(c_api_token       ORDER BY pos) FILTER (WHERE c_api_token       IS NOT NULL))[1] AS api_token,
         (array_agg(c_api_user        ORDER BY pos) FILTER (WHERE c_api_user        IS NOT NULL))[1] AS api_user,
         (array_agg(c_mk_contra_senha ORDER BY pos) FILTER (WHERE c_mk_contra_senha IS NOT NULL))[1] AS mk_contra_senha,
         (array_agg(c_client_id       ORDER BY pos) FILTER (WHERE c_client_id       IS NOT NULL))[1] AS client_id,
         (array_agg(c_client_secret   ORDER BY pos) FILTER (WHERE c_client_secret   IS NOT NULL))[1] AS client_secret,
         (array_agg(c_notes           ORDER BY pos) FILTER (WHERE c_notes           IS NOT NULL))[1] AS notes,
         (array_agg(c_extra_config    ORDER BY pos) FILTER (WHERE c_extra_config    IS NOT NULL))[1] AS extra_config
    FROM ranked
   WHERE pos > 1
   GROUP BY provider_id, erp_source
)
UPDATE erp_integrations e
   SET api_url         = coalesce(v.c_api_url,         r.api_url),
       api_token       = coalesce(v.c_api_token,       r.api_token),
       api_user        = coalesce(v.c_api_user,        r.api_user),
       mk_contra_senha = coalesce(v.c_mk_contra_senha, r.mk_contra_senha),
       client_id       = coalesce(v.c_client_id,       r.client_id),
       client_secret   = coalesce(v.c_client_secret,   r.client_secret),
       notes           = coalesce(v.c_notes,           r.notes),
       extra_config    = coalesce(v.c_extra_config,    r.extra_config)
  FROM ranked v
  JOIN resgate r
    ON r.provider_id = v.provider_id
   AND r.erp_source  = v.erp_source
 WHERE v.pos = 1
   AND e.id = v.id;

-- ---------------------------------------------------------------------------
-- 4. Apaga as perdedoras.
--
-- Seguro de fazer depois do UPDATE: a eleicao e reavaliada com o mesmo criterio
-- e devolve a mesma vencedora. Preencher coluna vazia da vencedora so pode
-- MELHORAR a posicao dela, e as chaves de desempate (last_sync_at, is_enabled,
-- id) nao foram tocadas.
--
-- Nada referencia `erp_integrations.id` — `erp_sync_logs` guarda provider_id +
-- erp_source, nao a FK — entao apagar a linha nao arrasta historico junto.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY provider_id, erp_source
           ORDER BY
             (nullif(btrim(coalesce(api_url, '')), '') IS NOT NULL
              AND nullif(btrim(coalesce(api_token, '')), '') IS NOT NULL) DESC,
             last_sync_at DESC NULLS LAST,
             is_enabled DESC,
             id DESC
         ) AS pos
    FROM erp_integrations
)
DELETE FROM erp_integrations
 WHERE id IN (SELECT id FROM ranked WHERE pos > 1);

-- ---------------------------------------------------------------------------
-- 5. Fecha a porta.
--
-- Com o indice, a corrida das duas rotas de escrita deixa de gerar linha
-- fantasma: o segundo INSERT simultaneo levanta erro em vez de duplicar em
-- silencio, e a rota devolve falha para quem salvou — que e o que se quer, ja
-- que uma falha visivel se resolve tentando de novo e uma duplicata invisivel
-- so aparece semanas depois como "as vezes o sync nao pega".
--
-- Idempotente de ponta a ponta: numa segunda execucao nao ha grupo com mais de
-- uma linha, o NOTICE nao dispara, o UPDATE e o DELETE nao encontram nada e o
-- IF NOT EXISTS ignora o indice ja criado.
CREATE UNIQUE INDEX IF NOT EXISTS erp_integrations_provider_erp_source_uq
  ON erp_integrations (provider_id, erp_source);
