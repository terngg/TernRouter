import { resolveProviderId } from "@/shared/constants/providers.js";
import { isFreeModel } from "open-sse/providers/pricing.js";
import { matchPattern } from "open-sse/providers/pricing.js";

/**
 * Server-side validator for API key permissions & scopes
 *
 * @param {object} apiKeyRecord - API key object from DB
 * @param {object} context
 * @param {string} [context.provider]
 * @param {string} [context.model]
 * @param {string} [context.connectionId]
 * @returns {{ allowed: boolean, reason?: string, statusCode?: number }}
 */
export function validateKeyPermissions(apiKeyRecord, context = {}) {
  // If no apiKeyRecord provided (e.g. local mode when requireApiKey=false), allow
  if (!apiKeyRecord) return { allowed: true };

  // 1. Key must be active
  if (apiKeyRecord.isActive === false) {
    return {
      allowed: false,
      reason: "API key is disabled or inactive",
      statusCode: 401,
    };
  }

  const permissions = apiKeyRecord.permissions;
  // Backward compatibility: existing unrestricted keys have no permissions object
  if (!permissions || typeof permissions !== "object") {
    return { allowed: true };
  }

  const {
    allowedProviders,
    allowedModels,
    allowedAccounts,
    freeOnly,
    paidAllowed,
    usageLimit,
    requestLimit,
  } = permissions;

  // 2. Request limit enforcement
  if (typeof requestLimit === "number" && requestLimit > 0) {
    const currentRequests = apiKeyRecord.requestCount || 0;
    if (currentRequests >= requestLimit) {
      return {
        allowed: false,
        reason: `API key request limit exceeded (${currentRequests}/${requestLimit})`,
        statusCode: 429,
      };
    }
  }

  // 3. Usage/spend limit enforcement (USD)
  if (typeof usageLimit === "number" && usageLimit > 0) {
    const currentSpend = apiKeyRecord.totalSpend || 0;
    if (currentSpend >= usageLimit) {
      return {
        allowed: false,
        reason: `API key usage limit exceeded ($${currentSpend.toFixed(2)}/$${usageLimit.toFixed(2)})`,
        statusCode: 429,
      };
    }
  }

  // Project binding enforcement
  if (apiKeyRecord.projectId) {
    if (context.projectId && context.projectId !== apiKeyRecord.projectId) {
      return {
        allowed: false,
        reason: `API key is restricted to project: ${apiKeyRecord.projectId}`,
        statusCode: 403,
      };
    }
  }

  const provider = context.provider ? resolveProviderId(context.provider) : null;
  const rawModel = context.model || "";
  const modelBase = rawModel.includes("/") ? rawModel.split("/").pop() : rawModel;
  const isModelFree =
    isFreeModel(rawModel) ||
    isFreeModel(modelBase) ||
    rawModel.toLowerCase().includes("free") ||
    modelBase.toLowerCase().includes("free");

  // 4. Free models only restriction
  if (freeOnly === true && !isModelFree) {
    return {
      allowed: false,
      reason: `API key is restricted to free models only. "${rawModel}" is a paid model.`,
      statusCode: 403,
    };
  }

  // 5. Paid models disallowed restriction
  if (paidAllowed === false && !isModelFree) {
    return {
      allowed: false,
      reason: `API key does not allow access to paid models. "${rawModel}" requires billing.`,
      statusCode: 403,
    };
  }

  // 6. Allowed providers check
  if (provider && Array.isArray(allowedProviders) && allowedProviders.length > 0) {
    const resolvedAllowed = allowedProviders.map((p) => resolveProviderId(p).toLowerCase());
    const targetProvider = provider.toLowerCase();
    const isAllowed = resolvedAllowed.some(
      (p) => p === targetProvider || targetProvider.startsWith(`${p}-`) || p.startsWith(`${targetProvider}-`)
    );
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `API key does not have permission to access provider: ${provider} (Allowed: ${allowedProviders.join(", ")})`,
        statusCode: 403,
      };
    }
  }

  // 7. Allowed models check
  if (rawModel && Array.isArray(allowedModels) && allowedModels.length > 0) {
    const isAllowed = allowedModels.some((pattern) => {
      const p = pattern.trim();
      if (!p) return false;
      return (
        matchPattern(p, rawModel) ||
        matchPattern(p, modelBase) ||
        rawModel.toLowerCase() === p.toLowerCase() ||
        modelBase.toLowerCase() === p.toLowerCase()
      );
    });

    if (!isAllowed) {
      return {
        allowed: false,
        reason: `API key does not have permission to access model: ${rawModel}`,
        statusCode: 403,
      };
    }
  }

  // 8. Allowed accounts check
  if (context.connectionId && Array.isArray(allowedAccounts) && allowedAccounts.length > 0) {
    if (!allowedAccounts.includes(context.connectionId)) {
      return {
        allowed: false,
        reason: `API key does not have permission to access account: ${context.connectionId}`,
        statusCode: 403,
      };
    }
  }

  return { allowed: true };
}

export const validateApiKeyPermissions = validateKeyPermissions;
