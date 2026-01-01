import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Health Check Endpoint
 *
 * GET /api/health
 *
 * Returns the health status of the application and its dependencies.
 * Used for monitoring, load balancer health checks, and debugging.
 *
 * Response format:
 * {
 *   status: "healthy" | "degraded" | "unhealthy",
 *   timestamp: string,
 *   checks: {
 *     database: { status: "up" | "down", latency_ms?: number }
 *   }
 * }
 */
export async function GET() {
  const timestamp = new Date().toISOString();
  const checks: Record<string, { status: string; latency_ms?: number }> = {};

  // Check database connectivity
  const dbStart = Date.now();
  try {
    const supabase = await createClient();
    // Simple query to verify database connection
    const { error } = await supabase.from("organizations").select("id").limit(1);

    if (error) {
      // RLS might block access, but connection is still valid if error isn't connection-related
      if (error.message.includes("connection") || error.code === "PGRST301") {
        checks["database"] = { status: "down" };
      } else {
        // Query was processed, database is up
        checks["database"] = {
          status: "up",
          latency_ms: Date.now() - dbStart,
        };
      }
    } else {
      checks["database"] = {
        status: "up",
        latency_ms: Date.now() - dbStart,
      };
    }
  } catch {
    checks["database"] = { status: "down" };
  }

  // Determine overall status
  const allUp = Object.values(checks).every((c) => c.status === "up");
  const allDown = Object.values(checks).every((c) => c.status === "down");

  let status: "healthy" | "degraded" | "unhealthy";
  if (allUp) {
    status = "healthy";
  } else if (allDown) {
    status = "unhealthy";
  } else {
    status = "degraded";
  }

  const response = {
    status,
    timestamp,
    checks,
  };

  const httpStatus = status === "healthy" ? 200 : status === "degraded" ? 200 : 503;

  return NextResponse.json(response, { status: httpStatus });
}
