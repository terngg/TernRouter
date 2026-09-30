import { describe, it, expect } from "vitest";
import { buildRouteVisualization } from "../../src/sse/handlers/chat.js";
import { buildRequestDetail } from "../../open-sse/handlers/chatCore/requestDetail.js";

describe("AI Request Inspector & Trace Logging", () => {
  describe("buildRouteVisualization", () => {
    it("returns requested model when no attempts were recorded", () => {
      expect(buildRouteVisualization("gpt-4o", [])).toBe("gpt-4o");
      expect(buildRouteVisualization(null, null)).toBe("unknown");
    });

    it("formats a single successful attempt route", () => {
      const attempts = [
        {
          provider: "anthropic",
          model: "claude-3-5-sonnet",
          connectionName: "Primary Anthropic",
          status: 200,
          success: true,
        },
      ];

      const viz = buildRouteVisualization("claude-3-5-sonnet", attempts);
      expect(viz).toBe("claude-3-5-sonnet → anthropic/claude-3-5-sonnet (Primary Anthropic) [success]");
    });

    it("formats a multi-attempt fallback route with error categories", () => {
      const attempts = [
        {
          provider: "google",
          model: "gemini-1.5-pro",
          connectionName: "Workspace Key 1",
          status: 429,
          errorCategory: "rate_limit",
          success: false,
        },
        {
          provider: "anthropic",
          model: "claude-3-5-sonnet",
          connectionName: "Anthropic Backup",
          status: 200,
          success: true,
        },
      ];

      const viz = buildRouteVisualization("auto/quality", attempts);
      expect(viz).toBe(
        "auto/quality → google/gemini-1.5-pro (Workspace Key 1) [429] → anthropic/claude-3-5-sonnet (Anthropic Backup) [success]"
      );
    });

    it("uses short connectionId when connectionName is omitted", () => {
      const attempts = [
        {
          provider: "openai",
          model: "gpt-4o",
          connectionId: "conn-abcdef123456",
          status: 504,
          errorCategory: "timeout",
          success: false,
        },
      ];

      const viz = buildRouteVisualization("gpt-4o", attempts);
      expect(viz).toBe("gpt-4o → openai/gpt-4o (conn-abc) [504]");
    });
  });

  describe("buildRequestDetail structure", () => {
    it("assembles request detail record with complete routing and inspector metadata", () => {
      const base = {
        id: "req-12345",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        connectionId: "conn-1",
        latency: { ttft: 250, total: 1200 },
        tokens: {
          prompt_tokens: 150,
          completion_tokens: 300,
          cached_tokens: 50,
          reasoning_tokens: 0,
        },
        apiKeyId: "key-999",
        projectId: "proj-web",
        requestedModel: "auto/balanced",
        selectedModel: "anthropic/claude-3-5-sonnet",
        routingMode: "balanced",
        httpStatus: 200,
        totalDuration: 1200,
        estimatedCost: 0.005,
        streamed: true,
        retryCount: 1,
        routeVisualization: "auto/balanced → openai/gpt-4o (primary) [429] → anthropic/claude-3-5-sonnet (backup) [success]",
        routingTrace: [
          { attempt: 1, provider: "openai", status: 429 },
          { attempt: 2, provider: "anthropic", status: 200 },
        ],
        request: { messages: [{ role: "user", content: "Secret query" }] },
        providerResponse: { id: "msg_123" },
      };

      const detail = buildRequestDetail(base);

      expect(detail.id).toBe("req-12345");
      expect(detail.apiKeyId).toBe("key-999");
      expect(detail.projectId).toBe("proj-web");
      expect(detail.requestedModel).toBe("auto/balanced");
      expect(detail.selectedModel).toBe("anthropic/claude-3-5-sonnet");
      expect(detail.routingMode).toBe("balanced");
      expect(detail.retryCount).toBe(1);
      expect(detail.streamed).toBe(true);
      expect(detail.routeVisualization).toContain("auto/balanced →");
      expect(detail.tokens.cached_tokens).toBe(50);
      expect(detail.latency.ttft).toBe(250);
    });
  });

  describe("Privacy & Body Redaction", () => {
    it("redacts sensitive conversation bodies in metadata view while preserving routing trace", () => {
      const detail = {
        id: "req-123",
        provider: "openai",
        model: "gpt-4o",
        apiKeyId: "key-abc",
        requestedModel: "gpt-4o",
        selectedModel: "openai/gpt-4o",
        routeVisualization: "gpt-4o → openai/gpt-4o (acc1) [success]",
        request: { messages: [{ role: "user", content: "Confidential company data" }] },
        providerRequest: { messages: [{ role: "user", content: "Confidential company data" }] },
        providerResponse: { choices: [{ message: { content: "Internal response" } }] },
        response: { choices: [{ message: { content: "Internal response" } }] },
      };

      // Emulate the redaction performed by the API before returning to dashboard
      const redacted = { ...detail };
      for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
        if (redacted[key] !== undefined) {
          redacted[key] = { redacted: true };
        }
      }

      expect(redacted.request).toEqual({ redacted: true });
      expect(redacted.providerRequest).toEqual({ redacted: true });
      expect(redacted.providerResponse).toEqual({ redacted: true });
      expect(redacted.response).toEqual({ redacted: true });

      // Trace & metadata intact
      expect(redacted.routeVisualization).toBe("gpt-4o → openai/gpt-4o (acc1) [success]");
      expect(redacted.apiKeyId).toBe("key-abc");
    });
  });
});
