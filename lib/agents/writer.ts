import "server-only";

import { z } from "zod";
import { BaseAgent, type AgentType } from "./base";
import {
  type AgentContext,
  type WriterOutput,
  WriterOutputSchema,
  type ConfidenceLevel,
  CONFIDENCE_SCORES,
} from "./schemas";
import { getOrgMemory } from "./memory";

// =============================================================================
// Writer Input Schema
// =============================================================================

export const WriterInputSchema = z.object({
  type: z.enum(["email", "slack_message", "document", "calendar_invite"]),
  purpose: z.string().min(1, "Purpose is required"),
  recipient: z
    .object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      relationship: z.string().optional(),
    })
    .optional(),
  context: z.string().optional(),
  tone: z.enum(["formal", "casual", "professional", "friendly"]).default("professional"),
  length: z.enum(["short", "medium", "long"]).default("medium"),
  include_signature: z.boolean().default(true),
  template_id: z.string().optional(),
  variables: z.record(z.string()).optional(),
});
export type WriterInput = z.infer<typeof WriterInputSchema>;

// =============================================================================
// Content Templates
// =============================================================================

const EMAIL_TEMPLATES = {
  meeting_request: {
    subject: "Meeting Request: {purpose}",
    body: `Hi {recipient_name},

I hope this message finds you well. I would like to schedule a meeting to discuss {purpose}.

{context}

Please let me know your availability, and I'll send a calendar invite.

Best regards,
{sender_name}`,
  },
  follow_up: {
    subject: "Following Up: {purpose}",
    body: `Hi {recipient_name},

I wanted to follow up on {purpose}.

{context}

Please let me know if you have any questions or need additional information.

Best regards,
{sender_name}`,
  },
  introduction: {
    subject: "Introduction: {purpose}",
    body: `Hi {recipient_name},

I'm reaching out to introduce myself. {context}

I would love to connect and discuss {purpose}.

Looking forward to hearing from you.

Best regards,
{sender_name}`,
  },
  default: {
    subject: "{purpose}",
    body: `Hi {recipient_name},

{context}

Please let me know if you have any questions.

Best regards,
{sender_name}`,
  },
};

const SLACK_TEMPLATES = {
  announcement: `*{purpose}*

{context}

Please react with :thumbsup: if you've read this.`,
  question: `Hey team! :wave:

{purpose}

{context}

Thanks!`,
  default: `{purpose}

{context}`,
};

// =============================================================================
// Writer Agent
// =============================================================================

/**
 * Writer Agent
 *
 * Produces content drafts for:
 * - Emails
 * - Slack messages
 * - Documents
 * - Calendar invites
 *
 * Features:
 * - Tone adaptation
 * - Template support
 * - Variable substitution
 * - Alternative versions
 *
 * SECURITY:
 * - Only produces drafts, never sends directly
 * - Content must go through Validator before execution
 */
export class WriterAgent extends BaseAgent<WriterInput, WriterOutput> {
  protected readonly agentType: AgentType = "writer";
  protected readonly inputSchema = WriterInputSchema;
  protected readonly outputSchema = WriterOutputSchema;

  protected async execute(
    input: WriterInput,
    context: AgentContext
  ): Promise<{ output: WriterOutput; tokens: number; cost: number }> {
    // Get org memory for preferences
    const memory = await getOrgMemory(context.organization_id);
    const senderName = (memory.user_name as string) ?? "The Team";

    // Generate primary draft
    const draft = await this.generateDraft(input, senderName);

    // Generate alternatives if email
    const alternatives =
      input.type === "email"
        ? await this.generateAlternatives(input, senderName)
        : undefined;

    // Calculate word count and read time
    const wordCount = draft.body.split(/\s+/).length;
    const readTimeSeconds = Math.ceil(wordCount / 4); // ~240 words per minute

    // Assess confidence
    const confidence = this.assessConfidence(input, draft);

    // Generate suggestions
    const suggestions = this.generateSuggestions(input, draft);

    const output: WriterOutput = {
      draft,
      alternatives,
      tone: input.tone,
      confidence,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      word_count: wordCount,
      estimated_read_time_seconds: readTimeSeconds,
    };

    // Simulate token usage
    const tokens = 300 + input.purpose.length * 2;
    const cost = Math.ceil(tokens * 0.002);

    return { output, tokens, cost };
  }

