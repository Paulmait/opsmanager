"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { type OrgSettings, updateApprovalSettings } from "@/lib/actions/settings";

interface ApprovalSettingsProps {
  settings: OrgSettings | null;
}

const AVAILABLE_TOOLS = [
  { id: "send_email", label: "Send Email", risk: "high" },
  { id: "send_slack_message", label: "Send Slack Message", risk: "medium" },
  { id: "schedule_meeting", label: "Schedule Meeting", risk: "medium" },
  { id: "create_document", label: "Create Document", risk: "medium" },
  { id: "update_document", label: "Update Document", risk: "medium" },
  { id: "create_contact", label: "Create Contact", risk: "low" },
  { id: "update_contact", label: "Update Contact", risk: "low" },
  { id: "create_task", label: "Create Task", risk: "low" },
  { id: "update_task", label: "Update Task", risk: "low" },
  { id: "complete_task", label: "Complete Task", risk: "low" },
  { id: "book_slot", label: "Book Calendar Slot", risk: "medium" },
];

export function ApprovalSettings({ settings }: ApprovalSettingsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [requireApprovalTools, setRequireApprovalTools] = useState<string[]>(
    settings?.require_approval_tools ?? ["send_email"]
  );
  const [minConfidenceThreshold, setMinConfidenceThreshold] = useState(
    settings?.min_confidence_threshold ?? "medium"
  );

  function toggleTool(toolId: string) {
    setRequireApprovalTools((prev) =>
      prev.includes(toolId)
        ? prev.filter((t) => t !== toolId)
        : [...prev, toolId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const result = await updateApprovalSettings({
      require_approval_tools: requireApprovalTools,
      min_confidence_threshold: minConfidenceThreshold as OrgSettings["min_confidence_threshold"],
    });

    if (result.error) {
      setError(result.error);
    } else {
      router.refresh();
    }

    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Confidence Threshold */}
      <div>
        <label className="text-sm font-medium">
          Minimum Confidence Threshold
        </label>
        <p className="mb-2 text-sm text-muted-foreground">
          If the agent&apos;s confidence is below this level, require human approval
        </p>
        <NativeSelect
          value={minConfidenceThreshold}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setMinConfidenceThreshold(e.target.value)}
          className="w-[200px]"
        >
          <option value="very_low">Very Low (most permissive)</option>
          <option value="low">Low</option>
          <option value="medium">Medium (recommended)</option>
          <option value="high">High</option>
          <option value="very_high">Very High (most restrictive)</option>
        </NativeSelect>
      </div>

      <hr />

      {/* Tools Requiring Approval */}
      <div>
        <h4 className="font-medium">Tools Requiring Approval</h4>
        <p className="mb-4 text-sm text-muted-foreground">
          Select which tools should always require human approval before execution
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          {AVAILABLE_TOOLS.map((tool) => (
            <label
              key={tool.id}
              className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
                requireApprovalTools.includes(tool.id)
                  ? "border-primary bg-primary/5"
                  : "border-input hover:border-primary/50"
              }`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={requireApprovalTools.includes(tool.id)}
                  onChange={() => toggleTool(tool.id)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium">{tool.label}</span>
              </div>
              <RiskIndicator risk={tool.risk} />
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {requireApprovalTools.length} tool{requireApprovalTools.length !== 1 ? "s" : ""} require approval
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}

function RiskIndicator({ risk }: { risk: string }) {
  const variant = risk === "high" ? "destructive" : risk === "medium" ? "warning" : "secondary";

  return (
    <Badge variant={variant} className="text-xs">
      {risk}
    </Badge>
  );
}
