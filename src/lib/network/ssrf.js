import dns from "node:dns/promises";
import net from "node:net";

/**
 * Check if an IP address belongs to private/internal/cloud metadata ranges
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateOrReservedIp(ip) {
  if (!ip) return true;

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    const [a, b] = parts;

    // 0.0.0.0/8
    if (a === 0) return true;

    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;

    // 10.0.0.0/8 (Private RFC 1918)
    if (a === 10) return true;

    // 172.16.0.0/12 (Private RFC 1918)
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16 (Private RFC 1918)
    if (a === 192 && b === 168) return true;

    // 169.254.0.0/16 (Link-local / AWS / GCP / Azure metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;

    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 224.0.0.0/4 (Multicast)
    if (a >= 224) return true;

    return false;
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    // Loopback
    if (norm === "::1" || norm === "0:0:0:0:0:0:0:1") return true;
    // Unspecified
    if (norm === "::" || norm === "0:0:0:0:0:0:0:0") return true;
    // Link-local (fe80::/10)
    if (norm.startsWith("fe8") || norm.startsWith("fe9") || norm.startsWith("fea") || norm.startsWith("feb")) return true;
    // Unique local (fc00::/7)
    if (norm.startsWith("fc") || norm.startsWith("fd")) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if (norm.startsWith("::ffff:")) {
      const v4part = norm.slice(7);
      if (net.isIPv4(v4part)) return isPrivateOrReservedIp(v4part);
    }

    return false;
  }

  return true;
}

/**
 * Validate a target URL for safety against SSRF and malformed requests
 * @param {string} urlString
 * @param {object} [options]
 * @param {boolean} [options.allowLocal=false] - Allow localhost and private IPs (if configured)
 * @returns {Promise<{ safe: boolean, error?: string, parsedUrl?: URL }>}
 */
export async function validateTargetUrl(urlString, options = {}) {
  const allowLocal =
    options.allowLocal ||
    process.env.ALLOW_PRIVATE_NETWORK === "true" ||
    process.env.ALLOW_LOCAL_CUSTOM_PROVIDERS === "true";

  if (!urlString || typeof urlString !== "string") {
    return { safe: false, error: "URL string is required" };
  }

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { safe: false, error: "Invalid URL format" };
  }

  // Protocol must be HTTP or HTTPS
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, error: `Disallowed protocol: ${parsed.protocol}. Only http: and https: are allowed.` };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { safe: false, error: "Missing hostname" };
  }

  // Obvious localhost/metadata domains
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal" ||
    hostname === "instance-data"
  ) {
    if (!allowLocal) {
      return { safe: false, error: `Access to local/metadata host '${hostname}' is prohibited.` };
    }
  }

  // If hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (!allowLocal && isPrivateOrReservedIp(hostname)) {
      return { safe: false, error: `Access to private or reserved IP address '${hostname}' is prohibited.` };
    }
    return { safe: true, parsedUrl: parsed };
  }

  // Resolve hostname to IP to protect against DNS rebinding and internal network access
  if (!allowLocal) {
    try {
      const lookupResult = await dns.lookup(hostname, { all: true });
      for (const entry of lookupResult) {
        if (isPrivateOrReservedIp(entry.address)) {
          return {
            safe: false,
            error: `Hostname '${hostname}' resolves to private/reserved IP '${entry.address}', which is prohibited.`,
          };
        }
      }
    } catch (err) {
      return { safe: false, error: `Could not resolve hostname '${hostname}': ${err.message}` };
    }
  }

  return { safe: true, parsedUrl: parsed };
}
