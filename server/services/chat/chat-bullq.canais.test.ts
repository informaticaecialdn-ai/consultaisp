import { describe, expect, it, vi } from 'vitest';
vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
import { ChatBullqClient } from './chat-bullq.client';

function setup(payload: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const auth = url.endsWith('/platform/organizations/org-a/token');
    return new Response(JSON.stringify({ data: auth ? { accessToken: 'fixture-session', refreshToken: 'fixture-refresh' } : payload }), { status: auth ? 200 : status });
  };
  return { client: new ChatBullqClient({ baseUrl: 'https://chat.example.test', platformKey: 'fixture-platform', fetchImpl }), calls };
}

describe('ChatBullQ: canais', () => {
  it('normaliza success do upstream sem transportar configuração do canal', async () => {
    const { client } = setup({ success: true, status: 'connected', data: { token: 'fixture-secret' } });
    expect(await client.testarCanal('org-a', 'ch-a')).toEqual({ ok: true, valor: { ok: true } });
  });

  it('transforma reprovação do provider em mensagem estável e segura', async () => {
    const { client } = setup({ success: false, error: 'fixture-secret' });
    const result = await client.testarCanal('org-a', 'ch-a');
    expect(result.ok && result.valor.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
  });

  it('redige mensagens de falha HTTP no teste de credencial', async () => {
    const { client } = setup({ message: 'fixture-secret' }, 403);
    const result = await client.testarCanal('org-a', 'ch-a');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
  });

  it('consulta capabilities sem mandar token de instância', async () => {
    const payload = { whatsappUnofficial: true, instanceConnect: true, instanceStatus: true, provider: 'ZAPPFY' };
    const { client, calls } = setup(payload);
    expect(await client.capacidadesDosCanais('org-a')).toEqual({ ok: true, valor: payload });
    expect(calls.at(-1)?.url).toBe('https://chat.example.test/api/v1/channels/capabilities');
    expect(calls.at(-1)?.init?.body).toBeUndefined();
  });

  it('solicita QR sem phone e estado no canal autenticado', async () => {
    const payload = { provider: 'ZAPPFY', status: 'connecting', connected: false, loggedIn: false, phone: null, qrCode: null, pairCode: null };
    const { client, calls } = setup(payload);
    expect(await client.conectarWhatsapp('org-a', 'ch-a')).toEqual({ ok: true, valor: payload });
    expect(calls.at(-1)?.url).toBe('https://chat.example.test/api/v1/channels/ch-a/connect');
    expect(calls.at(-1)?.init?.body).toBe('{}');
    expect(await client.estadoDaConexaoWhatsapp('org-a', 'ch-a')).toEqual({ ok: true, valor: payload });
    expect(calls.at(-1)?.url).toBe('https://chat.example.test/api/v1/channels/ch-a/connection-status');
    expect(calls.at(-1)?.init?.method).toBe('GET');
  });

  it('pareamento envia apenas phone', async () => {
    const { client, calls } = setup({});
    await client.conectarWhatsapp('org-a', 'ch-a', '5511999999999');
    expect(calls.at(-1)?.init?.body).toBe(JSON.stringify({ phone: '5511999999999' }));
  });

  it('cria os três providers no adapter e campos de credenciais certos', async () => {
    const { client, calls } = setup({ id: 'ch-a' });
    await client.criarCanalWhatsapp('org-a', { provider: 'ZAPPFY', nome: 'Cobrança', token: 'fixture-zappfy' });
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toMatchObject({ type: 'WHATSAPP_ZAPPFY', config: { provider: 'ZAPPFY', token: 'fixture-zappfy' } });
    await client.criarCanalWhatsapp('org-a', { provider: 'UAZAPI', nome: 'Cobrança', token: 'fixture-uazapi', baseUrl: 'https://tenant.uazapi.com' });
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toMatchObject({ type: 'WHATSAPP_ZAPPFY', config: { provider: 'UAZAPI', baseUrl: 'https://tenant.uazapi.com' } });
    await client.criarCanalWhatsapp('org-a', { provider: 'DATAFY', nome: 'Cobrança', token: 'fixture-datafy', phoneNumberId: '12345', webhookSecret: 'whsec_fixture' });
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toMatchObject({ type: 'WHATSAPP_OFFICIAL', webhookSecret: 'whsec_fixture', config: { provider: 'DATAFY', accessToken: 'fixture-datafy', phoneNumberId: '12345' } });
  });

  it('encaminha template ao início real e não troca o conteúdo por texto livre', async () => {
    const { client, calls } = setup({ id: 'msg-a', conversationId: 'conv-a' });
    const template = { name: 'hello', language: { code: 'pt_BR' }, components: [] };
    await client.iniciarConversa('org-a', { canalId: 'ch-a', telefone: '5511999999999', texto: 'não enviar', template });
    expect(calls.at(-1)?.url).toBe('https://chat.example.test/api/v1/conversations');
    expect(JSON.parse(String(calls.at(-1)?.init?.body)).message).toEqual({ type: 'TEMPLATE', content: template });
  });

  it('normaliza o catálogo aprovado da API de canais para o painel', async () => {
    const { client } = setup([{ name: 'hello', language: 'pt_BR', components: [] }]);
    expect(await client.listarTemplatesWhatsapp('org-a', 'ch-a')).toEqual({ ok: true, valor: { data: [{ name: 'hello', language: 'pt_BR', components: [], status: 'APPROVED' }] } });
  });
});
