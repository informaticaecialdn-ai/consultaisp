/**
 * Validação do webhook de alerta de fuga que o PROVEDOR cadastra
 * (`providers.proactive_alert_webhook_url`) — a ÚNICA função para isso.
 *
 * Revisão final de segurança antes da demonstração pública: a validação
 * nasceu presa ao fecho de `provider.routes.ts` (`PUT/POST .../alert-settings*`),
 * que NÃO TEM CONSUMIDOR no client. A tela de verdade — aba Anti-Fraude do
 * Painel do Provedor, `PUT /api/anti-fraud/rules`
 * (`server/routes/antifraude.routes.ts`) — gravava o MESMO campo por um
 * schema Zod que admitia `http://` e qualquer host, sem checagem nenhuma de
 * endereço interno. E mesmo com todo escritor validando, linhas GRAVADAS
 * ANTES desta função existir continuam na base — por isso o DISPARO
 * (`server/services/proactive-alert.service.ts`) revalida na hora de chamar,
 * e não confia em quem gravou.
 *
 * A regra: protege a COLUNA, não a rota. Todo escritor de
 * `proactiveAlertWebhookUrl` e o único leitor que faz `fetch()` nela chamam
 * `validarWebhookExterno` — nunca reimplementam a checagem.
 *
 * `ehEnderecoPrivado` (`shared/chat-console.ts`, reusada pela allowlist do
 * console de agentes) só julga a FORMA do hostname — não resolve nome
 * nenhum. Um hostname público que RESOLVE para loopback
 * (`https://127.0.0.1.nip.io/`, serviço público de DNS que resolve qualquer
 * IP embutido no próprio nome) passa por ela sem ser pego, porque
 * "127.0.0.1.nip.io" não É um endereço IP nem cai em nenhum dos padrões que
 * ela reconhece. Por isso esta função RESOLVE o host e confere TODOS os
 * endereços devolvidos — não só o primeiro, e não só por padrão de texto.
 *
 * ATENÇÃO — os ENDEREÇOS resolvidos NUNCA passam por `ehEnderecoPrivado`
 * (rodada de correção, revisão de segurança #3): aquela função foi escrita
 * para julgar um HOSTNAME, e a terceira linha dela é, em espírito,
 * `if (host.includes(":")) return true // literal IPv6` — uma regra correta
 * para "isto parece um endereço, não um nome" quando a entrada É um
 * hostname, mas catastrófica quando a entrada JÁ é um endereço resolvido:
 * TODO IPv6 contém ":", então ela marcava cada `2606:4700::1111` (Cloudflare,
 * público) como privado, e `https://webhook.site/x` e qualquer host em CDN
 * dual-stack passava a ser recusado sempre que o DNS respondesse AAAA — o que
 * a VPS (dual-stack) faz o tempo todo. `enderecoIpEhPrivado`, abaixo, é a
 * função certa para um ENDEREÇO já resolvido: IPv4 (as mesmas faixas de
 * `ehEnderecoPrivado`, mais benchmark RFC 2544 e multicast) e IPv6 de
 * verdade (loopback, indeterminado, unique-local, link-local, o prefixo
 * NAT64 e o mapeamento IPv4-em-IPv6, desembrulhado e testado como IPv4).
 * IPv6 unicast global PASSA — não é IPv6 que é suspeito, é faixa especial.
 * `ehEnderecoPrivado` continua exatamente como estava: a allowlist do
 * console de agentes (`shared/chat-console.ts`) depende do comportamento
 * dela contra HOSTNAME, e não deve mudar aqui.
 *
 * LIMITE CONHECIDO (documentado, não fechado): resolver aqui e resolver no
 * `fetch()` logo depois são DUAS consultas de DNS separadas. Uma zona
 * controlada pelo atacante com TTL zero pode responder um endereço público
 * nesta validação e um endereço privado na chamada real, segundos depois —
 * o clássico DNS rebinding. Fechar isso de verdade exige FIXAR o endereço
 * validado (resolver uma vez e fazer o `fetch()` contra aquele IP, com o
 * hostname original só no cabeçalho TLS/Host) em vez de resolver de novo.
 * Não é o que este módulo faz hoje — quem usa esta função deve saber que a
 * garantia é "não resolvia para privado no INSTANTE da validação", não "nunca
 * vai resolver para privado".
 *
 * REVISÃO DE SEGURANÇA 4 (última rodada antes da demonstração pública):
 * medidas quatro faixas passando que não deveriam — `::/96` (IPv4-compatível,
 * ex.: `::7f00:1` = 127.0.0.1), `ff00::/8` (multicast IPv6, faltava para
 * espelhar o 224.0.0.0/4 do lado IPv4), `240.0.0.0/4` (reservado/"classe E")
 * e `255.255.255.255` (broadcast — caso particular de 240/4). As quatro estão
 * fechadas em `ipv4EhPrivado`/`ipv6EhPrivado`. Duas outras medidas na mesma
 * rodada ficam CONHECIDAS E ABERTAS, de propósito (fora do escopo pedido):
 * 6to4 (`2002::/16`, encapsula um IPv4 arbitrário no próprio endereço — o
 * IPv4 embutido não é validado hoje) e Teredo (`2001:0::/32`, mesma ideia,
 * ofuscada por XOR). Quem endurecer essas duas depois pode seguir o mesmo
 * molde do `::/96`/mapeado: desembrulhar e delegar para `ipv4EhPrivado`.
 */
