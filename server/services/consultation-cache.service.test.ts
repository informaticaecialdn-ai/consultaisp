import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TtlCache, ConsultationCache } from "./consultation-cache.service.js";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cache hit: returns set value", () => {
    const cache = new TtlCache<string>(60_000, 999_999);
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
    cache.destroy();
  });

  it("cache miss: returns undefined for unset key", () => {
    const cache = new TtlCache<string>(60_000, 999_999);
    expect(cache.get("nonexistent")).toBeUndefined();
    cache.destroy();
  });

  it("TTL expiry: returns undefined after TTL elapses", () => {
    const cache = new TtlCache<string>(1_000, 999_999);
    cache.set("key1", "value1");

    expect(cache.get("key1")).toBe("value1");

    vi.advanceTimersByTime(1_001);

    expect(cache.get("key1")).toBeUndefined();
    cache.destroy();
  });

  it("max size eviction: oldest entry evicted when full", () => {
    const cache = new TtlCache<string>(60_000, 999_999, 2);
    cache.set("first", "a");
    cache.set("second", "b");
    cache.set("third", "c"); // should evict "first"

    expect(cache.get("first")).toBeUndefined();
    expect(cache.get("second")).toBe("b");
    expect(cache.get("third")).toBe("c");
    cache.destroy();
  });

  it("destroy clears all entries and stops cleanup timer", () => {
    const cache = new TtlCache<string>(60_000, 999_999);
    cache.set("key1", "value1");
    cache.set("key2", "value2");

    cache.destroy();

    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});

describe("ConsultationCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("buildKey includes providerId: same CPF different providers get different keys", () => {
    const cache = new ConsultationCache();
    const keyA = cache.buildKey("12345678901", 1, "cpf");
    const keyB = cache.buildKey("12345678901", 2, "cpf");

    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain(":1:");
    expect(keyB).toContain(":2:");
    cache.destroy();
  });

  it("buildRegionalKey includes mesoregiao for regional isolation", () => {
    const cache = new ConsultationCache();
    const keyA = cache.buildRegionalKey("12345678901", "Triangulo Mineiro", "cpf");
    const keyB = cache.buildRegionalKey("12345678901", "Norte de Minas", "cpf");

    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain("Triangulo Mineiro");
    expect(keyB).toContain("Norte de Minas");
    cache.destroy();
  });

  it("cache isolation: different providers do not share cache entries for same CPF", () => {
    const cache = new ConsultationCache();
    const resultA = {
      result: { cpfCnpj: "12345678901", score: 80 } as any,
      consultation: { providerId: 1 } as any,
      cachedAt: Date.now(),
    };

    cache.setResult("12345678901", 1, "cpf", resultA);

    expect(cache.getResult("12345678901", 1, "cpf")).toEqual(resultA);
    expect(cache.getResult("12345678901", 2, "cpf")).toBeUndefined();
    cache.destroy();
  });
});
