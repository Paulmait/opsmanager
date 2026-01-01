import "server-only";

import type { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/logger";
import {
  type AgentContext,
  type AgentRunRecord,
  SchemaValidationError,
} from "./schemas";

// =============================================================================
// Types
// =============================================================================

export type AgentType = "planner" | "validator" | "writer";

export interface AgentRunOptions {
  context: AgentContext;
  input: Record<string, unknown>;
  taskId?: string;
}

export interface AgentRunResult<T> {
  success: boolean;
  output: T | null;
  error: string | null;
  runId: string;
  tokensUsed: number;
  costCents: number;
  durationMs: number;
}

// =============================================================================
// Base Agent Class
// =============================================================================

/**
 * Abstract base class for all agents.
 *
 * Provides:
 * - Structured logging
 * - Database recording (agent_runs, audit_logs)
 * - Schema validation
 * - Error handling
 */
export abstract class BaseAgent<TInput, TOutput> {
  protected readonly logger;
  protected abstract readonly agentType: AgentType;
  protected abstract readonly inputSchema: z.ZodSchema<TInput>;
  protected abstract readonly outputSchema: z.ZodSchema<TOutput>;

  constructor() {
    this.logger = createLogger({ agent: this.constructor.name });
  }

  /**
   * Execute the agent with full lifecycle management.
   */
  async run(options: AgentRunOptions): Promise<AgentRunResult<TOutput>> {
    const runId = uuidv4();
    const startTime = Date.now();
    let tokensUsed = 0;
    let costCents = 0;

    this.logger.info("Agent run started", {
      runId,
      agentType: this.agentType,
      orgId: options.context.organization_id,
      userId: options.context.user_id,
    });

    // Create initial run record
    await this.createRunRecord(runId, options, "running");

    try {
      // Validate input
      const validatedInput = this.validateInput(options.input);

      // Execute agent logic
      const { output, tokens, cost } = await this.execute(
        validatedInput,
        options.context
      );
      tokensUsed = tokens;
      costCents = cost;

      // Validate output
      const validatedOutput = this.validateOutput(output);

      // Update run record with success
      await this.updateRunRecord(runId, {
        status: "completed",
        output: validatedOutput as Record<string, unknown>,
        tokensUsed,
        costCents,
      });

      // Log audit entry
      await this.logAudit(options.context, runId, "agent.completed", {
        agentType: this.agentType,
        success: true,
      });

      const durationMs = Date.now() - startTime;

      this.logger.info("Agent run completed", {
        runId,
        durationMs,
        tokensUsed,
        costCents,
      });

      return {
        success: true,
        output: validatedOutput,
        error: null,
        runId,
        tokensUsed,
        costCents,
        durationMs,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Log error details
      this.logger.error("Agent run failed", {
        runId,
        error: errorMessage,
        isValidationError: error instanceof SchemaValidationError,
      });

      // Update run record with failure
      await this.updateRunRecord(runId, {
        status: "failed",
        error: errorMessage,
        tokensUsed,
        costCents,
      });

      // Log audit entry
      await this.logAudit(options.context, runId, "agent.failed", {
        agentType: this.agentType,
        error: errorMessage,
      });

      const durationMs = Date.now() - startTime;

      return {
        success: false,
        output: null,
        error: errorMessage,
        runId,
        tokensUsed,
        costCents,
        durationMs,
      };
    }
  }

  /**
   * Abstract method - implement agent-specific logic.
   */
  protected abstract execute(
    input: TInput,
    context: AgentContext
  ): Promise<{
    output: TOutput;
    tokens: number;
    cost: number;
  }>;

  /**
   * Validate input against schema.
   */
  protected validateInput(input: unknown): TInput {
    const result = this.inputSchema.safeParse(input);

    if (!result.success) {
      throw new SchemaValidationError(
        `${this.agentType}Input`,
        result.error
      );
    }

    return result.data;
  }

  /**
   * Validate output against schema.
   */
  protected validateOutput(output: unknown): TOutput {
    const result = this.outputSchema.safeParse(output);

    if (!result.success) {
      throw new SchemaValidationError(
        `${this.agentType}Output`,
        result.error
      );
    }

    return result.data;
  }

  /**
   * Create initial run record in database.
   */
  private async createRunRecord(
    runId: string,
    options: AgentRunOptions,
    status: "queued" | "running"
  ): Promise<void> {
    const supabase = createAdminClient();

    const { error } = await supabase.from("agent_runs").insert({
      id: runId,
      organization_id: options.context.organization_id,
      agent_type: this.agentType,
      status,
      input_data: options.input,
      triggered_by: options.context.user_id,
      task_id: options.taskId ?? null,
      requires_approval: false,
      queued_at: new Date().toISOString(),
      started_at: status === "running" ? new Date().toISOString() : null,
    });

    if (error) {
      this.logger.error("Failed to create run record", { error: error.message });
    }
  }

  /**
   * Update run record in database.
   */
  private async updateRunRecord(
    runId: string,
    updates: {
      status: "completed" | "failed" | "cancelled";
      output?: Record<string, unknown>;
      error?: string;
      tokensUsed?: number;
      costCents?: number;
    }
  ): Promise<void> {
    const supabase = createAdminClient();

    const { error } = await supabase
      .from("agent_runs")
      .update({
        status: updates.status,
        output_data: updates.output ?? null,
        error_message: updates.error ?? null,
        tokens_used: updates.tokensUsed ?? null,
        cost_cents: updates.costCents ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    if (error) {
      this.logger.error("Failed to update run record", { error: error.message });
    }
  }

  /**
   * Log audit entry.
   */
  private async logAudit(
    context: AgentContext,
    resourceId: string,
    action: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const supabase = createAdminClient();

    const { error } = await supabase.from("audit_logs").insert({
      organization_id: context.organization_id,
      actor_id: context.user_id,
      action,
      resource_type: "agent_run",
      resource_id: resourceId,
      metadata,
    });

    if (error) {
      this.logger.error("Failed to create audit log", { error: error.message });
    }
  }
}

// =============================================================================
// Agent Registry
// =============================================================================

const agentRegistry = new Map<AgentType, BaseAgent<unknown, unknown>>();

/**
 * Register an agent instance.
 */
export function registerAgent(agent: BaseAgent<unknown, unknown>): void {
  const type = (agent as unknown as { agentType: AgentType }).agentType;
  agentRegistry.set(type, agent);
}

/**
 * Get an agent instance by type.
 */
export function getAgent<T extends BaseAgent<unknown, unknown>>(
  type: AgentType
): T {
  const agent = agentRegistry.get(type);
  if (!agent) {
    throw new Error(`Agent not found: ${type}`);
  }
  return agent as T;
}