  /**
   * Generate the primary draft.
   */
  private async generateDraft(
    input: WriterInput,
    senderName: string
  ): Promise<WriterOutput["draft"]> {
    switch (input.type) {
      case "email":
        return this.generateEmailDraft(input, senderName);
      case "slack_message":
        return this.generateSlackDraft(input);
      case "document":
        return this.generateDocumentDraft(input);
      case "calendar_invite":
        return this.generateCalendarDraft(input);
    }
  }

  /**
   * Generate email draft.
   */
  private generateEmailDraft(
    input: WriterInput,
    senderName: string
  ): WriterOutput["draft"] {
    // Select template
    const purposeLower = input.purpose.toLowerCase();
    let template = EMAIL_TEMPLATES.default;

    if (
      purposeLower.includes("meeting") ||
      purposeLower.includes("schedule")
    ) {
      template = EMAIL_TEMPLATES.meeting_request;
    } else if (
      purposeLower.includes("follow") ||
      purposeLower.includes("checking")
    ) {
      template = EMAIL_TEMPLATES.follow_up;
    } else if (
      purposeLower.includes("introduce") ||
      purposeLower.includes("introduction")
    ) {
      template = EMAIL_TEMPLATES.introduction;
    }

    // Apply variables
    const recipientName = input.recipient?.name ?? "there";
    const variables: Record<string, string> = {
      purpose: input.purpose,
      recipient_name: recipientName,
      context: input.context ?? "",
      sender_name: senderName,
      ...input.variables,
    };

    let subject = template.subject;
    let body = template.body;

    for (const [key, value] of Object.entries(variables)) {
      subject = subject.replace(new RegExp(`\\{${key}\\}`, "g"), value);
      body = body.replace(new RegExp(`\\{${key}\\}`, "g"), value);
    }

    // Adjust for tone
    body = this.adjustTone(body, input.tone);

    // Adjust for length
    if (input.length === "short") {
      // Keep only first paragraph and signature
      const paragraphs = body.split("\n\n");
      if (paragraphs.length > 2) {
        body = [paragraphs[0], paragraphs[paragraphs.length - 1]].join("\n\n");
      }
    }

    return {
      type: "email",
      subject,
      body,
      recipients: input.recipient?.email ? [input.recipient.email] : undefined,
      metadata: {
        tone: input.tone,
        template_used: template === EMAIL_TEMPLATES.default ? "default" : "matched",
      },
    };
  }

  /**
   * Generate Slack draft.
   */
  private generateSlackDraft(input: WriterInput): WriterOutput["draft"] {
    const purposeLower = input.purpose.toLowerCase();
    let template = SLACK_TEMPLATES.default;

    if (
      purposeLower.includes("announce") ||
      purposeLower.includes("update")
    ) {
      template = SLACK_TEMPLATES.announcement;
    } else if (
      purposeLower.includes("question") ||
      purposeLower.includes("help")
    ) {
      template = SLACK_TEMPLATES.question;
    }

    const body = template
      .replace(/\{purpose\}/g, input.purpose)
      .replace(/\{context\}/g, input.context ?? "");

    return {
      type: "slack_message",
      body,
      metadata: {
        tone: input.tone,
      },
    };
  }

  /**
   * Generate document draft.
   */
  private generateDocumentDraft(input: WriterInput): WriterOutput["draft"] {
    const title = `# ${input.purpose}\n\n`;
    const body = `${title}## Overview\n\n${input.context ?? "Add content here."}\n\n## Details\n\nTo be completed.\n\n## Next Steps\n\n- [ ] Review this document\n- [ ] Add details\n- [ ] Share with team`;

    return {
      type: "document",
      subject: input.purpose,
      body,
      metadata: {
        format: "markdown",
      },
    };
  }

