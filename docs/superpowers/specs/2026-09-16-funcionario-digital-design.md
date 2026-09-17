# Funcionária digital — os agentes do Provedor.ai atendendo como gente (v2)

**Data:** 16/09/2026 · **Pedido do dono:** "ajustes os agentes com as mesmas descrição e configurações
dos agentes do provedor.ai… os agentes precisam atender como um humano, não como um bot… é um
funcionário digital, veja no provedor.ai". **Autoridade:** decisões técnicas do arquiteto (regra do
dono de 05/09/2026); dinheiro, dado irreversível e escopo seguem com o dono.

**Fontes** (em `C:/Users/ADMINI~1/AppData/Local/Temp/claude/F--ConsultaISP/eda21a19-b548-41a4-9105-c53a071146b1/scratchpad/funcionario-digital/`):
`relatorio-provedor-ai.md`, `relatorio-consulta-isp.md`, `relatorio-fork.md`,
`inventario-adaptacao.md`, `personas/` (prompts finais do Provedor.ai e `exemplos-de-voz.md`),
`revisao-desenho.json` (52 achados da revisão adversarial da v1; a v2 incorpora todos os de gravidade
bloqueia/alta e os médios aceitos abaixo). Provedor.ai em `F:/Provedor.ai` (só leitura).

## 1. Por que hoje soa como bot (medido)

1. O texto ao cliente é do servidor ("O ERP informa R$ 150,00 em aberto na leitura de agora…", datas
   `2026-09-20`, "Sou o assistente virtual"); o texto do modelo é descartado (vps/008).
2. A conversa trava: "Identidade confirmada. Como posso ajudar?" encerra a rodada; confirmação vale 15
   min fixos; resposta certa após 5 min recebe erro; o `\?` do detector de pergunta nunca casa.
3. Transferência deixa o cliente em silêncio.
4. O fork assina `*NsLink Provedor*`, atribui ao dono, não mostra "digitando…" e pode inverter a ordem.
5. Abertura "Olá, sou o assistente virtual de NsLink. Posso falar com MARIA?".

## 2. Decisões

- **D1 — Apresentação = Provedor.ai.** Nome da persona, 1ª pessoa da empresa, nunca "assistente
  virtual". Perguntada se é robô/IA/pessoa (antes OU depois da identidade): confirma em uma frase que
  é atendimento automatizado com supervisão da equipe, oferece falar com alguém da equipe, retoma.
  Nunca nega ser automatizada, nunca afirma presença humana (escritório, almoço, "te ligo").
- **D2 — Personas.** `cobranca_ativos` ← **Clara** (Provedor.ai `workspace/clara.yaml`) até D+14 +
  bloco de negociação e tons por quadrante da **Bianca** (`cobranca/bianca.yaml`) a partir de D+15,
  sempre dentro das ofertas do servidor; `cobranca_ex_clientes` ← **Sofia**; `recuperacao_equipamentos`
  ← **Mariana** + brief de `provedor-recuperacao-ativos`. **Nomes:** os do dono (Clara, Leonora,
  Eduarda) — troca sistemática e testada (nenhum outro nome de persona no prompt de cada perfil;
  referências a outros agentes viram "a equipe"). O script aceita trocar para Sofia/Mariana.
- **D3 — Modelos.** Os três começam em `openai/gpt-4.1` (temperatura 0.3, como Sofia/Mariana/Bianca no
  Provedor.ai; hoje rodam em gpt-4o, que é mais caro). A Clara desce para `gpt-4o-mini` (configuração
  original dela) só se a bateria (§11) mostrar ação correta, data extraída, aprovação do verificador e
  latência p95 equivalentes. `maxTokens` 1000.
- **D4 — Prompt = Provedor.ai com adaptação cirúrgica versionada como dado** (§8).
- **D5 — Antes da identidade, o texto é do servidor.** Frases na voz da persona com 2–3 variações
  determinísticas por conversa. O modelo não escreve nada ao cliente nessa fase.
- **D6 — Depois da identidade, a funcionária escreve; o servidor confere.** Verificador com classes
  fechadas (§6). Mensagem recusada → texto de reserva humanizado; a AÇÃO nunca depende da mensagem.
- **D7 — Transferência com aviso por frase fixa** (sem prazo prometido), em melhor esforço, nunca
  quando o motivo impede contato ou houve falha de envio.
