"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "approved"
  | "rejected"
  | "expired"
  | "pending_approval";

type Priority = "low" | "medium" | "high" | "critical";

type Risk = "none" | "low" | "medium" | "high" | "critical";

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

const statusConfig: Record<Status, { label: string; variant: "success" | "warning" | "destructive" | "info" | "secondary" }> = {
  pending: { label: "Pending", variant: "secondary" },
  running: { label: "Running", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  expired: { label: "Expired", variant: "secondary" },
  pending_approval: { label: "Pending Approval", variant: "warning" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] ?? { label: status, variant: "secondary" as const };

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}

interface PriorityBadgeProps {
  priority: Priority;
  className?: string;
}

const priorityConfig: Record<Priority, { label: string; variant: "success" | "warning" | "destructive" | "info" | "secondary" }> = {
  low: { label: "Low", variant: "secondary" },
  medium: { label: "Medium", variant: "info" },
  high: { label: "High", variant: "warning" },
  critical: { label: "Critical", variant: "destructive" },
};

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const config = priorityConfig[priority] ?? { label: priority, variant: "secondary" as const };

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}

interface RiskBadgeProps {
  risk: Risk;
  className?: string;
}

const riskConfig: Record<Risk, { label: string; variant: "success" | "warning" | "destructive" | "info" | "secondary" }> = {
  none: { label: "None", variant: "secondary" },
  low: { label: "Low", variant: "success" },
  medium: { label: "Medium", variant: "warning" },
  high: { label: "High", variant: "destructive" },
  critical: { label: "Critical", variant: "destructive" },
};

export function RiskBadge({ risk, className }: RiskBadgeProps) {
  const config = riskConfig[risk] ?? { label: risk, variant: "secondary" as const };

  return (
    <Badge variant={config.variant} className={className}>
      {config.label} Risk
    </Badge>
  );
}
