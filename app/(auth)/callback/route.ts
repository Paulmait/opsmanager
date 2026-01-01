import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth/Email Confirmation Callback Handler
 *
 * This route handles:
 * 1. Email confirmation links (signup verification)
 * 2. OAuth provider redirects (Google, GitHub, etc.)
 * 3. Password reset links
 *
 * The `code` parameter is exchanged for a session.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Successful authentication
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Authentication failed - redirect to error page or login
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
