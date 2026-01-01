"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { regenerateEmailAlias, type EmailAliasInfo } from "@/lib/actions/email";

interface EmailAliasCardProps {
  alias: EmailAliasInfo | null;
}

export function EmailAliasCard({ alias }: EmailAliasCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCopy = async () => {
    if (!alias?.aliasAddress) return;

    try {
      await navigator.clipboard.writeText(alias.aliasAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = alias.aliasAddress;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRegenerate = async () => {
    if (
      !confirm(
        "Are you sure you want to regenerate your email alias? " +
          "The old address will stop working immediately."
      )
    ) {
      return;
    }

    setError(null);

    startTransition(async () => {
      const result = await regenerateEmailAlias();
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Email Forwarding Address
              {alias && (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  Active
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Forward emails to this address to have them processed by the agent
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {alias ? (
          <>
            <div className="flex gap-2">
              <Input
                value={alias.aliasAddress}
                readOnly
                className="font-mono bg-muted"
              />
              <Button variant="outline" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>

            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                <strong>How to use:</strong>
              </p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>
                  Set up email forwarding from your email provider to this address
                </li>
                <li>
                  Or add this address as a CC/BCC when you want the agent to process an email
                </li>
                <li>
                  The agent will analyze incoming emails and create tasks for approval
                </li>
              </ol>
            </div>

            <div className="flex items-center gap-4 pt-4 border-t">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRegenerate}
                disabled={isPending}
                className="text-destructive hover:text-destructive"
              >
                {isPending ? "Regenerating..." : "Regenerate Address"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Warning: Old address will stop working
              </span>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <p className="text-muted-foreground mb-4">
              No email alias configured yet.
            </p>
            <Button onClick={() => router.refresh()}>
              Generate Email Address
            </Button>
          </div>
        )}

        {/* Upgrade Path Info */}
        <div className="mt-6 pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            <strong>Coming soon:</strong> Direct Gmail integration with OAuth for
            automatic email syncing without forwarding.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
