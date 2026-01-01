"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  createCheckoutSession,
  createBillingPortalSession,
  cancelSubscription,
  resumeSubscription,
  type BillingInfo,
} from "@/lib/actions/billing";
import type { PlanId } from "@/lib/stripe";

// =============================================================================
// Types
// =============================================================================

interface BillingSettingsProps {
  billing: BillingInfo;
  isAdmin: boolean;
}

interface PlanCardProps {
  planId: PlanId;
  name: string;
  price: number;
  features: string[];
  isCurrent: boolean;
  isPopular?: boolean;
  onSelect?: (planId: PlanId) => void;
  loading?: boolean;
}

// =============================================================================
// Plan Data
// =============================================================================

const PLAN_FEATURES: Record<PlanId, string[]> = {
  free: [
    "10 runs/day",
    "5 sends/day",
    "2 integrations",
    "2 team members",
    "Basic support",
  ],
  starter: [
    "100 runs/day",
    "50 sends/day",
    "5 integrations",
    "5 team members",
    "Auto-send enabled",
    "Email support",
  ],
  pro: [
    "1,000 runs/day",
    "500 sends/day",
    "20 integrations",
    "20 team members",
    "Auto-send enabled",
    "API access",
    "Custom branding",
    "Priority support",
    "Audit export",
  ],
  agency: [
    "10,000 runs/day",
    "5,000 sends/day",
    "100 integrations",
    "100 team members",
    "All Pro features",
    "SSO/SAML",
    "Dedicated support",
  ],
};

const PLAN_PRICES: Record<PlanId, number> = {
  free: 0,
  starter: 29,
  pro: 99,
  agency: 299,
};

// =============================================================================
// Components
// =============================================================================