import dns from "node:dns";
import { ehEnderecoPrivado } from "@shared/chat-console";

/**
 * Uma mensagem só, para toda recusa de FORMATO/DESTINO.
 *
 * Distinguir "não é https" de "é endereço interno" de "não resolve" não
 * vaza nada sobre um SERVIDOR de terceiro — o provedor só está lendo de
 * volta o que ele mesmo digitou. O que não pode vazar é o resultado da
 * TENTATIVA DE CONEXÃO (ver `MOTIVO_TESTE_FALHOU` mais abaixo, usado só na
 * rota de teste) — ali sim `error.message` distingue porta fechada de TLS
 * ruim, e vira oráculo de porta contra a rede interna da VPS.
 */
export const MOTIVO_WEBHOOK_INVALIDO =
  "Endereço inválido ou não permitido. Use uma URL pública, começando com https://.";

/** A mesma mensagem fixa para toda falha de CONEXÃO no teste manual — nunca `error.message` cru (item 2). */
export const MOTIVO_TESTE_FALHOU = "Não foi possível conectar a esse endereço.";

/**
 * O motivo de verdade, para LOG e suporte — nunca para o provedor (a tela
 * sempre mostra `MOTIVO_WEBHOOK_INVALIDO`, que não distingue nada).
 *
 * Nasceu porque o log do disparo (`enviarWebhookDoAlerta`,
 * proactive-alert.service.ts) listava "endereço interno, http:// ou não
 * resolve" pra TODA recusa — três causas possíveis, nunca a real. Quem lê o
 * log precisa saber QUAL das seis aconteceu, não adivinhar.
 */
export type CausaWebhookInvalido =
  | "url_invalida"
  | "protocolo_invalido"
  | "endereco_privado"
  | "dns_nao_resolve"
  | "dns_vazio"
  | "endereco_resolvido_privado";

export type VeredictoWebhook = { ok: true } | { ok: false; motivo: string; causa: CausaWebhookInvalido };

function recusa(causa: CausaWebhookInvalido): VeredictoWebhook {
  return { ok: false, motivo: MOTIVO_WEBHOOK_INVALIDO, causa };
}

/**
 * `dns.lookup` do Node aceita literal IP e devolve na hora, sem rede
 * nenhuma (é o `getaddrinfo` do SO reconhecendo um endereço numérico) — por
 * isso chamar para 127.0.0.1/169.254.169.254/etc. não bate em rede, só
 * confirma o que `ehEnderecoPrivado` já teria recusado antes de chegar aqui.
 */
function resolverTodosOsEnderecos(host: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dns.lookup(host, { all: true, verbatim: true }, (err, enderecos) => {
      if (err) return reject(err);
      resolve(enderecos.map((e) => e.address));
    });
  });
}

/** Um octeto (0-255) em texto — sem isto "999" ou "1.2.3" passariam pelo `Number()`. */
function octetoIpv4Valido(texto: string): number | null {
  if (!/^\d{1,3}$/.test(texto)) return null;
  const n = Number(texto);
  return n <= 255 ? n : null;
}

/**
 * IPv4 privado/não-roteável — as mesmas faixas de `ehEnderecoPrivado`
 * (10/8, 127/8, 0/8, 192.168/16, 172.16/12, 169.254/16, 100.64/10, o CGNAT),
 * MAIS as duas faixas que a revisão mediu como passando (item 7): 198.18.0.0/15
 * (bancada de benchmark da RFC 2544 — nunca é destino de produção de
 * ninguém) e 224.0.0.0/4 (multicast — não é webhook de provedor nenhum),
 * MAIS 240.0.0.0/4 (revisão de segurança 4: reservado/"classe E", nunca
 * roteado) — faixa que também cobre 255.255.255.255, o broadcast limitado,
 * como caso particular (255 >= 240). Forma inválida recusa — nunca aceita
 * por omissão.
 */
