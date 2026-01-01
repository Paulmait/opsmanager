"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useOrg } from "@/components/org-context";

export function UserMenu() {
  const { profile, organization } = useOrg();
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSignOut = () => {
    startTransition(async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-4">
      <div className="hidden text-right text-sm sm:block">
        <p className="font-medium">
          {profile.fullName ?? "User"}
        </p>
        <p className="text-muted-foreground text-xs">
          {organization.name} · {profile.role}
        </p>
      </div>
      <button
        onClick={handleSignOut}
        disabled={isPending}
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "..." : "Sign Out"}
      </button>
    </div>
  );
}
