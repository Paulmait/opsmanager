"use client";

import { Card, CardContent } from "@/components/ui/card";

interface UsageStatsProps {
  runsToday: number;
  sendsToday: number;
  dailyRunLimit: number;
  dailySendLimit: number;
}

export function UsageStats({
  runsToday,
  sendsToday,
  dailyRunLimit,
  dailySendLimit,
}: UsageStatsProps) {
  const runPercentage = Math.min(100, (runsToday / dailyRunLimit) * 100);
  const sendPercentage = Math.min(100, (sendsToday / dailySendLimit) * 100);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Agent Runs Today
              </p>
              <p className="text-2xl font-bold">
                {runsToday} <span className="text-sm font-normal text-muted-foreground">/ {dailyRunLimit}</span>
              </p>
            </div>
            <UsageIcon percentage={runPercentage} />
          </div>
          <div className="mt-4">
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className={`h-2 rounded-full transition-all ${
                  runPercentage >= 90
                    ? "bg-destructive"
                    : runPercentage >= 70
                    ? "bg-yellow-500"
                    : "bg-primary"
                }`}
                style={{ width: `${runPercentage}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Emails Sent Today
              </p>
              <p className="text-2xl font-bold">
                {sendsToday} <span className="text-sm font-normal text-muted-foreground">/ {dailySendLimit}</span>
              </p>
            </div>
            <UsageIcon percentage={sendPercentage} />
          </div>
          <div className="mt-4">
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className={`h-2 rounded-full transition-all ${
                  sendPercentage >= 90
                    ? "bg-destructive"
                    : sendPercentage >= 70
                    ? "bg-yellow-500"
                    : "bg-primary"
                }`}
                style={{ width: `${sendPercentage}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UsageIcon({ percentage }: { percentage: number }) {
  if (percentage >= 90) {
    return (
      <div className="rounded-full bg-destructive/10 p-2">
        <svg
          className="h-6 w-6 text-destructive"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className="rounded-full bg-primary/10 p-2">
      <svg
        className="h-6 w-6 text-primary"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    </div>
  );
}