function ipv4EhPrivado(endereco: string): boolean {
  const partes = endereco.split(".");
  if (partes.length !== 4) return true;
  const octetos = partes.map(octetoIpv4Valido);
  if (octetos.some((o) => o === null)) return true;
  const [a, b] = octetos as number[];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // RFC 2544 — bancada de benchmark
  if (a >= 224 && a <= 239) return true; // multicast (224.0.0.0/4)
  if (a >= 240) return true; // 240.0.0.0/4 reservado ("classe E") + 255.255.255.255 (broadcast)
  return false;
}

/**
 * Expande um endereço IPv6 (qualquer forma — comprimida com "::", com cauda
 * IPv4 embutida, com escopo "%eth0") em 8 grupos de 16 bits. `null` para
 * qualquer forma que não parseia — o chamador trata isso como privado, nunca
 * como "não sei, deixa passar".
 */
function gruposIpv6(enderecoOriginal: string): number[] | null {
  const endereco = enderecoOriginal.split("%")[0]; // remove escopo de link, se houver
  if (!endereco) return null;

  const metades = endereco.split("::");
  if (metades.length > 2) return null; // "::" só pode aparecer uma vez

  function tokenParaGrupos(token: string): number[] | null {
    if (token === "") return [];
    const pedacos = token.split(":");
    const grupos: number[] = [];
    for (let i = 0; i < pedacos.length; i++) {
      const pedaco = pedacos[i];
      const ehUltimo = i === pedacos.length - 1;
      if (ehUltimo && pedaco.includes(".")) {
        // Cauda IPv4 embutida (::ffff:192.168.1.1, 64:ff9b::c000:0201, etc.)
        const octetosTexto = pedaco.split(".");
        if (octetosTexto.length !== 4) return null;
        const octetos = octetosTexto.map(octetoIpv4Valido);
        if (octetos.some((o) => o === null)) return null;
        const [o1, o2, o3, o4] = octetos as number[];
        grupos.push((o1 << 8) | o2, (o3 << 8) | o4);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(pedaco)) return null;
      grupos.push(parseInt(pedaco, 16));
    }
    return grupos;
  }

  if (metades.length === 1) {
    const grupos = tokenParaGrupos(metades[0]);
    if (!grupos || grupos.length !== 8) return null;
    return grupos;
  }

  const esquerda = tokenParaGrupos(metades[0]);
  const direita = tokenParaGrupos(metades[1]);
  if (!esquerda || !direita) return null;
  const faltando = 8 - esquerda.length - direita.length;
  if (faltando < 0) return null; // "::" precisa comprimir AO MENOS um grupo
  return [...esquerda, ...new Array(faltando).fill(0), ...direita];
}

/**
 * IPv6 privado/não-roteável, pelas faixas pedidas na revisão (item 1):
 * `::1` (loopback), `::` (indeterminado), `fc00::/7` (unique-local),
 * `fe80::/10` (link-local), `64:ff9b::/96` (prefixo NAT64, RFC 6052) e
 * `::ffff:a.b.c.d` (mapeado — desembrulha os últimos 32 bits e testa como
 * IPv4), MAIS duas faixas da revisão de segurança 4:
 * - `ff00::/8` — multicast IPv6. Sem isto a checagem ficava ASSIMÉTRICA: o
 *   lado IPv4 já recusa multicast (224.0.0.0/4, acima) e o lado IPv6 deixava
 *   passar.
 * - `::/96` — IPv4-compatível (RFC 4291, forma antiga e obsoleta, MAS ainda
 *   parseável): primeiros 96 bits zero, últimos 32 bits são um IPv4 embutido
 *   sem o `ffff` do mapeamento moderno. `::7f00:1` (= 127.0.0.1) e
 *   `::127.0.0.1` passavam batido antes: não caíam em "::" (nem todos os 8
 *   grupos são zero) nem em "::1" (o grupo 6 não é zero), e o teste de
 *   mapeado exige `grupos[5] === 0xffff`, que aqui é `0`. Generaliza "::" e
 *   "::1" como casos particulares (0.0.0.0 e 0.0.0.1 embutidos, ambos no
 *   0.0.0.0/8 que `ipv4EhPrivado` já recusa) — mantidos como testes
 *   explícitos abaixo só por clareza/compatibilidade com quem já lia este
 *   código.
 *
 * 6to4 (`2002::/16`) e Teredo (`2001:0::/32`) continuam FORA desta lista —
 * medidos como passando, não fechados nesta rodada (fora do escopo pedido).
 *
 * Fora dessas faixas é unicast global e PASSA — é exatamente o que
 * `ehEnderecoPrivado` fazia errado ao tratar qualquer ":" como suspeito.
 */
