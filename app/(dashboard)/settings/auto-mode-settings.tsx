"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { type OrgSettings, updateAutoModeSettings } from "@/lib/actions/settings";

interface AutoModeSettingsProps {
  settings: OrgSettings | null;
}

export function AutoModeSettings({ settings }: AutoModeSettingsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [autoDraftEnabled, setAutoDraftEnabled] = useState(
    settings?.auto_draft_enabled ?? true
  );
  const [autoSendEnabled, setAutoSendEnabled] = useState(
    settings?.auto_send_enabled ?? false
  );
  const [autoSendRiskThreshold, setAutoSendRiskThreshold] = useState(
    settings?.auto_send_risk_threshold ?? "none"
  );
  const [dailySendLimit, setDailySendLimit] = useState(
    settings?.daily_send_limit ?? 50
  );
  const [allowedDomains, setAllowedDomains] = useState(
    settings?.auto_send_allowed_domains?.join(", ") ?? ""
  );
  const [allowedRecipients, setAllowedRecipients] = useState(
    settings?.auto_send_allowed_recipients?.join(", ") ?? ""
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const domainList = allowedDomains
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    const recipientList = allowedRecipients
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);

    const result = await updateAutoModeSettings({
      auto_draft_enabled: autoDraftEnabled,
      auto_send_enabled: autoSendEnabled,
      auto_send_risk_threshold: autoSendRiskThreshold as "none" | "low" | "medium",
      auto_send_allowed_domains: domainList,
      auto_send_allowed_recipients: recipientList,
      daily_send_limit: dailySendLimit,
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

      {/* Auto Draft */}
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-medium">Auto Draft</h4>
          <p className="text-sm text-muted-foreground">
            Allow the agent to automatically create draft emails and messages
          </p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={autoDraftEnabled}
            onChange={(e) => setAutoDraftEnabled(e.target.checked)}
            className="peer sr-only"
          />
          <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:bg-gray-700" />
        </label>
      </div>

      <hr />

      {/* Auto Send */}
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-medium">Auto Send</h4>
            <p className="text-sm text-muted-foreground">
              Allow the agent to send emails without approval for allowed recipients
            </p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={autoSendEnabled}
              onChange={(e) => setAutoSendEnabled(e.target.checked)}
              className="peer sr-only"
            />
            <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:bg-gray-700" />
          </label>
        </div>

        {autoSendEnabled && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Safety Requirements
            </p>
            <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
              Auto-send requires at least one allowed domain or recipient. Emails will only be
              automatically sent to addresses matching these rules.
            </p>
          </div>
        )}

        {autoSendEnabled && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">
                  Allowed Domains
                </label>
                <p className="mb-2 text-xs text-muted-foreground">
                  Comma-separated list (e.g., company.com, partner.org)
                </p>
                <Input
                  placeholder="company.com, partner.org"
                  value={allowedDomains}
                  onChange={(e) => setAllowedDomains(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  Allowed Recipients
                </label>
                <p className="mb-2 text-xs text-muted-foreground">
                  Comma-separated emails
                </p>
                <Input
                  placeholder="ceo@company.com, team@partner.org"
                  value={allowedRecipients}
                  onChange={(e) => setAllowedRecipients(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">
                  Maximum Risk Level for Auto-Send
                </label>
                <p className="mb-2 text-xs text-muted-foreground">
                  Only auto-send if action risk is at or below this level
                </p>
                <NativeSelect
                  value={autoSendRiskThreshold}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAutoSendRiskThreshold(e.target.value)}
                >
                  <option value="none">None only (safest)</option>
                  <option value="low">Low and below</option>
                  <option value="medium">Medium and below</option>
                </NativeSelect>
              </div>
              <div>
                <label className="text-sm font-medium">
                  Daily Send Limit
                </label>
                <p className="mb-2 text-xs text-muted-foreground">
                  Maximum auto-sent emails per day
                </p>
                <Input
                  type="number"
                  min={0}
                  max={1000}
                  value={dailySendLimit}
                  onChange={(e) => setDailySendLimit(parseInt(e.target.value, 10) || 0)}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
