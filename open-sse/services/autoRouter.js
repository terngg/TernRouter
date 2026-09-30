import { detectRequiredCapabilities } from "./combo.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { getPricingForModel, isFreeModel } from "../providers/pricing.js";
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { matchPattern } from "../providers/pricing.js";

export const AUTO_MODES = {
  BALANCED: "balanced",
  FAST: "fast",
  CHEAP: "cheap",
  QUALITY: "quality",
};

/**
 * Check if a model string refers to the Smart Auto Router
 */
export function isAutoModel(modelStr) {
  if (!modelStr || typeof modelStr !== "string") return false;
  const s = modelStr.trim().toLowerCase();
  return (
    s === "auto" ||
    s.startsWith("auto/") ||
    s.startsWith("auto:") ||
    s === "auto/balanced" ||
    s === "auto/fast" ||
    s === "auto/cheap" ||
    s === "auto/quality"
  );
}

/**
 * Parse routing mode from model string
 */
export function parseAutoMode(modelStr, fallbackMode = AUTO_MODES.BALANCED) {
  if (!modelStr || typeof modelStr !== "string") return fallbackMode;
  const s = modelStr.trim().toLowerCase();
  if (s.includes("/fast") || s.includes(":fast")) return AUTO_MODES.FAST;
  if (s.includes("/cheap") || s.includes(":cheap")) return AUTO_MODES.CHEAP;
  if (s.includes("/quality") || s.includes(":quality")) return AUTO_MODES.QUALITY;
  if (s.includes("/balanced") || s.includes(":balanced")) return AUTO_MODES.BALANCED;
  return fallbackMode;
}

/**
 * Analyze incoming request body to detect developer intent and needed capabilities
 */
