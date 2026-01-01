/**
 * Auth utilities for Edge Functions
 *
 * SECURITY:
 * - Always verify JWT from Authorization header
 * - Never trust client-provided org_id without DB verification
 * - All org membership checks hit the database
 */

import { createClient, type SupabaseClient } from "./deps.ts";

// =============================================================================
// Types
// =============================================================================

export interface AuthContext {
  supabase: SupabaseClient;
  userId: string;
  userEmail: string;
}

export interface OrgAuthContext extends AuthContext {
  orgId: string;
  role: "owner" | "admin" | "member" | "viewer";
}

// =============================================================================
// Supabase Client
// =============================================================================

/**
 * Create Supabase admin client for Edge Functions.
 * Uses service role key for full database access.
 */
export function createAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Create Supabase client with user's JWT for RLS.
 */
export function createUserClient(jwt: string): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// =============================================================================
// Auth Verification
// =============================================================================

/**
 * Verify the caller's JWT and return auth context.
 *
 * SECURITY: Extracts and verifies JWT from Authorization header.
 * Does NOT trust any client-provided user info.
 */
export async function verifyAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header", 401);
  }

  const jwt = authHeader.substring(7);
  const supabase = createUserClient(jwt);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AuthError("Invalid or expired token", 401);
  }

  return {
    supabase,
    userId: user.id,
    userEmail: user.email ?? "",
  };
}

/**
 * Verify the caller has access to the specified organization.
 *
 * SECURITY:
 * - Always queries the database for membership
 * - Never trusts client-provided role
 * - Returns verified role from database
 */
export async function verifyOrgMembership(
  auth: AuthContext,
  orgId: string
): Promise<OrgAuthContext> {
  const adminClient = createAdminClient();

  // Query org_members table for verified membership
  const { data: membership, error } = await adminClient
    .from("org_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", auth.userId)
    .single();

  if (error || !membership) {
    throw new AuthError("Not a member of this organization", 403);
  }

  return {
    ...auth,
    orgId,
    role: membership.role as OrgAuthContext["role"],
  };
}

/**
 * Verify the caller has at least the required role.
 */
export function requireRole(
  context: OrgAuthContext,
  requiredRole: OrgAuthContext["role"]
): void {
  const roleHierarchy: Record<OrgAuthContext["role"], number> = {
    viewer: 0,
    member: 1,
    admin: 2,
    owner: 3,
  };

  if (roleHierarchy[context.role] < roleHierarchy[requiredRole]) {
    throw new AuthError(
      `Requires ${requiredRole} role or higher`,
      403
    );
  }
}

// =============================================================================
// Webhook Signature Verification
// =============================================================================

/**
 * Verify webhook signature for external callers.
 *
 * SECURITY:
 * - Uses HMAC-SHA256 for signature verification
 * - Prevents timing attacks with constant-time comparison
 * - Requires webhook secret to be configured
 */
export async function verifyWebhookSignature(
  req: Request,
  body: string,
  signatureHeader: string = "x-webhook-signature"
): Promise<void> {
  const webhookSecret = Deno.env.get("WEBHOOK_SECRET");

  if (!webhookSecret) {
    throw new AuthError("Webhook verification not configured", 500);
  }

  const signature = req.headers.get(signatureHeader);

  if (!signature) {
    throw new AuthError("Missing webhook signature", 401);
  }

  // Compute expected signature
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body)
  );

  const expectedSignature = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(signature, expectedSignature)) {
    throw new AuthError("Invalid webhook signature", 401);
  }
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

// =============================================================================
// Error Classes
// =============================================================================

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number = 401
  ) {
    super(message);
    this.name = "AuthError";
  }
}
