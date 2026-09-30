import { describe, it, expect } from "vitest";
import {
  resolveRequestTimeouts,
  clampTimeout,
  DEFAULT_TIMEOUTS,
} from "../../src/lib/network/timeoutResolver.js";

describe("Configurable Request Timeout Resolver", () => {
  it("clampTimeout restricts values between min and max bounds", () => {
    expect(clampTimeout(500, 1000, 600000)).toBe(1000);
    expect(clampTimeout(1000000, 1000, 600000)).toBe(600000);
    expect(clampTimeout(45000, 1000, 600000)).toBe(45000);
    expect(clampTimeout(null, 1000, 600000, 30000)).toBe(30000);
  });

  it("applies default timeouts when no overrides are given", () => {
    const config = resolveRequestTimeouts({});
    expect(config.connectTimeoutMs).toBe(DEFAULT_TIMEOUTS.connectTimeoutMs);
    expect(config.upstreamTimeoutMs).toBe(DEFAULT_TIMEOUTS.upstreamTimeoutMs);
    expect(config.streamInactivityTimeoutMs).toBe(DEFAULT_TIMEOUTS.streamInactivityTimeoutMs);
    expect(config.stallTimeoutMs).toBe(config.streamInactivityTimeoutMs);
  });

  it("applies global settings overrides", () => {
    const config = resolveRequestTimeouts({
      globalSettings: {
        requestTimeoutMs: 180000,
        connectTimeoutMs: 15000,
        streamInactivityTimeoutMs: 45000,
      },
    });

    expect(config.upstreamTimeoutMs).toBe(180000);
    expect(config.connectTimeoutMs).toBe(15000);
    expect(config.streamInactivityTimeoutMs).toBe(45000);
  });

  it("prioritizes project timeout over global settings", () => {
    const config = resolveRequestTimeouts({
      globalSettings: { requestTimeoutMs: 120000 },
      project: { timeoutMs: 90000 },
    });

    expect(config.upstreamTimeoutMs).toBe(90000);
  });

  it("applies provider specific overrides from settings", () => {
    const config = resolveRequestTimeouts({
      globalSettings: {
        providerTimeouts: {
          anthropic: 240000,
        },
      },
      provider: "anthropic",
      model: "claude-3-5-sonnet",
    });

    expect(config.upstreamTimeoutMs).toBe(240000);
  });

  it("applies reasoning / coding boost for complex models and requests", () => {
    const normalConfig = resolveRequestTimeouts({
      provider: "openai",
      model: "gpt-4o-mini",
      body: { messages: [{ role: "user", content: "hi" }] },
    });

    const reasoningConfig = resolveRequestTimeouts({
      provider: "deepseek",
      model: "deepseek-reasoner",
      body: { thinking: { type: "enabled" }, messages: [{ role: "user", content: "solve" }] },
    });

    // Reasoning request gets a 2x timeout boost
    expect(reasoningConfig.upstreamTimeoutMs).toBeGreaterThan(normalConfig.upstreamTimeoutMs);
    expect(reasoningConfig.streamInactivityTimeoutMs).toBeGreaterThan(normalConfig.streamInactivityTimeoutMs);
  });
});
