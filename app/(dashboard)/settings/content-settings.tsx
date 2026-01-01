"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { type OrgSettings, updateContentSettings } from "@/lib/actions/settings";

interface ContentSettingsProps {
  settings: OrgSettings | null;
}

export function ContentSettings({ settings }: ContentSettingsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [defaultTone, setDefaultTone] = useState(
    settings?.default_tone ?? "professional"
  );
  const [signatureTemplate, setSignatureTemplate] = useState(
    settings?.signature_template ?? ""
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const result = await updateContentSettings({
      default_tone: defaultTone as OrgSettings["default_tone"],
      signature_template: signatureTemplate || null,
    });

    if (result.error) {
      setError(result.error);
    } else {
      router.refresh();
    }

    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Default Tone */}
      <div>
        <label className="text-sm font-medium">Default Tone</label>
        <p className="mb-2 text-sm text-muted-foreground">
          The default tone for generated content
        </p>
        <NativeSelect
          value={defaultTone}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDefaultTone(e.target.value)}
          className="w-[200px]"
        >
          <option value="formal">Formal</option>
          <option value="professional">Professional</option>
          <option value="friendly">Friendly</option>
          <option value="casual">Casual</option>
        </NativeSelect>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <ToneExample tone="formal" selected={defaultTone === "formal"}>
            Dear Mr. Smith, I am writing to formally request...
          </ToneExample>
          <ToneExample tone="professional" selected={defaultTone === "professional"}>
            Hi John, I hope this message finds you well...
          </ToneExample>
          <ToneExample tone="friendly" selected={defaultTone === "friendly"}>
            Hi John! I&apos;d love to connect about...
          </ToneExample>
          <ToneExample tone="casual" selected={defaultTone === "casual"}>
            Hey John, quick note about...
          </ToneExample>
        </div>
      </div>

      <hr />

      {/* Signature Template */}
      <div>
        <label className="text-sm font-medium">Email Signature Template</label>
        <p className="mb-2 text-sm text-muted-foreground">
          Default signature to include in emails. Leave blank to use no signature.
        </p>
        <textarea
          value={signatureTemplate}
          onChange={(e) => setSignatureTemplate(e.target.value)}
          placeholder="Best regards,&#10;{sender_name}&#10;{company_name}"
          rows={4}
          maxLength={500}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Available variables: {"{sender_name}"}, {"{company_name}"}, {"{sender_email}"}
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}

function ToneExample({
  tone,
  selected,
  children,
}: {
  tone: string;
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        selected ? "border-primary bg-primary/5" : "border-input"
      }`}
    >
      <p className="mb-1 text-xs font-medium capitalize text-muted-foreground">
        {tone}
      </p>
      <p className="text-sm italic">&quot;{children}&quot;</p>
    </div>
  );
}
