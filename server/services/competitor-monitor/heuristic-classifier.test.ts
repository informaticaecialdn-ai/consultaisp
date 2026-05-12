/**
 * Spec 014 — Tests do heuristic classifier.
 */

import { describe, expect, it } from "vitest";
import {
  classifyHeuristic,
  extractDomain,
  needsLlmReview,
  partitionForLlm,
} from "./heuristic-classifier";
import type { SearchResult, TenantContext } from "./types";

const VERTICAL_FIBRA_CONTEXT: TenantContext = {
  cities: ["Londrina", "Ibiporã", "Cambé"],
  state: "PR",
  knownCompetitors: ["Sercomtel", "Copel Telecom"],
};

describe("extractDomain", () => {
  it("strips protocol and www", () => {
    expect(extractDomain("https://www.fibra-x.com.br/londrina")).toBe("fibra-x.com.br");
  });
  it("handles plain URL", () => {
    expect(extractDomain("http://provedor.com.br")).toBe("provedor.com.br");
  });
  it("returns raw for invalid", () => {
    expect(extractDomain("not-a-url")).toBe("not-a-url");
  });
});

describe("classifyHeuristic — noise domains", () => {
  it("Facebook = unrelated alta confidence", () => {
    const r = classifyHeuristic(
      {
        title: "Provedor Fibra X em Londrina",
        url: "https://facebook.com/fibrax",
        snippet: "Anúncio: fibra ótica chegou em Londrina",
      },
      VERTICAL_FIBRA_CONTEXT,
    );
    expect(r.classification).toBe("unrelated");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.needsLlmReview).toBe(false);
  });

  it("ReclameAqui = unrelated", () => {
    const r = classifyHeuristic(
      {
        title: "Reclamações Provedor X",
        url: "https://reclameaqui.com.br/empresa/provedor-x",
        snippet: "Avaliações de clientes",
      },
      VERTICAL_FIBRA_CONTEXT,
    );
    expect(r.classification).toBe("unrelated");
  });
});

describe("classifyHeuristic — marketplaces", () => {
  it("Mercado Livre vendendo roteador = unrelated", () => {
    const r = classifyHeuristic(
      {
        title: "Roteador Wi-Fi 6 fibra ótica - Mercado Livre",
        url: "https://www.mercadolivre.com.br/roteador-fibra",
        snippet: "Compre roteador wifi para fibra",
      },
      VERTICAL_FIBRA_CONTEXT,
    );
    expect(r.classification).toBe("unrelated");
    expect(r.reasoning).toContain("marketplace");
  });
});

describe("classifyHeuristic — knownCompetitors", () => {
  it("Sercomtel anuncia novo plano = existing_provider", () => {
    const r = classifyHeuristic(
      {
        title: "Sercomtel apresenta novo plano fibra em Londrina",
        url: "https://www.sercomtel.com.br/planos",
        snippet: "Novo plano de internet fibra ótica",
      },
      VERTICAL_FIBRA_CONTEXT,
    );
    expect(r.classification).toBe("existing_provider");
    expect(r.matchedTerms).toContain("Sercomtel");
  });

  it("Copel Telecom = existing_provider mesmo se diz 'chegamos'", () => {
    const r = classifyHeuristic(
      {
        title: "Copel Telecom chegou em Cambé",
        url: "https://copeltelecom.com.br",
        snippet: "Internet fibra agora em Cambé",
      },
      VERTICAL_FIBRA_CONTEXT,
    );
    expect(r.classification).toBe("existing_provider");
  });
});

