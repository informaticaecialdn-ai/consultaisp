# Revisão dos dados do Cliente 360

## Achados e ajustes

1. Carteira rotulava score ISP (0–1.000) como saúde, enquanto o 360 calcula saúde operacional (0–100). Agora rótulos e escalas distinguem os indicadores.
2. O 360 ainda entregava o default de score do cadastro como crédito calculado. A resposta e a entrada do cálculo agora usam a mesma validação `ispScoreReal` da carteira.
3. Rodapé do card mostrava crédito, propensão e mensalidade vazios, com explicações antigas. Agora exibe indicadores somente quando presentes e prioriza a próxima ação do caso.
4. Leitura parcial do ERP podia alimentar a remontagem da ficha como completa. Agora é sinalizada e não substitui a ficha sincronizada.
5. Novo painel de confiabilidade compara saldo/atraso da base com a consulta ao ERP; indica atualização ausente/antiga, data de contrato ausente, falta de contatos e nome corrompido. Não altera nomes nem presume o caractere perdido.

## Evidência local

A leitura agregada desta base encontrou 274 clientes, 268 com o par padrão de score e 274 sem `last_sync_at`. Nenhum nome local continha U+FFFD. Portanto, não foi possível reproduzir os mesmos nomes das imagens nem afirmar que a codificação na origem foi corrigida. A detecção sinaliza esses registros quando retornados.

Sem migração e sem alteração de dados financeiros/cadastrais. Não houve consulta paga a bureau, mensagens ao cliente ou mudança de contratos. Testes incluem diagnóstico, arredondamento de moeda e regressões de ficha/rotas.
