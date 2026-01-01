import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js Middleware
 *
 * Runs on every matched request before the page/route handler.
 *
 * Responsibilities:
 * 1. Refresh Supabase auth session (keeps cookies fresh)
 * 2. Protect dashboard routes from unauthenticated access
 * 3. Redirect authenticated users away from auth pages
 */

// Routes that require authentication
const PROTECTED_ROUTES = ["/dashboard", "/settings"];

// Routes only for unauthenticated users
const AUTH_ROUTES = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Check if route is protected
  const isProtectedRoute = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  // Check if route is auth-only
  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  // Redirect unauthenticated users from protected routes
  if (isProtectedRoute && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages
  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     * - api routes that handle their own auth
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
