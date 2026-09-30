import { describe, it, expect } from "vitest";
import { isPrivateOrReservedIp, validateTargetUrl } from "../../src/lib/network/ssrf.js";
import {
  encryptSecret,
  decryptSecret,
  isSensitiveField,
  redactSecrets,
  sanitizeHeaders,
} from "../../src/lib/crypto.js";
import { testCustomProviderConnection } from "../../src/lib/customProviders/manager.js";

describe("Custom Providers & SSRF Protection", () => {
  describe("SSRF Protection (isPrivateOrReservedIp)", () => {
    it("identifies private and reserved IPv4 addresses", () => {
      expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("10.0.0.5")).toBe(true);
      expect(isPrivateOrReservedIp("192.168.1.100")).toBe(true);
      expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("172.31.255.255")).toBe(true);
      expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true); // Cloud metadata
      expect(isPrivateOrReservedIp("0.0.0.0")).toBe(true);
    });

    it("identifies private and reserved IPv6 addresses", () => {
      expect(isPrivateOrReservedIp("::1")).toBe(true);
      expect(isPrivateOrReservedIp("::")).toBe(true);
      expect(isPrivateOrReservedIp("fe80::1")).toBe(true); // Link-local
      expect(isPrivateOrReservedIp("fc00::1")).toBe(true); // Unique local
      expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true); // IPv4 mapped
    });

    it("allows public IP addresses", () => {
      expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
      expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
      expect(isPrivateOrReservedIp("104.26.4.15")).toBe(false);
    });
  });

  describe("URL Validation (validateTargetUrl)", () => {
    it("blocks localhost and loopback targets by default", async () => {
      const resLocalhost = await validateTargetUrl("http://localhost:8080/v1");
      expect(resLocalhost.safe).toBe(false);

      const resLoopback = await validateTargetUrl("http://127.0.0.1:3000/v1");
      expect(resLoopback.safe).toBe(false);

      const resMetadata = await validateTargetUrl("http://169.254.169.254/latest/meta-data");
      expect(resMetadata.safe).toBe(false);
    });

    it("blocks dangerous non-HTTP protocols", async () => {
      const resFile = await validateTargetUrl("file:///etc/passwd");
      expect(resFile.safe).toBe(false);

      const resFtp = await validateTargetUrl("ftp://ftp.example.com/api");
      expect(resFtp.safe).toBe(false);

      const resJs = await validateTargetUrl("javascript:alert(1)");
      expect(resJs.safe).toBe(false);
    });

    it("allows valid public HTTPS endpoints", async () => {
      const resPublic = await validateTargetUrl("https://api.openai.com/v1");
      expect(resPublic.safe).toBe(true);
    });
  });

  describe("AES-256-GCM Secret Encryption", () => {
    it("encrypts and decrypts secret keys accurately", () => {
      const originalKey = "sk-custom-secret-key-1234567890abcdef";
      const encrypted = encryptSecret(originalKey);

      expect(encrypted).not.toBe(originalKey);
      expect(encrypted).toContain(":"); // iv:tag:ciphertext format
      expect(encrypted.split(":").length).toBe(3);

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(originalKey);
    });

    it("handles empty or corrupted payloads safely", () => {
      expect(encryptSecret("")).toBe("");
      expect(decryptSecret("")).toBe("");
      expect(decryptSecret("corrupted:data")).toBe("");
      expect(decryptSecret("bad:hex:string")).toBe("");
    });
  });

  describe("Secret Redaction & Header Sanitization", () => {
    it("identifies sensitive field names", () => {
      expect(isSensitiveField("apiKey")).toBe(true);
      expect(isSensitiveField("api_key")).toBe(true);
      expect(isSensitiveField("authorization")).toBe(true);
      expect(isSensitiveField("password")).toBe(true);
      expect(isSensitiveField("secretToken")).toBe(true);
      expect(isSensitiveField("model")).toBe(false);
      expect(isSensitiveField("provider")).toBe(false);
    });

    it("redacts sensitive values in objects and strings", () => {
      const payload = {
        model: "custom-gpt",
        apiKey: "sk-real-secret-12345",
        nested: {
          token: "Bearer eyJhbGciOi...",
          count: 5,
        },
      };

      const sanitized = redactSecrets(payload);
      expect(sanitized.model).toBe("custom-gpt");
      expect(sanitized.apiKey).toBe("[REDACTED]");
      expect(sanitized.nested.token).toBe("[REDACTED]");
      expect(sanitized.nested.count).toBe(5);
    });

    it("sanitizes headers removing secrets", () => {
      const headers = {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-token-xyz",
        "X-API-Key": "my-secret-key",
      };

      const sanitized = sanitizeHeaders(headers);
      expect(sanitized["Content-Type"]).toBe("application/json");
      expect(sanitized.Authorization).toBe("[REDACTED]");
      expect(sanitized["X-API-Key"]).toBe("[REDACTED]");
    });
  });

  describe("testCustomProviderConnection SSRF prevention", () => {
    it("blocks connection test targeting local private network", async () => {
      const result = await testCustomProviderConnection({
        baseUrl: "http://127.0.0.1:9999/v1",
        apiKey: "test",
      });

      expect(result.success).toBe(false);
      expect(result.errorCategory).toBe("ssrf_violation");
    });
  });
});