describe("classifyHeuristic — new_provider detection", () => {
  it("Site novo com ISP + região + cobertura = new_provider", () => {
    const r = classifyHeuristic(
      {
        title: "FibraX - Internet em Londrina e Ibiporã",
        url: "https://fibrax-internet.com.br",
        snippet:
          "Provedor de internet fibra óptica, agora chegamos em Londrina com cobertura total.",
      },
      VERTICAL_FIBRA_CONTEXT,
    );
    expect(r.classification).toBe("new_provider");
    expect(r.matchedTerms.length).toBeGreaterThan(2);
    expect(r.needsLlmReview).toBe(false);
  });

  it("Provedor expandindo para região = new_provider", () => {
    const r = classifyHeuristic(
      {
        title: "ConectaNet - Expansão de cobertura em Cambé",
        url: "https://conectanet.com.br/cobertura/cambe",
        snippet:
          "Nova região atendida: Cambé. Internet banda larga fibra para sua casa.",
      },
      VERTICAL_FIBRA_CONTEXT,
    );
    expect(r.classification).toBe("new_provider");
  });
});

describe("classifyHeuristic — uncertain (needs LLM)", () => {
  it("ISP terms + região mas SEM coverage = existing_provider com low confidence", () => {
    const r = classifyHeuristic(
      {
        title: "Internet em Londrina - lista de provedores",
        url: "https://blog-tecnologia.com/londrina",
        snippet: "Análise dos provedores de fibra em Londrina",
      },
      VERTICAL_FIBRA_CONTEXT,
    );
    expect(r.classification).toBe("existing_provider");
    expect(r.confidence).toBeLessThan(0.7);
    expect(r.needsLlmReview).toBe(true);
  });

  it("Site sem ISP terms relevantes mas não-marketplace = noise/unrelated", () => {
    const r = classifyHeuristic(
      {
        title: "Notícias de Londrina",
        url: "https://noticias-londrina.com.br",
        snippet: "Cobertura completa das últimas notícias",
      },
      VERTICAL_FIBRA_CONTEXT,
    );
    expect(["unrelated", "noise"]).toContain(r.classification);
  });
});

describe("needsLlmReview", () => {
  it("confidence < 0.7 OU flag explícita", () => {
    expect(needsLlmReview({
      classification: "noise",
      confidence: 0.5,
      reasoning: "",
      matchedTerms: [],
      needsLlmReview: false,
    })).toBe(true);

    expect(needsLlmReview({
      classification: "new_provider",
      confidence: 0.85,
      reasoning: "",
      matchedTerms: [],
      needsLlmReview: false,
    })).toBe(false);

    expect(needsLlmReview({
      classification: "new_provider",
      confidence: 0.85,
      reasoning: "",
      matchedTerms: [],
      needsLlmReview: true,
    })).toBe(true);
  });
});

describe("partitionForLlm", () => {
  it("separa certain de uncertain", () => {
    const items = [
      {
        search: { title: "X", url: "https://facebook.com/x", snippet: "y" } as SearchResult,
        heuristic: classifyHeuristic(
          { title: "X", url: "https://facebook.com/x", snippet: "y" },
          VERTICAL_FIBRA_CONTEXT,
        ),
      },
      {
        search: { title: "Y", url: "https://random.com", snippet: "abc" } as SearchResult,
        heuristic: classifyHeuristic(
          { title: "Y", url: "https://random.com", snippet: "abc" },
          VERTICAL_FIBRA_CONTEXT,
        ),
      },
    ];

    const { certain, uncertain } = partitionForLlm(items);
    expect(certain.length + uncertain.length).toBe(2);
    // Facebook é certain (alta confidence noise domain)
    expect(certain.length).toBeGreaterThanOrEqual(1);
  });
});

describe("determinismo", () => {
  it("mesma entrada produz mesma classificação", () => {
    const search = {
      title: "FibraX em Londrina",
      url: "https://fibrax.com.br",
      snippet: "Provedor de internet fibra chegou em Londrina",
    };
    const a = classifyHeuristic(search, VERTICAL_FIBRA_CONTEXT);
    const b = classifyHeuristic(search, VERTICAL_FIBRA_CONTEXT);
    expect(a).toEqual(b);
  });
});