- **D8 — Envio como funcionária** (vps/010): lote ordenado de balões, sem assinatura, sem atribuir ao
  dono, com "digitando…".
- **D9 — Chave `funcionariaDigital.ativa` em `chat_bullq_integracoes.agente_config`** (fora do schema
  strict da autonomia, para a volta de deploy não desligar a autonomia). **Nasce desligada.** Desligada
  = fluxo atual melhorado (reservas humanizadas, sem `escrever`, sem `aiAgentId`). Liga por provedor
  depois da bateria e da leitura das conversas.
- **D10 — Identidade:** só os **4 últimos dígitos do CPF**; tentativas por cliente (3 em 24 h, 5 em 30
  dias); vale por **episódio** (expira após 6 h sem mensagem do cliente, teto 24 h); aceite de ACORDO
  exige identidade confirmada há ≤ 2 h (senão pede os dígitos de novo).
- **D11 — Vazão:** fila processa até 3 conversas em paralelo com try/catch por trabalho; trava de
  configuração só na leitura; fork aceita 3 planos simultâneos por organização.
- **D12 — Bateria em agentes de TESTE** na organização da NsLink (criados e apagados pelo script),
  espaçada abaixo do limite por minuto, com clientes fictícios; nunca os agentes vivos.

## 3. Fluxo da conversa

### 3.1 Abertura (sistema inicia; Evolution)
Dois balões, portados de `identidade.ts:389-390` (sem prova social):
1. "Oi! Aqui é a Clara, da NsLink 😊"
2. "Tô falando com a Maria? Pra sua segurança, antes de continuar, me confirma os 4 últimos dígitos do
   seu CPF? A gente nunca pede senha nem o CPF completo."
Primeiro nome capitalizado ("MARIA" → "Maria"); variações só de construção. Datafy continua com o
template aprovado. A checagem da abertura é própria (não amplia `textoNeutroAntesDaIdentificacao`,
que segue valendo para operador e template): lista fechada de emoji (só 😊), nome da persona e do
provedor removidos antes das checagens de dígito/vocabulário.

**Como os dois balões saem** (correção 2 da B5, 17/09/2026): com a chave D9 ligada e o agente do
perfil, o 1º abre a conversa e o 2º vai logo depois pelo lote do agente (vps/010), que põe o
"digitando…" e a ordem. Com a chave desligada — ou sem o agente — os dois vão **numa mensagem só**,
separados por linha em branco: pelo envio comum o 2º podia chegar antes do 1º (a fila de saída do fork
envia em paralelo) e sairia assinado pelo dono da organização. Risco que fica: com a chave ligada e o
fork sem o 010 (404/400 do lote), o 2º cai no envio comum e a ordem não é garantida.

**Com a autonomia desligada** (o padrão de todo provedor) a abertura é a mesma e pede os dígitos
(decisão da correção 2 da B5, 17/09/2026). A resposta vai direto ao atendente, que confere os 4 dígitos
pelo documento que o painel da conversa mostra (`PerfilDoCliente`) antes de falar de valor — a mesma
conferência que o servidor faria. Não há abertura sem desafio porque ela seria uma segunda voz fora do
verificador, e o atendente continuaria sem saber com quem fala. A conferência automática dos dígitos
no fluxo humano fica fora deste trabalho (§12).

### 3.2 Antes da identidade — triagem da mensagem do cliente (ordem)
1. Tipo: figurinha/reação/só emoji → ignora (sem resposta, sem transferência, não conta turno);
   áudio → frase pedindo para escrever (1ª vez) e transferência com aviso na 2ª; imagem/documento →
   transferência com aviso (`pagamento_informado`).
2. `numero_errado` (é engano, não conheço, troquei de número, não mora mais aqui, não sou essa pessoa)
   → frase de desculpa, sem convite; evento no caso + próxima ação "conferir telefone"; conversa vai à
   equipe em silêncio depois da frase.
3. `terceiro` (sou a esposa/marido/filho/filha/mãe/pai/irmão…, "dela", "dele", "em nome de") → frase
   pedindo para a pessoa titular falar; nunca confirma identidade nessa conversa sem os dígitos; não gasta
   tentativa.
4. `pediu_para_parar` (para/pare de mandar, não quero receber, me tira da lista, não me chama) → frase de
   encerramento + grava `nao_contatar` pelo caminho existente de preferências de contato.
