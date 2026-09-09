-- Entrada é recebível: nenhuma linha desta migração registra dinheiro recebido.
-- Rodar pelo migrador transacional, após backup; não aplicar como script avulso.

-- Acordos legados vivos ficam sujeitos a conciliação humana da entrada.
-- O estado separado impede a régua de quebrar o acordo por uma data retroativa.
INSERT INTO cobranca_parcelas (provider_id, negociacao_id, numero, valor, vencimento, status)
SELECT n.provider_id, n.id, 0, n.entrada,
       COALESCE(n.primeiro_vencimento, n.aceita_em::date, n.created_at::date, CURRENT_DATE),
       'conciliacao_pendente'
FROM cobranca_negociacoes n
WHERE n.entrada > 0 AND n.status IN ('proposta', 'aceita', 'ativa')
  AND NOT EXISTS (SELECT 1 FROM cobranca_parcelas p
                  WHERE p.provider_id = n.provider_id AND p.negociacao_id = n.id AND p.numero = 0)
ON CONFLICT (negociacao_id, numero) DO NOTHING;

INSERT INTO cobranca_eventos (provider_id, caso_id, customer_id, tipo, notas, metadata)
SELECT n.provider_id, n.caso_id, n.customer_id, 'nota',
       CASE WHEN n.status = 'cumprida'
         THEN 'Entrada de acordo legado sem confirmação individual: revisar comprovantes. O acordo cumprido foi preservado.'
         ELSE 'Entrada de acordo legado aguarda conciliação de comprovantes; o aceite não comprova recebimento.' END,
       jsonb_build_object('migracao', '0033', 'negociacaoId', n.id, 'entradaLegada', true,
         'origem', 'legado_sem_comprovante_individual', 'pendenteConciliacao', true,
         'valorEntrada', n.entrada, 'statusOriginal', n.status)
FROM cobranca_negociacoes n
WHERE n.entrada > 0 AND n.status IN ('proposta', 'aceita', 'ativa', 'cumprida')
  AND NOT EXISTS (SELECT 1 FROM cobranca_eventos e WHERE e.provider_id = n.provider_id
    AND e.caso_id = n.caso_id AND e.metadata->>'migracao' = '0033'
    AND e.metadata->>'negociacaoId' = n.id::text);

CREATE UNIQUE INDEX IF NOT EXISTS cobranca_recebimento_idempotencia_uq
  ON cobranca_eventos (provider_id, caso_id, (metadata->>'chaveIdempotencia'))
  WHERE tipo = 'parcela_paga' AND metadata->>'chaveIdempotencia' IS NOT NULL;

-- Ausência do registro transacional versaoAprovacao exige administrador no aceite.
-- Acordos cumpridos não são reabertos; não há backfill de parcela_paga/KPI.
