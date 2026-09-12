/**
 * Email sending for Veyra — meeting invites, the host's invite
 * confirmation, and password reset codes.
 *
 * Built on nodemailer rather than a hand-rolled SMTP client. An earlier
 * version of this file implemented the SMTP + STARTTLS handshake by hand
 * over raw sockets — that's exactly the kind of thing that's easy to get
 * subtly wrong (this project hit ERR_SSL_WRONG_VERSION_NUMBER from it:
 * a STARTTLS sequencing bug where the TLS handshake started before the
 * plaintext side was fully done, so the TLS layer read leftover plaintext
 * bytes as if they were a TLS record). nodemailer has handled this
 * correctly across every real-world SMTP server's quirks for years —
 * there's no good reason to keep maintaining a bespoke implementation of
 * a solved problem.
 */
import nodemailer, { type Transporter } from "nodemailer";

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Created lazily and cached, not at module load time — a missing/bad env
// var only breaks the one request that actually tries to send an email,
// instead of crashing on import.
let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;

  const host = env("SMTP_HOST");
  const port = Number(env("SMTP_PORT") || "587");
  const user = env("SMTP_USER_EMAIL");
  const pass = env("SMTP_USER_PASSWORD");

  if (!host || !user || !pass) {
    throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_USER_EMAIL and SMTP_USER_PASSWORD.");
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 (the default here) = STARTTLS
    auth: { user, pass },
  });

  return cachedTransporter;
}

type MailOptions = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

async function sendMail(options: MailOptions) {
  const transporter = getTransporter();
  const user = env("SMTP_USER_EMAIL");

  await transporter.sendMail({
    from: `"Veyra" <${user}>`,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  });
}

export async function sendMeetingInviteEmail(args: {
  to: string;
  hostName: string;
  meetingUrl: string;
  scheduledAt?: Date | null;
}) {
  const when = args.scheduledAt
    ? args.scheduledAt.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })
    : "now";

  const subject = args.scheduledAt ? `${args.hostName} scheduled a Veyra meeting` : `${args.hostName} invited you to a Veyra meeting`;
  const text = args.scheduledAt
    ? `${args.hostName} invited you to a Veyra meeting scheduled for ${when}.\n\nJoin the meeting: ${args.meetingUrl}`
    : `${args.hostName} invited you to a Veyra meeting.\n\nJoin the meeting: ${args.meetingUrl}`;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#202124">
      <h2>${escapeHtml(subject)}</h2>
      <p>${escapeHtml(args.hostName)} invited you to a Veyra meeting.</p>
      ${args.scheduledAt ? `<p><strong>Scheduled for:</strong> ${escapeHtml(when)}</p>` : ""}
      <p><a href="${escapeHtml(args.meetingUrl)}">${escapeHtml(args.meetingUrl)}</a></p>
      <p>Open the link to view the meeting and join when the host starts it.</p>
    </div>`;

  await sendMail({ to: args.to, subject, text, html });
}

export function defaultInviteRecipient() {
  return env("SMTP_USER_EMAIL");
}

export async function sendHostInviteConfirmationEmail(args: {
  to: string;
  invitedEmails: string[];
  meetingUrl: string;
  scheduledAt?: Date | null;
}) {
  const when = args.scheduledAt
    ? args.scheduledAt.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })
    : null;
  const subject = when
    ? `Your Veyra meeting is scheduled for ${when}`
    : `You invited ${args.invitedEmails.length} ${args.invitedEmails.length === 1 ? "person" : "people"} to your Veyra meeting`;
  const list = args.invitedEmails.map((e) => escapeHtml(e)).join(", ");
  const text = [
    when ? `Your Veyra meeting is scheduled for ${when}.` : null,
    args.invitedEmails.length ? `You invited: ${args.invitedEmails.join(", ")}` : null,
    `Meeting link: ${args.meetingUrl}`,
  ].filter(Boolean).join("\n\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#202124">
      <h2>${escapeHtml(subject)}</h2>
      ${when ? `<p><strong>Scheduled for:</strong> ${escapeHtml(when)}</p>` : ""}
      ${args.invitedEmails.length ? `<p>You invited: ${list}</p>` : ""}
      <p><a href="${escapeHtml(args.meetingUrl)}">${escapeHtml(args.meetingUrl)}</a></p>
    </div>`;

  await sendMail({ to: args.to, subject, text, html });
}

export async function sendPasswordResetEmail(args: { to: string; code: string; validMinutes: number }) {
  const subject = "Your Veyra password reset code";
  const text = `Your Veyra password reset code is ${args.code}. It expires in ${args.validMinutes} minutes. If you didn't request this, you can safely ignore this email.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#202124">
      <h2>Reset your password</h2>
      <p>Use the code below to reset your Veyra password. It expires in ${args.validMinutes} minutes.</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f1f5f9;padding:16px 24px;border-radius:10px;text-align:center;color:#0f172a">
        ${escapeHtml(args.code)}
      </div>
      <p style="color:#64748b;font-size:13px;margin-top:20px">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>`;

  await sendMail({ to: args.to, subject, text, html });
}
