"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Approval, approveApproval, rejectApproval } from "@/lib/actions/approvals";

interface ApprovalActionsProps {
  approval: Approval;
}

export function ApprovalActions({ approval }: ApprovalActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  async function handleApprove() {
    if (!confirm("Are you sure you want to approve this request? The actions will be executed.")) {
      return;
    }

    setPending(true);
    const result = await approveApproval(approval.id);

    if (result.error) {
      alert(result.error);
      setPending(false);
    } else {
      router.refresh();
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) {
      alert("Please provide a reason for rejection");
      return;
    }

    setPending(true);
    const result = await rejectApproval(approval.id, rejectReason);

    if (result.error) {
      alert(result.error);
      setPending(false);
    } else {
      router.refresh();
    }
  }

  if (approval.status !== "pending") {
    return null;
  }

  if (showRejectReason) {
    return (
      <div className="flex items-center gap-2">
        <Input
          placeholder="Reason for rejection..."
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          className="w-[250px]"
        />
        <Button
          variant="destructive"
          disabled={pending || !rejectReason.trim()}
          onClick={handleReject}
        >
          Confirm Reject
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => setShowRejectReason(false)}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button disabled={pending} onClick={handleApprove}>
        Approve & Execute
      </Button>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => setShowRejectReason(true)}
      >
        Reject
      </Button>
    </div>
  );
}
