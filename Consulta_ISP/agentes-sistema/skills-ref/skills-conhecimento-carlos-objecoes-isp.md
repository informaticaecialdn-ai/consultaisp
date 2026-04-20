# CARLOS / LUCAS — Objecoes Comuns de ISPs (Playbook)

Skill pra lidar com as 10 objecoes mais comuns de donos de provedor de
internet contra plataforma colaborativa de credito (Consulta ISP).
Cada objecao: diagnostico, resposta curta pra WhatsApp (max 3 frases,
sem markdown), e follow-up sugerido.

---

## 1. "Ja uso Serasa / SPC / Boa Vista"

Diagnostico: lead ja tem ferramenta generica. Acha que substitui. Nao entende
o diferencial (dados colaborativos entre ISPs da regiao).

Resposta:
> Faz sentido. O Consulta ISP nao substitui — complementa. Enquanto Serasa
> mostra dividas publicas, a gente mostra quem deu calote em outros provedores
> da sua regiao nos ultimos 12 meses. Costuma pegar 30-40% dos casos que
> Serasa nao viu. Voce topa ver um exemplo real de CPF da sua cidade?

Follow-up: demo com CPF real de uma cidade proxima mostrando diferenca.

---

## 2. "Nunca tive calote aqui"

Diagnostico: ou ta mentindo, ou e pequeno (<100 clientes) e e sorte. Calote
medio ISP BR: 3-5% da base/ano. Se ele afirma 0%, provavelmente nao esta
medindo direito.

Resposta:
> Show. Voce sabe me dizer qual o % de inadimplencia medio seu hoje? Quase
> todo provedor que fala "nao tem" ta medindo no mes — ai parece pouco. No
> acumulado do ano o numero costuma surpreender. Qual teu controle hoje?

Follow-up: pedir dados ERP (IXC/MK) pra calcular real % junto.

---

## 3. "E caro / nao tenho verba"

Diagnostico: ou e pequeno de verdade (plano Gratuito cobre), ou nao viu
o ROI. Precisa traduzir em numeros.

Resposta:
> Comeca gratis — 30 consultas/mes, sem cartao. Se impedir 1 calote de R$200
> por mes ja pagou o Basico (R$149). Voce topa testar free por 30 dias e a
> gente conversa no fim?

Follow-up: cadastrar no plano gratuito, agendar follow-up em 30d.

Se resistir: usar `create_proposal` com plano Gratuito = R$0.

---

## 4. "Minha base e pequena, nao compensa"

Diagnostico: real ou percebido. ISPs <300 clientes podem achar que
ferramenta e pra grandes. Precisa mostrar que nao.

Resposta:
> Pequeno e exatamente quando 1 calote dói mais. Voce perde um cliente de
> R$99/mes + o equipamento de R$400 + instalacao, e nao consegue absorver
> como os grandes. O plano gratuito cobre seu volume. Qual sua base hoje?

Follow-up: plano gratuito + case study ISP pequeno da regiao.

---

## 5. "Precisa integrar com meu ERP? Que ERP?"

Diagnostico: medo tecnico. Ou usa ERP exotico, ou teve ma experiencia com
integracao antes.

Resposta:
> Suportamos IXC, MK, SGP, Hubsoft, Voalle, RBX direto via API. Se usa outro,
> vai via CSV (upload mensal). Nada de instalar software no seu servidor.
> Qual ERP voce usa?

Follow-up: `enrich_lead({erp: '...'})` + se suportado, marcar handoff Lucas
com note "pronto pra integracao direta".

---

## 6. "Dados dos meus clientes vao pra base compartilhada? LGPD?"

Diagnostico: objecao LGPD real + legitima. Precisa de resposta precisa,
nao genérica.

Resposta:
> Pergunta importante. A base compartilhada entre provedores e mascarada —
> so nome parcial, faixa de valor, endereco sem numero. Nenhum CPF ou dado
> pessoal completo e exposto entre provedores. Esta no art 7 IX da LGPD
> (legitimo interesse pra credito). Quer que eu mande o termo tecnico?

Follow-up: enviar documento LGPD (PDF) — se temos, agendar envio
(`schedule_followup({motivo: "Enviar termo LGPD"})`)

---

## 7. "Sou tecnico, comercial nao e comigo, fala com meu socio"

Diagnostico: nao e decisor (Authority do BANT = falha).

Resposta:
> Claro. Passa o WhatsApp do seu socio comercial que eu explico direto pra
> ele. Ou se preferir, posso te mandar 1 texto curto pra voce encaminhar
> — qual funciona melhor?

Follow-up: se aceitar, criar NOVO lead com numero do socio + `mark_unqualified`
nesse com motivo=`nao_decisor` e detalhes do socio real.

---

## 8. "Ja vi isso antes, nao funcionou"

Diagnostico: experiencia negativa passada. Ou era servico diferente, ou
base colaborativa era rala.

