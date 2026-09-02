import { describe, it, expect, beforeAll } from 'vitest';

// Set the salt before importing modules that read it at import time
beforeAll(() => {
  process.env.NETWORK_CPF_SALT = 'a'.repeat(64); // 64-char test salt
});

describe('cpf-hash', () => {
  it('produces consistent hash for same CPF with different formatting', async () => {
    const { hashCPFForNetwork } = await import('./cpf-hash');
    const h1 = hashCPFForNetwork('119.984.739-96');
    const h2 = hashCPFForNetwork('11998473996');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('produces different hashes for different CPFs', async () => {
    const { hashCPFForNetwork } = await import('./cpf-hash');
    const h1 = hashCPFForNetwork('11998473996');
    const h2 = hashCPFForNetwork('12345678901');
    expect(h1).not.toBe(h2);
  });

  it('throws on invalid CPF length', async () => {
    const { hashCPFForNetwork } = await import('./cpf-hash');
    expect(() => hashCPFForNetwork('12345')).toThrow('11 ou 14 digitos');
  });

  it('handles CNPJ (14 digits)', async () => {
    const { hashCPFForNetwork } = await import('./cpf-hash');
    const h = hashCPFForNetwork('12.345.678/0001-90');
    expect(h).toHaveLength(64);
  });

  it('cpfMatchesNetworkHash returns true for matching CPF', async () => {
    const { hashCPFForNetwork, cpfMatchesNetworkHash } = await import('./cpf-hash');
    const hash = hashCPFForNetwork('11998473996');
    expect(cpfMatchesNetworkHash('119.984.739-96', hash)).toBe(true);
    expect(cpfMatchesNetworkHash('12345678901', hash)).toBe(false);
  });
});

describe('address-hash', () => {
  it('produces consistent hash for same address with different CEP formatting', async () => {
    const { hashAddressForNetwork } = await import('./address-hash');
    const h1 = hashAddressForNetwork('86085-123', '452');
    const h2 = hashAddressForNetwork('86085123', '452');
    const h3 = hashAddressForNetwork('86085123', ' 452 ');
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });

  it('produces different hashes for different numbers', async () => {
    const { hashAddressForNetwork } = await import('./address-hash');
    const h1 = hashAddressForNetwork('86085123', '452');
    const h2 = hashAddressForNetwork('86085123', '453');
    expect(h1).not.toBe(h2);
  });

  it('produces different hash with complement', async () => {
    const { hashAddressForNetwork } = await import('./address-hash');
    const h1 = hashAddressForNetwork('86085123', '452');
    const h2 = hashAddressForNetwork('86085123', '452', 'Ap3');
    expect(h1).not.toBe(h2);
  });

  it('same CEP different numbers produce different hashes (small city scenario)', async () => {
    const { hashAddressForNetwork } = await import('./address-hash');
    const h1 = hashAddressForNetwork('86400000', '100');
    const h2 = hashAddressForNetwork('86400000', '200');
    expect(h1).not.toBe(h2);
  });

  it('throws on invalid CEP', async () => {
    const { hashAddressForNetwork } = await import('./address-hash');
    expect(() => hashAddressForNetwork('8608', '452')).toThrow('8 digitos');
  });

  it('throws on empty number', async () => {
    const { hashAddressForNetwork } = await import('./address-hash');
    expect(() => hashAddressForNetwork('86085123', '')).toThrow('obrigatorio');
  });
});

