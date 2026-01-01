"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { retryEmailProcessing } from "@/lib/actions/email";

interface EmailActionsProps {
  emailId: string;
}

export function EmailActions({ emailId }: EmailActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleRetry = async () => {
    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const result = await retryEmailProcessing(emailId);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      {error && (
        <div className="text-sm text-destructive">{error}</div>
      )}
      {success && (
        <div className="text-sm text-green-600">
          Email queued for reprocessing
        </div>
      )}
      <Button
        variant="outline"
        onClick={handleRetry}
        disabled={isPending || success}
      >
        {isPending ? "Retrying..." : "Retry Processing"}
      </Button>
    </div>
  );
}