Resposta:
> Entendo a desconfianca. Posso saber qual ferramenta voce testou e o que
> especificamente nao funcionou? Geralmente o problema e base pequena na
> regiao — se nao tem outros provedores la, nao ajuda mesmo. Hoje temos [X]
> provedores em [sua regiao], nao sei se na epoca tinha.

Follow-up: se mencionar ferramenta concorrente, logar em
`enrich_lead({observacoes: "testou X no passado"})`. Se regiao e ponto
fraco, reconhecer honesto: "hoje ainda sao [N] provedores na sua regiao,
a base melhora quanto mais entram — so voce entrando ja muda".

---

## 9. "Vou pensar, me manda material"

Diagnostico: cortesia pra encerrar. 90% nao vai ler material. Mas 10% vai.

Resposta:
> Tranquilo. Te mando um 1-pager de 2 minutos de leitura — e vou te retornar
> na [dia+3d] pra ouvir sua duvida, pode ser? Se nao quiser que eu volte e
> so me avisar.

Follow-up: `schedule_followup({em_horas: 72, motivo: "pedido material"})`.
Nao forca. Se nao responder na tentativa 2, `mark_unqualified({motivo: "nao_respondeu"})`.

---

## 10. "Parece golpe. Quem sao voces?"

Diagnostico: desconfianca genuina (golpistas copiam cold outbound).

Resposta:
> Super justo desconfiar. Site: consultaisp.com.br, CNPJ no rodape. A gente
> ta em MG, SP, RS, PR, GO. Pode me pesquisar no Reclame Aqui antes, nao
> tem pressa. Se quiser, agendo um call de 15min por Google Meet pra voce
> ver uma pessoa real.

Follow-up: `schedule_followup({motivo: "agendar call confianca"})` +
`enrich_lead({observacoes: "pediu prova de legitimidade"})`.

---

## Regra geral

- **Se objecao repetida 2x** na mesma conversa = nao vai converter agora,
  `mark_unqualified(destino: nurturing)`.
- **Se agente nao sabe a resposta** = NAO invente. "Deixa eu confirmar
  isso com o time e te respondo em 1h" + `notify_operator`.
- **Se lead fica agressivo** = nao revidar. "Entendi, vou respeitar seu
  tempo. Se mudar de ideia, e so me chamar." + `mark_unqualified`.

---

## Filtro: Revendas de operadora (Vivo/TIM/Claro/Oi) — NAO sao lead

Atencao: o produto Consulta ISP e pra **ISPs regionais proprios** (que
tem base propria de assinantes e sofrem com inadimplencia). Revendas ou
"lojas autorizadas" de grandes operadoras **NAO sao publico-alvo** porque:
- Nao tem base propria — sao canal de venda da operadora
- Nao sofrem com inadimplencia residencial direta
- Nao decidem ferramenta de credito propria

Sinais de revenda (rejeita no primeiro turno):
- Nome contem "Vivo Fibra", "TIM Live", "Claro Net", "Oi Fibra"
- Nome contem "Autorizada", "Autorizado", "Revendedor", "Loja"
- Site redireciona pra dominio oficial de operadora
- Menciona "multimarca" ou "ponto de venda"

Acao: **chama `mark_unqualified({motivo: "fora_icp", detalhes: "revenda de operadora"})`**
imediatamente. Nao continua a conversa.

Exceção: provedor que TEM base propria MAS tambem revende pacote Vivo
(ex: "BrasNet + Vivo Fibra") e cliente legitimo — nesse caso continua normal.

---

## ERP usado pelo provedor — descobrir cedo

Perguntar o ERP e util porque:
1. Temos integracao direta com IXC, MK, SGP, Hubsoft, Voalle, RBX
2. Provedor que usa ERP suportado = onboarding 10x mais rapido
3. Ajuda a dimensionar (ERPs grandes como IXC/MK = provedor maior)

Se o enricher automatico ja detectou (lead.erp preenchido), USE isso no pitch:
> "Vi que voces usam [IXC Soft], temos integracao nativa — setup em 1 dia."

Se NAO esta preenchido, pergunta naturalmente no 2o-3o turno:
> "Voce usa algum sistema de gestao pra controlar os planos — IXC, MK,
>  SGP, ou alguma coisa propria?"

Ao descobrir, chame `enrich_lead({erp: "ixc"})` (ou "mk", "sgp", "hubsoft",
"voalle", "rbx", "outro").

Se resposta for "Excel" ou "nenhum sistema" = provedor bem pequeno (<50
clientes). Continua conversa mas sabe que e plano Gratuito, nao Profissional.

---

## Sinais de que passou da hora de desistir

Descartar (`mark_unqualified`) quando:
- Lead respondeu "nao, nao e agora" em 2+ turnos
- Lead claramente nao e decisor E nao passou contato do decisor
- Lead hostil/grosseiro
- Lead desaparece >7d depois de inicialmente engajado (→ followup worker ja
  trata, apos 2 tentativas sem resposta vai pra nurturing)
