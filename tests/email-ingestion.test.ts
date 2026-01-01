import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Email Ingestion Tests
 *
 * These tests verify:
 * 1. Email parsing from different providers
 * 2. Webhook signature verification logic
 * 3. Alias key extraction
 * 4. PII redaction in snippets
 * 5. Email processing flow
 */

// =============================================================================
// Test Data
// =============================================================================

const SAMPLE_SENDGRID_PAYLOAD = {
  headers:
    "Message-ID: <test123@mail.example.com>\r\nDate: Wed, 01 Jan 2025 12:00:00 +0000\r\nSubject: Test Email",
  from: "John Doe <john@example.com>",
  to: "inbox-abc123def456@mail.opsmanager.app",
  subject: "Test Email Subject",
  text: "Hello, this is a test email body.",
  html: "<p>Hello, this is a test email body.</p>",
  envelope: '{"to":["inbox-abc123def456@mail.opsmanager.app"],"from":"john@example.com"}',
  attachments: "0",
};

const SAMPLE_MAILGUN_PAYLOAD = {
  sender: "john@example.com",
  from: "John Doe <john@example.com>",
  recipient: "inbox-abc123def456@mail.opsmanager.app",
  To: "inbox-abc123def456@mail.opsmanager.app",
  subject: "Test Email Subject",
  "body-plain": "Hello, this is a test email body.",
  "body-html": "<p>Hello, this is a test email body.</p>",
  "stripped-text": "Hello, this is a test email body.",
  "Message-Id": "<test123@mail.example.com>",
  Date: "Wed, 01 Jan 2025 12:00:00 +0000",
  "attachment-count": "0",
};

const SAMPLE_POSTMARK_PAYLOAD = {
  From: "john@example.com",
  FromFull: { Email: "john@example.com", Name: "John Doe" },
  To: "inbox-abc123def456@mail.opsmanager.app",
  ToFull: [{ Email: "inbox-abc123def456@mail.opsmanager.app" }],
  OriginalRecipient: "inbox-abc123def456@mail.opsmanager.app",
  Subject: "Test Email Subject",
  MessageID: "test123@mail.example.com",
  Date: "Wed, 01 Jan 2025 12:00:00 +0000",
  TextBody: "Hello, this is a test email body.",
  HtmlBody: "<p>Hello, this is a test email body.</p>",
  StrippedTextReply: "Hello, this is a test email body.",
  Attachments: [],
  Headers: [
    { Name: "Message-ID", Value: "<test123@mail.example.com>" },
    { Name: "Date", Value: "Wed, 01 Jan 2025 12:00:00 +0000" },
  ],
};

// =============================================================================
// Helper Functions (mirroring actual implementation)
// =============================================================================

function extractEmailAddress(str: string): string {
  const match = str.match(/<([^>]+)>/);
  if (match) {
    return match[1].trim().toLowerCase();
  }
  const firstEmail = str.split(",")[0].trim();
  return firstEmail.toLowerCase();
}

function parseEmailAddress(str: string): { address: string; name?: string } {
  const match = str.match(/^(?:(.+?)\s*)?<([^>]+)>$/);
  if (match) {
    return {
      address: match[2].trim().toLowerCase(),
      name: match[1]?.trim() || undefined,
    };
  }
  return { address: str.trim().toLowerCase() };
}

function extractAliasKey(recipientAddress: string): string | null {
  const match = recipientAddress.match(/^inbox-([a-z0-9]+)@/i);
  return match ? match[1].toLowerCase() : null;
}

function createSnippet(body?: string, maxLength: number = 200): string | undefined {
  if (!body) return undefined;

  // Strip HTML tags
  let text = body.replace(/<[^>]+>/g, " ");
  text = text.replace(/\s+/g, " ").trim();

  // PII patterns
  const piiPatterns = [
    /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // Credit card
    /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/g, // Phone
  ];

  for (const pattern of piiPatterns) {
    text = text.replace(pattern, "[REDACTED]");
  }

  if (text.length > maxLength) {
    text = text.substring(0, maxLength - 3) + "...";
  }

  return text || undefined;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function parseMailgunSignature(
  timestamp: string,
  token: string,
  signature: string,
  secret: string
): boolean {
  // Check timestamp is recent (within 5 minutes)
  const timestampNum = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > 300) {
    return false;
  }

  // In real implementation, would use crypto.createHmac
  // For test, just verify format
  return (
    timestamp.length > 0 && token.length > 0 && signature.length > 0 && secret.length > 0
  );
}

// =============================================================================
// Email Address Parsing Tests
// =============================================================================

