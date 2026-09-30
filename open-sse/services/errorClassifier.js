/**
 * Comprehensive error classifier for Smart Retry and Fallback Engine
 */

export const ERROR_CATEGORIES = {
  RATE_LIMIT: "rate_limit",
  QUOTA_EXHAUSTED: "quota_exhausted",
  AUTH_FAILURE: "auth_failure",
  TIMEOUT: "timeout",
  STREAM_INTERRUPTED: "stream_interrupted",
  PROVIDER_OVERLOAD: "provider_overload",
  SERVER_ERROR: "server_error",
  NETWORK_ERROR: "network_error",
  EMPTY_RESPONSE: "empty_response",
  EMBEDDED_ERROR: "embedded_error",
  BAD_REQUEST: "bad_request",
  MODEL_NOT_FOUND: "model_not_found",
  PERMISSION_DENIED: "permission_denied",
  UNKNOWN: "unknown",
};

/**
 * Classify an error based on status code, error text/exception, and context
 * @param {number|null} status - HTTP status code
 * @param {string|Error|object} error - Error object, string or message
 * @param {object} [context={}] - Additional context (e.g. wasStreaming, bytesReceived)
 * @returns {{
 *   category: string,
 *   retryable: boolean,
 *   shouldFallback: boolean,
 *   backoff: boolean,
 *   cooldownMs: number,
 *   reason: string,
 *   sanitizedMessage: string
 * }}
 */
