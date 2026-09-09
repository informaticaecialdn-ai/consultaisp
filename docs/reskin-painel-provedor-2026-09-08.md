# Painel do Provedor — organização e reskin

## Categorias

| Categoria | Configurações | Cor |
| --- | --- | --- |
| Empresa e identidade | Dados da empresa, sócios, documentos, portal | Azul |
| Conexões e canais | ERP e sincronização, WhatsApp e chat | Verde-azulado |
| Cobrança e automação | Políticas de cobrança, agentes de IA | Violeta |
| Equipe e segurança | Usuários, proteção antifraude, acesso do suporte | Âmbar |
| Plano e consumo | Créditos e assinatura | Rosa |

As doze configurações foram preservadas. Acesso do suporte permanece oculto para operadores, e os componentes continuam aplicando suas permissões de leitura e escrita.

## Fluxo

- Navegação agrupada, com busca por assunto, sinônimos e serviços: CNPJ, Uazapi, WhatsApp, sócios, créditos.
- Página inicial orienta cadastro → integração → atendimento → políticas, sem inventar status de conclusão.
- Cada seção identifica a categoria e explica sua finalidade antes dos controles.
- Atividade da conta e resumo cadastral continuam disponíveis em uma seção recolhível.
- Seleção das categorias atualiza `?tab=`; URLs existentes para chat, cobrança e agentes continuam funcionando.
- Vinte e seis rótulos foram associados aos campos. Campos usam maior área de interação, foco visível, diferenciação de leitura e digitação; telefone tem tipo próprio e nova senha evita preenchimento automático de senha existente.
- Ação de salvar empresa permanece visível durante rolagem, com espaço para não coincidir com o botão flutuante de atendimento.
- Layout tem regras para telas estreitas, contraste e paleta específicos para claro/escuro. Verificação visual foi feita em desktop; não houve teste em dispositivo móvel físico.

## Verificações

219 testes passaram em sete arquivos, incluindo busca sem acentos, catálogo sem duplicatas, restrição do suporte, renderização dos gatilhos reais de abas e regressões existentes de cadastro, integração, chat, agentes e cobrança. Testes antigos que dependiam dos gatilhos estarem escritos diretamente na página foram adaptados para o catálogo compartilhado.

Build de frontend, API e worker concluído. Typecheck passou de 60 para 58 erros preexistentes, com correção de dois atributos inválidos de ícones; não há novos diagnósticos, mas o typecheck global ainda não está aprovado.

Conferência no navegador: página inicial, dados da empresa, busca por Uazapi abrindo WhatsApp e chat, campos rotulados e temas claro/escuro. Nenhum formulário real foi salvo, canal conectado, agente ativado, credencial alterada ou mensagem enviada.

Arquivos centrais: `client/src/components/painel/OrganizacaoPainel.tsx`, `organizacao-painel.css` e `client/src/pages/provedor/painel-provedor.tsx`.
