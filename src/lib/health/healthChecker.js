import { getProviderConnections, getApiKeys, getProviderNodes } from "@/models";
import { getCustomProviders, getCustomProviderById } from "@/lib/db/repos/customProvidersRepo.js";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { pingModelByKind } from "@/app/api/models/test/ping.js";
import { upsertProviderHealth, getAllProviderHealth, getProviderHealth, buildHealthId } from "@/lib/db/repos/providerHealthRepo.js";
import { classifyError, ERROR_CATEGORIES } from "open-sse/services/errorClassifier.js";
import { getAntigravityQuotaCache } from "@/sse/services/antigravityQuota.js";
import { UPDATER_CONFIG } from "@/shared/constants/config.js";

export const HEALTH_STATES = {
  HEALTHY: "healthy",
  SLOW: "slow",
  RATE_LIMITED: "rate_limited",
  QUOTA_LOW: "quota_low",
  QUOTA_EXHAUSTED: "quota_exhausted",
  AUTH_FAILED: "auth_failed",
  TIMEOUT: "timeout",
  PROVIDER_ERROR: "provider_error",
  DISABLED: "disabled",
  UNKNOWN: "unknown",
};

// In-memory cache of recent test results to prevent accidental hammering
// Key: provider:connectionId:model -> { result, timestamp }
export const healthCache = new Map();
export const COOLDOWN_MS = 30 * 1000; // 30 seconds cooldown between tests for the same target unless forced
export const CONCURRENCY_LIMIT = 3;

/**
 * Execute tasks with concurrency limit
 */
