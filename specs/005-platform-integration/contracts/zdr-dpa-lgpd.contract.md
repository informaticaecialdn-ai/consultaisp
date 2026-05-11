# Contract — ZDR + DPA + LGPD compliance

**Direction:** Operacional (Provedor.ai → Anthropic Commercial + Legal)
**Purpose:** Estabelecer base jurídica completa para uso de Anthropic como suboperador de dados pessoais (LGPD).

## 1. Solicitação Anthropic Enterprise + ZDR

### Email template (sales@anthropic.com)

```
Subject: Enterprise Tier + Zero Data Retention — Provedor.ai (Brazilian SaaS)

Hi Anthropic Sales,

We are Provedor.ai, a Brazilian SaaS for internet service providers (ISPs). We
operate 10 AI agents handling debt collection workflows for ISP customers,
processing PII (CPF, phone, financial data) under Brazilian data protection
law (LGPD).

Current usage:
- Production launch: May 2026
- Models: Haiku 4.5 (80%), Sonnet 4.6 (15%), Opus 4.7 (5%)
- Volume estimate Year 1: 500k-5M Messages API calls/month
- Stack: Direct Messages API with custom tool loops, Memory Tool client-side

We need:
1. Enterprise tier with **Zero Data Retention (ZDR)** for Messages API
2. Signed **Data Processing Agreement (DPA)** — Portuguese version preferred,
   GDPR-equivalent acceptable for LGPD equivalence (Art. 33)
3. Confirmation of sub-processors list (we publish in our privacy policy)
4. Volume-based commitment discount tiers
5. Custom rate limits (Tier 4+)

Constraints:
- Customer data must stay in US data residency (acceptable, BR not available)
- We cannot use Claude Console / Workbench for production (non-ZDR)
- We exclude Agent Skills, Files API, Code Execution, Batch API from our flows

Please share:
- ZDR onboarding process and timeline
- DPA template (we'll have legal counsel review)
- Pricing for committed annual spend $XXk-$XXXk
- Account executive contact

Best regards,
[name]
Provedor.ai
[email]
```

### Resposta esperada

- Anthropic AE response em 1-3 dias úteis
- DPA template em 1 semana
- Negociação volume discount: 1-2 semanas
- Setup ZDR (após contrato assinado): 1-3 dias

### Aprovação interna Provedor.ai

Antes de assinar:
- Custo committed spend cabe no budget
- Termos do DPA revisados por advogado especializado em LGPD
- Política privacidade atualizada e em revisão
- Contratos ISP com cláusula sub-processadores

## 2. DPA — campos críticos para conferir

Quando o DPA Anthropic chegar, validar:

### Cobertura LGPD

- DPA padrão Anthropic é GDPR-aligned. **LGPD equivalência:** Anthropic deve confirmar que os termos atendem LGPD via:
  - Cláusula explícita citando LGPD OU
  - Declaração de equivalência GDPR↔LGPD (Art. 26 LGPD ANPD reconhece países adequados; BR não está na lista de adequação UE, mas decisão ANPD aceita SCC quando contrato bilateral)
- Standard Contractual Clauses (SCC) UE—EUA: anexar como exhibit

### Bases legais (Anthropic como operador)

- Art. 5º VII LGPD: Anthropic = operador
- Art. 7º V: execução contrato (entre Provedor.ai e ISP) → válido
- Art. 7º IX: legítimo interesse (cobrança de fatura vencida) → válido com balancing test
- Art. 11 LGPD: para dados sensíveis (saúde mental se aparecer em conversa) → CDC + LGPD impede tratamento sem consentimento

### Sub-processadores

DPA deve listar:
- AWS (sub-processador principal Anthropic — US East, US West)
- Google Cloud Platform (Vertex AI quando aplicável)
- Cloudflare (edge/CDN)
- Outros que Anthropic usa para infra

Notificação prévia (30+ dias) para mudanças.

### Direitos do titular

- Acesso: Anthropic NÃO armazena com ZDR, logo direito é exercido contra Provedor.ai
- Correção/Deletação: idem
- Portabilidade: idem
- Right to object: Anthropic compromete não usar dados para treino (commercial API default)

### Notificação de breach

- Anthropic notifica Provedor.ai em <72h após confirmação
- Provedor.ai notifica ANPD em <72h
- Cooperação para incident response

### Auditoria

