"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RiskBadge } from "@/components/dashboard/status-badge";

interface ToolCall {
  tool: string;
  parameters: Record<string, unknown>;
  reason: string;
}

interface Action {
  step: number;
  description: string;
  tool_calls: ToolCall[];
  estimated_risk: "none" | "low" | "medium" | "high" | "critical";
}

interface ActionPreviewProps {
  actions: Action[] | null | undefined;
}

export function ActionPreview({ actions }: ActionPreviewProps) {
  if (!actions || actions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No actions to preview
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {actions.map((action, index) => (
        <div
          key={index}
          className="rounded-lg border bg-muted/30 p-4"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                {action.step}
              </div>
              <div>
                <h4 className="font-medium">{action.description}</h4>
                <div className="mt-1 flex items-center gap-2">
                  <RiskBadge risk={action.estimated_risk} />
                  <span className="text-sm text-muted-foreground">
                    {action.tool_calls?.length ?? 0} tool call
                    {(action.tool_calls?.length ?? 0) !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {action.tool_calls && action.tool_calls.length > 0 && (
            <div className="mt-4 space-y-3 pl-11">
              {action.tool_calls.map((toolCall, toolIndex) => (
                <ToolCallPreview key={toolIndex} toolCall={toolCall} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ToolCallPreview({ toolCall }: { toolCall: ToolCall }) {
  const toolLabels: Record<string, string> = {
    send_email: "Send Email",
    send_slack_message: "Send Slack Message",
    schedule_meeting: "Schedule Meeting",
    create_document: "Create Document",
    update_document: "Update Document",
    create_contact: "Create Contact",
    update_contact: "Update Contact",
    create_task: "Create Task",
    update_task: "Update Task",
    complete_task: "Complete Task",
  };

  return (
    <div className="rounded border bg-background p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ToolIcon tool={toolCall.tool} />
          <span className="font-medium text-sm">
            {toolLabels[toolCall.tool] ?? toolCall.tool}
          </span>
        </div>
        <Badge variant="outline" className="text-xs">
          {toolCall.tool}
        </Badge>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{toolCall.reason}</p>

      {Object.keys(toolCall.parameters).length > 0 && (
        <div className="mt-3 rounded bg-muted p-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Parameters:
          </p>
          <pre className="text-xs overflow-x-auto">
            {JSON.stringify(toolCall.parameters, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolIcon({ tool }: { tool: string }) {
  // Simple icons based on tool type
  const iconClasses = "h-4 w-4 text-muted-foreground";

  if (tool.includes("email")) {
    return (
      <svg className={iconClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    );
  }

  if (tool.includes("slack")) {
    return (
      <svg className={iconClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    );
  }

  if (tool.includes("task")) {
    return (
      <svg className={iconClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    );
  }

  if (tool.includes("document")) {
    return (
      <svg className={iconClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }

  return (
    <svg className={iconClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}
