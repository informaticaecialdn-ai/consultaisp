-- providers.cnpj passa a guardar UMA forma so: os 14 digitos, sem pontuacao.
--
-- MEDIDO em producao em 05/09/2026. A tabela tem seis linhas e guarda DUAS
-- formas diferentes do mesmo dado:
--
--     id 1  22759562000156        14 digitos
--     id 4  10381484000209        14 digitos
--     id 6  23.864.873/0001-48    18 chars, MASCARADO
--     id 7  36.085.182/0001-98    mascarado
--     id 8  44.441.227/0001-48    mascarado
--     id 9  19.486.259/0001-12    mascarado
--
-- Quatro das seis estao mascaradas. A causa sao tres linhas vizinhas do MESMO
-- handler de cadastro (server/routes/auth.routes.ts): ele valida o CNPJ
-- NORMALIZADO, procura duplicata COMO DIGITADO e grava COMO DIGITADO. E
-- `getProviderByCnpj` compara com igualdade exata de string.
--
-- O QUE ISSO ABRE, e nao e cosmetico: quem se cadastrar digitando
-- "23864873000148" nao casa com a linha gravada como "23.864.873/0001-48". A
-- conferencia de duplicidade passa, e o indice UNIQUE tambem nao barra, porque
-- para o Postgres sao duas strings diferentes. Nasce um SEGUNDO provedor para a
-- mesma empresa. Num bureau que chaveia carteira, credito e alerta de
-- anti-fraude por tenant, a empresa passa a existir em dois lugares e nenhum
-- dos dois tem a base inteira. Hoje NAO ha duplicata (conferido: nenhum grupo
-- com mais de uma linha ao normalizar) — a brecha esta aberta e ainda nao foi
-- usada.
--
-- Esta migracao e a BASE do conserto, nao ele inteiro. Enquanto a coluna
-- guardar duas formas, comparar por igualdade exata continua errado, entao
-- normalizar so o argumento da consulta nao bastaria: ele acharia os 14 digitos
-- e continuaria cego para as quatro linhas mascaradas. O caminho de ESCRITA
-- (cadastro publico e edicao pelo superadmin) e tratado nas rotas.
--
-- Idempotente: a segunda passada nao encontra linha para mudar.

-- A COLISAO — e por que ela FALHA ALTO em vez de se resolver sozinha.
--
-- `cnpj` e NOT NULL UNIQUE. Se duas linhas normalizarem para o MESMO valor, o
-- UPDATE la embaixo estoura no indice e o processo nao sobe: migrate.ts aplica
-- as migracoes no boot, dentro de uma transacao. Em producao isso nao acontece
-- hoje, mas esta migracao roda em qualquer base — inclusive na de quem clonar o
-- projeto, e naquela em que alguem ja tenha usado a brecha descrita acima.
--
-- Escolher QUAL das duas linhas fica nao e decisao que uma migracao possa
-- tomar: as duas sao tenants com carteira, credito, consulta, equipamento e
-- alerta proprios. Fundir e escolher de quem se apaga a base. Manter as duas
-- com a mesma inscricao (derrubando o UNIQUE) e desistir justamente da garantia
-- que estamos aqui para restaurar. Renomear uma com sufixo inventaria uma
-- inscricao que nao existe na Receita. As tres saidas mudam dado de negocio sem
-- ninguem olhando, as 3h da manha, dentro de um boot — e nenhuma delas volta
-- atras depois.
--
-- Entao a migracao PARA e diz exatamente quais ids colidiram, para uma pessoa
-- decidir. O custo e um boot travado com uma mensagem precisa; a alternativa e
-- uma fusao silenciosa e irreversivel. Sem esta mensagem o operador veria so
-- "duplicate key value violates unique constraint providers_cnpj_key" e teria
-- de sair procurando quem sao os dois.
--
-- A migracao 0017 fez o oposto — RAISE NOTICE e elegeu sozinha a integracao ERP
-- que ficava — e estava certa: la o duplicado era CONFIGURACAO do mesmo
-- provedor, e havia criterio objetivo na propria tabela (credencial completa,
-- ultimo sync) para dizer qual era a de verdade. Aqui o duplicado e o TENANT, e
-- nao existe coluna que diga qual das duas empresas e a empresa.
DO $$
DECLARE
  colisoes TEXT;
BEGIN
  -- O `f` de dentro e a tabela COMO ELA FICA depois desta migracao, e nao a
  -- simples normalizacao de tudo: linha que nao vira 14 digitos fica como esta
  -- (ver o UPDATE), entao normaliza-la aqui inventaria colisao que a migracao
  -- nem chega a produzir — duas linhas "pendente" e "N/A" viram ambas vazio e
  -- travariam o boot por um empate que nunca vai existir na tabela.
  SELECT string_agg(g.cnpj || ' -> provedores ' || g.ids, ' | ' ORDER BY g.cnpj)
  INTO colisoes
  FROM (
    SELECT f.cnpj, string_agg(f.id::text, ', ' ORDER BY f.id) AS ids
    FROM (
      SELECT
        id,
        CASE
          WHEN regexp_replace(cnpj, '[^0-9]', '', 'g') ~ '^[0-9]{14}$'
            THEN regexp_replace(cnpj, '[^0-9]', '', 'g')
          ELSE cnpj
        END AS cnpj
      FROM providers
    ) AS f
    GROUP BY f.cnpj
    HAVING count(*) > 1
  ) AS g;

  IF colisoes IS NOT NULL THEN
    RAISE EXCEPTION 'CNPJ duplicado ao normalizar: %. A migracao 0020 nao continua.', colisoes
      USING HINT = 'Sao dois provedores para a mesma empresa, cada um com carteira, credito e '
        || 'historico proprios. Decidir qual fica (e o que fazer com a base do outro) e decisao '
        || 'de negocio: resolva os ids acima a mao e suba de novo.';
  END IF;
END $$;

-- So a linha que PRECISA mudar. Sem o `<>` no WHERE, o UPDATE reescreveria a
-- tabela inteira a toa — toda linha morta, todo indice remexido — para gravar
-- em quase todas exatamente o que ja estava la.
--
-- E so a linha que vira 14 digitos. Uma que nao tenha digito nenhum ("N/A", em
-- branco) normalizaria para string vazia: a coluna e NOT NULL, entao o vazio
-- passaria, e trocariamos um dado obviamente errado — que alguem consegue ler e
-- corrigir — por um vazio que nao diz mais o que foi digitado. Dado sujo fica
-- visivel; quem o conserta e uma pessoa, nao o boot.
UPDATE providers
SET cnpj = regexp_replace(cnpj, '[^0-9]', '', 'g')
WHERE cnpj <> regexp_replace(cnpj, '[^0-9]', '', 'g')
  AND regexp_replace(cnpj, '[^0-9]', '', 'g') ~ '^[0-9]{14}$';