function PlanCard({
  planId,
  name,
  price,
  features,
  isCurrent,
  isPopular,
  onSelect,
  loading,
}: PlanCardProps) {
  return (
    <Card className={`relative ${isPopular ? "border-primary" : ""} ${isCurrent ? "bg-muted/50" : ""}`}>
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge variant="default">Most Popular</Badge>
        </div>
      )}
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {name}
          {isCurrent && <Badge variant="outline">Current</Badge>}
        </CardTitle>
        <CardDescription>
          <span className="text-2xl font-bold text-foreground">${price}</span>
          {price > 0 && <span className="text-muted-foreground">/month</span>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 mb-4">
          {features.map((feature) => (
            <li key={feature} className="flex items-center text-sm">
              <svg
                className="mr-2 h-4 w-4 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {feature}
            </li>
          ))}
        </ul>
        {!isCurrent && onSelect && planId !== "free" && (
          <Button
            className="w-full"
            variant={isPopular ? "default" : "outline"}
            onClick={() => onSelect(planId)}
            disabled={loading}
          >
            {loading ? "Loading..." : `Upgrade to ${name}`}
          </Button>
        )}
        {isCurrent && planId !== "free" && (
          <p className="text-center text-sm text-muted-foreground">
            Your current plan
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function UsageBar({
  label,
  current,
  limit,
}: {
  label: string;
  current: number;
  limit: number;
}) {
  const percentage = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 100;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className={isAtLimit ? "text-destructive" : isNearLimit ? "text-yellow-600" : ""}>
          {current.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <Progress
        value={percentage}
        className={isAtLimit ? "[&>div]:bg-destructive" : isNearLimit ? "[&>div]:bg-yellow-500" : ""}
      />
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function BillingSettings({ billing, isAdmin }: BillingSettingsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);

  const handleUpgrade = async (planId: PlanId) => {
    if (!isAdmin) return;
    setError(null);
    setSelectedPlan(planId);

    startTransition(async () => {
      const result = await createCheckoutSession(planId);
      if (result.error) {
        setError(result.error);
        setSelectedPlan(null);
      } else if (result.url) {
        window.location.href = result.url;
      }
    });
  };

  const handleManageBilling = async () => {
    if (!isAdmin) return;
    setError(null);

    startTransition(async () => {
      const result = await createBillingPortalSession();
      if (result.error) {
        setError(result.error);
      } else if (result.url) {
        window.location.href = result.url;
      }
    });
  };

  const handleCancelSubscription = async () => {
    if (!isAdmin) return;
    if (!confirm("Are you sure you want to cancel? You'll lose access to premium features at the end of your billing period.")) {
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await cancelSubscription();
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  };

  const handleResumeSubscription = async () => {
    if (!isAdmin) return;
    setError(null);

    startTransition(async () => {
      const result = await resumeSubscription();
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  };

  const isCanceling = billing.subscriptionStatus === "canceled" ||
    billing.subscriptionStatus === "past_due";

  return (
    <div className="space-y-6">
      {/* Error Display */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Current Plan Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Current Plan
            <Badge variant={billing.plan === "free" ? "secondary" : "default"}>
              {billing.planName}
            </Badge>
            {billing.subscriptionStatus && billing.subscriptionStatus !== "none" && (
              <Badge
                variant={
                  billing.subscriptionStatus === "active" ? "outline" :
                  billing.subscriptionStatus === "trialing" ? "outline" :
                  "destructive"
                }
              >
                {billing.subscriptionStatus}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {billing.priceMonthly > 0
              ? `$${billing.priceMonthly}/month`
              : "Free plan"}
            {billing.periodEnd && (
              <span className="ml-2">
                {isCanceling ? "• Access until " : "• Renews "}
                {new Date(billing.periodEnd).toLocaleDateString()}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Usage Stats */}
          <div className="grid gap-4 md:grid-cols-2">
            <UsageBar
              label="Runs today"
              current={billing.usage.runsToday}
              limit={billing.usage.runsLimit}
            />
            <UsageBar
              label="Sends today"
              current={billing.usage.sendsToday}
              limit={billing.usage.sendsLimit}
            />
          </div>

          {/* Plan Limits */}
          <div className="grid gap-2 pt-4 border-t text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Integrations</span>
              <span>{billing.limits.maxIntegrations}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Team Members</span>
              <span>{billing.limits.maxTeamMembers}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Contacts</span>
              <span>{billing.limits.maxContacts.toLocaleString()}</span>
            </div>
          </div>

          {/* Features */}
          <div className="pt-4 border-t">
            <p className="text-sm font-medium mb-2">Features</p>
            <div className="flex flex-wrap gap-2">
              {billing.features.autoSend && <Badge variant="outline">Auto-send</Badge>}
              {billing.features.apiAccess && <Badge variant="outline">API Access</Badge>}
              {billing.features.customBranding && <Badge variant="outline">Custom Branding</Badge>}
              {billing.features.prioritySupport && <Badge variant="outline">Priority Support</Badge>}
              {billing.features.sso && <Badge variant="outline">SSO</Badge>}
              {billing.features.auditExport && <Badge variant="outline">Audit Export</Badge>}
              {!Object.values(billing.features).some(Boolean) && (
                <span className="text-sm text-muted-foreground">Basic features only</span>
              )}
            </div>
          </div>

          {/* Actions */}
          {isAdmin && billing.plan !== "free" && (
            <div className="flex gap-2 pt-4 border-t">
              <Button variant="outline" onClick={handleManageBilling} disabled={isPending}>
                Manage Billing
              </Button>
              {billing.subscriptionStatus === "active" && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={handleCancelSubscription}
                  disabled={isPending}
                >
                  Cancel Subscription
                </Button>
              )}
              {isCanceling && (
                <Button
                  variant="outline"
                  onClick={handleResumeSubscription}
                  disabled={isPending}
                >
                  Resume Subscription
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan Comparison - Only show for upgrades */}
      {billing.plan !== "agency" && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Available Plans</h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {(["free", "starter", "pro", "agency"] as PlanId[]).map((planId) => (
              <PlanCard
                key={planId}
                planId={planId}
                name={planId.charAt(0).toUpperCase() + planId.slice(1)}
                price={PLAN_PRICES[planId]}
                features={PLAN_FEATURES[planId]}
                isCurrent={billing.plan === planId}
                isPopular={planId === "pro"}
                onSelect={isAdmin ? handleUpgrade : undefined}
                loading={isPending && selectedPlan === planId}
              />
            ))}
          </div>
          {!isAdmin && (
            <p className="mt-4 text-sm text-muted-foreground">
              Only organization owners and admins can upgrade the plan.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