- Anthropic publica SOC 2 Type II + ISO 27001 em [trust.anthropic.com](https://trust.anthropic.com)
- Provedor.ai pode solicitar relatório anualmente
- Direito de auditoria in-loco geralmente restrito (typical SaaS DPA)

## 3. Política de Privacidade Provedor.ai

Criar `docs/legal/lgpd-policy.md` com seções:

### 1. Quem somos
Provedor.ai — SaaS para gestão financeira/cobrança de ISPs. Atua como **controlador** dos dados de uso da plataforma (admin do ISP) e **operador** dos dados de assinantes finais (tratamento delegado pelo ISP, controlador).

### 2. Que dados tratamos
- Dados dos administradores ISP: email, nome, telefone (controlador)
- Dados de assinantes finais: CPF, nome, telefone, endereço, histórico financeiro, comunicações via WhatsApp (operador)

### 3. Bases legais
- Execução contrato (Art. 7º V): cobrança de fatura, comunicação preventiva
- Legítimo interesse (Art. 7º IX): recuperação de inadimplência (com balancing test documentado)
- Cumprimento legal (Art. 7º II): retenção de audit logs para defesa em Procon/CDC/Anatel

### 4. Compartilhamento e sub-operadores
- **Anthropic, Inc.** (US) — provedor de IA, processamento de LLM. Tratamento de dados restrito a Messages API com ZDR ativo (dados não retidos após resposta). Sub-operadores Anthropic: AWS, Cloudflare, GCP.
- **Asaas** (BR) — gateway de pagamento Pix/boleto
- **Meta Platforms, Inc.** (US) — envio WhatsApp via Cloud API
- **Hostinger** (Lituânia/BR) — VPS de hospedagem
- ERPs do ISP (IXC, MK, SGP, Hubsoft, Voalle, RBX) — varia por ISP

### 5. Transferência internacional (Art. 33)
Dados são transferidos para EUA (Anthropic, Meta) sob:
- Garantia: Standard Contractual Clauses (SCC) UE-EUA aceita por equivalência LGPD
- Decisões de adequação ANPD quando aplicável
- Cláusulas contratuais específicas (DPA com cada operador)

### 6. Retenção
- Dados ativos: enquanto contrato ISP↔Provedor.ai vigente
- Audit logs (defesa Procon/Anatel): 5 anos (Art. 27 Anatel 765)
- Comunicações WhatsApp: 2 anos pós-cliente cancelamento (defesa civil)

### 7. Direitos do titular
- Acesso, correção, deletação, portabilidade, anonimização, informação sobre sub-operadores
- Exercer via `dpo@provedor.ai`
- Resposta em até 15 dias úteis

### 8. DPO
- Nome + email + telefone do Encarregado de Dados (Art. 41 LGPD)

### 9. Cookies / tecnologias
(N/A para Provedor.ai backend — apenas painel admin com cookies de sessão essenciais)

### 10. Atualizações
Versão + data. Notificação de mudanças via email aos admins ISP com 30 dias antecedência.

## 4. Cláusula contrato ISP↔Provedor.ai

Adicionar ao template de contrato Provedor.ai (e addendum aos existentes):

```
CLÁUSULA X — TRATAMENTO DE DADOS PESSOAIS (LGPD)

X.1. Para a execução do objeto deste Contrato, a CONTRATADA (Provedor.ai)
atuará como OPERADORA, conforme definido no art. 5º, VII, da Lei Federal nº
13.709/2018 (LGPD), realizando o tratamento de dados pessoais de titulares
indicados pela CONTRATANTE (ISP) — assinantes do serviço de internet — para
fins de gestão financeira, cobrança e comunicação.

X.2. A CONTRATADA poderá utilizar sub-operadores para a execução dos serviços,
incluindo, mas não limitado a:
  (a) Anthropic PBC (EUA) — processamento por inteligência artificial;
  (b) Asaas Gestão Financeira S.A. (Brasil) — processamento de pagamentos;
  (c) Meta Platforms, Inc. (EUA) — envio de mensagens via WhatsApp;
  (d) Hostinger International Ltd. (Lituânia) — hospedagem em servidor;
  (e) Demais sub-operadores listados na Política de Privacidade da CONTRATADA.

X.3. A CONTRATADA garante que mantém Acordos de Tratamento de Dados (DPA) com
todos os sub-operadores, com cláusulas equivalentes a esta. Eventuais
transferências internacionais (Art. 33 LGPD) são realizadas com Standard
Contractual Clauses ou garantias equivalentes.

X.4. A CONTRATADA implementa medidas técnicas e organizacionais apropriadas
(criptografia em trânsito e repouso, controle de acesso por providerId,
audit logs imutáveis, isolamento multi-tenant) para proteger os dados.

X.5. Em caso de incidente de segurança que envolva dados pessoais, a
CONTRATADA notificará a CONTRATANTE em até 48 (quarenta e oito) horas após
confirmação, fornecendo todas as informações relevantes para que a
CONTRATANTE possa cumprir suas obrigações de notificação à ANPD (Art. 48
LGPD).

X.6. A CONTRATANTE é responsável por informar seus assinantes sobre o
tratamento de dados, base legal e sub-operadores, em sua própria política
de privacidade. A CONTRATADA disponibiliza modelo de comunicação para uso
da CONTRATANTE.

X.7. Os direitos dos titulares (Art. 18 LGPD) serão atendidos conforme
solicitação dirigida ao Encarregado de Dados da CONTRATADA (dpo@provedor.ai),
em até 15 (quinze) dias úteis.
```

## 5. Comunicação ao assinante final

Template para política privacidade do ISP (eles publicam, Provedor.ai fornece):

```
COBRANÇA AUTOMATIZADA POR INTELIGÊNCIA ARTIFICIAL

Para melhorar nosso atendimento de cobrança, utilizamos a plataforma
Provedor.ai, que opera atendentes automatizados baseados em inteligência
artificial. Estes atendentes podem enviar lembretes de fatura via WhatsApp,
confirmar pagamentos e responder dúvidas sobre cobrança.

Para esse processamento, dados pessoais (CPF, nome, telefone, histórico
financeiro) são tratados por:
- [ISP] — controladora dos dados
- Provedor.ai — operadora de IA e gestão de cobrança
- Anthropic Inc. (EUA) — provedora de tecnologia de IA, com ZDR ativo
  (dados não retidos após processamento)
- Asaas — processamento de pagamentos
- Meta Platforms — envio de mensagens WhatsApp

Para exercer seus direitos LGPD, contate-nos em [contato@isp.com.br].

Para mais detalhes técnicos, consulte a política de privacidade da
Provedor.ai em https://provedor.ai/privacidade.
```

## 6. Mitigação plano B (se ZDR negado/caro)

Se Anthropic não aprovar ZDR (volume baixo) ou custo proibitivo:

### Mascaramento PII em prompts

`server/lib/pii-masker.ts`:

```typescript
export function maskCpf(cpf: string): string {
  if (cpf.length === 11) return `***.***.${cpf.slice(6,9)}-${cpf.slice(9)}`;
  if (cpf.length === 14) return `**.***.***/${cpf.slice(8,12)}-${cpf.slice(12)}`;
  return "***";
}

export function maskFirstName(full: string): string {
  return full.trim().split(/\s+/)[0]; // só primeiro nome
}

export function maskPhone(phone: string): string {
  return phone.replace(/(\d{4})(\d{4})$/, "****-$2"); // últimos 4
}

export function tokenizeCpf(cpf: string): string {
  // Hash determinístico via HMAC-SHA256 com TOKEN_SALT
  return "tk_" + crypto.createHmac("sha256", process.env.TOKEN_SALT!).update(cpf).digest("hex").slice(0, 16);
}
```

Bruno/Sofia/Helena recebem `{customerName: "João", customerTokenId: "tk_abc"}` em vez de `{customerName: "João Silva Pereira", cpf: "12345678901"}`. Resolução local quando precisa do CPF real.

### Estimativa de risco com mascaramento + sem ZDR

Probabilidade breach Anthropic × CPF mascarado pode ser reidentificado se atacante tem outros dados → baixa-média. Combinado com SOC 2 Type II + ISO 27001 da Anthropic, risco residual aceitável para LGPD.

## 7. Critérios de aceitação consolidados

- ✅ Email enviado para sales Anthropic
- ✅ DPA recebido e revisado por advogado
- ✅ Contrato Enterprise assinado
- ✅ ZDR confirmado no Console (settings)
- ✅ Política privacidade Provedor.ai publicada em `provedor.ai/privacidade`
- ✅ Template contrato ISP com cláusula X.1-X.7 incorporada
- ✅ 3+ contratos ISP existentes atualizados via addendum
- ✅ DPO designado (Art. 41) com email funcional
- ✅ Comunicação ao assinante final em template + política privacidade dos ISPs piloto
