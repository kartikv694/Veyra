import net from "node:net";
import tls from "node:tls";

type MailOptions = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

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

class SmtpClient {
  private socket: net.Socket | tls.TLSSocket;
  private buffer = "";
  private waiters: Array<{ resolve: (value: string) => void; reject: (err: Error) => void }> = [];

  constructor(socket: net.Socket | tls.TLSSocket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on("error", (err) => {
      while (this.waiters.length) this.waiters.shift()!.reject(err);
    });
    socket.on("close", () => {
      if (this.waiters.length) {
        const err = new Error("SMTP connection closed unexpectedly.");
        while (this.waiters.length) this.waiters.shift()!.reject(err);
      }
    });
  }

  private flush() {
    while (this.waiters.length) {
      const match = this.buffer.match(/^([0-9]{3})[ -].*(?:\r?\n)/m);
      if (!match) return;
      const code = match[1];
      const lines = this.buffer.split(/\r?\n/);
      let endIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^[0-9]{3} /.test(lines[i])) {
          endIndex = i;
          break;
        }
      }
      if (endIndex < 0) return;
      const response = lines.slice(0, endIndex + 1).join("\n");
      const consumed = lines.slice(0, endIndex + 1).join("\r\n").length;
      this.buffer = this.buffer.slice(consumed).replace(/^\r?\n/, "");
      const waiter = this.waiters.shift()!;
      if (code.startsWith("4") || code.startsWith("5")) {
        waiter.reject(new Error(`SMTP ${code}: ${response}`));
      } else {
        waiter.resolve(response);
      }
    }
  }

  command(command: string) {
    return new Promise<string>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.socket.write(`${command}\r\n`);
    });
  }

  detach() {
    this.socket.removeAllListeners("data");
    this.socket.removeAllListeners("error");
    this.socket.removeAllListeners("close");
    this.waiters = [];
  }

  close() {
    this.socket.end();
  }
}

function connectSocket(host: string, port: number) {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => resolve(socket));
    socket.once("error", reject);
  });
}

function upgradeToTls(socket: net.Socket, host: string) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const secure = tls.connect({ socket, host, servername: host }, () => resolve(secure));
    secure.once("error", reject);
  });
}

async function sendMail(options: MailOptions) {
  const host = env("SMTP_HOST");
  const port = Number(env("SMTP_PORT") || "587");
  const username = env("SMTP_USER_EMAIL");
  const password = env("SMTP_USER_PASSWORD");
  if (!host || !username || !password) {
    throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER_EMAIL and SMTP_USER_PASSWORD.");
  }

  let socket = await connectSocket(host, port);
  let client = new SmtpClient(socket);
  await client.command(`EHLO ${host}`);

  if (port === 465) {
    client.close();
    socket = await new Promise<net.Socket>((resolve, reject) => {
      const secure = tls.connect({ host, port, servername: host }, () => resolve(secure as unknown as net.Socket));
      secure.once("error", reject);
    });
    client = new SmtpClient(socket);
  } else {
    await client.command("STARTTLS");
    client.detach();
    socket = await upgradeToTls(socket, host);
    client = new SmtpClient(socket);
    await client.command(`EHLO ${host}`);
  }

  await client.command("AUTH LOGIN");
  await client.command(Buffer.from(username).toString("base64"));
  await client.command(Buffer.from(password).toString("base64"));
  await client.command(`MAIL FROM:<${username}>`);
  await client.command(`RCPT TO:<${options.to}>`);
  await client.command("DATA");

  const fromName = "Veyra";
  const headers = [
    `From: ${fromName} <${username}>`,
    `To: <${options.to}>`,
    `Subject: ${options.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="veyra-boundary"`,
  ].join("\r\n");

  const html = options.html ?? `<p>${escapeHtml(options.text).replaceAll("\n", "<br>")}</p>`;
  const message = [
    headers,
    "",
    "--veyra-boundary",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    options.text,
    "--veyra-boundary",
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
    "--veyra-boundary--",
    "",
    ".",
  ].join("\r\n");

  await client.command(message.replace(/\n/g, "\r\n"));
  await client.command("QUIT");
  client.close();
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