  /**
   * Generate calendar invite draft.
   */
  private generateCalendarDraft(input: WriterInput): WriterOutput["draft"] {
    const body = `Meeting: ${input.purpose}\n\n${input.context ?? "Agenda to be shared."}\n\nPlease confirm your attendance.`;

    return {
      type: "calendar_invite",
      subject: input.purpose,
      body,
      recipients: input.recipient?.email ? [input.recipient.email] : undefined,
      metadata: {
        duration_minutes: 30,
        type: "meeting",
      },
    };
  }

  /**
   * Adjust content tone.
   */
  private adjustTone(content: string, tone: WriterInput["tone"]): string {
    switch (tone) {
      case "formal":
        return content
          .replace(/Hi /g, "Dear ")
          .replace(/Thanks!/g, "Thank you for your time.")
          .replace(/Best regards/g, "Sincerely");
      case "casual":
        return content
          .replace(/Dear /g, "Hey ")
          .replace(/Best regards/g, "Cheers")
          .replace(/I would like/g, "I'd like")
          .replace(/Please let me know/g, "Let me know");
      case "friendly":
        return content
          .replace(/Dear /g, "Hi ")
          .replace(/Best regards/g, "Thanks!")
          .replace(/I would like/g, "I'd love");
      case "professional":
      default:
        return content;
    }
  }

  /**
   * Generate alternative versions.
   */
  private async generateAlternatives(
    input: WriterInput,
    senderName: string
  ): Promise<WriterOutput["draft"][]> {
    const alternatives: WriterOutput["draft"][] = [];

    // Generate a shorter version
    if (input.length !== "short") {
      const shortInput = { ...input, length: "short" as const };
      alternatives.push(await this.generateEmailDraft(shortInput, senderName));
    }

    // Generate with different tone
    const altTone = input.tone === "formal" ? "professional" : "formal";
    const altToneInput = { ...input, tone: altTone as WriterInput["tone"] };
    alternatives.push(await this.generateEmailDraft(altToneInput, senderName));

    return alternatives;
  }

  /**
   * Assess confidence in the draft.
   */
  private assessConfidence(
    input: WriterInput,
    draft: WriterOutput["draft"]
  ): ConfidenceLevel {
    let score = 3; // Start at medium

    // More context = higher confidence
    if (input.context && input.context.length > 50) {
      score += 1;
    }

    // Recipient info = higher confidence
    if (input.recipient?.name) {
      score += 0.5;
    }

    // Variables provided = higher confidence
    if (input.variables && Object.keys(input.variables).length > 0) {
      score += 0.5;
    }

    // Very short draft = lower confidence
    if (draft.body.length < 100) {
      score -= 1;
    }

    // Map score to confidence level
    if (score >= 5) return "very_high";
    if (score >= 4) return "high";
    if (score >= 3) return "medium";
    if (score >= 2) return "low";
    return "very_low";
  }

  /**
   * Generate improvement suggestions.
   */
  private generateSuggestions(
    input: WriterInput,
    draft: WriterOutput["draft"]
  ): string[] {
    const suggestions: string[] = [];

    if (!input.recipient?.name) {
      suggestions.push("Add recipient name for personalization");
    }

    if (!input.context || input.context.length < 20) {
      suggestions.push("Add more context for a more specific message");
    }

    if (input.type === "email" && !draft.subject?.includes(":")) {
      suggestions.push("Consider a more descriptive subject line");
    }

    if (draft.body.length > 500 && input.length !== "long") {
      suggestions.push("Message is long; consider shortening for better engagement");
    }

    return suggestions;
  }
}

// Export singleton instance
export const writerAgent = new WriterAgent();