5. `contesta_titularidade` (não contratei, não reconheço, sofri golpe, usaram meu nome, fraude) → frase
   neutra de encerramento; equipe em silêncio.
6. `pediu_pessoa` (quero falar com atendente/pessoa/humano, chama alguém) → aviso de transferência neutro.
7. `pergunta_robo` (robô, bot, IA, é gente?, é automático?, é gravação?, tem alguém aí?, chatgpt) →
   frase de confirmação (D1) + oferta de alguém da equipe + retoma o pedido dos dígitos.
8. `duvida_golpe` ("é golpe?", "como sei que é vocês?") → tranquiliza, nunca pedimos senha/foto/CPF
   completo, indica o canal oficial do provedor (site ou telefone do CADASTRO do provedor, se houver) e
   re-pede os dígitos.
9. `pergunta` sem dígitos ("quem é?", "é sobre o quê?", "oi?") → explicação neutra ("é sobre sua conta
   aqui com a gente") + pedido dos dígitos. Detector enxerga "?".
10. Dígitos: extrai tokens de exatamente 4 dígitos (`\b\d{4}\b`), ignorando datas, horas e valores. Algum
   confere → confirma e **continua a rodada** (§3.3) com o resto da mensagem como intenção. Há token de 4
   dígitos e nenhum confere → tentativa gasta + frase de erro gentil (variações). Sem token → não é
   tentativa (vai para o item 9/re-pedido).
11. Estourou tentativas → frase orientando canais oficiais; conversa à equipe em silêncio; nova
   identidade só com humano até o fim da janela.

Todas as frases desta fase vêm de `shared/chat-funcionaria-textos.ts` (§7) e passam, em teste, pelo
verificador de pré-identidade.

### 3.3 Depois da identidade
- **Confirmou agora:** a rodada segue: leitura AO VIVO do ERP e planejador com `escrever: true`,
  `identidadeRecemConfirmada: true` e o motivo do contato. Nesse turno, sem valor em R$ se o cliente não
  perguntou valor (o verificador recusa).
- **`exigeHumano` por categorias** (portado de `escalation.ts`): pedido explícito de pessoa; jurídico
  (procon, advogado, processar, processo judicial, justiça); vulnerabilidade grave (faleceu, falecimento,
  luto, internado, UTI, câncer, hospital); contestação formal; pagamento informado (já paguei, paguei,
  tá/está pago, foi pago, fiz/mandei o pix, pix feito, transferi, depositei, quitei, acertei, efetuei,
  passei no banco, comprovante, "pago dia N" com N ≤ hoje); devolução informada (devolvi, entreguei,
  retiraram). **Não transferem** e vão ao planejador: "golpe?" (desconfiança), pergunta de robô (D1),
  "desempregado"/"tô sem dinheiro" (objeção de capacidade), "pago dia N" com N > hoje, "pago amanhã/
  sexta/quando receber" (promessa).
- **Planejador escreve:** até 3 balões (itens com `\n\n` são divididos, máx. 3). O servidor executa a
  ação ANTES de enviar qualquer balão; se a ação falhar, nenhum balão da IA sai (transfere com aviso).
  - `responder`: balões verificados; reserva = `respostaControlada` humanizada.
  - `segunda_via`: busca e valida o instrumento primeiro; introdução da IA sem número e sem nomear o
    tipo de instrumento; balão do servidor com o instrumento (valor e vencimento da fatura certa).
  - `promessa` / `agendar`: o servidor resolve "dia N", dia da semana, "hoje/amanhã/depois de amanhã" e,
    no agendamento, "manhã" (09:00) e "tarde" (14:00) para a próxima data futura ≤ 90 dias
    (Brasília); o `data` do plano tem que ser uma dessas datas resolvidas da mensagem do cliente. A
    pergunta de confirmação precisa citar a data (dd/mm OU dia da semana correspondente) e, se citar
    valor/hora, igual à proposta.
  - `transferir`: aviso por frase fixa (§3.4).
- **"Sim" do cliente:** promessa/agendamento aceitam confirmação tolerante (sim, isso, pode, pode sim,
  pode anotar, fechado, combinado, confirmo, ok, beleza, certo, tá bom, perfeito, 👍) sem negação,
  pergunta ou número novo; o último balão enviado tinha que ser a pergunta de confirmação. **Aceite de
  acordo** mantém a função estrita (sim, aceito, confirmo, fechado; sem "mas", "só que", "?").
- **Confirmações gravadas** (promessa, agendamento, acordo): nova chamada do planejador com
  `allowedActions: ["responder"]`, `escrever: true` e `situacao: "promessa_registrada"` (etc.) com os
  dados gravados; o verificador libera afirmação de gravação só aqui e exige exatamente a data e o
  valor/hora gravados. Reserva humanizada.
- **Negociação:** a IA escreve a introdução (sem número); as linhas das opções seguem do servidor num
  balão próprio; parser de escolha tolerante ("quero a opção 1 dia 10/09", "a 2, dia 15").
- **Validade:** proposta e ofertas seguem o episódio (6 h); o "sim" relê saldo e revalida.
- **Turnos** contam por episódio; o limite nunca corta com proposta pendente; o corte usa aviso.

### 3.4 Aviso de transferência
Frases fixas por categoria, com variação e SEM prazo ("já já", "em instantes", "hoje ainda"): com a
equipe no horário (janela de contato da política) — "Vou pedir pra alguém da nossa equipe continuar com
você por aqui, tá?"; fora do horário — "…nossa equipe te responde por aqui a partir de <próxima abertura>".
Antes da identidade, versão neutra. **Não avisa** quando: motivo é `ErroGestao` (contestação aberta,
opt-out, cota), houve falha/incerteza de envio, rodada interrompida, fork/LLM fora, humano assumiu,
mensagem mais nova, autonomia pausada, `numero_errado`/`contesta_titularidade`/`pediu_para_parar` (já
tiveram a frase própria). O aviso passa por `comOrcamentoContato` dentro de try/catch e depois de
`marcar(job,'humano')`.

Precisões da correção 2 da B5 (17/09/2026):
- **Encerramento antes da triagem.** As transferências que correm antes da triagem — caso encerrado ou
  em acordo, agente fora, limite de rodadas — conferem a mensagem primeiro: número errado, pedido para
  parar e (sem identidade) contestação de titularidade recebem a frase própria e o silêncio, e o
  `nao_contatar` e o "conferir telefone" são gravados do mesmo jeito. Com a identidade vigente vale o
  critério de depois dela (só o número errado inequívoco).
- **Autonomia pausada no meio da rodada.** O aviso e a frase de encerramento releem `ativa` na hora do
  envio: pausada, nada sai pela conversa; a transferência, o `nao_contatar` e o "conferir telefone"
  acontecem do mesmo jeito.
- **Figurinha, reação e só emoji não cancelam o pedido anterior.** A regra "mensagem mais nova cancela"
  só conta a mensagem que pede algo (o 👍 conta quando é o "sim" de uma proposta esperando, com a
  identidade vigente). "Já paguei" + figurinha: a rodada do texto transfere com o aviso de pagamento, a
  da figurinha não faz nada.
- **O vínculo telefone↔conversa é conferido antes de qualquer transferência que fale com o cliente**:
  divergente, nada sai — nem aviso, nem frase de encerramento.

Precisões da revisão final (17/09/2026):
- **Tudo o que sai junto com uma transferência sai DEPOIS dela**: o aviso, a frase de encerramento (§3.2, itens 2,
  4, 5 e 11) e a confirmação do acordo registrado (§3.3). O lote do agente (vps/010) para quando `aiDisabledAt` é
  posterior a ele, e `transferir` desliga a IA: mandada antes, a frase era aceita e interrompida. Depois da
  transferência a conversa é conferida de novo (mesmo cliente, sem atendente, não encerrada; o PENDING da rodada
  vale), `ativa` é relida e a chave D9 decide a voz. O `nao_contatar` continua gravado depois da frase.
- **Terceiro declarado depois dos dígitos vai à equipe** (aviso genérico), na mensagem atual e nos pedidos
  anteriores: "sou a filha dela" e, na mensagem seguinte, "8909" não chegam ao ERP nem ao planejador.
- **O aceite da oferta da D1** ("prefiro falar com alguém da equipe", "pode ser alguém da equipe", "me passa pra
  equipe") é pedido de pessoa, antes e depois da identidade.
- **A primeira fala depois dos dígitos** (a reserva desse turno) agradece pelo primeiro nome e diz o assunto da
  carteira, sem número; com a pergunta de valor, o saldo lido entra no lugar do assunto.

## 4. Fork do Chat BullQ

Trabalho num clone descartável na VPS (`/tmp/fork-funcionaria`, a partir de `827abce`), nunca em
`/var/www/chat-bullq/chat-bullq-api`; `docker build --target builder` com tag própria + jest; patches por
`git format-patch`, LF, versionados em `integrations/chat-bullq/patches/vps/`.

### vps/009 — planejador (módulo ai-agents)
- `AGENT_PROMPT_MAX = 80000` (constante única; o planejador recusava acima de 8000).
- Pedido aceita `escrever?: boolean` (e `parsePlanRequest` aceita essa chave). Sem `escrever`, a resposta
  é byte a byte a do 008 (spec).
- Com `escrever`: SYSTEM próprio de redação (sem "não escreva"), a persona do agente numa **2ª mensagem
  system** rotulada como subordinada às regras, dados no user; envelope com ordem fixa `operation,
  allowedActions (ordem canônica), escrever, context, history`. `response_format: json_object`.
- Saída: `mensagens?: string[]` entra em `CAMPOS` de todas as ações; 1–3 itens, 1..600 cada, total ≤ 1200;
  sanidade no fork (URL, `{{ }}`, `[[ ]]`, `<…>`, meta-talk): **mensagens inválidas são DESCARTADAS**
  (o plano segue sem elas); só ação/data/valor/faturaId malformados recusam o plano. `resposta` opcional
  com `escrever` (padrão `acolher`).
- Timeout do LLM com `escrever` 25 s (sem: 12 s); até **3 planos simultâneos por organização** (teto
  global 100); limite por minuto 40.
- Preço do gpt-4.1 no cálculo de custo (entrada 2, cache 0,50, saída 8 USD/milhão) e log de
  `cached_tokens` (log só de correlação, nunca conteúdo).

### vps/010 — mensagens como agente + "digitando…"
- `POST /messages/agent-batch` `{ conversationId, aiAgentId, textos: string[1..4] }` (OWNER/ADMIN):
  agente da organização, não apagado, capability `autonomia_cobranca_controlada`, `!isActive &&
  !canRespondDirectly`; recusa se a conversa estiver atribuída a outro usuário humano (diferente de quem
  chama). Cria as mensagens com `senderName` = nome do agente, `metadata.aiAgentId`,
  `metadata.enviadoPorUserId` = quem chamou, **sem assinatura, sem pausar IA, sem atribuir**, aplica
  `containsMetaTalk`; enfileira UM job que envia os balões em ordem, cada um com "digitando…"
  (800 ms + 35 ms/caractere, teto 4 s) e, antes de cada balão, confere se a conversa foi atribuída a
  humano (para o restante). Resposta: ids e status.
- Evolution: `sendTypingIndicator` via `POST /chat/sendPresence/{instance}` `{ number, presence:
  "composing", delay }` com try/catch interno, timeout delay+2 s, `delay` igual à espera (nunca maior);
  falha de presença não impede o envio nem vira rejeição não tratada.

## 5. Consulta ISP — contratos

- `shared/chat-autonomia.ts`: `PedidoPlanoAutonomia.escrever?`; `PlanoRespostaSchema.mensagens?`
  (1–3); `resposta` segue opcional no schema.
- Cliente do fork: `planejarAutonomia` (timeout 45 s); `enviarComoAgente(org, conversationId, aiAgentId,
  textos)` → `POST /messages/agent-batch`.
- Compatibilidade: com a chave desligada nada disso é usado. Ligada: 400 de pedido recusado no
  planejador → repete sem `escrever` (reserva); 404/400 no `agent-batch` → envia pelo `enviarTexto`
  atual juntando os balões num só.

## 6. Verificador (`shared/chat-funcionaria-digital.ts`, puro)

`verificarMensagens(mensagens, ctx)` → `{ ok: true, mensagens } | { ok: false, motivo: CodigoRecusa }`
(`motivo` é enum; nunca texto, valor, nome ou telefone). Regras e vocabulário como DADO no mesmo
arquivo; casos negativos e positivos em teste, incluindo as frases do inventário e de
`exemplos-de-voz.md`.

**Normalização:** minúsculas, sem acento; nomes (persona, provedor, primeiro nome do cliente) removidos
antes das checagens de dígito e vocabulário.

**Sempre (fase pós-identidade; a pré-identidade não recebe texto do modelo):**
1. Forma: 1–3 balões, 1..600 caracteres, total ≤ 1200; sem lista/título/código markdown.
2. Sem URL, domínio solto (`.com`, `.br`, `wa.me`), e-mail; sem ≥ 8 dígitos seguidos; sem `{{ }}`,
   `[[ ]]`, `<…>`, `[…]`, nem rótulos de bloco importado ("MODO VALIDAÇÃO", "VOZ E ESTILO", "ESCADA",
   "uso interno").
3. Meta-talk: prompt, instrução, JSON, sistema interno, ERP, servidor, planejador, modelo de linguagem,
   LLM, GPT, OpenAI, token.
4. **Presença humana / negar automação:** "sou (uma) pessoa/humana/humano", "de carne e osso",
   "atendente de verdade", "não sou robô/IA/máquina/automático", presença física (escritório, almoço,
   café, "minha mesa", "meu turno", "te ligo"). Se a última mensagem do cliente tem radical de natureza
   do atendimento (rob, bot, ia, inteligen, automat, maquina, sistema, gravac, gente, pessoa, humano,
   alguem aí, chatgpt): exige confirmação (automatizad|sistema|digital|virtual|inteligência artificial|
   IA) e recusa resposta que comece com "não"/"claro que não".
5. **Ameaça:** negativ, SPC, Serasa, protesto, cartório, justiça, judicial, processar/processo judicial,
   advogado, nome sujo, polícia.
6. **Pedido de dado sensível** (padrão de frase com verbo de pedido): senha, foto, selfie, documento, RG,
   cartão, CPF completo. Menção negada ("a gente nunca pede senha") é permitida.
7. **Concessão** (descont, abat, juros, multa, isen, perdo, anist, abon, zerar, "tirar a", condição
   especial, parcel, vezes, grátis, de graça, sem custo, metade): só em `situacao: apresentar_ofertas`
   com ofertas existentes, e sem número.
8. **Consequência/garantia** (cort, suspen, bloque, deslig, religa, liber, desbloque, rescis, "não vai",
   "fica tranquil", "garanto", "pode ficar sossegad"): sempre recusada.
9. **Compromisso** em 1ª pessoa ou da equipe (te mando, vou enviar, vou pedir, vou verificar/conferir,
   te ligo, te lembro, te aviso, lembrete, o técnico vai/passa, a equipe vai, abro chamado, vou te
   passar, te retorno): só se a ação da rodada corresponder (transferir ↔ passar/pedir pra equipe;
   segunda_via ↔ mando/segue).
10. **Prazo/imediatez** (já já, em instantes, em minutos, daqui a pouco, rapidinho, hoje ainda, logo,
   "em N horas/dias", "até N dias úteis"): recusado.
11. **Quitação/devolução** (quitad, em dia, regulariz, tudo certo, não consta, desconsider, perdoad,
   recebemos o aparelho, pode ficar com, não precisa devolver, pagamento confirmado/caiu/compensado,
   baixa): recusado.
12. **Gravação** (anot, registr, agend, marq, lanç, salv, combinado, fechado, "fica pra", confirmad):
   só com `ctx.gravado` e exigindo exatamente os dados gravados.
13. **Números:**
   - valor monetário (R$ x, x,yy, "x reais", "x conto/pila") ∈ fatos/ofertas/proposta em centavos;
     marcador de dinheiro sem número analisável ao lado → recusa; "mil"/"k" após número → recusa;
   - número por extenso a partir de "quatro", cem/cento/mil/meia/metade/dobro/"por cento" → recusa;
   - data (dd/mm, dd/mm/aaaa, "dia N") ∈ datas dos fatos/proposta/ofertas; mês por nome, dia da semana,
     "próxim*", "semana que vem", "fim do mês" só se baterem com a data da proposta; "hoje/amanhã" só se
     algum fato tiver essa data;
   - hora (14h, 14h30, 14:00, "2 da tarde", meio-dia) só = hora da proposta;
   - inteiro seguido de vezes/x/parcelas/prestações/meses/boletos só ∈ ofertas; percentual ∈ ofertas;
   - valor e data na mesma frase vêm do MESMO fato; demais inteiros só 1–3;
   - no turno `identidadeRecemConfirmada` sem pergunta de valor do cliente: nenhum valor em R$.
14. **Equipamentos:** nenhum termo financeiro (valor, R$, multa, dívida, fatura, pagamento, cobrança).
15. **Repetição:** balão idêntico (normalizado) a um já enviado na conversa → recusa.

## 7. Textos do servidor (`shared/chat-funcionaria-textos.ts`)

Funções puras `(situacao, nomes, semente) → string[]` com 2–3 variações escolhidas deterministicamente
por `conversationId`, sem repetir a variação usada por último: abertura (2 balões), desafio, re-pedido,
explicação (pergunta), confirmação de robô pré-identidade, dúvida de golpe (com canal oficial opcional),
erro de dígitos, tentativas esgotadas, número errado, terceiro, parar, contestação de titularidade,
áudio, avisos de transferência (neutro pré-identidade; pós por categoria; no horário/fora),
e as **reservas pós-identidade** humanizadas de `respostaControlada`, proposta, confirmações gravadas,
segunda via (introdução) e negociação (introdução). Regras: primeiro nome capitalizado; datas dd/mm;
nada de "ERP", "leitura de agora", "assistente virtual"; "Aqui é a <persona>" só quando a funcionária
ainda não falou na conversa. Testes: todas as frases pré-identidade passam no verificador de
pré-identidade (§6 aplicado com lista fechada: nenhum termo de cobrança/contrato/equipamento, nenhum
dígito exceto "4" do desafio, nenhum pedaço do nome além do primeiro, nenhum endereço); todas as
reservas pós passam no verificador pós com os fatos do caso de teste.

## 8. Personas

- `integrations/provedor-ai/adaptacoes.json`: lista de adaptações (id, persona, trecho original, trecho
  novo ou remoção, motivo), a partir de `inventario-adaptacao.md` + as linhas de `f14` (lembrete, "te
  retorno hoje", "já já") + troca de nomes; aplicada sobre os textos de origem do Provedor.ai copiados
  para `integrations/provedor-ai/origem/` (verbatim, para o build não depender de `F:/Provedor.ai`).
- Blocos de runtime portados (adaptados): registro de voz e objeções de `client-context.ts` (inclusive
  `disclosure_ia`), degraus de `recusa.ts`, estilo WhatsApp; MODO VALIDAÇÃO não entra (pré-identidade é
  do servidor).
- Ativos: Clara (até D+14) + excertos da Bianca (negociação e tons por quadrante, a partir de D+15),
  marcados por faixa; o `context` do planejador passa `diasAtraso`, `quadrante`, `mesesDeCliente`,
  promessas anteriores do caso, primeiro nome e nome do provedor.
- Descrição = descrição do YAML passada pela mesma lista de adaptação (sem Bianca, Júlia, Diana, EV, CAC,
  LTV, MAC, reposição).
- Saída revisável: `integrations/provedor-ai/personas/<tipo>.md` (gerado; teste garante que o arquivo é
  o resultado do build). Também versionadas as personas ANTERIORES (as de `c68c5211`) para a volta.
- Testes: nenhum `{{`, `<…>`, `[…]`; nenhum nome de outra persona; nenhum termo proibido (ferramentas,
  JSON de saída, tabelas de desconto, negativação/suspensão/rescisão anunciadas, reposição); tamanho
  final ≤ `AGENT_PROMPT_MAX`.
- Casa (`promptDePrimeiroContato`): sai "assistente virtual"; entram D1 e as regras de redação;
  `LIMITES_DO_AGENTE.instrucoes` derivado (`AGENT_PROMPT_MAX − casa − avisos máx.`); recusa ao salvar
  quando o total passa, dizendo quantos caracteres faltam.
- Script `script/configurar-personas-provedor-ai.ts`: monta, grava, provisiona (modelo D3), liga
  skills como hoje, `--conferir` (sem banco), `--versao-anterior` (volta), `--nomes clara,sofia,mariana`.

## 9. Serviço (`chat-autonomia.service.ts` e vizinhos)

- **Fila:** `executarFilaAutonomia` com até 3 trabalhos em paralelo (conversas distintas), rodízio entre
  provedores, try/catch por trabalho (erro → `marcar(job,'humano')` e segue). Parada: sinal conferido
  entre trabalhos e antes do envio; rodada que não começou a enviar volta a `pendente`; espera máxima de
  15 s no desligamento.
- **Travas:** `config:` só para ler a configuração; reconfere `ativa`, a chave D9 e `estado.humano`
  antes do planejador e antes do envio. Trava da conversa mantida em volta das escritas de estado.
- **Histórico:** 12 itens, OUTBOUND consecutivos agrupados num item (≤ 1200), soma ≤ 14.000,
  `protegerHistorico`.
- **Envio:** um `comOrcamentoContato` por turno em volta do `enviarComoAgente` (chave ligada) ou do
  `enviarTexto` atual; qualquer balão já saído e falha depois → `incerto`, sem reenvio, transferência sem
  aviso.
- **Log:** etapas com tempo (ERP, planejador, envio) e idade do trabalho; recusa do verificador só com
  o código.

## 10. Testes (além dos citados)

- Literais que mudam: abertura com "assistente virtual" (`shared/chat-templates.test.ts`), C1/C3 com
  data crua, R2, SYSTEM do 008 no teste do patch (mantido para pedido sem `escrever`), literais da demo,
  `chat-agentes.service.test.ts`, `chat-ponte.service.test.ts`, `shared/cobranca/contato.test.ts`.
- Os `expect(cliente.enviarTexto).not.toHaveBeenCalled()` viram tabela motivo → avisa/não avisa.
- Identidade: "Maria Souza 8909 pago dia 20/09" confirma e segue; "1234" gasta tentativa; "pago dia 20"
  sem dígitos não gasta; tentativas persistem entre conversas; episódio de 6 h; "sim" 5 h depois não
  pede dígitos; acordo com identidade de 3 h pede dígitos.
- Fila: contestação, opt-out e cota transferem sem enviar e sem deixar trabalho preso; erro num trabalho
  não para os outros; salvar a chave com rodada em andamento funciona.
- Demo: os roteiros de `chat-simulado.ts` reescritos na voz nova e um teste que roda o verificador sobre
  eles (pré antes do "sou eu", pós depois).

## 11. Implantação, bateria e volta

1. Fork: aplicar 009 e 010 em `/var/www/chat-bullq/chat-bullq-api` (tags `antes-009`, imagem guardada),
   builder + jest, imagem, recreate, saúde.
2. Consulta ISP: suíte + tsc, deploy guardado (worker: esperar a fila ou pausar), demo.
3. Personas: script em produção com a chave D9 desligada (o fluxo atual já usa as personas novas só como
   "preferências" do planejador sem escrever).
4. **Bateria (D12):** agentes de teste (persona × modelo) na organização da NsLink, clientes fictícios,
   ≤ 10 chamadas/min: abertura; "pode"; "quem é?"; "é golpe?"; "você é robô?" (antes e depois);
   dígitos; "quanto devo?"; "manda o pix"; "pago dia 20"; "pago sexta"; "tô desempregado"; "já paguei";
   "quero falar com alguém"; ex-cliente contestando multa; equipamento "já devolvi" e "pode buscar sexta
   de manhã". Mede: ação correta, data extraída, aprovação do verificador, latência p50/p95, tokens e custo
   por conversa, por modelo. Saída fora do repositório e dos logs. Agentes de teste apagados no fim.
5. Ligar a chave D9 na NsLink depois de ler as conversas.
6. **Volta:** desligar a chave (imediato) → `--versao-anterior` das personas → imagem `antes-009` do fork
   → deploy anterior do Consulta ISP.

## 12. Fora deste trabalho
- A resposta ao pré-aviso preventivo segue indo à equipe (agora com aviso) — **depois da identidade**
  (escolha da correção 1 da B5, 17/09/2026): a abertura humanizada pede os 4 dígitos, e é o servidor que os
  confere (triagem e desafio do §3.2) antes de a equipe receber a conversa. Mandar direto fazia o cliente que não
  deve nada digitar parte do CPF sem ninguém conferir; uma abertura sem desafio só para o pré-aviso abriria uma
  segunda voz fora do verificador. Telefone divergente vai à equipe sem aviso, como em qualquer conversa.
- Conferência automática dos 4 dígitos com a autonomia DESLIGADA: a abertura os pede (§3.1) e quem confere é o
  atendente, pelo documento no painel da conversa.
- SMS/e-mail da régua.
- Caminho que execute a autonomia dentro da demo.
