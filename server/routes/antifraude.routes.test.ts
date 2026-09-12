import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { maskAlertForProvider } from '../utils/mask-alert';

// A chave dos codigos e lazy e vem do ambiente — o teste nao depende do .env.
beforeAll(() => { process.env.PARTNER_CODE_SECRET = 'p'.repeat(64); });

/**
 * SSRF no webhook de alerta de fuga, atraves da ROTA COM TELA — revisão final
 * de segurança antes da demonstração pública (item 1).
 *
 * A rodada anterior instalou a validação em `PUT /api/providers/alert-settings`
 * e `POST .../test-webhook` (server/routes/provider.routes.ts) — duas rotas
 * SEM consumidor no client (grep por "alert-settings"/"test-webhook" só acha
 * o próprio arquivo de rota, o teste dele e um comentário). A tela de
 * verdade — aba Anti-Fraude do Painel do Provedor — salva pelo MESMO campo
 * (`providers.proactive_alert_webhook_url`) por `PUT /api/anti-fraud/rules`,
 * que continuava aceitando `http://` e qualquer host, inclusive interno.
 *
 * `requireAuth` de verdade roda aqui (nada de mock de `../auth`), no mesmo
 * molde de `host-guard.test.ts`: a prova de host mora DENTRO dele, e uma
 * cópia simplificada não provaria a rota de produção.
 */
