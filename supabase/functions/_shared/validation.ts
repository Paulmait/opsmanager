/**
 * Validation utilities for Edge Functions
 *
 * SECURITY:
 * - All inputs validated with Zod schemas
 * - Fail fast on invalid data
 * - Clear error messages for debugging
 */

import { z, type ZodSchema, type ZodError } from "./deps.ts";

// =============================================================================
// Input Validation
// =============================================================================

/**
 * Parse and validate request body against a Zod schema.
 *
 * @throws ValidationError if body is invalid JSON or fails schema validation
 */
export async function validateBody<T>(
  req: Request,
  schema: ZodSchema<T>
): Promise<T> {
  let body: unknown;

  try {
    const text = await req.text();

    if (!text) {
      throw new ValidationError("Request body is required");
    }

    body = JSON.parse(text);
  } catch (err) {
    if (err instanceof ValidationError) {
      throw err;
    }
    throw new ValidationError("Invalid JSON in request body");
  }

  const result = schema.safeParse(body);

  if (!result.success) {
    throw new ValidationError(
      "Validation failed",
      formatZodError(result.error)
    );
  }

  return result.data;
}

/**
 * Validate data against a Zod schema.
 *
 * @throws ValidationError if validation fails
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new ValidationError(
      "Validation failed",
      formatZodError(result.error)
    );
  }

  return result.data;
}

/**
 * Format Zod error for response.
 */
function formatZodError(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    if (!errors[path]) {
      errors[path] = [];
    }
    errors[path].push(issue.message);
  }

  return errors;
}

// =============================================================================
// Common Schemas
// =============================================================================

export const UUIDSchema = z.string().uuid("Invalid UUID format");

export const OrgIdSchema = z.object({
  org_id: UUIDSchema,
});

export const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

// =============================================================================
// Error Classes
// =============================================================================

export class ValidationError extends Error {
  public readonly details?: Record<string, string[]>;

  constructor(message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}
