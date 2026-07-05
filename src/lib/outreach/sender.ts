// Server-only outreach email sender. External HTTPS I/O + reads a secret key,
// so it is imported ONLY by the send server action, the lead-detail RSC page,
// and tests — never by a client component. Thin transport: all guards (auth,
// draft present, mode, recipient) live in the server action, not here.
import { Resend } from "resend";
import { env } from "@/lib/env";

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/** True only when both Resend env vars are set. */
export function isSendConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.OUTREACH_FROM_EMAIL);
}

/**
 * Send a plain-text email via Resend. Never throws: every failure — unconfigured,
 * a provider-reported error, or a thrown SDK/network error — returns a sanitized
 * SendResult. No raw provider message, key, or stack ever reaches the caller.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<SendResult> {
  if (!env.RESEND_API_KEY || !env.OUTREACH_FROM_EMAIL) {
    return { ok: false, error: "Email sending is not configured." };
  }
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: env.OUTREACH_FROM_EMAIL,
      to: input.to,
      subject: input.subject,
      text: input.body,
    });
    if (error || !data) {
      return { ok: false, error: "Sending failed. Check the email provider configuration." };
    }
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, error: "Sending failed. Check the email provider configuration." };
  }
}
