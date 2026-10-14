// Mail transports (ADM-07): SMTP via nodemailer for real delivery, a log
// transport for development, or disabled.
import nodemailer, { type Transporter } from "nodemailer";

export type OutgoingMail = { to: string; subject: string; text: string; html: string };
export type SendResult = { messageId: string };

export interface MailTransport {
  readonly name: string;
  readonly description: string;
  send(mail: OutgoingMail): Promise<SendResult>;
}

export class LogTransport implements MailTransport {
  readonly name = "log";
  readonly description = "Log transport: emails are recorded as sent without leaving the server (development).";
  readonly sent: OutgoingMail[] = [];
  async send(mail: OutgoingMail): Promise<SendResult> {
    this.sent.push(mail);
    if (process.env.NODE_ENV !== "test") console.info(`[mail:log] to=${mail.to} subject="${mail.subject}"`);
    return { messageId: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` };
  }
}

export class DisabledTransport implements MailTransport {
  readonly name = "disabled";
  readonly description = "Email delivery is disabled: queued emails wait until a transport is configured.";
  async send(): Promise<SendResult> {
    throw new Error("Email transport is disabled");
  }
}

export type SmtpConfig = { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string };

export class SmtpTransport implements MailTransport {
  readonly name = "smtp";
  readonly description: string;
  private readonly mailer: Transporter;
  constructor(private readonly config: SmtpConfig) {
    this.description = `SMTP ${config.host}:${config.port}${config.secure ? " (TLS)" : ""} as ${config.from}`;
    this.mailer = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass ?? "" } : undefined,
      connectionTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  async send(mail: OutgoingMail): Promise<SendResult> {
    const info = await this.mailer.sendMail({ from: this.config.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    return { messageId: info.messageId };
  }
}

/** Picks the transport from the environment: EMAIL_TRANSPORT=smtp|log|disabled (default smtp when SMTP_HOST is set, else log). */
export function transportFromEnv(env: NodeJS.ProcessEnv = process.env): MailTransport {
  const mode = env.EMAIL_TRANSPORT ?? (env.SMTP_HOST ? "smtp" : "log");
  if (mode === "disabled") return new DisabledTransport();
  if (mode === "smtp") {
    if (!env.SMTP_HOST) throw new Error("EMAIL_TRANSPORT=smtp requires SMTP_HOST");
    return new SmtpTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? 587),
      secure: env.SMTP_SECURE === "true",
      user: env.SMTP_USER || undefined,
      pass: env.SMTP_PASS || undefined,
      from: env.MAIL_FROM ?? "Staff Accommodation <no-reply@example.com>",
    });
  }
  return new LogTransport();
}
