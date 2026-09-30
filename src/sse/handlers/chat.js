import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";

// Feature imports
import { isAutoModel, resolveAutoModel } from "open-sse/services/autoRouter.js";
import { resolveRequestTimeouts } from "@/lib/network/timeoutResolver.js";
import { classifyError, computeBackoffWithJitter } from "open-sse/services/errorClassifier.js";
import { validateApiKeyPermissions } from "@/shared/services/apiKeyPermissions.js";
import { getApiKeyByKey, incrementKeyUsage } from "@/lib/db/repos/apiKeysRepo.js";
import { getProjectById, incrementProjectSpend } from "@/lib/db/repos/projectsRepo.js";
import { getProviderHealthList } from "@/lib/db/repos/providerHealthRepo.js";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getCustomProviders } from "@/lib/db/repos/customProvidersRepo.js";

/**
 * Format a human-readable route visualization string.
 * Example: "auto/quality → gemini/flash (acc:1) [429] → anthropic/claude-3-5-sonnet (acc:2) [success]"
 */
export function buildRouteVisualization(requestedModel, attempts) {
  if (!attempts || attempts.length === 0) return requestedModel || "unknown";
  const parts = [requestedModel];
  for (const a of attempts) {
    const accLabel = a.connectionName || (a.connectionId ? a.connectionId.slice(0, 8) : "default");
    const statusLabel = a.success || a.status === 200
      ? "success"
      : (a.status ? `${a.status}` : (a.errorCategory || "failed"));
    parts.push(`${a.provider}/${a.model} (${accLabel}) [${statusLabel}]`);
  }
  return parts.join(" → ");
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }

  // Claude Code marks a 1M-context request as `<model>[1m]`
  let { model: modelStr, contextMarker } = stripModelContextMarker(body.model);
  if (contextMarker) body.model = modelStr;

  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Load API Key record from DB if present
  let keyObj = null;
  if (apiKey) {
    try {
      keyObj = await getApiKeyByKey(apiKey);
    } catch (err) {
      log.warn("AUTH", `Failed to load key record: ${err.message}`);
    }
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = keyObj ? (keyObj.isActive && keyObj.status !== "disabled") : await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  // Check key-level restrictions and usage limits
  if (keyObj) {
    if (keyObj.isActive === false || keyObj.status === "disabled") {
      log.warn("AUTH", `API key is disabled: ${keyObj.name || keyObj.id}`);
      return errorResponse(HTTP_STATUS.FORBIDDEN, "API key is disabled");
    }
    if (keyObj.expiresAt && new Date(keyObj.expiresAt).getTime() < Date.now()) {
      log.warn("AUTH", `API key has expired: ${keyObj.name || keyObj.id}`);
      return errorResponse(HTTP_STATUS.FORBIDDEN, "API key has expired");
    }
    const effectiveRequestLimit = keyObj.requestLimit || keyObj.permissions?.requestLimit;
    if (effectiveRequestLimit && (keyObj.requestCount || 0) >= effectiveRequestLimit) {
      log.warn("AUTH", `API key request limit exceeded: ${keyObj.requestCount}/${effectiveRequestLimit}`);
      return errorResponse(HTTP_STATUS.TOO_MANY_REQUESTS, `API key request limit exceeded (${keyObj.requestCount}/${effectiveRequestLimit})`);
    }
    const effectiveUsageLimit = keyObj.usageLimit || keyObj.permissions?.usageLimit;
    if (effectiveUsageLimit && (keyObj.totalSpend || 0) >= effectiveUsageLimit) {
      log.warn("AUTH", `API key usage limit exceeded: $${keyObj.totalSpend}/$${effectiveUsageLimit}`);
      return errorResponse(HTTP_STATUS.TOO_MANY_REQUESTS, `API key usage limit exceeded ($${keyObj.totalSpend}/$${effectiveUsageLimit})`);
    }
  }

  // Project resolution
  const requestedProjectId = request.headers.get("x-9router-project") || null;
  if (keyObj?.projectId && requestedProjectId && keyObj.projectId !== requestedProjectId) {
    log.warn("PROJECT", `API key is restricted to project ${keyObj.projectId} but request specified ${requestedProjectId}`);
    return errorResponse(HTTP_STATUS.FORBIDDEN, `API key is restricted to project: ${keyObj.projectId}`);
  }
  const projectId = keyObj?.projectId || requestedProjectId;
  let project = null;
  if (projectId) {
    try {
      project = await getProjectById(projectId);
      if (project) {
        if (project.isActive === false) {
          log.warn("PROJECT", `Project ${project.id} is disabled`);
          return errorResponse(HTTP_STATUS.FORBIDDEN, "Project is disabled");
        }
        if (project.usageLimit && (project.currentSpend || 0) >= project.usageLimit) {
          log.warn("PROJECT", `Project spend limit exceeded: $${project.currentSpend}/$${project.usageLimit}`);
          return errorResponse(HTTP_STATUS.TOO_MANY_REQUESTS, "Project budget limit exceeded");
        }
      }
    } catch (err) {
      log.warn("PROJECT", `Failed to resolve project ${projectId}: ${err.message}`);
    }
  }

  // If model is missing, check if project provides a default model
  if (!modelStr) {
    if (project?.defaultModel) {
      modelStr = project.defaultModel;
      body.model = modelStr;
    } else {
      log.warn("CHAT", "Missing model");
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
    }
  }

  // Bypass naming/warmup requests before rotation
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body);

  // Initialize Trace Object for Request Inspector
  const traceId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const trace = {
    id: traceId,
    requestedModel: modelStr,
    routingMode: null,
    selectedModel: null,
    apiKeyId: keyObj?.id || null,
    projectId: project?.id || null,
    attempts: [],
    startTime: Date.now(),
  };

  // 1. SMART AUTO MODEL ROUTING
  let candidateSequence = null;
  if (isAutoModel(modelStr)) {
    if (settings.smartRoutingEnabled === false) {
      log.warn("AUTO_ROUTER", "Smart Routing is globally disabled");
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "Smart Auto Model Routing is globally disabled");
    }

    // Gather candidate models from active connections and custom providers
    const activeConns = await getProviderConnections({ isActive: true });
    const activeProviders = new Set(activeConns.map((c) => c.provider));
    const customProviders = await getCustomProviders({ isActive: true });

    const builtInCandidates = [];
    for (const p of activeProviders) {
      if (p === "gemini" || p === "antigravity" || p === "gemini-cli") {
        builtInCandidates.push(`${p}/gemini-2.5-flash`, `${p}/gemini-2.5-pro`);
      } else if (p === "claude" || p === "anthropic") {
        builtInCandidates.push(`${p}/claude-3-5-sonnet`, `${p}/claude-3-5-haiku`);
      } else if (p === "codex" || p === "openai") {
        builtInCandidates.push(`${p}/gpt-4o`, `${p}/gpt-4o-mini`);
      } else if (p === "deepseek") {
        builtInCandidates.push(`${p}/deepseek-chat`, `${p}/deepseek-reasoner`);
      } else if (p === "groq") {
        builtInCandidates.push(`${p}/llama-3.3-70b-versatile`);
      } else if (p !== "zed") {
        builtInCandidates.push(`${p}/default`);
      }
    }
    for (const cp of customProviders) {
      const pId = cp.id.startsWith("custom-") ? cp.id : `custom-${cp.id}`;
      for (const m of (cp.models || [])) {
        const mId = typeof m === "string" ? m : (m.id || m.name);
        if (mId) {
          builtInCandidates.push(`${pId}/${mId}`);
        }
      }
    }

    let providerHealth = [];
    try {
      providerHealth = await getProviderHealthList();
    } catch {
      providerHealth = [];
    }

    const resolved = resolveAutoModel({
      requestedModel: modelStr,
      body,
      settings,
      candidateModels: builtInCandidates,
      providerHealth,
      project,
      apiKeyPermissions: keyObj?.permissions,
    });

    if (!resolved.selectedModel) {
      log.warn("AUTO_ROUTER", `No candidates found for ${modelStr}`);
      return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, `No available model candidates for ${modelStr}`);
    }

    trace.routingMode = resolved.mode;
    trace.selectedModel = resolved.selectedModel;
    modelStr = resolved.selectedModel;
    candidateSequence = resolved.candidateModels?.length ? resolved.candidateModels : [resolved.selectedModel];
    log.info("AUTO_ROUTER", `Auto routed "${trace.requestedModel}" → "${modelStr}" (${resolved.mode}): ${resolved.explanation}`);
  }

  // 2. CHECK COMBO MODELS (If not an auto model)
  if (!candidateSequence) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const comboStrategies = settings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
      const augmentedModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings);
      const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return executeModelPipeline({
              body: b,
              candidateSequence: [m],
              clientRawRequest: cleanRawReq,
              request,
              apiKey,
              keyObj,
              project,
              trace,
              settings
            });
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = settings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy})`);
      return handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => executeModelPipeline({
            body: b,
            candidateSequence: [m],
            clientRawRequest,
            request,
            apiKey,
            keyObj,
            project,
            trace,
            settings
          }),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });
    }

    // Capacity adapter check for single model
    const soloAugmented = augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings);
    if (soloAugmented.length > 1) {
      const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
      log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
      return handleComboChat({
        body,
        models: soloAugmented,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => executeModelPipeline({
            body: b,
            candidateSequence: [m],
            clientRawRequest,
            request,
            apiKey,
            keyObj,
            project,
            trace,
            settings
          }),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
      });
    }

    // Single model sequence (honor project fallbackSequence if present)
    if (project?.fallbackSequence && Array.isArray(project.fallbackSequence) && project.fallbackSequence.length > 0) {
      candidateSequence = [modelStr, ...project.fallbackSequence.filter((m) => m !== modelStr)];
    } else {
      candidateSequence = [modelStr];
    }
  }

  // 3. EXECUTE ROUTING PIPELINE ACROSS CANDIDATES
  return executeModelPipeline({
    body,
    candidateSequence,
    clientRawRequest,
    request,
    apiKey,
    keyObj,
    project,
    trace,
    settings
  });
}

/**
 * Execute request across candidate models and accounts with smart retry,
 * error classification, timeout resolution, and full tracing.
 */
async function executeModelPipeline({
  body,
  candidateSequence,
  clientRawRequest,
  request,
  apiKey,
  keyObj,
  project,
  trace,
  settings
}) {
  const userAgent = request?.headers?.get("user-agent") || "";
  let lastError = null;
  let lastStatus = null;
  let lastHeaders = null;
  let earliestRetryAfter = null;

  for (let candidateIdx = 0; candidateIdx < candidateSequence.length; candidateIdx++) {
    const currentModelStr = candidateSequence[candidateIdx];
    const modelInfo = await getModelInfo(currentModelStr);

    if (!modelInfo.provider) {
      log.warn("CHAT", `Model info not resolvable for candidate: ${currentModelStr}`);
      continue;
    }

    const { provider, model } = modelInfo;

    // Server-side API key permissions check
    if (keyObj && keyObj.permissions) {
      const permCheck = validateApiKeyPermissions(keyObj, {
        provider,
        model,
        projectId: project?.id
      });
      if (!permCheck.allowed) {
        log.warn("AUTH", `Permission denied for ${provider}/${model}: ${permCheck.reason}`);
        if (candidateSequence.length === 1) {
          return errorResponse(permCheck.statusCode || HTTP_STATUS.FORBIDDEN, permCheck.reason);
        }
        // Fall through to next candidate if available
        continue;
      }
    }

    // Resolve timeouts for this specific provider and model
    const timeoutConfig = resolveRequestTimeouts({
      globalSettings: settings,
      project,
      provider,
      model,
      body
    });

    const excludeConnectionIds = new Set();
    let accountAttempts = 0;

    while (true) {
      if (++accountAttempts > 5) {
        log.warn("CHAT", `Exceeded max account attempts (5) for ${provider}/${model}`);
        break;
      }
      const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

      // No accounts available for this candidate
      if (!credentials || credentials.allRateLimited) {
        if (credentials?.allRateLimited) {
          lastError = credentials.lastError || "Rate limited";
          lastStatus = HTTP_STATUS.SERVICE_UNAVAILABLE;
          if (credentials.retryAfter && (!earliestRetryAfter || new Date(credentials.retryAfter) < new Date(earliestRetryAfter))) {
            earliestRetryAfter = credentials.retryAfter;
          }
        }
        trace.attempts.push({
          attempt: trace.attempts.length + 1,
          provider,
          model,
          connectionId: null,
          connectionName: "none",
          status: lastStatus || 503,
          errorCategory: "rate_limit",
          reason: "All provider accounts unavailable or rate limited",
          duration: 0,
          success: false
        });
        break; // Break account loop, proceed to next candidate model
      }

      const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

      // Cold miss fix for project ID
      if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
        const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
        if (pid) {
          refreshedCredentials.projectId = pid;
          updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => {});
        }
      }

      const attemptStart = Date.now();
      const currentAttempt = trace.attempts.length + 1;

      const traceMetadata = {
        id: trace.id,
        apiKeyId: keyObj?.id,
        projectId: project?.id,
        requestedModel: trace.requestedModel,
        selectedModel: `${provider}/${model}`,
        routingMode: trace.routingMode || "direct",
        retryCount: currentAttempt - 1,
        routingTrace: trace.attempts,
        routeVisualization: buildRouteVisualization(trace.requestedModel, trace.attempts),
      };

      const chatSettings = await getSettings();
      const providerThinking = (chatSettings.providerThinking || {})[provider] || null;

      const result = await handleChatCore({
        body: { ...body, model: `${provider}/${model}` },
        modelInfo: { provider, model },
        credentials: refreshedCredentials,
        log,
        clientRawRequest,
        connectionId: credentials.connectionId,
        userAgent,
        apiKey,
        ccFilterNaming: !!chatSettings.ccFilterNaming,
        rtkEnabled: !!chatSettings.rtkEnabled,
        headroomEnabled: !!chatSettings.headroomEnabled,
        headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
        headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
        headroomTimeoutMs: chatSettings.headroomTimeoutMs,
        cavemanEnabled: !!chatSettings.cavemanEnabled,
        cavemanLevel: chatSettings.cavemanLevel || "full",
        ponytailEnabled: !!chatSettings.ponytailEnabled,
        ponytailLevel: chatSettings.ponytailLevel || "full",
        pxpipeEnabled: !!chatSettings.pxpipeEnabled,
        pxpipeMinChars: chatSettings.pxpipeMinChars,
        pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
        pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
        onPxpipeEvent: appendPxpipeEvent,
        providerThinking,
        sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
        timeoutConfig,
        traceMetadata,
        onCredentialsRefreshed: async (newCreds) => {
          await updateProviderCredentials(credentials.connectionId, {
            ...newCreds,
            existingProviderSpecificData: credentials.providerSpecificData,
            testStatus: "active"
          });
        },
        onRequestSuccess: async () => {
          await clearAccountError(credentials.connectionId, credentials, model);
          clearAntigravityStrikes(credentials.connectionId, model);
        }
      });

      const attemptDuration = Date.now() - attemptStart;

      if (result.success) {
        trace.attempts.push({
          attempt: currentAttempt,
          provider,
          model,
          connectionId: credentials.connectionId,
          connectionName: credentials.name || credentials.email || credentials.connectionId?.slice(0, 8),
          status: 200,
          success: true,
          duration: attemptDuration
        });

        // Record usage counts in DB
        if (keyObj) {
          incrementKeyUsage(keyObj.id, 0).catch(() => {});
        }
        if (project) {
          incrementProjectSpend(project.id, 0).catch(() => {});
        }

        return result.response;
      }

      // Provider call failed: Classify the error
      const classified = classifyError(result.status, result.error, {
        wasStreaming: body.stream,
        bytesReceived: 0,
      });

      trace.attempts.push({
        attempt: currentAttempt,
        provider,
        model,
        connectionId: credentials.connectionId,
        connectionName: credentials.name || credentials.email || credentials.connectionId?.slice(0, 8),
        status: result.status,
        errorCategory: classified.category,
        reason: classified.reason,
        duration: attemptDuration,
        success: false
      });

      lastError = result.error || classified.sanitizedMessage;
      lastStatus = result.status;
      lastHeaders = upstreamResponseHeaders(result.response?.headers);

      // Deterministic validation errors (e.g. 400 Bad Request client error) must never retry
      if (!classified.retryable || !classified.shouldFallback) {
        log.warn("CHAT", `Non-retryable error [${classified.category}] ${result.status}: ${lastError}`);
        return result.response;
      }

      // Handle Antigravity specific quota resets
      let quotaResetMs = null;
      let resetsAtMs = result.resetsAtMs;
      if (provider === "antigravity" && (result.status === 409 || result.status === 429)) {
        quotaResetMs = await handleAntigravityQuotaError(
          credentials.connectionId,
          result.status,
          model,
          refreshedCredentials.accessToken,
          credentials.providerSpecificData
        );
        if (quotaResetMs) resetsAtMs = quotaResetMs;
      }

      const shouldFallback = provider === "antigravity" && quotaResetMs
        ? true
        : (await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs)).shouldFallback;

      if (shouldFallback) {
        log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName || credentials.name || credentials.connectionId?.slice(0, 8)} (${result.status}) → NEXT ACCOUNT`);
        excludeConnectionIds.add(credentials.connectionId);

        // Exponential backoff with jitter before next account
        if (classified.backoff) {
          const backoffDelay = computeBackoffWithJitter(currentAttempt);
          await new Promise((r) => setTimeout(r, Math.min(backoffDelay, 2000)));
        }
        continue;
      }

      // If account fallback was not suggested, break account loop and try next candidate
      break;
    }
  }

  // All candidates & accounts exhausted
  const finalVisualization = buildRouteVisualization(trace.requestedModel, trace.attempts);
  log.warn("CHAT", `All routing attempts exhausted: ${finalVisualization}`);

  if (earliestRetryAfter) {
    return unavailableResponse(
      lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
      `[All candidates exhausted] ${lastError || "Service Unavailable"}`,
      earliestRetryAfter,
      "quota reset pending",
      lastHeaders
    );
  }

  return errorResponse(
    lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
    lastError || "All providers and accounts unavailable",
    lastHeaders
  );
}
