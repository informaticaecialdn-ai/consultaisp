-- Numeracao de pedido de credito e de fatura por SEQUENCE, nao por COUNT(*)+1.
--
-- `getNextOrderNumber` e `getNextInvoiceNumber` liam COUNT(*) e somavam 1. Duas
-- compras simultaneas contam a MESMA quantidade de linhas e montam o MESMO
-- numero; como `credit_orders.order_number` e `provider_invoices.invoice_number`
-- sao UNIQUE, a segunda compra morre com erro de chave duplicada — o provedor ve
-- "erro ao criar pedido" sem nada de errado no cartao dele. O mesmo vale para
-- `generate-monthly`, que gera dezenas de faturas em sequencia enquanto alguem
-- pode estar criando uma fatura avulsa.
--
-- Uma SEQUENCE resolve porque nextval() e atomico e nao volta atras nem dentro
-- de transacao abortada. O FORMATO do numero nao muda: continua
-- CR-AAAAMM-0001 e NF-AAAA-000001, com o contador global (nao por mes/ano),
-- exatamente como o COUNT(*) produzia.
--
-- Nada de tabela e tocado aqui: so dois objetos novos.

CREATE SEQUENCE IF NOT EXISTS credit_orders_numero_seq;
CREATE SEQUENCE IF NOT EXISTS provider_invoices_numero_seq;

-- As sequences nascem em 1, mas a base ja tem pedidos e faturas numerados. Sem
-- este ajuste o primeiro nextval() devolveria 1 e o INSERT bateria no UNIQUE
-- contra uma linha de 2026 — a migracao consertaria a concorrencia e quebraria
-- a numeracao no mesmo passo.
--
-- O ponto de partida e o MAIOR entre a contagem de linhas (o que a formula
-- antiga usaria) e o maior sufixo ja gravado, para cobrir tambem base em que
-- algum pedido foi apagado: contagem menor que o ultimo numero emitido.
--
-- `WHERE NOT is_called` deixa o passo idempotente: se a migracao rodar de novo
-- numa base onde a sequence ja emitiu numero, ela NAO e rebobinada.
SELECT setval(
  'credit_orders_numero_seq',
  GREATEST(
    (SELECT COUNT(*) FROM credit_orders),
    COALESCE((
      SELECT MAX(substring(order_number FROM '([0-9]+)$')::bigint)
      FROM credit_orders
      WHERE order_number ~ '^CR-[0-9]{6}-[0-9]+$'
    ), 0)
  ) + 1,
  false
)
WHERE NOT (SELECT is_called FROM credit_orders_numero_seq);

SELECT setval(
  'provider_invoices_numero_seq',
  GREATEST(
    (SELECT COUNT(*) FROM provider_invoices),
    COALESCE((
      SELECT MAX(substring(invoice_number FROM '([0-9]+)$')::bigint)
      FROM provider_invoices
      WHERE invoice_number ~ '^NF-[0-9]{4}-[0-9]+$'
    ), 0)
  ) + 1,
  false
)
WHERE NOT (SELECT is_called FROM provider_invoices_numero_seq);
