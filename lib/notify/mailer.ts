import "server-only";
import nodemailer from "nodemailer";

// The one place that sends email. It sends only when SMTP is configured; with
// no settings it does nothing and says so, so callers keep the record in the
// database and the Primus team reads it in the app instead. It never throws
// and never logs the message body, because bodies can hold personal data.
//
// Settings (see .env.example): SMTP_URL (for example smtps://user:pass@host:465)
// or SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS; and MAIL_FROM.

export type MailStatus = "sent" | "not_configured" | "failed";

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

function transport() {
  const url = process.env.SMTP_URL?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!from) return null;
  const opts = { connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000 };
  if (url) return { from, t: nodemailer.createTransport(url, opts) };
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER?.trim();
  return { from, t: nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass: process.env.SMTP_PASS ?? "" } : undefined, ...opts }) };
}

export async function sendMail(input: MailInput): Promise<MailStatus> {
  const cfg = transport();
  if (!cfg) return "not_configured";
  try {
    await cfg.t.sendMail({ from: cfg.from, to: input.to, subject: input.subject, text: input.text, replyTo: input.replyTo });
    return "sent";
  } catch (err) {
    console.error("mail send failed", (err as { code?: string }).code ?? "error");
    return "failed";
  }
}

/** The inbox where Primus reads consultation requests. */
export function consultationInbox(): string | null {
  return process.env.CONSULTATION_INBOX_EMAIL?.trim() || null;
}

/** The address people write to about their personal data, shown in the notice. Falls back to the inbox. */
export function privacyContact(): string | null {
  return process.env.PRIVACY_CONTACT_EMAIL?.trim() || consultationInbox();
}
