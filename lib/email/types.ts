/**
 * Email Ingestion Types
 *
 * Types for inbound email processing.
 */

// =============================================================================
// Provider Types
// =============================================================================

export type EmailProvider = "sendgrid" | "mailgun" | "postmark" | "test";

// =============================================================================
// Parsed Email Types
// =============================================================================

export interface ParsedEmail {
  messageId: string;
  threadId?: string;
  inReplyTo?: string;
  from: {
    address: string;
    name?: string;
  };
  to: string[];
  cc?: string[];
  subject?: string;
  snippet?: string;
  textBody?: string;
  htmlBody?: string;
  hasAttachments: boolean;
  attachmentCount: number;
  date?: Date;
  headers?: Record<string, string>;
}

export interface InboundEmailPayload {
  provider: EmailProvider;
  providerEventId: string;
  rawPayload: unknown;
  parsedEmail: ParsedEmail;
  recipientAlias: string;
}

// =============================================================================
// Database Types
// =============================================================================

export interface InboundEmail {
  id: string;
  organizationId: string;
  messageId: string;
  threadId?: string;
  inReplyTo?: string;
  fromAddress: string;
  fromName?: string;
  toAddresses: string[];
  subject?: string;
  snippet?: string;
  hasAttachments: boolean;
  attachmentCount: number;
  status: InboundEmailStatus;
  agentRunId?: string;
  processingError?: string;
  receivedAt: string;
  processedAt?: string;
  emailDate?: string;
  provider: EmailProvider;
  providerEventId?: string;
}

export type InboundEmailStatus =
  | "received"
  | "processing"
  | "processed"
  | "failed"
  | "ignored";

export interface EmailAlias {
  id: string;
  organizationId: string;
  aliasAddress: string;
  aliasKey: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Processing Types
// =============================================================================

export interface EmailProcessingResult {
  success: boolean;
  emailId?: string;
  agentRunId?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

// =============================================================================
// Webhook Signature Types
// =============================================================================

export interface WebhookSignatureConfig {
  provider: EmailProvider;
  secret: string;
  timestamp?: string;
  signature?: string;
  payload: string | Buffer;
}

export interface WebhookVerificationResult {
  valid: boolean;
  error?: string;
}