export async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (err) {
        results[idx] = { error: err.message };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Test a specific model for a provider
 */
export async function testModelHealth(provider, model, options = {}) {
  const { force = false, connectionId = null, connectionName = null } = options;
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const cacheKey = buildHealthId(alias, connectionId, model);

  if (!force && healthCache.has(cacheKey)) {
    const cached = healthCache.get(cacheKey);
    if (Date.now() - cached.timestamp < COOLDOWN_MS) {
      return cached.result;
    }
  }

  const modelId = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  const targetSpec = `${alias}/${modelId}`;
  const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort || 20127}`;

  const pingKind = options.kind || "llm";
  let status = HEALTH_STATES.UNKNOWN;
  let latencyMs = 0;
  let errorMsg = null;
  let quota = null;

  // Check quota cache if provider is antigravity
  if (provider === "antigravity" || alias === "antigravity") {
    try {
      const agCache = getAntigravityQuotaCache();
      if (connectionId && agCache) {
        const q = agCache.get(connectionId)?.[modelId];
        if (q) {
          quota = { remainingPercentage: q.remainingPercentage, resetAt: q.resetAt };
          if (q.remainingPercentage <= 0) {
            status = HEALTH_STATES.QUOTA_EXHAUSTED;
          } else if (q.remainingPercentage <= 15) {
            status = HEALTH_STATES.QUOTA_LOW;
          }
        }
      }
    } catch {}
  }

  if (status !== HEALTH_STATES.QUOTA_EXHAUSTED) {
    try {
      const res = await pingModelByKind(targetSpec, pingKind, baseUrl);
      latencyMs = res.latencyMs || 0;

      if (res.ok) {
        if (status === HEALTH_STATES.QUOTA_LOW) {
          // Keep quota_low warning
        } else if (latencyMs > 3000) {
          status = HEALTH_STATES.SLOW;
        } else {
          status = HEALTH_STATES.HEALTHY;
        }
      } else {
        const classified = classifyError(res.status, res.error);
        errorMsg = res.error || classified.sanitizedMessage;

        switch (classified.category) {
          case ERROR_CATEGORIES.AUTH_FAILURE:
            status = HEALTH_STATES.AUTH_FAILED;
            break;
          case ERROR_CATEGORIES.RATE_LIMIT:
            status = HEALTH_STATES.RATE_LIMITED;
            break;
          case ERROR_CATEGORIES.QUOTA_EXHAUSTED:
            status = HEALTH_STATES.QUOTA_EXHAUSTED;
            break;
          case ERROR_CATEGORIES.TIMEOUT:
            status = HEALTH_STATES.TIMEOUT;
            break;
          case ERROR_CATEGORIES.PROVIDER_OVERLOAD:
          case ERROR_CATEGORIES.SERVER_ERROR:
          case ERROR_CATEGORIES.NETWORK_ERROR:
          default:
            status = HEALTH_STATES.PROVIDER_ERROR;
            break;
        }
      }
    } catch (err) {
      latencyMs = 0;
      errorMsg = err.message || "Test invocation failed";
      status = HEALTH_STATES.PROVIDER_ERROR;
    }
  }

  const result = {
    id: cacheKey,
    provider: alias,
    connectionId,
    connectionName: connectionName || alias,
    model: modelId,
    status,
    latencyMs,
    error: errorMsg ? String(errorMsg).slice(0, 300) : null,
    quota,
    lastTested: new Date().toISOString(),
  };

  healthCache.set(cacheKey, { result, timestamp: Date.now() });

  // Persist asynchronously to DB
  try {
    await upsertProviderHealth(result);
  } catch (err) {
    console.error("[healthChecker] Failed to persist health record:", err.message);
  }

  return result;
}

/**
 * Test all models for a specific provider
 */
export async function testProviderHealth(provider, options = {}) {
  if (provider.startsWith("custom-") || provider.startsWith("custom_")) {
    const rawId = provider.replace(/^custom[-_]+/, "");
    const fullPId = `custom-${rawId}`;
    const cp = (await getCustomProviderById(rawId)) || (await getCustomProviderById(fullPId));
    if (!cp || cp.isActive === false) {
      return [{
        id: buildHealthId(fullPId),
        provider: fullPId,
        connectionId: null,
        connectionName: cp?.name || fullPId,
        model: null,
        status: HEALTH_STATES.DISABLED,
        latencyMs: null,
        error: cp ? "Custom provider is disabled" : "Custom provider not found",
        quota: null,
        lastTested: new Date().toISOString(),
      }];
    }
    const models = (cp.models || []).slice(0, 5);
    const items = (models.length > 0 ? models : [{ id: "default", name: "Default" }]).map((m) => {
      const mId = typeof m === "string" ? m : (m.id || m.name);
      return {
        provider: fullPId,
        model: mId,
        connectionId: cp.id,
        connectionName: cp.name,
        kind: "llm",
      };
    });
    return await mapConcurrent(items, CONCURRENCY_LIMIT, async (item) => {
      return await testModelHealth(item.provider, item.model, {
        force: options.force,
        connectionId: item.connectionId,
        connectionName: item.connectionName,
        kind: item.kind,
      });
    });
  }

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const connections = await getProviderConnections({ provider, isActive: true });
  const allModels = getProviderModels(alias);

  // If no connections, report disabled/unknown
  if (connections.length === 0 && !["ollama"].includes(provider)) {
    return [{
      id: buildHealthId(alias),
      provider: alias,
      connectionId: null,
      connectionName: alias,
      model: null,
      status: HEALTH_STATES.DISABLED,
      latencyMs: null,
      error: "No active connections configured",
      quota: null,
      lastTested: new Date().toISOString(),
    }];
  }

  const modelsToTest = allModels.slice(0, 5); // Pick top 5 models per provider to avoid burning quotas
  if (modelsToTest.length === 0) {
    modelsToTest.push({ id: "default", name: "Default" });
  }

  const primaryConn = connections[0] || null;
  const items = modelsToTest.map((m) => ({
    provider: alias,
    model: m.id,
    connectionId: primaryConn?.id || null,
    connectionName: primaryConn?.name || primaryConn?.email || alias,
    kind: m.kind || m.type || "llm",
  }));

  return await mapConcurrent(items, CONCURRENCY_LIMIT, async (item) => {
    return await testModelHealth(item.provider, item.model, {
      force: options.force,
      connectionId: item.connectionId,
      connectionName: item.connectionName,
      kind: item.kind,
    });
  });
}

/**
 * Test all active providers and models
 */
export async function testAllModelsHealth(options = {}) {
  const connections = await getProviderConnections({ isActive: true });
  const customProviders = await getCustomProviders({ isActive: true });

  const providerMap = new Map();
  for (const c of connections) {
    if (!providerMap.has(c.provider)) {
      providerMap.set(c.provider, c);
    }
  }

  const targets = [];
  for (const [providerId, conn] of providerMap.entries()) {
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const models = getProviderModels(alias);
    // Pick the most popular/default models for testing (max 2 per provider for fast, inexpensive test-all)
    const candidates = models.length > 0 ? models.slice(0, 2) : [{ id: "default", name: "Default" }];
    for (const m of candidates) {
      targets.push({
        provider: alias,
        model: m.id,
        connectionId: conn.id,
        connectionName: conn.name || conn.email || alias,
        kind: m.kind || m.type || "llm",
      });
    }
  }

  for (const cp of customProviders) {
    const pId = cp.id.startsWith("custom-") ? cp.id : `custom-${cp.id}`;
    const candidates = (cp.models || []).slice(0, 2);
    for (const m of candidates) {
      const mId = typeof m === "string" ? m : (m.id || m.name);
      if (mId) {
        targets.push({
          provider: pId,
          model: mId,
          connectionId: cp.id,
          connectionName: cp.name || pId,
          kind: "llm",
        });
      }
    }
  }

  const results = await mapConcurrent(targets, CONCURRENCY_LIMIT, async (target) => {
    return await testModelHealth(target.provider, target.model, {
      force: options.force,
      connectionId: target.connectionId,
      connectionName: target.connectionName,
      kind: target.kind,
    });
  });

  return results;
}

/**
 * Query current health status from DB + cache
 */
export async function getProviderHealthSummary() {
  const records = await getAllProviderHealth();
  return records;
}

/**
 * Fast helper to check if a provider/model is currently known to be unhealthy
 */
export async function isProviderUnhealthy(provider, connectionId = null, model = null) {
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const cacheKey = buildHealthId(alias, connectionId, model);
  const cached = healthCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
    const s = cached.result.status;
    return s === HEALTH_STATES.AUTH_FAILED || s === HEALTH_STATES.QUOTA_EXHAUSTED || s === HEALTH_STATES.RATE_LIMITED;
  }

  const rec = await getProviderHealth(alias, connectionId, model);
  if (!rec) return false;

  // Unhealthy if failed in the last 10 minutes
  const isRecent = Date.now() - new Date(rec.lastTested).getTime() < 10 * 60 * 1000;
  if (!isRecent) return false;

  return rec.status === HEALTH_STATES.AUTH_FAILED || rec.status === HEALTH_STATES.QUOTA_EXHAUSTED || rec.status === HEALTH_STATES.RATE_LIMITED;
}
