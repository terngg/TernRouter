import { describe, it, expect } from "vitest";
import {
  classifyError,
  computeBackoffWithJitter,
  ERROR_CATEGORIES,
} from "../../open-sse/services/errorClassifier.js";

describe("Smart Retry + Fallback Engine", () => {
  describe("classifyError", () => {
    it("classifies HTTP 429 as retryable rate limit with backoff", () => {
      const err = classifyError(429, "Too many requests, rate limit reached");
      expect(err.category).toBe(ERROR_CATEGORIES.RATE_LIMIT);
      expect(err.retryable).toBe(true);
      expect(err.shouldFallback).toBe(true);
      expect(err.backoff).toBe(true);
    });

    it("classifies quota exhaustion as fallback with long cooldown", () => {
      const err = classifyError(429, "Resource has been exhausted: check quota");
      expect(err.category).toBe(ERROR_CATEGORIES.QUOTA_EXHAUSTED);
      expect(err.retryable).toBe(true);
      expect(err.shouldFallback).toBe(true);
      expect(err.cooldownMs).toBeGreaterThanOrEqual(60000);
    });

    it("classifies upstream 503 as provider overload", () => {
      const err = classifyError(503, "Service unavailable, server temporarily overloaded");
      expect(err.category).toBe(ERROR_CATEGORIES.PROVIDER_OVERLOAD);
      expect(err.retryable).toBe(true);
      expect(err.shouldFallback).toBe(true);
    });

    it("classifies upstream 504 / 408 as timeout", () => {
      const err504 = classifyError(504, "Gateway Timeout");
      expect(err504.category).toBe(ERROR_CATEGORIES.TIMEOUT);
      expect(err504.retryable).toBe(true);

      const err408 = classifyError(408, "Request Timeout");
      expect(err408.category).toBe(ERROR_CATEGORIES.TIMEOUT);
      expect(err408.retryable).toBe(true);
    });

    it("does NOT retry deterministic client validation errors (HTTP 400)", () => {
      const err = classifyError(400, "Invalid JSON body: unexpected token");
      expect(err.category).toBe(ERROR_CATEGORIES.BAD_REQUEST);
      expect(err.retryable).toBe(false);
      expect(err.shouldFallback).toBe(false);
    });

    it("does NOT retry API key permission errors", () => {
      const err = classifyError(403, "API key does not have permission for this provider");
      expect(err.category).toBe(ERROR_CATEGORIES.PERMISSION_DENIED);
      expect(err.retryable).toBe(false);
      expect(err.shouldFallback).toBe(false);
    });

    it("classifies stream drops as stream_interrupted", () => {
      const err = classifyError(null, "Premature end of stream", { wasStreaming: true, bytesReceived: 50 });
      expect(err.category).toBe(ERROR_CATEGORIES.STREAM_INTERRUPTED);
      expect(err.retryable).toBe(true);
    });
  });

  describe("computeBackoffWithJitter", () => {
    it("calculates exponential delays with random jitter", () => {
      const b1 = computeBackoffWithJitter(1, 1000, 15000);
      const b2 = computeBackoffWithJitter(2, 1000, 15000);
      const b3 = computeBackoffWithJitter(3, 1000, 15000);

      expect(b1).toBeGreaterThanOrEqual(1000);
      expect(b1).toBeLessThanOrEqual(1500);

      expect(b2).toBeGreaterThanOrEqual(2000);
      expect(b2).toBeLessThanOrEqual(2500);

      expect(b3).toBeGreaterThanOrEqual(4000);
      expect(b3).toBeLessThanOrEqual(4500);
    });

    it("caps maximum delay at maxMs", () => {
      const highAttempt = computeBackoffWithJitter(10, 1000, 15000);
      expect(highAttempt).toBeLessThanOrEqual(15000);
    });
  });
});
