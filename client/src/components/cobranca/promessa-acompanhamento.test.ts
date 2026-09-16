import { describe, expect, it } from "vitest";
import { inputDaPromessa } from "./DialogoContato";
describe("acompanhamento da promessa", () => {
  it("agenda a verificacao apenas depois do dia prometido", () => expect(inputDaPromessa("2026-09-15")).toBe("2026-09-16T09:00"));
  it("atravessa mes e ano", () => expect(inputDaPromessa("2026-12-31")).toBe("2027-01-01T09:00"));
  it("recusa data civil inexistente", () => expect(inputDaPromessa("2026-02-30")).toBe(""));
});
