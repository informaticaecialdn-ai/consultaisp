# Base de Conhecimento: Arquitetura de Agentes IA

> Referencia exclusiva para IANI (agente supervisora). Padroes de orquestracao multi-agente e boas praticas. Extraido e adaptado de skills MIT (aitmpl.com).

---

## PADROES DE ORQUESTRACAO

### Padrao ReAct Loop (Reason-Act-Observe)
Ciclo iterativo para execucao passo-a-passo:
1. **Thought**: Raciocinar sobre o que fazer em seguida
2. **Action**: Selecionar e invocar uma ferramenta ou agente
3. **Observation**: Processar o resultado
4. **Repetir** ate tarefa completa ou travada
5. **CRITICO**: Sempre definir limite maximo de iteracoes

Aplicacao Iani: Ao receber uma tarefa complexa (ex: "preparar campanha completa"), Iani deve:
- Decompor em subtarefas
- Atribuir cada subtarefa ao agente correto
- Coletar resultados
- Verificar qualidade antes de entregar
- Limitar a 10 iteracoes por tarefa

### Padrao Plan-and-Execute
Planejar primeiro, executar depois:
1. **Fase de Planejamento**: Decompor tarefa em etapas ordenadas
2. **Fase de Execucao**: Executar cada etapa via agente designado
3. **Replanejamento**: Ajustar plano baseado em resultados intermediarios

Aplicacao Iani: Para campanhas multi-canal:
1. Sofia define estrategia e segmentacao
2. Leo cria copys e conteudos
3. Marcos configura campanhas de paid media
4. Carla prepara sequencias de outreach
5. Iani revisa o conjunto e verifica consistencia

### Padrao Tool Registry (Registro Dinamico)
Gerenciamento dinamico de agentes disponiveis:
- Manter registro de capacidades de cada agente
- Selecionar agente mais adequado por tarefa
- Tracking de uso e performance por agente

**Registry de Agentes Consulta ISP:**
| Agente | Especialidade | Quando Acionar |
|--------|--------------|----------------|
| Carla | SDR, prospecao, cold outreach | Lead research, emails frios, follow-up, qualificacao |
| Lucas | Closer, negociacao | Demo scripts, handling objecoes, fechamento, propostas |
| Rafael | Consultor, diagnostico | Analise de necessidades, solucao tecnica, ROI, propostas consultivas |
| Sofia | Estrategia de marketing | Planejamento de campanha, metricas, posicionamento, pricing |
| Leo | Copywriting | Textos de vendas, emails, landing pages, anuncios, conteudo |
| Marcos | Paid media | Google Ads, LinkedIn Ads, Meta Ads, otimizacao de campanhas |

---

## ANTI-PADROES (O QUE EVITAR)

### Autonomia Ilimitada
- NUNCA deixar agente rodar sem limite de iteracoes
- Sempre definir max_iterations e timeout
- Se agente travar, escalar para humano

### Sobrecarga de Ferramentas
- Nao dar acesso a todas as ferramentas para todos os agentes
- Curar ferramentas por tarefa especifica
- Agente com muitas opcoes performa pior

### Acumulo de Memoria
- Nao armazenar tudo na memoria do agente
- Memoria seletiva — so o relevante para a tarefa
- Limpar contexto entre tarefas independentes

### Problemas Comuns e Solucoes

| Problema | Severidade | Solucao |
|----------|-----------|---------|
| Agente em loop sem limite de iteracoes | CRITICA | Sempre definir max_iterations (10-20) |
| Descricoes vagas de ferramentas/agentes | ALTA | Specs completas com exemplos |
| Erros de ferramenta nao surfaceados | ALTA | Handling explicito de erros |
| Armazenar tudo na memoria | MEDIA | Memoria seletiva e relevante |
| Agente com muitas ferramentas | MEDIA | Curar ferramentas por tarefa |
| Multiplos agentes quando 1 basta | MEDIA | Justificar multi-agente |
| Internals nao logados | MEDIA | Implementar tracing |
| Parsing fragil de outputs | MEDIA | Output handling robusto (JSON schema) |

---

## PROTOCOLOS DE SUPERVISAO (IANI)

### Verificacao de Qualidade
Antes de entregar qualquer output ao usuario/sistema:
1. **Consistencia**: Mensagem entre agentes esta alinhada? (tom, dados, promessas)
2. **Completude**: Todas as partes da tarefa foram cumpridas?
3. **Precisao**: Dados e numeros estao corretos?
4. **Tom**: Adequado ao contexto e persona?
5. **Acionabilidade**: O output e util e acionavel?

### Escalonamento
Quando Iani deve escalar para humano:
- Tarefa fora do escopo dos agentes
- Agente falhou 2+ vezes na mesma tarefa
- Decisao de alto impacto (preco, contrato, compromisso)
- Informacao insuficiente para prosseguir
- Conflito entre outputs de agentes diferentes

### Delegacao Inteligente
Regras para atribuir tarefas:
1. **Single-agent first**: Se 1 agente resolve, nao envolver 2
2. **Parallel when possible**: Tarefas independentes em paralelo
3. **Sequential when dependent**: Esperar output de A antes de acionar B
4. **Specialist over generalist**: Preferir o agente mais especializado
5. **Iani nao executa**: Iani orquestra, nao faz o trabalho operacional

### Metricas de Performance por Agente
Iani deve monitorar:
- Taxa de conclusao de tarefas
- Tempo medio por tarefa
- Taxa de erros/retrabalho
- Qualidade do output (scoring 1-5)
- Consistencia com brand voice
