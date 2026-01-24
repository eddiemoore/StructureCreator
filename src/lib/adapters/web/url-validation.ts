/**
 * URL validation utilities for web mode.
 * Provides security checks to prevent SSRF attacks.
 */

/**
 * Known DNS rebinding services that resolve hostnames to embedded IPs.
 * These services allow bypassing hostname-based filtering.
 */
const DNS_REBINDING_DOMAINS = [
  ".nip.io",
  ".xip.io",
  ".sslip.io",
  ".localtest.me",
  ".lvh.me",
  ".vcap.me",
  ".lacolhost.com",
];

/**
 * Check if a hostname uses a known DNS rebinding service.
 */
const isDnsRebindingDomain = (hostname: string): boolean => {
  const lowerHost = hostname.toLowerCase();
  return DNS_REBINDING_DOMAINS.some(domain => lowerHost.endsWith(domain));
};

/**
 * Check if a hostname contains an embedded private IP address.
 * Catches patterns like "192-168-1-1.attacker.com" or "10.0.0.1.evil.com"
 */
const containsEmbeddedPrivateIP = (hostname: string): boolean => {
  // Pattern for embedded IPv4 with dots or dashes: 192.168.x.x, 192-168-x-x, 10.x.x.x, etc.
  // Match private ranges embedded anywhere in the hostname
  const patterns = [
    // 10.x.x.x (with dots or dashes)
    /(?:^|[.-])10[.-]\d{1,3}[.-]\d{1,3}[.-]\d{1,3}(?:[.-]|$)/,
    // 172.16-31.x.x
    /(?:^|[.-])172[.-](?:1[6-9]|2\d|3[01])[.-]\d{1,3}[.-]\d{1,3}(?:[.-]|$)/,
    // 192.168.x.x
    /(?:^|[.-])192[.-]168[.-]\d{1,3}[.-]\d{1,3}(?:[.-]|$)/,
    // 127.x.x.x (loopback)
    /(?:^|[.-])127[.-]\d{1,3}[.-]\d{1,3}[.-]\d{1,3}(?:[.-]|$)/,
    // 169.254.x.x (link-local)
    /(?:^|[.-])169[.-]254[.-]\d{1,3}[.-]\d{1,3}(?:[.-]|$)/,
    // 100.64-127.x.x (carrier-grade NAT)
    /(?:^|[.-])100[.-](?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])[.-]\d{1,3}[.-]\d{1,3}(?:[.-]|$)/,
  ];

  return patterns.some(pattern => pattern.test(hostname));
};

/**
 * Check if a hostname is an IPv6 private/local address.
 */
export const isPrivateIPv6 = (hostname: string): boolean => {
  // Remove brackets if present (e.g., [::1] -> ::1)
  const ip = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  // Loopback
  if (ip === "::1") return true;

  // Link-local (fe80::/10) - first 10 bits are 1111111010
  // Covers fe80:: through febf::
  // Match fe80: through febf: (must have colon to be valid IPv6 segment)
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true;

  // Unique local (fc00::/7 - includes fc00::/8 and fd00::/8)
  // Must have colon after first segment to be valid
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true;

  // Site-local (fec0::/10) - deprecated but may still exist
  // Covers fec0:: through feff::
  if (/^fe[c-f][0-9a-f]:/.test(ip)) return true;

  // Unspecified address
  if (ip === "::" || ip === "0:0:0:0:0:0:0:0") return true;

  // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x or ::ffff:xxxx:xxxx)
  // These can be used to bypass IPv4 filtering
  if (ip.startsWith("::ffff:")) {
    const suffix = ip.slice(7); // Remove "::ffff:"
    // Check if it's a dotted IPv4 (::ffff:192.168.1.1)
    const ipv4Match = suffix.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      // Check private/reserved IPv4 ranges
      if (
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 100 && b >= 64 && b <= 127)
      ) {
        return true;
      }
    }
    // Also block hex format (::ffff:7f00:0001 = 127.0.0.1)
    // 7f00:0000 - 7fff:ffff = 127.x.x.x
    // 0a00:0000 - 0aff:ffff = 10.x.x.x
    // ac10:0000 - ac1f:ffff = 172.16-31.x.x
    // c0a8:0000 - c0a8:ffff = 192.168.x.x
    // a9fe:0000 - a9fe:ffff = 169.254.x.x (link-local)
    // 6440:0000 - 647f:ffff = 100.64-127.x.x (carrier-grade NAT)
    const hexMatch = suffix.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
      const high = parseInt(hexMatch[1], 16);
      const firstOctet = (high >> 8) & 0xff;
      const secondOctet = high & 0xff;
      if (
        firstOctet === 10 ||
        (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) ||
        (firstOctet === 192 && secondOctet === 168) ||
        firstOctet === 127 ||
        (firstOctet === 169 && secondOctet === 254) ||
        (firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127)
      ) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Validate URL for security - block internal/private addresses.
 * Returns { valid: true } for safe URLs, or { valid: false, error: string } for blocked URLs.
 */
export const isValidPublicUrl = (urlString: string): { valid: boolean; error?: string } => {
  try {
    const url = new URL(urlString);

    // Must be HTTPS
    if (url.protocol !== "https:") {
      return { valid: false, error: "URL must use HTTPS protocol" };
    }

    // Block localhost and common internal hostnames
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "[::1]" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return { valid: false, error: "Cannot fetch from localhost or internal addresses" };
    }

    // Block known DNS rebinding services
    if (isDnsRebindingDomain(hostname)) {
      return { valid: false, error: "Cannot fetch from DNS rebinding services" };
    }

    // Block hostnames with embedded private IPs (e.g., 192-168-1-1.attacker.com)
    if (containsEmbeddedPrivateIP(hostname)) {
      return { valid: false, error: "Cannot fetch from hostnames containing private IP addresses" };
    }

    // Block IPv6 private/local addresses
    if (hostname.startsWith("[") || hostname.includes(":")) {
      if (isPrivateIPv6(hostname)) {
        return { valid: false, error: "Cannot fetch from private IPv6 addresses" };
      }
    }

    // Block private and reserved IPv4 ranges
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [, a, b] = ipMatch.map(Number);
      // 10.x.x.x - Private (RFC 1918)
      // 172.16-31.x.x - Private (RFC 1918)
      // 192.168.x.x - Private (RFC 1918)
      // 127.x.x.x - Loopback
      // 169.254.x.x - Link-local (RFC 3927)
      // 100.64-127.x.x - Carrier-grade NAT (RFC 6598)
      if (
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 100 && b >= 64 && b <= 127)
      ) {
        return { valid: false, error: "Cannot fetch from private or reserved IP addresses" };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
};
