# Revisão de microcopy e aviso LGPD — 08/09/2026

## Implementado
- Modal compartilhado entre Consulta ISP e Consulta Cadastral com finalidade específica por tela, descrição acessível, confirmação explícita e política de privacidade.
- Consulta ISP: referência de proteção do crédito (art. 7º, X), consistente com o rodapé existente. Cadastro mantém referência de legítimo interesse e direitos do titular.
- Removida afirmação genérica de anonimização do aviso. A confirmação é do operador e não se apresenta como consentimento do titular.
- Mensagens de ausência de dados distinguem falta de cobertura de ausência de registros nas fontes consultadas.
- Linha do tempo, guia de leitura, mensagens de CEP e erro de análise com linguagem direta.
- Cliente 360 e recuperação: retirada de termos de implementação em avisos operacionais.
- Controles compartilhados: Fechar, Anterior, Próxima, Paginação e Alternar menu lateral em português.

## Validação
Modal inspecionado em temas claro e escuro. Botão bloqueado sem confirmação e habilitado ao marcar a declaração; saída por Voltar testada. Nenhuma consulta executada ou crédito consumido. TypeScript: mesmos 58 diagnósticos preexistentes.

Referência legal consultada: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm

Escopo desta revisão: fluxos de consulta, avisos destacados de Cliente 360/recuperação e controles compartilhados; não constitui auditoria de todos os textos administrativos ou validação jurídica de todo o tratamento de dados.
