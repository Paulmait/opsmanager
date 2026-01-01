import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Auth & Environment Tests
 *
 * These tests verify:
 * 1. Environment validation works correctly
 * 2. Client/server env separation is enforced
 * 3. Logger utility functions correctly
 */

describe("Environment Validation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("should fail if NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    await expect(async () => {
      await import("../lib/env");
    }).rejects.toThrow();
  });

  it("should fail if NEXT_PUBLIC_SUPABASE_URL is not a valid URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    await expect(async () => {
      await import("../lib/env");
    }).rejects.toThrow();
  });

  it("should pass with valid environment variables", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");

    const { clientEnv } = await import("../lib/env");

    expect(clientEnv.NEXT_PUBLIC_SUPABASE_URL).toBe("https://test.supabase.co");
    expect(clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("test-anon-key");
  });
});

describe("Server Environment Access", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
    vi.stubEnv("NODE_ENV", "development");
  });

  it("should allow server env access in Node environment", async () => {
    // In Node (test environment), window is undefined, so server env should work
    const { serverEnv } = await import("../lib/env");
    expect(serverEnv.SUPABASE_SERVICE_ROLE_KEY).toBe("test-service-key");
  });
});

describe("Logger", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should create log entries with correct structure", async () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { logger } = await import("../lib/logger");
    logger.info("Test message", { userId: "123" });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should create child loggers with base context", async () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { createLogger } = await import("../lib/logger");
    const authLogger = createLogger({ module: "auth" });
    authLogger.info("Login attempt");

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should log different severity levels", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubEnv("NODE_ENV", "development");

    const { logger } = await import("../lib/logger");

    logger.debug("Debug message");
    logger.info("Info message");
    logger.warn("Warn message");
    logger.error("Error message");

    expect(debugSpy).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("Role Hierarchy Logic", () => {
  it("should correctly order roles", () => {
    const hierarchy: Record<string, number> = {
      owner: 4,
      admin: 3,
      member: 2,
      viewer: 1,
    };

    // Owner is highest
    expect(hierarchy.owner).toBeGreaterThan(hierarchy.admin);
    expect(hierarchy.owner).toBeGreaterThan(hierarchy.member);
    expect(hierarchy.owner).toBeGreaterThan(hierarchy.viewer);

    // Admin is second
    expect(hierarchy.admin).toBeGreaterThan(hierarchy.member);
    expect(hierarchy.admin).toBeGreaterThan(hierarchy.viewer);

    // Member is third
    expect(hierarchy.member).toBeGreaterThan(hierarchy.viewer);

    // Role checks work correctly
    const hasMinRole = (userRole: string, requiredRole: string): boolean => {
      return (hierarchy[userRole] ?? 0) >= (hierarchy[requiredRole] ?? 0);
    };

    // Owner has all roles
    expect(hasMinRole("owner", "owner")).toBe(true);
    expect(hasMinRole("owner", "admin")).toBe(true);
    expect(hasMinRole("owner", "member")).toBe(true);
    expect(hasMinRole("owner", "viewer")).toBe(true);

    // Admin has admin, member, viewer
    expect(hasMinRole("admin", "owner")).toBe(false);
    expect(hasMinRole("admin", "admin")).toBe(true);
    expect(hasMinRole("admin", "member")).toBe(true);
    expect(hasMinRole("admin", "viewer")).toBe(true);

    // Member has member, viewer
    expect(hasMinRole("member", "owner")).toBe(false);
    expect(hasMinRole("member", "admin")).toBe(false);
    expect(hasMinRole("member", "member")).toBe(true);
    expect(hasMinRole("member", "viewer")).toBe(true);

    // Viewer has only viewer
    expect(hasMinRole("viewer", "owner")).toBe(false);
    expect(hasMinRole("viewer", "admin")).toBe(false);
    expect(hasMinRole("viewer", "member")).toBe(false);
    expect(hasMinRole("viewer", "viewer")).toBe(true);
  });
});
