/* AGPL-3.0-or-later */
import type { Bindings } from "../types";

// Named SendEmailOptions (not EmailMessage) to avoid shadowing the global
// `cloudflare:email` EmailMessage interface in the Worker types.
export type SendEmailOptions = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string; // defaults to env.EMAIL_FROM
};

/**
 * Send an email via Cloudflare's native Email Service binding.
 * Returns the provider messageId. Throws on send failure.
 *
 * Recipients: any *verified destination address* always works; *arbitrary*
 * recipients require a sending domain onboarded in Email Service (see README).
 */
export async function sendEmail(
  env: Pick<Bindings, "EMAIL" | "EMAIL_FROM">,
  msg: SendEmailOptions,
): Promise<{ messageId: string }> {
  if (!msg.html && !msg.text) {
    throw new Error("sendEmail: provide at least one of `html` or `text`");
  }
  const from = msg.from ?? env.EMAIL_FROM;
  const text = msg.text ?? (msg.html ? stripHtml(msg.html) : undefined);
  const res = await env.EMAIL.send({
    from,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text,
  });
  return { messageId: res.messageId };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
