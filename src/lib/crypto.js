import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const SALT = "9router-secret-key-salt";

function getMasterKey() {
  const secret = process.env.API_KEY_SECRET || process.env.MACHINE_ID_SALT || "9router-secure-master-secret";
  return crypto.createHash("sha256").update(secret + SALT).digest();
}

/**
 * Encrypt plaintext using AES-256-GCM
 * Returns string formatted as "iv:tag:ciphertext" (hex encoded)
 */
export function encryptSecret(plaintext) {
  if (!plaintext) return "";
  try {
    const key = getMasterKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
  } catch (err) {
    console.error("[crypto] Encryption failed:", err.message);
    throw new Error("Encryption failed");
  }
}

/**
 * Decrypt string formatted as "iv:tag:ciphertext"
 */
export function decryptSecret(encryptedPayload) {
  if (!encryptedPayload || typeof encryptedPayload !== "string") return "";
  const parts = encryptedPayload.split(":");
  if (parts.length !== 3) return "";
  try {
    const key = getMasterKey();
    const [ivHex, tagHex, cipherHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (err) {
    // Decryption failure (corrupt payload or wrong key)
    return "";
  }
}

const SENSITIVE_KEY_PATTERNS = [
  /api[-_]?key/i,
  /access[-_]?token/i,
  /refresh[-_]?token/i,
  /auth/i,
  /secret/i,
  /password/i,
  /cookie/i,
  /bearer/i,
  /token/i,
  /credential/i,
  /private[-_]?key/i,
];

/**
 * Check if a field name is considered sensitive
 */
export function isSensitiveField(fieldName) {
  if (!fieldName || typeof fieldName !== "string") return false;
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(fieldName));
}

/**
 * Deeply redact secrets from an object or array without mutating the input
 */
export function redactSecrets(obj, depth = 0) {
  if (depth > 10 || obj == null) return obj;
  if (typeof obj === "string") {
    // Check if string looks like Bearer token or API key
    if (obj.startsWith("Bearer ") && obj.length > 15) {
      return `Bearer ${obj.slice(7, 11)}...${obj.slice(-4)}`;
    }
    if (obj.startsWith("sk-") && obj.length > 10) {
      return `${obj.slice(0, 7)}...${obj.slice(-4)}`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => redactSecrets(item, depth + 1));
  }
  if (typeof obj === "object") {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isSensitiveField(k)) {
        result[k] = "[REDACTED]";
      } else {
        result[k] = redactSecrets(v, depth + 1);
      }
    }
    return result;
  }
  return obj;
}

/**
 * Redact sensitive headers for logging and display
 */
export function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const entries = headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers);
  const sanitized = {};
  for (const [k, v] of entries) {
    const keyLower = k.toLowerCase();
    if (
      keyLower.includes("authorization") ||
      keyLower.includes("api-key") ||
      keyLower.includes("cookie") ||
      keyLower.includes("token") ||
      keyLower.includes("secret")
    ) {
      sanitized[k] = "[REDACTED]";
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}