export function classifyError(status, error, context = {}) {
  const statusCode = Number(status) || 0;
  const rawMsg =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : (error?.message || error?.error || error?.msg || JSON.stringify(error || ""));

  const lower = String(rawMsg || "").toLowerCase();
  const errCode = error?.code || error?.cause?.code || "";

  // 1. Deterministic validation / client errors (Never retry, fail immediately)
  if (
    statusCode === 400 &&
    (lower.includes("invalid json") ||
      lower.includes("missing model") ||
      lower.includes("unsupported parameter") ||
      lower.includes("context length exceeded") ||
      lower.includes("prompt is too long") ||
      lower.includes("max_tokens") ||
      lower.includes("bad request"))
  ) {
    return {
      category: ERROR_CATEGORIES.BAD_REQUEST,
      retryable: false,
      shouldFallback: false,
      backoff: false,
      cooldownMs: 0,
      reason: "Client request validation error",
      sanitizedMessage: "Bad request - deterministic error",
    };
  }

  if (statusCode === 404 || lower.includes("model not found") || lower.includes("unknown model")) {
    return {
      category: ERROR_CATEGORIES.MODEL_NOT_FOUND,
      retryable: false,
      shouldFallback: false,
      backoff: false,
      cooldownMs: 0,
      reason: "Model not found",
      sanitizedMessage: "Model not found or not supported",
    };
  }

  if (
    lower.includes("api key does not have permission") ||
    lower.includes("permission denied") ||
    lower.includes("scope restricted")
  ) {
    return {
      category: ERROR_CATEGORIES.PERMISSION_DENIED,
      retryable: false,
      shouldFallback: false,
      backoff: false,
      cooldownMs: 0,
      reason: "API key permission restriction",
      sanitizedMessage: "Permission denied by API key policy",
    };
  }

  // 2. Stream interruptions / stalls
  if (
    context.wasStreaming &&
    (context.streamInterrupted ||
      lower.includes("stream stall") ||
      lower.includes("inactivity") ||
      lower.includes("premature") ||
      lower.includes("end of stream") ||
      lower.includes("stream interrupted") ||
      lower.includes("premature close") ||
      lower.includes("stream ended without"))
  ) {
    return {
      category: ERROR_CATEGORIES.STREAM_INTERRUPTED,
      retryable: true,
      shouldFallback: true,
      backoff: false,
      cooldownMs: 1000,
      reason: "Streaming connection stalled or interrupted",
      sanitizedMessage: "Upstream stream interrupted",
    };
  }

  // 3. Timeouts (HTTP 408, 504, connect timeout, fetch timeout)
  if (
    statusCode === 408 ||
    statusCode === 504 ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    errCode === "ETIMEDOUT" ||
    errCode === "ESOCKETTIMEDOUT"
  ) {
    return {
      category: ERROR_CATEGORIES.TIMEOUT,
      retryable: true,
      shouldFallback: true,
      backoff: true,
      cooldownMs: 3000,
      reason: "Upstream request or connection timed out",
      sanitizedMessage: "Upstream request timed out",
    };
  }

  // 4. Quota / Credits exhausted (Check before generic 429/rate limits)
  if (
    statusCode === 402 ||
    (statusCode === 403 &&
      (lower.includes("quota") ||
        lower.includes("credit") ||
        lower.includes("balance") ||
        lower.includes("billing") ||
        lower.includes("usage limit"))) ||
    lower.includes("quota") ||
    lower.includes("credit") ||
    lower.includes("balance") ||
    lower.includes("billing") ||
    lower.includes("insufficient_quota") ||
    lower.includes("insufficient balance") ||
    lower.includes("quota exceeded") ||
    lower.includes("has been exhausted")
  ) {
    return {
      category: ERROR_CATEGORIES.QUOTA_EXHAUSTED,
      retryable: true,
      shouldFallback: true, // Fallback to another account or provider
      backoff: false,
      cooldownMs: 120000, // Longer cooldown for depleted quota
      reason: "Account quota or balance exhausted",
      sanitizedMessage: "Account quota exhausted",
    };
  }

  // 5. Rate limits (HTTP 429, rate limit text)
  if (
    statusCode === 429 ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("resource_exhausted") ||
    lower.includes("concurrency limit")
  ) {
    return {
      category: ERROR_CATEGORIES.RATE_LIMIT,
      retryable: true,
      shouldFallback: true,
      backoff: true,
      cooldownMs: 2000,
      reason: "Rate limit exceeded",
      sanitizedMessage: "Rate limit exceeded on upstream provider",
    };
  }

  // 6. Authentication failure (HTTP 401, expired token)
  if (
    statusCode === 401 ||
    lower.includes("unauthorized") ||
    lower.includes("invalid_grant") ||
    lower.includes("token expired") ||
    lower.includes("authentication failed") ||
    lower.includes("invalid api key")
  ) {
    return {
      category: ERROR_CATEGORIES.AUTH_FAILURE,
      retryable: true, // Can retry after token refresh or switch to another account
      shouldFallback: true,
      backoff: false,
      cooldownMs: 60000,
      reason: "Authentication error or expired token",
      sanitizedMessage: "Provider authentication failed",
    };
  }

  // 7. Temporary provider overload (HTTP 503, capacity text)
  if (
    statusCode === 503 ||
    lower.includes("overloaded") ||
    lower.includes("capacity") ||
    lower.includes("service temporarily unavailable")
  ) {
    return {
      category: ERROR_CATEGORIES.PROVIDER_OVERLOAD,
      retryable: true,
      shouldFallback: true,
      backoff: true,
      cooldownMs: 2000,
      reason: "Provider temporarily overloaded",
      sanitizedMessage: "Provider overloaded, falling back",
    };
  }

  // 8. Server error / bad gateway (HTTP 500, 502)
  if (statusCode === 500 || statusCode === 502 || lower.includes("internal server error") || lower.includes("bad gateway")) {
    return {
      category: ERROR_CATEGORIES.SERVER_ERROR,
      retryable: true,
      shouldFallback: true,
      backoff: true,
      cooldownMs: 2000,
      reason: "Upstream server error",
      sanitizedMessage: "Upstream provider server error",
    };
  }

  // 9. Network errors (connection reset, refused, pipe broken)
  if (
    errCode === "ECONNRESET" ||
    errCode === "ECONNREFUSED" ||
    errCode === "EPIPE" ||
    errCode === "UND_ERR_SOCKET" ||
    lower.includes("socket hang up") ||
    lower.includes("econnreset") ||
    lower.includes("fetch failed")
  ) {
    return {
      category: ERROR_CATEGORIES.NETWORK_ERROR,
      retryable: true,
      shouldFallback: true,
      backoff: true,
      cooldownMs: 2000,
      reason: "Network connection failure",
      sanitizedMessage: "Network connection error",
    };
  }

  // 10. Empty or invalid response
  if (lower.includes("empty response") || lower.includes("no completion choices") || lower.includes("no choices returned")) {
    return {
      category: ERROR_CATEGORIES.EMPTY_RESPONSE,
      retryable: true,
      shouldFallback: true,
      backoff: false,
      cooldownMs: 1000,
      reason: "Empty or malformed upstream response",
      sanitizedMessage: "Empty response from provider",
    };
  }

  // 11. Generic fallback
  return {
    category: ERROR_CATEGORIES.UNKNOWN,
    retryable: statusCode >= 500 || statusCode === 0,
    shouldFallback: statusCode >= 500 || statusCode === 0,
    backoff: true,
    cooldownMs: 5000,
    reason: `Unhandled error (HTTP ${statusCode || "unknown"})`,
    sanitizedMessage: rawMsg ? String(rawMsg).slice(0, 150) : "Upstream error",
  };
}

/**
 * Compute exponential backoff with jitter
 * @param {number} attempt - 1-based attempt index
 * @param {number} [baseMs=1000] - Base delay
 * @param {number} [maxMs=15000] - Maximum delay
 * @returns {number} Backoff delay in milliseconds
 */
export function computeBackoffWithJitter(attempt, baseMs = 1000, maxMs = 15000) {
  const exp = Math.min(attempt - 1, 5);
  const calculated = baseMs * Math.pow(2, exp);
  const jitter = Math.floor(Math.random() * 500); // 0-500ms random jitter
  return Math.min(calculated + jitter, maxMs);
}