function ipv6EhPrivado(endereco: string): boolean {
  const grupos = gruposIpv6(endereco);
  if (!grupos) return true;

  if (grupos.every((g) => g === 0)) return true; // "::"
  if (grupos.slice(0, 7).every((g) => g === 0) && grupos[6] === 0 && grupos[7] === 1) return true; // "::1"

  if ((grupos[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((grupos[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((grupos[0] & 0xff00) === 0xff00) return true; // ff00::/8 — multicast

  // ::/96 — IPv4-compatível (RFC 4291, obsoleta): primeiros 96 bits zero.
  // Desembrulha os últimos 32 bits e testa como IPv4 (mesmo tratamento do
  // mapeado, abaixo, só que sem exigir o "ffff" no grupo 5).
  if (grupos.slice(0, 6).every((g) => g === 0)) {
    const a = (grupos[6] >> 8) & 0xff;
    const b = grupos[6] & 0xff;
    const c = (grupos[7] >> 8) & 0xff;
    const d = grupos[7] & 0xff;
    return ipv4EhPrivado(`${a}.${b}.${c}.${d}`);
  }

  // 64:ff9b::/96 — NAT64 (RFC 6052): 96 bits fixos, os últimos 32 são o IPv4 embutido.
  if (grupos[0] === 0x0064 && grupos[1] === 0xff9b && grupos[2] === 0 && grupos[3] === 0 && grupos[4] === 0 && grupos[5] === 0) {
    return true;
  }

  // ::ffff:a.b.c.d — mapeado: desembrulha e testa o IPv4 real por baixo.
  if (grupos[0] === 0 && grupos[1] === 0 && grupos[2] === 0 && grupos[3] === 0 && grupos[4] === 0 && grupos[5] === 0xffff) {
    const a = (grupos[6] >> 8) & 0xff;
    const b = grupos[6] & 0xff;
    const c = (grupos[7] >> 8) & 0xff;
    const d = grupos[7] & 0xff;
    return ipv4EhPrivado(`${a}.${b}.${c}.${d}`);
  }

  return false;
}

/**
 * O ENDEREÇO (nunca hostname) que `dns.lookup` devolveu é privado/não-roteável?
 *
 * Distinta de `ehEnderecoPrivado` de propósito — ver o cabeçalho do módulo.
 * Despacha por IPv4 (contém "." e nunca ":") ou IPv6 (contém ":").
 */
export function enderecoIpEhPrivado(endereco: string): boolean {
  return endereco.includes(":") ? ipv6EhPrivado(endereco) : ipv4EhPrivado(endereco);
}

/**
 * https + host publicado (forma) + host RESOLVIDO (todos os endereços).
 *
 * Chamada em TODO escritor da coluna (`PUT /api/anti-fraud/rules`,
 * `PUT /api/providers/alert-settings`, `POST .../test-webhook`) e no
 * DISPARO (`proactive-alert.service.ts`), antes de qualquer `fetch()` contra
 * o valor que o provedor digitou.
 */
export async function validarWebhookExterno(url: string): Promise<VeredictoWebhook> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return recusa("url_invalida");
  }
  if (u.protocol !== "https:") {
    return recusa("protocolo_invalido");
  }

  const host = u.hostname.toLowerCase();
  if (ehEnderecoPrivado(host)) {
    return recusa("endereco_privado");
  }

  let enderecos: string[];
  try {
    enderecos = await resolverTodosOsEnderecos(host);
  } catch {
    // Não resolve (ENOTFOUND) ou o resolvedor falhou: nem um destino real
    // temos para chamar. Recusa — nunca "ok" por falta de prova.
    return recusa("dns_nao_resolve");
  }
  if (enderecos.length === 0) {
    return recusa("dns_vazio");
  }
  if (enderecos.some((endereco) => enderecoIpEhPrivado(endereco))) {
    return recusa("endereco_resolvido_privado");
  }

  return { ok: true };
}
