-- Procedencia da coordenada do cliente (shared/geo-precisao.ts).
--
-- O mesmo desenho do Provedor.ai (geo_precisao): sem saber de onde o ponto
-- veio, o mapa tinha de escolher entre plotar aproximacao como endereco exato
-- ou nao plotar. Com a coluna, o ponto de bairro aparece translucido e o popup
-- diz o que ele e.
--
-- Escrito a mao, como a 0009: `drizzle-kit push` e interativo. Coluna nova e
-- nula e nao e ambigua.
--
-- Valores: erp · endereco · logradouro · cep · bairro. Nulo = gravado antes
-- da coluna, ou origem desconhecida. Nao ha backfill de valor aqui de
-- proposito: quem quiser a procedencia dos pontos antigos replota
-- (script/replotar-coordenadas.ts), que e o que corrige os pontos errados.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS geo_precisao text;
