import "server-only";

import { createLogger } from "@/lib/logger";
import type { EmailProvider, ParsedEmail, InboundEmailPayload } from "./types";

const logger = createLogger({ module: "email-parser" });

// =============================================================================
// Constants
// =============================================================================

const MAX_SNIPPET_LENGTH = 200;
const PII_PATTERNS = [
  // SSN patterns
  /\b\d{3}-\d{2}-\d{4}\b/g,
  // Credit card patterns (basic)
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  // Phone numbers (basic)
  /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
];

// =============================================================================
// Main Parser
// =============================================================================

/**
 * Parse inbound email from provider webhook payload.
 *
 * SECURITY:
 * - Extracts only necessary fields
 * - Sanitizes PII from snippet
 * - Does not store full email body in MVP
 */
export function parseInboundEmail(
  provider: EmailProvider,
  payload: unknown
): InboundEmailPayload | null {
  try {
    switch (provider) {
      case "sendgrid":
        return parseSendGridPayload(payload);
      case "mailgun":
        return parseMailgunPayload(payload);
      case "postmark":
        return parsePostmarkPayload(payload);
      case "test":
        return parseTestPayload(payload);
      default:
        logger.error("Unknown email provider", { provider });
        return null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to parse email payload", { provider, error: message });
    return null;
  }
}

// =============================================================================
// SendGrid Parser
// =============================================================================

interface SendGridPayload {
  headers?: string;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  text?: string;
  html?: string;
  envelope?: string;
  attachments?: string;
  "attachment-info"?: string;
}

function parseSendGridPayload(payload: unknown): InboundEmailPayload | null {
  const data = payload as SendGridPayload;

  // Parse envelope for actual recipient
  let recipientAlias = "";
  if (data.envelope) {
    try {
      const envelope = JSON.parse(data.envelope);
      recipientAlias = envelope.to?.[0] ?? "";
    } catch {
      // Use to field as fallback
      recipientAlias = data.to ?? "";
    }
  } else {
    recipientAlias = data.to ?? "";
  }

  // Extract recipient address only (remove name if present)
  recipientAlias = extractEmailAddress(recipientAlias);

  // Parse headers for message ID
  const headers = parseHeaders(data.headers ?? "");
  const messageId = headers["message-id"] ?? generateFallbackMessageId();

  // Parse from address
  const from = parseEmailAddress(data.from ?? "");

  // Parse attachments count
  let attachmentCount = 0;
  if (data["attachment-info"]) {
    try {
      const attachInfo = JSON.parse(data["attachment-info"]);
      attachmentCount = Object.keys(attachInfo).length;
    } catch {
      attachmentCount = parseInt(data.attachments ?? "0", 10);
    }
  }

  const parsedEmail: ParsedEmail = {
    messageId,
    threadId: headers["thread-id"] ?? headers["x-gm-thrid"],
    inReplyTo: headers["in-reply-to"],
    from,
    to: parseRecipientList(data.to ?? ""),
    cc: data.cc ? parseRecipientList(data.cc) : undefined,
    subject: data.subject,
    snippet: createSnippet(data.text ?? data.html),
    textBody: data.text,
    htmlBody: data.html,
    hasAttachments: attachmentCount > 0,
    attachmentCount,
    date: parseEmailDate(headers["date"]),
    headers: selectSafeHeaders(headers),
  };

  return {
    provider: "sendgrid",
    providerEventId: messageId,
    rawPayload: payload,
    parsedEmail,
    recipientAlias,
  };
}

// =============================================================================
// Mailgun Parser
// =============================================================================

interface MailgunPayload {
  sender?: string;
  from?: string;
  recipient?: string;
  To?: string;
  Cc?: string;
  subject?: string;
  "body-plain"?: string;
  "body-html"?: string;
  "stripped-text"?: string;
  "Message-Id"?: string;
  "In-Reply-To"?: string;
  References?: string;
  Date?: string;
  "attachment-count"?: string;
  "message-headers"?: string;
}

function parseMailgunPayload(payload: unknown): InboundEmailPayload | null {
  const data = payload as MailgunPayload;

  const recipientAlias = extractEmailAddress(data.recipient ?? data.To ?? "");
  const messageId = data["Message-Id"] ?? generateFallbackMessageId();

  const from = parseEmailAddress(data.from ?? data.sender ?? "");

  const parsedEmail: ParsedEmail = {
    messageId,
    inReplyTo: data["In-Reply-To"],
    from,
    to: parseRecipientList(data.To ?? data.recipient ?? ""),
    cc: data.Cc ? parseRecipientList(data.Cc) : undefined,
    subject: data.subject,
    snippet: createSnippet(data["stripped-text"] ?? data["body-plain"]),
    textBody: data["body-plain"],
    htmlBody: data["body-html"],
    hasAttachments: (parseInt(data["attachment-count"] ?? "0", 10)) > 0,
    attachmentCount: parseInt(data["attachment-count"] ?? "0", 10),
    date: parseEmailDate(data.Date),
    headers: data["message-headers"]
      ? selectSafeHeaders(parseMailgunHeaders(data["message-headers"]))
      : undefined,
  };

  return {
    provider: "mailgun",
    providerEventId: messageId,
    rawPayload: payload,
    parsedEmail,
    recipientAlias,
  };
}

function parseMailgunHeaders(headersJson: string): Record<string, string> {
  try {
    const headerArray = JSON.parse(headersJson) as Array<[string, string]>;
    const headers: Record<string, string> = {};
    for (const [key, value] of headerArray) {
      headers[key.toLowerCase()] = value;
    }
    return headers;
  } catch {
    return {};
  }
}

// =============================================================================
// Postmark Parser
// =============================================================================

interface PostmarkPayload {
  From?: string;
  FromFull?: { Email: string; Name?: string };
  To?: string;
  ToFull?: Array<{ Email: string; Name?: string }>;
  Cc?: string;
  CcFull?: Array<{ Email: string; Name?: string }>;
  OriginalRecipient?: string;
  Subject?: string;
  MessageID?: string;
  ReplyTo?: string;
  InReplyTo?: string;
  MailboxHash?: string;
  Date?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  Attachments?: Array<{ Name: string; ContentType: string; ContentLength: number }>;
  Headers?: Array<{ Name: string; Value: string }>;
}

function parsePostmarkPayload(payload: unknown): InboundEmailPayload | null {
  const data = payload as PostmarkPayload;

  const recipientAlias = extractEmailAddress(
    data.OriginalRecipient ?? data.To ?? ""
  );
  const messageId = data.MessageID ?? generateFallbackMessageId();

  const from: ParsedEmail["from"] = data.FromFull
    ? { address: data.FromFull.Email, name: data.FromFull.Name }
    : parseEmailAddress(data.From ?? "");

  const to = data.ToFull
    ? data.ToFull.map((r) => r.Email)
    : parseRecipientList(data.To ?? "");

  // Convert headers array to object
  const headers: Record<string, string> = {};
  if (data.Headers) {
    for (const h of data.Headers) {
      headers[h.Name.toLowerCase()] = h.Value;
    }
  }

  const parsedEmail: ParsedEmail = {
    messageId,
    inReplyTo: data.InReplyTo,
    from,
    to,
    cc: data.CcFull?.map((r) => r.Email),
    subject: data.Subject,
    snippet: createSnippet(data.StrippedTextReply ?? data.TextBody),
    textBody: data.TextBody,
    htmlBody: data.HtmlBody,
    hasAttachments: (data.Attachments?.length ?? 0) > 0,
    attachmentCount: data.Attachments?.length ?? 0,
    date: parseEmailDate(data.Date),
    headers: selectSafeHeaders(headers),
  };

  return {
    provider: "postmark",
    providerEventId: messageId,
    rawPayload: payload,
    parsedEmail,
    recipientAlias,
  };
}

// =============================================================================
// Test Parser (Development)
// =============================================================================

interface TestPayload {
  from: string;
  to: string;
  subject?: string;
  body?: string;
  messageId?: string;
}

function parseTestPayload(payload: unknown): InboundEmailPayload | null {
  const data = payload as TestPayload;

  const messageId = data.messageId ?? generateFallbackMessageId();

  const parsedEmail: ParsedEmail = {
    messageId,
    from: parseEmailAddress(data.from),
    to: [extractEmailAddress(data.to)],
    subject: data.subject,
    snippet: createSnippet(data.body),
    textBody: data.body,
    hasAttachments: false,
    attachmentCount: 0,
    date: new Date(),
  };

  return {
    provider: "test",
    providerEventId: messageId,
    rawPayload: payload,
    parsedEmail,
    recipientAlias: extractEmailAddress(data.to),
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse email headers string into key-value object.
 */
function parseHeaders(headersStr: string): Record<string, string> {
  const headers: Record<string, string> = {};

  // Split by newlines, handling folded headers
  const lines = headersStr.replace(/\r\n\s+/g, " ").split(/\r?\n/);

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim().toLowerCase();
      const value = line.substring(colonIndex + 1).trim();
      headers[key] = value;
    }
  }

  return headers;
}

/**
 * Parse email address from "Name <email>" format.
 */
function parseEmailAddress(str: string): { address: string; name?: string } {
  const match = str.match(/^(?:(.+?)\s*)?<([^>]+)>$/);

  if (match) {
    return {
      address: match[2].trim().toLowerCase(),
      name: match[1]?.trim() || undefined,
    };
  }

  // Plain email address
  return { address: str.trim().toLowerCase() };
}

/**
 * Extract just the email address from various formats.
 */
function extractEmailAddress(str: string): string {
  // Handle "Name <email>" format
  const match = str.match(/<([^>]+)>/);
  if (match) {
    return match[1].trim().toLowerCase();
  }

  // Handle comma-separated list (take first)
  const firstEmail = str.split(",")[0].trim();
  return firstEmail.toLowerCase();
}

/**
 * Parse recipient list into array of email addresses.
 */
function parseRecipientList(str: string): string[] {
  if (!str) return [];

  // Split by comma, handling "Name <email>" format
  const addresses: string[] = [];
  const parts = str.split(/,\s*(?=[^<]*(?:<|$))/);

  for (const part of parts) {
    const email = extractEmailAddress(part.trim());
    if (email && email.includes("@")) {
      addresses.push(email);
    }
  }

  return addresses;
}

/**
 * Create sanitized snippet from email body.
 *
 * SECURITY:
 * - Strips HTML tags
 * - Removes potential PII patterns
 * - Truncates to max length
 */
function createSnippet(body?: string): string | undefined {
  if (!body) return undefined;

  // Strip HTML tags
  let text = body.replace(/<[^>]+>/g, " ");

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  // Redact PII patterns
  for (const pattern of PII_PATTERNS) {
    text = text.replace(pattern, "[REDACTED]");
  }

  // Truncate
  if (text.length > MAX_SNIPPET_LENGTH) {
    text = text.substring(0, MAX_SNIPPET_LENGTH - 3) + "...";
  }

  return text || undefined;
}

/**
 * Parse email date string into Date object.
 */
function parseEmailDate(dateStr?: string): Date | undefined {
  if (!dateStr) return undefined;

  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return undefined;
    return date;
  } catch {
    return undefined;
  }
}

/**
 * Generate fallback message ID if not provided.
 */
function generateFallbackMessageId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `<${timestamp}.${random}@opsmanager.generated>`;
}

/**
 * Select only safe headers to store (no sensitive info).
 */
function selectSafeHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const safeHeaders: Record<string, string> = {};
  const allowedHeaders = [
    "message-id",
    "date",
    "subject",
    "in-reply-to",
    "references",
    "thread-id",
    "x-gm-thrid",
    "x-mailer",
    "content-type",
    "mime-version",
  ];

  for (const key of allowedHeaders) {
    if (headers[key]) {
      safeHeaders[key] = headers[key];
    }
  }

  return safeHeaders;
}

// =============================================================================
// Alias Extraction
// =============================================================================

/**
 * Extract alias key from recipient email address.
 * Expected format: inbox-{key}@domain.com
 */
export function extractAliasKey(recipientAddress: string): string | null {
  const match = recipientAddress.match(/^inbox-([a-z0-9]+)@/i);
  return match ? match[1].toLowerCase() : null;
}