vi.hoisted(() => {
  process.env.SESSION_SECRET ||= 'segredo-de-teste-sem-nenhum-valor-real';
});
vi.mock('express-session', () => ({ default: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('connect-pg-simple', () => ({ default: () => class MockPgStore {} }));
vi.mock('../db', () => ({ pool: {}, db: {} }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const storageMock = vi.hoisted(() => ({
  getAntiFraudRules: vi.fn(async (): Promise<any[]> => []),
  // `status: "active"` importa: `requireProvider` chama `storage.getProvider`
  // (via `provedorSuspenso`, server/auth.ts) e trata QUALQUER status que nao
  // seja "active" como suspenso — sem o campo, as quatro rotas abaixo
  // cairiam num 403 de "provedor suspenso" antes de chegar na validacao que
  // este bloco quer provar.
  getProvider: vi.fn(async (): Promise<any> => ({ id: 7, contactEmail: null, status: 'active' })),
  getUsersByProvider: vi.fn(async (): Promise<any[]> => []),
  saveAntiFraudRules: vi.fn(async () => undefined),
  updateProviderProfile: vi.fn(async () => undefined),
}));
vi.mock('../storage', () => ({ storage: storageMock }));

let servidorSsrf: Server;
let baseSsrf: string;
let sessaoSsrf: Record<string, unknown>;
const HOST_SSRF = 'nslink.consultaisp.com.br';

beforeAll(async () => {
  const { registerAntiFraudeRoutes } = await import('./antifraude.routes');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessaoSsrf;
    Object.defineProperty(req, 'hostname', { value: HOST_SSRF, configurable: true });
    next();
  });
  app.use(registerAntiFraudeRoutes());
  await new Promise<void>(resolve => {
    servidorSsrf = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = servidorSsrf.address();
  baseSsrf = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
});

afterAll(async () => {
  await new Promise<void>(resolve => servidorSsrf.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getAntiFraudRules.mockResolvedValue([]);
  storageMock.getProvider.mockResolvedValue({ id: 7, contactEmail: null, status: 'active' });
  storageMock.getUsersByProvider.mockResolvedValue([]);
  sessaoSsrf = { userId: 1, providerId: 7, role: 'admin', hostLogin: HOST_SSRF };
});

/** Um conjunto de regras COMPLETO e válido — o schema exige as quatro, sem default. */
const REGRAS_VALIDAS = {
  combinacao: 'qualquer' as const,
  ativo_inadimplente: { ativo: true, valorMinimo: 20, diasMinimo: 1 },
  contrato_novo: { ativo: false, diasMaximo: 90 },
  consultas_repetidas: { ativo: false, provedoresMinimos: 2 },
  ativo_qualquer: { ativo: false },
};

const salvarCanais = (webhookUrl: string) =>
  fetch(`${baseSsrf}/api/anti-fraud/rules`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      regras: REGRAS_VALIDAS,
      canais: { proactiveAlertsEnabled: true, webhookUrl },
    }),
  });

describe('PUT /api/anti-fraud/rules — SSRF no webhook (a tela de verdade)', () => {
  it('recusa endereco interno (127.0.0.1) e nao grava regras nem canais', async () => {
    const res = await salvarCanais('http://127.0.0.1:8080/x');

    expect(res.status).toBe(400);
    expect(storageMock.saveAntiFraudRules).not.toHaveBeenCalled();
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it('recusa host externo em http:// — o schema antigo admitia isso de proposito, e essa era a falha', async () => {
    const res = await salvarCanais('http://webhook.example.com/x');

    expect(res.status).toBe(400);
    expect(storageMock.saveAntiFraudRules).not.toHaveBeenCalled();
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it('recusa o endpoint de metadados de nuvem', async () => {
    const res = await salvarCanais('https://169.254.169.254/latest/meta-data/');

    expect(res.status).toBe(400);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });

  it('aceita e grava um webhook https:// legitimo (IP literal publico — sem depender de DNS de verdade)', async () => {
    const res = await salvarCanais('https://203.0.113.10/abc123');

    expect(res.status).toBe(200);
    expect(storageMock.updateProviderProfile).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ proactiveAlertWebhookUrl: 'https://203.0.113.10/abc123' }),
    );
  });

  it('operador comum (nao admin) recebe 403 — nada e validado nem gravado', async () => {
    sessaoSsrf = { userId: 1, providerId: 7, role: 'user', hostLogin: HOST_SSRF };

    const res = await salvarCanais('https://203.0.113.10/abc123');

    expect(res.status).toBe(403);
    expect(storageMock.updateProviderProfile).not.toHaveBeenCalled();
  });
});

const PROVIDER_A = 1;
const PROVIDER_B = 2;

function makeAlert(overrides: Record<string, any> = {}) {
  return {
    id: 100,
    providerId: PROVIDER_A,
    customerId: 10,
    consultingProviderId: PROVIDER_B,
    consultingProviderName: "ISP Beta Telecom",
    customerName: "Maria Silva Santos",
    customerCpfCnpj: "12345678901",
    customerProviderId: PROVIDER_A,
    type: "migrador_serial",
    severity: "high",
    message: "test alert",
    ...overrides,
  };
}

describe('maskAlertForProvider', () => {
  describe('own-customer alerts (customerProviderId === currentProviderId)', () => {
    it('returns full customerName when customer belongs to requesting provider', () => {
      const alert = makeAlert({ customerProviderId: PROVIDER_A });
      const result = maskAlertForProvider(alert, PROVIDER_A);
      expect(result.customerName).toBe("Maria Silva Santos");
    });

    it('returns full customerCpfCnpj when customer belongs to requesting provider', () => {
      const alert = makeAlert({ customerProviderId: PROVIDER_A });
      const result = maskAlertForProvider(alert, PROVIDER_A);
      expect(result.customerCpfCnpj).toBe("12345678901");
    });
  });

  describe('cross-provider alerts (customerProviderId !== currentProviderId)', () => {
    it('masks customerName when customer does not belong to requesting provider', () => {
      const alert = makeAlert({ customerProviderId: PROVIDER_A });
      const result = maskAlertForProvider(alert, PROVIDER_B);
      expect(result.customerName).toBe("Maria ***");
      expect(result.customerName).not.toBe("Maria Silva Santos");
    });

    it('masks customerCpfCnpj when customer does not belong to requesting provider', () => {
      const alert = makeAlert({ customerProviderId: PROVIDER_A });
      const result = maskAlertForProvider(alert, PROVIDER_B);
      expect(result.customerCpfCnpj).not.toBe("12345678901");
      expect(result.customerCpfCnpj).toContain("***");
    });

    it('anonymizes consultingProviderName when not the requesting provider', () => {
      const alert = makeAlert({ consultingProviderId: PROVIDER_B });
      const result = maskAlertForProvider(alert, PROVIDER_A);
      expect(result.consultingProviderName).toMatch(/^Provedor Parceiro ISP-[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/);
      expect(result.consultingProviderName).not.toBe("ISP Beta Telecom");
    });

    it('preserves consultingProviderName when it IS the requesting provider', () => {
      const alert = makeAlert({ consultingProviderId: PROVIDER_B });
      const result = maskAlertForProvider(alert, PROVIDER_B);
      expect(result.consultingProviderName).toBe("ISP Beta Telecom");
    });
  });

  describe('edge cases', () => {
    it('handles null customerName gracefully', () => {
      const alert = makeAlert({ customerProviderId: PROVIDER_A, customerName: null });
      const result = maskAlertForProvider(alert, PROVIDER_B);
      expect(result.customerName).toBeNull();
    });

    it('handles null customerCpfCnpj gracefully', () => {
      const alert = makeAlert({ customerProviderId: PROVIDER_A, customerCpfCnpj: null });
      const result = maskAlertForProvider(alert, PROVIDER_B);
      expect(result.customerCpfCnpj).toBeNull();
    });

    it('uses customerProviderId for ownership, not alert.providerId', () => {
      // Scenario: alert.providerId differs from customerProviderId (e.g. customer transferred)
      const alert = makeAlert({
        providerId: PROVIDER_A,
        customerProviderId: PROVIDER_B, // customer now owned by B
      });
      // Provider B requests: should see unmasked (customer is theirs)
      const resultB = maskAlertForProvider(alert, PROVIDER_B);
      expect(resultB.customerName).toBe("Maria Silva Santos");
      expect(resultB.customerCpfCnpj).toBe("12345678901");

      // Provider A requests: should see masked (customer no longer theirs)
      const resultA = maskAlertForProvider(alert, PROVIDER_A);
      expect(resultA.customerName).toBe("Maria ***");
      expect(resultA.customerCpfCnpj).not.toBe("12345678901");
    });
  });
});
describe('codigo de parceiro pareado nos alertas', () => {
  const DISPLAY = /^Provedor Parceiro ISP-[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/;

  it('o id cru do consulente nao sai para outro tenant', () => {
    const result = maskAlertForProvider(makeAlert({ consultingProviderId: PROVIDER_B }), PROVIDER_A);
    expect(result.consultingProviderId).toBeNull();
    expect(result.consultingProviderName).toMatch(DISPLAY);
  });

  it('quem consultou ve o proprio id e o proprio nome', () => {
    const result = maskAlertForProvider(makeAlert({ consultingProviderId: PROVIDER_B }), PROVIDER_B);
    expect(result.consultingProviderId).toBe(PROVIDER_B);
    expect(result.consultingProviderName).toBe("ISP Beta Telecom");
  });

  it('donos diferentes veem codigos diferentes para o mesmo consulente; o mesmo dono ve sempre o mesmo', () => {
    const a1 = maskAlertForProvider(makeAlert({ id: 1 }), PROVIDER_A).consultingProviderName;
    const a2 = maskAlertForProvider(makeAlert({ id: 2, customerName: "Outro Cliente" }), PROVIDER_A).consultingProviderName;
    const c = maskAlertForProvider(makeAlert(), 3).consultingProviderName;
    expect(a1).toBe(a2);
    expect(a1).not.toBe(c);
  });

  it('o nome do consulente nao entra no codigo', () => {
    const a = maskAlertForProvider(makeAlert({ consultingProviderName: "ISP Beta Telecom" }), PROVIDER_A).consultingProviderName;
    const b = maskAlertForProvider(makeAlert({ consultingProviderName: "Vertical Fibra" }), PROVIDER_A).consultingProviderName;
    expect(a).toBe(b);
  });

  it('sem id do consulente, rotulo fixo — nunca hash do nome', () => {
    const result = maskAlertForProvider(makeAlert({ consultingProviderId: null }), PROVIDER_A);
    expect(result.consultingProviderName).toBe("Provedor da rede");
    expect(result.consultingProviderId).toBeNull();
  });
});
