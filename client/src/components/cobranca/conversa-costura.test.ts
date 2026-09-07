/**
 * A COSTURA do botão de conversa: o card escreve o link, a tela de conversas o lê.
 *
 * O botão nasceu inerte quando o provedor não tinha WhatsApp ligado — que é o
 * estado de TODO provedor em produção hoje (a integração está `provisionado`,
 * sem canal). O dono viu e disse: "a conversa não está ativa".
 *
 * A correção partiu o problema em dois: NAVEGAR sempre funciona, então o botão
 * é sempre um link; MANDAR MENSAGEM depende do canal, então quem explica o que
 * falta é a tela de conversas, que tem espaço para dizer e para apontar onde
 * resolver. Isso criou uma costura nova entre dois arquivos: o card escreve
 * `?caso=`, a tela lê `caso`. Um lado renomeando o parâmetro faria o botão
 * abrir a tela vazia, sem erro nenhum — o mesmo silêncio do envelope das
 * faturas em `detalhe-costura.test.ts`.
 *
 * O teste é sobre o TEXTO das duas fontes: o vitest deste projeto não monta
 * React (ver o `include` do vitest.config.ts), e `CardCaso.tsx` traz dnd-kit
 * junto.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const card = ler("./CardCaso.tsx");
const tela = ler("../../pages/operacional/chat.tsx");
const tipos = ler("./tipos.ts");

describe("o card escreve o link", () => {
  it("com conversa vai por `conversa`; sem conversa vai por `caso`, e a carteira vai junto", () => {
    const rota = card.slice(card.indexOf("export function rotaDaConversaDoCaso"), card.indexOf("const NUM ="));
    expect(rota).toContain('p.set("conversa", item.chat.conversationId)');
    expect(rota).toContain('p.set("caso", String(item.id))');
    expect(rota).toContain('p.set("carteira", item.carteira)');
    expect(rota).toContain("${ROTA_CHAT_COBRANCA}?${p}");
    expect(card).toContain('ROTA_CHAT_COBRANCA = "/cobranca/chat"');
  });

  it("o botão é um link, sempre — nenhum ramo desabilitado", () => {
    expect(card).toContain("href={rotaDaConversaDoCaso(item)}");
    expect(card).not.toContain("acoes.onEnviarParaChat");
  });
});

describe("a tela lê o link", () => {
  it("lê os DOIS parâmetros que o card escreve", () => {
    expect(tela).toContain('new URLSearchParams(search).get("conversa")');
    expect(tela).toContain('new URLSearchParams(search).get("caso")');
  });

  it("`?caso=` só vale na cobrança: em equipamentos não há caso de cobrança", () => {
    expect(tela).toContain('origem === "cobranca" ? Number(new URLSearchParams(search).get("caso")) || null : null');
  });

  it("caso JÁ conversado troca o endereço pelo da conversa, sem empilhar histórico", () => {
    expect(tela).toContain("navegar(rotaChat(origem, conversaEncontrada, carteira), { replace: true })");
  });

  it("404 é a RESPOSTA (não há conversa), não erro — por isso a leitura é crua", () => {
    expect(tela).toContain("if (r.status === 404) return null;");
    expect(tela).toContain("enabled: casoDoLink !== null && !selecionada");
  });
});

describe("os dois lados falam do mesmo endereço", () => {
  it("a rota do caso vem do vocabulário, e não é digitada à mão", () => {
    expect(tipos).toContain("export const apiConversaDoCaso");
    expect(tela).toContain("apiConversaDoCaso(casoDoLink!)");
    expect(tela).toContain("queryKey: [apiConversaDoCaso(casoDoLink ?? 0)]");
  });
});

describe("sem conversa, a tela diz o que falta — e não mostra um controle morto", () => {
  it("o motivo é o estado REAL da integração, um de cada vez", () => {
    const f = tela.slice(tela.indexOf("export function motivoDeNaoIniciar"));
    expect(f).toContain("if (!integracao) return null;"); // carregando não acusa nada
    expect(f).toContain("if (!integracao.ligado) return MOTIVO_CHAT_DESLIGADO");
    expect(f).toContain("if (!integracao.canal) return MOTIVO_SEM_CANAL");
    expect(f).toMatch(/integracao\.status !== "ativo"/);
    expect(f).toContain("integracao.ultimoErro");
  });

  it("o botão de iniciar só liga com o chat pronto, e o motivo fica no title", () => {
    expect(tela).toContain("const pronto = chatProntoParaEnviar(integracao)");
    expect(tela).toContain("disabled={!pronto || iniciar.isPending}");
    expect(tela).toContain("title={impedimento ??");
  });

  it("com o chat ligado e sem número, a tela leva à aba onde se conecta o WhatsApp", () => {
    expect(tela).toContain('href="/painel-provedor?tab=chat"');
    expect(tela).toContain("integracao?.ligado &&");
  });

  it("iniciar é o MESMO envio do quadro, e abre a conversa que ele devolve", () => {
    expect(tela).toContain('apiRequest("POST", apiEnviarCasoParaChat(casoId), {})');
    expect(tela).toContain("if (r.conversationId) onAbrir(r.conversationId)");
  });

  it("em tela estreita o caso tem volta: a fila fica escondida abaixo de lg", () => {
    expect(tela).toContain("{(selecionada || casoDoLink) && (");
    expect(tela).toContain("Voltar às conversas");
  });
});

describe("a troca de endereço não vira laço", () => {
  /*
   * Depois da troca, o dado da conversa fica no cache do React Query, então
   * `conversaEncontrada` continua preenchido. Sem a guarda, um render que
   * mudasse a identidade de `navegar` navegaria de novo — em cima da tela que
   * o operador já está usando.
   */
  it("só navega enquanto o endereço ainda é o do caso", () => {
    expect(tela).toContain("if (!conversaEncontrada || !casoDoLink || selecionada) return;");
    expect(tela).toContain("[conversaEncontrada, casoDoLink, selecionada, origem, carteira, navegar]");
  });
});
