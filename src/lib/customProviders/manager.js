import { validateTargetUrl } from "@/lib/network/ssrf.js";
import { encryptSecret, decryptSecret, redactSecrets, sanitizeHeaders } from "@/lib/crypto.js";
import { classifyError, ERROR_CATEGORIES } from "open-sse/services/errorClassifier.js";
import { getCustomProviderById, getCustomProviders } from "@/lib/db/repos/customProvidersRepo.js";

/**
 * Test connectivity, authentication, and model availability for a custom provider endpoint
 */
export async function testCustomProviderConnection(config) {
  const {
    baseUrl,
    authHeader = "Authorization",
    authPrefix = "Bearer ",
    apiKey = "",
    timeoutMs = 15000,
    customHeaders = {},
  } = config;

  // 1. SSRF and URL validation
  const urlValidation = await validateTargetUrl(baseUrl);
  if (!urlValidation.safe) {
    return {
      success: false,
      status: 400,
      latencyMs: 0,
      error: urlValidation.error || "Blocked unsafe target URL (SSRF protection)",
      errorCategory: "ssrf_violation",
      models: [],
    };
  }

  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const headers = {
    "Content-Type": "application/json",
    ...sanitizeHeaders(customHeaders),
  };

  if (apiKey) {
    const headerValue = authPrefix ? `${authPrefix}${apiKey}` : apiKey;
    headers[authHeader || "Authorization"] = headerValue;
  }

  const start = Date.now();
  let detectedModels = [];

  // 2. First probe: try GET /models to discover models
  const modelsUrl = `${normalizedBase}/models`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Connection timeout")), Math.min(timeoutMs, 10000));

    const modelsRes = await fetch(modelsUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (modelsRes.ok) {
      const data = await modelsRes.json().catch(() => null);
      if (Array.isArray(data?.data)) {
        detectedModels = data.data.map((m) => m.id || m.name).filter(Boolean);
      } else if (Array.isArray(data?.models)) {
        detectedModels = data.models.map((m) => m.id || m.name).filter(Boolean);
      }
      const latencyMs = Date.now() - start;
      return {
        success: true,
        status: modelsRes.status,
        latencyMs,
        models: detectedModels.slice(0, 50),
        error: null,
        errorCategory: null,
      };
    } else if (modelsRes.status === 401 || modelsRes.status === 403) {
      const latencyMs = Date.now() - start;
      return {
        success: false,
        status: modelsRes.status,
        latencyMs,
        models: [],
        error: `Authentication failed (HTTP ${modelsRes.status}) - check API key / headers`,
        errorCategory: ERROR_CATEGORIES.AUTH_FAILURE,
      };
    }
  } catch (err) {
    // If /models times out or fails with connection error, proceed to test /chat/completions
  }

  // 3. Second probe: test /chat/completions with minimal payload
  const chatUrl = `${normalizedBase}/chat/completions`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Connection timeout")), timeoutMs);

    const testModel = detectedModels[0] || config.models?.[0]?.id || "gpt-3.5-turbo";
    const chatRes = await fetch(chatUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const latencyMs = Date.now() - start;
    if (chatRes.ok) {
      return {
        success: true,
        status: chatRes.status,
        latencyMs,
        models: detectedModels,
        error: null,
        errorCategory: null,
      };
    }

    const rawBody = await chatRes.text().catch(() => "");
    let errorDetail = "";
    try {
      const parsed = JSON.parse(rawBody);
      errorDetail = parsed.error?.message || parsed.error || rawBody;
    } catch {
      errorDetail = rawBody;
    }

    const classification = classifyError(chatRes.status, errorDetail);
    return {
      success: false,
      status: chatRes.status,
      latencyMs,
      models: detectedModels,
      error: `HTTP ${chatRes.status}: ${String(errorDetail || classification.sanitizedMessage).slice(0, 200)}`,
      errorCategory: classification.category,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isTimeout = err.name === "AbortError" || err.message?.toLowerCase().includes("timeout");
    return {
      success: false,
      status: isTimeout ? 504 : 502,
      latencyMs,
      models: detectedModels,
      error: isTimeout ? `Request timed out after ${timeoutMs}ms` : `Connection failed: ${err.message}`,
      errorCategory: isTimeout ? ERROR_CATEGORIES.TIMEOUT : ERROR_CATEGORIES.NETWORK_ERROR,
    };
  }
}

/**
 * Resolve custom provider for chat routing
 */
export async function resolveCustomProviderCredentials(customProviderId) {
  const provider = await getCustomProviderById(customProviderId, true);
  if (!provider || !provider.isActive) return null;

  const decryptedKey = provider.encryptedApiKey ? decryptSecret(provider.encryptedApiKey) : "";

  return {
    id: provider.id,
    connectionName: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: decryptedKey,
    authHeader: provider.authHeader || "Authorization",
    authPrefix: provider.authPrefix != null ? provider.authPrefix : "Bearer ",
    customHeaders: provider.customHeaders || {},
    timeoutMs: provider.timeoutMs || 60000,
    models: provider.models || [],
    modelAliases: provider.modelAliases || {},
  };
}
