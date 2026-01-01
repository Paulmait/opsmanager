import Link from "next/link";
import { getUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          Ops Manager
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          AI-powered operations management for small and medium businesses.
          Automate admin tasks, manage workflows, and focus on what matters.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          {user ? (
            <Link
              href="/dashboard"
              className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="rounded-lg border border-input bg-background px-6 py-3 text-sm font-semibold shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                Create Account
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
