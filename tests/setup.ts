// Vitest setup file
import { vi } from "vitest";

// Set test environment
process.env.NODE_ENV = "test";

// Mock React cache function
vi.mock("react", async () => {
  const actual = await vi.importActual("react");
  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  };
});

// Mock next/navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// Mock next/headers
vi.mock("next/headers", () => {
  const cookieStore = new Map<string, { value: string; options?: Record<string, unknown> }>();

  return {
    cookies: vi.fn(() => ({
      get: (name: string) => {
        const cookie = cookieStore.get(name);
        return cookie ? { name, value: cookie.value } : undefined;
      },
      getAll: () =>
        Array.from(cookieStore.entries()).map(([name, data]) => ({
          name,
          value: data.value,
        })),
      set: (name: string, value: string, options?: Record<string, unknown>) => {
        cookieStore.set(name, { value, options });
      },
      delete: (name: string) => {
        cookieStore.delete(name);
      },
      has: (name: string) => cookieStore.has(name),
    })),
    headers: vi.fn(() => new Headers()),
  };
});

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
