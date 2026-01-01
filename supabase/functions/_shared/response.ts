/**
 * Response utilities for Edge Functions
 *
 * Provides consistent response formatting with proper CORS headers.
 */

// =============================================================================
// CORS Headers
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Create JSON response with CORS headers.
 */
export function jsonResponse(
  data: unknown,
  status: number = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Create success response.
 */
export function successResponse<T>(data: T): Response {
  return jsonResponse({ success: true, data }, 200);
}

/**
 * Create error response.
 */
export function errorResponse(
  message: string,
  status: number = 400,
  details?: unknown
): Response {
  return jsonResponse(
    {
      success: false,
      error: message,
      ...(details && { details }),
    },
    status
  );
}

/**
 * Handle CORS preflight request.
 */
export function handleCors(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Create response for rate limit exceeded.
 */
export function rateLimitResponse(
  current: number,
  limit: number,
  resetTime?: Date
): Response {
  const headers: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(Math.max(0, limit - current)),
  };

  if (resetTime) {
    headers["X-RateLimit-Reset"] = String(Math.floor(resetTime.getTime() / 1000));
  }

  return new Response(
    JSON.stringify({
      success: false,
      error: "Rate limit exceeded",
      limit,
      current,
    }),
    {
      status: 429,
      headers,
    }
  );
}

/**
 * Create response with idempotency header.
 */
export function idempotentResponse(
  data: unknown,
  idempotencyKey: string,
  cached: boolean = false
): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      ...(cached && { "X-Idempotent-Replay": "true" }),
    },
  });
}
