/**
 * SSRF Protection for Edge Functions
 *
 * SECURITY:
 * - Maintains allowlist of permitted outbound domains
 * - Blocks requests to internal/private IP ranges
 * - Prevents server-side request forgery attacks
 */

// =============================================================================
// Outbound Request Allowlist
// =============================================================================

/**
 * Allowed domains for outbound HTTP requests.
 * Any request to a domain not in this list will be blocked.
 */
const ALLOWED_OUTBOUND_DOMAINS = new Set([
  // Supabase
  "supabase.co",
  "supabase.com",

  // Email providers
  "api.sendgrid.com",
  "api.postmarkapp.com",
  "api.mailgun.net",
  "api.resend.com",

  // Slack
  "slack.com",
  "api.slack.com",
  "hooks.slack.com",

  // Calendar
  "www.googleapis.com",
  "calendar.google.com",
  "outlook.office365.com",
  "graph.microsoft.com",

  // OAuth providers
  "accounts.google.com",
  "login.microsoftonline.com",
  "github.com",
  "api.github.com",
]);

/**
 * Blocked IP patterns (private/internal ranges).
 */
const BLOCKED_IP_PATTERNS = [
  /^127\./,                       // Loopback
  /^10\./,                        // Private Class A
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
  /^192\.168\./,                  // Private Class C
  /^169\.254\./,                  // Link-local
  /^0\./,                         // This network
  /^100\.(6[4-9]|[7-9][0-9]|1[0-2][0-7])\./, // Carrier-grade NAT
  /^::1$/,                        // IPv6 loopback
  /^fc00:/,                       // IPv6 unique local
  /^fe80:/,                       // IPv6 link-local
  /^localhost$/i,                 // Localhost
];

// =============================================================================
// SSRF Protection Functions
// =============================================================================

/**
 * Check if a URL is allowed for outbound requests.
 *
 * @throws SSRFError if the URL is not allowed
 */
export function validateOutboundUrl(url: string): void {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFError("Invalid URL format");
  }

  // Check protocol
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new SSRFError(`Protocol not allowed: ${parsed.protocol}`);
  }

  // Check for blocked IP patterns
  const hostname = parsed.hostname;
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new SSRFError("Requests to internal IP addresses are blocked");
    }
  }

  // Check domain allowlist
  const domain = extractRootDomain(hostname);
  if (!ALLOWED_OUTBOUND_DOMAINS.has(domain) && !ALLOWED_OUTBOUND_DOMAINS.has(hostname)) {
    throw new SSRFError(`Domain not in allowlist: ${domain}`);
  }
}

/**
 * Perform a safe fetch that validates the URL first.
 */
export async function safeFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  validateOutboundUrl(url);

  // Set timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    // Validate redirect doesn't go to blocked domain
    if (response.redirected) {
      validateOutboundUrl(response.url);
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Add a domain to the allowlist (for dynamic configuration).
 */
export function addAllowedDomain(domain: string): void {
  ALLOWED_OUTBOUND_DOMAINS.add(domain.toLowerCase());
}

/**
 * Check if a domain is allowed.
 */
export function isDomainAllowed(hostname: string): boolean {
  const domain = extractRootDomain(hostname);
  return ALLOWED_OUTBOUND_DOMAINS.has(domain) || ALLOWED_OUTBOUND_DOMAINS.has(hostname);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract root domain from hostname.
 * e.g., "api.slack.com" -> "slack.com"
 */
function extractRootDomain(hostname: string): string {
  const parts = hostname.split(".");

  // Handle simple hostnames
  if (parts.length <= 2) {
    return hostname;
  }

  // Return last two parts (handles most cases)
  // For more complex TLDs (e.g., .co.uk), would need a proper PSL library
  return parts.slice(-2).join(".");
}

// =============================================================================
// Error Classes
// =============================================================================

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}
