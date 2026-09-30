import { describe, it, expect, beforeEach } from "vitest";
import {
  HEALTH_STATES,
  mapConcurrent,
  healthCache,
  COOLDOWN_MS,
  isProviderUnhealthy,
} from "../../src/lib/health/healthChecker.js";
import { buildHealthId } from "../../src/lib/db/repos/providerHealthRepo.js";

describe("Provider Health Engine", () => {
  beforeEach(() => {
    healthCache.clear();
  });

  describe("HEALTH_STATES constants", () => {
    it("defines all required provider health states", () => {
      expect(HEALTH_STATES.HEALTHY).toBe("healthy");
      expect(HEALTH_STATES.SLOW).toBe("slow");
      expect(HEALTH_STATES.RATE_LIMITED).toBe("rate_limited");
      expect(HEALTH_STATES.QUOTA_LOW).toBe("quota_low");
      expect(HEALTH_STATES.QUOTA_EXHAUSTED).toBe("quota_exhausted");
      expect(HEALTH_STATES.AUTH_FAILED).toBe("auth_failed");
      expect(HEALTH_STATES.TIMEOUT).toBe("timeout");
      expect(HEALTH_STATES.PROVIDER_ERROR).toBe("provider_error");
      expect(HEALTH_STATES.DISABLED).toBe("disabled");
      expect(HEALTH_STATES.UNKNOWN).toBe("unknown");
    });
  });

  describe("mapConcurrent concurrency limiter", () => {
    it("limits concurrent executions to specified pool limit", async () => {
      const items = [1, 2, 3, 4, 5, 6, 7];
      let active = 0;
      let maxActive = 0;

      const results = await mapConcurrent(items, 3, async (item) => {
        active++;
        if (active > maxActive) maxActive = active;
        // Small delay to simulate async network ping
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return item * 2;
      });

      expect(maxActive).toBeLessThanOrEqual(3);
      expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
    });

    it("handles errors gracefully inside concurrent worker", async () => {
      const items = ["ok1", "fail", "ok2"];
      const results = await mapConcurrent(items, 2, async (item) => {
        if (item === "fail") throw new Error("Ping failure");
        return "success";
      });

      expect(results[0]).toBe("success");
      expect(results[1]).toEqual({ error: "Ping failure" });
      expect(results[2]).toBe("success");
    });
  });

  describe("Health Cache & Cooldown", () => {
    it("respects 30 second cooldown period", () => {
      expect(COOLDOWN_MS).toBe(30000);
    });

    it("builds correct cache keys and uses cache for unhealthy check", async () => {
      const cacheKey = buildHealthId("openai", "conn-1", "gpt-4o");
      expect(cacheKey).toBe("openai:conn-1:gpt-4o");

      // Populate cache with rate limited state
      healthCache.set(cacheKey, {
        result: {
          id: cacheKey,
          provider: "openai",
          status: HEALTH_STATES.RATE_LIMITED,
          latencyMs: 120,
        },
        timestamp: Date.now(),
      });

      const unhealthy = await isProviderUnhealthy("openai", "conn-1", "gpt-4o");
      expect(unhealthy).toBe(true);

      // Populate cache with healthy state
      healthCache.set(cacheKey, {
        result: {
          id: cacheKey,
          provider: "openai",
          status: HEALTH_STATES.HEALTHY,
          latencyMs: 150,
        },
        timestamp: Date.now(),
      });

      const stillUnhealthy = await isProviderUnhealthy("openai", "conn-1", "gpt-4o");
      expect(stillUnhealthy).toBe(false);
    });
  });
});