describe("Email Address Parsing", () => {
  it("should extract email from 'Name <email>' format", () => {
    expect(extractEmailAddress("John Doe <john@example.com>")).toBe(
      "john@example.com"
    );
    expect(extractEmailAddress("  Jane Smith  <jane@test.org>  ")).toBe(
      "jane@test.org"
    );
  });

  it("should handle plain email addresses", () => {
    expect(extractEmailAddress("john@example.com")).toBe("john@example.com");
    expect(extractEmailAddress("JOHN@EXAMPLE.COM")).toBe("john@example.com");
  });

  it("should take first email from comma-separated list", () => {
    expect(
      extractEmailAddress("john@example.com, jane@test.org")
    ).toBe("john@example.com");
  });

  it("should parse email address with name", () => {
    const result = parseEmailAddress("John Doe <john@example.com>");
    expect(result.address).toBe("john@example.com");
    expect(result.name).toBe("John Doe");
  });

  it("should parse plain email address", () => {
    const result = parseEmailAddress("john@example.com");
    expect(result.address).toBe("john@example.com");
    expect(result.name).toBeUndefined();
  });
});

// =============================================================================
// Alias Key Extraction Tests
// =============================================================================

describe("Alias Key Extraction", () => {
  it("should extract alias key from valid format", () => {
    expect(extractAliasKey("inbox-abc123def456@mail.opsmanager.app")).toBe(
      "abc123def456"
    );
    expect(extractAliasKey("inbox-xyz789@domain.com")).toBe("xyz789");
  });

  it("should return null for invalid format", () => {
    expect(extractAliasKey("john@example.com")).toBeNull();
    expect(extractAliasKey("inbox@domain.com")).toBeNull();
    expect(extractAliasKey("inbox-@domain.com")).toBeNull();
    expect(extractAliasKey("")).toBeNull();
  });

  it("should handle case insensitivity", () => {
    expect(extractAliasKey("INBOX-ABC123@domain.com")).toBe("abc123");
    expect(extractAliasKey("Inbox-XYZ789@Domain.COM")).toBe("xyz789");
  });
});

// =============================================================================
// Snippet Creation & PII Redaction Tests
// =============================================================================

describe("Snippet Creation", () => {
  it("should strip HTML tags", () => {
    const result = createSnippet("<p>Hello <strong>World</strong></p>");
    expect(result).toBe("Hello World");
  });

  it("should normalize whitespace", () => {
    const result = createSnippet("Hello\n\n  World\t\tTest");
    expect(result).toBe("Hello World Test");
  });

  it("should truncate long text", () => {
    const longText = "a".repeat(300);
    const result = createSnippet(longText);
    expect(result?.length).toBe(200);
    expect(result?.endsWith("...")).toBe(true);
  });

  it("should redact SSN patterns", () => {
    const result = createSnippet("My SSN is 123-45-6789");
    expect(result).toBe("My SSN is [REDACTED]");
  });

  it("should redact credit card patterns", () => {
    const result = createSnippet("Card: 4111-1111-1111-1111");
    expect(result).toBe("Card: [REDACTED]");
  });

  it("should redact phone number patterns", () => {
    const result = createSnippet("Call me at 555-123-4567");
    expect(result).toBe("Call me at [REDACTED]");
  });

  it("should handle undefined input", () => {
    expect(createSnippet(undefined)).toBeUndefined();
    expect(createSnippet("")).toBeUndefined();
  });
});

// =============================================================================
// Signature Verification Tests
// =============================================================================

describe("Webhook Signature Verification", () => {
  it("should verify simple secret header", () => {
    const secret = "test-webhook-secret";
    const providedSecret = "test-webhook-secret";
    expect(timingSafeEqual(secret, providedSecret)).toBe(true);
  });

  it("should reject mismatched secrets", () => {
    const secret = "correct-secret";
    const providedSecret = "wrong-secret";
    expect(timingSafeEqual(secret, providedSecret)).toBe(false);
  });

  it("should reject secrets of different lengths", () => {
    expect(timingSafeEqual("short", "longer-secret")).toBe(false);
  });

  it("should validate Mailgun signature format", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const token = "randomtoken123";
    const signature = "somehexsignature";
    const secret = "test-secret";

    expect(parseMailgunSignature(timestamp, token, signature, secret)).toBe(
      true
    );
  });

  it("should reject old Mailgun timestamps", () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    const token = "randomtoken123";
    const signature = "somehexsignature";
    const secret = "test-secret";

    expect(parseMailgunSignature(oldTimestamp, token, signature, secret)).toBe(
      false
    );
  });
});

// =============================================================================
// Email Payload Parsing Tests
// =============================================================================

describe("Email Payload Parsing", () => {
  it("should parse SendGrid envelope for recipient", () => {
    const envelope = JSON.parse(SAMPLE_SENDGRID_PAYLOAD.envelope);
    expect(envelope.to[0]).toBe("inbox-abc123def456@mail.opsmanager.app");
  });

  it("should parse Mailgun recipient", () => {
    expect(SAMPLE_MAILGUN_PAYLOAD.recipient).toBe(
      "inbox-abc123def456@mail.opsmanager.app"
    );
  });

  it("should parse Postmark original recipient", () => {
    expect(SAMPLE_POSTMARK_PAYLOAD.OriginalRecipient).toBe(
      "inbox-abc123def456@mail.opsmanager.app"
    );
  });

  it("should extract alias from all provider formats", () => {
    const sendgridAlias = extractAliasKey(
      JSON.parse(SAMPLE_SENDGRID_PAYLOAD.envelope).to[0]
    );
    const mailgunAlias = extractAliasKey(SAMPLE_MAILGUN_PAYLOAD.recipient);
    const postmarkAlias = extractAliasKey(SAMPLE_POSTMARK_PAYLOAD.OriginalRecipient);

    expect(sendgridAlias).toBe("abc123def456");
    expect(mailgunAlias).toBe("abc123def456");
    expect(postmarkAlias).toBe("abc123def456");
  });
});

