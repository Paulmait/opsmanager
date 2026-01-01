import { notFound } from "next/navigation";
import Link from "next/link";
import { requireActiveOrg } from "@/lib/guards";
import { getInboundEmailDetail } from "@/lib/actions/email";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmailActions } from "./email-actions";

export const metadata = {
  title: "Email Details",
};

export default async function EmailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireActiveOrg();
  const { id } = await params;

  const { email, error } = await getInboundEmailDetail(id);

  if (error || !email) {
    notFound();
  }

  const isAdmin = ["owner", "admin"].includes(profile.role);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/inbox">
          <Button variant="ghost" size="sm">
            <svg
              className="mr-2 h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to Inbox
          </Button>
        </Link>
      </div>

      <PageHeader
        title={email.subject ?? "(no subject)"}
        description={`From: ${email.fromName ?? email.fromAddress}`}
      />

      {/* Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Email Status</CardTitle>
            <StatusBadge status={email.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {email.processingError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <strong>Error:</strong> {email.processingError}
            </div>
          )}

          {email.agentRunId && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Agent Run:</span>
              <Link href={`/tasks?run=${email.agentRunId}`}>
                <Button variant="link" size="sm" className="h-auto p-0">
                  View Task
                </Button>
              </Link>
            </div>
          )}

          {isAdmin && email.status === "failed" && (
            <EmailActions emailId={email.id} />
          )}
        </CardContent>
      </Card>

      {/* Email Details */}
      <Card>
        <CardHeader>
          <CardTitle>Email Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">From</dt>
              <dd className="mt-1">
                {email.fromName && (
                  <span className="block font-medium">{email.fromName}</span>
                )}
                <span className="text-sm">{email.fromAddress}</span>
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-muted-foreground">To</dt>
              <dd className="mt-1 text-sm">
                {email.toAddresses.join(", ") || "—"}
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Received
              </dt>
              <dd className="mt-1 text-sm">
                {new Date(email.receivedAt).toLocaleString()}
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Email Date
              </dt>
              <dd className="mt-1 text-sm">
                {email.emailDate
                  ? new Date(email.emailDate).toLocaleString()
                  : "—"}
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Processed
              </dt>
              <dd className="mt-1 text-sm">
                {email.processedAt
                  ? new Date(email.processedAt).toLocaleString()
                  : "—"}
              </dd>
            </div>

            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Attachments
              </dt>
              <dd className="mt-1 text-sm">
                {email.hasAttachments
                  ? `${email.attachmentCount} attachment${email.attachmentCount > 1 ? "s" : ""}`
                  : "None"}
              </dd>
            </div>

            <div className="sm:col-span-2">
              <dt className="text-sm font-medium text-muted-foreground">
                Message ID
              </dt>
              <dd className="mt-1 font-mono text-xs text-muted-foreground break-all">
                {email.messageId}
              </dd>
            </div>

            {email.threadId && (
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-muted-foreground">
                  Thread ID
                </dt>
                <dd className="mt-1 font-mono text-xs text-muted-foreground break-all">
                  {email.threadId}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Content Preview */}
      {email.snippet && (
        <Card>
          <CardHeader>
            <CardTitle>Content Preview</CardTitle>
            <CardDescription>
              First 200 characters of the email (PII redacted)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {email.snippet}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Provider
              </dt>
              <dd className="mt-1 text-sm capitalize">{email.provider}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Internal ID
              </dt>
              <dd className="mt-1 font-mono text-xs text-muted-foreground">
                {email.id}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<
    string,
    "default" | "secondary" | "destructive" | "outline"
  > = {
    received: "secondary",
    processing: "secondary",
    processed: "default",
    failed: "destructive",
    ignored: "outline",
  };

  const labels: Record<string, string> = {
    received: "Received",
    processing: "Processing",
    processed: "Processed",
    failed: "Failed",
    ignored: "Ignored",
  };

  return <Badge variant={variants[status] ?? "secondary"}>{labels[status] ?? status}</Badge>;
}
