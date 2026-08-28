-- Cidades que o provedor tira do mapa da carteira na mao.
--
-- O mapa ja corta sozinho por massa: cidade com menos de 20 clientes nao entra,
-- porque punhado de cliente e endereco avulso, nao praca. Mas o corte
-- automatico erra num caso especifico e comum — o endereco de cobranca numa
-- capital, que junta dezenas de clientes e passa o piso sem ser area de
-- atendimento. Na NsLink e Curitiba: 43 clientes, zero inadimplentes.
--
-- NAO e o contrario de cidades_atendidas. Aquela declara onde o provedor vende
-- e governa o modo Regionalizacao, que mostra dado de OUTROS provedores. Esta
-- so esconde ponto no mapa dele mesmo, e nao muda nada do que a rede ve.

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS cidades_excluidas_do_mapa text[] DEFAULT '{}'::text[];
