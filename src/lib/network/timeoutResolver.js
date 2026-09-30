/**
 * Timeout configuration resolver with safe clamping and reasoning model awareness
 */

export const TIMEOUT_DEFAULTS = {
  GLOBAL_TIMEOUT_MS: 120 * 1000,     // 2 minutes total
  CONNECT_TIMEOUT_MS: 30 * 1000,     // 30 seconds connection/headers
  STALL_TIMEOUT_MS: 360 * 1000,      // 6 minutes stream stall inactivity
  REASONING_MIN_TIMEOUT_MS: 300 * 1000, // 5 minutes minimum for reasoning/coding models
  MIN_ALLOWED_TIMEOUT_MS: 5 * 1000,  // 5 seconds floor
  MAX_ALLOWED_TIMEOUT_MS: 1800 * 1000, // 30 minutes ceiling
};

export const DEFAULT_TIMEOUTS = {
  connectTimeoutMs: TIMEOUT_DEFAULTS.CONNECT_TIMEOUT_MS,
  upstreamTimeoutMs: TIMEOUT_DEFAULTS.GLOBAL_TIMEOUT_MS,
  streamInactivityTimeoutMs: TIMEOUT_DEFAULTS.STALL_TIMEOUT_MS,
  totalTimeoutMs: TIMEOUT_DEFAULTS.GLOBAL_TIMEOUT_MS,
  stallTimeoutMs: TIMEOUT_DEFAULTS.STALL_TIMEOUT_MS,
};

export function clampTimeout(value, min, max, defaultVal) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultVal ?? min;
  return Math.max(min, Math.min(max, n));
}

export const clamp = clampTimeout;

/**
 * Resolve effective timeouts for a request
 */
export function resolveRequestTimeouts({
  provider = "",
  model = "",
  settings = {},
  globalSettings = null,
  project = null,
  projectTimeoutMs = null,
  isReasoningOrCoding = false,
  body = null,
} = {}) {
  const effectiveSettings = globalSettings || settings || {};
  let total = TIMEOUT_DEFAULTS.GLOBAL_TIMEOUT_MS;
  let connect = TIMEOUT_DEFAULTS.CONNECT_TIMEOUT_MS;
  let stall = TIMEOUT_DEFAULTS.STALL_TIMEOUT_MS;

  // 1. Global settings
  if (effectiveSettings.requestTimeoutGlobalMs) total = effectiveSettings.requestTimeoutGlobalMs;
  if (effectiveSettings.requestTimeoutMs) total = effectiveSettings.requestTimeoutMs;
  if (effectiveSettings.requestTimeoutConnectMs) connect = effectiveSettings.requestTimeoutConnectMs;
  if (effectiveSettings.connectTimeoutMs) connect = effectiveSettings.connectTimeoutMs;
  if (effectiveSettings.requestTimeoutStreamingStallMs) stall = effectiveSettings.requestTimeoutStreamingStallMs;
  if (effectiveSettings.streamInactivityTimeoutMs) stall = effectiveSettings.streamInactivityTimeoutMs;

  // 2. Project-level override
  const projTimeout = project?.timeoutMs || projectTimeoutMs;
  if (projTimeout && projTimeout > 0) {
    total = projTimeout;
  }

  // 3. Provider-level override
  const providerKey = (provider || "").toLowerCase();
  const provConf = effectiveSettings.providerTimeouts?.[providerKey];
  if (provConf) {
    if (typeof provConf === "number") total = provConf;
    else if (provConf.timeoutMs) total = provConf.timeoutMs;
    if (provConf.connectTimeoutMs) connect = provConf.connectTimeoutMs;
    if (provConf.stallTimeoutMs) stall = provConf.stallTimeoutMs;
  }

  // 4. Model-level override
  const modelKey = (model || "").toLowerCase();
  const modelConf = effectiveSettings.modelTimeouts?.[modelKey];
  if (modelConf) {
    if (typeof modelConf === "number") total = modelConf;
    else if (modelConf.timeoutMs) total = modelConf.timeoutMs;
    if (modelConf.connectTimeoutMs) connect = modelConf.connectTimeoutMs;
    if (modelConf.stallTimeoutMs) stall = modelConf.stallTimeoutMs;
  }

  // 5. Reasoning or heavy coding model boost
  const isReasoning =
    isReasoningOrCoding ||
    /reasoner|r1|o1|o3|thinking/i.test(modelKey) ||
    body?.thinking ||
    body?.reasoning_effort;

  if (isReasoning) {
    total = Math.max(total * 1.5, TIMEOUT_DEFAULTS.REASONING_MIN_TIMEOUT_MS);
    stall = Math.max(stall * 1.5, TIMEOUT_DEFAULTS.REASONING_MIN_TIMEOUT_MS);
  }

  const clampedTotal = clampTimeout(total, TIMEOUT_DEFAULTS.MIN_ALLOWED_TIMEOUT_MS, TIMEOUT_DEFAULTS.MAX_ALLOWED_TIMEOUT_MS, TIMEOUT_DEFAULTS.GLOBAL_TIMEOUT_MS);
  const clampedConnect = clampTimeout(connect, 1000, 120000, TIMEOUT_DEFAULTS.CONNECT_TIMEOUT_MS);
  const clampedStall = clampTimeout(stall, 5000, TIMEOUT_DEFAULTS.MAX_ALLOWED_TIMEOUT_MS, TIMEOUT_DEFAULTS.STALL_TIMEOUT_MS);

  return {
    totalTimeoutMs: clampedTotal,
    upstreamTimeoutMs: clampedTotal,
    connectTimeoutMs: clampedConnect,
    stallTimeoutMs: clampedStall,
    streamInactivityTimeoutMs: clampedStall,
  };
}