export function analyzeRequestIntent(body) {
  const requiredCapabilities = detectRequiredCapabilities(body);
  const hasTools = Boolean(Array.isArray(body?.tools) && body.tools.length > 0) || Boolean(body?.tool_choice);

  // Extract message text for heuristic scanning
  let fullText = "";
  if (Array.isArray(body?.messages)) {
    for (const msg of body.messages) {
      if (typeof msg?.content === "string") fullText += " " + msg.content;
      else if (Array.isArray(msg?.content)) {
        for (const part of msg.content) {
          if (part?.type === "text" && part.text) fullText += " " + part.text;
        }
      }
    }
  } else if (typeof body?.prompt === "string") {
    fullText = body.prompt;
  }

  const charCount = fullText.length;
  const isLongContext = charCount > 100000; // ~25k-30k tokens
  const isSimple = charCount < 120 && !hasTools && requiredCapabilities.size === 0;

  // Reasoning detection
  const isExplicitReasoning =
    body?.thinking?.type === "enabled" ||
    Boolean(body?.reasoning_effort) ||
    Boolean(body?.thinking);

  const reasoningKeywords = /\b(proof|prove|derive|step[- ]by[- ]step reasoning|solve the equation|mathematical|algorithm analysis)\b/i;
  const isReasoning = isExplicitReasoning || reasoningKeywords.test(fullText);

  // Coding detection
  const codePatterns = /(```|function\s*\(|class\s+[A-Za-z]|import\s+.*from|const\s+.*=|<\/?[a-z][\s\S]*>|def\s+[a-z_])/;
  const isCoding = codePatterns.test(fullText) || /\b(bug|refactor|pull request|typescript|javascript|python|git|stack trace)\b/i.test(fullText);

  return {
    requiredCapabilities, // Set<string>: "vision", "pdf", "audioInput", "videoInput"
    hasVision: requiredCapabilities.has("vision"),
    hasTools,
    isReasoning,
    isCoding,
    isLongContext,
    isSimple,
    charCount,
  };
}

export const detectRequestIntent = analyzeRequestIntent;

/**
 * Classify model speed and pricing tiers
 */
function classifyModelTraits(provider, modelId) {
  const lower = modelId.toLowerCase();

  // Speed class
  let speedClass = "standard";
  if (/flash|mini|haiku|instant|lite|turbo|small/i.test(lower)) {
    speedClass = "fast";
  } else if (/opus|pro|max|r1|qwq|high/i.test(lower)) {
    speedClass = "slow";
  }

  // Cost class
  const pricing = getPricingForModel(provider, modelId);
  const isFree = isFreeModel(modelId) || (pricing && pricing.input === 0 && pricing.output === 0);
  let costClass = "medium";
  if (isFree) {
    costClass = "free";
  } else if (pricing && pricing.input <= 0.6) {
    costClass = "low";
  } else if (pricing && pricing.input >= 5.0) {
    costClass = "high";
  }

  return { speedClass, costClass, pricing };
}

/**
 * Score a candidate model according to intent and routing mode
 */
function scoreCandidate(candidate, intent, mode) {
  let score = 50;

  // 1. Modality & Tools requirements (Hard constraints)
  for (const reqCap of intent.requiredCapabilities) {
    if (!candidate.caps[reqCap]) return -9999; // Lacks required input modality
  }
  if (intent.hasTools && !candidate.caps.tools) {
    return -9999; // Lacks tool calling support
  }

  // 2. Health penalties
  if (candidate.healthStatus === "slow") score -= 15;
  if (candidate.healthStatus === "rate_limited") score -= 80;
  if (candidate.healthStatus === "quota_low") score -= 25;
  if (candidate.healthStatus === "quota_exhausted") return -9999;
  if (candidate.healthStatus === "auth_failed") return -9999;
  if (candidate.healthStatus === "provider_error") score -= 50;

  // 3. Intent alignment
  if (intent.isReasoning) {
    if (candidate.caps.reasoning) score += 35;
    else score -= 20;
  }
  if (intent.isCoding) {
    if (/codex|claude|sonnet|opus|gpt-5|deepseek|qwen/i.test(candidate.modelId)) score += 25;
  }
  if (intent.isLongContext) {
    if (candidate.caps.contextWindow >= 500000) score += 30;
    else if (candidate.caps.contextWindow < 128000) score -= 30;
  }
  if (intent.isSimple) {
    if (candidate.speedClass === "fast") score += 20;
    if (candidate.costClass === "free" || candidate.costClass === "low") score += 15;
  }

  // 4. Mode-specific weighting
  switch (mode) {
    case AUTO_MODES.FAST:
      if (candidate.speedClass === "fast") score += 45;
      if (candidate.speedClass === "slow") score -= 35;
      if (candidate.latencyMs && candidate.latencyMs > 0) {
        score -= Math.min(candidate.latencyMs / 100, 30);
      }
      break;

    case AUTO_MODES.CHEAP:
      if (candidate.costClass === "free") score += 60;
      else if (candidate.costClass === "low") score += 30;
      else if (candidate.costClass === "high") score -= 50;
      break;

    case AUTO_MODES.QUALITY:
      if (/opus|sonnet|gpt-5|gpt-4o|gemini-2\.5-pro|pro|r1/i.test(candidate.modelId)) score += 50;
      if (candidate.caps.reasoning) score += 25;
      if (candidate.speedClass === "fast" && !candidate.caps.reasoning) score -= 20;
      break;

    case AUTO_MODES.BALANCED:
    default:
      if (candidate.speedClass === "fast") score += 15;
      if (candidate.costClass === "free" || candidate.costClass === "low") score += 20;
      if (candidate.caps.reasoning && (intent.isReasoning || intent.isCoding)) score += 20;
      break;
  }

  return score;
}

/**
 * Main Smart Auto Router logic: selects optimal model and ordered fallback sequence
 *
 * @param {object} options
 * @param {object} options.body - Request body
 * @param {string} [options.requestedModel="auto"] - Requested virtual model
 * @param {Array} options.availableConnections - List of active providerConnections
 * @param {object} [options.apiKeyRecord] - API key record for permissions enforcement
 * @param {object} [options.project] - Project profile rules
 * @param {Array} [options.healthRecords=[]] - Provider health states
 * @param {Set<string>} [options.disabledModels=new Set()] - Set of disabled model strings
 * @param {object} [options.settings={}] - Global settings
 * @returns {{
 *   selectedModel: string,
 *   fallbackSequence: string[],
 *   mode: string,
 *   intent: object,
 *   explanation: string
 * }}
 */
export function resolveAutoModel({
  body,
  requestedModel = "auto",
  availableConnections = [],
  candidateModels = null,
  apiKeyRecord = null,
  apiKeyPermissions = null,
  project = null,
  healthRecords = [],
  providerHealth = null,
  disabledModels = new Set(),
  settings = {},
}) {
  const mode = parseAutoMode(requestedModel, project?.routingMode || settings?.autoRoutingDefaultMode || AUTO_MODES.BALANCED);
  const intent = analyzeRequestIntent(body);

  const effectiveHealth = providerHealth || healthRecords || [];
  const effectivePermissions = apiKeyPermissions || apiKeyRecord?.permissions || null;

  // Index health records by `${provider}:${model}` and `${provider}`
  const healthMap = new Map();
  for (const h of effectiveHealth) {
    if (!h.provider) continue;
    const provs = [h.provider, resolveProviderId(h.provider), PROVIDER_ID_TO_ALIAS[h.provider]].filter(Boolean);
    for (const p of provs) {
      if (h.model) {
        healthMap.set(`${p}:${h.model}`, h);
        healthMap.set(`${p}/${h.model}`, h);
      }
      healthMap.set(p, h);
    }
  }

  // Build pool of candidates
  const candidates = [];

  // Branch A: Candidate models provided directly (e.g. from chat handler or test)
  if (Array.isArray(candidateModels) && candidateModels.length > 0) {
    for (const fullSpec of candidateModels) {
      const slash = fullSpec.indexOf("/");
      const providerId = slash > 0 ? fullSpec.slice(0, slash) : "unknown";
      const modelId = slash > 0 ? fullSpec.slice(slash + 1) : fullSpec;
      const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;

      // Project provider filter
      if (project?.allowedProviders && project.allowedProviders.length > 0) {
        if (!project.allowedProviders.includes(providerId) && !project.allowedProviders.includes(alias)) continue;
      }

      // API key provider filter
      if (effectivePermissions?.allowedProviders && effectivePermissions.allowedProviders.length > 0) {
        const allowed = effectivePermissions.allowedProviders.map((p) => resolveProviderId(p).toLowerCase());
        if (!allowed.includes(providerId.toLowerCase()) && !allowed.includes(alias.toLowerCase())) continue;
      }

      // Check disabled models
      if (disabledModels.has(fullSpec) || disabledModels.has(modelId)) continue;

      // Project model filter
      if (project?.allowedModels && project.allowedModels.length > 0) {
        const matchesProj = project.allowedModels.some((p) => matchPattern(p, modelId) || matchPattern(p, fullSpec));
        if (!matchesProj) continue;
      }

      // API key model filter
      if (effectivePermissions?.allowedModels && effectivePermissions.allowedModels.length > 0) {
        const matchesKey = effectivePermissions.allowedModels.some((p) => matchPattern(p, modelId) || matchPattern(p, fullSpec));
        if (!matchesKey) continue;
      }

      const caps = getCapabilitiesForModel(alias, modelId);
      const traits = classifyModelTraits(alias, modelId);

      if (effectivePermissions?.freeOnly === true && traits.costClass !== "free") continue;
      if (effectivePermissions?.paidAllowed === false && traits.costClass !== "free") continue;

      const healthItem = healthMap.get(`${alias}:${modelId}`) || healthMap.get(`${alias}/${modelId}`) || healthMap.get(`${providerId}:${modelId}`) || healthMap.get(`${providerId}/${modelId}`) || healthMap.get(alias) || healthMap.get(providerId);
      const healthStatus = healthItem?.status || "unknown";
      const latencyMs = healthItem?.latencyMs || 0;

      const candidate = {
        provider: alias,
        modelId,
        fullSpec,
        caps,
        ...traits,
        healthStatus,
        latencyMs,
      };

      const score = scoreCandidate(candidate, intent, mode);
      if (score > 0) {
        candidates.push({ ...candidate, score });
      }
    }
  } else {
    // Branch B: Scan active connections
    const activeProviders = new Set(availableConnections.map((c) => c.provider));

    for (const providerId of activeProviders) {
      const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;

      if (project?.allowedProviders && project.allowedProviders.length > 0) {
        if (!project.allowedProviders.includes(providerId) && !project.allowedProviders.includes(alias)) continue;
      }

      if (effectivePermissions?.allowedProviders && effectivePermissions.allowedProviders.length > 0) {
        const allowed = effectivePermissions.allowedProviders.map((p) => resolveProviderId(p).toLowerCase());
        if (!allowed.includes(providerId.toLowerCase()) && !allowed.includes(alias.toLowerCase())) continue;
      }

      const models = getProviderModels(alias);
      for (const m of models) {
        const modelId = m.id;
        const fullModelSpec = `${alias}/${modelId}`;

        if (disabledModels.has(fullModelSpec) || disabledModels.has(modelId)) continue;

        if (project?.allowedModels && project.allowedModels.length > 0) {
          const matchesProj = project.allowedModels.some((p) => matchPattern(p, modelId) || matchPattern(p, fullModelSpec));
          if (!matchesProj) continue;
        }

        if (effectivePermissions?.allowedModels && effectivePermissions.allowedModels.length > 0) {
          const matchesKey = effectivePermissions.allowedModels.some((p) => matchPattern(p, modelId) || matchPattern(p, fullModelSpec));
          if (!matchesKey) continue;
        }

        const caps = getCapabilitiesForModel(alias, modelId);
        const traits = classifyModelTraits(alias, modelId);

        if (effectivePermissions?.freeOnly === true && traits.costClass !== "free") continue;
        if (effectivePermissions?.paidAllowed === false && traits.costClass !== "free") continue;

        const healthItem = healthMap.get(`${alias}:${modelId}`) || healthMap.get(`${alias}/${modelId}`) || healthMap.get(alias);
        const healthStatus = healthItem?.status || "unknown";
        const latencyMs = healthItem?.latencyMs || 0;

        const candidate = {
          provider: alias,
          modelId,
          fullSpec: fullModelSpec,
          caps,
          ...traits,
          healthStatus,
          latencyMs,
        };

        const score = scoreCandidate(candidate, intent, mode);
        if (score > 0) {
          candidates.push({ ...candidate, score });
        }
      }
    }
  }

  // Sort descending by score
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    const fallback = project?.defaultModel || (Array.isArray(candidateModels) && candidateModels[0]) || "gemini/gemini-2.5-flash";
    return {
      selectedModel: fallback,
      fallbackSequence: [],
      candidateModels: [fallback],
      mode,
      intent,
      explanation: `No candidate perfectly matched requirements. Using fallback ${fallback}.`,
    };
  }

  const selected = candidates[0];
  const fallbackSequence = candidates.slice(1, 5).map((c) => c.fullSpec);
  const orderedCandidates = candidates.map((c) => c.fullSpec);

  const intentSummary = [];
  if (intent.requiredCapabilities.size > 0) intentSummary.push(`modality:[${[...intent.requiredCapabilities].join(",")}]`);
  if (intent.hasTools) intentSummary.push("tools");
  if (intent.isReasoning) intentSummary.push("reasoning");
  if (intent.isCoding) intentSummary.push("coding");
  if (intent.isLongContext) intentSummary.push("long-context");
  if (intent.isSimple) intentSummary.push("simple");

  const explanation = `Selected ${selected.fullSpec} (mode: ${mode}, score: ${selected.score.toFixed(0)}, traits: [${selected.speedClass}, ${selected.costClass}], intent: [${intentSummary.join(", ") || "standard"}])`;

  return {
    selectedModel: selected.fullSpec,
    fallbackSequence,
    candidateModels: orderedCandidates,
    mode,
    intent,
    explanation,
  };
}
