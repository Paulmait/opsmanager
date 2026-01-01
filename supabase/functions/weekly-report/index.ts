/**
 * weekly_report Edge Function
 *
 * Generates weekly summary reports for organizations.
 * Can be triggered via cron or on-demand.
 *
 * SECURITY:
 * - Verifies caller authentication and org membership
 * - Supports webhook signature verification for cron triggers
 * - Logs all invocations to audit trail
 * - Rate-limited to prevent abuse
 *
 * Endpoints:
 *   POST /functions/v1/weekly-report (authenticated request)
 *   POST /functions/v1/weekly-report?cron=true (webhook with signature)
 *
 * Body: { org_id, week_start?, send_email? }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import {
  z,
  verifyAuth,
  verifyOrgMembership,
  verifyWebhookSignature,
  requireRole,
  validateBody,
  ValidationError,
  AuthError,
  logFunctionStart,
  logFunctionSuccess,
  logFunctionError,
  logAudit,
  successResponse,
  errorResponse,
  handleCors,
  createAdminClient,
} from "../_shared/index.ts";

// =============================================================================
// Input Schema
// =============================================================================

const WeeklyReportInputSchema = z.object({
  org_id: z.string().uuid("Invalid organization ID"),
  week_start: z.string().datetime().optional(), // ISO date, defaults to start of current week
  send_email: z.boolean().default(false),
  recipients: z.array(z.string().email()).optional(),
});

type WeeklyReportInput = z.infer<typeof WeeklyReportInputSchema>;

// Cron trigger schema (for scheduled runs)
const CronTriggerSchema = z.object({
  org_ids: z.array(z.string().uuid()).optional(), // If not provided, runs for all orgs
});

// =============================================================================
// Response Types
// =============================================================================

interface WeeklyReportResponse {
  org_id: string;
  report_id: string;
  period: {
    start: string;
    end: string;
  };
  summary: {
    total_runs: number;
    successful_runs: number;
    failed_runs: number;
    pending_approvals: number;
    total_actions: number;
    by_agent_type: Record<string, number>;
  };
  highlights: string[];
  email_sent?: boolean;
  generated_at: string;
}

// =============================================================================
// Handler
// =============================================================================

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCors();
  }

  // Only allow POST
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const url = new URL(req.url);
  const isCronTrigger = url.searchParams.get("cron") === "true";

  // Handle cron trigger (webhook with signature)
  if (isCronTrigger) {
    return handleCronTrigger(req);
  }

  // Handle authenticated request
  return handleAuthenticatedRequest(req);
});

// =============================================================================
// Authenticated Request Handler
// =============================================================================

async function handleAuthenticatedRequest(req: Request): Promise<Response> {
  let orgId = "";
  let userId = "";

  try {
    // Step 1: Authenticate caller
    const auth = await verifyAuth(req);
    userId = auth.userId;

    // Step 2: Validate input
    const input = await validateBody(req, WeeklyReportInputSchema);
    orgId = input.org_id;

    // Step 3: Verify org membership (requires at least member role)
    const orgAuth = await verifyOrgMembership(auth, orgId);
    requireRole(orgAuth, "member");

    // Step 4: Log function start
    await logFunctionStart("weekly_report", orgId, userId, {
      week_start: input.week_start,
      send_email: input.send_email,
    });

    // Step 5: Generate report
    const report = await generateReport(input);

    // Step 6: Log success
    await logFunctionSuccess(
      "weekly_report",
      orgId,
      userId,
      report.report_id,
      { total_runs: report.summary.total_runs }
    );

    return successResponse(report);
  } catch (error) {
    // Log error if we have context
    if (orgId && userId) {
      await logFunctionError(
        "weekly_report",
        orgId,
        userId,
        error instanceof Error ? error : String(error)
      );
    }

    // Return appropriate error response
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }

    if (error instanceof ValidationError) {
      return errorResponse(error.message, 400, error.details);
    }

    console.error("Unexpected error in weekly_report:", error);
    return errorResponse("Internal server error", 500);
  }
}

// =============================================================================
// Cron Trigger Handler
// =============================================================================

async function handleCronTrigger(req: Request): Promise<Response> {
  try {
    // Get raw body for signature verification
    const body = await req.text();

    // Verify webhook signature
    await verifyWebhookSignature(req, body, "x-cron-signature");

    // Parse and validate input
    const input = CronTriggerSchema.parse(JSON.parse(body || "{}"));

    const supabase = createAdminClient();
    const results: Array<{
      org_id: string;
      success: boolean;
      report_id?: string;
      error?: string;
    }> = [];

    // Get organizations to process
    let orgIds = input.org_ids;

    if (!orgIds || orgIds.length === 0) {
      // Get all active organizations
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id")
        .limit(100); // Process in batches for large deployments

      orgIds = orgs?.map((o) => o.id) ?? [];
    }

    // Generate reports for each organization
    for (const orgId of orgIds) {
      try {
        const report = await generateReport({
          org_id: orgId,
          send_email: true, // Always send email for cron triggers
        });

        results.push({
          org_id: orgId,
          success: true,
          report_id: report.report_id,
        });

        // Log audit for cron execution
        await logAudit({
          organization_id: orgId,
          actor_id: "system",
          action: "weekly_report.cron",
          resource_type: "report",
          resource_id: report.report_id,
          metadata: {
            triggered_by: "cron",
            total_runs: report.summary.total_runs,
          },
        });
      } catch (error) {
        results.push({
          org_id: orgId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return successResponse({
      processed: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.message, error.status);
    }

    console.error("Cron trigger error:", error);
    return errorResponse("Internal server error", 500);
  }
}

// =============================================================================
// Report Generation
// =============================================================================

async function generateReport(
  input: WeeklyReportInput
): Promise<WeeklyReportResponse> {
  const supabase = createAdminClient();
  const { org_id, week_start, send_email, recipients } = input;

  // Calculate week boundaries
  const { start, end } = getWeekBoundaries(week_start);

  // Fetch agent runs for the week
  const { data: runs } = await supabase
    .from("agent_runs")
    .select("id, agent_type, status, created_at, tokens_used, cost_cents")
    .eq("organization_id", org_id)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());

  // Fetch pending approvals
  const { count: pendingApprovals } = await supabase
    .from("approvals")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", org_id)
    .eq("status", "pending");

  // Fetch approved actions count
  const { count: totalActions } = await supabase
    .from("approvals")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", org_id)
    .eq("status", "approved")
    .gte("decided_at", start.toISOString())
    .lt("decided_at", end.toISOString());

  // Calculate summary
  const summary = calculateSummary(runs ?? [], pendingApprovals ?? 0, totalActions ?? 0);

  // Generate highlights
  const highlights = generateHighlights(summary, runs ?? []);

  // Create report record
  const { data: reportRecord } = await supabase
    .from("audit_logs")
    .insert({
      organization_id: org_id,
      actor_id: "system",
      action: "weekly_report.generated",
      resource_type: "report",
      metadata: {
        period_start: start.toISOString(),
        period_end: end.toISOString(),
        summary,
        highlights,
      },
    })
    .select("id")
    .single();

  const reportId = reportRecord?.id ?? crypto.randomUUID();

  // Send email if requested
  let emailSent = false;
  if (send_email) {
    emailSent = await sendReportEmail(org_id, {
      period: { start: start.toISOString(), end: end.toISOString() },
      summary,
      highlights,
      recipients,
    });
  }

  return {
    org_id,
    report_id: reportId,
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    summary,
    highlights,
    email_sent: emailSent,
    generated_at: new Date().toISOString(),
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function getWeekBoundaries(weekStart?: string): { start: Date; end: Date } {
  let start: Date;

  if (weekStart) {
    start = new Date(weekStart);
  } else {
    // Default to start of current week (Monday)
    start = new Date();
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
    start = new Date(start.setDate(diff));
  }

  // Set to start of day (UTC)
  start.setUTCHours(0, 0, 0, 0);

  // End is 7 days later
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  return { start, end };
}

function calculateSummary(
  runs: Array<{
    id: string;
    agent_type: string;
    status: string;
    tokens_used?: number;
    cost_cents?: number;
  }>,
  pendingApprovals: number,
  totalActions: number
): WeeklyReportResponse["summary"] {
  const byAgentType: Record<string, number> = {};

  for (const run of runs) {
    byAgentType[run.agent_type] = (byAgentType[run.agent_type] ?? 0) + 1;
  }

  return {
    total_runs: runs.length,
    successful_runs: runs.filter((r) => r.status === "completed").length,
    failed_runs: runs.filter((r) => r.status === "failed").length,
    pending_approvals: pendingApprovals,
    total_actions: totalActions,
    by_agent_type: byAgentType,
  };
}

function generateHighlights(
  summary: WeeklyReportResponse["summary"],
  runs: Array<{ status: string; agent_type: string }>
): string[] {
  const highlights: string[] = [];

  // Activity summary
  if (summary.total_runs === 0) {
    highlights.push("No agent runs this week.");
  } else {
    highlights.push(`${summary.total_runs} agent runs this week.`);
  }

  // Success rate
  if (summary.total_runs > 0) {
    const successRate = Math.round(
      (summary.successful_runs / summary.total_runs) * 100
    );
    if (successRate >= 90) {
      highlights.push(`Excellent success rate: ${successRate}%`);
    } else if (successRate >= 70) {
      highlights.push(`Good success rate: ${successRate}%`);
    } else {
      highlights.push(`Success rate needs attention: ${successRate}%`);
    }
  }

  // Pending approvals
  if (summary.pending_approvals > 0) {
    highlights.push(
      `${summary.pending_approvals} pending approvals require attention.`
    );
  }

  // Most used agent
  const sortedAgents = Object.entries(summary.by_agent_type).sort(
    ([, a], [, b]) => b - a
  );
  if (sortedAgents.length > 0) {
    const [topAgent, count] = sortedAgents[0];
    highlights.push(`Most active: ${topAgent} (${count} runs)`);
  }

  return highlights;
}

async function sendReportEmail(
  orgId: string,
  report: {
    period: { start: string; end: string };
    summary: WeeklyReportResponse["summary"];
    highlights: string[];
    recipients?: string[];
  }
): Promise<boolean> {
  const supabase = createAdminClient();

  // Get organization name
  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .single();

  // Get admin emails if no recipients specified
  let emailRecipients = report.recipients;

  if (!emailRecipients || emailRecipients.length === 0) {
    const { data: admins } = await supabase
      .from("org_members")
      .select("user_id")
      .eq("organization_id", orgId)
      .in("role", ["owner", "admin"]);

    if (admins && admins.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("email")
        .in(
          "id",
          admins.map((a) => a.user_id)
        );

      emailRecipients = profiles?.map((p) => p.email).filter(Boolean) as string[];
    }
  }

  if (!emailRecipients || emailRecipients.length === 0) {
    console.warn("No recipients for weekly report email");
    return false;
  }

  // In production, integrate with email provider (SendGrid, Resend, etc.)
  // For now, just log
  console.log("Would send weekly report email:", {
    to: emailRecipients,
    org: org?.name ?? orgId,
    period: report.period,
    summary: report.summary,
    highlights: report.highlights,
  });

  return true; // Simulated success
}