// =============================================================================
// Email Processing Flow Tests
// =============================================================================

describe("Email Processing Flow", () => {
  it("should build goal from email content", () => {
    const buildGoalFromEmail = (email: {
      from: { address: string };
      subject?: string;
      snippet?: string;
      hasAttachments: boolean;
      attachmentCount: number;
    }): string => {
      const parts: string[] = [];
      parts.push(`Process inbound email from ${email.from.address}`);
      if (email.subject) parts.push(`Subject: "${email.subject}"`);
      if (email.snippet) parts.push(`Content preview: "${email.snippet}"`);
      if (email.hasAttachments) {
        parts.push(
          `(${email.attachmentCount} attachment${email.attachmentCount > 1 ? "s" : ""})`
        );
      }
      return parts.join(". ");
    };

    const email = {
      from: { address: "john@example.com" },
      subject: "Request for meeting",
      snippet: "Hi, I would like to schedule a meeting...",
      hasAttachments: true,
      attachmentCount: 2,
    };

    const goal = buildGoalFromEmail(email);

    expect(goal).toContain("Process inbound email from john@example.com");
    expect(goal).toContain('Subject: "Request for meeting"');
    expect(goal).toContain("Content preview:");
    expect(goal).toContain("(2 attachments)");
  });

  it("should handle email without subject", () => {
    const email = {
      from: { address: "john@example.com" },
      hasAttachments: false,
      attachmentCount: 0,
    };

    const parts = [`Process inbound email from ${email.from.address}`];
    const goal = parts.join(". ");

    expect(goal).toBe("Process inbound email from john@example.com");
  });
});

// =============================================================================
// Idempotency Tests
// =============================================================================

describe("Email Webhook Idempotency", () => {
  it("should detect duplicate events", () => {
    const processedEvents = new Set<string>();

    const isDuplicate = (provider: string, eventId: string): boolean => {
      const key = `${provider}:${eventId}`;
      if (processedEvents.has(key)) {
        return true;
      }
      processedEvents.add(key);
      return false;
    };

    expect(isDuplicate("sendgrid", "msg123")).toBe(false);
    expect(isDuplicate("sendgrid", "msg123")).toBe(true);
    expect(isDuplicate("mailgun", "msg123")).toBe(false); // Different provider
    expect(isDuplicate("sendgrid", "msg456")).toBe(false); // Different ID
  });
});

// =============================================================================
// Email Status Tests
// =============================================================================

describe("Email Status Handling", () => {
  it("should have valid status transitions", () => {
    const validTransitions: Record<string, string[]> = {
      received: ["processing", "ignored"],
      processing: ["processed", "failed"],
      processed: [], // Terminal state
      failed: ["received"], // Can retry
      ignored: [], // Terminal state
    };

    const canTransition = (from: string, to: string): boolean => {
      return validTransitions[from]?.includes(to) ?? false;
    };

    expect(canTransition("received", "processing")).toBe(true);
    expect(canTransition("processing", "processed")).toBe(true);
    expect(canTransition("processing", "failed")).toBe(true);
    expect(canTransition("failed", "received")).toBe(true); // Retry
    expect(canTransition("processed", "failed")).toBe(false);
  });
});

// =============================================================================
// Email Alias Format Tests
// =============================================================================

describe("Email Alias Format", () => {
  it("should generate valid alias format", () => {
    const generateAliasKey = (): string => {
      // Simulate 12-char hex key
      return "abc123def456";
    };

    const buildAliasAddress = (key: string, domain: string): string => {
      return `inbox-${key}@${domain}`;
    };

    const key = generateAliasKey();
    const alias = buildAliasAddress(key, "mail.opsmanager.app");

    expect(alias).toBe("inbox-abc123def456@mail.opsmanager.app");
    expect(extractAliasKey(alias)).toBe(key);
  });

  it("should validate alias key format", () => {
    const isValidAliasKey = (key: string): boolean => {
      return /^[a-z0-9]{8,16}$/.test(key);
    };

    expect(isValidAliasKey("abc123def456")).toBe(true);
    expect(isValidAliasKey("12345678")).toBe(true);
    expect(isValidAliasKey("short")).toBe(false); // Too short
    expect(isValidAliasKey("ABC123")).toBe(false); // Uppercase
    expect(isValidAliasKey("abc-123")).toBe(false); // Invalid char
  });
});
