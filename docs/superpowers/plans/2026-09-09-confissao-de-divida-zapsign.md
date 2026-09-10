# Confissão de dívida (CPC 784) com ZapSign — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dentro do módulo de cobrança, emitir, acompanhar e guardar um instrumento particular de confissão de dívida assinado eletronicamente pelo devedor via ZapSign, com os valores lidos do acordo aceito ou do ERP ao vivo — nunca digitados.

**Architecture:** três tabelas novas (integração por provedor com token cifrado; a confissão com a foto canônica da dívida, o hash e o estado por signatário; os PDFs fora da linha principal). O texto padrão é puro e determinístico em `shared/`; o servidor gera o PDF (pdfkit), fala com o ZapSign por um conector sem estado, emite sob trava e idempotência, recebe o retorno por webhook autenticado por cabeçalho e **sempre reconsulta** o ZapSign antes de dar um documento como assinado; um worker reconcilia o que não teve retorno. As telas (360, kanban, lista, Painel do Provedor, ficha do provedor no superadmin) só refletem o estado que o servidor guardou.

**Tech Stack:** Express 5 + Drizzle + PostgreSQL 16 (migração SQL idempotente aplicada no boot), React 18 + TanStack Query + wouter, Zod, vitest (testes de fonte para `.tsx`, pg-proxy de mentira para storage), `pdfkit` (dependência nova de produção), `fetch` nativo para o ZapSign.

**Spec:** `docs/superpowers/specs/2026-09-09-confissao-de-divida-zapsign-design.md` (v2, com as decisões 2.2 adotadas como padrão). O plano argumenta a partir da spec; quem executa lê os dois.

## Global Constraints

- **Multi-tenant absoluto:** toda tabela nova tem `provider_id` FK `providers.id`; toda consulta filtra por `providerId`; o id de outro tenant nunca sai em payload.
- **Migração:** arquivo `migrations/0037_confissao_de_divida_zapsign.sql`, tudo `IF NOT EXISTS`, **sem `BEGIN`/`COMMIT`** (o runner `server/migrate.ts` envolve cada arquivo na transação dele). Só a API migra; o worker confere (`verifySchema`).
- **`shared/schema.ts` muda** — autorizado pela spec §5 ("`shared/schema.ts` ganha as três tabelas"), aprovada pelo dono em 09/09/2026. Nada além das três tabelas, seus índices, insert schemas e tipos.
- **Fachada:** todo método público de `AssinaturaStorage` tem de estar delegado em `DatabaseStorage` (`server/storage/index.ts`) — `storage-fachada.test.ts` falha se faltar um.
- **Nada inventado:** todo número vem de `cobranca_parcelas` (acordo) ou de `snapshotAoVivoDoCliente` com `ok && encontrado && !leituraParcial`; sem leitura ao vivo **não se emite**; nunca cair para a base sincronizada.
- **Ação sensível exige admin:** emitir, cancelar, reenviar e marcar o modelo como revisado passam por `podeAdministrarOProvedor` (403 `{ message: "Apenas administradores podem …", code: "APROVACAO_OBRIGATORIA" }`); superadmin só em janela de suporte.
- **Segredos:** `api_token` cifrado com `encryptField` (`server/utils/crypto.ts`); `webhook_secret` = `crypto.randomBytes(32).toString("base64url")`, regenerado quando token ou ambiente mudam; **nenhum GET devolve token nem segredo**; as rotas de configuração entram em `ROTAS_SEM_CORPO_NO_LOG`.
- **ZapSign (doc conferida em 09/09/2026):** produção `https://api.zapsign.com.br/api/v1`, sandbox `https://sandbox.api.zapsign.com.br/api/v1`; `Authorization: Bearer {api_token}`; `POST /docs/` (base64_pdf), `POST /models/create-doc/`, `POST /docs/{token}/add-signer/`, `GET /docs/{token}/` (`status` pending|signed, `signers[].status` new|link-opened|signed, links de arquivo expiram em 60 min, `deleted`, `sandbox`), `DELETE /docs/{token}/`, `POST /user/company/webhook/` (`url`, `type: ""`, `doc_token`, `headers: [{name,value}]` — a doc aceita os cabeçalhos **na criação**, então o plano os manda ali e não pelo endpoint `/webhook/header/`), `DELETE /user/company/webhook/delete/` (`{ id }`), `POST /docs/{token}/resend-notifications-bulk/` (sem corpo; 429 com espera restante; só signatários pendentes), `GET /docs/?page=1` (teste do token). **Não há HMAC.** Custos: `tokenWhatsapp`/`certificadoDigital` 5 créditos, `tokenSms` R$ 0,10, `send_automatic_whatsapp` R$ 0,50, 1 crédito = R$ 0,10.
- **Sandbox:** `send_automatic_*` desligados, `confirmoTeste` obrigatório, selo "TESTE — sem validade jurídica", sem follow-up "título assinado", sem "enviar pelo chat", sem botão "Reenviar".
- **Decisões 2.2 (padrão):** saldo integral = principal **mais** multa e juros pela `politica.encargos` até `erp_lido_em`, fatura a fatura, discriminados no Anexo I; `provedor_assina = false`; contato alterado exige `validate_cpf: true`; selfie desligada.
- **Textos em pt-BR;** nomes de domínio em português; DESIGN_SYSTEM.md v5 (tokens `--brand`, `--ok`, `--gated`, `--past`; mono tabular em todo número; raio ≤ 8px; sem paleta Tailwind crua).
- **Suíte verde e tsc no baseline:** `npm test` (vitest) tem de passar inteiro em cada commit; `npx tsc --noEmit` mantém **58** diagnósticos (os pré-existentes), nenhum novo.
- **Commits pequenos, um por tarefa,** mensagem em português no molde do repositório (`feat(confissao): …`, `test(confissao): …`). Nunca commitar `*.segurado` nem `docs/rede-mapa-2026-09-08.md`.
- **Deploy** (só no fim da fase 4, com `pdfkit` instalado): `ssh -i ~/.ssh/claude-consultaisp root@187.127.7.168`, `cd /var/www/consulta-isp && git reset --hard origin/feat/localizacao && npm install && npm run build && pm2 delete consulta-isp consulta-isp-worker; pm2 start ecosystem.config.cjs` — `npm install` é obrigatório porque `pdfkit` fica **externo** ao bundle (`script/build.ts` só empacota a allowlist) e é carregado de `node_modules` em runtime.

---

## Estrutura de arquivos

Cada arquivo tem uma responsabilidade; o que muda junto mora junto.

| Arquivo | Responsabilidade |
|---|---|
| `shared/cobranca/confissao.ts` (+ `.test.ts`) | Vocabulário puro: status e transições, ambientes, origens, `auth_mode` e custos, tipos JSON (`ParcelaConfessada`, `FaturaDoAnexo`, `SignatarioDaConfissao`), o contrato da API (`ConfissaoResumo`, `EstadoDaAssinatura`, `BaseDaConfissaoDto`), selos e rótulos. Servidor e cliente importam daqui. |
| `shared/cobranca/por-extenso.ts` (+ `.test.ts`) | Valor em reais por extenso. |
| `shared/cobranca/confissao-modelo.ts` (+ `.test.ts`) | Modelo padrão v1.0: `EntradaDoModelo`, `baseCanonica`, `serializarBase`, `renderizarConfissao` (determinístico), `textoDaConfissao`, `variaveisDoModeloZapSign`. |
| `shared/cobranca/estados.ts` (+ `.test.ts`) | Ganha o evento `confissao`. |
| `shared/schema.ts` | `assinaturaIntegracoes`, `cobrancaConfissoes`, `cobrancaConfissoesPdf`. |
| `migrations/0037_confissao_de_divida_zapsign.sql` + `server/storage/migracao-0037-assinatura.test.ts` | DDL idempotente; teste de paridade com o schema. |
| `server/assinatura/erro.ts` | `ErroDeConfissao` (código + HTTP), lançado por storage, serviços e conector e mapeado pelas rotas. |
| `server/assinatura/pdf.ts` (+ `.test.ts`) | Documento renderizado → PDF (pdfkit). |
| `server/assinatura/zapsign.ts` (+ `.test.ts`) | Conector HTTP do ZapSign por ambiente; erros mapeados sem vazar corpo. |
| `server/storage/assinatura.storage.ts` (+ `.test.ts`); `server/storage/index.ts`; `server/storage/storage-fachada.test.ts` | As três tabelas; token cifrado; PDF só por `obterPdf`; transições atômicas. |
| `server/routes/admin-assinatura.routes.ts` (+ `.test.ts`); `server/routes/index.ts`; `server/utils/sanitize-log.ts` | Configuração do superadmin (GET/PUT/ativar). Router próprio, ao lado do `admin.routes.ts` do ERP, com os **mesmos** limites (60/min salvar, 20/min ativar): o arquivo do ERP tem 1.100 linhas e um harness de teste pesado; o router novo é testável sozinho. |
| `server/services/confissao/confissao-base.service.ts` (+ `.test.ts`) | Monta a base sem digitação (acordo ou saldo integral), bloqueios, hash. |
| `server/services/confissao/confissao-emissao.service.ts` (+ `.test.ts`) | Emitir: trava, idempotência, `baseHash`, rascunho, PDF, ZapSign, webhook por documento, evento e follow-up; falha mantém rascunho e apaga documento órfão. |
| `server/services/confissao/confissao-retorno.service.ts` (+ `.test.ts`) | `aplicarRetorno` (reconsulta + transição atômica), `cancelarConfissao`, `reenviarNotificacoes`, `registrarInformadoPeloWebhook` — a mesma função para webhook, cancelar e worker. |
| `server/services/confissao/confissao-reconciliacao.service.ts` (+ `.test.ts`); `server/worker.ts` | Reconsulta o que não teve retorno; expira; avisa "falta a assinatura do provedor". |
| `server/routes/confissao.routes.ts` (+ `.test.ts`); `server/routes/index.ts` | base, emitir, listar, cancelar, reenviar, PDF, estado, modelo revisado, enviar pelo chat. |
| `server/routes/webhooks-zapsign.routes.ts` (+ `.test.ts`); `server/routes/index.ts` | `POST /api/webhooks/zapsign/:providerId`. |
| `server/routes/cobranca.routes.ts` (+ `.test.ts`); `shared/cobranca/ficha360.ts` (+ `.test.ts`) | `PORQUE_NAO_DECLARA.confissao`; acordo × confissão ao cancelar/quebrar negociação; `confissaoViva` no 360 e o selo na lista/kanban; prescrição interrompida. |
| `server/services/lgpd-retention.ts` (+ `.test.ts`); `server/services/lgpd-titular.service.ts` (+ `.test.ts`) | Retenção de 90 dias para o que não é título; acesso/portabilidade incluem confissões; exclusão preserva assinada em produção. |
| `client/src/components/cobranca/SeloConfissao.tsx`; `CardCliente.tsx`; `pages/cobranca/carteira.tsx`; `components/cobranca/tipos.ts` | O selo pequeno no card e na lista. |
| `client/src/components/cobranca/ConfissaoDeDivida.tsx` (+ `ConfissaoDeDivida.test.ts`); `pages/cobranca/cliente360.tsx` (+ `cliente360.test.ts`) | O bloco do 360: estado por signatário, diálogo de emissão, cancelar, reenviar, PDF, sandbox. |
| `client/src/components/assinatura/FormularioZapSign.tsx` (+ `.test.ts`); `pages/admin/admin-provedor.tsx` | Cartão de configuração na aba Integração do superadmin (Salvar / Ativar). |
| `client/src/pages/provedor/painel-provedor.tsx` | Estado só leitura da assinatura eletrônica. |
| `docs/confissao-de-divida-2026-09-09.md`; `CLAUDE.md`; memória | Documentação e `ASSINATURA_WEBHOOK_URL`. |

**Fases** (spec §11): 1 Fundação = Tarefas 1–9 · 2 Emissão e retorno = Tarefas 10–16 · 3 Telas = Tarefas 17–19 · 4 LGPD e produção = Tarefas 20–21.

**Convenções de teste que valem para todas as tarefas:** `npx vitest run <arquivo>` roda um arquivo; `npm test` roda tudo. Testes de rota sobem um `express()` com `req.session` injetada e `vi.mock("../storage", () => ({ storage: storageMock }))` (molde: `server/routes/cobranca.routes.test.ts`, linhas 1–170). Testes de storage usam o pg-proxy de mentira (`server/storage/faturas.storage.test.ts`, linhas 1–40) e conferem `provider_id` em toda consulta. Componentes `.tsx` não renderizam em teste (sem DOM): os testes deles leem o FONTE como texto (molde: `client/src/pages/cobranca/cliente360.test.ts`), normalizando CRLF com `.replace(/\r\n/g, "\n")`.

---

## Fase 1 — Fundação

### Task 1: Vocabulário compartilhado da confissão e o evento `confissao`

**Files:**
- Create: `shared/cobranca/confissao.ts`
- Create: `shared/cobranca/confissao.test.ts`
- Modify: `shared/cobranca/estados.ts:250-282` (`TIPOS_DE_EVENTO`, `ROTULO_TIPO_DE_EVENTO`)
- Modify: `shared/cobranca/estados.test.ts:317-320` (lista pinada)
- Modify: `shared/cobranca/index.ts` (re-export)
- Modify: `server/routes/cobranca.routes.ts:1000-1009` (`PORQUE_NAO_DECLARA`)

**Interfaces:**
- Consumes: nada.
- Produces: `STATUS_DE_CONFISSAO`, `StatusDeConfissao`, `transicaoDeConfissaoPermitida(de, para)`, `AMBIENTES_DE_ASSINATURA`/`AmbienteDeAssinatura`, `ORIGENS_DA_CONFISSAO`/`OrigemDaConfissao`, `AUTH_MODES_DO_CLIENTE`/`AuthModeDoCliente`/`AUTH_MODE_PADRAO`, `custoDaEmissao(...)`/`CustoDaEmissao`, `ParcelaConfessada`, `FaturaDoAnexo`/`ClasseDaFatura`, `SignatarioDaConfissao`/`StatusDoSignatario`, `ConfissaoResumo`, `EstadoDaAssinatura`, `BaseDaConfissaoDto`, `confissaoViva`, `confissaoAssinadaViva`, `SELO_SANDBOX`, `SELO_ASSINADA`, `AVISO_SEM_PARECER`, `AVISO_SANDBOX`, `PRAZO_MAXIMO_DO_VENCIMENTO_DIAS`, `PRAZO_PADRAO_DE_ASSINATURA_DIAS`, `LEMBRETE_A_CADA_DIAS`. O evento `"confissao"` em `TIPOS_DE_EVENTO`.

- [ ] **Step 1: Escrever o teste que falha**

`shared/cobranca/confissao.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AUTH_MODES_DO_CLIENTE, AUTH_MODE_PADRAO, ORIGENS_DA_CONFISSAO, STATUS_DE_CONFISSAO, STATUS_VIVOS_DE_CONFISSAO,
  TRANSICOES_DE_CONFISSAO, confissaoAssinadaViva, confissaoViva, custoDaEmissao, transicaoDeConfissaoPermitida,
} from "./confissao";
import { ROTULO_TIPO_DE_EVENTO, TIPOS_DE_EVENTO } from "./estados";

describe("vocabulário da confissão", () => {
  it("as listas são as da spec §5.2 (pinadas)", () => {
    expect([...STATUS_DE_CONFISSAO]).toEqual(["rascunho", "enviada", "assinada", "cancelada", "expirada", "quitada", "substituida"]);
    expect([...STATUS_VIVOS_DE_CONFISSAO]).toEqual(["rascunho", "enviada"]);
    expect([...ORIGENS_DA_CONFISSAO]).toEqual(["acordo", "saldo_integral"]);
    expect(AUTH_MODE_PADRAO).toBe("assinaturaTela-tokenWhatsapp");
  });
  it("assinaturaTela puro não é auth_mode aceito: assina sem prova de quem assinou", () => {
    expect(AUTH_MODES_DO_CLIENTE).not.toContain("assinaturaTela");
    expect(AUTH_MODES_DO_CLIENTE).toContain("assinaturaTela-tokenWhatsapp");
  });
  it("a máquina de estados: rascunho→enviada→assinada; assinada só quita ou é substituída; encerradas não saem", () => {
    expect(transicaoDeConfissaoPermitida("rascunho", "enviada")).toBe(true);
    expect(transicaoDeConfissaoPermitida("rascunho", "assinada")).toBe(false);
    expect(transicaoDeConfissaoPermitida("enviada", "assinada")).toBe(true);
    expect(transicaoDeConfissaoPermitida("enviada", "expirada")).toBe(true);
    expect(transicaoDeConfissaoPermitida("assinada", "cancelada")).toBe(false);
    expect(transicaoDeConfissaoPermitida("assinada", "quitada")).toBe(true);
    expect(transicaoDeConfissaoPermitida("assinada", "substituida")).toBe(true);
    for (const s of ["cancelada", "expirada", "quitada", "substituida"] as const) expect(TRANSICOES_DE_CONFISSAO[s]).toEqual([]);
  });
  it("viva = rascunho ou enviada; assinada viva = assinada", () => {
    expect(confissaoViva({ status: "enviada" })).toBe(true);
    expect(confissaoViva({ status: "assinada" })).toBe(false);
    expect(confissaoAssinadaViva({ status: "assinada" })).toBe(true);
    expect(confissaoAssinadaViva({ status: "quitada" })).toBe(false);
  });
  it("custo: WhatsApp 5 créditos; envio automático R$ 0,50 só em produção; sandbox não custa", () => {
    const prod = custoDaEmissao({ authMode: "assinaturaTela-tokenWhatsapp", ambiente: "producao", enviarWhatsapp: true, exigirSelfie: false });
    expect(prod).toMatchObject({ creditos: 5, reais: 0.5 });
    expect(prod.texto).toContain("5 créditos");
    expect(prod.texto).toContain("R$ 0,50");
    const email = custoDaEmissao({ authMode: "assinaturaTela-tokenEmail", ambiente: "producao", enviarWhatsapp: false, exigirSelfie: false });
    expect(email).toMatchObject({ creditos: 0, reais: 0 });
    expect(custoDaEmissao({ authMode: "tokenSms", ambiente: "producao", enviarWhatsapp: false, exigirSelfie: false }).reais).toBe(0.1);
    expect(custoDaEmissao({ authMode: "tokenEmail", ambiente: "producao", enviarWhatsapp: false, exigirSelfie: true }).creditos).toBe(15);
    const sandbox = custoDaEmissao({ authMode: "assinaturaTela-tokenWhatsapp", ambiente: "sandbox", enviarWhatsapp: true, exigirSelfie: false });
    expect(sandbox.reais).toBe(0);
    expect(sandbox.texto).toContain("ambiente de testes");
  });
  it("o evento `confissao` existe e tem rótulo", () => {
    expect(TIPOS_DE_EVENTO).toContain("confissao");
    expect(ROTULO_TIPO_DE_EVENTO.confissao).toBe("Confissão de dívida");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run shared/cobranca/confissao.test.ts`
Expected: FAIL — `Cannot find module './confissao'`.

- [ ] **Step 3: Escrever `shared/cobranca/confissao.ts`**

```ts
/**
 * CONFISSÃO DE DÍVIDA (CPC 784) — o vocabulário puro.
 *
 * Sem banco, sem React, sem I/O: o servidor e o cliente importam daqui o mesmo
 * nome para cada estado, origem, papel e custo. O que o ZapSign chama de
 * `auth_mode` vira uma lista fechada — `assinaturaTela` puro fica de fora de
 * propósito (assina sem prova de QUEM assinou; a spec §5.1 recusa).
 *
 * Spec: docs/superpowers/specs/2026-09-09-confissao-de-divida-zapsign-design.md
 */

export const STATUS_DE_CONFISSAO = ["rascunho", "enviada", "assinada", "cancelada", "expirada", "quitada", "substituida"] as const;
export type StatusDeConfissao = (typeof STATUS_DE_CONFISSAO)[number];

/** Viva = ainda pode virar título. Uma por cliente: índice parcial da migração 0037. */
export const STATUS_VIVOS_DE_CONFISSAO = ["rascunho", "enviada"] as const;

export const TRANSICOES_DE_CONFISSAO: Record<StatusDeConfissao, readonly StatusDeConfissao[]> = {
  rascunho: ["enviada", "cancelada"],
  enviada: ["assinada", "cancelada", "expirada"],
  assinada: ["quitada", "substituida"],
  cancelada: [],
  expirada: [],
  quitada: [],
  substituida: [],
};

export function transicaoDeConfissaoPermitida(de: StatusDeConfissao, para: StatusDeConfissao): boolean {
  return TRANSICOES_DE_CONFISSAO[de].includes(para);
}

export const ROTULO_STATUS_DE_CONFISSAO: Record<StatusDeConfissao, string> = {
  rascunho: "Rascunho",
  enviada: "Aguardando assinatura",
  assinada: "Assinada",
  cancelada: "Cancelada",
  expirada: "Expirada",
  quitada: "Quitada",
  substituida: "Substituída",
};

export function confissaoViva(c: { status: string }): boolean {
  return c.status === "rascunho" || c.status === "enviada";
}

/** "Assinada viva" (spec §6.6): a que acende o selo e interrompe a prescrição. */
export function confissaoAssinadaViva(c: { status: string }): boolean {
  return c.status === "assinada";
}

export const AMBIENTES_DE_ASSINATURA = ["sandbox", "producao"] as const;
export type AmbienteDeAssinatura = (typeof AMBIENTES_DE_ASSINATURA)[number];

export const ORIGENS_DA_CONFISSAO = ["acordo", "saldo_integral"] as const;
export type OrigemDaConfissao = (typeof ORIGENS_DA_CONFISSAO)[number];
export const ROTULO_ORIGEM_DA_CONFISSAO: Record<OrigemDaConfissao, string> = {
  acordo: "parcelas do acordo aceito",
  saldo_integral: "saldo integral lido do ERP",
};

export const AUTH_MODES_DO_CLIENTE = [
  "assinaturaTela-tokenWhatsapp",
  "assinaturaTela-tokenEmail",
  "assinaturaTela-tokenSms",
  "tokenWhatsapp",
  "tokenEmail",
  "tokenSms",
  "certificadoDigital",
  "assinaturaTela-certificadoDigital",
] as const;
export type AuthModeDoCliente = (typeof AUTH_MODES_DO_CLIENTE)[number];
export const AUTH_MODE_PADRAO: AuthModeDoCliente = "assinaturaTela-tokenWhatsapp";

/** Tabela do ZapSign lida em 09/09/2026 (spec §3). 1 crédito = R$ 0,10. */
export const CREDITO_EM_REAIS = 0.1;
export const ENVIO_WHATSAPP_EM_REAIS = 0.5;
export const SELFIE_CREDITOS_MINIMO = 15;

export const CUSTO_DO_AUTH_MODE: Record<AuthModeDoCliente, { creditos: number; reais: number; rotulo: string; prova: string }> = {
  "assinaturaTela-tokenWhatsapp": { creditos: 5, reais: 0, rotulo: "Assinatura na tela + código por WhatsApp", prova: "código enviado ao WhatsApp do devedor" },
  "assinaturaTela-tokenEmail": { creditos: 0, reais: 0, rotulo: "Assinatura na tela + código por e-mail", prova: "código enviado ao e-mail do devedor" },
  "assinaturaTela-tokenSms": { creditos: 0, reais: 0.1, rotulo: "Assinatura na tela + código por SMS", prova: "código enviado por SMS ao devedor" },
  tokenWhatsapp: { creditos: 5, reais: 0, rotulo: "Código por WhatsApp", prova: "código enviado ao WhatsApp do devedor" },
  tokenEmail: { creditos: 0, reais: 0, rotulo: "Código por e-mail", prova: "código enviado ao e-mail do devedor" },
  tokenSms: { creditos: 0, reais: 0.1, rotulo: "Código por SMS", prova: "código enviado por SMS ao devedor" },
  certificadoDigital: { creditos: 5, reais: 0, rotulo: "Certificado digital (ICP-Brasil)", prova: "certificado digital do devedor" },
  "assinaturaTela-certificadoDigital": { creditos: 5, reais: 0, rotulo: "Assinatura na tela + certificado digital", prova: "certificado digital do devedor" },
};

export interface CustoDaEmissao { creditos: number; reais: number; texto: string }

const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

/** O custo DESTA emissão para a conta ZapSign do provedor — o diálogo mostra antes de emitir (spec §8). */
export function custoDaEmissao(i: { authMode: AuthModeDoCliente; ambiente: AmbienteDeAssinatura; enviarWhatsapp: boolean; exigirSelfie: boolean }): CustoDaEmissao {
  if (i.ambiente === "sandbox") return { creditos: 0, reais: 0, texto: "ambiente de testes — sem custo e sem envio ao cliente" };
  const base = CUSTO_DO_AUTH_MODE[i.authMode];
  const creditos = base.creditos + (i.exigirSelfie ? SELFIE_CREDITOS_MINIMO : 0);
  const valor = base.reais + (i.enviarWhatsapp ? ENVIO_WHATSAPP_EM_REAIS : 0);
  const partes = ["1 documento da cota do plano"];
  if (creditos > 0) partes.push(`${creditos} crédito${creditos === 1 ? "" : "s"} (${reais(creditos * CREDITO_EM_REAIS)})`);
  if (valor > 0) partes.push(reais(valor));
  return { creditos, reais: valor, texto: `${partes.join(" + ")} da conta ZapSign do provedor` };
}

/* ── O que a confissão guarda em JSON ────────────────────────────────── */

export type RotuloDaParcela = "entrada" | "parcela";
export interface ParcelaConfessada {
  n: number;
  rotulo: RotuloDaParcela;
  valor: number;
  /** AAAA-MM-DD */
  vencimento: string;
}

export const CLASSES_DE_FATURA = ["servico", "multa", "equipamento", "indeterminada"] as const;
export type ClasseDaFatura = (typeof CLASSES_DE_FATURA)[number];
export const ROTULO_CLASSE_DA_FATURA: Record<ClasseDaFatura, string> = {
  servico: "mensalidade",
  multa: "multa rescisória",
  equipamento: "equipamento em comodato",
  indeterminada: "mensalidade e multa sem valores separados",
};

/**
 * Uma linha do Anexo I: a fatura como o ERP a entregou ao vivo, mais os
 * encargos calculados até a leitura (decisão 2.2-1). Fatura que declara na
 * descrição uma multa ou um equipamento COM valor vira duas linhas (a parte de
 * serviço e a de saída), cada uma com a sua `chave` — é ela que o admin
 * desmarca. Encargos só na parte de serviço: multa sobre multa não se cobra.
 */
export interface FaturaDoAnexo {
  /** `erpRef`, ou `erpRef#multa` / `erpRef#equipamento` quando a fatura foi dividida. */
  chave: string;
  erpRef: string;
  descricao: string | null;
  vencimento: string;
  valor: number;
  classe: ClasseDaFatura;
  diasAtraso: number;
  multa: number;
  juros: number;
}

export type PapelDoSignatario = "cliente" | "provedor";
export const STATUS_DO_SIGNATARIO = ["new", "link-opened", "signed"] as const;
export type StatusDoSignatario = (typeof STATUS_DO_SIGNATARIO)[number];
export interface SignatarioDaConfissao {
  papel: PapelDoSignatario;
  token: string;
  signUrl: string | null;
  status: StatusDoSignatario;
  signedAt: string | null;
  authMode: string | null;
}
export const ROTULO_STATUS_DO_SIGNATARIO: Record<StatusDoSignatario, string> = {
  new: "não abriu o link",
  "link-opened": "abriu o link",
  signed: "assinou",
};

export const PRAZO_MAXIMO_DO_VENCIMENTO_DIAS = 90;
export const PRAZO_PADRAO_DE_ASSINATURA_DIAS = 15;
export const LEMBRETE_A_CADA_DIAS = 3;

export const SELO_SANDBOX = "TESTE — sem validade jurídica";
export const SELO_ASSINADA = "título executivo assinado";
export const AVISO_SEM_PARECER = "MODELO PADRÃO SEM PARECER JURÍDICO — o provedor é responsável por revisar este texto";
export const AVISO_SANDBOX = "AMBIENTE DE TESTES — SEM VALIDADE JURÍDICA";

/* ── O contrato da API (rotas → telas) ───────────────────────────────── */

export type ModeloDaConfissao = "padrao" | "zapsign";

export interface ConfissaoResumo {
  id: number;
  customerId: number;
  casoId: number;
  negociacaoId: number | null;
  status: StatusDeConfissao;
  origem: OrigemDaConfissao;
  ambiente: AmbienteDeAssinatura;
  zapsignSandbox: boolean | null;
  valorTotal: number;
  valorOriginal: number | null;
  descontoPct: number | null;
  parcelas: ParcelaConfessada[];
  anexo: FaturaDoAnexo[];
  modelo: ModeloDaConfissao;
  modeloVersao: string;
  modeloRevisado: boolean;
  dataLimiteAssinatura: string;
  enviadaEm: string | null;
  assinadaEm: string | null;
  encerradaEm: string | null;
  recusaInformadaEm: string | null;
  expiracaoInformadaEm: string | null;
  erroUltimo: string | null;
  signatarios: SignatarioDaConfissao[];
  signUrlCliente: string | null;
  contatoAlterado: boolean;
  criadaPor: string | null;
  criadaEm: string;
  pdf: { original: boolean; assinado: boolean };
}

export interface EstadoDaAssinatura {
  configurada: boolean;
  ativa: boolean;
  ambiente: AmbienteDeAssinatura | null;
  modelo: ModeloDaConfissao;
  modeloRevisado: boolean;
  provedorAssina: boolean;
  authMode: AuthModeDoCliente | null;
  custo: CustoDaEmissao | null;
  prazoAssinaturaDias: number | null;
  chatDisponivel: boolean;
  /** Por que não dá para emitir hoje (null = pode). */
  motivo: string | null;
}

export interface PreviaDoModeloPadrao { modelo: "padrao"; titulo: string; texto: string }
export interface PreviaDoModeloZapSign { modelo: "zapsign"; templateId: string; variaveis: Array<{ de: string; para: string }> }

export interface BaseDaConfissaoDto {
  origem: OrigemDaConfissao;
  casoId: number | null;
  negociacaoId: number | null;
  cliente: { nome: string; documento: string; pessoaJuridica: boolean; email: string | null; telefone: string | null; endereco: string | null };
  valorTotal: number;
  valorOriginal: number | null;
  descontoPct: number | null;
  recebidoDoAcordo: number | null;
  encargos: { multa: number; juros: number; multaPct: number; jurosMesPct: number };
  parcelas: ParcelaConfessada[];
  anexo: FaturaDoAnexo[];
  faturasIndeterminadas: number;
  /** `erpRef` das faturas de saída (multa/equipamento) — o admin pode desmarcá-las. */
  faturasDeSaida: string[];
  erpSource: string | null;
  erpLidoEm: string | null;
  dividaAtualDoErp: number | null;
  vencimento: { minimo: string; maximo: string; escolhido: string | null };
  bloqueios: string[];
  avisos: string[];
  prescrita: boolean;
  baseHash: string | null;
  previa: PreviaDoModeloPadrao | PreviaDoModeloZapSign | null;
  custo: CustoDaEmissao;
  ambiente: AmbienteDeAssinatura;
  modeloRevisado: boolean;
}
```

- [ ] **Step 4: O evento `confissao`**

Em `shared/cobranca/estados.ts`, na lista `TIPOS_DE_EVENTO` (linha 250), acrescente `"confissao",` depois de `"cancelamento",`; em `ROTULO_TIPO_DE_EVENTO` acrescente `confissao: "Confissão de dívida",` depois de `cancelamento: …`. Em `shared/cobranca/estados.test.ts:319` a lista pinada passa a terminar em `"encerramento", "cancelamento", "confissao",`. Em `shared/cobranca/index.ts` acrescente `export * from "./confissao";` depois de `export * from "./estados";`. Em `server/routes/cobranca.routes.ts`, dentro de `PORQUE_NAO_DECLARA` (linha 1000), acrescente:

```ts
  confissao: "Nasce da emissão/retorno da confissão (POST /api/cobranca/clientes/:id/confissoes e webhook).",
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run shared/cobranca/confissao.test.ts shared/cobranca/estados.test.ts server/routes/cobranca.routes.test.ts`
Expected: PASS (a rota recusa `tipo: "confissao"` no POST de eventos com a frase de `PORQUE_NAO_DECLARA`, como faz com `acordo_aceito`).

- [ ] **Step 6: Commit**

```bash
git add shared/cobranca/confissao.ts shared/cobranca/confissao.test.ts shared/cobranca/estados.ts shared/cobranca/estados.test.ts shared/cobranca/index.ts server/routes/cobranca.routes.ts
git commit -m "feat(confissao): vocabulário puro da confissão de dívida e o evento confissao"
```

---

### Task 2: Valor por extenso

**Files:**
- Create: `shared/cobranca/por-extenso.ts`
- Create: `shared/cobranca/por-extenso.test.ts`

**Interfaces:**
- Produces: `numeroPorExtenso(n: number): string`, `valorPorExtenso(valor: number): string`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from "vitest";
import { numeroPorExtenso, valorPorExtenso } from "./por-extenso";

describe("por extenso", () => {
  it.each([
    [0, "zero"], [1, "um"], [15, "quinze"], [21, "vinte e um"], [100, "cem"], [101, "cento e um"],
    [200, "duzentos"], [999, "novecentos e noventa e nove"], [1000, "mil"], [1100, "mil e cem"],
    [1250, "mil duzentos e cinquenta"], [2020, "dois mil e vinte"], [100000, "cem mil"],
    [1_000_000, "um milhão"], [1_200_000, "um milhão e duzentos mil"], [2_300_020, "dois milhões trezentos mil e vinte"],
  ])("%s → %s", (n, esperado) => {
    expect(numeroPorExtenso(n)).toBe(esperado);
  });
  it("valores em reais: centavos, milhares, singular", () => {
    expect(valorPorExtenso(719.86)).toBe("setecentos e dezenove reais e oitenta e seis centavos");
    expect(valorPorExtenso(1)).toBe("um real");
    expect(valorPorExtenso(1000)).toBe("mil reais");
    expect(valorPorExtenso(0.5)).toBe("cinquenta centavos");
    expect(valorPorExtenso(1250.01)).toBe("mil duzentos e cinquenta reais e um centavo");
    expect(valorPorExtenso(2_000_000)).toBe("dois milhões de reais");
    expect(valorPorExtenso(0)).toBe("zero real");
    expect(valorPorExtenso(99.999)).toBe("cem reais");
  });
  it("recusa o que não é inteiro não negativo", () => {
    expect(() => numeroPorExtenso(-1)).toThrow();
    expect(() => numeroPorExtenso(1.5)).toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run shared/cobranca/por-extenso.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever `shared/cobranca/por-extenso.ts`**

```ts
/**
 * Valor por extenso, como a Cláusula 2ª da confissão exige ("R$ 719,86
 * (setecentos e dezenove reais e oitenta e seis centavos)"). Puro.
 */
const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ateNovecentosENoventaENove(n: number): string {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto > 0 && resto < 20) partes.push(UNIDADES[resto]);
  else if (resto >= 20) {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
  }
  return partes.join(" e ");
}

const ESCALAS: Array<[number, string, string]> = [
  [1_000_000_000, "bilhão", "bilhões"],
  [1_000_000, "milhão", "milhões"],
  [1_000, "mil", "mil"],
];

export function numeroPorExtenso(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error("numeroPorExtenso: só inteiro não negativo");
  if (n === 0) return "zero";
  const grupos: string[] = [];
  let resto = n;
  for (const [valor, singular, plural] of ESCALAS) {
    const q = Math.floor(resto / valor);
    if (!q) continue;
    resto -= q * valor;
    if (valor === 1_000) grupos.push(q === 1 ? "mil" : `${ateNovecentosENoventaENove(q)} mil`);
    else grupos.push(`${ateNovecentosENoventaENove(q)} ${q === 1 ? singular : plural}`);
  }
  if (resto) grupos.push(ateNovecentosENoventaENove(resto));
  // O "e" antes do último grupo: "mil e cem", "dois mil e vinte", "um milhão e
  // duzentos mil"; sem ele quando o último grupo já é composto: "mil duzentos e cinquenta".
  if (grupos.length > 1) {
    const ultimoEhSimples = resto === 0 || resto < 100 || resto % 100 === 0;
    if (ultimoEhSimples) grupos[grupos.length - 1] = `e ${grupos[grupos.length - 1]}`;
  }
  return grupos.join(" ");
}

export function valorPorExtenso(valor: number): string {
  const centavosTotais = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;
  const partes: string[] = [];
  if (reais > 0) {
    const redonda = reais >= 1_000_000 && reais % 1_000_000 === 0;
    partes.push(`${numeroPorExtenso(reais)} ${redonda ? "de " : ""}${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) partes.push(`${numeroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return partes.length ? partes.join(" e ") : "zero real";
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run shared/cobranca/por-extenso.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/cobranca/por-extenso.ts shared/cobranca/por-extenso.test.ts
git commit -m "feat(confissao): valor em reais por extenso"
```

---

### Task 3: O modelo padrão v1.0 — base canônica, render determinístico e variáveis do ZapSign

**Files:**
- Create: `shared/cobranca/confissao-modelo.ts`
- Create: `shared/cobranca/confissao-modelo.test.ts`

**Interfaces:**
- Consumes: `valorPorExtenso` (Task 2); `ParcelaConfessada`, `FaturaDoAnexo`, `OrigemDaConfissao`, `AmbienteDeAssinatura`, `AVISO_SEM_PARECER`, `AVISO_SANDBOX` (Task 1).
- Produces: `VERSAO_DO_MODELO = "1.0"`, `EntradaDoModelo`, `BaseCanonica`, `baseCanonica(e)`, `serializarBase(base): string` (JSON estável — o servidor faz o SHA-256 disso), `DocumentoRenderizado`/`BlocoDoDocumento`, `renderizarConfissao(base, geradoEm, hash)`, `textoDaConfissao(doc)`, `variaveisDoModeloZapSign(base, geradoEm)`, `VARIAVEIS_DO_MODELO_ZAPSIGN`, `formatarReais`, `formatarDocumento`, `dataBr`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from "vitest";
import {
  VARIAVEIS_DO_MODELO_ZAPSIGN, VERSAO_DO_MODELO, baseCanonica, renderizarConfissao, serializarBase, textoDaConfissao,
  variaveisDoModeloZapSign, type EntradaDoModelo,
} from "./confissao-modelo";
import { AVISO_SANDBOX, AVISO_SEM_PARECER } from "./confissao";

const entrada = (): EntradaDoModelo => ({
  origem: "saldo_integral",
  ambiente: "producao",
  modeloRevisado: true,
  credor: { razaoSocial: "NsLink Telecom Ltda", cnpj: "12345678000199", endereco: "Rua A, 10, Centro, Lavras do Norte/MG, 39000-000", representante: null },
  devedor: { nome: "Maria da Silva", documento: "12345678901", pessoaJuridica: false, representante: null, endereco: "Rua B, 20, Bairro, Lavras do Norte/MG", email: "maria@example.com", telefone: "31999990000" },
  cadastroErp: "4471",
  plano: "Fibra 300",
  inicioContrato: "2024-03-15",
  erpLidoEm: "2026-09-09T17:30:00.000Z",
  valorTotal: 719.86,
  valorOriginal: null,
  descontoPct: null,
  recebidoDoAcordo: null,
  parcelas: [{ n: 1, rotulo: "parcela", valor: 719.86, vencimento: "2026-10-10" }],
  meioDePagamento: "boleto ou PIX enviado pelo credor",
  encargos: { multaPct: 2, jurosMesPct: 1 },
  anexo: [
    { chave: "F-1", erpRef: "F-1", descricao: "Mensalidade 07/2026", vencimento: "2026-07-10", valor: 99.9, classe: "servico", diasAtraso: 61, multa: 2, juros: 2.03 },
    { chave: "F-2", erpRef: "F-2", descricao: "Multa rescisória", vencimento: "2026-08-10", valor: 615.93, classe: "multa", diasAtraso: 30, multa: 0, juros: 0 },
  ],
});

describe("modelo padrão v1.0", () => {
  it("a base canônica não carrega data/hora, normaliza documentos e ordena parcelas e anexo", () => {
    const b = baseCanonica({ ...entrada(), parcelas: [{ n: 2, rotulo: "parcela", valor: 10, vencimento: "2026-11-10" }, { n: 1, rotulo: "entrada", valor: 5.5, vencimento: "2026-10-10" }] });
    expect(b.versao).toBe(VERSAO_DO_MODELO);
    expect(b.parcelas.map(p => p.n)).toEqual([1, 2]);
    expect(b.devedor.documento).toBe("12345678901");
    expect(JSON.stringify(b)).not.toContain("geradoEm");
  });
  it("mesma base = mesma serialização, em qualquer ordem de chaves; hora diferente não entra", () => {
    const a = serializarBase(baseCanonica(entrada()));
    const invertida = Object.fromEntries(Object.entries(entrada()).reverse()) as EntradaDoModelo;
    expect(serializarBase(baseCanonica(invertida))).toBe(a);
    expect(serializarBase(baseCanonica({ ...entrada(), erpLidoEm: "2026-09-09T18:00:00.000Z" }))).not.toBe(a);
  });
  it("o render é determinístico dado geradoEm e hash", () => {
    const b = baseCanonica(entrada());
    const x = renderizarConfissao(b, "2026-09-09T17:31:00.000Z", "abcdef0123456789");
    const y = renderizarConfissao(b, "2026-09-09T17:31:00.000Z", "abcdef0123456789");
    expect(x).toEqual(y);
    const texto = textoDaConfissao(x);
    expect(texto).toContain("INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA");
    expect(texto).toContain("R$ 719,86 (setecentos e dezenove reais e oitenta e seis centavos)");
    expect(texto).toContain("cadastro nº 4471 no sistema de gestão do credor, plano Fibra 300, iniciada em 15/03/2024");
    expect(texto).toContain("art. 784, III e §4º");
    expect(texto).toContain("foro da comarca do domicílio do DEVEDOR");
    expect(texto).toContain("multa de 2% e juros de 1% ao mês");
    expect(texto).toContain("F-1");
    expect(texto).toContain("modelo padrão v1.0 · gerado em 09/09/2026 às 14:31 · hash abcdef01");
    expect(texto).not.toContain(AVISO_SEM_PARECER);
    expect(texto).not.toContain(AVISO_SANDBOX);
  });
  it("variável ausente sai da frase — nunca '—', 'null' nem '0'", () => {
    const b = baseCanonica({ ...entrada(), cadastroErp: null, plano: null, inicioContrato: null, erpLidoEm: null });
    const texto = textoDaConfissao(renderizarConfissao(b, "2026-09-09T17:31:00.000Z", "ff"));
    expect(texto).toContain("mantida com o CREDOR, conforme as faturas relacionadas no Anexo I");
    expect(texto).not.toContain("cadastro nº");
    expect(texto).not.toContain("lidas do sistema de gestão");
    expect(texto).not.toMatch(/null|undefined|— —/);
  });
  it("acordo com desconto: cláusula condicional e saldo remanescente", () => {
    const b = baseCanonica({ ...entrada(), origem: "acordo", valorOriginal: 1000, descontoPct: 20, valorTotal: 600, recebidoDoAcordo: 200,
      parcelas: [{ n: 1, rotulo: "parcela", valor: 300, vencimento: "2026-10-10" }, { n: 2, rotulo: "parcela", valor: 300, vencimento: "2026-11-10" }] });
    const texto = textoDaConfissao(renderizarConfissao(b, "2026-09-09T17:31:00.000Z", "ff"));
    expect(texto).toContain("reconhece e confessa dever ao CREDOR a quantia de R$ 1.000,00");
    expect(texto).toContain("desconto de R$ 200,00 (20%)");
    expect(texto).toContain("condicionado ao pagamento integral e pontual");
    expect(texto).toContain("restabelece o valor original, abatidos os pagamentos efetuados");
    expect(texto).toContain("saldo remanescente do acordo, já abatidos R$ 200,00 recebidos");
    expect(texto).toContain("em 2 parcelas");
  });
  it("devedor PJ sai representado; credor com representante quando o provedor assina", () => {
    const b = baseCanonica({ ...entrada(),
      devedor: { ...entrada().devedor, nome: "Padaria Pão Quente Ltda", documento: "11222333000181", pessoaJuridica: true, representante: { nome: "João Pão", cpf: "98765432100" } },
      credor: { ...entrada().credor, representante: { nome: "Ana Link", cpf: "11122233344" } } });
    const texto = textoDaConfissao(renderizarConfissao(b, "2026-09-09T17:31:00.000Z", "ff"));
    expect(texto).toContain("Padaria Pão Quente Ltda, CNPJ 11.222.333/0001-81, representada por João Pão, CPF 987.654.321-00");
    expect(texto).toContain("representado por Ana Link, CPF 111.222.333-44");
  });
  it("avisos: modelo não revisado e sandbox vão ao rodapé; cláusulas 4, 5 e 6 em destaque", () => {
    const b = baseCanonica({ ...entrada(), modeloRevisado: false, ambiente: "sandbox" });
    const doc = renderizarConfissao(b, "2026-09-09T17:31:00.000Z", "ff");
    expect(doc.avisos).toEqual([AVISO_SEM_PARECER, AVISO_SANDBOX]);
    const destaques = doc.blocos.filter(x => x.tipo === "paragrafo" && x.destaque).map(x => (x as { texto: string }).texto);
    expect(destaques).toHaveLength(3);
    expect(destaques[0]).toContain("CLÁUSULA 4ª");
    expect(destaques[1]).toContain("CLÁUSULA 5ª");
    expect(destaques[2]).toContain("CLÁUSULA 6ª");
  });
  it("as 20 variáveis do modelo do ZapSign, todas preenchidas (ausente = string vazia)", () => {
    const vars = variaveisDoModeloZapSign(baseCanonica(entrada()), "2026-09-09T17:31:00.000Z");
    expect(vars.map(v => v.de)).toEqual(VARIAVEIS_DO_MODELO_ZAPSIGN);
    expect(vars).toHaveLength(20);
    const mapa = Object.fromEntries(vars.map(v => [v.de, v.para]));
    expect(mapa["{{VALOR_TOTAL}}"]).toBe("R$ 719,86");
    expect(mapa["{{DEVEDOR_CPF_CNPJ}}"]).toBe("123.456.789-01");
    expect(mapa["{{PARCELAS}}"]).toContain("1 — parcela — R$ 719,86 — 10/10/2026");
    expect(mapa["{{DEVEDOR_REPRESENTANTE}}"]).toBe("");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run shared/cobranca/confissao-modelo.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever `shared/cobranca/confissao-modelo.ts`**

```ts
/**
 * O modelo padrão da confissão de dívida — versão 1.0 (spec §7).
 *
 * Puro e determinístico: a mesma base canônica, o mesmo `geradoEm` e o mesmo
 * hash produzem o mesmo documento, em qualquer processo. O hash é do servidor
 * (SHA-256 de `serializarBase`), por isso ele entra aqui como argumento.
 *
 * Regra do texto: variável que falta SAI da frase — nunca "—", "null" ou "0".
 * Não existe número de contrato no sistema; `{{CONTRATO}}` não é variável.
 */
import { valorPorExtenso } from "./por-extenso";
import { AVISO_SANDBOX, AVISO_SEM_PARECER, ROTULO_CLASSE_DA_FATURA, type AmbienteDeAssinatura, type FaturaDoAnexo, type OrigemDaConfissao, type ParcelaConfessada } from "./confissao";

export const VERSAO_DO_MODELO = "1.0";

export interface Representante { nome: string; cpf: string }

export interface EntradaDoModelo {
  origem: OrigemDaConfissao;
  ambiente: AmbienteDeAssinatura;
  modeloRevisado: boolean;
  credor: { razaoSocial: string; cnpj: string; endereco: string | null; representante: Representante | null };
  devedor: { nome: string; documento: string; pessoaJuridica: boolean; representante: Representante | null; endereco: string | null; email: string | null; telefone: string | null };
  cadastroErp: string | null;
  plano: string | null;
  /** AAAA-MM-DD */
  inicioContrato: string | null;
  /** ISO — o instante da leitura ao vivo do ERP */
  erpLidoEm: string | null;
  valorTotal: number;
  valorOriginal: number | null;
  descontoPct: number | null;
  recebidoDoAcordo: number | null;
  parcelas: ParcelaConfessada[];
  meioDePagamento: string;
  encargos: { multaPct: number; jurosMesPct: number };
  anexo: FaturaDoAnexo[];
}

/** A entrada normalizada, com a versão do modelo e SEM data/hora — é o que o hash cobre. */
export interface BaseCanonica extends EntradaDoModelo { versao: string }

const centavos = (n: number) => Math.round(n * 100) / 100;
export const apenasDigitos = (s: string) => s.replace(/\D/g, "");

export function baseCanonica(e: EntradaDoModelo): BaseCanonica {
  const rep = (r: Representante | null) => (r ? { nome: r.nome.trim(), cpf: apenasDigitos(r.cpf) } : null);
  return {
    versao: VERSAO_DO_MODELO,
    origem: e.origem,
    ambiente: e.ambiente,
    modeloRevisado: e.modeloRevisado,
    credor: { razaoSocial: e.credor.razaoSocial.trim(), cnpj: apenasDigitos(e.credor.cnpj), endereco: e.credor.endereco, representante: rep(e.credor.representante) },
    devedor: { nome: e.devedor.nome.trim(), documento: apenasDigitos(e.devedor.documento), pessoaJuridica: e.devedor.pessoaJuridica, representante: rep(e.devedor.representante), endereco: e.devedor.endereco, email: e.devedor.email, telefone: e.devedor.telefone },
    cadastroErp: e.cadastroErp,
    plano: e.plano,
    inicioContrato: e.inicioContrato,
    erpLidoEm: e.erpLidoEm,
    valorTotal: centavos(e.valorTotal),
    valorOriginal: e.valorOriginal === null ? null : centavos(e.valorOriginal),
    descontoPct: e.descontoPct,
    recebidoDoAcordo: e.recebidoDoAcordo === null ? null : centavos(e.recebidoDoAcordo),
    parcelas: [...e.parcelas].sort((a, b) => a.n - b.n).map(p => ({ n: p.n, rotulo: p.rotulo, valor: centavos(p.valor), vencimento: p.vencimento })),
    meioDePagamento: e.meioDePagamento,
    encargos: { multaPct: e.encargos.multaPct, jurosMesPct: e.encargos.jurosMesPct },
    anexo: [...e.anexo].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.chave.localeCompare(b.chave))
      .map(f => ({ chave: f.chave, erpRef: f.erpRef, descricao: f.descricao, vencimento: f.vencimento, valor: centavos(f.valor), classe: f.classe, diasAtraso: f.diasAtraso, multa: centavos(f.multa), juros: centavos(f.juros) })),
  };
}

function ordenarChaves(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenarChaves);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map(k => [k, ordenarChaves(o[k])]));
  }
  return v;
}

/** JSON com chaves em ordem estável: mesma base → mesma string → mesmo hash. */
export function serializarBase(base: BaseCanonica): string {
  return JSON.stringify(ordenarChaves(base));
}

/* ── Formatação (manual, para não depender do ICU de cada máquina) ───── */

export function formatarReais(n: number): string {
  const [inteiro, dec] = Math.abs(n).toFixed(2).split(".");
  const milhares = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "-" : ""}R$ ${milhares},${dec}`;
}

export function formatarDocumento(doc: string): string {
  const d = apenasDigitos(doc);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

/** AAAA-MM-DD → DD/MM/AAAA, sem passar por Date (sem fuso). */
export function dataBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Instante ISO → "DD/MM/AAAA às HH:MM" em Brasília (sem horário de verão desde 2019: UTC−3 fixo). */
export function dataHoraBr(iso: string): string {
  const t = new Date(iso).getTime() - 3 * 60 * 60 * 1000;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} às ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(".", ",")}%`;

/* ── Render ──────────────────────────────────────────────────────────── */

export type BlocoDoDocumento =
  | { tipo: "titulo"; texto: string }
  | { tipo: "subtitulo"; texto: string }
  | { tipo: "paragrafo"; texto: string; destaque?: boolean }
  | { tipo: "tabela"; cabecalho: string[]; linhas: string[][] }
  | { tipo: "rodape"; texto: string };

export interface DocumentoRenderizado { titulo: string; blocos: BlocoDoDocumento[]; avisos: string[] }

function parte(devedorOuCredor: "DEVEDOR" | "CREDOR", nome: string, documento: string, pessoaJuridica: boolean, representante: Representante | null, endereco: string | null, contato: string | null): string {
  const doc = `${documento.length === 14 ? "CNPJ" : "CPF"} ${formatarDocumento(documento)}`;
  const partes = [`${nome}, ${doc}`];
  // O CREDOR (o provedor) é "representado"; a DEVEDORA pessoa jurídica é "representada". Devedor PF nunca tem representante (a base bloqueia).
  const verbo = devedorOuCredor === "CREDOR" ? "representado" : pessoaJuridica ? "representada" : "representado";
  if (representante) partes.push(`${verbo} por ${representante.nome}, CPF ${formatarDocumento(representante.cpf)}`);
  if (endereco) partes.push(`com endereço em ${endereco}`);
  if (contato) partes.push(contato);
  return `${devedorOuCredor}: ${partes.join(", ")}.`;
}

function contatoDoDevedor(d: BaseCanonica["devedor"]): string | null {
  const itens: string[] = [];
  if (d.email) itens.push(`e-mail ${d.email}`);
  if (d.telefone) itens.push(`telefone ${d.telefone}`);
  return itens.length ? itens.join(" e ") : null;
}

function clausulaOrigem(b: BaseCanonica): string {
  const dentro: string[] = [];
  if (b.cadastroErp) dentro.push(`cadastro nº ${b.cadastroErp} no sistema de gestão do credor`);
  if (b.plano) dentro.push(`plano ${b.plano}`);
  if (b.inicioContrato) dentro.push(`iniciada em ${dataBr(b.inicioContrato)}`);
  const parenteses = dentro.length ? ` (${dentro.join(", ")})` : "";
  const lidas = b.erpLidoEm ? `, lidas do sistema de gestão do credor em ${dataHoraBr(b.erpLidoEm)}` : "";
  return `CLÁUSULA 1ª — DA ORIGEM. A dívida confessada tem origem na relação de prestação de serviços de internet mantida com o CREDOR${parenteses}, conforme as faturas relacionadas no Anexo I — mensalidades e, quando ali indicado, multa rescisória e valor de equipamento em comodato não devolvido —${lidas}.`;
}

const valorEExtenso = (n: number) => `${formatarReais(n)} (${valorPorExtenso(n)})`;

/** O desconto do acordo é `descontoPct` sobre o valor ORIGINAL — nunca "original − saldo", que misturaria o já recebido. */
function descontoDoAcordo(b: BaseCanonica): number | null {
  if (b.valorOriginal === null || b.descontoPct === null || b.descontoPct <= 0) return null;
  return centavos((b.valorOriginal * b.descontoPct) / 100);
}

function clausulaConfissao(b: BaseCanonica): string {
  const desconto = descontoDoAcordo(b);
  if (b.valorOriginal !== null && desconto !== null) {
    const negociado = centavos(b.valorOriginal - desconto);
    const remanescente = b.recebidoDoAcordo
      ? ` O valor confessado corresponde ao saldo remanescente do acordo, já abatidos ${formatarReais(b.recebidoDoAcordo)} recebidos: ${valorEExtenso(b.valorTotal)}.`
      : ` O valor confessado é de ${valorEExtenso(b.valorTotal)}.`;
    return `CLÁUSULA 2ª — DA CONFISSÃO. O DEVEDOR reconhece e confessa dever ao CREDOR a quantia de ${valorEExtenso(b.valorOriginal)}. O CREDOR concede desconto de ${formatarReais(desconto)} (${pct(b.descontoPct!)}), condicionado ao pagamento integral e pontual das parcelas da Cláusula 3ª, resultando em ${valorEExtenso(negociado)}.${remanescente} O inadimplemento de qualquer parcela restabelece o valor original, abatidos os pagamentos efetuados.`;
  }
  const remanescente = b.origem === "acordo" && b.recebidoDoAcordo ? ` O valor corresponde ao saldo remanescente do acordo, já abatidos ${formatarReais(b.recebidoDoAcordo)} recebidos.` : "";
  return `CLÁUSULA 2ª — DA CONFISSÃO. O DEVEDOR reconhece e confessa dever ao CREDOR a quantia certa e determinada de ${valorEExtenso(b.valorTotal)}.${remanescente}`;
}

function linhaDaParcela(p: ParcelaConfessada): string {
  return `${p.n} — ${p.rotulo} — ${formatarReais(p.valor)} — ${dataBr(p.vencimento)}`;
}

function linhaDoAnexo(f: FaturaDoAnexo): string[] {
  return [f.erpRef, f.descricao ?? "", dataBr(f.vencimento), formatarReais(f.valor), ROTULO_CLASSE_DA_FATURA[f.classe], f.multa > 0 ? formatarReais(f.multa) : "", f.juros > 0 ? formatarReais(f.juros) : ""];
}

export function renderizarConfissao(b: BaseCanonica, geradoEm: string, hash: string): DocumentoRenderizado {
  const n = b.parcelas.length;
  const blocos: BlocoDoDocumento[] = [
    { tipo: "titulo", texto: "INSTRUMENTO PARTICULAR DE CONFISSÃO DE DÍVIDA" },
    { tipo: "subtitulo", texto: "DAS PARTES" },
    { tipo: "paragrafo", texto: parte("CREDOR", b.credor.razaoSocial, b.credor.cnpj, true, b.credor.representante, b.credor.endereco, null) },
    { tipo: "paragrafo", texto: parte("DEVEDOR", b.devedor.nome, b.devedor.documento, b.devedor.pessoaJuridica, b.devedor.representante, b.devedor.endereco, contatoDoDevedor(b.devedor)) },
    { tipo: "paragrafo", texto: "As partes acima qualificadas celebram o presente instrumento, que se rege pelas cláusulas seguintes." },
    { tipo: "paragrafo", texto: clausulaOrigem(b) },
    { tipo: "paragrafo", texto: clausulaConfissao(b) },
    { tipo: "paragrafo", texto: `CLÁUSULA 3ª — DO PAGAMENTO. O valor confessado será pago em ${n} parcela${n === 1 ? "" : "s"}, a saber, por ${b.meioDePagamento}:` },
    { tipo: "tabela", cabecalho: ["nº", "tipo", "valor", "vencimento"], linhas: b.parcelas.map(p => [String(p.n), p.rotulo, formatarReais(p.valor), dataBr(p.vencimento)]) },
    { tipo: "paragrafo", destaque: true, texto: `CLÁUSULA 4ª — DA MORA. O atraso no pagamento de qualquer parcela implica o vencimento antecipado do saldo, multa de ${pct(b.encargos.multaPct)} e juros de ${pct(b.encargos.jurosMesPct)} ao mês, com correção monetária pelo IPCA (Código Civil, art. 389, parágrafo único).` },
    { tipo: "paragrafo", destaque: true, texto: "CLÁUSULA 5ª — DO TÍTULO EXECUTIVO E DA ASSINATURA ELETRÔNICA. As partes declaram que este instrumento é constituído por meio eletrônico e assinado por assinatura eletrônica que ambas admitem como válida (MP 2.200-2/2001, art. 10, §2º), com integridade conferida pelo provedor de assinatura ZapSign (relatório de assinatura anexo), constituindo título executivo extrajudicial nos termos do art. 784, III e §4º, do Código de Processo Civil, dispensada a assinatura de testemunhas." },
    { tipo: "paragrafo", destaque: true, texto: "CLÁUSULA 6ª — DO FORO. Fica eleito o foro da comarca do domicílio do DEVEDOR, sem prejuízo do disposto no art. 781 do Código de Processo Civil." },
    { tipo: "subtitulo", texto: "ANEXO I — FATURAS QUE COMPÕEM A DÍVIDA" },
    { tipo: "tabela", cabecalho: ["referência", "descrição", "vencimento", "valor", "natureza", "multa", "juros"], linhas: b.anexo.map(linhaDoAnexo) },
  ];
  const avisos: string[] = [];
  if (!b.modeloRevisado) avisos.push(AVISO_SEM_PARECER);
  if (b.ambiente === "sandbox") avisos.push(AVISO_SANDBOX);
  blocos.push({ tipo: "rodape", texto: `Consulta ISP · modelo padrão v${VERSAO_DO_MODELO} · gerado em ${dataHoraBr(geradoEm)} · hash ${hash.slice(0, 8)}` });
  for (const a of avisos) blocos.push({ tipo: "rodape", texto: a });
  return { titulo: "Instrumento particular de confissão de dívida", blocos, avisos };
}

/** O documento como texto corrido — para a prévia, os testes e o log. */
export function textoDaConfissao(doc: DocumentoRenderizado): string {
  return doc.blocos.map(bl => {
    if (bl.tipo === "tabela") return [bl.cabecalho.join(" | "), ...bl.linhas.map(l => l.join(" | "))].join("\n");
    return bl.texto;
  }).join("\n\n");
}

/* ── Modelo do próprio ZapSign ───────────────────────────────────────── */

export const VARIAVEIS_DO_MODELO_ZAPSIGN = [
  "{{CREDOR_RAZAO_SOCIAL}}", "{{CREDOR_CNPJ}}", "{{CREDOR_ENDERECO}}", "{{DEVEDOR_NOME}}", "{{DEVEDOR_CPF_CNPJ}}",
  "{{DEVEDOR_REPRESENTANTE}}", "{{DEVEDOR_ENDERECO}}", "{{VALOR_TOTAL}}", "{{VALOR_POR_EXTENSO}}", "{{VALOR_ORIGINAL}}",
  "{{DESCONTO}}", "{{PARCELAS}}", "{{CADASTRO_ERP}}", "{{PLANO}}", "{{INICIO_CONTRATO}}", "{{ANEXO_FATURAS}}",
  "{{ERP_LIDO_EM}}", "{{MULTA_PCT}}", "{{JUROS_PCT}}", "{{DATA}}",
] as const;

export function variaveisDoModeloZapSign(b: BaseCanonica, geradoEm: string): Array<{ de: string; para: string }> {
  const valorDoDesconto = descontoDoAcordo(b);
  const desconto = valorDoDesconto !== null ? `${formatarReais(valorDoDesconto)} (${pct(b.descontoPct!)})` : "";
  const valores: Record<(typeof VARIAVEIS_DO_MODELO_ZAPSIGN)[number], string> = {
    "{{CREDOR_RAZAO_SOCIAL}}": b.credor.razaoSocial,
    "{{CREDOR_CNPJ}}": formatarDocumento(b.credor.cnpj),
    "{{CREDOR_ENDERECO}}": b.credor.endereco ?? "",
    "{{DEVEDOR_NOME}}": b.devedor.nome,
    "{{DEVEDOR_CPF_CNPJ}}": formatarDocumento(b.devedor.documento),
    "{{DEVEDOR_REPRESENTANTE}}": b.devedor.representante ? `${b.devedor.representante.nome}, CPF ${formatarDocumento(b.devedor.representante.cpf)}` : "",
    "{{DEVEDOR_ENDERECO}}": b.devedor.endereco ?? "",
    "{{VALOR_TOTAL}}": formatarReais(b.valorTotal),
    "{{VALOR_POR_EXTENSO}}": valorPorExtenso(b.valorTotal),
    "{{VALOR_ORIGINAL}}": b.valorOriginal === null ? "" : formatarReais(b.valorOriginal),
    "{{DESCONTO}}": desconto,
    "{{PARCELAS}}": b.parcelas.map(linhaDaParcela).join("\n"),
    "{{CADASTRO_ERP}}": b.cadastroErp ?? "",
    "{{PLANO}}": b.plano ?? "",
    "{{INICIO_CONTRATO}}": b.inicioContrato ? dataBr(b.inicioContrato) : "",
    "{{ANEXO_FATURAS}}": b.anexo.map(f => linhaDoAnexo(f).filter(Boolean).join(" — ")).join("\n"),
    "{{ERP_LIDO_EM}}": b.erpLidoEm ? dataHoraBr(b.erpLidoEm) : "",
    "{{MULTA_PCT}}": pct(b.encargos.multaPct),
    "{{JUROS_PCT}}": pct(b.encargos.jurosMesPct),
    "{{DATA}}": dataHoraBr(geradoEm),
  };
  return VARIAVEIS_DO_MODELO_ZAPSIGN.map(de => ({ de, para: valores[de] }));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run shared/cobranca/confissao-modelo.test.ts`
Expected: PASS. Se o teste de "representado/representada" falhar pela concordância, a regra é: DEVEDOR PJ → "representada" (a empresa); CREDOR → "representado" (o credor). Ajuste em `parte()` até o teste passar sem mudar o teste.

- [ ] **Step 5: Commit**

```bash
git add shared/cobranca/confissao-modelo.ts shared/cobranca/confissao-modelo.test.ts
git commit -m "feat(confissao): modelo padrão v1.0 — base canônica, render determinístico e variáveis do ZapSign"
```

---

### Task 4: Schema e migração 0037

**Files:**
- Modify: `shared/schema.ts` (depois de `cobrancaParcelas`, ~linha 1621; os imports da linha 2 já trazem `pgTable, text, integer, boolean, timestamp, decimal, serial, jsonb, index, uniqueIndex, primaryKey, date` — acrescente `uuid`)
- Create: `migrations/0037_confissao_de_divida_zapsign.sql`
- Create: `server/storage/migracao-0037-assinatura.test.ts`

**Interfaces:**
- Produces: tabelas Drizzle `assinaturaIntegracoes`, `cobrancaConfissoes`, `cobrancaConfissoesPdf`; tipos `AssinaturaIntegracao`, `InsertAssinaturaIntegracao`, `CobrancaConfissao`, `InsertCobrancaConfissao`, `CobrancaConfissaoPdf`; schemas `insertAssinaturaIntegracaoSchema`, `insertCobrancaConfissaoSchema`.

- [ ] **Step 1: Escrever o teste que falha**

`server/storage/migracao-0037-assinatura.test.ts`:

```ts
/**
 * Confissão de dívida (09/09/2026): as colunas e os índices da migração 0037
 * são os do schema. Sem esta paridade a API sobe (a migração é idempotente) e
 * o Drizzle seleciona coluna que não existe — a emissão cai com 500; ou o
 * índice parcial "uma confissão viva por cliente" não existe e duas emissões
 * simultâneas passam.
 */
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { assinaturaIntegracoes, cobrancaConfissoes, cobrancaConfissoesPdf } from "@shared/schema";

const raiz = process.cwd();
const sql = fs.readFileSync(path.resolve(raiz, "migrations/0037_confissao_de_divida_zapsign.sql"), "utf8");

function nomesDasColunas(tabela: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.values(getTableColumns(tabela) as Record<string, { name: string }>).map(c => c.name);
}

describe("migração 0037 — confissão de dívida e ZapSign", () => {
  it("não abre transação própria: o runner envolve cada arquivo na dele", () => {
    expect(sql).not.toMatch(/^\s*BEGIN\b/mi);
    expect(sql).not.toMatch(/^\s*COMMIT\b/mi);
  });
  it("cria as três tabelas de forma idempotente", () => {
    for (const t of ["assinatura_integracoes", "cobranca_confissoes", "cobranca_confissoes_pdf"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${t} (`);
    }
  });
  it.each([
    ["assinatura_integracoes", assinaturaIntegracoes],
    ["cobranca_confissoes", cobrancaConfissoes],
    ["cobranca_confissoes_pdf", cobrancaConfissoesPdf],
  ] as const)("toda coluna de %s no schema está no SQL", (nome, tabela) => {
    const bloco = sql.slice(sql.indexOf(`CREATE TABLE IF NOT EXISTS ${nome} (`));
    const fim = bloco.indexOf(");");
    const ddl = bloco.slice(0, fim);
    for (const coluna of nomesDasColunas(tabela)) {
      expect(ddl, `${nome}.${coluna}`).toMatch(new RegExp(`^\\s*${coluna}\\s`, "m"));
    }
  });
  it("os índices existem na migração e no schema, com o mesmo nome e o mesmo predicado", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS assinatura_integracoes_provider_fornecedor\s+ON assinatura_integracoes \(provider_id, fornecedor\);/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_cobranca_confissoes_cliente ON cobranca_confissoes \(provider_id, customer_id\);/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_cobranca_confissoes_status ON cobranca_confissoes \(provider_id, status\);/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_cobranca_confissoes_reconciliar ON cobranca_confissoes \(status, reconciliar_em\);/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS cobranca_confissoes_doc_token_uq\s+ON cobranca_confissoes \(zapsign_doc_token\) WHERE zapsign_doc_token IS NOT NULL;/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS cobranca_confissoes_viva_uq\s+ON cobranca_confissoes \(provider_id, customer_id\) WHERE status IN \('rascunho', 'enviada'\);/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS cobranca_confissoes_idempotencia_uq\s+ON cobranca_confissoes \(provider_id, chave_idempotencia\) WHERE chave_idempotencia IS NOT NULL;/);
    const confissoes = getTableConfig(cobrancaConfissoes).indexes.map(i => i.config.name);
    expect(confissoes).toEqual(expect.arrayContaining([
      "idx_cobranca_confissoes_cliente", "idx_cobranca_confissoes_status", "idx_cobranca_confissoes_reconciliar",
      "cobranca_confissoes_doc_token_uq", "cobranca_confissoes_viva_uq", "cobranca_confissoes_idempotencia_uq",
    ]));
    expect(getTableConfig(assinaturaIntegracoes).indexes.map(i => i.config.name)).toContain("assinatura_integracoes_provider_fornecedor");
  });
  it("o PDF tem chave composta (confissao_id, tipo) e o token é cifrado no storage, não no banco", () => {
    expect(sql).toContain("PRIMARY KEY (confissao_id, tipo)");
    const colunas = getTableColumns(assinaturaIntegracoes) as Record<string, { name: string; notNull: boolean }>;
    expect(colunas.apiToken?.name).toBe("api_token");
    expect(colunas.webhookSecret?.name).toBe("webhook_secret");
    expect(colunas.isEnabled?.notNull).toBe(true);
  });
  it("o nome segue a sequência e não colide", () => {
    const arquivos = fs.readdirSync(path.resolve(raiz, "migrations")).filter(f => f.startsWith("0037"));
    expect(arquivos).toEqual(["0037_confissao_de_divida_zapsign.sql"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/storage/migracao-0037-assinatura.test.ts`
Expected: FAIL — `assinaturaIntegracoes` não é exportado de `@shared/schema` e o arquivo SQL não existe.

- [ ] **Step 3: As três tabelas em `shared/schema.ts`**

Acrescente `uuid` ao import de `drizzle-orm/pg-core` (linha 2). Depois do bloco de `cobrancaParcelas` (termina em `]);` ~linha 1620) e antes de `insertCobrancaNegociacaoSchema`, acrescente:

```ts
/**
 * Assinatura eletrônica por provedor (confissão de dívida, spec §5.1).
 *
 * Uma conta ZapSign POR PROVEDOR: o documento sai em nome dele e quem fatura
 * é o ZapSign para ele. `api_token` vai cifrado por `encryptField`;
 * `webhook_secret` autentica o retorno e é regenerado quando token ou
 * ambiente mudam. Nenhum dos dois sai por GET — nem para o superadmin.
 */
export const assinaturaIntegracoes = pgTable("assinatura_integracoes", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  fornecedor: text("fornecedor").notNull().default("zapsign"),
  apiToken: text("api_token"),
  /** sandbox (padrão) | producao — o sandbox não tem validade jurídica. */
  ambiente: text("ambiente").notNull().default("sandbox"),
  /** id do modelo no ZapSign; null = o modelo padrão do Consulta ISP. */
  templateId: text("template_id"),
  signatarioNome: text("signatario_nome"),
  signatarioCpf: text("signatario_cpf"),
  signatarioEmail: text("signatario_email"),
  signatarioTelefone: text("signatario_telefone"),
  provedorAssina: boolean("provedor_assina").notNull().default(false),
  authModeCliente: text("auth_mode_cliente").notNull().default("assinaturaTela-tokenWhatsapp"),
  exigirSelfie: boolean("exigir_selfie").notNull().default(false),
  prazoAssinaturaDias: integer("prazo_assinatura_dias").notNull().default(15),
  enviarArquivoAssinadoWhatsapp: boolean("enviar_arquivo_assinado_whatsapp").notNull().default(false),
  modeloRevisadoEm: timestamp("modelo_revisado_em"),
  modeloRevisadoPorUserId: integer("modelo_revisado_por_user_id").references(() => users.id),
  webhookSecret: text("webhook_secret"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  ativadaEm: timestamp("ativada_em"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("assinatura_integracoes_provider_fornecedor").on(t.providerId, t.fornecedor),
]);

/**
 * A confissão de dívida (spec §5.2): a foto canônica da dívida no instante da
 * emissão (`base_canonica` + `texto_hash`, sem data/hora), o Anexo I lido do
 * ERP ao vivo, o documento no ZapSign e o estado por signatário. Os PDFs
 * ficam em `cobranca_confissoes_pdf`, fora da linha principal.
 *
 * status: rascunho → enviada → assinada | cancelada | expirada; assinada →
 * quitada | substituida. Uma confissão VIVA (rascunho/enviada) por cliente —
 * índice parcial `cobranca_confissoes_viva_uq`.
 */
export const cobrancaConfissoes = pgTable("cobranca_confissoes", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  casoId: integer("caso_id").notNull().references(() => cobrancaCasos.id),
  negociacaoId: integer("negociacao_id").references(() => cobrancaNegociacoes.id),
  /** acordo | saldo_integral */
  origem: text("origem").notNull(),
  /** sandbox | producao — foto do ambiente da integração na emissão. */
  ambiente: text("ambiente").notNull(),
  /** O `sandbox` que o ZapSign devolveu na reconsulta; divergente do `ambiente` = não aplica. */
  zapsignSandbox: boolean("zapsign_sandbox"),
  valorTotal: decimal("valor_total", { precision: 12, scale: 2 }).notNull(),
  valorOriginal: decimal("valor_original", { precision: 12, scale: 2 }),
  descontoPct: decimal("desconto_pct", { precision: 5, scale: 2 }),
  /** ParcelaConfessada[] (shared/cobranca/confissao.ts) */
  parcelas: jsonb("parcelas").notNull().default(sql`'[]'::jsonb`),
  erpSource: text("erp_source"),
  erpLidoEm: timestamp("erp_lido_em"),
  /** FaturaDoAnexo[] — o Anexo I */
  erpFaturas: jsonb("erp_faturas").notNull().default(sql`'[]'::jsonb`),
  /** padrao | zapsign */
  modelo: text("modelo").notNull().default("padrao"),
  /** versão do texto padrão ("1.0") ou o template_id do ZapSign */
  modeloVersao: text("modelo_versao").notNull(),
  modeloRevisado: boolean("modelo_revisado").notNull().default(false),
  baseCanonica: jsonb("base_canonica").notNull(),
  textoHash: text("texto_hash").notNull(),
  geradoEm: timestamp("gerado_em").notNull(),
  status: text("status").notNull().default("rascunho"),
  recusaInformadaEm: timestamp("recusa_informada_em"),
  expiracaoInformadaEm: timestamp("expiracao_informada_em"),
  reconciliarEm: timestamp("reconciliar_em"),
  zapsignDocToken: text("zapsign_doc_token"),
  webhookZapsignId: text("webhook_zapsign_id"),
  /** SignatarioDaConfissao[] — só token, sign_url, status, signed_at, auth_mode, papel */
  zapsignSigners: jsonb("zapsign_signers").notNull().default(sql`'[]'::jsonb`),
  clienteNome: text("cliente_nome"),
  clienteCpfCnpj: text("cliente_cpf_cnpj"),
  clienteEmail: text("cliente_email"),
  clienteTelefone: text("cliente_telefone"),
  clienteEmailErp: text("cliente_email_erp"),
  clienteTelefoneErp: text("cliente_telefone_erp"),
  contatoAlteradoPorUserId: integer("contato_alterado_por_user_id").references(() => users.id),
  representanteNome: text("representante_nome"),
  representanteCpf: text("representante_cpf"),
  dataLimiteAssinatura: date("data_limite_assinatura").notNull(),
  enviadaEm: timestamp("enviada_em"),
  assinadaEm: timestamp("assinada_em"),
  encerradaEm: timestamp("encerrada_em"),
  pdfOriginalSha256: text("pdf_original_sha256"),
  pdfAssinadoSha256: text("pdf_assinado_sha256"),
  criadaPorUserId: integer("criada_por_user_id").notNull().references(() => users.id),
  aprovadaPorUserId: integer("aprovada_por_user_id").references(() => users.id),
  chaveIdempotencia: uuid("chave_idempotencia"),
  erroUltimo: text("erro_ultimo"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_cobranca_confissoes_cliente").on(t.providerId, t.customerId),
  index("idx_cobranca_confissoes_status").on(t.providerId, t.status),
  // O worker de reconciliação varre TODOS os provedores por status e prazo.
  index("idx_cobranca_confissoes_reconciliar").on(t.status, t.reconciliarEm),
  uniqueIndex("cobranca_confissoes_doc_token_uq").on(t.zapsignDocToken).where(sql`zapsign_doc_token IS NOT NULL`),
  uniqueIndex("cobranca_confissoes_viva_uq").on(t.providerId, t.customerId).where(sql`status IN ('rascunho', 'enviada')`),
  uniqueIndex("cobranca_confissoes_idempotencia_uq").on(t.providerId, t.chaveIdempotencia).where(sql`chave_idempotencia IS NOT NULL`),
]);

/** Os bytes dos PDFs (original e assinado). O storage só seleciona `base64` em `obterPdf`. */
export const cobrancaConfissoesPdf = pgTable("cobranca_confissoes_pdf", {
  confissaoId: integer("confissao_id").notNull().references(() => cobrancaConfissoes.id),
  providerId: integer("provider_id").notNull().references(() => providers.id),
  /** original | assinado */
  tipo: text("tipo").notNull(),
  sha256: text("sha256").notNull(),
  tamanhoBytes: integer("tamanho_bytes").notNull(),
  base64: text("base64").notNull(),
  baixadoEm: timestamp("baixado_em"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.confissaoId, t.tipo] }),
]);

export const insertAssinaturaIntegracaoSchema = createInsertSchema(assinaturaIntegracoes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCobrancaConfissaoSchema = createInsertSchema(cobrancaConfissoes).omit({ id: true, createdAt: true, updatedAt: true });
export type AssinaturaIntegracao = typeof assinaturaIntegracoes.$inferSelect;
export type InsertAssinaturaIntegracao = z.infer<typeof insertAssinaturaIntegracaoSchema>;
export type CobrancaConfissao = typeof cobrancaConfissoes.$inferSelect;
export type InsertCobrancaConfissao = z.infer<typeof insertCobrancaConfissaoSchema>;
export type CobrancaConfissaoPdf = typeof cobrancaConfissoesPdf.$inferSelect;
```

- [ ] **Step 4: A migração `migrations/0037_confissao_de_divida_zapsign.sql`**

```sql
-- Confissão de dívida (CPC 784) com assinatura eletrônica via ZapSign
-- (desenho aprovado pelo dono em 09/09/2026, spec
-- docs/superpowers/specs/2026-09-09-confissao-de-divida-zapsign-design.md).
--
--   assinatura_integracoes   a conta ZapSign de cada provedor (token cifrado
--                            pelo servidor; webhook_secret autentica o retorno)
--   cobranca_confissoes      a confissão: foto canônica da dívida + hash,
--                            Anexo I lido do ERP ao vivo, documento e
--                            signatários no ZapSign, máquina de estados
--   cobranca_confissoes_pdf  os bytes (original e assinado), fora da linha
--
-- Sem BEGIN/COMMIT: o runner (server/migrate.ts) envolve cada arquivo numa
-- transacao — um COMMIT aqui fecharia a dele e o ROLLBACK nao desfaria nada.
CREATE TABLE IF NOT EXISTS assinatura_integracoes (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES providers(id),
  fornecedor text NOT NULL DEFAULT 'zapsign',
  api_token text,
  ambiente text NOT NULL DEFAULT 'sandbox',
  template_id text,
  signatario_nome text,
  signatario_cpf text,
  signatario_email text,
  signatario_telefone text,
  provedor_assina boolean NOT NULL DEFAULT false,
  auth_mode_cliente text NOT NULL DEFAULT 'assinaturaTela-tokenWhatsapp',
  exigir_selfie boolean NOT NULL DEFAULT false,
  prazo_assinatura_dias integer NOT NULL DEFAULT 15,
  enviar_arquivo_assinado_whatsapp boolean NOT NULL DEFAULT false,
  modelo_revisado_em timestamp,
  modelo_revisado_por_user_id integer REFERENCES users(id),
  webhook_secret text,
  is_enabled boolean NOT NULL DEFAULT false,
  ativada_em timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS assinatura_integracoes_provider_fornecedor
  ON assinatura_integracoes (provider_id, fornecedor);

CREATE TABLE IF NOT EXISTS cobranca_confissoes (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES providers(id),
  customer_id integer NOT NULL REFERENCES customers(id),
  caso_id integer NOT NULL REFERENCES cobranca_casos(id),
  negociacao_id integer REFERENCES cobranca_negociacoes(id),
  origem text NOT NULL,
  ambiente text NOT NULL,
  zapsign_sandbox boolean,
  valor_total numeric(12,2) NOT NULL,
  valor_original numeric(12,2),
  desconto_pct numeric(5,2),
  parcelas jsonb NOT NULL DEFAULT '[]'::jsonb,
  erp_source text,
  erp_lido_em timestamp,
  erp_faturas jsonb NOT NULL DEFAULT '[]'::jsonb,
  modelo text NOT NULL DEFAULT 'padrao',
  modelo_versao text NOT NULL,
  modelo_revisado boolean NOT NULL DEFAULT false,
  base_canonica jsonb NOT NULL,
  texto_hash text NOT NULL,
  gerado_em timestamp NOT NULL,
  status text NOT NULL DEFAULT 'rascunho',
  recusa_informada_em timestamp,
  expiracao_informada_em timestamp,
  reconciliar_em timestamp,
  zapsign_doc_token text,
  webhook_zapsign_id text,
  zapsign_signers jsonb NOT NULL DEFAULT '[]'::jsonb,
  cliente_nome text,
  cliente_cpf_cnpj text,
  cliente_email text,
  cliente_telefone text,
  cliente_email_erp text,
  cliente_telefone_erp text,
  contato_alterado_por_user_id integer REFERENCES users(id),
  representante_nome text,
  representante_cpf text,
  data_limite_assinatura date NOT NULL,
  enviada_em timestamp,
  assinada_em timestamp,
  encerrada_em timestamp,
  pdf_original_sha256 text,
  pdf_assinado_sha256 text,
  criada_por_user_id integer NOT NULL REFERENCES users(id),
  aprovada_por_user_id integer REFERENCES users(id),
  chave_idempotencia uuid,
  erro_ultimo text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cobranca_confissoes_cliente ON cobranca_confissoes (provider_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_cobranca_confissoes_status ON cobranca_confissoes (provider_id, status);
CREATE INDEX IF NOT EXISTS idx_cobranca_confissoes_reconciliar ON cobranca_confissoes (status, reconciliar_em);
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_confissoes_doc_token_uq
  ON cobranca_confissoes (zapsign_doc_token) WHERE zapsign_doc_token IS NOT NULL;
-- Uma confissao VIVA por cliente: emitir outra exige cancelar a existente.
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_confissoes_viva_uq
  ON cobranca_confissoes (provider_id, customer_id) WHERE status IN ('rascunho', 'enviada');
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_confissoes_idempotencia_uq
  ON cobranca_confissoes (provider_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;

CREATE TABLE IF NOT EXISTS cobranca_confissoes_pdf (
  confissao_id integer NOT NULL REFERENCES cobranca_confissoes(id),
  provider_id integer NOT NULL REFERENCES providers(id),
  tipo text NOT NULL,
  sha256 text NOT NULL,
  tamanho_bytes integer NOT NULL,
  base64 text NOT NULL,
  baixado_em timestamp,
  created_at timestamp DEFAULT now(),
  PRIMARY KEY (confissao_id, tipo)
);
```

- [ ] **Step 5: Rodar e ver passar; conferir que `verifySchema` conhece as tabelas**

Run: `npx vitest run server/storage/migracao-0037-assinatura.test.ts server/storage/faturas.migracao.test.ts`
Expected: PASS. Abra `server/migrate.ts` e leia `verifySchema`: se ela confere uma lista fixa de tabelas, acrescente as três; se lê `_migrations`, nada a fazer.

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts migrations/0037_confissao_de_divida_zapsign.sql server/storage/migracao-0037-assinatura.test.ts server/migrate.ts
git commit -m "feat(confissao): migração 0037 — assinatura_integracoes, cobranca_confissoes e os PDFs"
```

---

### Task 5: O erro de domínio e o gerador de PDF (pdfkit)

**Files:**
- Create: `server/assinatura/erro.ts`
- Create: `server/assinatura/pdf.ts`
- Create: `server/assinatura/pdf.test.ts`
- Modify: `package.json` (dependências `pdfkit`, devDependência `@types/pdfkit`)

**Interfaces:**
- Consumes: `DocumentoRenderizado`, `BlocoDoDocumento` (Task 3).
- Produces: `ErroDeConfissao` (`codigo`, `http`, `detalhes?`), `CodigoDeErroDeConfissao`; `gerarPdfDaConfissao(doc: DocumentoRenderizado): Promise<Buffer>`, `CORPO_PT = 12`, `LIMITE_DO_PDF_BYTES = 8 * 1024 * 1024`.

- [ ] **Step 1: Instalar a dependência**

```bash
npm install pdfkit@0.20.2 && npm install -D @types/pdfkit@0.17.6
```

(`pdfkit` fica fora do bundle do servidor — `script/build.ts` marca como externo tudo que não está na allowlist —, então o deploy precisa de `npm install`, que `script/deploy-vps.sh` já faz.)

- [ ] **Step 2: Escrever o erro de domínio `server/assinatura/erro.ts`**

```ts
/**
 * O erro da confissão de dívida: código estável para a tela e o HTTP que a
 * rota devolve. Lançado por storage, conector e serviços; mapeado UMA vez em
 * `confissao.routes.ts` (`responderErro`).
 */
export type CodigoDeErroDeConfissao =
  | "NAO_CONFIGURADA"        // 409 — sem integração ativa
  | "CREDENCIAL_ILEGIVEL"    // 409 — token gravado não abre (SESSION_SECRET mudou)
  | "EM_ANDAMENTO"           // 409 — trava ocupada
  | "BASE_MUDOU"             // 409 — baseHash divergente
  | "CONFISSAO_VIVA"         // 409 — já existe rascunho/enviada
  | "BLOQUEADA"              // 422 — bloqueios da base (detalhes.bloqueios)
  | "ESTADO_INVALIDO"        // 409 — transição não permitida
  | "JA_ASSINADA"            // 409 — cancelar depois de assinada
  | "NAO_ENCONTRADA"         // 404
  | "REENVIO_CEDO"           // 429 — reenvio dentro da janela
  | "AMBIENTE_DIVERGENTE"    // 409 — sandbox do ZapSign ≠ ambiente da linha
  | "ARQUIVO_GRANDE"         // 422 — signed_file > 8 MB
  | "ZAPSIGN_CREDENCIAL"     // 422
  | "ZAPSIGN_CREDITOS"       // 422
  | "ZAPSIGN_LIMITE"         // 429
  | "ZAPSIGN_RECUSOU"        // 422
  | "ZAPSIGN_INDISPONIVEL";  // 502

export class ErroDeConfissao extends Error {
  constructor(
    readonly codigo: CodigoDeErroDeConfissao,
    mensagem: string,
    readonly http: number = 409,
    readonly detalhes?: Record<string, unknown>,
  ) {
    super(mensagem);
    this.name = "ErroDeConfissao";
  }
}
```

- [ ] **Step 3: Escrever o teste do PDF que falha**

`server/assinatura/pdf.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { baseCanonica, renderizarConfissao, type EntradaDoModelo } from "@shared/cobranca/confissao-modelo";
import { CORPO_PT, gerarPdfDaConfissao } from "./pdf";

const entrada: EntradaDoModelo = {
  origem: "saldo_integral", ambiente: "sandbox", modeloRevisado: false,
  credor: { razaoSocial: "NsLink Telecom Ltda", cnpj: "12345678000199", endereco: "Rua A, 10, Centro, Lavras/MG", representante: null },
  devedor: { nome: "Maria da Silva", documento: "12345678901", pessoaJuridica: false, representante: null, endereco: "Rua B, 20", email: "maria@example.com", telefone: "31999990000" },
  cadastroErp: "4471", plano: "Fibra 300", inicioContrato: "2024-03-15", erpLidoEm: "2026-09-09T17:30:00.000Z",
  valorTotal: 719.86, valorOriginal: null, descontoPct: null, recebidoDoAcordo: null,
  parcelas: [{ n: 1, rotulo: "parcela", valor: 719.86, vencimento: "2026-10-10" }],
  meioDePagamento: "boleto ou PIX enviado pelo credor", encargos: { multaPct: 2, jurosMesPct: 1 },
  anexo: Array.from({ length: 40 }, (_, i) => ({ chave: `F-${i + 1}`, erpRef: `F-${i + 1}`, descricao: `Mensalidade ${i + 1}`, vencimento: "2026-07-10", valor: 99.9, classe: "servico" as const, diasAtraso: 61, multa: 2, juros: 2.03 })),
};

/** O conteúdo sem compressão: os textos saem como <hex> WinAnsi em operadores TJ. */
function textoDoPdf(pdf: Buffer): string {
  const conteudo = pdf.toString("latin1");
  return Array.from(conteudo.matchAll(/<([0-9a-fA-F]+)>/g)).map(m => Buffer.from(m[1], "hex").toString("latin1")).join("");
}

describe("PDF da confissão", () => {
  it("é um PDF válido, pequeno, com corpo 12 pt, destaque em negrito e o texto presente", async () => {
    const doc = renderizarConfissao(baseCanonica(entrada), "2026-09-09T17:31:00.000Z", "abcdef0123456789");
    const pdf = await gerarPdfDaConfissao(doc);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeLessThan(1024 * 1024);
    const bruto = pdf.toString("latin1");
    expect(bruto).toMatch(new RegExp(`/F\\d+ ${CORPO_PT} Tf`));
    expect(bruto).toContain("/BaseFont /Helvetica-Bold");
    expect(bruto).toContain("/Type /Page\n"); // ao menos uma página; o anexo de 40 linhas força mais de uma
    expect((bruto.match(/\/Type \/Page\n/g) ?? []).length).toBeGreaterThan(1);
    // Cada linha do PDF é um <hex> próprio: tirando os espaços, uma quebra de
    // linha no meio da frase deixa de importar.
    const texto = textoDoPdf(pdf).replace(/\s+/g, "");
    expect(texto).toContain("confessadeveraoCREDOR");
    expect(texto).toContain("F-40");
    expect(texto).toContain("SEMPARECERJUR");
    expect(texto).toContain("AMBIENTEDETESTES");
  });
  it("dois PDFs do mesmo documento têm o mesmo texto (o binário difere só por data de criação)", async () => {
    const doc = renderizarConfissao(baseCanonica(entrada), "2026-09-09T17:31:00.000Z", "ff");
    const [a, b] = await Promise.all([gerarPdfDaConfissao(doc), gerarPdfDaConfissao(doc)]);
    expect(textoDoPdf(a)).toBe(textoDoPdf(b));
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run server/assinatura/pdf.test.ts`
Expected: FAIL — `./pdf` inexistente.

- [ ] **Step 5: Escrever `server/assinatura/pdf.ts`**

```ts
/**
 * Documento renderizado → PDF. pdfkit com as fontes padrão (Helvetica,
 * WinAnsi cobre o português), corpo 12 pt no mínimo, cláusulas em destaque
 * em negrito (CDC art. 54, §§3º e 4º). `compress: false` de propósito: o
 * texto fica legível no fluxo (o teste confere) e o tamanho de um contrato de
 * poucas páginas é irrelevante.
 */
import PDFDocument from "pdfkit";
import type { BlocoDoDocumento, DocumentoRenderizado } from "@shared/cobranca/confissao-modelo";

export const CORPO_PT = 12;
export const LIMITE_DO_PDF_BYTES = 8 * 1024 * 1024;

const MARGEM = 56;

export function gerarPdfDaConfissao(doc: DocumentoRenderizado): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: "A4",
      margins: { top: MARGEM, bottom: MARGEM, left: MARGEM, right: MARGEM },
      compress: false,
      info: { Title: doc.titulo, Producer: "Consulta ISP", Creator: "Consulta ISP" },
    });
    const partes: Buffer[] = [];
    pdf.on("data", (c: Buffer) => partes.push(c));
    pdf.on("end", () => resolve(Buffer.concat(partes)));
    pdf.on("error", reject);
    try {
      for (const bloco of doc.blocos) escrever(pdf, bloco);
      pdf.end();
    } catch (e) {
      reject(e);
    }
  });
}

function escrever(pdf: PDFKit.PDFDocument, bloco: BlocoDoDocumento): void {
  switch (bloco.tipo) {
    case "titulo":
      pdf.font("Helvetica-Bold").fontSize(16).text(bloco.texto, { align: "center" }).moveDown(1);
      return;
    case "subtitulo":
      pdf.font("Helvetica-Bold").fontSize(CORPO_PT).text(bloco.texto).moveDown(0.5);
      return;
    case "paragrafo":
      pdf.font(bloco.destaque ? "Helvetica-Bold" : "Helvetica").fontSize(CORPO_PT).text(bloco.texto, { align: "justify" }).moveDown(0.8);
      return;
    case "tabela":
      tabela(pdf, bloco.cabecalho, bloco.linhas);
      return;
    case "rodape":
      pdf.font("Helvetica").fontSize(9).fillColor("#444444").text(bloco.texto, { align: "center" }).fillColor("#000000").moveDown(0.3);
      return;
  }
}

function tabela(pdf: PDFKit.PDFDocument, cabecalho: string[], linhas: string[][]): void {
  const larguraUtil = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const larguraColuna = larguraUtil / cabecalho.length;
  const fundo = pdf.page.height - pdf.page.margins.bottom;
  const linha = (celulas: string[], negrito: boolean) => {
    pdf.font(negrito ? "Helvetica-Bold" : "Helvetica").fontSize(10);
    const altura = Math.max(...celulas.map(c => pdf.heightOfString(c || " ", { width: larguraColuna - 4 })));
    if (pdf.y + altura + 4 > fundo) pdf.addPage();
    const y = pdf.y;
    celulas.forEach((c, i) => {
      pdf.text(c || " ", pdf.page.margins.left + i * larguraColuna, y, { width: larguraColuna - 4, lineBreak: true });
    });
    pdf.x = pdf.page.margins.left;
    pdf.y = y + altura + 4;
  };
  linha(cabecalho, true);
  for (const l of linhas) linha(l, false);
  pdf.moveDown(0.8);
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run server/assinatura/pdf.test.ts`
Expected: PASS. Se `/Type /Page\n` não bater pela quebra de linha do pdfkit, troque a asserção por `/\/Type \/Page\b/g` (sem o `\n`) — o que se confere é "mais de uma página", não o byte da quebra.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/assinatura/erro.ts server/assinatura/pdf.ts server/assinatura/pdf.test.ts
git commit -m "feat(confissao): erro de domínio e PDF do modelo padrão (pdfkit, corpo 12 pt, cláusulas em destaque)"
```

---

### Task 6: O conector do ZapSign

**Files:**
- Create: `server/assinatura/zapsign.ts`
- Create: `server/assinatura/zapsign.test.ts`

**Interfaces:**
- Consumes: `ErroDeConfissao` (Task 5), `AmbienteDeAssinatura` (Task 1).
- Produces: `HOSTS_DO_ZAPSIGN`, `clienteZapSign({ apiToken, ambiente, fetchImpl?, timeoutMs? }): ClienteZapSign` com `criarDocumentoPorPdf`, `criarDocumentoPorModelo`, `adicionarSignatario`, `atualizarSignatario`, `detalharDocumento`, `excluirDocumento`, `registrarWebhookDoDocumento`, `excluirWebhook`, `reenviarNotificacoes`, `testarToken`, `baixarArquivo`; tipos `SignatarioParaCriar`, `DocumentoPorPdf`, `DocumentoPorModelo`, `DocumentoDoZapSign`, `SignatarioDoZapSign`.

- [ ] **Step 1: Escrever o teste que falha**

`server/assinatura/zapsign.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { HOSTS_DO_ZAPSIGN, clienteZapSign } from "./zapsign";
import { ErroDeConfissao } from "./erro";

type Chamada = { url: string; init: RequestInit };
function fetchFalso(respostas: Array<{ status: number; corpo?: unknown; headers?: Record<string, string> }>) {
  const chamadas: Chamada[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    const r = respostas.shift() ?? { status: 200, corpo: {} };
    return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  });
  return { chamadas, fetchImpl: fetchImpl as unknown as typeof fetch };
}
const corpoDe = (c: Chamada) => JSON.parse(String(c.init.body));

describe("conector do ZapSign", () => {
  it("fala com o host do ambiente pedido e manda o Bearer", async () => {
    const { chamadas, fetchImpl } = fetchFalso([{ status: 200, corpo: { count: 0, results: [] } }]);
    await clienteZapSign({ apiToken: "tok-1", ambiente: "sandbox", fetchImpl }).testarToken();
    expect(chamadas[0].url).toBe(`${HOSTS_DO_ZAPSIGN.sandbox}/docs/?page=1`);
    expect((chamadas[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    const prod = fetchFalso([{ status: 200, corpo: [] }]);
    await clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl: prod.fetchImpl }).testarToken();
    expect(prod.chamadas[0].url.startsWith("https://api.zapsign.com.br/api/v1/")).toBe(true);
  });
  it("cria documento por PDF com os campos da spec e devolve token e signatários (campos extras descartados)", async () => {
    const { chamadas, fetchImpl } = fetchFalso([{ status: 200, corpo: {
      token: "doc-1", status: "pending", sandbox: true,
      signers: [{ token: "s-1", status: "new", sign_url: "https://app.zapsign.com.br/verificar/s-1", auth_mode: "assinaturaTela-tokenWhatsapp", liveness_photo_url: "x", geo_latitude: 1, ip: "1.1.1.1" }],
    } }]);
    const doc = await clienteZapSign({ apiToken: "t", ambiente: "sandbox", fetchImpl }).criarDocumentoPorPdf({
      name: "Confissão de dívida — Maria — NsLink", base64_pdf: "JVBERi0=", lang: "pt-br", external_id: "confissao:7", folder_path: "consulta-isp/1",
      date_limit_to_sign: "2026-09-24", reminder_every_n_days: 3, allow_refuse_signature: true, signature_order_active: false,
      signers: [{ name: "Maria", email: "m@x.com", phone_country: "55", phone_number: "31999990000", auth_mode: "assinaturaTela-tokenWhatsapp", cpf: "12345678901", require_cpf: true, validate_cpf: true, send_automatic_email: false, send_automatic_whatsapp: false, lock_name: true }],
    });
    expect(chamadas[0].url).toBe(`${HOSTS_DO_ZAPSIGN.sandbox}/docs/`);
    expect(chamadas[0].init.method).toBe("POST");
    expect(corpoDe(chamadas[0])).toMatchObject({ base64_pdf: "JVBERi0=", date_limit_to_sign: "2026-09-24", reminder_every_n_days: 3, allow_refuse_signature: true });
    expect(doc.token).toBe("doc-1");
    expect(doc.signers[0]).toEqual({ token: "s-1", status: "new", sign_url: "https://app.zapsign.com.br/verificar/s-1", signed_at: null, auth_mode: "assinaturaTela-tokenWhatsapp", external_id: null });
    expect(JSON.stringify(doc)).not.toContain("liveness");
  });
  it("cria por modelo e adiciona/atualiza signatário nos caminhos certos", async () => {
    const { chamadas, fetchImpl } = fetchFalso([
      { status: 200, corpo: { token: "doc-2", status: "pending", signers: [{ token: "s-2", status: "new" }] } },
      { status: 200, corpo: { token: "s-3", status: "new", sign_url: "u" } },
      { status: 200, corpo: { token: "s-2", status: "new" } },
    ]);
    const c = clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl });
    await c.criarDocumentoPorModelo({ template_id: "tpl-1", signer_name: "Maria", signer_email: "m@x.com", signer_phone_country: "55", signer_phone_number: "31999990000", data: [{ de: "{{VALOR_TOTAL}}", para: "R$ 1,00" }], external_id: "confissao:8", folder_path: "consulta-isp/1", date_limit_to_sign: "2026-09-24", reminder_every_n_days: 3, allow_refuse_signature: true, lang: "pt-br", send_automatic_email: true, send_automatic_whatsapp: false });
    await c.adicionarSignatario("doc-2", { name: "Ana", email: "a@x.com", auth_mode: "assinaturaTela-tokenEmail", order_group: 1 });
    await c.atualizarSignatario("s-2", { auth_mode: "assinaturaTela-tokenWhatsapp", cpf: "12345678901", require_cpf: true, validate_cpf: true });
    expect(chamadas.map(x => x.url)).toEqual([
      `${HOSTS_DO_ZAPSIGN.producao}/models/create-doc/`,
      `${HOSTS_DO_ZAPSIGN.producao}/docs/doc-2/add-signer/`,
      `${HOSTS_DO_ZAPSIGN.producao}/signers/s-2/`,
    ]);
    expect(corpoDe(chamadas[0]).data).toEqual([{ de: "{{VALOR_TOTAL}}", para: "R$ 1,00" }]);
  });
  it("detalha, exclui, registra o webhook DO DOCUMENTO com o cabeçalho na criação, exclui webhook e reenvia em massa", async () => {
    const { chamadas, fetchImpl } = fetchFalso([
      { status: 200, corpo: { token: "doc-1", status: "signed", signed_at: "2026-09-10T12:00:00Z", signed_file: "https://s3/x.pdf", original_file: "https://s3/o.pdf", deleted: false, sandbox: false, signers: [{ token: "s-1", status: "signed", signed_at: "2026-09-10T12:00:00Z", auth_mode: "assinaturaTela-tokenWhatsapp", answers: [] }] } },
      { status: 200, corpo: {} },
      { status: 200, corpo: { id: 4242 } },
      { status: 200, corpo: {} },
      { status: 200, corpo: { success: true, total_signers: 1, sent_count: 1, failed_count: 0, failed_signers: [] } },
    ]);
    const c = clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl });
    const d = await c.detalharDocumento("doc-1");
    expect(d).toMatchObject({ status: "signed", deleted: false, sandbox: false, signed_file: "https://s3/x.pdf" });
    expect(JSON.stringify(d)).not.toContain("answers");
    await c.excluirDocumento("doc-1");
    const w = await c.registrarWebhookDoDocumento({ url: "https://consultaisp.com.br/api/webhooks/zapsign/1", docToken: "doc-1", cabecalho: { nome: "X-Consulta-ISP-Assinatura", valor: "segredo" } });
    expect(w).toEqual({ id: "4242" });
    await c.excluirWebhook("4242");
    const r = await c.reenviarNotificacoes("doc-1");
    expect(r).toEqual({ enviados: 1, falhas: 0 });
    expect(chamadas.map(x => `${x.init.method} ${x.url}`)).toEqual([
      `GET ${HOSTS_DO_ZAPSIGN.producao}/docs/doc-1/`,
      `DELETE ${HOSTS_DO_ZAPSIGN.producao}/docs/doc-1/`,
      `POST ${HOSTS_DO_ZAPSIGN.producao}/user/company/webhook/`,
      `DELETE ${HOSTS_DO_ZAPSIGN.producao}/user/company/webhook/delete/`,
      `POST ${HOSTS_DO_ZAPSIGN.producao}/docs/doc-1/resend-notifications-bulk/`,
    ]);
    expect(corpoDe(chamadas[2])).toEqual({ url: "https://consultaisp.com.br/api/webhooks/zapsign/1", type: "", doc_token: "doc-1", headers: [{ name: "X-Consulta-ISP-Assinatura", value: "segredo" }] });
    expect(corpoDe(chamadas[3])).toEqual({ id: "4242" });
  });
  it.each([
    [401, "ZAPSIGN_CREDENCIAL", 422], [403, "ZAPSIGN_CREDENCIAL", 422], [402, "ZAPSIGN_CREDITOS", 422],
    [429, "ZAPSIGN_LIMITE", 429], [400, "ZAPSIGN_RECUSOU", 422], [404, "NAO_ENCONTRADA", 404], [500, "ZAPSIGN_INDISPONIVEL", 502], [503, "ZAPSIGN_INDISPONIVEL", 502],
  ])("HTTP %s vira %s (%s) sem vazar o corpo", async (status, codigo, http) => {
    const { fetchImpl } = fetchFalso([{ status, corpo: { detail: "token secreto abc123 no corpo" }, headers: status === 429 ? { "retry-after": "90" } : {} }]);
    const c = clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl });
    const erro = await c.detalharDocumento("doc-1").catch(e => e);
    expect(erro).toBeInstanceOf(ErroDeConfissao);
    expect(erro.codigo).toBe(codigo);
    expect(erro.http).toBe(http);
    expect(erro.message).not.toContain("abc123");
    if (status === 429) expect(erro.detalhes).toEqual({ aguardarSegundos: 90 });
  });
  it("rede fora ou timeout = indisponível", async () => {
    const fetchImpl = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const erro = await clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl }).testarToken().catch(e => e);
    expect(erro.codigo).toBe("ZAPSIGN_INDISPONIVEL");
  });
  it("baixa o arquivo assinado até o limite e recusa acima dele", async () => {
    const grande = new Uint8Array(11);
    const fetchImpl = (async () => new Response(grande, { status: 200 })) as unknown as typeof fetch;
    const c = clienteZapSign({ apiToken: "t", ambiente: "producao", fetchImpl });
    expect((await c.baixarArquivo("https://s3/x.pdf", 11)).length).toBe(11);
    const erro = await c.baixarArquivo("https://s3/x.pdf", 10).catch(e => e);
    expect(erro.codigo).toBe("ARQUIVO_GRANDE");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/assinatura/zapsign.test.ts`
Expected: FAIL — `./zapsign` inexistente.

- [ ] **Step 3: Escrever `server/assinatura/zapsign.ts`**

```ts
/**
 * Conector do ZapSign — HTTP puro, sem estado, no host do AMBIENTE pedido.
 *
 * Doc conferida em 09/09/2026 (docs.zapsign.com.br). Erros viram
 * `ErroDeConfissao` por status, SEM o corpo da resposta na mensagem: o corpo
 * do ZapSign pode ecoar dados do signatário e o nosso log de erro é lido por
 * gente. O que volta do ZapSign passa por Zod com `strip`: `liveness_photo_url`,
 * `geo_*`, `ip`, `answers` morrem aqui na borda (spec §6.3).
 */
import { z } from "zod";
import type { AmbienteDeAssinatura } from "@shared/cobranca/confissao";
import { ErroDeConfissao } from "./erro";

export const HOSTS_DO_ZAPSIGN: Record<AmbienteDeAssinatura, string> = {
  sandbox: "https://sandbox.api.zapsign.com.br/api/v1",
  producao: "https://api.zapsign.com.br/api/v1",
};

export interface SignatarioParaCriar {
  name: string;
  email?: string;
  phone_country?: string;
  phone_number?: string;
  auth_mode: string;
  cpf?: string;
  require_cpf?: boolean;
  validate_cpf?: boolean;
  require_selfie_photo?: boolean;
  send_automatic_email?: boolean;
  send_automatic_whatsapp?: boolean;
  send_automatic_whatsapp_signed_file?: boolean;
  lock_name?: boolean;
  lock_email?: boolean;
  lock_phone?: boolean;
  external_id?: string;
  order_group?: number;
  qualification?: string;
  custom_message?: string;
}

export interface DocumentoPorPdf {
  name: string;
  base64_pdf: string;
  signers: SignatarioParaCriar[];
  lang: "pt-br";
  external_id: string;
  folder_path: string;
  brand_name?: string;
  date_limit_to_sign: string;
  reminder_every_n_days: number;
  allow_refuse_signature: boolean;
  signature_order_active: boolean;
  disable_signer_emails?: boolean;
}

export interface DocumentoPorModelo {
  template_id: string;
  signer_name: string;
  signer_email?: string;
  signer_phone_country?: string;
  signer_phone_number?: string;
  data: Array<{ de: string; para: string }>;
  lang: "pt-br";
  external_id: string;
  folder_path: string;
  date_limit_to_sign: string;
  reminder_every_n_days: number;
  allow_refuse_signature: boolean;
  signature_order_active?: boolean;
  send_automatic_email?: boolean;
  send_automatic_whatsapp?: boolean;
}

const SignatarioSchema = z.object({
  token: z.string(),
  status: z.string().default("new"),
  sign_url: z.string().nullish().transform(v => v ?? null),
  signed_at: z.string().nullish().transform(v => v ?? null),
  auth_mode: z.string().nullish().transform(v => v ?? null),
  external_id: z.string().nullish().transform(v => v ?? null),
});
export type SignatarioDoZapSign = z.infer<typeof SignatarioSchema>;

const DocumentoSchema = z.object({
  token: z.string(),
  status: z.string(),
  signed_at: z.string().nullish().transform(v => v ?? null),
  signed_file: z.string().nullish().transform(v => v ?? null),
  original_file: z.string().nullish().transform(v => v ?? null),
  deleted: z.boolean().default(false),
  sandbox: z.boolean().default(false),
  signers: z.array(SignatarioSchema).default([]),
});
export type DocumentoDoZapSign = z.infer<typeof DocumentoSchema>;

export interface ClienteZapSign {
  criarDocumentoPorPdf(d: DocumentoPorPdf): Promise<DocumentoDoZapSign>;
  criarDocumentoPorModelo(d: DocumentoPorModelo): Promise<DocumentoDoZapSign>;
  adicionarSignatario(docToken: string, s: SignatarioParaCriar): Promise<SignatarioDoZapSign>;
  atualizarSignatario(signerToken: string, patch: Partial<SignatarioParaCriar>): Promise<SignatarioDoZapSign>;
  detalharDocumento(docToken: string): Promise<DocumentoDoZapSign>;
  excluirDocumento(docToken: string): Promise<void>;
  registrarWebhookDoDocumento(w: { url: string; docToken: string; cabecalho: { nome: string; valor: string } }): Promise<{ id: string }>;
  excluirWebhook(id: string): Promise<void>;
  reenviarNotificacoes(docToken: string): Promise<{ enviados: number; falhas: number }>;
  testarToken(): Promise<void>;
  baixarArquivo(url: string, maxBytes: number): Promise<Buffer>;
}

function erroPorStatus(status: number, aguardar: string | null): ErroDeConfissao {
  if (status === 401 || status === 403) return new ErroDeConfissao("ZAPSIGN_CREDENCIAL", "O ZapSign recusou o token da conta do provedor — confira em Configurações > Integrações > API ZapSign", 422);
  if (status === 402) return new ErroDeConfissao("ZAPSIGN_CREDITOS", "A conta ZapSign do provedor está sem créditos ou sem cota de documentos", 422);
  if (status === 404) return new ErroDeConfissao("NAO_ENCONTRADA", "O documento não existe no ZapSign", 404);
  if (status === 429) {
    const segundos = aguardar ? Number.parseInt(aguardar, 10) : NaN;
    return new ErroDeConfissao("ZAPSIGN_LIMITE", "O ZapSign pediu para aguardar antes de repetir", 429, Number.isFinite(segundos) ? { aguardarSegundos: segundos } : undefined);
  }
  if (status >= 500) return new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", `O ZapSign não respondeu (HTTP ${status})`, 502);
  return new ErroDeConfissao("ZAPSIGN_RECUSOU", `O ZapSign recusou a requisição (HTTP ${status})`, 422);
}

export function clienteZapSign(config: { apiToken: string; ambiente: AmbienteDeAssinatura; fetchImpl?: typeof fetch; timeoutMs?: number }): ClienteZapSign {
  const base = HOSTS_DO_ZAPSIGN[config.ambiente];
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 20_000;

  async function chamar<T>(metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown, schema?: z.ZodType<T>): Promise<T> {
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), timeoutMs);
    let resposta: Response;
    try {
      resposta = await fetchImpl(`${base}${caminho}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json", Accept: "application/json" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controlador.signal,
      });
    } catch {
      throw new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "O ZapSign não respondeu (rede ou tempo esgotado)", 502);
    } finally {
      clearTimeout(timer);
    }
    if (!resposta.ok) throw erroPorStatus(resposta.status, resposta.headers.get("retry-after"));
    if (!schema) return undefined as T;
    const json = await resposta.json().catch(() => ({}));
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ErroDeConfissao("ZAPSIGN_RECUSOU", "O ZapSign respondeu num formato que o Consulta ISP não reconhece", 502);
    return parsed.data;
  }

  return {
    criarDocumentoPorPdf: d => chamar("POST", "/docs/", d, DocumentoSchema),
    criarDocumentoPorModelo: d => chamar("POST", "/models/create-doc/", d, DocumentoSchema),
    adicionarSignatario: (docToken, s) => chamar("POST", `/docs/${encodeURIComponent(docToken)}/add-signer/`, s, SignatarioSchema),
    atualizarSignatario: (signerToken, patch) => chamar("POST", `/signers/${encodeURIComponent(signerToken)}/`, patch, SignatarioSchema),
    detalharDocumento: docToken => chamar("GET", `/docs/${encodeURIComponent(docToken)}/`, undefined, DocumentoSchema),
    excluirDocumento: docToken => chamar("DELETE", `/docs/${encodeURIComponent(docToken)}/`),
    registrarWebhookDoDocumento: async w => {
      const r = await chamar("POST", "/user/company/webhook/", { url: w.url, type: "", doc_token: w.docToken, headers: [{ name: w.cabecalho.nome, value: w.cabecalho.valor }] }, z.object({ id: z.union([z.string(), z.number()]) }));
      return { id: String(r.id) };
    },
    excluirWebhook: id => chamar("DELETE", "/user/company/webhook/delete/", { id }),
    reenviarNotificacoes: async docToken => {
      const r = await chamar("POST", `/docs/${encodeURIComponent(docToken)}/resend-notifications-bulk/`, {}, z.object({ sent_count: z.number().default(0), failed_count: z.number().default(0) }));
      return { enviados: r.sent_count, falhas: r.failed_count };
    },
    testarToken: async () => { await chamar("GET", "/docs/?page=1", undefined, z.unknown()); },
    baixarArquivo: async (url, maxBytes) => {
      let resposta: Response;
      try {
        resposta = await fetchImpl(url);
      } catch {
        throw new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "Não foi possível baixar o arquivo do ZapSign", 502);
      }
      if (!resposta.ok) throw erroPorStatus(resposta.status, null);
      const declarado = Number(resposta.headers.get("content-length") ?? 0);
      if (declarado > maxBytes) throw new ErroDeConfissao("ARQUIVO_GRANDE", `O arquivo assinado passa de ${Math.round(maxBytes / 1024 / 1024)} MB`, 422);
      const bytes = Buffer.from(await resposta.arrayBuffer());
      if (bytes.length > maxBytes) throw new ErroDeConfissao("ARQUIVO_GRANDE", `O arquivo assinado passa de ${Math.round(maxBytes / 1024 / 1024)} MB`, 422);
      return bytes;
    },
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run server/assinatura/zapsign.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/assinatura/zapsign.ts server/assinatura/zapsign.test.ts
git commit -m "feat(confissao): conector do ZapSign por ambiente, com erros mapeados sem vazar corpo"
```

---

### Task 7: `AssinaturaStorage` e a fachada

**Files:**
- Create: `server/storage/assinatura.storage.ts`
- Create: `server/storage/assinatura.storage.test.ts`
- Modify: `server/storage/index.ts` (interface `IStorage` ~linha 368 e classe `DatabaseStorage` ~linha 671/686)
- Modify: `server/storage/storage-fachada.test.ts` (novo `describe` para `AssinaturaStorage`)

**Interfaces:**
- Consumes: as tabelas (Task 4), `encryptField`/`decryptField` (`server/utils/crypto.ts`), `ErroDeConfissao` (Task 5), `transicaoDeConfissaoPermitida` e tipos (Task 1).
- Produces (todos com `providerId` como primeiro argumento, salvo os do worker/LGPD, que varrem todos os provedores):
  - `getIntegracaoParaAdmin(providerId): Promise<IntegracaoDeAssinaturaParaAdmin | undefined>` — sem token e sem segredo
  - `getIntegracaoComCredencial(providerId): Promise<IntegracaoComCredencial | undefined>` — token decifrado; lança `CREDENCIAL_ILEGIVEL`
  - `salvarIntegracaoDeAssinatura(providerId, dados: DadosDaIntegracaoDeAssinatura): Promise<void>`
  - `ativarIntegracaoDeAssinatura(providerId): Promise<void>`
  - `marcarModeloRevisado(providerId, userId): Promise<void>`
  - `webhookSecretDoProvedor(providerId): Promise<{ webhookSecret: string | null; isEnabled: boolean; ambiente: string } | undefined>`
  - `criarConfissao(providerId, dados: NovaConfissao): Promise<CobrancaConfissao>`
  - `obterConfissao(providerId, id)`, `obterConfissaoPorToken(providerId, docToken)`, `obterConfissaoPorChave(providerId, chave)`, `confissaoVivaDoCliente(providerId, customerId)`, `confissaoAssinadaVivaDoCliente(providerId, customerId)`, `confissaoEnviadaDaNegociacao(providerId, negociacaoId)` — todos `Promise<CobrancaConfissao | undefined>`
  - `listarConfissoesDoCliente(providerId, customerId): Promise<CobrancaConfissao[]>`
  - `confissoesAssinadasVivasPorCliente(providerId, customerIds: number[]): Promise<Map<number, ConfissaoAssinadaViva>>`
  - `atualizarConfissao(providerId, id, patch: PatchDeConfissao): Promise<CobrancaConfissao | undefined>`
  - `transicionarConfissao(providerId, id, de, para, patch?: PatchDeConfissao): Promise<CobrancaConfissao | undefined>` — atômica (`WHERE status = de`)
  - `marcarSubstituidas(providerId, customerId, novaId): Promise<number>`
  - `guardarPdf(providerId, confissaoId, tipo: TipoDePdf, bytes: Buffer): Promise<{ sha256: string; tamanhoBytes: number }>`
  - `obterPdf(providerId, confissaoId, tipo, opcoes?: { registrarDownload?: boolean }): Promise<PdfDaConfissao | undefined>`
  - `apagarPdfs(providerId, confissaoId): Promise<void>`
  - `confissoesParaReconciliar(agora: Date, enviadasHaMaisDeMs: number): Promise<CobrancaConfissao[]>`
  - `confissoesParaExpirar(hoje: string): Promise<CobrancaConfissao[]>`
  - `confissoesParaRetencao(limite: Date, maximo?: number): Promise<Array<{ id: number; providerId: number }>>`
  - `anonimizarConfissao(providerId, id): Promise<void>`
  - `confissoesDoTitular(cpfCnpj: string): Promise<ConfissaoDoTitular[]>`

- [ ] **Step 1: Escrever o teste que falha**

`server/storage/assinatura.storage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `AssinaturaStorage`: toda consulta leva o provider_id; o token entra
 * cifrado e nunca sai pela leitura do admin; o PDF só sai por `obterPdf`;
 * as transições são atômicas (`WHERE status = de`) e a máquina de estados
 * recusa antes de ir ao banco. Mesmo banco de mentira (pg-proxy) dos outros
 * storages: o SQL que o Drizzle gera é o que se confere.
 */
const banco = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[]; method: string }[],
  responder: null as null | ((sql: string, params: unknown[]) => unknown[][]),
  db: null as any,
}));
vi.mock("../db", () => ({ db: new Proxy({} as any, { get: (_alvo, chave) => banco.db[chave] }), pool: {} }));
vi.hoisted(() => { process.env.SESSION_SECRET ||= "segredo-de-teste-sem-nenhum-valor-real"; });

import { drizzle } from "drizzle-orm/pg-proxy";
import { decryptField } from "../utils/crypto";
import { AssinaturaStorage } from "./assinatura.storage";

const PROVEDOR = 6;
let storage: AssinaturaStorage;
beforeEach(() => {
  banco.consultas.length = 0;
  banco.responder = null;
  banco.db = drizzle(async (sqlTexto, params, method) => {
    banco.consultas.push({ sql: sqlTexto, params, method });
    return { rows: banco.responder ? banco.responder(sqlTexto, params) : [] };
  });
  storage = new AssinaturaStorage();
});

function conferirTenant(c: { sql: string; params: unknown[] }) {
  const oc = Array.from(c.sql.matchAll(/"provider_id" = \$(\d+)/g));
  expect(oc.length, c.sql).toBeGreaterThan(0);
  for (const o of oc) expect(c.params[Number(o[1]) - 1]).toBe(PROVEDOR);
}

/** A linha de `assinatura_integracoes` na ordem do select explícito de `colunasDaIntegracao`. */
function linhaDaIntegracao(sobrescrever: Partial<Record<string, unknown>> = {}): unknown[] {
  const base: Record<string, unknown> = {
    id: 1, providerId: PROVEDOR, apiToken: null, ambiente: "sandbox", templateId: null, signatarioNome: null, signatarioCpf: null,
    signatarioEmail: null, signatarioTelefone: null, provedorAssina: false, authModeCliente: "assinaturaTela-tokenWhatsapp", exigirSelfie: false,
    prazoAssinaturaDias: 15, enviarArquivoAssinadoWhatsapp: false, modeloRevisadoEm: null, webhookSecret: "s3gr3d0", isEnabled: false, ativadaEm: null, updatedAt: null,
    ...sobrescrever,
  };
  return Object.values(base);
}

describe("integração de assinatura", () => {
  it("salvar cifra o token, gera o segredo do webhook e zera is_enabled; o token puro nunca vai ao banco", async () => {
    banco.responder = () => [];
    await storage.salvarIntegracaoDeAssinatura(PROVEDOR, { apiToken: "tok-puro-123", ambiente: "producao", authModeCliente: "assinaturaTela-tokenEmail" });
    const insert = banco.consultas.find(c => c.sql.startsWith('insert into "assinatura_integracoes"'))!;
    expect(insert).toBeDefined();
    expect(insert.params).toContain(PROVEDOR);
    expect(insert.params).not.toContain("tok-puro-123");
    const cifrado = insert.params.find(p => typeof p === "string" && p.startsWith("enc:")) as string;
    expect(decryptField(cifrado)).toBe("tok-puro-123");
    const segredo = insert.params.find(p => typeof p === "string" && /^[A-Za-z0-9_-]{40,}$/.test(p));
    expect(segredo, "webhook_secret base64url de 32 bytes").toBeDefined();
    expect(insert.params).toContain(false); // is_enabled
  });
  it("salvar sem token não mexe no token; trocar só o modelo não regenera o segredo; trocar o ambiente regenera", async () => {
    banco.responder = texto => texto.startsWith("select") ? [linhaDaIntegracao({ apiToken: "enc:x.y.z", ambiente: "sandbox", isEnabled: true })] : [];
    await storage.salvarIntegracaoDeAssinatura(PROVEDOR, { apiToken: "", templateId: "tpl-9" });
    const update = banco.consultas.find(c => c.sql.startsWith('update "assinatura_integracoes"'))!;
    expect(update.sql).not.toContain('"api_token"');
    expect(update.sql).not.toContain('"webhook_secret"');
    expect(update.sql).not.toContain('"is_enabled"');
    expect(update.params).toContain("tpl-9");
    conferirTenant(update);
    banco.consultas.length = 0;
    await storage.salvarIntegracaoDeAssinatura(PROVEDOR, { ambiente: "producao" });
    const update2 = banco.consultas.find(c => c.sql.startsWith('update "assinatura_integracoes"'))!;
    expect(update2.sql).toContain('"webhook_secret"');
    expect(update2.sql).toContain('"is_enabled"');
    expect(update2.params).toContain(false);
  });
  it("a leitura do admin não traz token nem segredo, só o final do token; ilegível quando não decifra", async () => {
    banco.responder = () => [linhaDaIntegracao({ apiToken: "enc:lixo", isEnabled: true })];
    const r = await storage.getIntegracaoParaAdmin(PROVEDOR);
    expect(r).toBeDefined();
    expect(Object.keys(r!)).not.toContain("apiToken");
    expect(Object.keys(r!)).not.toContain("webhookSecret");
    expect(r).toMatchObject({ configurada: true, apiTokenGravado: true, apiTokenIlegivel: true, apiTokenFinal: null });
    conferirTenant(banco.consultas[0]);
    const { encryptField } = await import("../utils/crypto");
    banco.responder = () => [linhaDaIntegracao({ apiToken: encryptField("abcdef1234") })];
    expect(await storage.getIntegracaoParaAdmin(PROVEDOR)).toMatchObject({ apiTokenIlegivel: false, apiTokenFinal: "1234" });
  });
  it("a credencial decifrada só sai por getIntegracaoComCredencial; ilegível lança CREDENCIAL_ILEGIVEL", async () => {
    const { encryptField } = await import("../utils/crypto");
    banco.responder = () => [linhaDaIntegracao({ apiToken: encryptField("tok-1"), isEnabled: true })];
    expect((await storage.getIntegracaoComCredencial(PROVEDOR))?.apiToken).toBe("tok-1");
    banco.responder = () => [linhaDaIntegracao({ apiToken: "enc:lixo" })];
    await expect(storage.getIntegracaoComCredencial(PROVEDOR)).rejects.toMatchObject({ codigo: "CREDENCIAL_ILEGIVEL" });
    banco.responder = () => [linhaDaIntegracao({ apiToken: null })];
    expect(await storage.getIntegracaoComCredencial(PROVEDOR)).toBeUndefined();
  });
});

describe("confissões", () => {
  const nova = {
    customerId: 42, casoId: 9, negociacaoId: null, origem: "saldo_integral" as const, ambiente: "producao" as const,
    valorTotal: 719.86, valorOriginal: null, descontoPct: null, parcelas: [{ n: 1, rotulo: "parcela" as const, valor: 719.86, vencimento: "2026-10-10" }],
    erpSource: "mk", erpLidoEm: new Date("2026-09-09T17:30:00Z"), erpFaturas: [], modelo: "padrao" as const, modeloVersao: "1.0", modeloRevisado: false,
    baseCanonica: { versao: "1.0" }, textoHash: "abc", geradoEm: new Date("2026-09-09T17:31:00Z"),
    clienteNome: "Maria", clienteCpfCnpj: "12345678901", clienteEmail: "m@x.com", clienteTelefone: "31999990000", clienteEmailErp: "m@x.com", clienteTelefoneErp: "31999990000",
    contatoAlteradoPorUserId: null, representanteNome: null, representanteCpf: null, dataLimiteAssinatura: "2026-09-24", criadaPorUserId: 7, aprovadaPorUserId: 7, chaveIdempotencia: "5f0c9d1e-2b1a-4c3d-9e8f-000000000001",
  };
  it("criar grava com o tenant e converte os decimais; a constraint de confissão viva vira CONFISSAO_VIVA", async () => {
    banco.responder = () => [[77]];
    const c = await storage.criarConfissao(PROVEDOR, nova);
    expect(c.id).toBe(77);
    const insert = banco.consultas[0];
    expect(insert.sql.startsWith('insert into "cobranca_confissoes"')).toBe(true);
    expect(insert.params).toContain(PROVEDOR);
    expect(insert.params).toContain("719.86");
    banco.db.insert = () => { throw Object.assign(new Error("duplicate key"), { code: "23505", constraint: "cobranca_confissoes_viva_uq" }); };
    await expect(storage.criarConfissao(PROVEDOR, nova)).rejects.toMatchObject({ codigo: "CONFISSAO_VIVA" });
  });
  it("toda leitura leva o provider_id", async () => {
    banco.responder = () => [];
    await storage.obterConfissao(PROVEDOR, 77);
    await storage.obterConfissaoPorToken(PROVEDOR, "doc-1");
    await storage.obterConfissaoPorChave(PROVEDOR, "5f0c9d1e-2b1a-4c3d-9e8f-000000000001");
    await storage.confissaoVivaDoCliente(PROVEDOR, 42);
    await storage.confissaoAssinadaVivaDoCliente(PROVEDOR, 42);
    await storage.confissaoEnviadaDaNegociacao(PROVEDOR, 3);
    await storage.listarConfissoesDoCliente(PROVEDOR, 42);
    await storage.confissoesAssinadasVivasPorCliente(PROVEDOR, [42, 43]);
    expect(banco.consultas).toHaveLength(8);
    for (const c of banco.consultas) {
      conferirTenant(c);
      expect(c.sql, "os PDFs nunca vêm junto").not.toContain('"cobranca_confissoes_pdf"');
    }
    banco.consultas.length = 0;
    expect((await storage.confissoesAssinadasVivasPorCliente(PROVEDOR, [])).size).toBe(0);
    expect(banco.consultas).toHaveLength(0);
  });
  it("a transição é atômica: WHERE status = de; transição proibida não vai ao banco", async () => {
    banco.responder = () => [[77]];
    const r = await storage.transicionarConfissao(PROVEDOR, 77, "enviada", "assinada", { assinadaEm: new Date("2026-09-10T12:00:00Z") });
    expect(r?.id).toBe(77);
    const update = banco.consultas[0];
    expect(update.sql.startsWith('update "cobranca_confissoes"')).toBe(true);
    expect(update.sql).toMatch(/"status" = \$\d+/);
    expect(update.params).toEqual(expect.arrayContaining([PROVEDOR, 77, "enviada", "assinada"]));
    expect(update.sql).toContain("returning");
    banco.consultas.length = 0;
    banco.responder = () => [];
    expect(await storage.transicionarConfissao(PROVEDOR, 77, "enviada", "assinada")).toBeUndefined();
    banco.consultas.length = 0;
    await expect(storage.transicionarConfissao(PROVEDOR, 77, "assinada", "cancelada")).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    expect(banco.consultas).toHaveLength(0);
  });
  it("o PDF só sai por obterPdf; guardar calcula o sha256 e faz upsert por (confissao_id, tipo)", async () => {
    banco.responder = () => [];
    const bytes = Buffer.from("%PDF-1.4 teste");
    const r = await storage.guardarPdf(PROVEDOR, 77, "original", bytes);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.tamanhoBytes).toBe(bytes.length);
    const insert = banco.consultas.find(c => c.sql.startsWith('insert into "cobranca_confissoes_pdf"'))!;
    expect(insert.sql).toContain("on conflict");
    expect(insert.params).toContain(bytes.toString("base64"));
    expect(banco.consultas.some(c => c.sql.startsWith('update "cobranca_confissoes"') && c.sql.includes('"pdf_original_sha256"'))).toBe(true);
    banco.consultas.length = 0;
    banco.responder = () => [[bytes.toString("base64"), r.sha256, bytes.length]];
    const pdf = await storage.obterPdf(PROVEDOR, 77, "original", { registrarDownload: true });
    expect(pdf?.bytes.equals(bytes)).toBe(true);
    conferirTenant(banco.consultas[0]);
    expect(banco.consultas.some(c => c.sql.startsWith('update "cobranca_confissoes_pdf"') && c.sql.includes('"baixado_em"'))).toBe(true);
  });
  it("worker e LGPD: reconciliar por prazo, expirar pela data limite, retenção só do que não é título, anonimizar apaga PDFs", async () => {
    banco.responder = () => [];
    await storage.confissoesParaReconciliar(new Date("2026-09-10T12:00:00Z"), 60 * 60 * 1000);
    expect(banco.consultas[0].sql).toContain('"status" = $');
    expect(banco.consultas[0].sql).toMatch(/"reconciliar_em" <= \$\d+/);
    expect(banco.consultas[0].sql).toMatch(/"enviada_em" <= \$\d+/);
    banco.consultas.length = 0;
    await storage.confissoesParaExpirar("2026-09-25");
    expect(banco.consultas[0].sql).toMatch(/"data_limite_assinatura" < \$\d+/);
    banco.consultas.length = 0;
    await storage.confissoesParaRetencao(new Date("2026-06-11T00:00:00Z"));
    expect(banco.consultas[0].sql).toContain("'sandbox'");
    expect(banco.consultas[0].sql).toContain('"cliente_cpf_cnpj" is not null');
    banco.consultas.length = 0;
    await storage.anonimizarConfissao(PROVEDOR, 77);
    expect(banco.consultas.some(c => c.sql.startsWith('delete from "cobranca_confissoes_pdf"'))).toBe(true);
    const update = banco.consultas.find(c => c.sql.startsWith('update "cobranca_confissoes"'))!;
    for (const col of ['"cliente_nome"', '"cliente_cpf_cnpj"', '"cliente_email"', '"cliente_telefone"', '"parcelas"', '"erp_faturas"', '"zapsign_signers"', '"base_canonica"']) expect(update.sql).toContain(col);
    expect(update.sql).not.toContain('"texto_hash"');
    expect(update.sql).not.toContain('"status"');
    for (const c of banco.consultas) conferirTenant(c);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/storage/assinatura.storage.test.ts`
Expected: FAIL — `./assinatura.storage` inexistente.

- [ ] **Step 3: Escrever `server/storage/assinatura.storage.ts`**

```ts
/**
 * Storage da confissão de dívida e da integração de assinatura (spec §5).
 *
 * Regras que este arquivo carrega sozinho:
 * - `api_token` entra por `encryptField` e só sai decifrado em
 *   `getIntegracaoComCredencial` — a leitura do admin devolve os 4 últimos
 *   caracteres e nada mais.
 * - `webhook_secret` nasce aqui e é regenerado quando token ou ambiente mudam
 *   (o retorno do outro ambiente não pode autenticar neste).
 * - PDF: `base64` só é selecionado em `obterPdf`.
 * - Transição de status é UM update com `WHERE status = de`: webhook, worker e
 *   cancelar competem pela mesma linha e só quem recebe a linha de volta grava
 *   evento.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  assinaturaIntegracoes, cobrancaConfissoes, cobrancaConfissoesPdf,
  type AssinaturaIntegracao, type CobrancaConfissao,
} from "@shared/schema";
import { decryptField, encryptField } from "../utils/crypto";
import { ErroDeConfissao } from "../assinatura/erro";
import {
  transicaoDeConfissaoPermitida,
  type AmbienteDeAssinatura, type AuthModeDoCliente, type FaturaDoAnexo, type ModeloDaConfissao, type OrigemDaConfissao,
  type ParcelaConfessada, type SignatarioDaConfissao, type StatusDeConfissao,
} from "@shared/cobranca/confissao";

export const FORNECEDOR = "zapsign";

export interface DadosDaIntegracaoDeAssinatura {
  /** undefined, null ou "" = não mexe no token gravado (regra de `preservarSegredosVazios` do ERP). */
  apiToken?: string | null;
  ambiente?: AmbienteDeAssinatura;
  templateId?: string | null;
  signatarioNome?: string | null;
  signatarioCpf?: string | null;
  signatarioEmail?: string | null;
  signatarioTelefone?: string | null;
  provedorAssina?: boolean;
  authModeCliente?: AuthModeDoCliente;
  exigirSelfie?: boolean;
  prazoAssinaturaDias?: number;
  enviarArquivoAssinadoWhatsapp?: boolean;
}

export interface IntegracaoDeAssinaturaParaAdmin {
  configurada: boolean;
  apiTokenGravado: boolean;
  apiTokenIlegivel: boolean;
  apiTokenFinal: string | null;
  ambiente: AmbienteDeAssinatura;
  templateId: string | null;
  signatarioNome: string | null;
  signatarioCpf: string | null;
  signatarioEmail: string | null;
  signatarioTelefone: string | null;
  provedorAssina: boolean;
  authModeCliente: AuthModeDoCliente;
  exigirSelfie: boolean;
  prazoAssinaturaDias: number;
  enviarArquivoAssinadoWhatsapp: boolean;
  modeloRevisadoEm: string | null;
  isEnabled: boolean;
  ativadaEm: string | null;
  updatedAt: string | null;
}

export type IntegracaoComCredencial = Omit<AssinaturaIntegracao, "apiToken"> & { apiToken: string };

export interface NovaConfissao {
  customerId: number;
  casoId: number;
  negociacaoId: number | null;
  origem: OrigemDaConfissao;
  ambiente: AmbienteDeAssinatura;
  valorTotal: number;
  valorOriginal: number | null;
  descontoPct: number | null;
  parcelas: ParcelaConfessada[];
  erpSource: string | null;
  erpLidoEm: Date | null;
  erpFaturas: FaturaDoAnexo[];
  modelo: ModeloDaConfissao;
  modeloVersao: string;
  modeloRevisado: boolean;
  baseCanonica: unknown;
  textoHash: string;
  geradoEm: Date;
  clienteNome: string;
  clienteCpfCnpj: string;
  clienteEmail: string | null;
  clienteTelefone: string | null;
  clienteEmailErp: string | null;
  clienteTelefoneErp: string | null;
  contatoAlteradoPorUserId: number | null;
  representanteNome: string | null;
  representanteCpf: string | null;
  dataLimiteAssinatura: string;
  criadaPorUserId: number;
  aprovadaPorUserId: number | null;
  chaveIdempotencia: string | null;
}

export interface PatchDeConfissao {
  erroUltimo?: string | null;
  reconciliarEm?: Date | null;
  zapsignDocToken?: string | null;
  webhookZapsignId?: string | null;
  zapsignSigners?: SignatarioDaConfissao[];
  zapsignSandbox?: boolean | null;
  recusaInformadaEm?: Date | null;
  expiracaoInformadaEm?: Date | null;
  enviadaEm?: Date | null;
  assinadaEm?: Date | null;
  encerradaEm?: Date | null;
  pdfOriginalSha256?: string | null;
  pdfAssinadoSha256?: string | null;
}

export type TipoDePdf = "original" | "assinado";
export interface PdfDaConfissao { bytes: Buffer; sha256: string; tamanhoBytes: number }
export interface ConfissaoAssinadaViva { id: number; assinadaEm: Date | null; valorTotal: number; ambiente: AmbienteDeAssinatura }
export interface ConfissaoDoTitular { id: number; providerId: number; status: string; valorTotal: number; ambiente: string; assinadaEm: Date | null; createdAt: Date | null; dataLimiteAssinatura: string }

const decimal = (n: number | null) => (n === null ? null : n.toFixed(2));
const numero = (s: string | null) => (s === null ? 0 : Number(s));
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const novoSegredo = () => randomBytes(32).toString("base64url");

/** Select explícito: o teste responde na MESMA ordem destas chaves. */
const colunasDaIntegracao = {
  id: assinaturaIntegracoes.id,
  providerId: assinaturaIntegracoes.providerId,
  apiToken: assinaturaIntegracoes.apiToken,
  ambiente: assinaturaIntegracoes.ambiente,
  templateId: assinaturaIntegracoes.templateId,
  signatarioNome: assinaturaIntegracoes.signatarioNome,
  signatarioCpf: assinaturaIntegracoes.signatarioCpf,
  signatarioEmail: assinaturaIntegracoes.signatarioEmail,
  signatarioTelefone: assinaturaIntegracoes.signatarioTelefone,
  provedorAssina: assinaturaIntegracoes.provedorAssina,
  authModeCliente: assinaturaIntegracoes.authModeCliente,
  exigirSelfie: assinaturaIntegracoes.exigirSelfie,
  prazoAssinaturaDias: assinaturaIntegracoes.prazoAssinaturaDias,
  enviarArquivoAssinadoWhatsapp: assinaturaIntegracoes.enviarArquivoAssinadoWhatsapp,
  modeloRevisadoEm: assinaturaIntegracoes.modeloRevisadoEm,
  webhookSecret: assinaturaIntegracoes.webhookSecret,
  isEnabled: assinaturaIntegracoes.isEnabled,
  ativadaEm: assinaturaIntegracoes.ativadaEm,
  updatedAt: assinaturaIntegracoes.updatedAt,
};

export class AssinaturaStorage {
  private async linhaDaIntegracao(providerId: number) {
    const [linha] = await db.select(colunasDaIntegracao).from(assinaturaIntegracoes)
      .where(and(eq(assinaturaIntegracoes.providerId, providerId), eq(assinaturaIntegracoes.fornecedor, FORNECEDOR)))
      .limit(1);
    return linha;
  }

  async getIntegracaoParaAdmin(providerId: number): Promise<IntegracaoDeAssinaturaParaAdmin | undefined> {
    const l = await this.linhaDaIntegracao(providerId);
    if (!l) return undefined;
    let ilegivel = false;
    let final: string | null = null;
    if (l.apiToken) {
      try {
        const puro = decryptField(l.apiToken);
        final = puro ? puro.slice(-4) : null;
      } catch {
        ilegivel = true;
      }
    }
    return {
      configurada: !!l.apiToken,
      apiTokenGravado: !!l.apiToken,
      apiTokenIlegivel: ilegivel,
      apiTokenFinal: final,
      ambiente: l.ambiente as AmbienteDeAssinatura,
      templateId: l.templateId,
      signatarioNome: l.signatarioNome,
      signatarioCpf: l.signatarioCpf,
      signatarioEmail: l.signatarioEmail,
      signatarioTelefone: l.signatarioTelefone,
      provedorAssina: l.provedorAssina,
      authModeCliente: l.authModeCliente as AuthModeDoCliente,
      exigirSelfie: l.exigirSelfie,
      prazoAssinaturaDias: l.prazoAssinaturaDias,
      enviarArquivoAssinadoWhatsapp: l.enviarArquivoAssinadoWhatsapp,
      modeloRevisadoEm: iso(l.modeloRevisadoEm),
      isEnabled: l.isEnabled,
      ativadaEm: iso(l.ativadaEm),
      updatedAt: iso(l.updatedAt),
    };
  }

  async getIntegracaoComCredencial(providerId: number): Promise<IntegracaoComCredencial | undefined> {
    const l = await this.linhaDaIntegracao(providerId);
    if (!l || !l.apiToken) return undefined;
    let apiToken: string | null;
    try {
      apiToken = decryptField(l.apiToken);
    } catch {
      throw new ErroDeConfissao("CREDENCIAL_ILEGIVEL", "O token do ZapSign gravado não abre neste servidor — o superadmin precisa redigitá-lo", 409);
    }
    if (!apiToken) return undefined;
    return { ...l, fornecedor: FORNECEDOR, modeloRevisadoPorUserId: null, createdAt: null, apiToken } as IntegracaoComCredencial;
  }

  async salvarIntegracaoDeAssinatura(providerId: number, dados: DadosDaIntegracaoDeAssinatura): Promise<void> {
    const atual = await this.linhaDaIntegracao(providerId);
    const tokenNovo = typeof dados.apiToken === "string" && dados.apiToken.trim() ? dados.apiToken.trim() : null;
    const ambiente = dados.ambiente ?? (atual?.ambiente as AmbienteDeAssinatura | undefined) ?? "sandbox";
    const mudouSegredo = !atual || tokenNovo !== null || ambiente !== atual.ambiente;
    const patch: Partial<typeof assinaturaIntegracoes.$inferInsert> = { ambiente, updatedAt: new Date() };
    if (dados.templateId !== undefined) patch.templateId = dados.templateId || null;
    if (dados.signatarioNome !== undefined) patch.signatarioNome = dados.signatarioNome || null;
    if (dados.signatarioCpf !== undefined) patch.signatarioCpf = dados.signatarioCpf ? dados.signatarioCpf.replace(/\D/g, "") : null;
    if (dados.signatarioEmail !== undefined) patch.signatarioEmail = dados.signatarioEmail || null;
    if (dados.signatarioTelefone !== undefined) patch.signatarioTelefone = dados.signatarioTelefone ? dados.signatarioTelefone.replace(/\D/g, "") : null;
    if (dados.provedorAssina !== undefined) patch.provedorAssina = dados.provedorAssina;
    if (dados.authModeCliente !== undefined) patch.authModeCliente = dados.authModeCliente;
    if (dados.exigirSelfie !== undefined) patch.exigirSelfie = dados.exigirSelfie;
    if (dados.prazoAssinaturaDias !== undefined) patch.prazoAssinaturaDias = dados.prazoAssinaturaDias;
    if (dados.enviarArquivoAssinadoWhatsapp !== undefined) patch.enviarArquivoAssinadoWhatsapp = dados.enviarArquivoAssinadoWhatsapp;
    if (tokenNovo) patch.apiToken = encryptField(tokenNovo);
    if (mudouSegredo) {
      patch.webhookSecret = novoSegredo();
      patch.isEnabled = false;
      patch.ativadaEm = null;
    }
    if (!atual) {
      await db.insert(assinaturaIntegracoes).values({ ...patch, providerId, fornecedor: FORNECEDOR, ambiente });
      return;
    }
    await db.update(assinaturaIntegracoes).set(patch)
      .where(and(eq(assinaturaIntegracoes.id, atual.id), eq(assinaturaIntegracoes.providerId, providerId)));
  }

  async ativarIntegracaoDeAssinatura(providerId: number): Promise<void> {
    await db.update(assinaturaIntegracoes).set({ isEnabled: true, ativadaEm: new Date(), updatedAt: new Date() })
      .where(and(eq(assinaturaIntegracoes.providerId, providerId), eq(assinaturaIntegracoes.fornecedor, FORNECEDOR)));
  }

  async marcarModeloRevisado(providerId: number, userId: number): Promise<void> {
    await db.update(assinaturaIntegracoes).set({ modeloRevisadoEm: new Date(), modeloRevisadoPorUserId: userId, updatedAt: new Date() })
      .where(and(eq(assinaturaIntegracoes.providerId, providerId), eq(assinaturaIntegracoes.fornecedor, FORNECEDOR)));
  }

  async webhookSecretDoProvedor(providerId: number): Promise<{ webhookSecret: string | null; isEnabled: boolean; ambiente: string } | undefined> {
    const [l] = await db.select({ webhookSecret: assinaturaIntegracoes.webhookSecret, isEnabled: assinaturaIntegracoes.isEnabled, ambiente: assinaturaIntegracoes.ambiente })
      .from(assinaturaIntegracoes)
      .where(and(eq(assinaturaIntegracoes.providerId, providerId), eq(assinaturaIntegracoes.fornecedor, FORNECEDOR)))
      .limit(1);
    return l;
  }

  /* ── confissões ─────────────────────────────────────────────────────── */

  async criarConfissao(providerId: number, d: NovaConfissao): Promise<CobrancaConfissao> {
    try {
      const [linha] = await db.insert(cobrancaConfissoes).values({
        providerId,
        customerId: d.customerId,
        casoId: d.casoId,
        negociacaoId: d.negociacaoId,
        origem: d.origem,
        ambiente: d.ambiente,
        valorTotal: d.valorTotal.toFixed(2),
        valorOriginal: decimal(d.valorOriginal),
        descontoPct: decimal(d.descontoPct),
        parcelas: d.parcelas,
        erpSource: d.erpSource,
        erpLidoEm: d.erpLidoEm,
        erpFaturas: d.erpFaturas,
        modelo: d.modelo,
        modeloVersao: d.modeloVersao,
        modeloRevisado: d.modeloRevisado,
        baseCanonica: d.baseCanonica,
        textoHash: d.textoHash,
        geradoEm: d.geradoEm,
        status: "rascunho",
        clienteNome: d.clienteNome,
        clienteCpfCnpj: d.clienteCpfCnpj,
        clienteEmail: d.clienteEmail,
        clienteTelefone: d.clienteTelefone,
        clienteEmailErp: d.clienteEmailErp,
        clienteTelefoneErp: d.clienteTelefoneErp,
        contatoAlteradoPorUserId: d.contatoAlteradoPorUserId,
        representanteNome: d.representanteNome,
        representanteCpf: d.representanteCpf,
        dataLimiteAssinatura: d.dataLimiteAssinatura,
        criadaPorUserId: d.criadaPorUserId,
        aprovadaPorUserId: d.aprovadaPorUserId,
        chaveIdempotencia: d.chaveIdempotencia,
      }).returning();
      return linha;
    } catch (e) {
      const erro = e as { code?: string; constraint?: string };
      if (erro.code === "23505" && erro.constraint === "cobranca_confissoes_viva_uq") {
        throw new ErroDeConfissao("CONFISSAO_VIVA", "Este cliente já tem uma confissão em andamento — cancele-a antes de emitir outra", 409);
      }
      throw e;
    }
  }

  private async primeira(condicao: ReturnType<typeof and>, ordem: ReturnType<typeof desc>[] = []): Promise<CobrancaConfissao | undefined> {
    const [linha] = await db.select().from(cobrancaConfissoes).where(condicao).orderBy(...ordem).limit(1);
    return linha;
  }

  obterConfissao(providerId: number, id: number) {
    return this.primeira(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.id, id)));
  }
  obterConfissaoPorToken(providerId: number, docToken: string) {
    return this.primeira(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.zapsignDocToken, docToken)));
  }
  obterConfissaoPorChave(providerId: number, chave: string) {
    return this.primeira(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.chaveIdempotencia, chave)));
  }
  confissaoVivaDoCliente(providerId: number, customerId: number) {
    return this.primeira(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.customerId, customerId), inArray(cobrancaConfissoes.status, ["rascunho", "enviada"])), [desc(cobrancaConfissoes.id)]);
  }
  confissaoAssinadaVivaDoCliente(providerId: number, customerId: number) {
    return this.primeira(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.customerId, customerId), eq(cobrancaConfissoes.status, "assinada")), [desc(cobrancaConfissoes.assinadaEm), desc(cobrancaConfissoes.id)]);
  }
  confissaoEnviadaDaNegociacao(providerId: number, negociacaoId: number) {
    return this.primeira(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.negociacaoId, negociacaoId), eq(cobrancaConfissoes.status, "enviada")));
  }

  async listarConfissoesDoCliente(providerId: number, customerId: number): Promise<CobrancaConfissao[]> {
    return db.select().from(cobrancaConfissoes)
      .where(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.customerId, customerId)))
      .orderBy(desc(cobrancaConfissoes.createdAt), desc(cobrancaConfissoes.id));
  }

  async confissoesAssinadasVivasPorCliente(providerId: number, customerIds: number[]): Promise<Map<number, ConfissaoAssinadaViva>> {
    const mapa = new Map<number, ConfissaoAssinadaViva>();
    if (customerIds.length === 0) return mapa;
    const linhas = await db.select({
      id: cobrancaConfissoes.id, customerId: cobrancaConfissoes.customerId, assinadaEm: cobrancaConfissoes.assinadaEm,
      valorTotal: cobrancaConfissoes.valorTotal, ambiente: cobrancaConfissoes.ambiente,
    }).from(cobrancaConfissoes)
      .where(and(eq(cobrancaConfissoes.providerId, providerId), inArray(cobrancaConfissoes.customerId, customerIds), eq(cobrancaConfissoes.status, "assinada")))
      .orderBy(asc(cobrancaConfissoes.assinadaEm));
    for (const l of linhas) mapa.set(l.customerId, { id: l.id, assinadaEm: l.assinadaEm, valorTotal: numero(l.valorTotal), ambiente: l.ambiente as AmbienteDeAssinatura });
    return mapa;
  }

  async atualizarConfissao(providerId: number, id: number, patch: PatchDeConfissao): Promise<CobrancaConfissao | undefined> {
    const [linha] = await db.update(cobrancaConfissoes).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(cobrancaConfissoes.id, id), eq(cobrancaConfissoes.providerId, providerId)))
      .returning();
    return linha;
  }

  /** UM update com `WHERE status = de`: quem recebe a linha de volta é o único que aplicou. */
  async transicionarConfissao(providerId: number, id: number, de: StatusDeConfissao, para: StatusDeConfissao, patch: PatchDeConfissao = {}): Promise<CobrancaConfissao | undefined> {
    if (!transicaoDeConfissaoPermitida(de, para)) {
      throw new ErroDeConfissao("ESTADO_INVALIDO", `Uma confissão ${de} não pode passar a ${para}`, 409);
    }
    const [linha] = await db.update(cobrancaConfissoes).set({ ...patch, status: para, updatedAt: new Date() })
      .where(and(eq(cobrancaConfissoes.id, id), eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.status, de)))
      .returning();
    return linha;
  }

  async marcarSubstituidas(providerId: number, customerId: number, novaId: number): Promise<number> {
    const linhas = await db.update(cobrancaConfissoes).set({ status: "substituida", encerradaEm: new Date(), updatedAt: new Date() })
      .where(and(eq(cobrancaConfissoes.providerId, providerId), eq(cobrancaConfissoes.customerId, customerId), eq(cobrancaConfissoes.status, "assinada"), ne(cobrancaConfissoes.id, novaId)))
      .returning({ id: cobrancaConfissoes.id });
    return linhas.length;
  }

  /* ── PDFs ───────────────────────────────────────────────────────────── */

  async guardarPdf(providerId: number, confissaoId: number, tipo: TipoDePdf, bytes: Buffer): Promise<{ sha256: string; tamanhoBytes: number }> {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const tamanhoBytes = bytes.length;
    const base64 = bytes.toString("base64");
    await db.insert(cobrancaConfissoesPdf).values({ confissaoId, providerId, tipo, sha256, tamanhoBytes, base64 })
      .onConflictDoUpdate({ target: [cobrancaConfissoesPdf.confissaoId, cobrancaConfissoesPdf.tipo], set: { sha256, tamanhoBytes, base64 } });
    await db.update(cobrancaConfissoes)
      .set(tipo === "original" ? { pdfOriginalSha256: sha256, updatedAt: new Date() } : { pdfAssinadoSha256: sha256, updatedAt: new Date() })
      .where(and(eq(cobrancaConfissoes.id, confissaoId), eq(cobrancaConfissoes.providerId, providerId)));
    return { sha256, tamanhoBytes };
  }

  async obterPdf(providerId: number, confissaoId: number, tipo: TipoDePdf, opcoes: { registrarDownload?: boolean } = {}): Promise<PdfDaConfissao | undefined> {
    const [l] = await db.select({ base64: cobrancaConfissoesPdf.base64, sha256: cobrancaConfissoesPdf.sha256, tamanhoBytes: cobrancaConfissoesPdf.tamanhoBytes })
      .from(cobrancaConfissoesPdf)
      .where(and(eq(cobrancaConfissoesPdf.confissaoId, confissaoId), eq(cobrancaConfissoesPdf.providerId, providerId), eq(cobrancaConfissoesPdf.tipo, tipo)))
      .limit(1);
    if (!l) return undefined;
    if (opcoes.registrarDownload) {
      await db.update(cobrancaConfissoesPdf).set({ baixadoEm: new Date() })
        .where(and(eq(cobrancaConfissoesPdf.confissaoId, confissaoId), eq(cobrancaConfissoesPdf.providerId, providerId), eq(cobrancaConfissoesPdf.tipo, tipo)));
    }
    return { bytes: Buffer.from(l.base64, "base64"), sha256: l.sha256, tamanhoBytes: l.tamanhoBytes };
  }

  async apagarPdfs(providerId: number, confissaoId: number): Promise<void> {
    await db.delete(cobrancaConfissoesPdf)
      .where(and(eq(cobrancaConfissoesPdf.confissaoId, confissaoId), eq(cobrancaConfissoesPdf.providerId, providerId)));
  }

  /* ── worker e LGPD (varrem todos os provedores) ─────────────────────── */

  async confissoesParaReconciliar(agora: Date, enviadasHaMaisDeMs: number): Promise<CobrancaConfissao[]> {
    const limite = new Date(agora.getTime() - enviadasHaMaisDeMs);
    return db.select().from(cobrancaConfissoes)
      .where(and(eq(cobrancaConfissoes.status, "enviada"), or(lte(cobrancaConfissoes.reconciliarEm, agora), lte(cobrancaConfissoes.enviadaEm, limite))))
      .orderBy(asc(cobrancaConfissoes.reconciliarEm), asc(cobrancaConfissoes.id))
      .limit(500);
  }

  async confissoesParaExpirar(hoje: string): Promise<CobrancaConfissao[]> {
    return db.select().from(cobrancaConfissoes)
      .where(and(eq(cobrancaConfissoes.status, "enviada"), lt(cobrancaConfissoes.dataLimiteAssinatura, hoje)))
      .limit(500);
  }

  /** O que NÃO é título e já passou do prazo: rascunho, cancelada, expirada e qualquer linha de sandbox. */
  async confissoesParaRetencao(limite: Date, maximo = 200): Promise<Array<{ id: number; providerId: number }>> {
    return db.select({ id: cobrancaConfissoes.id, providerId: cobrancaConfissoes.providerId }).from(cobrancaConfissoes)
      .where(and(
        or(inArray(cobrancaConfissoes.status, ["rascunho", "cancelada", "expirada"]), sql`${cobrancaConfissoes.ambiente} = 'sandbox'`),
        lt(cobrancaConfissoes.updatedAt, limite),
        isNotNull(cobrancaConfissoes.clienteCpfCnpj),
      ))
      .limit(maximo);
  }

  async anonimizarConfissao(providerId: number, id: number): Promise<void> {
    await this.apagarPdfs(providerId, id);
    await db.update(cobrancaConfissoes).set({
      clienteNome: null, clienteCpfCnpj: null, clienteEmail: null, clienteTelefone: null, clienteEmailErp: null, clienteTelefoneErp: null,
      representanteNome: null, representanteCpf: null,
      parcelas: [], erpFaturas: [], zapsignSigners: [], baseCanonica: { anonimizada: true },
      updatedAt: new Date(),
    }).where(and(eq(cobrancaConfissoes.id, id), eq(cobrancaConfissoes.providerId, providerId)));
  }

  async confissoesDoTitular(cpfCnpj: string): Promise<ConfissaoDoTitular[]> {
    const digitos = cpfCnpj.replace(/\D/g, "");
    if (!digitos) return [];
    const linhas = await db.select({
      id: cobrancaConfissoes.id, providerId: cobrancaConfissoes.providerId, status: cobrancaConfissoes.status, valorTotal: cobrancaConfissoes.valorTotal,
      ambiente: cobrancaConfissoes.ambiente, assinadaEm: cobrancaConfissoes.assinadaEm, createdAt: cobrancaConfissoes.createdAt, dataLimiteAssinatura: cobrancaConfissoes.dataLimiteAssinatura,
    }).from(cobrancaConfissoes).where(eq(cobrancaConfissoes.clienteCpfCnpj, digitos));
    return linhas.map(l => ({ ...l, valorTotal: numero(l.valorTotal) }));
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run server/storage/assinatura.storage.test.ts`
Expected: PASS. Se o Drizzle escrever `"status" in ($1, $2)` em vez de `= $n` na consulta de retenção, ajuste a asserção do teste ao SQL real (o que se prova é o predicado, não a grafia).

- [ ] **Step 5: A fachada**

Em `server/storage/index.ts`:
1. Import: `import { AssinaturaStorage, type ConfissaoAssinadaViva, type DadosDaIntegracaoDeAssinatura, type IntegracaoComCredencial, type IntegracaoDeAssinaturaParaAdmin, type NovaConfissao, type PatchDeConfissao, type PdfDaConfissao, type TipoDePdf, type ConfissaoDoTitular } from "./assinatura.storage";` e `type AssinaturaIntegracao, type CobrancaConfissao` no import de `@shared/schema`.
2. Na interface `IStorage` (depois de `cobrancasDeSaida`, ~linha 370), um método por item da lista **Produces** desta tarefa, com a forma `nome(...args: Parameters<AssinaturaStorage["nome"]>): ReturnType<AssinaturaStorage["nome"]>;`.
3. Na classe `DatabaseStorage` (depois de `private _faturas = new FaturasStorage();` e das delegações de `cobrancasDeSaida`, ~linha 686): `private _assinatura = new AssinaturaStorage();` e uma arrow por método: `getIntegracaoParaAdmin = (...args: Parameters<AssinaturaStorage["getIntegracaoParaAdmin"]>) => this._assinatura.getIntegracaoParaAdmin(...args);` — e assim para os 24 métodos.

Em `server/storage/storage-fachada.test.ts`, depois do `describe` de `FaturasStorage`, acrescente:

```ts
import { AssinaturaStorage } from "./assinatura.storage";

describe("a fachada expõe todo método do storage de assinatura", () => {
  const assinatura = metodosPublicos(Object.create(AssinaturaStorage.prototype));
  it("tem métodos para conferir", () => {
    expect(assinatura.length).toBeGreaterThan(15);
  });
  it.each(assinatura)("%s está delegado em DatabaseStorage", (nome) => {
    expect(delegadoNaFachada(nome), `${nome} existe em AssinaturaStorage e não está na fachada: em runtime seria undefined`).toBe(true);
  });
});
```

(O import deve subir para o topo do arquivo, junto dos outros.)

- [ ] **Step 6: Rodar tudo e o tsc**

Run: `npx vitest run server/storage && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: testes PASS; contagem `58`.

- [ ] **Step 7: Commit**

```bash
git add server/storage/assinatura.storage.ts server/storage/assinatura.storage.test.ts server/storage/index.ts server/storage/storage-fachada.test.ts
git commit -m "feat(confissao): AssinaturaStorage — integração cifrada, confissões com transição atômica, PDFs fora da linha"
```

---

### Task 8: Configuração do superadmin (GET · PUT · Ativar)

**Files:**
- Create: `server/routes/admin-assinatura.routes.ts`
- Create: `server/routes/admin-assinatura.routes.test.ts`
- Modify: `server/routes/index.ts:64` (registrar depois de `registerAdminRoutes()`)
- Modify: `server/utils/sanitize-log.ts:79-…` (`ROTAS_SEM_CORPO_NO_LOG`)

**Interfaces:**
- Consumes: `storage.getIntegracaoParaAdmin`, `salvarIntegracaoDeAssinatura`, `ativarIntegracaoDeAssinatura`, `getIntegracaoComCredencial`, `getProvider` (Task 7); `clienteZapSign` (Task 6); `requireSuperAdmin` (`server/auth.ts`); `createRateLimiter` (`server/middleware/rate-limiter.middleware.ts`).
- Produces: `registerAdminAssinaturaRoutes(): Router` com `GET /api/admin/providers/:id/assinatura/zapsign`, `PUT …/assinatura/zapsign`, `POST …/assinatura/zapsign/ativar`; `ConfiguracaoZapSignSchema`.

- [ ] **Step 1: Escrever o teste que falha**

`server/routes/admin-assinatura.routes.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * Foco: a configuração do ZapSign mora só no superadmin; o GET nunca devolve
 * token nem segredo; salvar com token vazio "não mexe"; credencial ilegível
 * sem token novo é 400; ativar testa o token no ZapSign e só então liga; o
 * corpo destas rotas fica fora do log de acesso.
 */
const storageMock = vi.hoisted(() => ({
  getProvider: vi.fn(async (): Promise<any> => ({ id: 4, name: "NG Telecom" })),
  getIntegracaoParaAdmin: vi.fn(async (): Promise<any> => undefined),
  salvarIntegracaoDeAssinatura: vi.fn(async (): Promise<void> => undefined),
  ativarIntegracaoDeAssinatura: vi.fn(async (): Promise<void> => undefined),
  getIntegracaoComCredencial: vi.fn(async (): Promise<any> => ({ apiToken: "tok", ambiente: "sandbox" })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../auth", () => ({
  requireSuperAdmin: (req: any, res: any, next: any) => {
    if (req.session?.role !== "superadmin") return res.status(403).json({ message: "Acesso restrito" });
    next();
  },
}));
const zapsignMock = vi.hoisted(() => ({ testarToken: vi.fn(async (): Promise<void> => undefined) }));
vi.mock("../assinatura/zapsign", () => ({ clienteZapSign: () => zapsignMock }));

import { registerAdminAssinaturaRoutes } from "./admin-assinatura.routes";
import { corpoEhSensivel } from "../utils/sanitize-log";
import { ErroDeConfissao } from "../assinatura/erro";

let server: Server;
let base: string;
let sessao: Record<string, any> = {};
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerAdminAssinaturaRoutes());
  await new Promise<void>(r => { server = app.listen(0, "127.0.0.1", () => r()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });
beforeEach(() => { vi.clearAllMocks(); sessao = { userId: 1, role: "superadmin" }; });

const json = (method: string, caminho: string, corpo?: unknown) =>
  fetch(`${base}${caminho}`, { method, headers: corpo === undefined ? {} : { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

const gravada = () => ({
  configurada: true, apiTokenGravado: true, apiTokenIlegivel: false, apiTokenFinal: "1234", ambiente: "sandbox", templateId: null,
  signatarioNome: null, signatarioCpf: null, signatarioEmail: null, signatarioTelefone: null, provedorAssina: false,
  authModeCliente: "assinaturaTela-tokenWhatsapp", exigirSelfie: false, prazoAssinaturaDias: 15, enviarArquivoAssinadoWhatsapp: false,
  modeloRevisadoEm: null, isEnabled: false, ativadaEm: null, updatedAt: null,
});

describe("configuração do ZapSign pelo superadmin", () => {
  it("só o superadmin entra", async () => {
    sessao = { userId: 8, providerId: 4, role: "admin" };
    expect((await json("GET", "/api/admin/providers/4/assinatura/zapsign")).status).toBe(403);
    expect((await json("PUT", "/api/admin/providers/4/assinatura/zapsign", {})).status).toBe(403);
    expect((await json("POST", "/api/admin/providers/4/assinatura/zapsign/ativar")).status).toBe(403);
  });
  it("GET devolve o estado sem token nem segredo; sem linha, o padrão não configurado", async () => {
    storageMock.getIntegracaoParaAdmin.mockResolvedValueOnce(gravada());
    const r = await json("GET", "/api/admin/providers/4/assinatura/zapsign");
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.apiTokenFinal).toBe("1234");
    expect(JSON.stringify(corpo)).not.toMatch(/apiToken"|webhookSecret/);
    const vazio = await (await json("GET", "/api/admin/providers/4/assinatura/zapsign")).json();
    expect(vazio).toMatchObject({ configurada: false, apiTokenGravado: false, ambiente: "sandbox", authModeCliente: "assinaturaTela-tokenWhatsapp", prazoAssinaturaDias: 15 });
    storageMock.getProvider.mockResolvedValueOnce(undefined);
    expect((await json("GET", "/api/admin/providers/99/assinatura/zapsign")).status).toBe(404);
  });
  it("PUT grava e devolve o estado novo; token vazio não mexe; assinaturaTela puro é recusado", async () => {
    storageMock.getIntegracaoParaAdmin.mockResolvedValue(gravada());
    const r = await json("PUT", "/api/admin/providers/4/assinatura/zapsign", { apiToken: "", ambiente: "producao", authModeCliente: "assinaturaTela-tokenEmail", prazoAssinaturaDias: 10 });
    expect(r.status).toBe(200);
    expect(storageMock.salvarIntegracaoDeAssinatura).toHaveBeenCalledWith(4, expect.objectContaining({ apiToken: "", ambiente: "producao", authModeCliente: "assinaturaTela-tokenEmail", prazoAssinaturaDias: 10 }));
    expect((await json("PUT", "/api/admin/providers/4/assinatura/zapsign", { authModeCliente: "assinaturaTela" })).status).toBe(400);
    expect((await json("PUT", "/api/admin/providers/4/assinatura/zapsign", { desconhecido: 1 })).status).toBe(400);
    expect((await json("PUT", "/api/admin/providers/4/assinatura/zapsign", { provedorAssina: true })).status).toBe(400);
  });
  it("credencial ilegível exige token novo", async () => {
    storageMock.getIntegracaoParaAdmin.mockResolvedValue({ ...gravada(), apiTokenIlegivel: true, apiTokenFinal: null });
    const r = await json("PUT", "/api/admin/providers/4/assinatura/zapsign", { ambiente: "sandbox" });
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatch(/redigite/i);
    expect(storageMock.salvarIntegracaoDeAssinatura).not.toHaveBeenCalled();
    expect((await json("PUT", "/api/admin/providers/4/assinatura/zapsign", { apiToken: "novo" })).status).toBe(200);
  });
  it("ativar testa o token no host do ambiente e só então liga; falha vira 422 e não liga", async () => {
    storageMock.getIntegracaoParaAdmin.mockResolvedValue({ ...gravada(), isEnabled: true });
    const ok = await json("POST", "/api/admin/providers/4/assinatura/zapsign/ativar");
    expect(ok.status).toBe(200);
    expect(zapsignMock.testarToken).toHaveBeenCalledTimes(1);
    expect(storageMock.ativarIntegracaoDeAssinatura).toHaveBeenCalledWith(4);
    zapsignMock.testarToken.mockRejectedValueOnce(new ErroDeConfissao("ZAPSIGN_CREDENCIAL", "O ZapSign recusou o token", 422));
    const falha = await json("POST", "/api/admin/providers/4/assinatura/zapsign/ativar");
    expect(falha.status).toBe(422);
    expect((await falha.json()).message).toMatch(/recusou o token/);
    expect(storageMock.ativarIntegracaoDeAssinatura).toHaveBeenCalledTimes(1);
    storageMock.getIntegracaoComCredencial.mockResolvedValueOnce(undefined);
    expect((await json("POST", "/api/admin/providers/4/assinatura/zapsign/ativar")).status).toBe(400);
  });
  it("o corpo destas rotas não vai ao log de acesso", () => {
    expect(corpoEhSensivel("/api/admin/providers/4/assinatura/zapsign")).toBe(true);
    expect(corpoEhSensivel("/api/admin/providers/4/assinatura/zapsign/ativar")).toBe(true);
    expect(corpoEhSensivel("/api/admin/providers/4/plan")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/routes/admin-assinatura.routes.test.ts`
Expected: FAIL — `./admin-assinatura.routes` inexistente.

- [ ] **Step 3: Escrever `server/routes/admin-assinatura.routes.ts`**

```ts
/**
 * A conta ZapSign de cada provedor — configurada SÓ pelo superadmin, no molde
 * da configuração de ERP (admin.routes.ts). Router próprio pelo tamanho do
 * arquivo do ERP; os limites são os mesmos de lá (60/min salvar, 20/min testar).
 *
 * Diferente do ERP, o GET NUNCA devolve a credencial decifrada: só se a
 * credencial existe, se abre neste servidor e os 4 últimos caracteres.
 */
import { Router } from "express";
import { z } from "zod";
import { requireSuperAdmin } from "../auth";
import { storage } from "../storage";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { getSafeErrorMessage } from "../utils/safe-error";
import { clienteZapSign } from "../assinatura/zapsign";
import { ErroDeConfissao } from "../assinatura/erro";
import { AMBIENTES_DE_ASSINATURA, AUTH_MODES_DO_CLIENTE, AUTH_MODE_PADRAO, PRAZO_PADRAO_DE_ASSINATURA_DIAS } from "@shared/cobranca/confissao";

export const ConfiguracaoZapSignSchema = z.object({
  apiToken: z.string().max(500).nullable().optional(),
  ambiente: z.enum(AMBIENTES_DE_ASSINATURA).optional(),
  templateId: z.string().trim().max(120).nullable().optional(),
  signatarioNome: z.string().trim().max(160).nullable().optional(),
  signatarioCpf: z.string().trim().max(20).nullable().optional(),
  signatarioEmail: z.string().trim().email().max(160).nullable().optional(),
  signatarioTelefone: z.string().trim().max(30).nullable().optional(),
  provedorAssina: z.boolean().optional(),
  authModeCliente: z.enum(AUTH_MODES_DO_CLIENTE).optional(),
  exigirSelfie: z.boolean().optional(),
  prazoAssinaturaDias: z.number().int().min(1).max(90).optional(),
  enviarArquivoAssinadoWhatsapp: z.boolean().optional(),
}).strict().superRefine((d, ctx) => {
  if (d.provedorAssina && !(d.signatarioNome && d.signatarioEmail)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["signatarioEmail"], message: "Quando o provedor assina, informe nome e e-mail do representante" });
  }
});

const NAO_CONFIGURADA = {
  configurada: false, apiTokenGravado: false, apiTokenIlegivel: false, apiTokenFinal: null, ambiente: "sandbox", templateId: null,
  signatarioNome: null, signatarioCpf: null, signatarioEmail: null, signatarioTelefone: null, provedorAssina: false,
  authModeCliente: AUTH_MODE_PADRAO, exigirSelfie: false, prazoAssinaturaDias: PRAZO_PADRAO_DE_ASSINATURA_DIAS, enviarArquivoAssinadoWhatsapp: false,
  modeloRevisadoEm: null, isEnabled: false, ativadaEm: null, updatedAt: null,
};

export function registerAdminAssinaturaRoutes(): Router {
  const router = Router();
  const limiteConfig = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });
  const limiteAtivar = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });

  async function provedorDaRota(idCru: string): Promise<number | null> {
    const id = Number.parseInt(idCru, 10);
    if (!Number.isInteger(id) || id <= 0) return null;
    return (await storage.getProvider(id)) ? id : null;
  }

  router.get("/api/admin/providers/:id/assinatura/zapsign", requireSuperAdmin, async (req, res) => {
    try {
      const id = await provedorDaRota(String(req.params.id));
      if (!id) return res.status(404).json({ message: "Provedor nao encontrado" });
      res.json((await storage.getIntegracaoParaAdmin(id)) ?? NAO_CONFIGURADA);
    } catch (e) {
      res.status(500).json({ message: getSafeErrorMessage(e) });
    }
  });

  router.put("/api/admin/providers/:id/assinatura/zapsign", requireSuperAdmin, limiteConfig, async (req, res) => {
    try {
      const id = await provedorDaRota(String(req.params.id));
      if (!id) return res.status(404).json({ message: "Provedor nao encontrado" });
      const parsed = ConfiguracaoZapSignSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
      const atual = await storage.getIntegracaoParaAdmin(id);
      const tokenNovo = typeof parsed.data.apiToken === "string" && parsed.data.apiToken.trim().length > 0;
      if (atual?.apiTokenIlegivel && !tokenNovo) {
        return res.status(400).json({ message: "O token gravado não abre neste servidor — redigite o token do ZapSign para salvar" });
      }
      await storage.salvarIntegracaoDeAssinatura(id, parsed.data);
      res.json((await storage.getIntegracaoParaAdmin(id)) ?? NAO_CONFIGURADA);
    } catch (e) {
      res.status(500).json({ message: getSafeErrorMessage(e) });
    }
  });

  router.post("/api/admin/providers/:id/assinatura/zapsign/ativar", requireSuperAdmin, limiteAtivar, async (req, res) => {
    try {
      const id = await provedorDaRota(String(req.params.id));
      if (!id) return res.status(404).json({ message: "Provedor nao encontrado" });
      const credencial = await storage.getIntegracaoComCredencial(id);
      if (!credencial) return res.status(400).json({ message: "Salve o token do ZapSign antes de ativar" });
      try {
        await clienteZapSign({ apiToken: credencial.apiToken, ambiente: credencial.ambiente as "sandbox" | "producao" }).testarToken();
      } catch (e) {
        if (e instanceof ErroDeConfissao) return res.status(422).json({ message: e.message, code: e.codigo });
        throw e;
      }
      await storage.ativarIntegracaoDeAssinatura(id);
      res.json((await storage.getIntegracaoParaAdmin(id)) ?? NAO_CONFIGURADA);
    } catch (e) {
      if (e instanceof ErroDeConfissao) return res.status(e.http).json({ message: e.message, code: e.codigo });
      res.status(500).json({ message: getSafeErrorMessage(e) });
    }
  });

  return router;
}
```

- [ ] **Step 4: Registrar e tirar do log**

`server/routes/index.ts`: import `registerAdminAssinaturaRoutes` de `./admin-assinatura.routes` e, logo depois de `app.use(registerAdminRoutes());` (linha 64): `app.use(registerAdminAssinaturaRoutes());`.

`server/utils/sanitize-log.ts`, em `ROTAS_SEM_CORPO_NO_LOG`, depois da regex do ERP:

```ts
  /** O PUT carrega o token do ZapSign; o GET e o ativar devolvem a configuração da conta. */
  /^\/api\/admin\/providers\/\d+\/assinatura\/zapsign(\/ativar)?$/,
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run server/routes/admin-assinatura.routes.test.ts server/utils`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/admin-assinatura.routes.ts server/routes/admin-assinatura.routes.test.ts server/routes/index.ts server/utils/sanitize-log.ts
git commit -m "feat(confissao): configuração do ZapSign pelo superadmin — salvar, ativar, sem devolver segredo"
```

---

### Task 9: O cartão de configuração na ficha do provedor (superadmin)

**Files:**
- Create: `client/src/components/assinatura/FormularioZapSign.tsx`
- Create: `client/src/components/assinatura/FormularioZapSign.test.ts`
- Modify: `client/src/pages/admin/admin-provedor.tsx` (import ~linha 34; render antes do `</TabsContent>` da linha 4320, o fechamento do `TabsContent value="integracao"` principal de `IntegracaoTab`)

**Interfaces:**
- Consumes: as três rotas da Task 8; `AUTH_MODES_DO_CLIENTE`, `CUSTO_DO_AUTH_MODE`, `custoDaEmissao`, `AMBIENTES_DE_ASSINATURA` (Task 1); `apiRequest` (`@/lib/queryClient`); `Card`, `Input`, `Label`, `Select*`, `Switch`, `useToast`.
- Produces: `FormularioZapSign({ providerId, ativo })`.

- [ ] **Step 1: Escrever o teste de fonte que falha**

`client/src/components/assinatura/FormularioZapSign.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Componente .tsx não renderiza em teste (sem DOM): o contrato é conferido no FONTE. */
const fonte = readFileSync(new URL("./FormularioZapSign.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const pagina = readFileSync(new URL("../../pages/admin/admin-provedor.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("FormularioZapSign", () => {
  it("fala com as três rotas do superadmin e só com elas", () => {
    expect(fonte).toContain("`/api/admin/providers/${providerId}/assinatura/zapsign`");
    expect(fonte).toContain("`/api/admin/providers/${providerId}/assinatura/zapsign/ativar`");
    expect(fonte).not.toContain("/api/provider/");
  });
  it("o token é campo de senha, nunca preenchido pelo servidor; Salvar e Ativar são ações separadas", () => {
    expect(fonte).toMatch(/type="password"/);
    expect(fonte).toContain("apiTokenFinal");
    expect(fonte).not.toContain("webhookSecret");
    expect(fonte).toContain(">Salvar<");
    expect(fonte).toContain(">Ativar<");
  });
  it("mostra a base legal e o custo de cada auth_mode, o aviso do sandbox e o aviso da selfie", () => {
    expect(fonte).toContain("CUSTO_DO_AUTH_MODE");
    expect(fonte).toContain("sem validade jurídica");
    expect(fonte).toContain("LGPD art. 11, II, d");
    expect(fonte).toContain("MP 2.200-2/2001");
  });
  it("assinaturaTela puro não é opção", () => {
    expect(fonte).toContain("AUTH_MODES_DO_CLIENTE");
    expect(fonte).not.toMatch(/value="assinaturaTela"/);
  });
  it("está montado na aba Integração da ficha do provedor", () => {
    expect(pagina).toContain('import { FormularioZapSign } from "@/components/assinatura/FormularioZapSign";');
    expect(pagina).toContain("<FormularioZapSign providerId={providerId} ativo={ativo} />");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run client/src/components/assinatura/FormularioZapSign.test.ts`
Expected: FAIL — arquivo inexistente.

- [ ] **Step 3: Escrever `client/src/components/assinatura/FormularioZapSign.tsx`**

```tsx
/**
 * A conta ZapSign do provedor, configurada pelo superadmin na ficha do
 * provedor (aba Integração), ao lado do ERP. "Salvar" grava; "Ativar" testa o
 * token no ZapSign e liga — separados como "Salvar" e "Testar" do ERP.
 *
 * O servidor nunca devolve o token: o campo é de senha, vazio, e o que se
 * mostra é "gravado · final 1234". Token vazio ao salvar = "não mexe".
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  AMBIENTES_DE_ASSINATURA, AUTH_MODES_DO_CLIENTE, CUSTO_DO_AUTH_MODE, custoDaEmissao,
  type AmbienteDeAssinatura, type AuthModeDoCliente,
} from "@shared/cobranca/confissao";

interface EstadoDaConta {
  configurada: boolean;
  apiTokenGravado: boolean;
  apiTokenIlegivel: boolean;
  apiTokenFinal: string | null;
  ambiente: AmbienteDeAssinatura;
  templateId: string | null;
  signatarioNome: string | null;
  signatarioCpf: string | null;
  signatarioEmail: string | null;
  signatarioTelefone: string | null;
  provedorAssina: boolean;
  authModeCliente: AuthModeDoCliente;
  exigirSelfie: boolean;
  prazoAssinaturaDias: number;
  enviarArquivoAssinadoWhatsapp: boolean;
  modeloRevisadoEm: string | null;
  isEnabled: boolean;
  ativadaEm: string | null;
}

type Formulario = Omit<EstadoDaConta, "configurada" | "apiTokenGravado" | "apiTokenIlegivel" | "apiTokenFinal" | "modeloRevisadoEm" | "isEnabled" | "ativadaEm"> & { apiToken: string };

const ROTULO_AMBIENTE: Record<AmbienteDeAssinatura, string> = { sandbox: "Sandbox (testes — sem validade jurídica)", producao: "Produção" };

function formularioDe(e: EstadoDaConta): Formulario {
  return {
    apiToken: "",
    ambiente: e.ambiente, templateId: e.templateId, signatarioNome: e.signatarioNome, signatarioCpf: e.signatarioCpf, signatarioEmail: e.signatarioEmail,
    signatarioTelefone: e.signatarioTelefone, provedorAssina: e.provedorAssina, authModeCliente: e.authModeCliente, exigirSelfie: e.exigirSelfie,
    prazoAssinaturaDias: e.prazoAssinaturaDias, enviarArquivoAssinadoWhatsapp: e.enviarArquivoAssinadoWhatsapp,
  };
}

const CAMPO = "h-9 rounded text-[13px]";

export function FormularioZapSign({ providerId, ativo }: { providerId: number; ativo: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const chave = ["/api/admin/providers", providerId, "assinatura", "zapsign"];
  const { data, isLoading, isError } = useQuery<EstadoDaConta>({
    queryKey: chave,
    queryFn: async () => (await apiRequest("GET", `/api/admin/providers/${providerId}/assinatura/zapsign`)).json(),
    enabled: ativo,
  });
  const [form, setForm] = useState<Formulario | null>(null);
  useEffect(() => { if (data) setForm(formularioDe(data)); }, [data]);

  const salvar = useMutation({
    mutationFn: async (f: Formulario) => {
      const corpo: Record<string, unknown> = { ...f };
      if (!f.apiToken.trim()) delete corpo.apiToken;
      const res = await apiRequest("PUT", `/api/admin/providers/${providerId}/assinatura/zapsign`, corpo);
      return res.json() as Promise<EstadoDaConta>;
    },
    onSuccess: novo => { qc.setQueryData(chave, novo); setForm(formularioDe(novo)); toast({ title: "Configuração do ZapSign salva", description: novo.isEnabled ? "Integração ativa" : "Clique em Ativar para testar o token e ligar" }); },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });
  const ativar = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/providers/${providerId}/assinatura/zapsign/ativar`)).json() as Promise<EstadoDaConta>,
    onSuccess: novo => { qc.setQueryData(chave, novo); toast({ title: "ZapSign ativo", description: `Ambiente: ${ROTULO_AMBIENTE[novo.ambiente]}` }); },
    onError: (e: Error) => toast({ title: "O ZapSign recusou o token", description: e.message, variant: "destructive" }),
  });

  if (!ativo) return null;
  if (isLoading || !form) return <Card className="p-4 text-[12px] text-[var(--text-muted)]" data-testid="zapsign-carregando">Lendo a configuração do ZapSign…</Card>;
  if (isError) return <Card className="p-4 text-[12px] text-[var(--danger)]" data-testid="zapsign-erro">Não foi possível ler a configuração do ZapSign.</Card>;

  const custo = custoDaEmissao({ authMode: form.authModeCliente, ambiente: form.ambiente, enviarWhatsapp: form.enviarArquivoAssinadoWhatsapp, exigirSelfie: form.exigirSelfie });
  const set = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setForm(f => (f ? { ...f, [k]: v } : f));
  const ocupado = salvar.isPending || ativar.isPending;

  return (
    <Card className="p-4 space-y-4" data-testid="card-zapsign">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}><FileSignature className="w-5 h-5" /></div>
          <div>
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--text)", letterSpacing: "var(--track-tight)" }}>Assinatura eletrônica · ZapSign</h3>
            <p className="text-[12px] text-[var(--text-muted)]">A conta é do provedor: ele cria em zapsign.com.br, gera o token em Configurações › Integrações › API ZapSign e paga os documentos dele.</p>
          </div>
        </div>
        <span className={cn("inline-flex items-center rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[var(--track-wide)]", data?.isEnabled ? "border-[var(--ok-border)] bg-[var(--ok-bg)] text-[var(--ok)]" : "border-[var(--gated-border)] bg-[var(--gated-bg)] text-[var(--gated)]")} data-testid="zapsign-status">
          {data?.isEnabled ? `ativa · ${ROTULO_AMBIENTE[data.ambiente]}` : data?.configurada ? "salva · não ativada" : "não configurada"}
        </span>
      </div>

      {data?.apiTokenIlegivel && (
        <p className="flex items-start gap-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] p-2 text-[12px] text-[var(--danger)]" data-testid="zapsign-ilegivel">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden /> O token gravado não abre neste servidor (o segredo de sessão mudou). Redigite o token para salvar.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[12px]">Ambiente</Label>
          <Select value={form.ambiente} onValueChange={v => set("ambiente", v as AmbienteDeAssinatura)}>
            <SelectTrigger className={CAMPO}><SelectValue /></SelectTrigger>
            <SelectContent>{AMBIENTES_DE_ASSINATURA.map(a => <SelectItem key={a} value={a}>{ROTULO_AMBIENTE[a]}</SelectItem>)}</SelectContent>
          </Select>
          {form.ambiente === "sandbox" && <p className="text-[11px] text-[var(--gated)]">Sandbox: documento sem validade jurídica; nada é enviado ao cliente — o operador só copia o link.</p>}
        </div>
        <div className="space-y-1">
          <Label className="text-[12px]">Token da API</Label>
          <Input type="password" autoComplete="new-password" className={CAMPO} value={form.apiToken} onChange={e => set("apiToken", e.target.value)}
            placeholder={data?.apiTokenGravado ? `gravado · final ${data.apiTokenFinal ?? "????"} — deixe vazio para manter` : "cole o token da conta do provedor"} />
          <p className="text-[11px] text-[var(--text-faint)]">Trocar token ou ambiente exige Ativar de novo; o segredo do webhook é regenerado.</p>
        </div>
        <div className="space-y-1">
          <Label className="text-[12px]">Modelo do ZapSign (opcional)</Label>
          <Input className={CAMPO} value={form.templateId ?? ""} onChange={e => set("templateId", e.target.value || null)} placeholder="template_id — vazio usa o modelo padrão do Consulta ISP" />
          <p className="text-[11px] text-[var(--text-faint)]">Variáveis do modelo: {"{{CREDOR_RAZAO_SOCIAL}}"}, {"{{DEVEDOR_NOME}}"}, {"{{VALOR_TOTAL}}"}, {"{{PARCELAS}}"}, {"{{ANEXO_FATURAS}}"} e as demais listadas na spec.</p>
        </div>
        <div className="space-y-1">
          <Label className="text-[12px]">Prazo para assinar (dias)</Label>
          <Input type="number" min={1} max={90} className={cn(CAMPO, "font-mono tabular-nums")} value={form.prazoAssinaturaDias} onChange={e => set("prazoAssinaturaDias", Math.max(1, Math.min(90, Number(e.target.value) || 1)))} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-[12px]">Como o cliente prova quem é (auth_mode)</Label>
          <Select value={form.authModeCliente} onValueChange={v => set("authModeCliente", v as AuthModeDoCliente)}>
            <SelectTrigger className={CAMPO}><SelectValue /></SelectTrigger>
            <SelectContent>
              {AUTH_MODES_DO_CLIENTE.map(m => (
                <SelectItem key={m} value={m}>{CUSTO_DO_AUTH_MODE[m].rotulo} · {CUSTO_DO_AUTH_MODE[m].creditos > 0 ? `${CUSTO_DO_AUTH_MODE[m].creditos} créditos` : CUSTO_DO_AUTH_MODE[m].reais > 0 ? `R$ ${CUSTO_DO_AUTH_MODE[m].reais.toFixed(2).replace(".", ",")}` : "sem custo"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-[var(--text-faint)]">Base legal: assinatura eletrônica admitida pelas partes (MP 2.200-2/2001, art. 10, §2º) e título executivo extrajudicial (CPC, art. 784, III e §4º). A prova é {CUSTO_DO_AUTH_MODE[form.authModeCliente].prova}. Custo por emissão: {custo.texto}.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex items-start gap-2 text-[12px]">
          <Switch checked={form.exigirSelfie} onCheckedChange={v => set("exigirSelfie", v)} aria-label="Exigir selfie" />
          <span>Exigir selfie do cliente<br /><span className="text-[11px] text-[var(--text-faint)]">Dado biométrico (LGPD art. 11, II, d) — desligado por padrão; 15 a 50 créditos por assinatura.</span></span>
        </label>
        <label className="flex items-start gap-2 text-[12px]">
          <Switch checked={form.enviarArquivoAssinadoWhatsapp} onCheckedChange={v => set("enviarArquivoAssinadoWhatsapp", v)} aria-label="Enviar o PDF assinado por WhatsApp" />
          <span>Enviar o PDF assinado por WhatsApp<br /><span className="text-[11px] text-[var(--text-faint)]">R$ 0,50 por envio, só em produção.</span></span>
        </label>
        <label className="flex items-start gap-2 text-[12px]">
          <Switch checked={form.provedorAssina} onCheckedChange={v => set("provedorAssina", v)} aria-label="O provedor também assina" />
          <span>O provedor também assina<br /><span className="text-[11px] text-[var(--text-faint)]">O título exige só a assinatura do devedor; ligar acrescenta um fluxo e trava o status até o representante assinar.</span></span>
        </label>
      </div>

      {form.provedorAssina && (
        <div className="grid gap-3 sm:grid-cols-4" data-testid="zapsign-representante">
          <div className="space-y-1"><Label className="text-[12px]">Representante · nome</Label><Input className={CAMPO} value={form.signatarioNome ?? ""} onChange={e => set("signatarioNome", e.target.value || null)} /></div>
          <div className="space-y-1"><Label className="text-[12px]">CPF</Label><Input className={cn(CAMPO, "font-mono tabular-nums")} value={form.signatarioCpf ?? ""} onChange={e => set("signatarioCpf", e.target.value || null)} /></div>
          <div className="space-y-1"><Label className="text-[12px]">E-mail</Label><Input type="email" className={CAMPO} value={form.signatarioEmail ?? ""} onChange={e => set("signatarioEmail", e.target.value || null)} /></div>
          <div className="space-y-1"><Label className="text-[12px]">Telefone</Label><Input className={cn(CAMPO, "font-mono tabular-nums")} value={form.signatarioTelefone ?? ""} onChange={e => set("signatarioTelefone", e.target.value || null)} /></div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" className="h-9 rounded bg-[var(--action)] px-4 text-[13px] font-medium text-[var(--text-on-brand)] hover:bg-[var(--action-hover)] disabled:opacity-60" disabled={ocupado} onClick={() => salvar.mutate(form)} data-testid="zapsign-salvar">Salvar</button>
        <button type="button" className="h-9 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[13px] font-medium text-[var(--text)] disabled:opacity-60" disabled={ocupado || !data?.apiTokenGravado || data?.apiTokenIlegivel} onClick={() => ativar.mutate()} title="Testa o token no ZapSign e liga a integração" data-testid="zapsign-ativar">Ativar</button>
        <span className="text-[11px] text-[var(--text-faint)]">
          {data?.modeloRevisadoEm ? `Modelo padrão marcado como revisado pelo provedor em ${new Date(data.modeloRevisadoEm).toLocaleDateString("pt-BR")}.` : "O modelo padrão sai com o aviso \"sem parecer jurídico\" até um admin do provedor marcá-lo como revisado."}
        </span>
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Montar na ficha do provedor**

Em `client/src/pages/admin/admin-provedor.tsx`: junto dos imports de componentes (linha 34) acrescente `import { FormularioZapSign } from "@/components/assinatura/FormularioZapSign";`. No `return` principal de `IntegracaoTab` (o `<TabsContent value="integracao" …>` da linha 3747), imediatamente antes do `</TabsContent>` que o fecha (linha 4320), acrescente:

```tsx
      {/* A assinatura eletrônica mora aqui, ao lado do ERP: é a outra conta de terceiro que o superadmin grava pelo provedor. */}
      <FormularioZapSign providerId={providerId} ativo={ativo} />
```

- [ ] **Step 5: Rodar o teste, o tsc e olhar a tela**

Run: `npx vitest run client/src/components/assinatura && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: PASS; `58`. Abra `npm run dev`, entre como superadmin em `/admin/provedor/1`, aba Integração: o cartão aparece depois dos ERPs com "não configurada"; salve um token de sandbox de teste e clique em Ativar — sem conta, o ZapSign responde 401 e a tela mostra "O ZapSign recusou o token".

- [ ] **Step 6: Commit**

```bash
git add client/src/components/assinatura/FormularioZapSign.tsx client/src/components/assinatura/FormularioZapSign.test.ts client/src/pages/admin/admin-provedor.tsx
git commit -m "feat(confissao): cartão do ZapSign na ficha do provedor — Salvar e Ativar, custo e base legal por auth_mode"
```

---

## Fase 2 — Emissão e retorno

### Task 10: A base da confissão — acordo ou saldo integral, ao vivo, sem digitação

**Files:**
- Create: `server/services/confissao/confissao-base.service.ts`
- Create: `server/services/confissao/confissao-base.service.test.ts`

**Interfaces:**
- Consumes: `storage.getCustomersByProvider`, `getProvider`, `casoAbertoDoCliente`, `listarNegociacoesDoCaso`, `getPoliticaDeCobranca`, `getIntegracaoComCredencial` (Task 7); `snapshotAoVivoDoCliente` (`server/services/cobranca/snapshot-ao-vivo.service.ts`); `estadoDaIntegracao` (`server/services/chat/chat-ponte.service.ts`); `parcelasDaDescricao` (`@shared/cobranca/multa`); `validarPolitica`, `POLITICA_PADRAO`, `valorAtualizado`, `prescricaoPorAtraso`, `ROTULO_ORIGEM_DA_COBRANCA` (`@shared/cobranca`); Task 1 e Task 3.
- Produces: `montarBase(providerId, customerId, opcoes: OpcoesDaBase): Promise<BaseMontada>`, `hashDaBase(canonica): string`, `estadoDaAssinatura(providerId): Promise<EstadoDaAssinatura>`, `politicaDoProvedor(providerId)`, tipos `OpcoesDaBase`, `BaseMontada`.

- [ ] **Step 1: Escrever o teste que falha**

`server/services/confissao/confissao-base.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A base é a parte que decide o que se confessa. O que se prova: acordo usa só
 * as parcelas em aberto e guarda o recebido; saldo integral exige leitura ao
 * vivo, bate Σ faturas com a dívida do ERP, separa multa/equipamento em linhas
 * desmarcáveis e soma encargos só no serviço; os bloqueios da spec §8; o hash
 * muda quando a base muda e não muda com o relógio.
 */
const storageMock = vi.hoisted(() => ({
  getCustomersByProvider: vi.fn(async (): Promise<any[]> => [cliente()]),
  getProvider: vi.fn(async (): Promise<any> => ({ id: 1, name: "NsLink Telecom Ltda", tradeName: "NsLink", cnpj: "12345678000199", addressStreet: "Rua A", addressNumber: "10", addressNeighborhood: "Centro", addressCity: "Lavras do Norte", addressState: "MG", addressZip: "39000000" })),
  casoAbertoDoCliente: vi.fn(async (): Promise<any> => ({ id: 9, status: "aberto", customerId: 42 })),
  listarNegociacoesDoCaso: vi.fn(async (): Promise<any[]> => []),
  getPoliticaDeCobranca: vi.fn(async (): Promise<any> => undefined),
  getIntegracaoComCredencial: vi.fn(async (): Promise<any> => integracao()),
}));
vi.mock("../../storage", () => ({ storage: storageMock }));
const snapshotMock = vi.hoisted(() => ({ snapshotAoVivoDoCliente: vi.fn(async (): Promise<any> => snapshot()) }));
vi.mock("../cobranca/snapshot-ao-vivo.service", () => snapshotMock);
vi.mock("../chat/chat-ponte.service", () => ({ estadoDaIntegracao: vi.fn(async () => ({ ligado: true, canal: { id: "c1" } })) }));
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { estadoDaAssinatura, hashDaBase, montarBase } from "./confissao-base.service";

const HOJE = new Date(2026, 8, 10, 10, 0); // 10/09/2026
function cliente(extra: Record<string, unknown> = {}) {
  return { id: 42, providerId: 1, name: "Maria da Silva", cpfCnpj: "12345678901", email: "maria@example.com", phone: "31999990000", address: "Rua B", addressNumber: "20", neighborhood: "Bairro", city: "Lavras do Norte", state: "MG", cep: "39000000", status: "suspended", erpCustomerId: "4471", contractPlan: "Fibra 300", contractStartDate: "2024-03-15", totalOverdueAmount: "819.76", ...extra };
}
function integracao(extra: Record<string, unknown> = {}) {
  return { apiToken: "tok", ambiente: "producao", templateId: null, provedorAssina: false, authModeCliente: "assinaturaTela-tokenWhatsapp", exigirSelfie: false, prazoAssinaturaDias: 15, enviarArquivoAssinadoWhatsapp: false, modeloRevisadoEm: null, isEnabled: true, webhookSecret: "s", ...extra };
}
function snapshot(extra: Record<string, unknown> = {}) {
  return { ok: true, erpSource: "mk", encontrado: false === extra.encontrado ? false : true, leituraParcial: false, lidoEm: "2026-09-10T13:00:00.000Z", cliente: {
    nome: "Maria da Silva", plano: "Fibra 300", statusContrato: "suspended", dividaAtual: 819.76, diasAtraso: 62, faturasAbertas: 2, email: "maria@example.com", telefone: "31999990000", contractStartDate: "2024-03-15",
    faturas: [
      { ref: "F-1", vencimento: "2026-07-10", valor: 99.9, descricao: "Mensalidade 07/2026" },
      { ref: "F-2", vencimento: "2026-08-10", valor: 719.86, descricao: "Multa rescisória R$ 619,96 + mensalidade 99,90" },
      { ref: "F-3", vencimento: "2026-10-10", valor: 99.9, descricao: "Mensalidade 10/2026" },
    ],
  }, ...extra };
}

beforeEach(() => { vi.clearAllMocks(); storageMock.getCustomersByProvider.mockResolvedValue([cliente()]); storageMock.getIntegracaoComCredencial.mockResolvedValue(integracao()); snapshotMock.snapshotAoVivoDoCliente.mockResolvedValue(snapshot()); });

describe("saldo integral", () => {
  it("lê o ERP ao vivo (forçado), só faturas vencidas, divide multa com valor em linha própria e soma encargos só no serviço", async () => {
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(snapshotMock.snapshotAoVivoDoCliente).toHaveBeenCalledWith(1, "12345678901", { forcar: true });
    expect(b.dto.origem).toBe("saldo_integral");
    expect(b.dto.anexo.map(a => a.chave)).toEqual(["F-1", "F-2", "F-2#multa"]);
    const servico = b.dto.anexo.find(a => a.chave === "F-2")!;
    const multa = b.dto.anexo.find(a => a.chave === "F-2#multa")!;
    expect(servico).toMatchObject({ classe: "servico", valor: 99.9, diasAtraso: 31 });
    expect(multa).toMatchObject({ classe: "multa", valor: 619.96, multa: 0, juros: 0 });
    expect(b.dto.faturasDeSaida).toEqual(["F-2#multa"]);
    expect(b.dto.anexo.find(a => a.chave === "F-1")).toMatchObject({ multa: 2, juros: 2.06 }); // 99,90 × 2% e 99,90 × 1% × 62/30
    expect(b.dto.valorTotal).toBeCloseTo(99.9 + 2 + 2.06 + 99.9 + 2 + 1.03 + 619.96, 2);
    expect(b.dto.parcelas).toHaveLength(1);
    expect(b.dto.vencimento).toEqual({ minimo: "2026-09-26", maximo: "2026-12-09", escolhido: null });
    expect(b.dto.bloqueios).toEqual([]);
    expect(b.dto.baseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.dto.previa).toMatchObject({ modelo: "padrao" });
  });
  it("desmarcar a multa recalcula o total; o vencimento escolhido entra na parcela e muda o hash", async () => {
    const a = await montarBase(1, 42, { hoje: HOJE });
    const b = await montarBase(1, 42, { hoje: HOJE, faturasExcluidas: ["F-2#multa"], vencimento: "2026-10-15" });
    expect(b.dto.valorTotal).toBeCloseTo(a.dto.valorTotal - 619.96, 2);
    expect(b.dto.parcelas[0].vencimento).toBe("2026-10-15");
    expect(b.dto.baseHash).not.toBe(a.dto.baseHash);
    const c = await montarBase(1, 42, { hoje: HOJE, faturasExcluidas: ["F-2#multa"], vencimento: "2026-10-15" });
    expect(c.dto.baseHash).toBe(b.dto.baseHash);
  });
  it("vencimento fora da janela é bloqueio; sem ERP ao vivo não se emite; leitura parcial também não", async () => {
    expect((await montarBase(1, 42, { hoje: HOJE, vencimento: "2026-09-20" })).dto.bloqueios).toContainEqual(expect.stringContaining("entre 26/09/2026 e 09/12/2026"));
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce({ ok: false, erpSource: "mk", encontrado: false, cliente: null, erro: "timeout", lidoEm: "x" });
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("sem leitura ao vivo não se emite título"));
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ leituraParcial: true }));
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("sem leitura ao vivo"));
  });
  it("Σ faturas ≠ dívida do ERP bloqueia e mostra os dois números; sem fatura vencida, nada a formalizar", async () => {
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ cliente: { ...snapshot().cliente, dividaAtual: 900 } }));
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(b.dto.bloqueios).toContainEqual(expect.stringMatching(/R\$ 819,76.*R\$ 900,00/));
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ cliente: { ...snapshot().cliente, dividaAtual: 0, faturas: [{ ref: "F-3", vencimento: "2026-10-10", valor: 99.9 }] } }));
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("nada a formalizar"));
  });
  it("fatura indeterminada acende o aviso; prescrita bloqueia", async () => {
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ cliente: { ...snapshot().cliente, dividaAtual: 300, faturas: [{ ref: "F-9", vencimento: "2026-06-10", valor: 300, descricao: "Mensalidade e multa" }] } }));
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(b.dto.faturasIndeterminadas).toBe(1);
    expect(b.dto.avisos).toContainEqual(expect.stringContaining("mistura mensalidade e multa sem valores"));
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ cliente: { ...snapshot().cliente, dividaAtual: 99.9, diasAtraso: 1900, faturas: [{ ref: "F-0", vencimento: "2021-06-10", valor: 99.9, descricao: "Mensalidade" }] } }));
    const p = await montarBase(1, 42, { hoje: HOJE });
    expect(p.dto.prescrita).toBe(true);
    expect(p.dto.bloqueios).toContainEqual(expect.stringContaining("CC art. 191"));
  });
});

describe("acordo", () => {
  const negociacao = () => ({ id: 3, status: "aceita", valorOriginal: "1000.00", valorNegociado: "800.00", descontoPct: "20.00", entrada: "200.00", parcelas: 2, parcelamento: [
    { id: 30, numero: 0, valor: "200.00", vencimento: "2026-09-01", status: "paga", valorPago: "200.00" },
    { id: 31, numero: 1, valor: "300.00", vencimento: "2026-10-01", status: "pendente", valorPago: null },
    { id: 32, numero: 2, valor: "300.00", vencimento: "2026-11-01", status: "atrasada", valorPago: null },
  ] });
  it("espelha só as parcelas em aberto, guarda o recebido e o desconto, e reconfere o saldo ao vivo", async () => {
    storageMock.listarNegociacoesDoCaso.mockResolvedValue([negociacao()]);
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(b.dto.origem).toBe("acordo");
    expect(b.dto.negociacaoId).toBe(3);
    expect(b.dto.parcelas).toEqual([{ n: 1, rotulo: "parcela", valor: 300, vencimento: "2026-10-01" }, { n: 2, rotulo: "parcela", valor: 300, vencimento: "2026-11-01" }]);
    expect(b.dto).toMatchObject({ valorTotal: 600, valorOriginal: 1000, descontoPct: 20, recebidoDoAcordo: 200 });
    expect(b.dto.anexo.length).toBeGreaterThan(0); // as faturas de origem, informativas
    expect(b.dto.bloqueios).toEqual([]);
  });
  it("entrada não recebida entra como 'entrada'; saldo do ERP menor que o do acordo bloqueia", async () => {
    const n = negociacao();
    n.parcelamento[0].status = "pendente";
    storageMock.listarNegociacoesDoCaso.mockResolvedValue([n]);
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ cliente: { ...snapshot().cliente, dividaAtual: 500 } }));
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(b.dto.parcelas[0]).toEqual({ n: 0, rotulo: "entrada", valor: 200, vencimento: "2026-09-01" });
    expect(b.dto.valorTotal).toBe(800);
    expect(b.dto.bloqueios).toContainEqual(expect.stringMatching(/saldo no ERP \(R\$ 500,00\) é menor que o do acordo \(R\$ 800,00\)/));
  });
});

describe("bloqueios de cadastro e configuração", () => {
  it("sem integração ativa, sem caso, sem documento, sem contato, PJ sem representante", async () => {
    storageMock.getIntegracaoComCredencial.mockResolvedValueOnce(undefined);
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("assinatura eletrônica não configurada"));
    storageMock.casoAbertoDoCliente.mockResolvedValueOnce(undefined);
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("abra o caso antes"));
    storageMock.getCustomersByProvider.mockResolvedValueOnce([cliente({ cpfCnpj: "" })]);
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("sem CPF/CNPJ"));
    storageMock.getCustomersByProvider.mockResolvedValueOnce([cliente({ email: null, phone: null })]);
    snapshotMock.snapshotAoVivoDoCliente.mockResolvedValueOnce(snapshot({ cliente: { ...snapshot().cliente, email: null, telefone: null } }));
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("sem e-mail e sem telefone"));
    storageMock.getCustomersByProvider.mockResolvedValueOnce([cliente({ cpfCnpj: "11222333000181", name: "Padaria Ltda" })]);
    const pj = await montarBase(1, 42, { hoje: HOJE });
    expect(pj.dto.cliente.pessoaJuridica).toBe(true);
    expect(pj.dto.bloqueios).toContainEqual(expect.stringContaining("representante legal"));
    storageMock.getCustomersByProvider.mockResolvedValueOnce([cliente({ cpfCnpj: "11222333000181", name: "Padaria Ltda" })]);
    expect((await montarBase(1, 42, { hoje: HOJE, representante: { nome: "João", cpf: "98765432100" } })).dto.bloqueios).toEqual([]);
  });
  it("contato informado pelo operador substitui o do cadastro e marca alteração", async () => {
    const b = await montarBase(1, 42, { hoje: HOJE, email: "outro@example.com" });
    expect(b.dto.cliente.email).toBe("outro@example.com");
    expect(b.contatoAlterado).toBe(true);
    expect(b.dto.avisos).toContainEqual(expect.stringContaining("validação do CPF"));
    expect((await montarBase(1, 42, { hoje: HOJE })).contatoAlterado).toBe(false);
  });
  it("credencial ilegível vira bloqueio, não 500; a política do provedor define os encargos", async () => {
    const { ErroDeConfissao } = await import("../../assinatura/erro");
    storageMock.getIntegracaoComCredencial.mockRejectedValueOnce(new ErroDeConfissao("CREDENCIAL_ILEGIVEL", "não abre", 409));
    expect((await montarBase(1, 42, { hoje: HOJE })).dto.bloqueios).toContainEqual(expect.stringContaining("não abre"));
    // A linha gravada tem as MESMAS colunas da política inteira (validarPolitica recusa política pela metade).
    const { POLITICA_PADRAO } = await import("@shared/cobranca");
    storageMock.getPoliticaDeCobranca.mockResolvedValueOnce({ ...structuredClone(POLITICA_PADRAO), encargos: { multaPct: 1, jurosMesPct: 0.5 }, updatedAt: null });
    const b = await montarBase(1, 42, { hoje: HOJE });
    expect(b.dto.encargos).toMatchObject({ multaPct: 1, jurosMesPct: 0.5 });
  });
  it("o hash é do JSON canônico e não leva data/hora", () => {
    const base: any = { versao: "1.0", origem: "saldo_integral", parcelas: [] };
    expect(hashDaBase(base)).toBe(hashDaBase({ ...base }));
    expect(hashDaBase(base)).not.toBe(hashDaBase({ ...base, origem: "acordo" }));
  });
});

describe("estado da assinatura", () => {
  it("resume configuração, ambiente, modelo, custo e chat", async () => {
    const e = await estadoDaAssinatura(1);
    expect(e).toMatchObject({ configurada: true, ativa: true, ambiente: "producao", modelo: "padrao", modeloRevisado: false, provedorAssina: false, authMode: "assinaturaTela-tokenWhatsapp", prazoAssinaturaDias: 15, chatDisponivel: true, motivo: null });
    expect(e.custo?.creditos).toBe(5);
    storageMock.getIntegracaoComCredencial.mockResolvedValueOnce(undefined);
    expect(await estadoDaAssinatura(1)).toMatchObject({ configurada: false, ativa: false, motivo: expect.stringContaining("superadmin") });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/services/confissao/confissao-base.service.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever `server/services/confissao/confissao-base.service.ts`**

```ts
/**
 * A base da confissão (spec §6.2): o servidor monta o que se confessa, sem
 * digitação. Duas origens:
 *  - ACORDO: negociação em `aceita`/`ativa`; entram só as parcelas de
 *    `cobranca_parcelas` em pendente/atrasada/conciliacao_pendente; a entrada
 *    (numero 0) como "entrada" se ainda não recebida; guarda valor original,
 *    desconto e o já recebido. O saldo do ERP ao vivo não pode ser menor.
 *  - SALDO INTEGRAL: o ERP AO VIVO (forçado), só com ok && encontrado &&
 *    !leituraParcial; Anexo I = faturas vencidas; multa/equipamento com valor
 *    lido da descrição viram linha própria (desmarcável); encargos da política
 *    só no serviço (decisão 2.2-1). Σ faturas tem de bater com `dividaAtual`.
 * Sem leitura ao vivo NÃO se emite — nunca cai para a base sincronizada.
 *
 * O hash é o SHA-256 do JSON canônico (sem data/hora): o GET devolve, o POST
 * devolve de volta, e o servidor recalcula — se mudou, "A dívida mudou".
 */
import { createHash } from "node:crypto";
import { storage } from "../../storage";
import { logger } from "../../logger";
import { snapshotAoVivoDoCliente, type SnapshotAoVivo } from "../cobranca/snapshot-ao-vivo.service";
import { carteiraDoStatusErp } from "../../storage/cobranca.storage";
import { estadoDaIntegracao } from "../chat/chat-ponte.service";
import { ErroDeConfissao } from "../../assinatura/erro";
import { parcelasDaDescricao } from "@shared/cobranca/multa";
import { POLITICA_PADRAO, ROTULO_ORIGEM_DA_COBRANCA, prescricaoPorAtraso, validarPolitica, valorAtualizado, type Encargos, type Politica } from "@shared/cobranca";
import {
  baseCanonica, renderizarConfissao, serializarBase, textoDaConfissao, variaveisDoModeloZapSign, VERSAO_DO_MODELO,
  type BaseCanonica, type EntradaDoModelo, type Representante,
} from "@shared/cobranca/confissao-modelo";
import {
  custoDaEmissao, PRAZO_MAXIMO_DO_VENCIMENTO_DIAS,
  type AmbienteDeAssinatura, type AuthModeDoCliente, type BaseDaConfissaoDto, type EstadoDaAssinatura, type FaturaDoAnexo, type OrigemDaConfissao, type ParcelaConfessada,
} from "@shared/cobranca/confissao";
import type { CobrancaCaso, Customer, Provider } from "@shared/schema";
import type { IntegracaoComCredencial } from "../../storage/assinatura.storage";
import type { NegociacaoComParcelas } from "../../storage/cobranca.storage";

export interface OpcoesDaBase {
  vencimento?: string | null;
  faturasExcluidas?: string[];
  email?: string | null;
  telefone?: string | null;
  representante?: Representante | null;
  hoje?: Date;
}

export interface BaseMontada {
  dto: BaseDaConfissaoDto;
  /** null quando há bloqueio de configuração/cadastro que impede montar o texto. */
  entrada: EntradaDoModelo | null;
  canonica: BaseCanonica | null;
  hash: string | null;
  cliente: Customer | null;
  provedor: Provider | null;
  caso: CobrancaCaso | null;
  negociacao: NegociacaoComParcelas | null;
  integracao: IntegracaoComCredencial | null;
  encargos: Encargos;
  contatoAlterado: boolean;
  contatoDoErp: { email: string | null; telefone: string | null };
  snapshot: SnapshotAoVivo | null;
}

const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const centavos = (n: number) => Math.round(n * 100) / 100;
const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const maisDias = (d: Date, dias: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias);
const diasEntre = (deIso: string, ate: Date) => Math.max(0, Math.round((new Date(ate.getFullYear(), ate.getMonth(), ate.getDate()).getTime() - new Date(`${deIso}T00:00:00`).getTime()) / 86_400_000));

export function hashDaBase(canonica: BaseCanonica): string {
  return createHash("sha256").update(serializarBase(canonica)).digest("hex");
}

/** A mesma leitura de `carregarPolitica` (cobranca.routes.ts), sem importar o router. */
export async function politicaDoProvedor(providerId: number): Promise<Politica> {
  const linha = await storage.getPoliticaDeCobranca(providerId);
  if (!linha) return POLITICA_PADRAO;
  const r = validarPolitica({ etapas: linha.etapas, negociacao: linha.negociacao, encargos: linha.encargos, janelaContato: linha.janelaContato, economia: linha.economia, acordo: linha.acordo, pausada: linha.pausada, pausadaMotivo: linha.pausadaMotivo });
  if (!r.ok) {
    logger.warn({ providerId, erros: r.erros }, "CONFISSAO politica gravada invalida; aplicando o padrao");
    return POLITICA_PADRAO;
  }
  return r.politica;
}

function enderecoDoCliente(c: Customer): string | null {
  const partes = [c.address, c.addressNumber, c.neighborhood, c.city && c.state ? `${c.city}/${c.state}` : c.city, c.cep].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}
function enderecoDoProvedor(p: Provider): string | null {
  const partes = [p.addressStreet, p.addressNumber, p.addressNeighborhood, p.addressCity && p.addressState ? `${p.addressCity}/${p.addressState}` : p.addressCity, p.addressZip].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}

/** As faturas vencidas do snapshot como linhas do Anexo I. */
function anexoDoSnapshot(snapshot: SnapshotAoVivo, hoje: Date, encargos: Encargos): { linhas: FaturaDoAnexo[]; indeterminadas: number } {
  const faturas = snapshot.cliente?.faturas ?? [];
  const hojeIso = isoDia(hoje);
  const linhas: FaturaDoAnexo[] = [];
  let indeterminadas = 0;
  for (const f of faturas) {
    if (!f.ref || f.vencimento >= hojeIso) continue;
    const valor = centavos(f.valor);
    const partes = parcelasDaDescricao(f.descricao, valor);
    const diasAtraso = diasEntre(f.vencimento, hoje);
    const saida = centavos(partes.multa + partes.equipamento);
    if (partes.indeterminada) {
      indeterminadas++;
      linhas.push({ chave: f.ref, erpRef: f.ref, descricao: f.descricao ?? null, vencimento: f.vencimento, valor, classe: "indeterminada", diasAtraso, multa: 0, juros: 0 });
      continue;
    }
    if (saida > 0 && saida >= valor) {
      const classe = partes.equipamento > partes.multa ? "equipamento" : "multa";
      linhas.push({ chave: f.ref, erpRef: f.ref, descricao: f.descricao ?? null, vencimento: f.vencimento, valor, classe, diasAtraso, multa: 0, juros: 0 });
      continue;
    }
    const servico = centavos(valor - saida);
    const enc = valorAtualizado(servico, diasAtraso, encargos);
    linhas.push({ chave: f.ref, erpRef: f.ref, descricao: f.descricao ?? null, vencimento: f.vencimento, valor: servico, classe: "servico", diasAtraso, multa: enc.multa, juros: enc.juros });
    if (partes.multa > 0) linhas.push({ chave: `${f.ref}#multa`, erpRef: f.ref, descricao: f.descricao ?? null, vencimento: f.vencimento, valor: centavos(partes.multa), classe: "multa", diasAtraso, multa: 0, juros: 0 });
    if (partes.equipamento > 0) linhas.push({ chave: `${f.ref}#equipamento`, erpRef: f.ref, descricao: f.descricao ?? null, vencimento: f.vencimento, valor: centavos(partes.equipamento), classe: "equipamento", diasAtraso, multa: 0, juros: 0 });
  }
  return { linhas, indeterminadas };
}

function leituraAoVivoServe(s: SnapshotAoVivo | null): s is SnapshotAoVivo & { cliente: NonNullable<SnapshotAoVivo["cliente"]> } {
  return !!s && s.ok && s.encontrado && !s.leituraParcial && !!s.cliente;
}

export async function montarBase(providerId: number, customerId: number, opcoes: OpcoesDaBase = {}): Promise<BaseMontada> {
  const hoje = opcoes.hoje ?? new Date();
  const bloqueios: string[] = [];
  const avisos: string[] = [];

  let integracao: IntegracaoComCredencial | null = null;
  try {
    integracao = (await storage.getIntegracaoComCredencial(providerId)) ?? null;
  } catch (e) {
    if (e instanceof ErroDeConfissao) bloqueios.push(e.message);
    else throw e;
  }
  if (!integracao && bloqueios.length === 0) bloqueios.push("assinatura eletrônica não configurada — o superadmin cadastra o ZapSign do provedor");
  else if (integracao && !integracao.isEnabled) bloqueios.push("a integração com o ZapSign está salva mas não ativada — o superadmin precisa clicar em Ativar");

  const [provedor, cliente, caso, politica] = await Promise.all([
    storage.getProvider(providerId),
    storage.getCustomersByProvider(providerId).then(lista => lista.find(c => c.id === customerId) ?? null),
    storage.casoAbertoDoCliente(providerId, customerId),
    politicaDoProvedor(providerId),
  ]);
  const encargos = politica.encargos;
  const ambiente = (integracao?.ambiente as AmbienteDeAssinatura | undefined) ?? "sandbox";
  const authMode = (integracao?.authModeCliente as AuthModeDoCliente | undefined) ?? "assinaturaTela-tokenWhatsapp";
  const vazio = (origem: OrigemDaConfissao, extra: Partial<BaseDaConfissaoDto> = {}): BaseMontada => ({
    dto: {
      origem, casoId: caso?.id ?? null, negociacaoId: null,
      cliente: { nome: cliente?.name ?? "", documento: digitos(cliente?.cpfCnpj), pessoaJuridica: digitos(cliente?.cpfCnpj).length === 14, email: cliente?.email ?? null, telefone: cliente?.phone ?? null, endereco: cliente ? enderecoDoCliente(cliente) : null },
      valorTotal: 0, valorOriginal: null, descontoPct: null, recebidoDoAcordo: null, encargos: { multa: 0, juros: 0, multaPct: encargos.multaPct, jurosMesPct: encargos.jurosMesPct },
      parcelas: [], anexo: [], faturasIndeterminadas: 0, faturasDeSaida: [], erpSource: null, erpLidoEm: null, dividaAtualDoErp: null,
      vencimento: { minimo: isoDia(maisDias(hoje, (integracao?.prazoAssinaturaDias ?? 15) + 1)), maximo: isoDia(maisDias(hoje, PRAZO_MAXIMO_DO_VENCIMENTO_DIAS)), escolhido: opcoes.vencimento ?? null },
      bloqueios, avisos, prescrita: false, baseHash: null, previa: null,
      custo: custoDaEmissao({ authMode, ambiente, enviarWhatsapp: !!(opcoes.telefone ?? cliente?.phone), exigirSelfie: !!integracao?.exigirSelfie }),
      ambiente, modeloRevisado: !!integracao?.modeloRevisadoEm,
      ...extra,
    },
    entrada: null, canonica: null, hash: null, cliente, provedor: provedor ?? null, caso: caso ?? null, negociacao: null, integracao, encargos,
    contatoAlterado: false, contatoDoErp: { email: null, telefone: null }, snapshot: null,
  });

  if (!cliente || !provedor) {
    bloqueios.push("cliente não encontrado nesta carteira");
    return vazio("saldo_integral");
  }
  if (!caso) bloqueios.push("abra o caso antes — a confissão exige caso de cobrança vivo");
  const documento = digitos(cliente.cpfCnpj);
  const pessoaJuridica = documento.length === 14;
  if (!documento) bloqueios.push("cliente sem CPF/CNPJ no cadastro — não há quem confesse");
  if (pessoaJuridica && !opcoes.representante) bloqueios.push("devedor pessoa jurídica: informe nome e CPF do representante legal que assina");

  // O acordo, quando existe, manda; senão o saldo integral.
  const negociacoes = caso ? await storage.listarNegociacoesDoCaso(providerId, caso.id) : [];
  const negociacao = negociacoes.find(n => n.status === "aceita" || n.status === "ativa") ?? null;
  const origem: OrigemDaConfissao = negociacao ? "acordo" : "saldo_integral";

  // A leitura ao vivo é obrigatória nas duas origens: no saldo integral é a base; no acordo, a reconferência.
  const snapshot = documento ? await snapshotAoVivoDoCliente(providerId, documento, { forcar: true }) : null;
  const aoVivo = leituraAoVivoServe(snapshot);
  if (!aoVivo) bloqueios.push(`o ERP não respondeu — sem leitura ao vivo não se emite título${snapshot?.erro ? ` (${snapshot.erro})` : ""}`);
  const contatoDoErp = { email: (aoVivo && snapshot.cliente.email) || cliente.email || null, telefone: (aoVivo && snapshot.cliente.telefone) || cliente.phone || null };
  const email = opcoes.email !== undefined && opcoes.email !== null ? (opcoes.email.trim() || null) : contatoDoErp.email;
  const telefone = opcoes.telefone !== undefined && opcoes.telefone !== null ? (digitos(opcoes.telefone) || null) : contatoDoErp.telefone;
  const contatoAlterado = (email ?? null) !== (contatoDoErp.email ?? null) || digitos(telefone) !== digitos(contatoDoErp.telefone);
  if (!email && !telefone) bloqueios.push("cliente sem e-mail e sem telefone — informe um dos dois para o ZapSign entregar o documento");
  if (contatoAlterado) avisos.push("contato diferente do cadastro do ERP: a emissão exige validação do CPF pelo ZapSign (validate_cpf)");

  const { linhas: anexoCompleto, indeterminadas } = aoVivo ? anexoDoSnapshot(snapshot, hoje, encargos) : { linhas: [], indeterminadas: 0 };
  const excluidas = new Set(opcoes.faturasExcluidas ?? []);
  const anexo = anexoCompleto.filter(l => !excluidas.has(l.chave));
  const faturasDeSaida = anexoCompleto.filter(l => l.classe === "multa" || l.classe === "equipamento").map(l => l.chave);
  if (indeterminadas > 0) avisos.push(`${indeterminadas} fatura${indeterminadas === 1 ? "" : "s"} mistura mensalidade e multa sem valores — confira no ERP`);
  const diasAtrasoMax = Math.max(0, ...anexoCompleto.map(l => l.diasAtraso), aoVivo ? snapshot.cliente.diasAtraso : 0);
  const prescricao = prescricaoPorAtraso(diasAtrasoMax, hoje);
  const prescrita = !!prescricao?.prescrita;
  if (prescrita) bloqueios.push("dívida prescrita — confessá-la renuncia à prescrição (CC art. 191); decisão do provedor com parecer jurídico");

  const prazo = integracao?.prazoAssinaturaDias ?? 15;
  const vencimentoMinimo = isoDia(maisDias(hoje, prazo + 1));
  const vencimentoMaximo = isoDia(maisDias(hoje, PRAZO_MAXIMO_DO_VENCIMENTO_DIAS));

  let parcelas: ParcelaConfessada[] = [];
  let valorTotal = 0;
  let valorOriginal: number | null = null;
  let descontoPct: number | null = null;
  let recebidoDoAcordo: number | null = null;
  let somaMulta = 0;
  let somaJuros = 0;

  if (negociacao) {
    const abertas = negociacao.parcelamento.filter(p => p.status === "pendente" || p.status === "atrasada" || p.status === "conciliacao_pendente");
    parcelas = abertas.map(p => ({ n: p.numero, rotulo: p.numero === 0 ? "entrada" : "parcela", valor: Number(p.valor), vencimento: p.vencimento }));
    valorTotal = centavos(parcelas.reduce((s, p) => s + p.valor, 0));
    valorOriginal = Number(negociacao.valorOriginal);
    descontoPct = Number(negociacao.descontoPct) || null;
    recebidoDoAcordo = centavos(negociacao.parcelamento.filter(p => p.status === "paga").reduce((s, p) => s + Number(p.valorPago ?? p.valor), 0)) || null;
    if (parcelas.length === 0) bloqueios.push("o acordo não tem parcela em aberto — nada a formalizar");
    if (aoVivo && snapshot.cliente.dividaAtual < valorTotal) bloqueios.push(`o saldo no ERP (${reais(snapshot.cliente.dividaAtual)}) é menor que o do acordo (${reais(valorTotal)}) — confira antes de formalizar`);
  } else if (aoVivo) {
    const somaFaturas = centavos(anexoCompleto.reduce((s, l) => s + l.valor, 0));
    if (anexoCompleto.length === 0) bloqueios.push("nada a formalizar — sem fatura vencida na leitura ao vivo");
    else if (Math.abs(somaFaturas - snapshot.cliente.dividaAtual) > 0.01) bloqueios.push(`as faturas vencidas lidas somam ${reais(somaFaturas)} e o ERP informa ${reais(snapshot.cliente.dividaAtual)} de saldo — confira no ERP antes de emitir`);
    somaMulta = centavos(anexo.reduce((s, l) => s + l.multa, 0));
    somaJuros = centavos(anexo.reduce((s, l) => s + l.juros, 0));
    valorTotal = centavos(anexo.reduce((s, l) => s + l.valor + l.multa + l.juros, 0));
    if (anexo.length === 0 && anexoCompleto.length > 0) bloqueios.push("todas as faturas foram desmarcadas — nada a formalizar");
    const vencimento = opcoes.vencimento ?? null;
    if (vencimento && (vencimento < vencimentoMinimo || vencimento > vencimentoMaximo)) bloqueios.push(`o vencimento do saldo integral tem de ficar entre ${dataBr(vencimentoMinimo)} e ${dataBr(vencimentoMaximo)}`);
    parcelas = [{ n: 1, rotulo: "parcela", valor: valorTotal, vencimento: vencimento ?? vencimentoMinimo }];
  }

  const carteira = carteiraDoStatusErp(cliente.status);
  const origemDaCobranca = politica.acordo[carteira].origemDaCobranca;
  const meioDePagamento = origemDaCobranca === "nao_definida" ? "boleto ou PIX enviado pelo credor" : ROTULO_ORIGEM_DA_COBRANCA[origemDaCobranca].toLowerCase();

  const entrada: EntradaDoModelo = {
    origem,
    ambiente,
    modeloRevisado: !!integracao?.modeloRevisadoEm,
    credor: {
      razaoSocial: provedor.name,
      cnpj: provedor.cnpj,
      endereco: enderecoDoProvedor(provedor),
      representante: integracao?.provedorAssina && integracao.signatarioNome && integracao.signatarioCpf ? { nome: integracao.signatarioNome, cpf: integracao.signatarioCpf } : null,
    },
    devedor: { nome: cliente.name, documento, pessoaJuridica, representante: pessoaJuridica ? (opcoes.representante ?? null) : null, endereco: enderecoDoCliente(cliente), email, telefone },
    cadastroErp: cliente.erpCustomerId ?? null,
    plano: (aoVivo && snapshot.cliente.plano) || cliente.contractPlan || null,
    inicioContrato: (aoVivo && snapshot.cliente.contractStartDate) || cliente.contractStartDate || null,
    erpLidoEm: aoVivo ? snapshot.lidoEm : null,
    valorTotal, valorOriginal, descontoPct, recebidoDoAcordo, parcelas, meioDePagamento,
    encargos: { multaPct: encargos.multaPct, jurosMesPct: encargos.jurosMesPct },
    anexo,
  };
  const canonica = baseCanonica(entrada);
  const hash = hashDaBase(canonica);
  const previa = integracao?.templateId
    ? { modelo: "zapsign" as const, templateId: integracao.templateId, variaveis: variaveisDoModeloZapSign(canonica, hoje.toISOString()) }
    : { modelo: "padrao" as const, titulo: "Instrumento particular de confissão de dívida", texto: textoDaConfissao(renderizarConfissao(canonica, hoje.toISOString(), hash)) };

  return {
    ...vazio(origem),
    dto: {
      ...vazio(origem).dto,
      negociacaoId: negociacao?.id ?? null,
      cliente: { nome: cliente.name, documento, pessoaJuridica, email, telefone, endereco: enderecoDoCliente(cliente) },
      valorTotal, valorOriginal, descontoPct, recebidoDoAcordo,
      encargos: { multa: somaMulta, juros: somaJuros, multaPct: encargos.multaPct, jurosMesPct: encargos.jurosMesPct },
      parcelas, anexo, faturasIndeterminadas: indeterminadas, faturasDeSaida,
      erpSource: snapshot?.erpSource ?? null, erpLidoEm: aoVivo ? snapshot.lidoEm : null, dividaAtualDoErp: aoVivo ? snapshot.cliente.dividaAtual : null,
      vencimento: { minimo: vencimentoMinimo, maximo: vencimentoMaximo, escolhido: opcoes.vencimento ?? null },
      bloqueios, avisos, prescrita, baseHash: hash, previa,
    },
    entrada, canonica, hash, negociacao, contatoAlterado, contatoDoErp, snapshot,
  };
}

export async function estadoDaAssinatura(providerId: number): Promise<EstadoDaAssinatura> {
  let integracao: IntegracaoComCredencial | null = null;
  let motivo: string | null = null;
  try {
    integracao = (await storage.getIntegracaoComCredencial(providerId)) ?? null;
  } catch (e) {
    if (e instanceof ErroDeConfissao) motivo = e.message;
    else throw e;
  }
  if (!integracao && !motivo) motivo = "assinatura eletrônica não configurada — o superadmin cadastra o ZapSign do provedor";
  else if (integracao && !integracao.isEnabled) motivo = "integração com o ZapSign salva mas não ativada — o superadmin precisa clicar em Ativar";
  const chat = await estadoDaIntegracao(providerId).catch(() => null);
  const ambiente = (integracao?.ambiente as AmbienteDeAssinatura | undefined) ?? null;
  const authMode = (integracao?.authModeCliente as AuthModeDoCliente | undefined) ?? null;
  return {
    configurada: !!integracao,
    ativa: !!integracao?.isEnabled,
    ambiente,
    modelo: integracao?.templateId ? "zapsign" : "padrao",
    modeloRevisado: !!integracao?.modeloRevisadoEm,
    provedorAssina: !!integracao?.provedorAssina,
    authMode,
    custo: ambiente && authMode ? custoDaEmissao({ authMode, ambiente, enviarWhatsapp: true, exigirSelfie: !!integracao?.exigirSelfie }) : null,
    prazoAssinaturaDias: integracao?.prazoAssinaturaDias ?? null,
    chatDisponivel: !!chat?.ligado && !!chat?.canal && ambiente === "producao",
    motivo,
  };
}

export { VERSAO_DO_MODELO };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run server/services/confissao/confissao-base.service.test.ts`
Expected: PASS. A classe e o valor da multa da F-2 vêm de `parcelasDaDescricao` (`shared/cobranca/multa.ts`, testado em `multa.test.ts`): se o parser ler a descrição do fixture de outro jeito, troque a DESCRIÇÃO do fixture por uma que o `multa.test.ts` já prove ler como "multa com valor" — a regra é do parser, não deste serviço. Os números do teste vêm de `valorAtualizado` (multa 2% uma vez; juros 1% ao mês × dias/30, arredondado a centavos): F-1 com 62 dias → multa 2,00, juros 2,06; a parte de serviço da F-2 com 31 dias → 2,00 e 1,03. Se o arredondamento divergir por um centavo, é `arredondar` de `politica.ts` que manda — ajuste o teste ao valor real, nunca a fórmula.

- [ ] **Step 5: Commit**

```bash
git add server/services/confissao/confissao-base.service.ts server/services/confissao/confissao-base.service.test.ts
git commit -m "feat(confissao): a base sem digitação — acordo ou saldo integral ao vivo, bloqueios e hash canônico"
```

---

### Task 11: Emitir — trava, idempotência, rascunho, PDF, ZapSign, webhook por documento

**Files:**
- Create: `server/services/confissao/confissao-emissao.service.ts`
- Create: `server/services/confissao/confissao-emissao.service.test.ts`

**Interfaces:**
- Consumes: `montarBase` (Task 10); `gerarPdfDaConfissao` (Task 5); `clienteZapSign` (Task 6); storage (Task 7 + `registrarEventoDeCobranca`, `atualizarCasoDeCobranca`, `obterCasoDeCobranca`); `comTravaDoChat` (`server/services/chat/chat-trava.ts`); `renderizarConfissao`, `variaveisDoModeloZapSign` (Task 3); `LEMBRETE_A_CADA_DIAS` (Task 1).
- Produces: `emitirConfissao(providerId, customerId, userId, corpo: CorpoDaEmissao): Promise<CobrancaConfissao>`, `CorpoDaEmissao`, `urlDoWebhookDeAssinatura(providerId)`, `CABECALHO_DO_WEBHOOK = "X-Consulta-ISP-Assinatura"`, `registrarEventoDaConfissao(...)`.

- [ ] **Step 1: Escrever o teste que falha**

`server/services/confissao/confissao-emissao.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Emitir é a única escrita que fala com o ZapSign para CRIAR. O que se prova:
 * a chave de idempotência devolve a mesma confissão sem chamar o ZapSign; a
 * trava ocupada é 409; hash divergente é "A dívida mudou"; bloqueio da base é
 * 422; sandbox exige confirmoTeste; o caminho feliz grava rascunho + PDF,
 * cria o documento com os campos da spec, registra o webhook DO documento com
 * o cabeçalho secreto, passa a `enviada` e grava evento + follow-up; contato
 * alterado liga validate_cpf; falha depois de criar o documento apaga o órfão
 * e deixa o rascunho com erro_ultimo.
 */
const storageMock = vi.hoisted(() => ({
  obterConfissaoPorChave: vi.fn(async (): Promise<any> => undefined),
  confissaoVivaDoCliente: vi.fn(async (): Promise<any> => undefined),
  criarConfissao: vi.fn(async (_p: number, d: any): Promise<any> => ({ id: 77, providerId: 1, status: "rascunho", ...d })),
  guardarPdf: vi.fn(async (): Promise<any> => ({ sha256: "abc", tamanhoBytes: 10 })),
  transicionarConfissao: vi.fn(async (_p: number, id: number, _de: string, para: string, patch: any): Promise<any> => ({ id, status: para, casoId: 9, customerId: 42, valorTotal: "819.76", ambiente: "producao", ...patch })),
  atualizarConfissao: vi.fn(async (): Promise<any> => ({ id: 77 })),
  registrarEventoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 500 })),
  atualizarCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 9 })),
  obterCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 9, status: "aberto" })),
}));
vi.mock("../../storage", () => ({ storage: storageMock }));
const baseMock = vi.hoisted(() => ({ montarBase: vi.fn(async (): Promise<any> => base()) }));
vi.mock("./confissao-base.service", () => baseMock);
const travaMock = vi.hoisted(() => ({ comTravaDoChat: vi.fn(async (_chave: string, fn: () => Promise<unknown>) => fn()) }));
vi.mock("../chat/chat-trava", () => travaMock);
const zapsign = vi.hoisted(() => ({
  criarDocumentoPorPdf: vi.fn(async (): Promise<any> => ({ token: "doc-1", status: "pending", sandbox: false, signers: [{ token: "s-1", status: "new", sign_url: "https://app.zapsign.com.br/verificar/s-1", signed_at: null, auth_mode: "assinaturaTela-tokenWhatsapp", external_id: "cliente" }] })),
  criarDocumentoPorModelo: vi.fn(async (): Promise<any> => ({ token: "doc-2", status: "pending", sandbox: false, signers: [{ token: "s-9", status: "new", sign_url: "u", signed_at: null, auth_mode: null, external_id: null }] })),
  adicionarSignatario: vi.fn(async (): Promise<any> => ({ token: "s-2", status: "new", sign_url: "u2", signed_at: null, auth_mode: "assinaturaTela-tokenEmail", external_id: "provedor" })),
  atualizarSignatario: vi.fn(async (): Promise<any> => ({ token: "s-9", status: "new", sign_url: "u", signed_at: null, auth_mode: "assinaturaTela-tokenWhatsapp", external_id: null })),
  registrarWebhookDoDocumento: vi.fn(async (): Promise<any> => ({ id: "w-1" })),
  excluirDocumento: vi.fn(async (): Promise<void> => undefined),
  excluirWebhook: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock("../../assinatura/zapsign", () => ({ clienteZapSign: () => zapsign }));
vi.mock("../../assinatura/pdf", () => ({ gerarPdfDaConfissao: vi.fn(async () => Buffer.from("%PDF-1.4 x")) }));
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { CABECALHO_DO_WEBHOOK, emitirConfissao, urlDoWebhookDeAssinatura } from "./confissao-emissao.service";
import { ErroDeConfissao } from "../../assinatura/erro";

function base(extra: Record<string, any> = {}) {
  const canonica = { versao: "1.0", origem: "saldo_integral", ambiente: "producao", modeloRevisado: false,
    credor: { razaoSocial: "NsLink Telecom Ltda", cnpj: "12345678000199", endereco: null, representante: null },
    devedor: { nome: "Maria da Silva", documento: "12345678901", pessoaJuridica: false, representante: null, endereco: null, email: "maria@example.com", telefone: "31999990000" },
    cadastroErp: "4471", plano: null, inicioContrato: null, erpLidoEm: "2026-09-10T13:00:00.000Z", valorTotal: 819.76, valorOriginal: null, descontoPct: null, recebidoDoAcordo: null,
    parcelas: [{ n: 1, rotulo: "parcela", valor: 819.76, vencimento: "2026-10-10" }], meioDePagamento: "boleto ou PIX enviado pelo credor", encargos: { multaPct: 2, jurosMesPct: 1 }, anexo: [] };
  return {
    dto: { origem: "saldo_integral", casoId: 9, negociacaoId: null, cliente: { nome: "Maria da Silva", documento: "12345678901", pessoaJuridica: false, email: "maria@example.com", telefone: "31999990000", endereco: null },
      valorTotal: 819.76, valorOriginal: null, descontoPct: null, recebidoDoAcordo: null, encargos: { multa: 4, juros: 3.09, multaPct: 2, jurosMesPct: 1 }, parcelas: canonica.parcelas, anexo: [], faturasIndeterminadas: 0, faturasDeSaida: [],
      erpSource: "mk", erpLidoEm: "2026-09-10T13:00:00.000Z", dividaAtualDoErp: 819.76, vencimento: { minimo: "2026-09-26", maximo: "2026-12-09", escolhido: "2026-10-10" }, bloqueios: [], avisos: [], prescrita: false, baseHash: "h1", previa: null,
      custo: { creditos: 5, reais: 0.5, texto: "" }, ambiente: "producao", modeloRevisado: false },
    entrada: canonica, canonica, hash: "h1",
    cliente: { id: 42, name: "Maria da Silva", cpfCnpj: "12345678901", email: "maria@example.com", phone: "31999990000", erpCustomerId: "4471", contractPlan: null, contractStartDate: null },
    provedor: { id: 1, name: "NsLink Telecom Ltda", tradeName: "NsLink", cnpj: "12345678000199" },
    caso: { id: 9, status: "aberto" }, negociacao: null,
    integracao: { apiToken: "tok", ambiente: "producao", templateId: null, provedorAssina: false, authModeCliente: "assinaturaTela-tokenWhatsapp", exigirSelfie: false, prazoAssinaturaDias: 15, enviarArquivoAssinadoWhatsapp: false, modeloRevisadoEm: null, isEnabled: true, webhookSecret: "segredo-do-webhook", signatarioNome: null, signatarioEmail: null, signatarioCpf: null, signatarioTelefone: null },
    encargos: { multaPct: 2, jurosMesPct: 1 }, contatoAlterado: false, contatoDoErp: { email: "maria@example.com", telefone: "31999990000" }, snapshot: null,
    ...extra,
  };
}
const corpo = () => ({ origem: "saldo_integral" as const, vencimento: "2026-10-10", faturasExcluidas: [], clienteEmail: null, clienteTelefone: null, representante: null, baseHash: "h1", chaveIdempotencia: "5f0c9d1e-2b1a-4c3d-9e8f-000000000001", confirmoTeste: false, confirmoPrescricao: false });

beforeEach(() => { vi.clearAllMocks(); baseMock.montarBase.mockResolvedValue(base()); });

describe("emitir a confissão", () => {
  it("a mesma chave de idempotência devolve a confissão já criada sem falar com o ZapSign", async () => {
    storageMock.obterConfissaoPorChave.mockResolvedValueOnce({ id: 70, status: "enviada" });
    const r = await emitirConfissao(1, 42, 7, corpo());
    expect(r.id).toBe(70);
    expect(zapsign.criarDocumentoPorPdf).not.toHaveBeenCalled();
    expect(storageMock.criarConfissao).not.toHaveBeenCalled();
  });
  it("trava ocupada é EM_ANDAMENTO; a chave da trava é por provedor e cliente", async () => {
    travaMock.comTravaDoChat.mockResolvedValueOnce(null);
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "EM_ANDAMENTO", http: 409 });
    expect(travaMock.comTravaDoChat.mock.calls[0][0]).toBe("confissao:1:42");
  });
  it("hash divergente, bloqueio, origem trocada e sandbox sem confirmação recusam antes de gravar", async () => {
    await expect(emitirConfissao(1, 42, 7, { ...corpo(), baseHash: "outro" })).rejects.toMatchObject({ codigo: "BASE_MUDOU" });
    baseMock.montarBase.mockResolvedValueOnce(base({ dto: { ...base().dto, bloqueios: ["abra o caso antes"] } }));
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "BLOQUEADA", http: 422, detalhes: { bloqueios: ["abra o caso antes"] } });
    await expect(emitirConfissao(1, 42, 7, { ...corpo(), origem: "acordo" })).rejects.toMatchObject({ codigo: "BASE_MUDOU" });
    const sandbox = base({ dto: { ...base().dto, ambiente: "sandbox" }, integracao: { ...base().integracao, ambiente: "sandbox" } });
    baseMock.montarBase.mockResolvedValueOnce(sandbox);
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "BLOQUEADA" });
    expect(storageMock.criarConfissao).not.toHaveBeenCalled();
    expect(baseMock.montarBase).toHaveBeenCalledWith(1, 42, expect.objectContaining({ vencimento: "2026-10-10", faturasExcluidas: [] }));
  });
  it("caminho feliz: rascunho + PDF, documento com os campos da spec, webhook do documento com o cabeçalho, enviada, evento e follow-up", async () => {
    const r = await emitirConfissao(1, 42, 7, corpo());
    expect(storageMock.criarConfissao).toHaveBeenCalledWith(1, expect.objectContaining({ customerId: 42, casoId: 9, origem: "saldo_integral", ambiente: "producao", valorTotal: 819.76, modelo: "padrao", modeloVersao: "1.0", textoHash: "h1", clienteCpfCnpj: "12345678901", chaveIdempotencia: corpo().chaveIdempotencia, criadaPorUserId: 7, aprovadaPorUserId: 7, contatoAlteradoPorUserId: null }));
    expect(storageMock.guardarPdf).toHaveBeenCalledWith(1, 77, "original", expect.any(Buffer));
    const doc = zapsign.criarDocumentoPorPdf.mock.calls[0][0];
    expect(doc).toMatchObject({ name: "Confissão de dívida — Maria da Silva — NsLink", external_id: "confissao:77", folder_path: "consulta-isp/1", lang: "pt-br", reminder_every_n_days: 3, allow_refuse_signature: true, signature_order_active: false, brand_name: "NsLink" });
    expect(doc.date_limit_to_sign).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(doc.base64_pdf).toBe(Buffer.from("%PDF-1.4 x").toString("base64"));
    expect(doc.signers).toHaveLength(1);
    expect(doc.signers[0]).toMatchObject({ name: "Maria da Silva", email: "maria@example.com", phone_country: "55", phone_number: "31999990000", auth_mode: "assinaturaTela-tokenWhatsapp", cpf: "12345678901", require_cpf: true, validate_cpf: false, require_selfie_photo: false, send_automatic_email: true, send_automatic_whatsapp: true, lock_name: true, external_id: "cliente" });
    expect(zapsign.registrarWebhookDoDocumento).toHaveBeenCalledWith({ url: urlDoWebhookDeAssinatura(1), docToken: "doc-1", cabecalho: { nome: CABECALHO_DO_WEBHOOK, valor: "segredo-do-webhook" } });
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "rascunho", "enviada", expect.objectContaining({ zapsignDocToken: "doc-1", webhookZapsignId: "w-1", zapsignSandbox: false, erroUltimo: null, zapsignSigners: [{ papel: "cliente", token: "s-1", signUrl: "https://app.zapsign.com.br/verificar/s-1", status: "new", signedAt: null, authMode: "assinaturaTela-tokenWhatsapp" }] }));
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(1, expect.objectContaining({ casoId: 9, userId: 7, tipo: "confissao", canal: "sistema", metadata: expect.objectContaining({ confissaoId: 77, status: "enviada", valor: 819.76, ambiente: "producao", contatoAlterado: false }) }));
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(1, 9, expect.objectContaining({ proximaAcao: expect.stringContaining("aguardar assinatura"), proximoContatoEm: expect.any(Date) }), 7);
    expect(r.status).toBe("enviada");
  });
  it("contato alterado: validate_cpf ligado, metadata.contatoAlterado, quem alterou gravado; sandbox não envia nada automático", async () => {
    baseMock.montarBase.mockResolvedValueOnce(base({ contatoAlterado: true, dto: { ...base().dto, cliente: { ...base().dto.cliente, email: "outro@example.com" } }, canonica: { ...base().canonica, devedor: { ...base().canonica.devedor, email: "outro@example.com" } } }));
    await emitirConfissao(1, 42, 7, { ...corpo(), clienteEmail: "outro@example.com" });
    expect(zapsign.criarDocumentoPorPdf.mock.calls[0][0].signers[0]).toMatchObject({ email: "outro@example.com", validate_cpf: true });
    expect(storageMock.criarConfissao).toHaveBeenCalledWith(1, expect.objectContaining({ contatoAlteradoPorUserId: 7, clienteEmail: "outro@example.com", clienteEmailErp: "maria@example.com" }));
    expect(storageMock.registrarEventoDeCobranca.mock.calls[0][1].metadata.contatoAlterado).toBe(true);
    vi.clearAllMocks();
    const sandbox = base({ dto: { ...base().dto, ambiente: "sandbox" }, integracao: { ...base().integracao, ambiente: "sandbox" }, canonica: { ...base().canonica, ambiente: "sandbox" } });
    baseMock.montarBase.mockResolvedValueOnce(sandbox);
    await emitirConfissao(1, 42, 7, { ...corpo(), confirmoTeste: true });
    expect(zapsign.criarDocumentoPorPdf.mock.calls[0][0].signers[0]).toMatchObject({ send_automatic_email: false, send_automatic_whatsapp: false });
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalled(); // o follow-up "aguardar assinatura" existe também no teste; o que não existe em sandbox é o "título assinado"
  });
  it("provedor assina: dois signatários, provedor primeiro, ordem ativa; modelo do ZapSign: create-doc + atualizar signatário", async () => {
    baseMock.montarBase.mockResolvedValueOnce(base({ integracao: { ...base().integracao, provedorAssina: true, signatarioNome: "Ana Link", signatarioEmail: "ana@nslink.com", signatarioCpf: "11122233344" } }));
    await emitirConfissao(1, 42, 7, corpo());
    const doc = zapsign.criarDocumentoPorPdf.mock.calls[0][0];
    expect(doc.signature_order_active).toBe(true);
    expect(doc.signers.map((s: any) => [s.external_id, s.order_group, s.auth_mode])).toEqual([["provedor", 1, "assinaturaTela-tokenEmail"], ["cliente", 2, "assinaturaTela-tokenWhatsapp"]]);
    vi.clearAllMocks();
    baseMock.montarBase.mockResolvedValueOnce(base({ integracao: { ...base().integracao, templateId: "tpl-1" } }));
    await emitirConfissao(1, 42, 7, corpo());
    expect(zapsign.criarDocumentoPorPdf).not.toHaveBeenCalled();
    expect(zapsign.criarDocumentoPorModelo.mock.calls[0][0]).toMatchObject({ template_id: "tpl-1", signer_name: "Maria da Silva", external_id: "confissao:77" });
    expect(zapsign.criarDocumentoPorModelo.mock.calls[0][0].data.find((v: any) => v.de === "{{VALOR_TOTAL}}").para).toBe("R$ 819,76");
    expect(zapsign.atualizarSignatario).toHaveBeenCalledWith("s-9", expect.objectContaining({ auth_mode: "assinaturaTela-tokenWhatsapp", cpf: "12345678901", require_cpf: true }));
    expect(storageMock.criarConfissao).toHaveBeenCalledWith(1, expect.objectContaining({ modelo: "zapsign", modeloVersao: "tpl-1" }));
  });
  it("falha ao registrar o webhook apaga o documento órfão, mantém o rascunho com erro_ultimo e propaga o erro", async () => {
    zapsign.registrarWebhookDoDocumento.mockRejectedValueOnce(new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "O ZapSign não respondeu (HTTP 503)", 502));
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "ZAPSIGN_INDISPONIVEL" });
    expect(zapsign.excluirDocumento).toHaveBeenCalledWith("doc-1");
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalled();
    expect(storageMock.atualizarConfissao).toHaveBeenCalledWith(1, 77, expect.objectContaining({ erroUltimo: expect.stringContaining("HTTP 503") }));
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });
  it("confissão viva existente recusa antes de gravar", async () => {
    storageMock.confissaoVivaDoCliente.mockResolvedValueOnce({ id: 60, status: "enviada" });
    await expect(emitirConfissao(1, 42, 7, corpo())).rejects.toMatchObject({ codigo: "CONFISSAO_VIVA", detalhes: { confissaoId: 60 } });
    expect(storageMock.criarConfissao).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/services/confissao/confissao-emissao.service.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever `server/services/confissao/confissao-emissao.service.ts`**

```ts
/**
 * Emitir a confissão (spec §6.2, passos 2–4).
 *
 * Sob trava `confissao:{providerId}:{customerId}` (pg_try_advisory_lock, o
 * mesmo `comTravaDoChat` do chat): recalcula a base e compara o hash; a
 * chave de idempotência devolve o que já existe; grava o RASCUNHO com a foto
 * completa e o PDF original; e só então, fora de qualquer transação, fala com
 * o ZapSign — criar documento, registrar o webhook DAQUELE documento com o
 * cabeçalho secreto. Sucesso = `enviada` + evento + follow-up. Falha em
 * qualquer chamada = rascunho com `erro_ultimo`; documento criado sem webhook
 * é apagado para não ficar órfão.
 */
import { storage } from "../../storage";
import { logger } from "../../logger";
import { comTravaDoChat } from "../chat/chat-trava";
import { clienteZapSign, type ClienteZapSign, type SignatarioParaCriar } from "../../assinatura/zapsign";
import { gerarPdfDaConfissao } from "../../assinatura/pdf";
import { ErroDeConfissao } from "../../assinatura/erro";
import { montarBase } from "./confissao-base.service";
import { renderizarConfissao, variaveisDoModeloZapSign, VERSAO_DO_MODELO, type Representante } from "@shared/cobranca/confissao-modelo";
import { LEMBRETE_A_CADA_DIAS, type OrigemDaConfissao, type SignatarioDaConfissao, type StatusDeConfissao, type StatusDoSignatario } from "@shared/cobranca/confissao";
import { casoFechado } from "@shared/cobranca";
import type { CobrancaConfissao } from "@shared/schema";
import type { SignatarioDoZapSign } from "../../assinatura/zapsign";

export const CABECALHO_DO_WEBHOOK = "X-Consulta-ISP-Assinatura";

export interface CorpoDaEmissao {
  origem: OrigemDaConfissao;
  vencimento?: string | null;
  faturasExcluidas?: string[];
  clienteEmail?: string | null;
  clienteTelefone?: string | null;
  representante?: Representante | null;
  baseHash: string;
  chaveIdempotencia: string;
  confirmoTeste?: boolean;
  confirmoPrescricao?: boolean;
}

export function urlDoWebhookDeAssinatura(providerId: number): string {
  const base = (process.env.ASSINATURA_WEBHOOK_URL || "https://consultaisp.com.br/api/webhooks/zapsign").replace(/\/+$/, "");
  return `${base}/${providerId}`;
}

const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
/** DDD + número, sem o 55: o ZapSign recebe o país em `phone_country`. */
const telefoneNacional = (s: string | null) => {
  const d = digitos(s);
  return d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
};
const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const maisDias = (d: Date, dias: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias);

function statusDoSignatario(s: string): StatusDoSignatario {
  return s === "signed" ? "signed" : s === "link-opened" ? "link-opened" : "new";
}

export function signatariosGravaveis(signers: SignatarioDoZapSign[], papelPorToken: Map<string, "cliente" | "provedor">): SignatarioDaConfissao[] {
  return signers.map(s => ({
    papel: papelPorToken.get(s.token) ?? (s.external_id === "provedor" ? "provedor" : "cliente"),
    token: s.token,
    signUrl: s.sign_url,
    status: statusDoSignatario(s.status),
    signedAt: s.signed_at,
    authMode: s.auth_mode,
  }));
}

/** Evento `confissao` no caso, quando o caso ainda está vivo. */
export async function registrarEventoDaConfissao(providerId: number, confissao: Pick<CobrancaConfissao, "id" | "casoId" | "valorTotal" | "ambiente">, status: StatusDeConfissao | "recusa_informada" | "expiracao_informada" | "aguardando_provedor", userId: number | null, notas: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  const caso = await storage.obterCasoDeCobranca(providerId, confissao.casoId);
  if (!caso || casoFechado(caso.status)) {
    logger.info({ providerId, confissaoId: confissao.id, casoId: confissao.casoId, status }, "CONFISSAO caso fechado — evento não gravado");
    return false;
  }
  await storage.registrarEventoDeCobranca(providerId, {
    casoId: confissao.casoId,
    userId,
    tipo: "confissao",
    canal: "sistema",
    notas,
    metadata: { confissaoId: confissao.id, status, valor: Number(confissao.valorTotal), ambiente: confissao.ambiente, ...extra },
  });
  return true;
}

export async function emitirConfissao(providerId: number, customerId: number, userId: number, corpo: CorpoDaEmissao): Promise<CobrancaConfissao> {
  const existente = await storage.obterConfissaoPorChave(providerId, corpo.chaveIdempotencia);
  if (existente) return existente;

  const resultado = await comTravaDoChat(`confissao:${providerId}:${customerId}`, async () => {
    const base = await montarBase(providerId, customerId, {
      vencimento: corpo.vencimento ?? null,
      faturasExcluidas: corpo.faturasExcluidas ?? [],
      email: corpo.clienteEmail ?? null,
      telefone: corpo.clienteTelefone ?? null,
      representante: corpo.representante ?? null,
    });
    if (base.dto.bloqueios.length > 0) throw new ErroDeConfissao("BLOQUEADA", base.dto.bloqueios[0], 422, { bloqueios: base.dto.bloqueios });
    if (!base.entrada || !base.canonica || !base.hash || !base.cliente || !base.provedor || !base.caso || !base.integracao) {
      throw new ErroDeConfissao("BLOQUEADA", "A base da confissão não pôde ser montada", 422, { bloqueios: base.dto.bloqueios });
    }
    if (base.dto.origem !== corpo.origem || base.hash !== corpo.baseHash) throw new ErroDeConfissao("BASE_MUDOU", "A dívida mudou desde a prévia. Recarregue e confira antes de emitir.", 409);
    if (base.dto.ambiente === "sandbox" && !corpo.confirmoTeste) throw new ErroDeConfissao("BLOQUEADA", "Ambiente de testes: confirme que esta emissão é um TESTE sem validade jurídica", 422, { bloqueios: ["confirme o teste"] });

    const viva = await storage.confissaoVivaDoCliente(providerId, customerId);
    if (viva) throw new ErroDeConfissao("CONFISSAO_VIVA", "Este cliente já tem uma confissão em andamento — cancele-a antes de emitir outra", 409, { confissaoId: viva.id });

    const { integracao, cliente, provedor, caso, canonica } = base;
    const agora = new Date();
    const ambiente = base.dto.ambiente;
    const producao = ambiente === "producao";
    const dataLimite = isoDia(maisDias(agora, integracao.prazoAssinaturaDias));
    const modeloZapSign = !!integracao.templateId;
    const documento = modeloZapSign ? null : renderizarConfissao(canonica, agora.toISOString(), base.hash);
    const pdf = documento ? await gerarPdfDaConfissao(documento) : null;

    const rascunho = await storage.criarConfissao(providerId, {
      customerId, casoId: caso.id, negociacaoId: base.dto.negociacaoId, origem: base.dto.origem, ambiente,
      valorTotal: base.dto.valorTotal, valorOriginal: base.dto.valorOriginal, descontoPct: base.dto.descontoPct,
      parcelas: base.dto.parcelas, erpSource: base.dto.erpSource, erpLidoEm: base.dto.erpLidoEm ? new Date(base.dto.erpLidoEm) : null, erpFaturas: base.dto.anexo,
      modelo: modeloZapSign ? "zapsign" : "padrao", modeloVersao: integracao.templateId ?? VERSAO_DO_MODELO, modeloRevisado: base.dto.modeloRevisado,
      baseCanonica: canonica, textoHash: base.hash, geradoEm: agora,
      clienteNome: cliente.name, clienteCpfCnpj: base.dto.cliente.documento, clienteEmail: base.dto.cliente.email, clienteTelefone: base.dto.cliente.telefone,
      clienteEmailErp: base.contatoDoErp.email, clienteTelefoneErp: base.contatoDoErp.telefone, contatoAlteradoPorUserId: base.contatoAlterado ? userId : null,
      representanteNome: corpo.representante?.nome ?? null, representanteCpf: corpo.representante ? digitos(corpo.representante.cpf) : null,
      dataLimiteAssinatura: dataLimite, criadaPorUserId: userId, aprovadaPorUserId: userId, chaveIdempotencia: corpo.chaveIdempotencia,
    });
    if (pdf) await storage.guardarPdf(providerId, rascunho.id, "original", pdf);

    const zap: ClienteZapSign = clienteZapSign({ apiToken: integracao.apiToken, ambiente });
    const cpfDoSignatario = base.dto.cliente.pessoaJuridica ? digitos(corpo.representante?.cpf) : base.dto.cliente.documento;
    const signatarioCliente: SignatarioParaCriar = {
      name: base.dto.cliente.pessoaJuridica && corpo.representante ? corpo.representante.nome : cliente.name,
      email: base.dto.cliente.email ?? undefined,
      phone_country: "55",
      phone_number: telefoneNacional(base.dto.cliente.telefone) || undefined,
      auth_mode: integracao.authModeCliente,
      cpf: cpfDoSignatario || undefined,
      require_cpf: true,
      validate_cpf: base.contatoAlterado,
      require_selfie_photo: integracao.exigirSelfie,
      send_automatic_email: producao && !!base.dto.cliente.email,
      send_automatic_whatsapp: producao && !!base.dto.cliente.telefone,
      send_automatic_whatsapp_signed_file: producao && integracao.enviarArquivoAssinadoWhatsapp && !!base.dto.cliente.telefone,
      lock_name: true,
      external_id: "cliente",
      qualification: "Devedor",
      order_group: integracao.provedorAssina ? 2 : undefined,
    };
    const signatarioProvedor: SignatarioParaCriar | null = integracao.provedorAssina && integracao.signatarioNome && integracao.signatarioEmail ? {
      name: integracao.signatarioNome, email: integracao.signatarioEmail, auth_mode: "assinaturaTela-tokenEmail", cpf: integracao.signatarioCpf ?? undefined,
      send_automatic_email: producao, send_automatic_whatsapp: false, lock_name: true, external_id: "provedor", qualification: "Credor", order_group: 1,
    } : null;

    let docToken: string | null = null;
    let webhookId: string | null = null;
    try {
      const papelPorToken = new Map<string, "cliente" | "provedor">();
      let doc;
      if (!modeloZapSign && pdf) {
        doc = await zap.criarDocumentoPorPdf({
          name: `Confissão de dívida — ${cliente.name} — ${provedor.tradeName || provedor.name}`,
          base64_pdf: pdf.toString("base64"),
          signers: signatarioProvedor ? [signatarioProvedor, signatarioCliente] : [signatarioCliente],
          lang: "pt-br",
          external_id: `confissao:${rascunho.id}`,
          folder_path: `consulta-isp/${providerId}`,
          brand_name: provedor.tradeName || provedor.name,
          date_limit_to_sign: dataLimite,
          reminder_every_n_days: LEMBRETE_A_CADA_DIAS,
          allow_refuse_signature: true,
          signature_order_active: !!signatarioProvedor,
        });
        docToken = doc.token;
        doc.signers.forEach(s => papelPorToken.set(s.token, s.external_id === "provedor" ? "provedor" : "cliente"));
      } else {
        doc = await zap.criarDocumentoPorModelo({
          template_id: integracao.templateId!,
          signer_name: signatarioCliente.name,
          signer_email: signatarioCliente.email,
          signer_phone_country: "55",
          signer_phone_number: signatarioCliente.phone_number,
          data: variaveisDoModeloZapSign(canonica, agora.toISOString()),
          lang: "pt-br",
          external_id: `confissao:${rascunho.id}`,
          folder_path: `consulta-isp/${providerId}`,
          date_limit_to_sign: dataLimite,
          reminder_every_n_days: LEMBRETE_A_CADA_DIAS,
          allow_refuse_signature: true,
          signature_order_active: !!signatarioProvedor,
          send_automatic_email: signatarioCliente.send_automatic_email,
          send_automatic_whatsapp: signatarioCliente.send_automatic_whatsapp,
        });
        docToken = doc.token;
        const primeiro = doc.signers[0];
        if (primeiro) {
          const atualizado = await zap.atualizarSignatario(primeiro.token, { auth_mode: signatarioCliente.auth_mode, cpf: signatarioCliente.cpf, require_cpf: true, validate_cpf: signatarioCliente.validate_cpf, require_selfie_photo: signatarioCliente.require_selfie_photo });
          doc = { ...doc, signers: [atualizado, ...doc.signers.slice(1)] };
          papelPorToken.set(primeiro.token, "cliente");
        }
        if (signatarioProvedor) {
          const prov = await zap.adicionarSignatario(doc.token, signatarioProvedor);
          doc = { ...doc, signers: [...doc.signers, prov] };
          papelPorToken.set(prov.token, "provedor");
        }
      }
      const webhook = await zap.registrarWebhookDoDocumento({ url: urlDoWebhookDeAssinatura(providerId), docToken: doc.token, cabecalho: { nome: CABECALHO_DO_WEBHOOK, valor: integracao.webhookSecret ?? "" } });
      webhookId = webhook.id;

      const enviada = await storage.transicionarConfissao(providerId, rascunho.id, "rascunho", "enviada", {
        zapsignDocToken: doc.token,
        webhookZapsignId: webhook.id,
        zapsignSigners: signatariosGravaveis(doc.signers, papelPorToken),
        zapsignSandbox: doc.sandbox,
        enviadaEm: agora,
        erroUltimo: null,
      });
      if (!enviada) throw new ErroDeConfissao("ESTADO_INVALIDO", "A confissão deixou de ser rascunho durante a emissão", 409);

      await registrarEventoDaConfissao(providerId, enviada, "enviada", userId, `Confissão de dívida enviada para assinatura eletrônica (R$ ${base.dto.valorTotal.toFixed(2).replace(".", ",")}) — ${ambiente === "sandbox" ? "TESTE, sem validade jurídica" : "ZapSign, produção"}`, { contatoAlterado: base.contatoAlterado, prescricaoRenunciada: corpo.confirmoPrescricao === true });
      await storage.atualizarCasoDeCobranca(providerId, caso.id, { proximaAcao: "aguardar assinatura da confissão de dívida", proximoContatoEm: maisDias(agora, LEMBRETE_A_CADA_DIAS) }, userId);
      return enviada;
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      logger.warn({ providerId, confissaoId: rascunho.id, docToken, erro: mensagem }, "CONFISSAO emissão falhou depois do rascunho");
      if (docToken) {
        if (webhookId) await zap.excluirWebhook(webhookId).catch(() => undefined);
        await zap.excluirDocumento(docToken).catch(err => logger.error({ providerId, docToken, err }, "CONFISSAO documento órfão não pôde ser apagado no ZapSign"));
      }
      await storage.atualizarConfissao(providerId, rascunho.id, { erroUltimo: mensagem });
      throw e;
    }
  });
  if (resultado === null) throw new ErroDeConfissao("EM_ANDAMENTO", "Já há uma emissão em andamento para este cliente — aguarde", 409);
  return resultado;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run server/services/confissao/confissao-emissao.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/confissao/confissao-emissao.service.ts server/services/confissao/confissao-emissao.service.test.ts
git commit -m "feat(confissao): emitir — trava, idempotência, rascunho com PDF, ZapSign e webhook por documento"
```

---

### Task 12: Retorno — reconsultar, aplicar, cancelar, reenviar

**Files:**
- Create: `server/services/confissao/confissao-retorno.service.ts`
- Create: `server/services/confissao/confissao-retorno.service.test.ts`

**Interfaces:**
- Consumes: storage (Task 7), `clienteZapSign` (Task 6), `LIMITE_DO_PDF_BYTES` (Task 5), `registrarEventoDaConfissao`, `signatariosGravaveis` (Task 11).
- Produces: `aplicarRetorno(providerId, confissaoId, origem: OrigemDoRetorno): Promise<ResultadoDoRetorno>`, `registrarInformadoPeloWebhook(providerId, confissaoId, tipo: "recusa" | "expiracao", eventType: string)`, `cancelarConfissao(providerId, confissaoId, userId): Promise<CobrancaConfissao>`, `reenviarNotificacoes(providerId, confissaoId): Promise<{ enviados: number; falhas: number }>`, `expirarSeVencida(providerId, confissaoId, hoje: string): Promise<boolean>`, `RECONSULTA_APOS_FALHA_MS = 10 * 60_000`, `JANELA_DE_REENVIO_MS = 30 * 60_000`.

- [ ] **Step 1: Escrever o teste que falha**

`server/services/confissao/confissao-retorno.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O retorno é UMA função para webhook, worker e cancelar: reconsulta o ZapSign
 * no host do ambiente DA LINHA e só a transição atômica decide quem grava o
 * evento. O que se prova: fora de `enviada` nada acontece; signed baixa o
 * arquivo e aplica; ambiente divergente não aplica; deleted vira cancelada;
 * pending só atualiza signatários; reconsulta falhando marca reconciliar_em;
 * recusa/expiração só "informadas"; cancelar reconsulta antes; reenviar
 * respeita a janela e o sandbox; expirar pela data limite.
 */
const storageMock = vi.hoisted(() => ({
  obterConfissao: vi.fn(async (): Promise<any> => confissao()),
  getIntegracaoComCredencial: vi.fn(async (): Promise<any> => ({ apiToken: "tok", ambiente: "producao", provedorAssina: false, isEnabled: true })),
  atualizarConfissao: vi.fn(async (_p: number, id: number, patch: any): Promise<any> => ({ ...confissao(), id, ...patch })),
  transicionarConfissao: vi.fn(async (_p: number, id: number, _de: string, para: string, patch: any): Promise<any> => ({ ...confissao(), id, status: para, ...patch })),
  guardarPdf: vi.fn(async (): Promise<any> => ({ sha256: "s", tamanhoBytes: 3 })),
  marcarSubstituidas: vi.fn(async (): Promise<number> => 0),
  registrarEventoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 1 })),
  atualizarCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 9 })),
  obterCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 9, status: "aberto" })),
}));
vi.mock("../../storage", () => ({ storage: storageMock }));
const zap = vi.hoisted(() => ({
  detalharDocumento: vi.fn(async (): Promise<any> => detalhe()),
  baixarArquivo: vi.fn(async (): Promise<Buffer> => Buffer.from("pdf")),
  excluirDocumento: vi.fn(async (): Promise<void> => undefined),
  excluirWebhook: vi.fn(async (): Promise<void> => undefined),
  reenviarNotificacoes: vi.fn(async (): Promise<any> => ({ enviados: 1, falhas: 0 })),
}));
const clienteZapSignMock = vi.hoisted(() => vi.fn(() => zap));
vi.mock("../../assinatura/zapsign", () => ({ clienteZapSign: clienteZapSignMock }));
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { aplicarRetorno, cancelarConfissao, expirarSeVencida, reenviarNotificacoes, registrarInformadoPeloWebhook, _reiniciarJanelasParaTestes } from "./confissao-retorno.service";
import { ErroDeConfissao } from "../../assinatura/erro";

function confissao(extra: Record<string, any> = {}) {
  return { id: 77, providerId: 1, customerId: 42, casoId: 9, status: "enviada", ambiente: "producao", valorTotal: "819.76", zapsignDocToken: "doc-1", webhookZapsignId: "w-1",
    zapsignSigners: [{ papel: "cliente", token: "s-1", signUrl: "u", status: "new", signedAt: null, authMode: "x" }], dataLimiteAssinatura: "2026-09-25", recusaInformadaEm: null, expiracaoInformadaEm: null, ...extra };
}
function detalhe(extra: Record<string, any> = {}) {
  return { token: "doc-1", status: "pending", signed_at: null, signed_file: null, original_file: "o", deleted: false, sandbox: false, signers: [{ token: "s-1", status: "link-opened", sign_url: "u", signed_at: null, auth_mode: "x", external_id: "cliente" }], ...extra };
}
beforeEach(() => { vi.clearAllMocks(); _reiniciarJanelasParaTestes(); storageMock.obterConfissao.mockResolvedValue(confissao()); zap.detalharDocumento.mockResolvedValue(detalhe()); });

describe("aplicarRetorno", () => {
  it("fora de enviada não chama o ZapSign", async () => {
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ status: "assinada" }));
    expect(await aplicarRetorno(1, 77, "webhook")).toMatchObject({ status: "assinada", mudou: false, motivo: "fora de enviada" });
    expect(zap.detalharDocumento).not.toHaveBeenCalled();
  });
  it("reconsulta no ambiente DA LINHA; pending só atualiza os signatários", async () => {
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ ambiente: "sandbox" }));
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ sandbox: true }));
    const r = await aplicarRetorno(1, 77, "worker");
    expect(clienteZapSignMock).toHaveBeenCalledWith({ apiToken: "tok", ambiente: "sandbox" });
    expect(r).toMatchObject({ status: "enviada", mudou: false, motivo: null });
    expect(storageMock.atualizarConfissao).toHaveBeenCalledWith(1, 77, expect.objectContaining({ zapsignSigners: [expect.objectContaining({ papel: "cliente", status: "link-opened" })], reconciliarEm: null, erroUltimo: null }));
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalled();
  });
  it("signed: baixa o arquivo (≤ 8 MB), guarda, transição atômica, substitui a anterior, evento e follow-up", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_at: "2026-09-12T10:00:00Z", signed_file: "https://s3/x.pdf", signers: [{ token: "s-1", status: "signed", sign_url: "u", signed_at: "2026-09-12T10:00:00Z", auth_mode: "x", external_id: "cliente" }] }));
    const r = await aplicarRetorno(1, 77, "webhook");
    expect(zap.baixarArquivo).toHaveBeenCalledWith("https://s3/x.pdf", 8 * 1024 * 1024);
    expect(storageMock.guardarPdf).toHaveBeenCalledWith(1, 77, "assinado", expect.any(Buffer));
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "enviada", "assinada", expect.objectContaining({ assinadaEm: new Date("2026-09-12T10:00:00Z"), zapsignSandbox: false, erroUltimo: null }));
    expect(storageMock.marcarSubstituidas).toHaveBeenCalledWith(1, 42, 77);
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(1, expect.objectContaining({ tipo: "confissao", metadata: expect.objectContaining({ status: "assinada" }) }));
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(1, 9, expect.objectContaining({ proximaAcao: expect.stringContaining("título assinado") }), null);
    expect(r).toMatchObject({ status: "assinada", mudou: true, motivo: null });
  });
  it("a transição perdida (outro processo aplicou antes) não grava evento", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: "https://s3/x.pdf" }));
    storageMock.transicionarConfissao.mockResolvedValueOnce(undefined);
    const r = await aplicarRetorno(1, 77, "worker");
    expect(r.mudou).toBe(false);
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });
  it("sandbox em linha de produção não aplica; em sandbox não há follow-up de título assinado", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: "x", sandbox: true }));
    const r = await aplicarRetorno(1, 77, "webhook");
    expect(r).toMatchObject({ status: "enviada", mudou: false, motivo: "ambiente divergente" });
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalled();
    expect(storageMock.atualizarConfissao).toHaveBeenCalledWith(1, 77, expect.objectContaining({ erroUltimo: "ambiente divergente" }));
    vi.clearAllMocks();
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ ambiente: "sandbox" }));
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: "x", sandbox: true }));
    await aplicarRetorno(1, 77, "webhook");
    expect(storageMock.transicionarConfissao).toHaveBeenCalled();
    expect(storageMock.atualizarCasoDeCobranca).not.toHaveBeenCalled();
  });
  it("deleted vira cancelada; reconsulta falhando marca reconciliar_em +10 min e propaga", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ deleted: true }));
    expect(await aplicarRetorno(1, 77, "worker")).toMatchObject({ status: "cancelada", mudou: true, motivo: "apagado no ZapSign" });
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "enviada", "cancelada", expect.objectContaining({ encerradaEm: expect.any(Date) }));
    zap.detalharDocumento.mockRejectedValueOnce(new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "fora", 502));
    await expect(aplicarRetorno(1, 77, "webhook")).rejects.toMatchObject({ codigo: "ZAPSIGN_INDISPONIVEL" });
    const patch = storageMock.atualizarConfissao.mock.calls.at(-1)![2];
    expect(patch.erroUltimo).toBe("fora");
    expect(patch.reconciliarEm.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
  });
  it("signed sem arquivo baixável fica enviada com reconciliar_em, sem transição", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: "https://s3/x.pdf" }));
    zap.baixarArquivo.mockRejectedValueOnce(new ErroDeConfissao("ARQUIVO_GRANDE", "passa de 8 MB", 422));
    const r = await aplicarRetorno(1, 77, "webhook");
    expect(r).toMatchObject({ status: "enviada", mudou: false, motivo: "passa de 8 MB" });
    expect(storageMock.transicionarConfissao).not.toHaveBeenCalled();
  });
});

describe("informado pelo webhook, cancelar, reenviar, expirar", () => {
  it("recusa informada grava a data, mantém enviada, evento e follow-up; a segunda vez não repete o evento", async () => {
    await registrarInformadoPeloWebhook(1, 77, "recusa", "doc_refused");
    expect(storageMock.atualizarConfissao).toHaveBeenCalledWith(1, 77, expect.objectContaining({ recusaInformadaEm: expect.any(Date), erroUltimo: expect.stringContaining("doc_refused") }));
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(1, expect.objectContaining({ metadata: expect.objectContaining({ status: "recusa_informada" }) }));
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(1, 9, expect.objectContaining({ proximaAcao: expect.stringContaining("recusou") }), null);
    vi.clearAllMocks();
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ recusaInformadaEm: new Date() }));
    await registrarInformadoPeloWebhook(1, 77, "recusa", "doc_refused");
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });
  it("cancelar em enviada reconsulta antes: signed → aplica e 409; deleted → cancelada sem DELETE; pending → DELETE e cancelada", async () => {
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ status: "signed", signed_file: "x" }));
    await expect(cancelarConfissao(1, 77, 7)).rejects.toMatchObject({ codigo: "JA_ASSINADA", http: 409 });
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "enviada", "assinada", expect.anything());
    vi.clearAllMocks();
    storageMock.obterConfissao.mockResolvedValue(confissao());
    zap.detalharDocumento.mockResolvedValueOnce(detalhe({ deleted: true }));
    expect((await cancelarConfissao(1, 77, 7)).status).toBe("cancelada");
    expect(zap.excluirDocumento).not.toHaveBeenCalled();
    vi.clearAllMocks();
    storageMock.obterConfissao.mockResolvedValue(confissao());
    zap.detalharDocumento.mockResolvedValueOnce(detalhe());
    const c = await cancelarConfissao(1, 77, 7);
    expect(zap.excluirDocumento).toHaveBeenCalledWith("doc-1");
    expect(zap.excluirWebhook).toHaveBeenCalledWith("w-1");
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "enviada", "cancelada", expect.objectContaining({ encerradaEm: expect.any(Date) }));
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(1, expect.objectContaining({ userId: 7, metadata: expect.objectContaining({ status: "cancelada" }) }));
    expect(c.status).toBe("cancelada");
  });
  it("cancelar rascunho não fala com o ZapSign; assinada não se cancela; reconsulta falhando não muda nada", async () => {
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ status: "rascunho", zapsignDocToken: null }));
    expect((await cancelarConfissao(1, 77, 7)).status).toBe("cancelada");
    expect(zap.detalharDocumento).not.toHaveBeenCalled();
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ status: "assinada" }));
    await expect(cancelarConfissao(1, 77, 7)).rejects.toMatchObject({ codigo: "JA_ASSINADA" });
    storageMock.obterConfissao.mockResolvedValueOnce(confissao());
    zap.detalharDocumento.mockRejectedValueOnce(new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "fora", 502));
    await expect(cancelarConfissao(1, 77, 7)).rejects.toMatchObject({ codigo: "ZAPSIGN_INDISPONIVEL" });
    expect(zap.excluirDocumento).not.toHaveBeenCalled();
  });
  it("reenviar: só enviada, nunca em sandbox, 1 vez a cada 30 min", async () => {
    expect(await reenviarNotificacoes(1, 77)).toEqual({ enviados: 1, falhas: 0 });
    expect(zap.reenviarNotificacoes).toHaveBeenCalledWith("doc-1");
    await expect(reenviarNotificacoes(1, 77)).rejects.toMatchObject({ codigo: "REENVIO_CEDO", http: 429 });
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ id: 78, ambiente: "sandbox" }));
    await expect(reenviarNotificacoes(1, 78)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    storageMock.obterConfissao.mockResolvedValueOnce(confissao({ id: 79, status: "assinada" }));
    await expect(reenviarNotificacoes(1, 79)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  });
  it("expirar: reconsulta primeiro; ainda pending depois da data limite → expirada com evento", async () => {
    expect(await expirarSeVencida(1, 77, "2026-09-24")).toBe(false);
    expect(await expirarSeVencida(1, 77, "2026-09-26")).toBe(true);
    expect(storageMock.transicionarConfissao).toHaveBeenCalledWith(1, 77, "enviada", "expirada", expect.objectContaining({ encerradaEm: expect.any(Date) }));
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(1, expect.objectContaining({ metadata: expect.objectContaining({ status: "expirada" }) }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/services/confissao/confissao-retorno.service.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever `server/services/confissao/confissao-retorno.service.ts`**

```ts
/**
 * O retorno da assinatura (spec §6.3–§6.5): UMA função para o webhook, o
 * worker e o cancelar. Nunca acredita no payload: reconsulta `GET /docs/{token}/`
 * no host do ambiente DA LINHA, com o token do provedor, e só a transição
 * atômica (`WHERE status = 'enviada'`) decide quem grava o evento — webhook e
 * worker chegando juntos não duplicam.
 *
 * Recusa e expiração não são confirmáveis pelo detalhe: ficam "informadas",
 * a confissão segue `enviada`, e o admin conclui pelo cancelar (que prova
 * `deleted`) ou o worker expira pela data limite.
 */
import { storage } from "../../storage";
import { logger } from "../../logger";
import { clienteZapSign, type DocumentoDoZapSign } from "../../assinatura/zapsign";
import { LIMITE_DO_PDF_BYTES } from "../../assinatura/pdf";
import { ErroDeConfissao } from "../../assinatura/erro";
import { registrarEventoDaConfissao, signatariosGravaveis } from "./confissao-emissao.service";
import type { AmbienteDeAssinatura, SignatarioDaConfissao, StatusDeConfissao } from "@shared/cobranca/confissao";
import type { CobrancaConfissao } from "@shared/schema";

export type OrigemDoRetorno = "webhook" | "worker" | "cancelar";
/** `linha` vem preenchida quando ESTE processo aplicou a transição (cancelar devolve-a sem reler). */
export interface ResultadoDoRetorno { status: StatusDeConfissao; mudou: boolean; motivo: string | null; linha?: CobrancaConfissao }

export const RECONSULTA_APOS_FALHA_MS = 10 * 60_000;
export const JANELA_DE_REENVIO_MS = 30 * 60_000;

/** Janela de reenvio por confissão (memória do processo: a API é uma só; o worker não reenvia). */
const ultimoReenvio = new Map<number, number>();
export function _reiniciarJanelasParaTestes(): void { ultimoReenvio.clear(); }

function papeisDe(confissao: CobrancaConfissao): Map<string, "cliente" | "provedor"> {
  const mapa = new Map<string, "cliente" | "provedor">();
  for (const s of (confissao.zapsignSigners as SignatarioDaConfissao[] | null) ?? []) mapa.set(s.token, s.papel);
  return mapa;
}

async function zapDaLinha(providerId: number, confissao: CobrancaConfissao) {
  const cred = await storage.getIntegracaoComCredencial(providerId);
  if (!cred) throw new ErroDeConfissao("NAO_CONFIGURADA", "A integração com o ZapSign não está configurada para este provedor", 409);
  return { zap: clienteZapSign({ apiToken: cred.apiToken, ambiente: confissao.ambiente as AmbienteDeAssinatura }), cred };
}

async function reconsultar(providerId: number, confissao: CobrancaConfissao): Promise<DocumentoDoZapSign> {
  const { zap } = await zapDaLinha(providerId, confissao);
  try {
    return await zap.detalharDocumento(confissao.zapsignDocToken!);
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    await storage.atualizarConfissao(providerId, confissao.id, { erroUltimo: mensagem, reconciliarEm: new Date(Date.now() + RECONSULTA_APOS_FALHA_MS) });
    throw e;
  }
}

async function aplicarAssinatura(providerId: number, confissao: CobrancaConfissao, detalhe: DocumentoDoZapSign, signers: SignatarioDaConfissao[]): Promise<ResultadoDoRetorno> {
  const { zap } = await zapDaLinha(providerId, confissao);
  if (!detalhe.signed_file) {
    await storage.atualizarConfissao(providerId, confissao.id, { zapsignSigners: signers, erroUltimo: "assinado sem arquivo — reconsultar", reconciliarEm: new Date(Date.now() + RECONSULTA_APOS_FALHA_MS) });
    return { status: "enviada", mudou: false, motivo: "assinado sem arquivo — reconsultar" };
  }
  let bytes: Buffer;
  try {
    bytes = await zap.baixarArquivo(detalhe.signed_file, LIMITE_DO_PDF_BYTES);
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    await storage.atualizarConfissao(providerId, confissao.id, { zapsignSigners: signers, erroUltimo: mensagem, reconciliarEm: new Date(Date.now() + RECONSULTA_APOS_FALHA_MS) });
    return { status: "enviada", mudou: false, motivo: mensagem };
  }
  await storage.guardarPdf(providerId, confissao.id, "assinado", bytes);
  const assinadaEm = detalhe.signed_at ? new Date(detalhe.signed_at) : new Date();
  const linha = await storage.transicionarConfissao(providerId, confissao.id, "enviada", "assinada", { assinadaEm, zapsignSigners: signers, zapsignSandbox: detalhe.sandbox, erroUltimo: null, reconciliarEm: null });
  if (!linha) return { status: "enviada", mudou: false, motivo: "outro processo aplicou antes" };
  await storage.marcarSubstituidas(providerId, confissao.customerId, confissao.id);
  const sandbox = confissao.ambiente === "sandbox";
  await registrarEventoDaConfissao(providerId, linha, "assinada", null, sandbox ? "Confissão de dívida assinada em AMBIENTE DE TESTES — sem validade jurídica" : `Confissão de dívida assinada eletronicamente — título executivo extrajudicial (CPC 784, III) de R$ ${Number(linha.valorTotal).toFixed(2).replace(".", ",")}`);
  if (!sandbox) await storage.atualizarCasoDeCobranca(providerId, confissao.casoId, { proximaAcao: "título assinado — acompanhar as parcelas confessadas", proximoContatoEm: new Date(Date.now() + 7 * 86_400_000) }, null).catch(err => logger.warn({ err, providerId, confissaoId: confissao.id }, "CONFISSAO follow-up de título assinado não gravado"));
  return { status: "assinada", mudou: true, motivo: null, linha };
}

export async function aplicarRetorno(providerId: number, confissaoId: number, origem: OrigemDoRetorno): Promise<ResultadoDoRetorno> {
  const confissao = await storage.obterConfissao(providerId, confissaoId);
  if (!confissao) throw new ErroDeConfissao("NAO_ENCONTRADA", "Confissão não encontrada", 404);
  if (confissao.status !== "enviada") return { status: confissao.status as StatusDeConfissao, mudou: false, motivo: "fora de enviada" };
  if (!confissao.zapsignDocToken) return { status: "enviada", mudou: false, motivo: "sem documento no ZapSign" };
  const detalhe = await reconsultar(providerId, confissao);
  const signers = signatariosGravaveis(detalhe.signers, papeisDe(confissao));
  const sandboxDaLinha = confissao.ambiente === "sandbox";
  if (detalhe.sandbox !== sandboxDaLinha) {
    await storage.atualizarConfissao(providerId, confissao.id, { erroUltimo: "ambiente divergente", zapsignSigners: signers });
    logger.warn({ providerId, confissaoId, origem, sandboxDoZapSign: detalhe.sandbox, ambiente: confissao.ambiente }, "CONFISSAO retorno de outro ambiente — não aplicado");
    return { status: "enviada", mudou: false, motivo: "ambiente divergente" };
  }
  if (detalhe.deleted) {
    const linha = await storage.transicionarConfissao(providerId, confissao.id, "enviada", "cancelada", { encerradaEm: new Date(), zapsignSigners: signers, erroUltimo: null, reconciliarEm: null });
    if (linha) await registrarEventoDaConfissao(providerId, linha, "cancelada", null, "Confissão de dívida apagada na conta ZapSign do provedor");
    return { status: "cancelada", mudou: !!linha, motivo: "apagado no ZapSign", linha: linha ?? undefined };
  }
  if (detalhe.status === "signed") return aplicarAssinatura(providerId, confissao, detalhe, signers);
  await storage.atualizarConfissao(providerId, confissao.id, { zapsignSigners: signers, reconciliarEm: null, erroUltimo: null, zapsignSandbox: detalhe.sandbox });
  return { status: "enviada", mudou: false, motivo: null };
}

export async function registrarInformadoPeloWebhook(providerId: number, confissaoId: number, tipo: "recusa" | "expiracao", eventType: string): Promise<void> {
  const confissao = await storage.obterConfissao(providerId, confissaoId);
  if (!confissao || confissao.status !== "enviada") return;
  const jaInformado = tipo === "recusa" ? confissao.recusaInformadaEm : confissao.expiracaoInformadaEm;
  const agora = new Date();
  await storage.atualizarConfissao(providerId, confissaoId, {
    ...(tipo === "recusa" ? { recusaInformadaEm: agora } : { expiracaoInformadaEm: agora }),
    erroUltimo: `${eventType} informado pelo ZapSign — confirme na conta do provedor`,
  });
  if (jaInformado) return;
  if (tipo === "recusa") {
    await registrarEventoDaConfissao(providerId, confissao, "recusa_informada", null, "O ZapSign informou que o cliente recusou a confissão de dívida — confirme na conta e decida o próximo passo");
    await storage.atualizarCasoDeCobranca(providerId, confissao.casoId, { proximaAcao: "cliente recusou a confissão — ligar", proximoContatoEm: agora }, null).catch(() => undefined);
  } else {
    await registrarEventoDaConfissao(providerId, confissao, "expiracao_informada", null, "O ZapSign informou que o prazo de assinatura da confissão expirou");
  }
}

export async function cancelarConfissao(providerId: number, confissaoId: number, userId: number): Promise<CobrancaConfissao> {
  const confissao = await storage.obterConfissao(providerId, confissaoId);
  if (!confissao) throw new ErroDeConfissao("NAO_ENCONTRADA", "Confissão não encontrada", 404);
  if (confissao.status === "assinada") throw new ErroDeConfissao("JA_ASSINADA", "O cliente já assinou — uma confissão assinada não se cancela; emita outra se o valor mudou", 409);
  if (confissao.status === "rascunho") {
    const linha = await storage.transicionarConfissao(providerId, confissaoId, "rascunho", "cancelada", { encerradaEm: new Date() });
    if (!linha) throw new ErroDeConfissao("ESTADO_INVALIDO", "A confissão mudou de estado", 409);
    await registrarEventoDaConfissao(providerId, linha, "cancelada", userId, "Rascunho da confissão de dívida cancelado");
    return linha;
  }
  if (confissao.status !== "enviada") throw new ErroDeConfissao("ESTADO_INVALIDO", `Uma confissão ${confissao.status} não se cancela`, 409);
  const retorno = await aplicarRetorno(providerId, confissaoId, "cancelar");
  if (retorno.status === "assinada") throw new ErroDeConfissao("JA_ASSINADA", "O cliente já assinou — não se cancela", 409);
  if (retorno.status === "cancelada") return retorno.linha ?? (await storage.obterConfissao(providerId, confissaoId))!;
  const { zap } = await zapDaLinha(providerId, confissao);
  await zap.excluirDocumento(confissao.zapsignDocToken!);
  if (confissao.webhookZapsignId) await zap.excluirWebhook(confissao.webhookZapsignId).catch(() => undefined);
  const linha = await storage.transicionarConfissao(providerId, confissaoId, "enviada", "cancelada", { encerradaEm: new Date(), erroUltimo: null, reconciliarEm: null });
  if (!linha) throw new ErroDeConfissao("ESTADO_INVALIDO", "A confissão mudou de estado durante o cancelamento", 409);
  await registrarEventoDaConfissao(providerId, linha, "cancelada", userId, "Confissão de dívida cancelada antes da assinatura (documento apagado no ZapSign)");
  return linha;
}

export async function reenviarNotificacoes(providerId: number, confissaoId: number): Promise<{ enviados: number; falhas: number }> {
  const confissao = await storage.obterConfissao(providerId, confissaoId);
  if (!confissao) throw new ErroDeConfissao("NAO_ENCONTRADA", "Confissão não encontrada", 404);
  if (confissao.status !== "enviada" || !confissao.zapsignDocToken) throw new ErroDeConfissao("ESTADO_INVALIDO", "Só uma confissão aguardando assinatura pode ser reenviada", 409);
  if (confissao.ambiente === "sandbox") throw new ErroDeConfissao("ESTADO_INVALIDO", "Em ambiente de testes nada é enviado ao cliente — copie o link", 409);
  const ultimo = ultimoReenvio.get(confissaoId) ?? 0;
  if (Date.now() - ultimo < JANELA_DE_REENVIO_MS) {
    throw new ErroDeConfissao("REENVIO_CEDO", `Aguarde ${Math.ceil((JANELA_DE_REENVIO_MS - (Date.now() - ultimo)) / 60_000)} min para reenviar`, 429);
  }
  const { zap } = await zapDaLinha(providerId, confissao);
  const r = await zap.reenviarNotificacoes(confissao.zapsignDocToken);
  ultimoReenvio.set(confissaoId, Date.now());
  return r;
}

/** Worker: passada a data limite sem assinatura (reconsultada agora), marca expirada. */
export async function expirarSeVencida(providerId: number, confissaoId: number, hoje: string): Promise<boolean> {
  const retorno = await aplicarRetorno(providerId, confissaoId, "worker");
  if (retorno.status !== "enviada") return false;
  const confissao = await storage.obterConfissao(providerId, confissaoId);
  if (!confissao || confissao.dataLimiteAssinatura >= hoje) return false;
  const linha = await storage.transicionarConfissao(providerId, confissaoId, "enviada", "expirada", { encerradaEm: new Date(), reconciliarEm: null });
  if (!linha) return false;
  await registrarEventoDaConfissao(providerId, linha, "expirada", null, "Prazo de assinatura da confissão de dívida expirado sem assinatura");
  return true;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run server/services/confissao`
Expected: PASS (os três serviços).

- [ ] **Step 5: Commit**

```bash
git add server/services/confissao/confissao-retorno.service.ts server/services/confissao/confissao-retorno.service.test.ts
git commit -m "feat(confissao): retorno — reconsulta no ambiente da linha, transição atômica, cancelar, reenviar, expirar"
```

---

### Task 13: As rotas do provedor — base, emitir, listar, cancelar, reenviar, PDF, estado, modelo revisado

**Files:**
- Create: `server/routes/confissao.routes.ts`
- Create: `server/routes/confissao.routes.test.ts`
- Modify: `server/routes/index.ts` (registrar depois de `registerCobrancaRecebimentosRoutes()`)

**Interfaces:**
- Consumes: `montarBase`, `estadoDaAssinatura` (Task 10); `emitirConfissao` (Task 11); `cancelarConfissao`, `reenviarNotificacoes` (Task 12); storage (`listarConfissoesDoCliente`, `obterConfissao`, `obterPdf`, `marcarModeloRevisado`, `getUsersByProvider`); `podeAdministrarOProvedor` (`./provider.routes`); `requireAuth`, `requireProvider` (`../auth`).
- Produces: `registerConfissaoRoutes(): Router`; `confissaoParaApi(c, nomes): ConfissaoResumo`; `responderErro(res, e)`.

Rotas (todas `requireAuth + requireProvider`; as marcadas **admin** passam por `exigirAdminDoProvedor`):

| Método | Caminho | Quem |
|---|---|---|
| GET | `/api/cobranca/confissoes/estado` | operador |
| PUT | `/api/cobranca/confissoes/modelo/revisado` | **admin** |
| GET | `/api/cobranca/clientes/:customerId/confissoes/base?vencimento=&faturasExcluidas=a,b&email=&telefone=&representanteNome=&representanteCpf=` | operador |
| POST | `/api/cobranca/clientes/:customerId/confissoes` | **admin** |
| GET | `/api/cobranca/clientes/:customerId/confissoes` | operador |
| POST | `/api/cobranca/confissoes/:id/cancelar` | **admin** |
| POST | `/api/cobranca/confissoes/:id/reenviar` | **admin** |
| GET | `/api/cobranca/confissoes/:id/pdf?tipo=original\|assinado` | operador (download registrado) |

- [ ] **Step 1: Escrever o teste que falha**

`server/routes/confissao.routes.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * O contrato das rotas: tenant da sessão em toda chamada; operador comum não
 * emite, não cancela, não reenvia e não marca revisado (403 APROVACAO_OBRIGATORIA);
 * superadmin só em janela de suporte; a base vai com os parâmetros que o
 * diálogo manda; os erros de domínio viram o HTTP do próprio erro; o PDF sai
 * como anexo e registra o download; a lista nunca leva PDF nem segredo.
 */
const storageMock = vi.hoisted(() => ({
  listarConfissoesDoCliente: vi.fn(async (): Promise<any[]> => []),
  obterConfissao: vi.fn(async (): Promise<any> => undefined),
  obterPdf: vi.fn(async (): Promise<any> => undefined),
  marcarModeloRevisado: vi.fn(async (): Promise<void> => undefined),
  getUsersByProvider: vi.fn(async (): Promise<any[]> => [{ id: 7, name: "Ana Admin" }]),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
const HASH = "a".repeat(64);
const servicos = vi.hoisted(() => ({
  montarBase: vi.fn(async (): Promise<any> => ({ dto: { origem: "saldo_integral", bloqueios: [], baseHash: "a".repeat(64), valorTotal: 10 } })),
  estadoDaAssinatura: vi.fn(async (): Promise<any> => ({ configurada: true, ativa: true, ambiente: "producao", modelo: "padrao", modeloRevisado: false, provedorAssina: false, authMode: "assinaturaTela-tokenWhatsapp", custo: null, prazoAssinaturaDias: 15, chatDisponivel: false, motivo: null })),
  emitirConfissao: vi.fn(async (): Promise<any> => confissao({ status: "enviada" })),
  cancelarConfissao: vi.fn(async (): Promise<any> => confissao({ status: "cancelada" })),
  reenviarNotificacoes: vi.fn(async (): Promise<any> => ({ enviados: 1, falhas: 0 })),
}));
vi.mock("../services/confissao/confissao-base.service", () => ({ montarBase: servicos.montarBase, estadoDaAssinatura: servicos.estadoDaAssinatura }));
vi.mock("../services/confissao/confissao-emissao.service", () => ({ emitirConfissao: servicos.emitirConfissao }));
vi.mock("../services/confissao/confissao-retorno.service", () => ({ cancelarConfissao: servicos.cancelarConfissao, reenviarNotificacoes: servicos.reenviarNotificacoes }));
vi.mock("../auth", () => ({
  requireAuth: (req: any, res: any, next: any) => (req.session?.userId ? next() : res.status(401).json({ message: "Autenticacao necessaria" })),
  requireProvider: (req: any, res: any, next: any) => (req.session?.providerId ? next() : res.status(403).json({ message: "Somente provedores" })),
}));
vi.mock("./provider.routes", () => ({
  podeAdministrarOProvedor: (s: any) => s.role === "admin" || (s.role === "superadmin" && s.suporte?.providerId === s.providerId),
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { registerConfissaoRoutes } from "./confissao.routes";
import { ErroDeConfissao } from "../assinatura/erro";

function confissao(extra: Record<string, any> = {}) {
  return { id: 77, providerId: 42, customerId: 5, casoId: 9, negociacaoId: null, status: "enviada", origem: "saldo_integral", ambiente: "producao", zapsignSandbox: false,
    valorTotal: "819.76", valorOriginal: null, descontoPct: null, parcelas: [{ n: 1, rotulo: "parcela", valor: 819.76, vencimento: "2026-10-10" }], erpFaturas: [],
    modelo: "padrao", modeloVersao: "1.0", modeloRevisado: false, dataLimiteAssinatura: "2026-09-25", enviadaEm: new Date("2026-09-10T13:00:00Z"), assinadaEm: null, encerradaEm: null,
    recusaInformadaEm: null, expiracaoInformadaEm: null, erroUltimo: null, zapsignSigners: [{ papel: "cliente", token: "s-1", signUrl: "https://app.zapsign.com.br/verificar/s-1", status: "new", signedAt: null, authMode: "x" }],
    contatoAlteradoPorUserId: null, criadaPorUserId: 7, createdAt: new Date("2026-09-10T12:59:00Z"), pdfOriginalSha256: "a", pdfAssinadoSha256: null, baseCanonica: { segredo: "não sai" }, textoHash: "h1", ...extra };
}

let server: Server;
let base: string;
let sessao: Record<string, any> = {};
const ADMIN = { userId: 7, providerId: 42, role: "admin" };
const OPERADOR = { userId: 8, providerId: 42, role: "user" };
const SUPORTE = { userId: 1, providerId: 42, role: "superadmin", suporte: { providerId: 42 } };
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = sessao; next(); });
  app.use(registerConfissaoRoutes());
  await new Promise<void>(r => { server = app.listen(0, "127.0.0.1", () => r()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });
beforeEach(() => { vi.clearAllMocks(); sessao = ADMIN; });
const json = (method: string, caminho: string, corpo?: unknown) =>
  fetch(`${base}${caminho}`, { method, headers: corpo === undefined ? {} : { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
const corpo = () => ({ origem: "saldo_integral", vencimento: "2026-10-10", faturasExcluidas: ["F-2#multa"], baseHash: HASH, chaveIdempotencia: "5f0c9d1e-2b1a-4c3d-9e8f-000000000001", confirmoTeste: false });

describe("permissões", () => {
  it("operador lê estado, base e lista; não emite, não cancela, não reenvia, não marca revisado", async () => {
    sessao = OPERADOR;
    expect((await json("GET", "/api/cobranca/confissoes/estado")).status).toBe(200);
    expect((await json("GET", "/api/cobranca/clientes/5/confissoes/base")).status).toBe(200);
    expect((await json("GET", "/api/cobranca/clientes/5/confissoes")).status).toBe(200);
    for (const [m, c, b] of [["POST", "/api/cobranca/clientes/5/confissoes", corpo()], ["POST", "/api/cobranca/confissoes/77/cancelar", undefined], ["POST", "/api/cobranca/confissoes/77/reenviar", undefined], ["PUT", "/api/cobranca/confissoes/modelo/revisado", undefined]] as const) {
      const r = await json(m, c, b);
      expect(r.status, `${m} ${c}`).toBe(403);
      expect(await r.json()).toMatchObject({ code: "APROVACAO_OBRIGATORIA", message: expect.stringMatching(/^Apenas administradores podem/) });
    }
    expect(servicos.emitirConfissao).not.toHaveBeenCalled();
  });
  it("admin e superadmin em janela de suporte emitem; superadmin fora da janela não", async () => {
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", corpo())).status).toBe(200);
    sessao = SUPORTE;
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", corpo())).status).toBe(200);
    sessao = { userId: 1, providerId: 42, role: "superadmin" };
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", corpo())).status).toBe(403);
    expect(servicos.emitirConfissao).toHaveBeenCalledTimes(2);
    expect(servicos.emitirConfissao).toHaveBeenCalledWith(42, 5, 7, expect.objectContaining({ origem: "saldo_integral", baseHash: HASH, faturasExcluidas: ["F-2#multa"] }));
  });
  it("sem sessão é 401", async () => {
    sessao = {};
    expect((await json("GET", "/api/cobranca/confissoes/estado")).status).toBe(401);
  });
});

describe("base e emissão", () => {
  it("a base recebe os parâmetros do diálogo e responde o DTO", async () => {
    const r = await json("GET", "/api/cobranca/clientes/5/confissoes/base?vencimento=2026-10-10&faturasExcluidas=F-2%23multa,F-3&email=x%40y.com&representanteNome=Jo%C3%A3o&representanteCpf=987.654.321-00");
    expect(r.status).toBe(200);
    expect(servicos.montarBase).toHaveBeenCalledWith(42, 5, { vencimento: "2026-10-10", faturasExcluidas: ["F-2#multa", "F-3"], email: "x@y.com", telefone: null, representante: { nome: "João", cpf: "98765432100" } });
    expect((await r.json()).baseHash).toBe(HASH);
    expect((await json("GET", "/api/cobranca/clientes/abc/confissoes/base")).status).toBe(400);
    expect((await json("GET", "/api/cobranca/clientes/5/confissoes/base?vencimento=10/10/2026")).status).toBe(400);
  });
  it("o corpo da emissão é validado; erros de domínio saem com o HTTP do erro e o código", async () => {
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", { ...corpo(), chaveIdempotencia: "nao-e-uuid" })).status).toBe(400);
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", { ...corpo(), origem: "outra" })).status).toBe(400);
    servicos.emitirConfissao.mockRejectedValueOnce(new ErroDeConfissao("BLOQUEADA", "abra o caso antes", 422, { bloqueios: ["abra o caso antes"] }));
    const r = await json("POST", "/api/cobranca/clientes/5/confissoes", corpo());
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ message: "abra o caso antes", code: "BLOQUEADA", detalhes: { bloqueios: ["abra o caso antes"] } });
    servicos.emitirConfissao.mockRejectedValueOnce(new ErroDeConfissao("BASE_MUDOU", "A dívida mudou", 409));
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", corpo())).status).toBe(409);
    servicos.emitirConfissao.mockRejectedValueOnce(new Error("boom"));
    expect((await json("POST", "/api/cobranca/clientes/5/confissoes", corpo())).status).toBe(500);
  });
  it("a resposta da emissão e a lista têm a forma de ConfissaoResumo: sem base canônica, sem PDF, com signUrl do cliente e quem emitiu", async () => {
    const r = await (await json("POST", "/api/cobranca/clientes/5/confissoes", corpo())).json();
    expect(r).toMatchObject({ id: 77, status: "enviada", valorTotal: 819.76, signUrlCliente: "https://app.zapsign.com.br/verificar/s-1", criadaPor: "Ana Admin", contatoAlterado: false, pdf: { original: true, assinado: false }, dataLimiteAssinatura: "2026-09-25" });
    expect(JSON.stringify(r)).not.toMatch(/baseCanonica|segredo|base64|textoHash/);
    storageMock.listarConfissoesDoCliente.mockResolvedValueOnce([confissao(), confissao({ id: 60, status: "cancelada" })]);
    const lista = await (await json("GET", "/api/cobranca/clientes/5/confissoes")).json();
    expect(lista.map((c: any) => c.id)).toEqual([77, 60]);
    expect(storageMock.listarConfissoesDoCliente).toHaveBeenCalledWith(42, 5);
  });
});

describe("cancelar, reenviar, PDF, estado, modelo", () => {
  it("cancelar e reenviar passam pelo serviço com o tenant; erro de domínio preserva o HTTP", async () => {
    expect((await json("POST", "/api/cobranca/confissoes/77/cancelar")).status).toBe(200);
    expect(servicos.cancelarConfissao).toHaveBeenCalledWith(42, 77, 7);
    servicos.cancelarConfissao.mockRejectedValueOnce(new ErroDeConfissao("JA_ASSINADA", "já assinou", 409));
    expect((await json("POST", "/api/cobranca/confissoes/77/cancelar")).status).toBe(409);
    expect(await (await json("POST", "/api/cobranca/confissoes/77/reenviar")).json()).toEqual({ enviados: 1, falhas: 0 });
    servicos.reenviarNotificacoes.mockRejectedValueOnce(new ErroDeConfissao("REENVIO_CEDO", "aguarde", 429));
    expect((await json("POST", "/api/cobranca/confissoes/77/reenviar")).status).toBe(429);
  });
  it("o PDF sai como anexo, registra o download e some quando não é deste provedor", async () => {
    sessao = OPERADOR;
    storageMock.obterConfissao.mockResolvedValueOnce(confissao());
    storageMock.obterPdf.mockResolvedValueOnce({ bytes: Buffer.from("%PDF-1.4"), sha256: "a", tamanhoBytes: 8 });
    const r = await json("GET", "/api/cobranca/confissoes/77/pdf?tipo=original");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/pdf");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="confissao-77-original.pdf"');
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe("%PDF-1.4");
    expect(storageMock.obterPdf).toHaveBeenCalledWith(42, 77, "original", { registrarDownload: true });
    expect((await json("GET", "/api/cobranca/confissoes/77/pdf?tipo=assinado")).status).toBe(404);
    expect((await json("GET", "/api/cobranca/confissoes/77/pdf?tipo=outro")).status).toBe(400);
  });
  it("estado e modelo revisado", async () => {
    expect(await (await json("GET", "/api/cobranca/confissoes/estado")).json()).toMatchObject({ configurada: true, ativa: true });
    expect(servicos.estadoDaAssinatura).toHaveBeenCalledWith(42);
    expect((await json("PUT", "/api/cobranca/confissoes/modelo/revisado")).status).toBe(200);
    expect(storageMock.marcarModeloRevisado).toHaveBeenCalledWith(42, 7);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/routes/confissao.routes.test.ts`
Expected: FAIL — `./confissao.routes` inexistente.

- [ ] **Step 3: Escrever `server/routes/confissao.routes.ts`**

```ts
/**
 * Confissão de dívida — as rotas do provedor (spec §6.2, §6.4, §6.5, §6.7).
 * Router próprio: as regras moram nos serviços em server/services/confissao;
 * aqui só sessão, validação, permissão e a forma da resposta.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireProvider } from "../auth";
import { storage } from "../storage";
import { logger } from "../logger";
import { getSafeErrorMessage } from "../utils/safe-error";
import { podeAdministrarOProvedor } from "./provider.routes";
import { ErroDeConfissao } from "../assinatura/erro";
import { estadoDaAssinatura, montarBase } from "../services/confissao/confissao-base.service";
import { emitirConfissao } from "../services/confissao/confissao-emissao.service";
import { cancelarConfissao, reenviarNotificacoes } from "../services/confissao/confissao-retorno.service";
import { ORIGENS_DA_CONFISSAO, type AmbienteDeAssinatura, type ConfissaoResumo, type FaturaDoAnexo, type ModeloDaConfissao, type OrigemDaConfissao, type ParcelaConfessada, type SignatarioDaConfissao, type StatusDeConfissao } from "@shared/cobranca/confissao";
import type { CobrancaConfissao } from "@shared/schema";

const providerDaSessao = (req: Request) => req.session.providerId!;
const usuarioDaSessao = (req: Request) => req.session.userId!;

function idDaRota(valor: string | string[] | undefined): number | null {
  if (typeof valor !== "string") return null;
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A mesma recusa das outras rotas de cobrança, com o código que o cadeado do 360 reconhece. */
function exigirAdminDoProvedor(acao: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!podeAdministrarOProvedor(req.session)) {
      return res.status(403).json({ message: `Apenas administradores podem ${acao}`, code: "APROVACAO_OBRIGATORIA" });
    }
    next();
  };
}

export function responderErro(res: Response, e: unknown) {
  if (e instanceof ErroDeConfissao) {
    return res.status(e.http).json({ message: e.message, code: e.codigo, ...(e.detalhes ? { detalhes: e.detalhes } : {}) });
  }
  return res.status(500).json({ message: getSafeErrorMessage(e) });
}

const numero = (s: string | null) => (s === null ? null : Number(s));
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function confissaoParaApi(c: CobrancaConfissao, nomes: Map<number, string>): ConfissaoResumo {
  const signatarios = (c.zapsignSigners as SignatarioDaConfissao[] | null) ?? [];
  return {
    id: c.id,
    customerId: c.customerId,
    casoId: c.casoId,
    negociacaoId: c.negociacaoId,
    status: c.status as StatusDeConfissao,
    origem: c.origem as OrigemDaConfissao,
    ambiente: c.ambiente as AmbienteDeAssinatura,
    zapsignSandbox: c.zapsignSandbox,
    valorTotal: Number(c.valorTotal),
    valorOriginal: numero(c.valorOriginal),
    descontoPct: numero(c.descontoPct),
    parcelas: (c.parcelas as ParcelaConfessada[] | null) ?? [],
    anexo: (c.erpFaturas as FaturaDoAnexo[] | null) ?? [],
    modelo: c.modelo as ModeloDaConfissao,
    modeloVersao: c.modeloVersao,
    modeloRevisado: c.modeloRevisado,
    dataLimiteAssinatura: c.dataLimiteAssinatura,
    enviadaEm: iso(c.enviadaEm),
    assinadaEm: iso(c.assinadaEm),
    encerradaEm: iso(c.encerradaEm),
    recusaInformadaEm: iso(c.recusaInformadaEm),
    expiracaoInformadaEm: iso(c.expiracaoInformadaEm),
    erroUltimo: c.erroUltimo,
    signatarios,
    signUrlCliente: signatarios.find(s => s.papel === "cliente")?.signUrl ?? null,
    contatoAlterado: c.contatoAlteradoPorUserId !== null,
    criadaPor: nomes.get(c.criadaPorUserId) ?? null,
    criadaEm: c.createdAt ? c.createdAt.toISOString() : new Date(0).toISOString(),
    pdf: { original: !!c.pdfOriginalSha256, assinado: !!c.pdfAssinadoSha256 },
  };
}

async function nomesDaEquipe(providerId: number): Promise<Map<number, string>> {
  const usuarios = await storage.getUsersByProvider(providerId).catch(() => []);
  return new Map(usuarios.map(u => [u.id, u.name]));
}

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
const BaseQuerySchema = z.object({
  vencimento: dia.optional(),
  faturasExcluidas: z.string().max(4000).optional(),
  email: z.string().trim().email().max(160).optional(),
  telefone: z.string().trim().max(30).optional(),
  representanteNome: z.string().trim().min(3).max(160).optional(),
  representanteCpf: z.string().trim().max(20).optional(),
});
const EmissaoSchema = z.object({
  origem: z.enum(ORIGENS_DA_CONFISSAO),
  vencimento: dia.nullable().optional(),
  faturasExcluidas: z.array(z.string().max(120)).max(500).optional(),
  clienteEmail: z.string().trim().email().max(160).nullable().optional(),
  clienteTelefone: z.string().trim().max(30).nullable().optional(),
  representante: z.object({ nome: z.string().trim().min(3).max(160), cpf: z.string().trim().max(20) }).nullable().optional(),
  baseHash: z.string().regex(/^[0-9a-f]{64}$/),
  chaveIdempotencia: z.string().uuid(),
  confirmoTeste: z.boolean().optional(),
  confirmoPrescricao: z.boolean().optional(),
}).strict();

export function registerConfissaoRoutes(): Router {
  const router = Router();
  router.use("/api/cobranca/confissoes", requireAuth, requireProvider);
  router.use("/api/cobranca/clientes/:customerId/confissoes", requireAuth, requireProvider);

  router.get("/api/cobranca/confissoes/estado", async (req, res) => {
    try {
      res.json(await estadoDaAssinatura(providerDaSessao(req)));
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.put("/api/cobranca/confissoes/modelo/revisado", exigirAdminDoProvedor("marcar o modelo como revisado"), async (req, res) => {
    try {
      await storage.marcarModeloRevisado(providerDaSessao(req), usuarioDaSessao(req));
      res.json(await estadoDaAssinatura(providerDaSessao(req)));
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.get("/api/cobranca/clientes/:customerId/confissoes/base", async (req, res) => {
    const customerId = idDaRota(req.params.customerId);
    if (!customerId) return res.status(400).json({ message: "Cliente invalido" });
    const parsed = BaseQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
    const q = parsed.data;
    try {
      const base = await montarBase(providerDaSessao(req), customerId, {
        vencimento: q.vencimento ?? null,
        faturasExcluidas: q.faturasExcluidas ? q.faturasExcluidas.split(",").map(s => s.trim()).filter(Boolean) : [],
        email: q.email ?? null,
        telefone: q.telefone ?? null,
        representante: q.representanteNome && q.representanteCpf ? { nome: q.representanteNome, cpf: q.representanteCpf.replace(/\D/g, "") } : null,
      });
      res.json(base.dto);
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.post("/api/cobranca/clientes/:customerId/confissoes", exigirAdminDoProvedor("emitir a confissão de dívida"), async (req, res) => {
    const customerId = idDaRota(req.params.customerId);
    if (!customerId) return res.status(400).json({ message: "Cliente invalido" });
    const parsed = EmissaoSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Dados invalidos", errors: parsed.error.flatten().fieldErrors });
    const providerId = providerDaSessao(req);
    try {
      const confissao = await emitirConfissao(providerId, customerId, usuarioDaSessao(req), parsed.data);
      res.json(confissaoParaApi(confissao, await nomesDaEquipe(providerId)));
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.get("/api/cobranca/clientes/:customerId/confissoes", async (req, res) => {
    const customerId = idDaRota(req.params.customerId);
    if (!customerId) return res.status(400).json({ message: "Cliente invalido" });
    const providerId = providerDaSessao(req);
    try {
      const [lista, nomes] = await Promise.all([storage.listarConfissoesDoCliente(providerId, customerId), nomesDaEquipe(providerId)]);
      res.json(lista.map(c => confissaoParaApi(c, nomes)));
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.post("/api/cobranca/confissoes/:id/cancelar", exigirAdminDoProvedor("cancelar a confissão de dívida"), async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Confissao invalida" });
    const providerId = providerDaSessao(req);
    try {
      const c = await cancelarConfissao(providerId, id, usuarioDaSessao(req));
      res.json(confissaoParaApi(c, await nomesDaEquipe(providerId)));
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.post("/api/cobranca/confissoes/:id/reenviar", exigirAdminDoProvedor("reenviar a confissão de dívida"), async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Confissao invalida" });
    try {
      res.json(await reenviarNotificacoes(providerDaSessao(req), id));
    } catch (e) {
      responderErro(res, e);
    }
  });

  router.get("/api/cobranca/confissoes/:id/pdf", async (req, res) => {
    const id = idDaRota(req.params.id);
    if (!id) return res.status(400).json({ message: "Confissao invalida" });
    const tipo = z.enum(["original", "assinado"]).safeParse(req.query.tipo);
    if (!tipo.success) return res.status(400).json({ message: "tipo deve ser original ou assinado" });
    const providerId = providerDaSessao(req);
    try {
      const confissao = await storage.obterConfissao(providerId, id);
      if (!confissao) return res.status(404).json({ message: "Confissao nao encontrada" });
      const pdf = await storage.obterPdf(providerId, id, tipo.data, { registrarDownload: true });
      if (!pdf) return res.status(404).json({ message: tipo.data === "assinado" ? "O PDF assinado ainda não chegou" : "PDF nao encontrado" });
      logger.info({ providerId, userId: usuarioDaSessao(req), confissaoId: id, tipo: tipo.data, sha256: pdf.sha256 }, "CONFISSAO PDF baixado");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="confissao-${id}-${tipo.data}.pdf"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.send(pdf.bytes);
    } catch (e) {
      responderErro(res, e);
    }
  });

  return router;
}
```

- [ ] **Step 4: Registrar e rodar**

`server/routes/index.ts`: import `registerConfissaoRoutes` de `./confissao.routes`; depois de `app.use(registerCobrancaRecebimentosRoutes());` acrescente `app.use(registerConfissaoRoutes());` (os caminhos `/api/cobranca/confissoes/*` e `/api/cobranca/clientes/:id/confissoes*` não colidem com nada do router de cobrança).

Run: `npx vitest run server/routes/confissao.routes.test.ts server/routes/cobranca.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/confissao.routes.ts server/routes/confissao.routes.test.ts server/routes/index.ts
git commit -m "feat(confissao): rotas do provedor — base, emitir, listar, cancelar, reenviar, PDF, estado, modelo revisado"
```

---

### Task 14: O webhook do ZapSign

**Files:**
- Create: `server/routes/webhooks-zapsign.routes.ts`
- Create: `server/routes/webhooks-zapsign.routes.test.ts`
- Modify: `server/routes/index.ts` (registrar ao lado de `registerChatBullqAgenteRoutes()`)

**Interfaces:**
- Consumes: `storage.webhookSecretDoProvedor`, `obterConfissaoPorToken` (Task 7); `aplicarRetorno`, `registrarInformadoPeloWebhook` (Task 12); `createRateLimiter`; `CABECALHO_DO_WEBHOOK` (Task 11).
- Produces: `registerWebhooksZapSignRoutes(): Router` com `POST /api/webhooks/zapsign/:providerId`; `EVENTOS_INFORMATIVOS`; `JANELA_DE_RECONSULTA_MS = 30_000`; `_reiniciarJanelasParaTestes()`.

- [ ] **Step 1: Escrever o teste que falha**

`server/routes/webhooks-zapsign.routes.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * O webhook é público e sem HMAC: o que o defende é o cabeçalho secreto por
 * provedor, comparado em tempo constante e com resposta UNIFORME (401) para
 * provedor inexistente, integração desligada ou cabeçalho errado. Nada do
 * payload é acreditado: `signed` só depois da reconsulta (aplicarRetorno).
 */
const storageMock = vi.hoisted(() => ({
  webhookSecretDoProvedor: vi.fn(async (): Promise<any> => ({ webhookSecret: "segredo-certo", isEnabled: true, ambiente: "producao" })),
  obterConfissaoPorToken: vi.fn(async (): Promise<any> => ({ id: 77, status: "enviada", ambiente: "producao" })),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
const retorno = vi.hoisted(() => ({
  aplicarRetorno: vi.fn(async (): Promise<any> => ({ status: "assinada", mudou: true, motivo: null })),
  registrarInformadoPeloWebhook: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock("../services/confissao/confissao-retorno.service", () => retorno);
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../logger", () => ({ logger: loggerMock }));

import { registerWebhooksZapSignRoutes, _reiniciarJanelasParaTestes } from "./webhooks-zapsign.routes";
import { ErroDeConfissao } from "../assinatura/erro";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(registerWebhooksZapSignRoutes());
  await new Promise<void>(r => { server = app.listen(0, "127.0.0.1", () => r()); });
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });
beforeEach(() => { vi.clearAllMocks(); _reiniciarJanelasParaTestes(); storageMock.obterConfissaoPorToken.mockResolvedValue({ id: 77, status: "enviada", ambiente: "producao" }); });

const post = (providerId: number | string, corpo: unknown, cabecalho?: string) =>
  fetch(`${base}/api/webhooks/zapsign/${providerId}`, { method: "POST", headers: { "content-type": "application/json", ...(cabecalho === undefined ? {} : { "X-Consulta-ISP-Assinatura": cabecalho }) }, body: JSON.stringify(corpo) });
const evento = (event_type: string, extra: Record<string, unknown> = {}) => ({ event_type, token: "doc-1", status: "pending", sandbox: false, signers: [{ token: "s-1", status: "signed", liveness_photo_url: "https://x/selfie.jpg", ip: "1.2.3.4" }], ...extra });

describe("autenticação", () => {
  it("401 uniforme: sem cabeçalho, cabeçalho errado, provedor inexistente, integração desligada", async () => {
    expect((await post(1, evento("doc_signed"))).status).toBe(401);
    expect((await post(1, evento("doc_signed"), "errado")).status).toBe(401);
    storageMock.webhookSecretDoProvedor.mockResolvedValueOnce(undefined);
    expect((await post(999, evento("doc_signed"), "segredo-certo")).status).toBe(401);
    storageMock.webhookSecretDoProvedor.mockResolvedValueOnce({ webhookSecret: "segredo-certo", isEnabled: false, ambiente: "producao" });
    expect((await post(1, evento("doc_signed"), "segredo-certo")).status).toBe(401);
    const corpos = await Promise.all([post(1, evento("doc_signed")), post(999, evento("doc_signed"), "x")].map(async p => (await p).json()));
    expect(corpos[0]).toEqual(corpos[1]);
    expect(retorno.aplicarRetorno).not.toHaveBeenCalled();
    expect((await post("abc", evento("doc_signed"), "segredo-certo")).status).toBe(401);
  });
  it("o corpo do webhook nunca vai ao log — só providerId, event_type e token", async () => {
    await post(1, evento("doc_signed"), "segredo-certo");
    const gravado = JSON.stringify([...loggerMock.info.mock.calls, ...loggerMock.warn.mock.calls]);
    expect(gravado).not.toContain("selfie");
    expect(gravado).not.toContain("1.2.3.4");
    expect(gravado).toContain("doc_signed");
  });
});

describe("eventos", () => {
  it("token desconhecido → 200 ignorado, sem reconsulta", async () => {
    storageMock.obterConfissaoPorToken.mockResolvedValueOnce(undefined);
    const r = await post(1, evento("doc_signed"), "segredo-certo");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, ignorado: true });
    expect(retorno.aplicarRetorno).not.toHaveBeenCalled();
  });
  it("eventos informativos → 200 sem reconsulta", async () => {
    for (const e of ["doc_created", "created_signer", "signature_notification_sent", "doc_read_confirmation", "doc_expiration_alert", "email_bounce", "doc_viewed"]) {
      expect((await post(1, evento(e), "segredo-certo")).status).toBe(200);
    }
    expect(retorno.aplicarRetorno).not.toHaveBeenCalled();
  });
  it("doc_signed e doc_deleted reconsultam pelo serviço (nunca aplicam pelo payload); fora de enviada → 200 sem reconsulta", async () => {
    const r = await post(1, evento("doc_signed", { status: "signed" }), "segredo-certo");
    expect(r.status).toBe(200);
    expect(retorno.aplicarRetorno).toHaveBeenCalledWith(1, 77, "webhook");
    storageMock.obterConfissaoPorToken.mockResolvedValueOnce({ id: 77, status: "assinada", ambiente: "producao" });
    expect((await post(1, evento("doc_signed"), "segredo-certo")).status).toBe(200);
    expect(retorno.aplicarRetorno).toHaveBeenCalledTimes(1);
  });
  it("janela de 30 s por confissão: o segundo evento responde 200 sem reconsultar", async () => {
    await post(1, evento("doc_signed"), "segredo-certo");
    await post(1, evento("doc_deleted"), "segredo-certo");
    expect(retorno.aplicarRetorno).toHaveBeenCalledTimes(1);
    _reiniciarJanelasParaTestes();
    await post(1, evento("doc_deleted"), "segredo-certo");
    expect(retorno.aplicarRetorno).toHaveBeenCalledTimes(2);
  });
  it("doc_refused e doc_expired só ficam informados", async () => {
    await post(1, evento("doc_refused", { status: "recusado" }), "segredo-certo");
    expect(retorno.registrarInformadoPeloWebhook).toHaveBeenCalledWith(1, 77, "recusa", "doc_refused");
    await post(1, evento("doc_expired"), "segredo-certo");
    expect(retorno.registrarInformadoPeloWebhook).toHaveBeenCalledWith(1, 77, "expiracao", "doc_expired");
    expect(retorno.aplicarRetorno).not.toHaveBeenCalled();
  });
  it("reconsulta que falha → 502 (o serviço já gravou reconciliar_em)", async () => {
    retorno.aplicarRetorno.mockRejectedValueOnce(new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "fora", 502));
    expect((await post(1, evento("doc_signed"), "segredo-certo")).status).toBe(502);
  });
  it("corpo sem event_type ou sem token → 400; limite por provedor → 429", async () => {
    expect((await post(1, { foo: 1 }, "segredo-certo")).status).toBe(400);
    for (let i = 0; i < 60; i++) await post(1, evento("doc_created"), "segredo-certo");
    expect((await post(1, evento("doc_created"), "segredo-certo")).status).toBe(429);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/routes/webhooks-zapsign.routes.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever `server/routes/webhooks-zapsign.routes.ts`**

```ts
/**
 * POST /api/webhooks/zapsign/:providerId — o retorno do ZapSign (spec §6.3).
 *
 * Público, sem HMAC (o ZapSign não assina). O que autentica é o cabeçalho
 * `X-Consulta-ISP-Assinatura`, registrado por DOCUMENTO na emissão, comparado
 * em tempo constante ao `webhook_secret` do provedor — e a um segredo
 * fictício quando não há integração, para não vazar por tempo. Toda recusa é
 * o MESMO 401. Nada do payload vira estado: quem decide é `aplicarRetorno`,
 * que reconsulta o ZapSign. Do corpo só se lê `event_type` e o token.
 */
import { Router } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { storage } from "../storage";
import { logger } from "../logger";
import { createRateLimiter } from "../middleware/rate-limiter.middleware";
import { ErroDeConfissao } from "../assinatura/erro";
import { CABECALHO_DO_WEBHOOK } from "../services/confissao/confissao-emissao.service";
import { aplicarRetorno, registrarInformadoPeloWebhook } from "../services/confissao/confissao-retorno.service";

export const EVENTOS_INFORMATIVOS = new Set(["doc_created", "created_signer", "signature_notification_sent", "doc_read_confirmation", "doc_expiration_alert", "email_bounce", "doc_viewed", "request_signature", "reading_confirmation", "authentication_failure"]);
export const JANELA_DE_RECONSULTA_MS = 30_000;
const LIMITE_POR_PROVEDOR = { janelaMs: 60_000, maximo: 60 };

const SEGREDO_FICTICIO = randomBytes(32).toString("base64url");
const ultimaReconsulta = new Map<number, number>();
const contagemPorProvedor = new Map<number, { count: number; resetAt: number }>();
export function _reiniciarJanelasParaTestes(): void { ultimaReconsulta.clear(); contagemPorProvedor.clear(); }

function cabecalhoConfere(recebido: string | undefined, esperado: string | null): boolean {
  const a = Buffer.from(recebido ?? "", "utf8");
  const b = Buffer.from(esperado ?? SEGREDO_FICTICIO, "utf8");
  // Comprimentos diferentes também comparam (contra um buffer do mesmo tamanho) para o tempo não denunciar.
  const iguais = a.length === b.length && timingSafeEqual(a, b);
  if (a.length !== b.length) timingSafeEqual(b, b);
  return iguais && esperado !== null;
}

function excedeuLimiteDoProvedor(providerId: number): boolean {
  const agora = Date.now();
  const atual = contagemPorProvedor.get(providerId);
  if (!atual || agora >= atual.resetAt) {
    contagemPorProvedor.set(providerId, { count: 1, resetAt: agora + LIMITE_POR_PROVEDOR.janelaMs });
    return false;
  }
  atual.count++;
  return atual.count > LIMITE_POR_PROVEDOR.maximo;
}

const CorpoSchema = z.object({
  event_type: z.string().min(1).max(60),
  token: z.string().min(1).max(200).optional(),
  doc_token: z.string().min(1).max(200).optional(),
}).passthrough();

export function registerWebhooksZapSignRoutes(): Router {
  const router = Router();
  const limitePorIp = createRateLimiter({ windowMs: 60_000, maxRequests: 120 });

  router.post("/api/webhooks/zapsign/:providerId", limitePorIp, async (req, res) => {
    const providerId = Number(req.params.providerId);
    const cabecalho = req.header(CABECALHO_DO_WEBHOOK);
    const integracao = Number.isInteger(providerId) && providerId > 0 ? await storage.webhookSecretDoProvedor(providerId).catch(() => undefined) : undefined;
    const esperado = integracao?.isEnabled ? integracao.webhookSecret : null;
    if (!cabecalhoConfere(cabecalho, esperado)) return res.status(401).json({ message: "Nao autorizado" });
    if (excedeuLimiteDoProvedor(providerId)) return res.status(429).json({ message: "Muitos eventos para este provedor" });

    const parsed = CorpoSchema.safeParse(req.body ?? {});
    const token = parsed.success ? (parsed.data.token ?? parsed.data.doc_token) : undefined;
    if (!parsed.success || !token) return res.status(400).json({ message: "Corpo invalido" });
    const eventType = parsed.data.event_type;
    logger.info({ providerId, eventType, token }, "ZAPSIGN webhook");

    try {
      const confissao = await storage.obterConfissaoPorToken(providerId, token);
      if (!confissao) return res.json({ ok: true, ignorado: true });
      if (EVENTOS_INFORMATIVOS.has(eventType)) return res.json({ ok: true });
      if (confissao.status !== "enviada") return res.json({ ok: true, ignorado: "fora de enviada" });
      if (eventType === "doc_refused" || eventType === "doc_expired") {
        await registrarInformadoPeloWebhook(providerId, confissao.id, eventType === "doc_refused" ? "recusa" : "expiracao", eventType);
        return res.json({ ok: true, informado: true });
      }
      const ultima = ultimaReconsulta.get(confissao.id) ?? 0;
      if (Date.now() - ultima < JANELA_DE_RECONSULTA_MS) return res.json({ ok: true, ignorado: "dentro da janela" });
      ultimaReconsulta.set(confissao.id, Date.now());
      const r = await aplicarRetorno(providerId, confissao.id, "webhook");
      return res.json({ ok: true, status: r.status, mudou: r.mudou });
    } catch (e) {
      if (e instanceof ErroDeConfissao) return res.status(e.http >= 500 ? 502 : e.http).json({ message: e.message, code: e.codigo });
      logger.error({ providerId, eventType, token, err: e }, "ZAPSIGN webhook falhou");
      return res.status(502).json({ message: "Falha ao processar o evento" });
    }
  });

  return router;
}
```

- [ ] **Step 4: Registrar e rodar**

`server/routes/index.ts`: import `registerWebhooksZapSignRoutes` de `./webhooks-zapsign.routes`; depois de `app.use(registerChatBullqAgenteRoutes());` acrescente `app.use(registerWebhooksZapSignRoutes());` com o comentário `// O retorno do ZapSign (sem sessao: cabecalho secreto por provedor, registrado por documento).`

Run: `npx vitest run server/routes/webhooks-zapsign.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/webhooks-zapsign.routes.ts server/routes/webhooks-zapsign.routes.test.ts server/routes/index.ts
git commit -m "feat(confissao): webhook do ZapSign — cabeçalho secreto por provedor, 401 uniforme, reconsulta antes de aplicar"
```

---

### Task 15: Reconciliação no worker — reconsultar, expirar, avisar, quitar

**Files:**
- Create: `server/services/confissao/confissao-reconciliacao.service.ts`
- Create: `server/services/confissao/confissao-reconciliacao.service.test.ts`
- Modify: `server/storage/assinatura.storage.ts` (`confissoesParaReconciliar` aceita `null`; novo `confissoesAssinadasParaQuitacao`)
- Modify: `server/storage/faturas.storage.ts` (novo `statusDasFaturasPorRef`)
- Modify: `server/storage/index.ts` (delegações dos dois métodos novos)
- Modify: `server/worker.ts` (depois do bloco da régua, ~linha 152)

**Interfaces:**
- Consumes: `aplicarRetorno`, `expirarSeVencida` (Task 12); `registrarEventoDaConfissao` (Task 11); storage.
- Produces: `rodarReconciliacao(agora?: Date): Promise<ResumoDaReconciliacao>`, `iniciarReconciliacaoDeConfissoes()`, `_reiniciarReconciliacaoParaTestes()`; storage: `confissoesParaReconciliar(agora, enviadasHaMaisDeMs: number | null)`, `confissoesAssinadasParaQuitacao(maximo?)`, `statusDasFaturasPorRef(providerId, erpSource, refs): Promise<Map<string, string>>`.

- [ ] **Step 1: Escrever o teste que falha**

`server/services/confissao/confissao-reconciliacao.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O worker cobre o que o webhook não entregou: primeiro `reconciliar_em`
 * vencido (a cada passada, 10 min), depois toda `enviada` há mais de 1 h a
 * cada 6 h; expira pela data limite; avisa "falta a assinatura do provedor"
 * uma vez; quita a assinada cujo acordo cumpriu ou cujo Anexo I foi pago.
 */
const storageMock = vi.hoisted(() => ({
  confissoesParaReconciliar: vi.fn(async (): Promise<any[]> => []),
  confissoesParaExpirar: vi.fn(async (): Promise<any[]> => []),
  confissoesAssinadasParaQuitacao: vi.fn(async (): Promise<any[]> => []),
  obterNegociacao: vi.fn(async (): Promise<any> => undefined),
  statusDasFaturasPorRef: vi.fn(async (): Promise<Map<string, string>> => new Map()),
  transicionarConfissao: vi.fn(async (_p: number, id: number, _de: string, para: string): Promise<any> => ({ id, status: para, casoId: 9, valorTotal: "10", ambiente: "producao" })),
  atualizarConfissao: vi.fn(async (): Promise<any> => ({})),
  getIntegracaoComCredencial: vi.fn(async (): Promise<any> => ({ provedorAssina: true })),
  registrarEventoDeCobranca: vi.fn(async (): Promise<any> => ({})),
  atualizarCasoDeCobranca: vi.fn(async (): Promise<any> => ({})),
  obterCasoDeCobranca: vi.fn(async (): Promise<any> => ({ id: 9, status: "aberto" })),
}));
vi.mock("../../storage", () => ({ storage: storageMock }));
const retorno = vi.hoisted(() => ({
  aplicarRetorno: vi.fn(async (): Promise<any> => ({ status: "enviada", mudou: false, motivo: null })),
  expirarSeVencida: vi.fn(async (): Promise<boolean> => true),
}));
vi.mock("./confissao-retorno.service", () => retorno);
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { _reiniciarReconciliacaoParaTestes, rodarReconciliacao } from "./confissao-reconciliacao.service";

const AGORA = new Date("2026-09-12T12:00:00Z");
beforeEach(() => { vi.clearAllMocks(); _reiniciarReconciliacaoParaTestes(); });

describe("reconciliação", () => {
  it("reconsulta na ordem do storage; a varredura completa (enviadas > 1 h) só a cada 6 h", async () => {
    storageMock.confissoesParaReconciliar.mockResolvedValueOnce([{ id: 2, providerId: 1 }, { id: 1, providerId: 1 }]);
    const r1 = await rodarReconciliacao(AGORA);
    expect(storageMock.confissoesParaReconciliar).toHaveBeenLastCalledWith(AGORA, 60 * 60_000);
    expect(retorno.aplicarRetorno.mock.calls.map(c => c[1])).toEqual([2, 1]);
    expect(r1.reconsultadas).toBe(2);
    await rodarReconciliacao(new Date(AGORA.getTime() + 10 * 60_000));
    expect(storageMock.confissoesParaReconciliar).toHaveBeenLastCalledWith(expect.any(Date), null);
    await rodarReconciliacao(new Date(AGORA.getTime() + 6 * 60 * 60_000 + 1));
    expect(storageMock.confissoesParaReconciliar).toHaveBeenLastCalledWith(expect.any(Date), 60 * 60_000);
  });
  it("uma reconsulta que falha não derruba a passada", async () => {
    storageMock.confissoesParaReconciliar.mockResolvedValueOnce([{ id: 1, providerId: 1 }, { id: 2, providerId: 1 }]);
    retorno.aplicarRetorno.mockRejectedValueOnce(new Error("fora"));
    const r = await rodarReconciliacao(AGORA);
    expect(r).toMatchObject({ reconsultadas: 2, falhas: 1 });
  });
  it("expira pela data limite (hoje em texto) pelo serviço", async () => {
    storageMock.confissoesParaExpirar.mockResolvedValueOnce([{ id: 5, providerId: 1 }]);
    const r = await rodarReconciliacao(AGORA);
    expect(storageMock.confissoesParaExpirar).toHaveBeenCalledWith("2026-09-12");
    expect(retorno.expirarSeVencida).toHaveBeenCalledWith(1, 5, "2026-09-12");
    expect(r.expiradas).toBe(1);
  });
  it("avisa 'falta a assinatura do provedor' uma vez: cliente assinou, provedor não, integração com provedorAssina", async () => {
    const c = { id: 7, providerId: 1, casoId: 9, valorTotal: "10", ambiente: "producao", status: "enviada", erroUltimo: null, zapsignSigners: [{ papel: "cliente", status: "signed", token: "a" }, { papel: "provedor", status: "new", token: "b" }] };
    storageMock.confissoesParaReconciliar.mockResolvedValueOnce([c]);
    await rodarReconciliacao(AGORA);
    expect(storageMock.registrarEventoDeCobranca).toHaveBeenCalledWith(1, expect.objectContaining({ metadata: expect.objectContaining({ status: "aguardando_provedor" }) }));
    expect(storageMock.atualizarCasoDeCobranca).toHaveBeenCalledWith(1, 9, expect.objectContaining({ proximaAcao: expect.stringContaining("falta a assinatura do provedor") }), null);
    expect(storageMock.atualizarConfissao).toHaveBeenCalledWith(1, 7, expect.objectContaining({ erroUltimo: "aguardando a assinatura do provedor" }));
    vi.clearAllMocks();
    storageMock.confissoesParaReconciliar.mockResolvedValueOnce([{ ...c, erroUltimo: "aguardando a assinatura do provedor" }]);
    await rodarReconciliacao(AGORA);
    expect(storageMock.registrarEventoDeCobranca).not.toHaveBeenCalled();
  });
  it("quita: acordo cumprido → quitada; saldo integral com o Anexo I todo pago/baixado → quitada; parcial não", async () => {
    storageMock.confissoesAssinadasParaQuitacao.mockResolvedValueOnce([
      { id: 10, providerId: 1, origem: "acordo", negociacaoId: 3, erpSource: "mk", erpFaturas: [] },
      { id: 11, providerId: 1, origem: "saldo_integral", negociacaoId: null, erpSource: "mk", erpFaturas: [{ erpRef: "F-1" }, { erpRef: "F-2" }, { erpRef: "F-2" }] },
      { id: 12, providerId: 1, origem: "saldo_integral", negociacaoId: null, erpSource: "mk", erpFaturas: [{ erpRef: "F-9" }] },
    ]);
    storageMock.obterNegociacao.mockResolvedValueOnce({ id: 3, status: "cumprida" });
    storageMock.statusDasFaturasPorRef.mockResolvedValueOnce(new Map([["F-1", "paid"], ["F-2", "baixada_no_erp"]])).mockResolvedValueOnce(new Map([["F-9", "aberta"]]));
    const r = await rodarReconciliacao(AGORA);
    expect(storageMock.statusDasFaturasPorRef).toHaveBeenCalledWith(1, "mk", ["F-1", "F-2"]);
    expect(storageMock.transicionarConfissao.mock.calls.map(c => [c[1], c[3]])).toEqual([[10, "quitada"], [11, "quitada"]]);
    expect(r.quitadas).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/services/confissao/confissao-reconciliacao.service.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Os métodos de storage**

Em `server/storage/assinatura.storage.ts`, troque a assinatura de `confissoesParaReconciliar` e acrescente `confissoesAssinadasParaQuitacao`:

```ts
  /** `enviadasHaMaisDeMs = null` = só as com `reconciliar_em` vencido (a passada curta). */
  async confissoesParaReconciliar(agora: Date, enviadasHaMaisDeMs: number | null): Promise<CobrancaConfissao[]> {
    const porPrazo = lte(cobrancaConfissoes.reconciliarEm, agora);
    const condicao = enviadasHaMaisDeMs === null
      ? porPrazo
      : or(porPrazo, lte(cobrancaConfissoes.enviadaEm, new Date(agora.getTime() - enviadasHaMaisDeMs)));
    return db.select().from(cobrancaConfissoes)
      .where(and(eq(cobrancaConfissoes.status, "enviada"), condicao))
      .orderBy(asc(cobrancaConfissoes.reconciliarEm), asc(cobrancaConfissoes.id))
      .limit(500);
  }

  async confissoesAssinadasParaQuitacao(maximo = 500): Promise<CobrancaConfissao[]> {
    return db.select().from(cobrancaConfissoes)
      .where(eq(cobrancaConfissoes.status, "assinada"))
      .orderBy(asc(cobrancaConfissoes.assinadaEm), asc(cobrancaConfissoes.id))
      .limit(maximo);
  }
```

(O teste de `assinatura.storage.test.ts` da Task 7 chama `confissoesParaReconciliar(data, 3600000)` e continua válido.)

Em `server/storage/faturas.storage.ts`, dentro de `FaturasStorage`:

```ts
  /** O status atual das faturas do Anexo I de uma confissão, por `erp_ref` — para o worker decidir "quitada". */
  async statusDasFaturasPorRef(providerId: number, erpSource: string, refs: string[]): Promise<Map<string, string>> {
    const mapa = new Map<string, string>();
    if (refs.length === 0) return mapa;
    const linhas = await db.select({ erpRef: invoices.erpRef, status: invoices.status }).from(invoices)
      .where(and(eq(invoices.providerId, providerId), eq(invoices.erpSource, erpSource), inArray(invoices.erpRef, refs)));
    for (const l of linhas) if (l.erpRef) mapa.set(l.erpRef, l.status);
    return mapa;
  }
```

(`inArray` já vem de `drizzle-orm` nesse arquivo; se não, acrescente ao import.) Em `server/storage/index.ts`, delegue os dois novos (`confissoesAssinadasParaQuitacao`, `statusDasFaturasPorRef`) na interface e na classe, no mesmo molde da Task 7; `storage-fachada.test.ts` acusa se faltar.

- [ ] **Step 4: Escrever `server/services/confissao/confissao-reconciliacao.service.ts`**

```ts
/**
 * Reconciliação das confissões (spec §6.3, último parágrafo; §6.6 "quitada").
 * Só o WORKER a roda (server/worker.ts). Uma passada a cada 10 min cobre
 * `reconciliar_em` vencido; a cada 6 h a passada é completa (toda `enviada`
 * há mais de 1 h). A mesma `aplicarRetorno` do webhook — transição atômica,
 * então webhook e worker não duplicam evento.
 */
import { storage } from "../../storage";
import { logger } from "../../logger";
import { aplicarRetorno, expirarSeVencida } from "./confissao-retorno.service";
import { registrarEventoDaConfissao } from "./confissao-emissao.service";
import type { FaturaDoAnexo, SignatarioDaConfissao } from "@shared/cobranca/confissao";
import type { CobrancaConfissao } from "@shared/schema";

export const PASSADA_CURTA_MS = 10 * 60_000;
export const PASSADA_COMPLETA_MS = 6 * 60 * 60_000;
export const ENVIADA_HA_MAIS_DE_MS = 60 * 60_000;
export const MARCA_AGUARDANDO_PROVEDOR = "aguardando a assinatura do provedor";

export interface ResumoDaReconciliacao { reconsultadas: number; falhas: number; expiradas: number; avisosDeProvedor: number; quitadas: number }

let ultimaCompleta = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let timerDoBoot: ReturnType<typeof setTimeout> | null = null;
let emAndamento = false;
export function _reiniciarReconciliacaoParaTestes(): void {
  ultimaCompleta = 0;
  if (timer) clearInterval(timer);
  if (timerDoBoot) clearTimeout(timerDoBoot);
  timer = null;
  timerDoBoot = null;
  emAndamento = false;
}

const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function avisarProvedorPendente(c: CobrancaConfissao): Promise<boolean> {
  const signers = (c.zapsignSigners as SignatarioDaConfissao[] | null) ?? [];
  const cliente = signers.find(s => s.papel === "cliente");
  const provedor = signers.find(s => s.papel === "provedor");
  if (!cliente || cliente.status !== "signed" || !provedor || provedor.status === "signed") return false;
  if (c.erroUltimo === MARCA_AGUARDANDO_PROVEDOR) return false;
  const integracao = await storage.getIntegracaoComCredencial(c.providerId).catch(() => undefined);
  if (!integracao?.provedorAssina) return false;
  await registrarEventoDaConfissao(c.providerId, c, "aguardando_provedor", null, "O cliente assinou a confissão de dívida; falta a assinatura do representante do provedor");
  await storage.atualizarCasoDeCobranca(c.providerId, c.casoId, { proximaAcao: "falta a assinatura do provedor na confissão — assinar pelo link do ZapSign", proximoContatoEm: new Date() }, null).catch(() => undefined);
  await storage.atualizarConfissao(c.providerId, c.id, { erroUltimo: MARCA_AGUARDANDO_PROVEDOR });
  return true;
}

async function quitarSeCabe(c: CobrancaConfissao): Promise<boolean> {
  let quitada = false;
  if (c.origem === "acordo" && c.negociacaoId) {
    const n = await storage.obterNegociacao(c.providerId, c.negociacaoId);
    quitada = n?.status === "cumprida";
  } else if (c.origem === "saldo_integral" && c.erpSource) {
    const refs = [...new Set(((c.erpFaturas as FaturaDoAnexo[] | null) ?? []).map(f => f.erpRef))];
    if (refs.length === 0) return false;
    const status = await storage.statusDasFaturasPorRef(c.providerId, c.erpSource, refs);
    quitada = refs.every(r => status.get(r) === "paid" || status.get(r) === "baixada_no_erp");
  }
  if (!quitada) return false;
  const linha = await storage.transicionarConfissao(c.providerId, c.id, "assinada", "quitada", { encerradaEm: new Date() });
  if (linha) await registrarEventoDaConfissao(c.providerId, linha, "quitada", null, "Dívida confessada quitada — as parcelas foram pagas");
  return !!linha;
}

export async function rodarReconciliacao(agora: Date = new Date()): Promise<ResumoDaReconciliacao> {
  const resumo: ResumoDaReconciliacao = { reconsultadas: 0, falhas: 0, expiradas: 0, avisosDeProvedor: 0, quitadas: 0 };
  const completa = agora.getTime() - ultimaCompleta >= PASSADA_COMPLETA_MS;
  if (completa) ultimaCompleta = agora.getTime();
  const pendentes = await storage.confissoesParaReconciliar(agora, completa ? ENVIADA_HA_MAIS_DE_MS : null);
  for (const c of pendentes) {
    resumo.reconsultadas++;
    try {
      const r = await aplicarRetorno(c.providerId, c.id, "worker");
      if (r.status === "enviada" && await avisarProvedorPendente(c)) resumo.avisosDeProvedor++;
    } catch (e) {
      resumo.falhas++;
      logger.warn({ providerId: c.providerId, confissaoId: c.id, err: e }, "CONFISSAO reconciliação: reconsulta falhou");
    }
  }
  const hoje = isoDia(agora);
  for (const c of await storage.confissoesParaExpirar(hoje)) {
    try {
      if (await expirarSeVencida(c.providerId, c.id, hoje)) resumo.expiradas++;
    } catch (e) {
      resumo.falhas++;
      logger.warn({ providerId: c.providerId, confissaoId: c.id, err: e }, "CONFISSAO reconciliação: expirar falhou");
    }
  }
  for (const c of await storage.confissoesAssinadasParaQuitacao()) {
    try {
      if (await quitarSeCabe(c)) resumo.quitadas++;
    } catch (e) {
      resumo.falhas++;
      logger.warn({ providerId: c.providerId, confissaoId: c.id, err: e }, "CONFISSAO reconciliação: quitação falhou");
    }
  }
  logger.info(resumo, "CONFISSAO reconciliação concluída");
  return resumo;
}

export function iniciarReconciliacaoDeConfissoes(): void {
  if (timer) return;
  const rodar = () => {
    if (emAndamento) return;
    emAndamento = true;
    rodarReconciliacao().catch(err => logger.warn({ err }, "CONFISSAO reconciliação: passada falhou")).finally(() => { emAndamento = false; });
  };
  timerDoBoot = setTimeout(rodar, 60_000);
  timerDoBoot.unref?.();
  timer = setInterval(rodar, PASSADA_CURTA_MS);
  timer.unref?.();
}
```

- [ ] **Step 5: O worker**

Em `server/worker.ts`, depois do bloco `iniciarAgendaDaRegua` (~linha 152) e antes de `iniciarPrimeirosContatos`:

```ts
  // Reconciliação das confissões de dívida: reconsulta o ZapSign para o que
  // não teve retorno, expira pela data limite e quita o que foi pago.
  try {
    const { iniciarReconciliacaoDeConfissoes } = await import("./services/confissao/confissao-reconciliacao.service");
    iniciarReconciliacaoDeConfissoes();
    logger.info("[Worker] Reconciliação de confissões started");
  } catch (err) {
    logger.warn({ err }, "[Worker] Reconciliação de confissões failed to start");
  }
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run server/services/confissao server/storage`
Expected: PASS (inclui a fachada com os dois métodos novos).

- [ ] **Step 7: Commit**

```bash
git add server/services/confissao/confissao-reconciliacao.service.ts server/services/confissao/confissao-reconciliacao.service.test.ts server/storage/assinatura.storage.ts server/storage/faturas.storage.ts server/storage/index.ts server/worker.ts
git commit -m "feat(confissao): reconciliação no worker — reconsulta, expira, avisa o provedor e quita"
```

---

### Task 16: Acordo × confissão, prescrição interrompida e os selos nos payloads

**Files:**
- Modify: `server/routes/cobranca.routes.ts` (`PATCH /api/cobranca/negociacoes/:id` ~linha 2172; rota 360 ~linhas 1500–1680; `montarItem` ~linha 550; rota `/api/cobranca/carteira` ~linha 1402; rota `/api/cobranca/kanban` ~linha 2311)
- Modify: `server/routes/cobranca.routes.test.ts` (novos casos; `storageMock` ganha `confissaoEnviadaDaNegociacao`, `confissaoAssinadaVivaDoCliente`, `confissoesAssinadasVivasPorCliente`)
- Modify: `shared/cobranca/cliente360.ts:240-254` (`Prescricao360`, `prescricaoInterrompidaPorConfissao`)
- Modify: `shared/cobranca/ficha360.ts` (`EntradaDaFicha360.confissaoAssinadaEm`, linha ~370)
- Modify: `shared/cobranca/ficha360.test.ts` (novo caso)
- Modify: `client/src/components/cobranca/tipos.ts` (`ItemDaCarteira.confissao`, `Cliente360.confissaoViva`, `FichaEntrada.confissaoAssinadaEm`)

**Interfaces:**
- Consumes: `cancelarConfissao` (Task 12); storage `confissaoEnviadaDaNegociacao`, `confissaoAssinadaVivaDoCliente`, `confissoesAssinadasVivasPorCliente` (Task 7); `ErroDeConfissao`.
- Produces: `ItemDaCarteira.confissao: { id: number; assinadaEm: string | null; valorTotal: number; ambiente: AmbienteDeAssinatura } | null`; `Cliente360.confissaoViva` com a mesma forma; `Prescricao360.interrompida_em?: string | null`; `prescricaoInterrompidaPorConfissao(assinadaEm: string, hoje: Date): Prescricao360`.

- [ ] **Step 1: Escrever os testes que falham**

Em `shared/cobranca/ficha360.test.ts`, um caso novo (use o fixture de entrada que o arquivo já tem — `entrada()` ou equivalente; adapte o nome):

```ts
  it("confissão assinada viva interrompe a prescrição: conta cinco anos a partir da assinatura (CC art. 202, VI)", () => {
    const hoje = new Date(2026, 8, 10);
    const ficha = montarFicha360({ ...entrada(), hoje, diasAtraso: 1500, confissaoAssinadaEm: "2026-09-01" });
    expect(ficha.prescricao).toEqual({ fatura_mais_antiga: "2026-09-01", data_prescricao: "2031-09-01", prescrita: false, dias_restantes: expect.any(Number), interrompida_em: "2026-09-01" });
    expect(montarFicha360({ ...entrada(), hoje, diasAtraso: 1500 }).prescricao?.interrompida_em).toBeUndefined();
  });
```

Em `server/routes/cobranca.routes.test.ts`, acrescente ao `storageMock` hoisted:

```ts
  confissaoEnviadaDaNegociacao: vi.fn(async (): Promise<any> => undefined),
  confissaoAssinadaVivaDoCliente: vi.fn(async (): Promise<any> => undefined),
  confissoesAssinadasVivasPorCliente: vi.fn(async (): Promise<Map<number, any>> => new Map()),
```

um mock do serviço de retorno logo depois dos outros `vi.mock`:

```ts
const retornoMock = vi.hoisted(() => ({ cancelarConfissao: vi.fn(async (): Promise<any> => ({ id: 77, status: "cancelada" })) }));
vi.mock("../services/confissao/confissao-retorno.service", () => retornoMock);
```

e um `describe` novo no fim do arquivo:

```ts
describe("acordo × confissão e os selos", () => {
  it("cancelar ou quebrar negociação com confissão enviada cancela a confissão ANTES; se o ZapSign falhar, a negociação não muda", async () => {
    sessao = ADMIN;
    storageMock.obterNegociacao.mockResolvedValue({ id: 3, casoId: 9, status: "aceita" });
    storageMock.atualizarStatusDaNegociacao.mockResolvedValue({ id: 3, casoId: 9, status: "cancelada" });
    storageMock.confissaoEnviadaDaNegociacao.mockResolvedValueOnce({ id: 77, status: "enviada" });
    expect((await json("PATCH", "/api/cobranca/negociacoes/3", { status: "cancelada" })).status).toBe(200);
    expect(retornoMock.cancelarConfissao).toHaveBeenCalledWith(42, 77, 7);
    expect(retornoMock.cancelarConfissao.mock.invocationCallOrder[0]).toBeLessThan(storageMock.atualizarStatusDaNegociacao.mock.invocationCallOrder[0]);
    vi.clearAllMocks();
    storageMock.obterNegociacao.mockResolvedValue({ id: 3, casoId: 9, status: "aceita" });
    storageMock.confissaoEnviadaDaNegociacao.mockResolvedValueOnce({ id: 77, status: "enviada" });
    const { ErroDeConfissao } = await import("../assinatura/erro");
    retornoMock.cancelarConfissao.mockRejectedValueOnce(new ErroDeConfissao("ZAPSIGN_INDISPONIVEL", "fora", 502));
    const r = await json("PATCH", "/api/cobranca/negociacoes/3", { status: "quebrada" });
    expect(r.status).toBe(502);
    expect((await r.json()).message).toContain("confissão de dívida ligada a este acordo");
    expect(storageMock.atualizarStatusDaNegociacao).not.toHaveBeenCalled();
  });
  it("a lista da carteira e o 360 carregam o selo da confissão assinada viva", async () => {
    sessao = ADMIN;
    storageMock.listarCasosDeCobranca.mockResolvedValueOnce({ linhas: [linhaCaso()], total: 1 });
    storageMock.confissoesAssinadasVivasPorCliente.mockResolvedValueOnce(new Map([[linhaCaso().cliente.id, { id: 77, assinadaEm: new Date("2026-09-01T12:00:00Z"), valorTotal: 819.76, ambiente: "producao" }]]));
    const lista = await (await json("GET", "/api/cobranca/carteira?carteira=ativo")).json();
    expect(lista.itens[0].confissao).toEqual({ id: 77, assinadaEm: "2026-09-01T12:00:00.000Z", valorTotal: 819.76, ambiente: "producao" });
    storageMock.getCustomersByProvider.mockResolvedValueOnce([clienteFixture()]);
    storageMock.confissaoAssinadaVivaDoCliente.mockResolvedValueOnce({ id: 77, assinadaEm: new Date("2026-09-01T12:00:00Z"), valorTotal: "819.76", ambiente: "producao" });
    const ficha = await (await json("GET", `/api/cobranca/clientes/${clienteFixture().id}/360`)).json();
    expect(ficha.confissaoViva).toEqual({ id: 77, assinadaEm: "2026-09-01T12:00:00.000Z", valorTotal: 819.76, ambiente: "producao" });
    expect(ficha.fichaEntrada.confissaoAssinadaEm).toBe("2026-09-01");
    expect(ficha.ficha.prescricao.interrompida_em).toBe("2026-09-01");
  });
});
```

(`linhaCaso()` e `clienteFixture()` são os fixtures que o arquivo já usa para o 360 — confira os nomes reais no topo do arquivo e ajuste; o cliente do 360 tem de estar em `getCustomersByProvider` porque a rota procura por `id` nessa lista. Se `transicaoDeNegociacao("aceita", "cancelada")` não for permitida pela máquina de estados de `shared/cobranca/estados.ts`, use no fixture o status de origem que ela permite — `ativa` — sem mudar a regra.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run shared/cobranca/ficha360.test.ts server/routes/cobranca.routes.test.ts`
Expected: FAIL nos casos novos.

- [ ] **Step 3: Prescrição interrompida (`shared/cobranca/cliente360.ts`)**

Depois de `prescricaoPorAtraso` (linha ~254):

```ts
/**
 * Confissão assinada viva interrompe a prescrição (CC art. 202, VI): o prazo
 * de cinco anos recomeça na data da assinatura. `assinadaEm` é AAAA-MM-DD.
 */
export function prescricaoInterrompidaPorConfissao(assinadaEm: string, hoje: Date): Prescricao360 {
  const [a, m, d] = assinadaEm.split("-").map(Number);
  const inicio = new Date(a, m - 1, d);
  const dataPrescricao = new Date(inicio.getFullYear() + 5, inicio.getMonth(), inicio.getDate());
  const diasRestantes = Math.ceil((dataPrescricao.getTime() - hoje.getTime()) / 86_400_000);
  return { fatura_mais_antiga: isoDia(inicio), data_prescricao: isoDia(dataPrescricao), prescrita: diasRestantes <= 0, dias_restantes: Math.max(diasRestantes, 0), interrompida_em: isoDia(inicio) };
}
```

e em `Prescricao360` (linha 240) acrescente `interrompida_em?: string | null`.

Em `shared/cobranca/ficha360.ts`: `EntradaDaFicha360` ganha `/** AAAA-MM-DD da confissão de dívida assinada viva; interrompe a prescrição. */ confissaoAssinadaEm?: string | null;`; a linha `const prescricao = prescricaoPorAtraso(e.diasAtraso, e.hoje);` vira:

```ts
  const prescricao = e.confissaoAssinadaEm
    ? prescricaoInterrompidaPorConfissao(e.confissaoAssinadaEm, e.hoje)
    : prescricaoPorAtraso(e.diasAtraso, e.hoje);
```

(importe `prescricaoInterrompidaPorConfissao` de `./cliente360` ao lado de `prescricaoPorAtraso`, linha 21).

- [ ] **Step 4: As rotas (`server/routes/cobranca.routes.ts`)**

1. Imports: `import { cancelarConfissao } from "../services/confissao/confissao-retorno.service";` e `import { ErroDeConfissao } from "../assinatura/erro";` e `import type { ConfissaoAssinadaViva } from "../storage/assinatura.storage";`.

2. `PATCH /api/cobranca/negociacoes/:id`: logo depois de `if (!transicao.ok) return res.status(409)…` e antes de `atualizarStatusDaNegociacao`:

```ts
      // Acordo × confissão (spec §6.6): cancelar ou quebrar um acordo com
      // confissão ENVIADA cancela a confissão antes — DELETE no ZapSign
      // primeiro; se falhar, a negociação não muda e a tela diz por quê.
      if (status === "cancelada" || status === "quebrada") {
        const enviada = await storage.confissaoEnviadaDaNegociacao(providerId, id);
        if (enviada) {
          try {
            await cancelarConfissao(providerId, enviada.id, userId);
          } catch (e) {
            if (e instanceof ErroDeConfissao) return res.status(e.http).json({ message: `A confissão de dívida ligada a este acordo não pôde ser cancelada: ${e.message}`, code: e.codigo });
            throw e;
          }
        }
      }
```

3. Rota 360: no `Promise.all` que carrega `politica, casos, eventos, …` (linha ~1500) acrescente `storage.confissaoAssinadaVivaDoCliente(providerId, customerId).catch(() => undefined)` e receba como `confissaoAssinada`. Em `fichaEntrada` acrescente `confissaoAssinadaEm: confissaoAssinada?.assinadaEm ? confissaoAssinada.assinadaEm.toISOString().slice(0, 10) : null,`. No `res.json({...})` (linha ~1671) acrescente `confissaoViva: confissaoAssinada ? seloDaConfissao(confissaoAssinada) : null,` com o helper (perto de `montarItem`):

```ts
function seloDaConfissao(c: ConfissaoAssinadaViva | { id: number; assinadaEm: Date | null; valorTotal: number | string; ambiente: string }) {
  return { id: c.id, assinadaEm: c.assinadaEm ? c.assinadaEm.toISOString() : null, valorTotal: Number(c.valorTotal), ambiente: c.ambiente };
}
```

4. `montarItem`: acrescente `confissao: null` ao objeto devolvido (o campo existe sempre; quem preenche é a rota, depois). Em `/api/cobranca/carteira`, depois de montar `itens`:

```ts
      const selos = await storage.confissoesAssinadasVivasPorCliente(providerId, itens.map(i => i.customerId)).catch(() => new Map());
      for (const item of itens) item.confissao = selos.has(item.customerId) ? seloDaConfissao(selos.get(item.customerId)!) : null;
```

Em `/api/cobranca/kanban`, depois de `colunas` prontas (antes do `res.json`): junte os `customerId` de todos os cards de todas as colunas, busque o mesmo mapa e carimbe `card.confissao` do mesmo jeito (leia `montarColuna` para o nome do array de cards — `cards`, `itens` ou `linhas` — e use-o).

5. `client/src/components/cobranca/tipos.ts`: `ItemDaCarteira` ganha `confissao: SeloDaConfissao | null;`; `Cliente360` ganha `confissaoViva: SeloDaConfissao | null;`; `FichaEntrada` ganha `confissaoAssinadaEm?: string | null;`; e o tipo:

```ts
/** A confissão assinada viva do cliente — o que acende o selo "título executivo assinado". */
export interface SeloDaConfissao { id: number; assinadaEm: string | null; valorTotal: number; ambiente: "sandbox" | "producao" }
```

- [ ] **Step 5: Rodar tudo**

Run: `npm test && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: suíte verde; `58`.

- [ ] **Step 6: Commit**

```bash
git add server/routes/cobranca.routes.ts server/routes/cobranca.routes.test.ts shared/cobranca/cliente360.ts shared/cobranca/ficha360.ts shared/cobranca/ficha360.test.ts client/src/components/cobranca/tipos.ts
git commit -m "feat(confissao): acordo × confissão ao cancelar/quebrar, prescrição interrompida e o selo nos payloads"
```

---

## Fase 3 — Telas

### Task 17: O selo no card do kanban e na lista da carteira

**Files:**
- Create: `client/src/components/cobranca/SeloConfissao.tsx`
- Create: `client/src/components/cobranca/SeloConfissao.test.ts`
- Modify: `client/src/components/cobranca/CardCliente.tsx` (chips do card ~linha 95; célula do nome em `LinhaDoCliente` ~linha 154)

**Interfaces:**
- Consumes: `ItemDaCarteira.confissao` (Task 16); `SeloCobranca` (`./ui`); `SELO_ASSINADA`, `SELO_SANDBOX` (Task 1); `dataBr` (`./formatacao`).
- Produces: `SeloConfissao({ confissao, compacto? })`.

- [ ] **Step 1: Escrever o teste de fonte que falha**

`client/src/components/cobranca/SeloConfissao.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const selo = readFileSync(new URL("./SeloConfissao.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const card = readFileSync(new URL("./CardCliente.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("SeloConfissao", () => {
  it("é o selo de título assinado; em sandbox diz TESTE e nunca 'título executivo'", () => {
    expect(selo).toContain("SELO_ASSINADA");
    expect(selo).toContain("SELO_SANDBOX");
    expect(selo).toMatch(/ambiente === "sandbox"/);
    expect(selo).toContain('tom={confissao.ambiente === "sandbox" ? "gated" : "ok"}');
  });
  it("some quando não há confissão assinada viva", () => {
    expect(selo).toContain("if (!confissao) return null;");
  });
  it("está no card do kanban e na linha da carteira", () => {
    expect(card).toContain('import { SeloConfissao } from "./SeloConfissao";');
    expect((card.match(/<SeloConfissao confissao=\{item\.confissao\}/g) ?? []).length).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run client/src/components/cobranca/SeloConfissao.test.ts`
Expected: FAIL — arquivo inexistente.

- [ ] **Step 3: Escrever `client/src/components/cobranca/SeloConfissao.tsx`**

```tsx
/**
 * O selo "título executivo assinado" (spec §6.7): aparece no 360, no card do
 * kanban e na linha da carteira quando há confissão ASSINADA VIVA. Em
 * sandbox o selo é "TESTE — sem validade jurídica": um documento de teste
 * nunca pode parecer título.
 */
import { FileSignature } from "lucide-react";
import { SELO_ASSINADA, SELO_SANDBOX } from "@shared/cobranca/confissao";
import { SeloCobranca } from "./ui";
import { dataBr } from "./formatacao";
import type { SeloDaConfissao } from "./tipos";

export function SeloConfissao({ confissao, compacto = false }: { confissao: SeloDaConfissao | null | undefined; compacto?: boolean }) {
  if (!confissao) return null;
  const sandbox = confissao.ambiente === "sandbox";
  const quando = confissao.assinadaEm ? dataBr(confissao.assinadaEm) : null;
  const titulo = sandbox
    ? `Confissão de dívida assinada em AMBIENTE DE TESTES${quando ? ` em ${quando}` : ""} — sem validade jurídica`
    : `Confissão de dívida assinada${quando ? ` em ${quando}` : ""} — título executivo extrajudicial (CPC 784, III) de R$ ${confissao.valorTotal.toFixed(2).replace(".", ",")}`;
  return (
    <SeloCobranca tom={confissao.ambiente === "sandbox" ? "gated" : "ok"} titulo={titulo} testId="selo-confissao">
      <FileSignature className="h-3 w-3" aria-hidden /> {sandbox ? (compacto ? "TESTE" : SELO_SANDBOX) : (compacto ? "título assinado" : SELO_ASSINADA)}
    </SeloCobranca>
  );
}
```

- [ ] **Step 4: Montar no card e na linha**

Em `client/src/components/cobranca/CardCliente.tsx`: import `import { SeloConfissao } from "./SeloConfissao";`. No card, dentro do `div` dos chips (linha ~95), depois de `{item.caso && <SeloStatusCaso status={item.caso.status} />}`: `<SeloConfissao confissao={item.confissao} compacto />`. Em `LinhaDoCliente`, ao lado do nome (linha ~154), troque o `<p className="truncate …">{item.nome}</p>` por:

```tsx
            <p className="flex items-center gap-1.5 truncate text-[12.5px] font-medium text-[var(--text)]">{item.nome}<SeloConfissao confissao={item.confissao} compacto /></p>
```

- [ ] **Step 5: Rodar e olhar**

Run: `npx vitest run client/src/components/cobranca && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: PASS; `58`. Sem confissão gravada, nada muda na tela; a prova visual fica para a Task 18.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/cobranca/SeloConfissao.tsx client/src/components/cobranca/SeloConfissao.test.ts client/src/components/cobranca/CardCliente.tsx
git commit -m "feat(confissao): selo 'título executivo assinado' no card do kanban e na lista"
```

---

### Task 18: O bloco "Confissão de dívida" no Cliente 360 e o diálogo de emissão

**Files:**
- Create: `client/src/components/cobranca/ConfissaoDeDivida.tsx`
- Create: `client/src/components/cobranca/ConfissaoDeDivida.test.ts`
- Modify: `client/src/pages/cobranca/cliente360.tsx` (botão da barra de ações ~linha 472–473; bloco `confissao-cpc-784` ~linhas 517–532; estado `confissao` linha 283; cabeçalho ~linha 410; imports)
- Modify: `client/src/pages/cobranca/cliente360.test.ts:23` (`LETS`: "Confissão CPC 784" → "Confissão de dívida")
- Modify: `client/src/components/cobranca/LinhaDoTempo.tsx` (`descreverEvento`, ~linha 44)

**Interfaces:**
- Consumes: as rotas da Task 13; `ConfissaoResumo`, `EstadoDaAssinatura`, `BaseDaConfissaoDto`, `ROTULO_STATUS_DE_CONFISSAO`, `ROTULO_STATUS_DO_SIGNATARIO`, `ROTULO_CLASSE_DA_FATURA`, `SELO_SANDBOX` (Task 1); `SeloConfissao` (Task 17); `podeAdministrarCobranca`; `apiRequest`; `Dialog*`; `useToast`.
- Produces: `ConfissaoDeDivida({ customerId, casoId, clienteNome, carteira, podeAdministrar, chatCasoId })` — o bloco inteiro (estado, lista, ações, diálogo).

- [ ] **Step 1: Escrever os testes de fonte que falham**

`client/src/components/cobranca/ConfissaoDeDivida.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bloco = readFileSync(new URL("./ConfissaoDeDivida.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const pagina = readFileSync(new URL("../../pages/cobranca/cliente360.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const linha = readFileSync(new URL("./LinhaDoTempo.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("ConfissaoDeDivida (bloco do 360)", () => {
  it("lê estado, lista e base pelas rotas certas, com o customerId no caminho", () => {
    expect(bloco).toContain('"/api/cobranca/confissoes/estado"');
    expect(bloco).toContain("`/api/cobranca/clientes/${customerId}/confissoes`");
    expect(bloco).toContain("`/api/cobranca/clientes/${customerId}/confissoes/base?${");
    expect(bloco).toContain("`/api/cobranca/confissoes/${");
  });
  it("o operador nunca digita valor: a prévia vem do servidor e o POST manda o baseHash e a chave de idempotência", () => {
    expect(bloco).not.toMatch(/name="valor"|valorTotal:\s*Number\(/);
    expect(bloco).toContain("baseHash: base.baseHash");
    expect(bloco).toContain("chaveIdempotencia");
    expect(bloco).toContain("crypto.randomUUID()");
  });
  it("sandbox: faixa TESTE, confirmação obrigatória, sem reenviar e sem enviar pelo chat", () => {
    expect(bloco).toContain("SELO_SANDBOX");
    expect(bloco).toContain("confirmoTeste");
    expect(bloco).toMatch(/ambiente !== "sandbox" && [^\n]*[Rr]eenviar/);
    expect(bloco).toContain("chatDisponivel");
  });
  it("mostra bloqueios, avisos, custo, estado por signatário, faturas de saída desmarcáveis e o link para copiar", () => {
    for (const t of ["bloqueios", "avisos", "custo.texto", "ROTULO_STATUS_DO_SIGNATARIO", "faturasDeSaida", "signUrlCliente", "navigator.clipboard.writeText"]) expect(bloco).toContain(t);
  });
  it("ações sensíveis passam pelo cadeado do admin", () => {
    expect(bloco).toContain("podeAdministrar");
    expect(bloco).toContain("APROVACAO_OBRIGATORIA");
  });
  it("o 360 monta o bloco no lugar do interruptor antigo, sem o ACriar e sem estado local de confissão", () => {
    expect(pagina).toContain('import { ConfissaoDeDivida } from "@/components/cobranca/ConfissaoDeDivida";');
    expect(pagina).toContain("<ConfissaoDeDivida");
    expect(pagina).toContain('data-k="Confissão de dívida"');
    expect(pagina).not.toContain("setConfissao(");
    expect(pagina).not.toContain("habilitação de confissão POR CLIENTE");
    expect(pagina).not.toContain("GATED: sem assinatura eletrônica");
    expect(pagina).toContain("<SeloConfissao confissao={data?.confissaoViva}");
  });
  it("a prescrição interrompida é dita no 360 e a linha do tempo descreve o evento confissao", () => {
    expect(pagina).toContain("interrompida pela confissão de");
    expect(pagina).toContain("CC art. 202, VI");
    expect(linha).toContain('e.tipo === "confissao"');
  });
});
```

E em `client/src/pages/cobranca/cliente360.test.ts:23`, `"Confissão CPC 784"` vira `"Confissão de dívida"`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run client/src/components/cobranca/ConfissaoDeDivida.test.ts client/src/pages/cobranca/cliente360.test.ts`
Expected: FAIL.

- [ ] **Step 3: Escrever `client/src/components/cobranca/ConfissaoDeDivida.tsx`**

```tsx
/**
 * Confissão de dívida (CPC 784) no Cliente 360 — o bloco e o diálogo de
 * emissão (spec §6.2, §6.7, §8).
 *
 * O operador NUNCA digita valor: a base (acordo ou saldo integral ao vivo)
 * vem do servidor com a prévia, o custo, os bloqueios e o `baseHash`; o que
 * ele escolhe é o vencimento (saldo integral), quais faturas de saída ficam
 * de fora, o contato do cliente e, para PJ, o representante. Toda escolha
 * recarrega a base — é ela que o servidor confere na emissão.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, FileSignature, RefreshCw, Send, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { BOTAO_MARCA, BOTAO_SECUNDARIO, CONTROLE_CAMPO } from "@/components/painel/ui";
import {
  ROTULO_CLASSE_DA_FATURA, ROTULO_ORIGEM_DA_CONFISSAO, ROTULO_STATUS_DE_CONFISSAO, ROTULO_STATUS_DO_SIGNATARIO, SELO_SANDBOX,
  type BaseDaConfissaoDto, type ConfissaoResumo, type EstadoDaAssinatura,
} from "@shared/cobranca/confissao";
import { SeloCobranca } from "./ui";
import { dataBr, dataHoraBr } from "./formatacao";

const NUM = "font-mono tabular-nums";
const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

interface Props {
  customerId: number;
  casoId: number | null;
  clienteNome: string;
  podeAdministrar: boolean;
  /** O caso ligado ao chat (para "enviar pelo chat"), quando o Chat BullQ está ligado. */
  chatCasoId: number | null;
}

interface Escolhas { vencimento: string; faturasExcluidas: string[]; email: string; telefone: string; representanteNome: string; representanteCpf: string; confirmoTeste: boolean }

function queryDaBase(e: Escolhas): string {
  const p = new URLSearchParams();
  if (e.vencimento) p.set("vencimento", e.vencimento);
  if (e.faturasExcluidas.length) p.set("faturasExcluidas", e.faturasExcluidas.join(","));
  if (e.email) p.set("email", e.email);
  if (e.telefone) p.set("telefone", e.telefone);
  if (e.representanteNome) p.set("representanteNome", e.representanteNome);
  if (e.representanteCpf) p.set("representanteCpf", e.representanteCpf);
  return p.toString();
}

export function ConfissaoDeDivida({ customerId, casoId, clienteNome, podeAdministrar, chatCasoId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const chaveLista = ["/api/cobranca/clientes", customerId, "confissoes"];
  const { data: estado } = useQuery<EstadoDaAssinatura>({ queryKey: ["/api/cobranca/confissoes/estado"], queryFn: async () => (await apiRequest("GET", "/api/cobranca/confissoes/estado")).json() });
  const { data: lista = [], isLoading } = useQuery<ConfissaoResumo[]>({ queryKey: chaveLista, queryFn: async () => (await apiRequest("GET", `/api/cobranca/clientes/${customerId}/confissoes`)).json() });
  const [aberto, setAberto] = useState(false);
  const viva = lista.find(c => c.status === "rascunho" || c.status === "enviada") ?? null;
  const assinada = lista.find(c => c.status === "assinada") ?? null;
  const recarregar = () => qc.invalidateQueries({ queryKey: chaveLista });

  const erroDaApi = (e: unknown) => {
    const err = e as Error & { codigo?: string; corpo?: { detalhes?: { bloqueios?: string[] } } };
    const bloqueios = err.corpo?.detalhes?.bloqueios;
    toast({ title: err.codigo === "APROVACAO_OBRIGATORIA" ? "Ação de administrador" : "Não foi possível", description: bloqueios?.length ? bloqueios.join(" · ") : err.message, variant: "destructive" });
  };
  const cancelar = useMutation({ mutationFn: async (id: number) => (await apiRequest("POST", `/api/cobranca/confissoes/${id}/cancelar`)).json(), onSuccess: () => { recarregar(); toast({ title: "Confissão cancelada" }); }, onError: erroDaApi });
  const reenviar = useMutation({ mutationFn: async (id: number) => (await apiRequest("POST", `/api/cobranca/confissoes/${id}/reenviar`)).json() as Promise<{ enviados: number }>, onSuccess: r => toast({ title: `Lembrete reenviado a ${r.enviados} signatário${r.enviados === 1 ? "" : "s"}` }), onError: erroDaApi });
  const enviarPeloChat = useMutation({
    mutationFn: async (c: ConfissaoResumo) => {
      const texto = `${clienteNome}, aqui é ${""}o atendimento do provedor. Segue o link para assinar a confissão de dívida (R$ ${c.valorTotal.toFixed(2).replace(".", ",")}) com validade até ${dataBr(c.dataLimiteAssinatura)}: ${c.signUrlCliente}`;
      return (await apiRequest("POST", `/api/chat-bullq/cobranca/casos/${chatCasoId}/enviar`, { texto })).json();
    },
    onSuccess: () => toast({ title: "Link enviado pelo chat", description: "Registrado como contato no caso" }),
    onError: erroDaApi,
  });

  const copiar = async (url: string) => { await navigator.clipboard.writeText(url); toast({ title: "Link copiado" }); };
  const sandbox = estado?.ambiente === "sandbox";

  return (
    <div className="flex flex-col gap-2" data-testid="confissao-de-divida">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-mono text-[10px] font-semibold uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">Confissão de dívida</span>
        {sandbox && <SeloCobranca tom="gated" titulo="A integração do provedor está em sandbox: nada é enviado ao cliente e o documento não tem validade jurídica">{SELO_SANDBOX}</SeloCobranca>}
      </div>

      {estado && !estado.ativa && <p className="text-[12px] leading-4 text-[var(--text-2)]" data-testid="confissao-nao-configurada">{estado.motivo}</p>}

      {isLoading ? <p className="text-[12px] text-[var(--text-muted)]">Lendo confissões…</p> : lista.length === 0 ? (
        <p className="text-[12px] leading-4 text-[var(--text-2)]">Nenhuma confissão emitida para este cliente.{estado?.ativa ? " O título executivo (CPC 784, III) sai com os valores do acordo ou do ERP ao vivo — nada digitado." : ""}</p>
      ) : (
        <ul className="space-y-2" data-testid="lista-confissoes">
          {lista.map(c => (
            <li key={c.id} className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[12px]" data-testid={`confissao-${c.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <SeloCobranca tom={c.status === "assinada" ? (c.ambiente === "sandbox" ? "gated" : "ok") : c.status === "enviada" ? "info" : c.status === "quitada" ? "ok" : "neutro"}>{ROTULO_STATUS_DE_CONFISSAO[c.status]}</SeloCobranca>
                <b className={NUM}>{brl(c.valorTotal)}</b>
                <span className="text-[var(--text-muted)]">· {ROTULO_ORIGEM_DA_CONFISSAO[c.origem]} · {c.parcelas.length} parcela{c.parcelas.length === 1 ? "" : "s"}</span>
                {c.ambiente === "sandbox" && <span className="font-mono text-[10px] uppercase text-[var(--gated)]">teste</span>}
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-2)]">
                {c.signatarios.map(s => `${s.papel}: ${ROTULO_STATUS_DO_SIGNATARIO[s.status]}${s.signedAt ? ` em ${dataHoraBr(s.signedAt)}` : ""}`).join(" · ") || "sem signatário registrado"}
                {c.status === "enviada" && <> · prazo até <span className={NUM}>{dataBr(c.dataLimiteAssinatura)}</span></>}
                {c.assinadaEm && <> · assinada em <span className={NUM}>{dataHoraBr(c.assinadaEm)}</span></>}
                {c.criadaPor && <> · emitida por {c.criadaPor}</>}
              </p>
              {c.recusaInformadaEm && <p className="mt-1 text-[11px] text-[var(--past)]">O ZapSign informou recusa em {dataHoraBr(c.recusaInformadaEm)} — confirme na conta e cancele se for o caso.</p>}
              {c.expiracaoInformadaEm && <p className="mt-1 text-[11px] text-[var(--gated)]">O ZapSign informou expiração em {dataHoraBr(c.expiracaoInformadaEm)}.</p>}
              {c.erroUltimo && !c.recusaInformadaEm && !c.expiracaoInformadaEm && <p className="mt-1 text-[11px] text-[var(--danger)]">{c.erroUltimo}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {c.signUrlCliente && c.status === "enviada" && <button type="button" className={BOTAO_SECUNDARIO} onClick={() => copiar(c.signUrlCliente!)}><Copy className="h-3.5 w-3.5" aria-hidden /> Copiar link</button>}
                {c.status === "enviada" && estado?.chatDisponivel && chatCasoId && c.ambiente !== "sandbox" && <button type="button" className={BOTAO_SECUNDARIO} disabled={enviarPeloChat.isPending} onClick={() => enviarPeloChat.mutate(c)}><Send className="h-3.5 w-3.5" aria-hidden /> Enviar pelo chat</button>}
                {c.status === "enviada" && c.ambiente !== "sandbox" && podeAdministrar && <button type="button" className={BOTAO_SECUNDARIO} disabled={reenviar.isPending} onClick={() => reenviar.mutate(c.id)} title="1 lembrete a cada 30 minutos"><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reenviar</button>}
                {(c.status === "enviada" || c.status === "rascunho") && podeAdministrar && <button type="button" className={BOTAO_SECUNDARIO} disabled={cancelar.isPending} onClick={() => { if (window.confirm("Cancelar esta confissão? O documento é apagado no ZapSign.")) cancelar.mutate(c.id); }}><XCircle className="h-3.5 w-3.5" aria-hidden /> Cancelar</button>}
                {c.pdf.original && <a className={BOTAO_SECUNDARIO} href={`/api/cobranca/confissoes/${c.id}/pdf?tipo=original`}><Download className="h-3.5 w-3.5" aria-hidden /> PDF original</a>}
                {c.pdf.assinado && <a className={BOTAO_SECUNDARIO} href={`/api/cobranca/confissoes/${c.id}/pdf?tipo=assinado`}><Download className="h-3.5 w-3.5" aria-hidden /> PDF assinado</a>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(BOTAO_MARCA, !podeAdministrar && "opacity-60")} disabled={!estado?.ativa || !!viva} onClick={() => setAberto(true)} title={!estado?.ativa ? estado?.motivo ?? "" : viva ? "Já há uma confissão em andamento — cancele-a antes" : podeAdministrar ? "Emitir a confissão com os valores do acordo ou do ERP ao vivo" : "Apenas administradores emitem (APROVACAO_OBRIGATORIA)"} data-testid="acao-emitir-confissao">
          <FileSignature className="h-3.5 w-3.5" aria-hidden /> {assinada ? "Emitir outra" : "Emitir confissão"}
        </button>
        {!casoId && <span className="text-[11px] text-[var(--text-muted)]">abra o caso antes de emitir</span>}
      </div>

      {aberto && <DialogoEmissao customerId={customerId} estado={estado ?? null} onFechar={() => setAberto(false)} onEmitida={() => { setAberto(false); recarregar(); }} />}
    </div>
  );
}

function DialogoEmissao({ customerId, estado, onFechar, onEmitida }: { customerId: number; estado: EstadoDaAssinatura | null; onFechar: () => void; onEmitida: () => void }) {
  const { toast } = useToast();
  const [escolhas, setEscolhas] = useState<Escolhas>({ vencimento: "", faturasExcluidas: [], email: "", telefone: "", representanteNome: "", representanteCpf: "", confirmoTeste: false });
  const [chave] = useState(() => crypto.randomUUID());
  const query = queryDaBase(escolhas);
  const { data: base, isFetching, error } = useQuery<BaseDaConfissaoDto>({
    queryKey: ["/api/cobranca/clientes", customerId, "confissoes", "base", query],
    queryFn: async () => (await apiRequest("GET", `/api/cobranca/clientes/${customerId}/confissoes/base?${query}`)).json(),
    staleTime: 0,
  });
  useEffect(() => {
    // O contato do cadastro entra como valor inicial editável — uma vez só.
    if (base && !escolhas.email && !escolhas.telefone && (base.cliente.email || base.cliente.telefone)) {
      setEscolhas(e => ({ ...e, email: base.cliente.email ?? "", telefone: base.cliente.telefone ?? "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base?.cliente.email, base?.cliente.telefone]);
  const emitir = useMutation({
    mutationFn: async () => {
      if (!base) throw new Error("Base ainda não carregada");
      const corpo = {
        origem: base.origem,
        vencimento: base.origem === "saldo_integral" ? (escolhas.vencimento || base.vencimento.minimo) : null,
        faturasExcluidas: escolhas.faturasExcluidas,
        clienteEmail: escolhas.email || null,
        clienteTelefone: escolhas.telefone || null,
        representante: base.cliente.pessoaJuridica ? { nome: escolhas.representanteNome, cpf: escolhas.representanteCpf } : null,
        baseHash: base.baseHash,
        chaveIdempotencia: chave,
        confirmoTeste: escolhas.confirmoTeste,
      };
      return (await apiRequest("POST", `/api/cobranca/clientes/${customerId}/confissoes`, corpo)).json() as Promise<ConfissaoResumo>;
    },
    onSuccess: c => { toast({ title: c.ambiente === "sandbox" ? "Confissão de TESTE emitida" : "Confissão enviada para assinatura", description: c.signUrlCliente ? "Copie o link ou envie pelo chat" : undefined }); onEmitida(); },
    onError: (e: Error & { codigo?: string; corpo?: { detalhes?: { bloqueios?: string[] } } }) => toast({ title: e.codigo === "BASE_MUDOU" ? "A dívida mudou" : "Não foi possível emitir", description: e.corpo?.detalhes?.bloqueios?.join(" · ") ?? e.message, variant: "destructive" }),
  });
  const alternarFatura = (chaveDaLinha: string) => setEscolhas(e => ({ ...e, faturasExcluidas: e.faturasExcluidas.includes(chaveDaLinha) ? e.faturasExcluidas.filter(x => x !== chaveDaLinha) : [...e.faturasExcluidas, chaveDaLinha] }));
  const sandbox = base?.ambiente === "sandbox";
  const podeEmitir = !!base && base.bloqueios.length === 0 && !isFetching && (!sandbox || escolhas.confirmoTeste) && (base.origem !== "saldo_integral" || !!(escolhas.vencimento || base.vencimento.minimo));
  const previa = useMemo(() => (base?.previa && base.previa.modelo === "padrao" ? base.previa.texto : null), [base]);

  return (
    <Dialog open onOpenChange={o => { if (!o) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confissão de dívida — {base ? ROTULO_ORIGEM_DA_CONFISSAO[base.origem] : "lendo o ERP ao vivo…"}</DialogTitle>
          <DialogDescription>{sandbox ? `${SELO_SANDBOX}: nada é enviado ao cliente; o documento serve só para testar a integração.` : "Instrumento particular de confissão de dívida (CPC 784, III e §4º), assinado eletronicamente pelo ZapSign na conta do provedor. Nenhum valor é digitado: tudo vem do acordo ou do ERP ao vivo."}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-[12px] text-[var(--danger)]">{(error as Error).message}</p>}
        {base && (
          <div className="space-y-3 text-[12.5px]">
            {base.bloqueios.length > 0 && <ul className="rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] p-2 text-[12px] text-[var(--danger)]" data-testid="confissao-bloqueios">{base.bloqueios.map(b => <li key={b}>• {b}</li>)}</ul>}
            {base.avisos.length > 0 && <ul className="rounded border border-[var(--gated-border)] bg-[var(--gated-bg)] p-2 text-[12px] text-[var(--gated)]" data-testid="confissao-avisos">{base.avisos.map(a => <li key={a}>• {a}</li>)}</ul>}
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded border border-[var(--border)] p-2"><p className="text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">valor confessado</p><p className={cn("text-[18px] font-medium", NUM)}>{brl(base.valorTotal)}</p>{base.encargos.multa + base.encargos.juros > 0 && <p className="text-[11px] text-[var(--text-muted)]">inclui multa {brl(base.encargos.multa)} e juros {brl(base.encargos.juros)} ({base.encargos.multaPct}% · {base.encargos.jurosMesPct}% a.m.) até a leitura</p>}</div>
              <div className="rounded border border-[var(--border)] p-2"><p className="text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">leitura do ERP</p><p className={NUM}>{base.erpLidoEm ? dataHoraBr(base.erpLidoEm) : "—"}</p><p className="text-[11px] text-[var(--text-muted)]">{base.erpSource ?? "sem ERP"}{base.dividaAtualDoErp !== null ? ` · saldo ${brl(base.dividaAtualDoErp)}` : ""}</p></div>
              <div className="rounded border border-[var(--border)] p-2"><p className="text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]">custo desta emissão</p><p className="text-[11.5px]">{base.custo.texto}</p></div>
            </div>
            {base.origem === "saldo_integral" && (
              <label className="block">Vencimento do saldo integral (entre {dataBr(base.vencimento.minimo)} e {dataBr(base.vencimento.maximo)})
                <input type="date" className={cn(CONTROLE_CAMPO, "mt-1", NUM)} min={base.vencimento.minimo} max={base.vencimento.maximo} value={escolhas.vencimento || base.vencimento.minimo} onChange={e => setEscolhas(x => ({ ...x, vencimento: e.target.value }))} />
              </label>
            )}
            {base.anexo.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Anexo I — faturas lidas do ERP</p>
                <table className="w-full text-[11.5px]"><thead><tr className="text-left text-[10px] uppercase tracking-[var(--track-wide)] text-[var(--text-muted)]"><th>ref.</th><th>descrição</th><th>venc.</th><th className="text-right">valor</th><th>natureza</th><th className="text-right">encargos</th><th /></tr></thead>
                  <tbody>{base.anexo.concat().map(f => (
                    <tr key={f.chave} className="border-t border-[var(--border-faint)]"><td className={NUM}>{f.erpRef}</td><td>{f.descricao ?? "—"}</td><td className={NUM}>{dataBr(f.vencimento)}</td><td className={cn("text-right", NUM)}>{brl(f.valor)}</td><td>{ROTULO_CLASSE_DA_FATURA[f.classe]}</td><td className={cn("text-right", NUM)}>{f.multa + f.juros > 0 ? brl(f.multa + f.juros) : "—"}</td>
                      <td className="text-right">{base.faturasDeSaida.includes(f.chave) && <button type="button" className="text-[11px] text-[var(--brand)] underline" onClick={() => alternarFatura(f.chave)}>desmarcar</button>}</td></tr>
                  ))}</tbody></table>
                {escolhas.faturasExcluidas.length > 0 && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Fora do título: {escolhas.faturasExcluidas.join(", ")} <button type="button" className="text-[var(--brand)] underline" onClick={() => setEscolhas(e => ({ ...e, faturasExcluidas: [] }))}>incluir de volta</button></p>}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <label>E-mail do cliente<input type="email" className={cn(CONTROLE_CAMPO, "mt-1")} value={escolhas.email} onChange={e => setEscolhas(x => ({ ...x, email: e.target.value }))} /></label>
              <label>Telefone (WhatsApp)<input className={cn(CONTROLE_CAMPO, "mt-1", NUM)} value={escolhas.telefone} onChange={e => setEscolhas(x => ({ ...x, telefone: e.target.value }))} /></label>
              {base.cliente.pessoaJuridica && (<>
                <label>Representante legal · nome<input className={cn(CONTROLE_CAMPO, "mt-1")} value={escolhas.representanteNome} onChange={e => setEscolhas(x => ({ ...x, representanteNome: e.target.value }))} /></label>
                <label>Representante legal · CPF<input className={cn(CONTROLE_CAMPO, "mt-1", NUM)} value={escolhas.representanteCpf} onChange={e => setEscolhas(x => ({ ...x, representanteCpf: e.target.value }))} /></label>
              </>)}
            </div>
            {previa && <details className="rounded border border-[var(--border)] p-2"><summary className="cursor-pointer text-[12px] font-medium">Prévia do texto (modelo padrão v1.0{base.modeloRevisado ? "" : " — sem parecer jurídico"})</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-sans text-[11.5px] leading-4">{previa}</pre></details>}
            {base.previa && base.previa.modelo === "zapsign" && <p className="text-[11.5px] text-[var(--text-muted)]">Modelo do ZapSign {base.previa.templateId}: {base.previa.variaveis.length} variáveis preenchidas pelo servidor.</p>}
            {sandbox && <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={escolhas.confirmoTeste} onChange={e => setEscolhas(x => ({ ...x, confirmoTeste: e.target.checked }))} /> Entendo que é um TESTE sem validade jurídica e que nada será enviado ao cliente.</label>}
          </div>
        )}
        <DialogFooter>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>Fechar</button>
          <button type="button" className={BOTAO_MARCA} disabled={!podeEmitir || emitir.isPending} onClick={() => emitir.mutate()} data-testid="confirmar-emissao">{emitir.isPending ? "Emitindo…" : isFetching ? "Lendo o ERP…" : "Emitir e enviar para assinatura"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: O 360 e a linha do tempo**

Em `client/src/pages/cobranca/cliente360.tsx`:
1. Imports: `import { ConfissaoDeDivida } from "@/components/cobranca/ConfissaoDeDivida";` e `import { SeloConfissao } from "@/components/cobranca/SeloConfissao";`. Remova `Switch` do import se o único uso era o interruptor (linha 525).
2. Apague `const [confissao, setConfissao] = useState(false);` (linha 283).
3. Barra de ações (linhas ~472–473): apague o `<button … disabled title="Confissão de dívida (CPC 784) — GATED: …">` e o `<Pendente motivo="sem assinatura eletrônica (ZapSign) nem parecer jurídico do modelo" ext="GATED" />` — a ação passa a viver no bloco da coluna Recuperar.
4. Cabeçalho (linha ~410): depois de `<SeloOrigem origem={origemDoCabecalho} testId="selo-origem-360" />` acrescente `<SeloConfissao confissao={data?.confissaoViva} />`.
5. O bloco `data-testid="confissao-cpc-784"` (linhas ~517–532) inteiro vira (o `data-k` no invólucro é o que a lista `LETS` de `cliente360.test.ts` procura, na ordem das seções):

```tsx
              <div data-k="Confissão de dívida" data-testid="confissao-cpc-784">
                <ConfissaoDeDivida
                  customerId={cliente.id}
                  casoId={caso?.id ?? null}
                  clienteNome={cliente.nome}
                  podeAdministrar={podeAdministrar}
                  chatCasoId={caso && data?.chat ? caso.id : null}
                />
              </div>
```

6. Prescrição (linha ~554, `<Let k="Prescrição (CC 206 §5)">`): quando `ficha.prescricao?.interrompida_em` existir, antes do texto atual acrescente `<span className="text-[var(--ok)]">interrompida pela confissão de {dataCivilBr(ficha.prescricao.interrompida_em)} (CC art. 202, VI) · </span>`.

Em `client/src/components/cobranca/LinhaDoTempo.tsx`, em `descreverEvento`, depois do bloco de `contato`:

```ts
  if (e.tipo === "confissao") {
    const meta = e.metadata ?? {};
    const status = texto(meta.status);
    const valor = typeof meta.valor === "number" ? ` · R$ ${meta.valor.toFixed(2).replace(".", ",")}` : "";
    const ambiente = meta.ambiente === "sandbox" ? " · TESTE" : "";
    return `${tipo}${status ? `: ${status.replace(/_/g, " ")}` : ""}${valor}${ambiente}`;
  }
```

- [ ] **Step 5: Rodar, olhar a tela**

Run: `npx vitest run client/src && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: PASS; `58`. Com `npm run dev`, abra um cliente 360 com caso aberto: o bloco "Confissão de dívida" aparece na coluna Recuperar; sem integração ativa mostra o motivo e o botão desabilitado; com a integração do provedor 1 em sandbox e ativa, "Emitir confissão" abre o diálogo, a base lê o MK ao vivo (na VPS) e mostra bloqueios/prévia. Confira o console do navegador sem erros.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/cobranca/ConfissaoDeDivida.tsx client/src/components/cobranca/ConfissaoDeDivida.test.ts client/src/components/cobranca/LinhaDoTempo.tsx client/src/pages/cobranca/cliente360.tsx client/src/pages/cobranca/cliente360.test.ts
git commit -m "feat(confissao): bloco no Cliente 360 — estado por signatário, diálogo de emissão, cancelar, reenviar, PDF, sandbox"
```

---

### Task 19: Painel do Provedor em só leitura

**Files:**
- Create: `client/src/components/assinatura/EstadoDaAssinatura.tsx`
- Create: `client/src/components/assinatura/EstadoDaAssinatura.test.ts`
- Modify: `client/src/pages/provedor/painel-provedor.tsx` (aba Integração: antes do `</TabsContent>` da linha ~2228)

**Interfaces:**
- Consumes: `GET /api/cobranca/confissoes/estado` (Task 13) e `PUT /api/cobranca/confissoes/modelo/revisado`; `EstadoDaAssinatura`, `CUSTO_DO_AUTH_MODE` (Task 1); `podeAdministrar` do painel.
- Produces: `EstadoDaAssinatura({ podeAdministrar })`.

- [ ] **Step 1: Escrever o teste de fonte que falha**

`client/src/components/assinatura/EstadoDaAssinatura.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fonte = readFileSync(new URL("./EstadoDaAssinatura.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const painel = readFileSync(new URL("../../pages/provedor/painel-provedor.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("EstadoDaAssinatura (Painel do Provedor)", () => {
  it("é só leitura: lê o estado e, no máximo, marca o modelo como revisado (admin)", () => {
    expect(fonte).toContain('"/api/cobranca/confissoes/estado"');
    expect(fonte).toContain('"/api/cobranca/confissoes/modelo/revisado"');
    expect(fonte).not.toContain("/api/admin/");
    expect(fonte).not.toMatch(/apiToken|webhookSecret/);
    expect(fonte).toContain("podeAdministrar");
  });
  it("mostra ambiente, auth_mode com custo e o aviso do sandbox; explica que quem configura é o superadmin", () => {
    expect(fonte).toContain("CUSTO_DO_AUTH_MODE");
    expect(fonte).toContain("sem validade jurídica");
    expect(fonte).toContain("superadmin");
  });
  it("está montado na aba Integração do Painel do Provedor", () => {
    expect(painel).toContain('import { EstadoDaAssinatura } from "@/components/assinatura/EstadoDaAssinatura";');
    expect(painel).toContain("<EstadoDaAssinatura podeAdministrar={podeAdministrar} />");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run client/src/components/assinatura/EstadoDaAssinatura.test.ts`
Expected: FAIL.

- [ ] **Step 3: Escrever `client/src/components/assinatura/EstadoDaAssinatura.tsx`**

```tsx
/**
 * A assinatura eletrônica como o PROVEDOR a enxerga: só leitura, no molde de
 * `GET provider/erp-integrations`. Quem grava o token é o superadmin na ficha
 * do provedor; o admin do provedor faz uma coisa aqui — marca o modelo padrão
 * como revisado pelo jurídico dele, e o aviso "sem parecer jurídico" sai das
 * emissões seguintes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CUSTO_DO_AUTH_MODE, type EstadoDaAssinatura as Estado } from "@shared/cobranca/confissao";

export function EstadoDaAssinatura({ podeAdministrar }: { podeAdministrar: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const chave = ["/api/cobranca/confissoes/estado"];
  const { data, isLoading } = useQuery<Estado>({ queryKey: chave, queryFn: async () => (await apiRequest("GET", "/api/cobranca/confissoes/estado")).json() });
  const revisar = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/cobranca/confissoes/modelo/revisado")).json() as Promise<Estado>,
    onSuccess: novo => { qc.setQueryData(chave, novo); toast({ title: "Modelo marcado como revisado", description: "As próximas confissões saem sem o aviso de parecer jurídico" }); },
    onError: (e: Error) => toast({ title: "Não foi possível", description: e.message, variant: "destructive" }),
  });
  const linha = (rotulo: string, valor: string) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border-faint)] py-1.5 text-[12.5px] last:border-0">
      <span className="text-[var(--text-muted)]">{rotulo}</span><span className="text-right text-[var(--text)]">{valor}</span>
    </div>
  );
  return (
    <Card className="p-4" data-testid="card-assinatura-eletronica">
      <div className="mb-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}><FileSignature className="w-5 h-5" /></div>
        <div>
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--text)", letterSpacing: "var(--track-tight)" }}>Assinatura eletrônica (confissão de dívida)</h3>
          <p className="text-[12px] text-[var(--text-muted)]">Conta ZapSign do provedor, cadastrada pelo superadmin. Os custos por documento são da sua conta ZapSign.</p>
        </div>
      </div>
      {isLoading || !data ? <p className="text-[12px] text-[var(--text-muted)]">Lendo…</p> : (
        <div>
          {linha("estado", data.ativa ? "ativa" : data.configurada ? "salva, não ativada" : "não configurada — peça ao superadmin")}
          {linha("ambiente", data.ambiente === "producao" ? "produção" : data.ambiente === "sandbox" ? "sandbox — sem validade jurídica, nada é enviado ao cliente" : "—")}
          {linha("modelo do documento", data.modelo === "zapsign" ? "modelo próprio no ZapSign" : `modelo padrão do Consulta ISP v1.0${data.modeloRevisado ? " · revisado" : " · sem parecer jurídico"}`)}
          {linha("prova de quem assina", data.authMode ? `${CUSTO_DO_AUTH_MODE[data.authMode].rotulo} — ${CUSTO_DO_AUTH_MODE[data.authMode].prova}` : "—")}
          {linha("custo por emissão", data.custo?.texto ?? "—")}
          {linha("prazo para assinar", data.prazoAssinaturaDias ? `${data.prazoAssinaturaDias} dias` : "—")}
          {linha("o provedor também assina", data.provedorAssina ? "sim" : "não (o título exige só a assinatura do devedor)")}
          {data.motivo && <p className="mt-2 text-[12px] text-[var(--gated)]">{data.motivo}</p>}
          {data.modelo === "padrao" && !data.modeloRevisado && podeAdministrar && (
            <button type="button" className="mt-3 h-9 rounded border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[13px] font-medium text-[var(--text)] disabled:opacity-60" disabled={revisar.isPending} onClick={() => { if (window.confirm("Confirmar que o texto do modelo padrão foi revisado pelo jurídico do provedor? O aviso 'sem parecer jurídico' deixa de sair.")) revisar.mutate(); }} data-testid="marcar-modelo-revisado">
              Marcar o modelo padrão como revisado
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Montar no painel**

Em `client/src/pages/provedor/painel-provedor.tsx`: `import { EstadoDaAssinatura } from "@/components/assinatura/EstadoDaAssinatura";`; na aba Integração, antes do `</TabsContent>` que a fecha (linha ~2228): `<EstadoDaAssinatura podeAdministrar={podeAdministrar} />` (o painel já calcula `podeAdministrar` — `admin` ou superadmin personificando; confira o nome da variável na função e use-o).

- [ ] **Step 5: Rodar e commitar**

Run: `npx vitest run client/src/components/assinatura && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: PASS; `58`.

```bash
git add client/src/components/assinatura/EstadoDaAssinatura.tsx client/src/components/assinatura/EstadoDaAssinatura.test.ts client/src/pages/provedor/painel-provedor.tsx
git commit -m "feat(confissao): estado da assinatura eletrônica no Painel do Provedor, só leitura, com 'modelo revisado'"
```

---

## Fase 4 — LGPD e produção

### Task 20: Retenção e direitos do titular

**Files:**
- Create: `server/services/lgpd-confissoes.ts`
- Create: `server/services/lgpd-confissoes.test.ts`
- Modify: `server/services/lgpd-retention.ts` (chamar a retenção das confissões na mesma passada)
- Modify: `server/services/lgpd-titular.service.ts` (`processAcesso`, `processExclusao`, `processPortabilidade`)

**Interfaces:**
- Consumes: storage `confissoesParaRetencao`, `anonimizarConfissao`, `confissoesDoTitular` (Task 7).
- Produces: `RETENCAO_SEM_TITULO_DIAS = 90`, `apagarConfissoesSemTitulo(agora?): Promise<number>`, `confissoesDoTitularParaRelatorio(cpf): Promise<{ confissoes: Array<…>; preservadas: Array<…>; baseLegal: string }>`.

- [ ] **Step 1: Escrever o teste que falha**

`server/services/lgpd-confissoes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * LGPD (spec §8): o que NÃO é título — rascunho, cancelada, expirada e tudo de
 * sandbox — perde os dados pessoais 90 dias depois; a assinada em produção
 * fica até 5 anos após o último vencimento ou a quitação (CC 206 §5 I), e o
 * pedido de exclusão do titular não a anonimiza (LGPD art. 16, I) — a resposta
 * lista a confissão e a base legal.
 */
const storageMock = vi.hoisted(() => ({
  confissoesParaRetencao: vi.fn(async (): Promise<any[]> => []),
  anonimizarConfissao: vi.fn(async (): Promise<void> => undefined),
  confissoesDoTitular: vi.fn(async (): Promise<any[]> => []),
}));
vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { RETENCAO_SEM_TITULO_DIAS, apagarConfissoesSemTitulo, confissoesDoTitularParaRelatorio } from "./lgpd-confissoes";

beforeEach(() => vi.clearAllMocks());

describe("retenção", () => {
  it("apaga PDFs e dados pessoais do que não é título, 90 dias depois, uma por uma", async () => {
    storageMock.confissoesParaRetencao.mockResolvedValueOnce([{ id: 1, providerId: 1 }, { id: 2, providerId: 6 }]);
    const agora = new Date("2026-12-10T03:00:00Z");
    expect(await apagarConfissoesSemTitulo(agora)).toBe(2);
    const limite = storageMock.confissoesParaRetencao.mock.calls[0][0] as Date;
    expect(Math.round((agora.getTime() - limite.getTime()) / 86_400_000)).toBe(RETENCAO_SEM_TITULO_DIAS);
    expect(storageMock.anonimizarConfissao.mock.calls).toEqual([[1, 1], [6, 2]]);
  });
  it("uma falha não interrompe as demais", async () => {
    storageMock.confissoesParaRetencao.mockResolvedValueOnce([{ id: 1, providerId: 1 }, { id: 2, providerId: 1 }]);
    storageMock.anonimizarConfissao.mockRejectedValueOnce(new Error("boom"));
    expect(await apagarConfissoesSemTitulo(new Date())).toBe(1);
  });
});

describe("titular", () => {
  it("acesso/portabilidade listam as confissões do CPF; exclusão preserva a assinada em produção com a base legal", async () => {
    storageMock.confissoesDoTitular.mockResolvedValue([
      { id: 10, providerId: 1, status: "assinada", valorTotal: 819.76, ambiente: "producao", assinadaEm: new Date("2026-09-12T10:00:00Z"), createdAt: new Date("2026-09-10T00:00:00Z"), dataLimiteAssinatura: "2026-09-25" },
      { id: 11, providerId: 1, status: "assinada", valorTotal: 10, ambiente: "sandbox", assinadaEm: new Date("2026-09-12T10:00:00Z"), createdAt: new Date("2026-09-10T00:00:00Z"), dataLimiteAssinatura: "2026-09-25" },
      { id: 12, providerId: 1, status: "cancelada", valorTotal: 10, ambiente: "producao", assinadaEm: null, createdAt: new Date("2026-09-10T00:00:00Z"), dataLimiteAssinatura: "2026-09-25" },
    ]);
    const r = await confissoesDoTitularParaRelatorio("123.456.789-01");
    expect(storageMock.confissoesDoTitular).toHaveBeenCalledWith("123.456.789-01");
    expect(r.confissoes.map(c => c.id)).toEqual([10, 11, 12]);
    expect(r.confissoes[0]).toMatchObject({ id: 10, status: "assinada", valor: 819.76, ambiente: "producao", assinadaEm: "2026-09-12T10:00:00.000Z" });
    expect(r.preservadas.map(c => c.id)).toEqual([10]);
    expect(r.baseLegal).toContain("LGPD art. 16, I");
    expect(r.baseLegal).toContain("CC art. 206, §5º, I");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run server/services/lgpd-confissoes.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever `server/services/lgpd-confissoes.ts`**

```ts
/**
 * LGPD da confissão de dívida (spec §8, Retenção).
 *
 * Papéis: provedor = controlador; Consulta ISP = operador; ZapSign = operador
 * contratado pelo provedor. Base legal do tratamento: LGPD art. 7, V
 * (execução de contrato), VI (exercício regular de direitos) e X (proteção do
 * crédito).
 *
 * Retenção: `assinada` em produção é TÍTULO — fica até 5 anos após o último
 * vencimento das parcelas ou a quitação (CC art. 206, §5º, I), e o pedido de
 * exclusão do titular não a anonimiza (LGPD art. 16, I). O resto (rascunho,
 * cancelada, expirada e tudo de sandbox) perde PDFs e dados pessoais 90 dias
 * depois da última mudança, mantendo status, hashes e datas.
 */
import { storage } from "../storage";
import { logger } from "../logger";

export const RETENCAO_SEM_TITULO_DIAS = 90;
export const BASE_LEGAL_DA_PRESERVACAO = "Confissão de dívida assinada em produção é título executivo extrajudicial e é conservada para o exercício regular de direitos em processo (LGPD art. 16, I; art. 7, VI) pelo prazo prescricional de cinco anos (CC art. 206, §5º, I) contado do último vencimento ou da quitação; não é anonimizada por pedido do titular dentro desse prazo.";

export async function apagarConfissoesSemTitulo(agora: Date = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - RETENCAO_SEM_TITULO_DIAS * 86_400_000);
  const alvos = await storage.confissoesParaRetencao(limite);
  let apagadas = 0;
  for (const c of alvos) {
    try {
      await storage.anonimizarConfissao(c.providerId, c.id);
      apagadas++;
    } catch (err) {
      logger.error({ err, providerId: c.providerId, confissaoId: c.id }, "[LGPD-RETENTION] confissão não anonimizada");
    }
  }
  if (apagadas > 0) logger.info({ apagadas }, "[LGPD-RETENTION] confissões sem título anonimizadas");
  return apagadas;
}

export interface ConfissaoNoRelatorio { id: number; providerId: number; status: string; valor: number; ambiente: string; assinadaEm: string | null; emitidaEm: string | null; prazoAssinatura: string }

export async function confissoesDoTitularParaRelatorio(cpf: string): Promise<{ confissoes: ConfissaoNoRelatorio[]; preservadas: ConfissaoNoRelatorio[]; baseLegal: string }> {
  const linhas = await storage.confissoesDoTitular(cpf);
  const confissoes = linhas.map(l => ({
    id: l.id, providerId: l.providerId, status: l.status, valor: l.valorTotal, ambiente: l.ambiente,
    assinadaEm: l.assinadaEm ? l.assinadaEm.toISOString() : null, emitidaEm: l.createdAt ? l.createdAt.toISOString() : null, prazoAssinatura: l.dataLimiteAssinatura,
  }));
  const preservadas = confissoes.filter(c => c.status === "assinada" && c.ambiente === "producao");
  return { confissoes, preservadas, baseLegal: BASE_LEGAL_DA_PRESERVACAO };
}
```

- [ ] **Step 4: Ligar na retenção e no titular**

`server/services/lgpd-retention.ts`: import `apagarConfissoesSemTitulo` de `./lgpd-confissoes`; nos dois lugares em que `anonymizeOldConsultations()` roda (boot e a cada 24 h), logo depois, `await apagarConfissoesSemTitulo();` dentro do mesmo `try`.

`server/services/lgpd-titular.service.ts`: import `confissoesDoTitularParaRelatorio` de `./lgpd-confissoes`. Em `processAcesso` e `processPortabilidade`, acrescente ao objeto devolvido `confissoesDeDivida: (await confissoesDoTitularParaRelatorio(cpf)).confissoes`. Em `processExclusao`, acrescente ao retorno:

```ts
    confissoesPreservadas: (await confissoesDoTitularParaRelatorio(cpf)).preservadas,
    baseLegalDasConfissoes: BASE_LEGAL_DA_PRESERVACAO,
```

(importe também `BASE_LEGAL_DA_PRESERVACAO`). A exclusão não toca `cobranca_confissoes`: o que não é título já cai na retenção de 90 dias; o que é título fica, pela base legal listada na resposta.

- [ ] **Step 5: Rodar e commitar**

Run: `npx vitest run server/services && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: PASS; `58`.

```bash
git add server/services/lgpd-confissoes.ts server/services/lgpd-confissoes.test.ts server/services/lgpd-retention.ts server/services/lgpd-titular.service.ts
git commit -m "feat(confissao): LGPD — retenção de 90 dias do que não é título; acesso, portabilidade e exclusão com a base legal"
```

---

### Task 21: Documentação, variável de ambiente, memória e produção

**Files:**
- Create: `docs/confissao-de-divida-2026-09-09.md`
- Modify: `CLAUDE.md` (seção "Variáveis de Ambiente" e a seção de Cobrança, depois de "Faturas PAGAS (migração 0036…)")
- Modify: `integrations/chat-bullq/WHATSAPP-PROVIDERS.md` não muda; `README`/`.env.example` se existirem ganham `ASSINATURA_WEBHOOK_URL`
- Memória: `C:\Users\Administrator\.claude\projects\F--ConsultaISP\memory\confissao-zapsign.md` + linha em `MEMORY.md`

- [ ] **Step 1: A documentação técnica**

`docs/confissao-de-divida-2026-09-09.md` com estas seções, cada uma com o conteúdo real (não título vazio):

1. **O que é** — instrumento particular de confissão de dívida, CPC 784, III e §4º (testemunhas dispensadas pela Lei 14.620/2023); MP 2.200-2/2001, art. 10, §2º; foro do devedor (CDC 51/101; CPC 63/781); a Lei 14.063/2020 NÃO é citada (não rege particulares).
2. **Como funciona** — o diagrama da spec §4 e a tabela de componentes com os caminhos finais dos arquivos deste plano.
3. **Configurar um provedor** — passo a passo do superadmin (Ficha do provedor › Integração › Assinatura eletrônica): conta ZapSign do provedor, token em Configurações › Integrações › API ZapSign, Salvar, Ativar; sandbox primeiro (`https://sandbox.api.zapsign.com.br`); trocar token/ambiente exige Ativar de novo e regenera o segredo do webhook; os custos (tabela da spec §3).
4. **Emitir** — o que o operador vê (bloqueios da spec §8, a prévia, o custo), o que é admin, o que o sandbox não faz, "copiar link" e "enviar pelo chat".
5. **Retorno** — webhook por documento com cabeçalho `X-Consulta-ISP-Assinatura`, 401 uniforme, reconsulta antes de aplicar, janela de 30 s, reconciliação do worker (10 min / 6 h), expiração, recusa "informada", quitada/substituída.
6. **Dados** — as três tabelas, os índices parciais e o que cada JSON guarda (parcelas, Anexo I com `chave`, signatários).
7. **LGPD** — papéis, base legal, retenção, o que vai e o que volta do ZapSign.
8. **Operação** — `ASSINATURA_WEBHOOK_URL`, como conferir um webhook na conta do ZapSign, o que fazer quando o token para de abrir (`apiTokenIlegivel`), o script de sondagem (`curl -H "Authorization: Bearer …" https://sandbox.api.zapsign.com.br/api/v1/docs/?page=1`).
9. **Fora do escopo** — spec §10.

- [ ] **Step 2: CLAUDE.md**

Na tabela de variáveis de ambiente, depois de `CHAT_BULLQ_TOOLS_HOSTS`:

```env
ASSINATURA_WEBHOOK_URL=             # Opcional; base do webhook do ZapSign (padrao https://consultaisp.com.br/api/webhooks/zapsign).
                                    # O caminho final e /:providerId; o cabecalho X-Consulta-ISP-Assinatura autentica.
```

Na seção de Cobrança, depois do parágrafo "Faturas PAGAS (migração 0036…)", um parágrafo **"Confissão de dívida (migração 0037, 09/09/2026)"** de até 12 linhas: o que é, a conta ZapSign por provedor configurada pelo superadmin, nada digitado (acordo ou ERP ao vivo), `enviada` só vira `assinada` depois da reconsulta, uma viva por cliente, sandbox sem validade, as rotas (`GET/PUT/POST` da Task 13, `POST /api/webhooks/zapsign/:providerId`, `GET/PUT/POST /api/admin/providers/:id/assinatura/zapsign[/ativar]`), o worker, e o ponteiro para `docs/confissao-de-divida-2026-09-09.md` e a spec.

- [ ] **Step 3: Memória**

Arquivo `confissao-zapsign.md` (type: project) com: decisões do dono (conta por provedor; texto padrão + modelo; acordo ou saldo integral; padrões 2.2), o que subiu e quando, o que falta do dono (criar a conta ZapSign de cada provedor e mandar o token; decidir produção depois do teste em sandbox; parecer jurídico do modelo), o endpoint de reenvio confirmado (`/docs/{token}/resend-notifications-bulk/`) e o fato de o webhook aceitar `headers` na criação. Linha em `MEMORY.md`: `- [Confissão de dívida e ZapSign](confissao-zapsign.md) — decisões do dono (09/09/2026), o que subiu, o que falta dele (conta e token por provedor, sandbox → produção, parecer jurídico).`

- [ ] **Step 4: Suíte inteira, build e deploy**

```bash
npm test && npx tsc --noEmit 2>&1 | grep -c "error TS" && npm run build
```

Expected: suíte verde; `58`; build ok. Depois:

```bash
git add docs/confissao-de-divida-2026-09-09.md CLAUDE.md
git commit -m "docs(confissao): confissão de dívida com ZapSign — como configurar, emitir, retorno, dados, LGPD, operação"
git push origin feat/localizacao
```

Deploy (memória `producao-vps`): `ssh -i ~/.ssh/claude-consultaisp root@187.127.7.168 'cd /var/www/consulta-isp && git reset --hard origin/feat/localizacao && npm install && npm run build && pm2 delete consulta-isp consulta-isp-worker; pm2 start ecosystem.config.cjs'`. Confira `pm2 logs consulta-isp --lines 50` pela linha da migração 0037 aplicada e `pm2 logs consulta-isp-worker --lines 30` por "Reconciliação de confissões started". Se `.env` da VPS precisar de `ASSINATURA_WEBHOOK_URL` (só se o domínio não for consultaisp.com.br), acrescente antes do `pm2 start` — o pm2 congela o `.env` no start.

- [ ] **Step 5: Sandbox da NsLink (provedor 1)**

Sem conta do dono não há token: pare aqui e peça ao dono, no relatório final, (1) criar a conta ZapSign da NsLink, (2) gerar o token de **sandbox** em Configurações › Integrações › API ZapSign e colar na ficha do provedor 1 (Integração › Assinatura eletrônica), (3) Ativar. Com o token: emitir uma confissão de TESTE para um cliente com caso aberto e dívida no MK ao vivo, abrir o `sign_url`, assinar no sandbox e conferir no 360 "assinada · TESTE", o PDF assinado baixável e o evento na linha do tempo; conferir no log da API a linha `ZAPSIGN webhook` com `event_type: "doc_signed"`.

---

## Self-review (feito ao escrever; o executor não precisa repetir)

**Cobertura da spec → tarefa:** §2 decisões → Tasks 1 (auth_mode sem `assinaturaTela`), 8/9 (`provedor_assina` padrão false, selfie desligada), 10 (encargos por fatura, `validate_cpf` no contato alterado). §3 fatos do ZapSign → Task 6. §4 arquitetura → estrutura de arquivos. §5.1 → Tasks 4, 7, 8. §5.2/5.3 → Tasks 4, 7. §5.4 evento → Tasks 1, 11, 12, 18. §6.1 configurar → Tasks 8, 9, 19. §6.2 emitir → Tasks 10, 11, 13, 18. §6.3 retorno → Tasks 12, 14, 15. §6.4 cancelar → Tasks 12, 13. §6.5 reenviar → Tasks 12, 13 (endpoint em massa confirmado na doc: `/docs/{token}/resend-notifications-bulk/`). §6.6 acordo × confissão → Tasks 15 (quitada/substituída), 16 (cancelar/quebrar, prescrição). §6.7 consultar → Tasks 13, 17, 18. §7 texto → Tasks 2, 3, 5. §8 regras → Tasks 10, 11, 13, 18; LGPD/retenção → Task 20. §9 testes → um por arquivo criado (nomes da spec: `confissao-modelo.test.ts`, `pdf.test.ts`, `zapsign.test.ts`, `assinatura.storage.test.ts`, `confissao.routes.test.ts`, `webhooks-zapsign.routes.test.ts`, `confissao-reconciliacao.service.test.ts`, `migracao-0037-assinatura.test.ts`, `estados.test.ts`, `cliente360.test.ts`, e os de fonte das telas). §11 fases → as quatro seções.

**Desvios declarados em relação à spec:** (a) cabeçalho do webhook enviado na criação (`headers[]`), não pelo endpoint `/webhook/header/` — a doc aceita e evita uma janela sem cabeçalho; (b) configuração do superadmin num router próprio (`admin-assinatura.routes.ts`) em vez de dentro de `admin.routes.ts`, com os mesmos limites; (c) fatura com multa/equipamento de valor conhecido vira duas linhas do Anexo I (`chave` `erpRef#multa`), para que "desmarcar" tire só a parte de saída; (d) encargos só na parte de serviço (multa sobre multa não se cobra); (e) a janela de reconsulta de 30 s e a de reenvio de 30 min vivem na memória do processo da API (uma instância) — se a API um dia rodar em mais de um processo, migrar para coluna.

**Tipos usados entre tarefas (conferidos):** `FaturaDoAnexo.chave` (Tasks 1, 3, 5, 10, 18); `BaseMontada.contatoAlterado/contatoDoErp` (10 → 11); `signatariosGravaveis`/`registrarEventoDaConfissao` (11 → 12, 15); `ConfissaoAssinadaViva` (7 → 16); `SeloDaConfissao` (16 → 17, 18); `EstadoDaAssinatura.chatDisponivel` (1, 10 → 18, 19); `PatchDeConfissao.zapsignSandbox/reconciliarEm` (7 → 11, 12); `confissoesParaReconciliar(agora, number | null)` (7 → 15); `ErroDeConfissao.http/detalhes` (5 → 13, 14).
