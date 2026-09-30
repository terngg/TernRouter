import { describe, it, expect } from "vitest";
import { isAutoModel, detectRequestIntent, resolveAutoModel, MODEL_PROFILES } from "../../open-sse/services/autoRouter.js";

describe("Smart Auto Model Routing", () => {
  describe("isAutoModel detection", () => {
    it("recognizes virtual auto models", () => {
      expect(isAutoModel("auto")).toBe(true);
      expect(isAutoModel("auto/balanced")).toBe(true);
      expect(isAutoModel("auto/fast")).toBe(true);
      expect(isAutoModel("auto/cheap")).toBe(true);
      expect(isAutoModel("auto/quality")).toBe(true);
      expect(isAutoModel("AUTO/QUALITY")).toBe(true);
    });

    it("rejects non-auto models", () => {
      expect(isAutoModel("claude-3-5-sonnet")).toBe(false);
      expect(isAutoModel("openai/gpt-4o")).toBe(false);
      expect(isAutoModel("gemini-2.5-flash")).toBe(false);
      expect(isAutoModel("")).toBe(false);
      expect(isAutoModel(null)).toBe(false);
    });
  });

  describe("detectRequestIntent", () => {
    it("detects vision intent from messages", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is this image?" },
              { type: "image_url", image_url: { url: "https://example.com/img.png" } }
            ]
          }
        ]
      };
      const intent = detectRequestIntent(body);
      expect(intent.hasVision).toBe(true);
      expect(intent.hasTools).toBe(false);
    });

    it("detects tool intent from tool definitions", () => {
      const body = {
        messages: [{ role: "user", content: "Check the weather" }],
        tools: [{ type: "function", function: { name: "get_weather" } }]
      };
      const intent = detectRequestIntent(body);
      expect(intent.hasTools).toBe(true);
    });

    it("detects coding intent from programming terms and code blocks", () => {
      const body = {
        messages: [
          { role: "user", content: "Write a python function to implement quicksort:\n```python\ndef quicksort(arr):\n    pass\n```" }
        ]
      };
      const intent = detectRequestIntent(body);
      expect(intent.isCoding).toBe(true);
    });

    it("detects reasoning intent from reasoning prompts", () => {
      const body = {
        messages: [
          { role: "user", content: "Think step by step and prove the Riemann Hypothesis using mathematical logic" }
        ]
      };
      const intent = detectRequestIntent(body);
      expect(intent.isReasoning).toBe(true);
    });
  });

  describe("resolveAutoModel candidate selection", () => {
    const candidateModels = [
      "gemini/gemini-2.5-flash",
      "gemini/gemini-2.5-pro",
      "claude/claude-3-5-sonnet",
      "openai/gpt-4o",
      "deepseek/deepseek-reasoner",
    ];

    it("selects fast/cheap model for fast mode", () => {
      const resolved = resolveAutoModel({
        requestedModel: "auto/fast",
        body: { messages: [{ role: "user", content: "hello" }] },
        candidateModels,
      });

      expect(resolved.selectedModel).toBeDefined();
      expect(resolved.mode).toBe("fast");
      expect(resolved.selectedModel).toContain("flash");
    });

    it("selects high quality model for quality mode", () => {
      const resolved = resolveAutoModel({
        requestedModel: "auto/quality",
        body: { messages: [{ role: "user", content: "Refactor this architecture" }] },
        candidateModels,
      });

      expect(resolved.mode).toBe("quality");
      expect(resolved.selectedModel).toMatch(/sonnet|gpt-4o|pro/);
    });

    it("deprioritizes unhealthy or rate-limited providers", () => {
      const providerHealth = [
        { provider: "claude", model: "claude-3-5-sonnet", status: "rate_limited" },
        { provider: "openai", model: "gpt-4o", status: "healthy", latencyMs: 300 },
      ];

      const resolved = resolveAutoModel({
        requestedModel: "auto/quality",
        body: { messages: [{ role: "user", content: "Complex query" }] },
        candidateModels: ["claude/claude-3-5-sonnet", "openai/gpt-4o"],
        providerHealth,
      });

      expect(resolved.selectedModel).toBe("openai/gpt-4o");
    });

    it("respects API key permissions", () => {
      const resolved = resolveAutoModel({
        requestedModel: "auto/balanced",
        body: { messages: [{ role: "user", content: "hello" }] },
        candidateModels,
        apiKeyPermissions: {
          allowedProviders: ["gemini"],
        },
      });

      expect(resolved.selectedModel).toMatch(/^gemini\//);
      for (const m of resolved.candidateModels) {
        expect(m).toMatch(/^gemini\//);
      }
    });
  });
});
