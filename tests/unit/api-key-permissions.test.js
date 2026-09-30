import { describe, it, expect } from "vitest";
import { validateKeyPermissions, validateApiKeyPermissions } from "../../src/shared/services/apiKeyPermissions.js";

describe("API Key Permissions & Scopes", () => {
  it("allows all requests for legacy/unrestricted keys (backward compatibility)", () => {
    const legacyKey = {
      id: "key-1",
      key: "nr-test123",
      isActive: true,
      permissions: null,
    };

    const res1 = validateKeyPermissions(legacyKey, { provider: "anthropic", model: "claude-3-5-sonnet" });
    expect(res1.allowed).toBe(true);

    const res2 = validateKeyPermissions(legacyKey, { provider: "openai", model: "gpt-4o" });
    expect(res2.allowed).toBe(true);

    const res3 = validateKeyPermissions(legacyKey, { provider: "gemini", model: "gemini-2.5-flash" });
    expect(res3.allowed).toBe(true);
  });

  it("blocks disabled or paused keys with 401", () => {
    const disabledKey = {
      id: "key-paused",
      isActive: false,
    };

    const res = validateKeyPermissions(disabledKey, { provider: "openai", model: "gpt-4o" });
    expect(res.allowed).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("enforces allowedProviders restriction", () => {
    const geminiOnlyKey = {
      id: "key-gemini",
      isActive: true,
      permissions: {
        allowedProviders: ["gemini"],
      },
    };

    const allowed = validateKeyPermissions(geminiOnlyKey, { provider: "gemini", model: "gemini-2.5-flash" });
    expect(allowed.allowed).toBe(true);

    const blocked = validateKeyPermissions(geminiOnlyKey, { provider: "anthropic", model: "claude-3-5-sonnet" });
    expect(blocked.allowed).toBe(false);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.reason).toContain("gemini");
  });

  it("enforces allowedModels restriction with pattern matching", () => {
    const flashOnlyKey = {
      id: "key-flash",
      isActive: true,
      permissions: {
        allowedModels: ["*flash*", "gpt-4o-mini"],
      },
    };

    const allowedFlash = validateKeyPermissions(flashOnlyKey, { provider: "gemini", model: "gemini-2.5-flash" });
    expect(allowedFlash.allowed).toBe(true);

    const allowedMini = validateKeyPermissions(flashOnlyKey, { provider: "openai", model: "gpt-4o-mini" });
    expect(allowedMini.allowed).toBe(true);

    const blockedPro = validateKeyPermissions(flashOnlyKey, { provider: "gemini", model: "gemini-2.5-pro" });
    expect(blockedPro.allowed).toBe(false);
    expect(blockedPro.statusCode).toBe(403);
  });

  it("enforces freeOnly restriction", () => {
    const freeOnlyKey = {
      id: "key-free",
      isActive: true,
      permissions: {
        freeOnly: true,
      },
    };

    const allowedFree = validateKeyPermissions(freeOnlyKey, { provider: "gemini", model: "gemini-2.5-flash-free" });
    expect(allowedFree.allowed).toBe(true);

    const blockedPaid = validateKeyPermissions(freeOnlyKey, { provider: "anthropic", model: "claude-3-5-sonnet" });
    expect(blockedPaid.allowed).toBe(false);
    expect(blockedPaid.statusCode).toBe(403);
    expect(blockedPaid.reason).toContain("free models only");
  });

  it("enforces request limit caps with 429", () => {
    const cappedKey = {
      id: "key-req-capped",
      isActive: true,
      requestCount: 100,
      permissions: {
        requestLimit: 100,
      },
    };

    const blocked = validateKeyPermissions(cappedKey, { provider: "gemini", model: "gemini-2.5-flash" });
    expect(blocked.allowed).toBe(false);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.reason).toContain("request limit exceeded");
  });

  it("enforces usage/spend budget limit with 429", () => {
    const budgetKey = {
      id: "key-budget-capped",
      isActive: true,
      totalSpend: 15.50,
      permissions: {
        usageLimit: 10.00,
      },
    };

    const blocked = validateKeyPermissions(budgetKey, { provider: "gemini", model: "gemini-2.5-flash" });
    expect(blocked.allowed).toBe(false);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.reason).toContain("usage limit exceeded");
  });

  it("enforces project binding restriction", () => {
    const projectBoundKey = {
      id: "key-project-1",
      isActive: true,
      projectId: "project-cli",
      permissions: {},
    };

    const allowedCorrectProject = validateKeyPermissions(projectBoundKey, {
      provider: "openai",
      model: "gpt-4o",
      projectId: "project-cli",
    });
    expect(allowedCorrectProject.allowed).toBe(true);

    const blockedMismatchProject = validateKeyPermissions(projectBoundKey, {
      provider: "openai",
      model: "gpt-4o",
      projectId: "project-web",
    });
    expect(blockedMismatchProject.allowed).toBe(false);
    expect(blockedMismatchProject.statusCode).toBe(403);
  });
});
