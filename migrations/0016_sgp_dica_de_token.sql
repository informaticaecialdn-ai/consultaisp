-- A dica de autenticacao do SGP mandava o provedor pedir a credencial ao lugar
-- errado.
--
-- O catalogo dizia "Token e app_name obtidos com suporte SGP". Nao e: pela
-- documentacao publica da TSMX (metodo 02, "Token e App"), quem gera o par e o
-- PROPRIO provedor, dentro do SGP dele, em Administracao > Integracoes >
-- Tokens. Abrir chamado no suporte para pedir algo que esta a dois cliques
-- atrasa a integracao em dias e faz o provedor achar que depende de terceiro.
--
-- O mesmo cadastro tem duas armadilhas que a dica agora cita, porque as duas
-- devolvem 403 e nenhuma se parece com "credencial errada":
--   · o token nasce podendo ser restrito a hosts e rotas especificas;
--   · o token pode existir e estar inativo.
--
-- `app` nao e um nome livre: e o campo App do mesmo cadastro, e precisa ser
-- escrito igual, senao a autenticacao falha sem dizer qual das duas metades
-- nao bateu.
--
-- Idempotente: reescreve a linha do SGP para o texto final, rodando quantas
-- vezes for.

UPDATE erp_catalog
SET
  description = 'Sistema Gerencial de Provedores (TSMX). Auth: token + app no corpo da requisicao.',
  auth_hint = 'Gere em Administracao > Integracoes > Tokens, dentro do seu SGP. Use o Token e o App do mesmo cadastro, escritos igual. Deixe o token ativo e sem restricao de host/rota.'
WHERE key = 'sgp';
