import { buildPasswordResetMessage, MailMessage } from '../../src/modules/mail/mail.service';

/** In-memory replacement for MailService: records every email instead of sending it. */
export class FakeMailService {
  readonly outbox: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    return Promise.resolve();
  }

  sendPasswordResetCode(to: string, code: string, ttlMinutes: number): Promise<void> {
    return this.send(buildPasswordResetMessage(to, code, ttlMinutes));
  }

  /** Last reset code emailed to `to`. */
  lastResetCode(to: string): string | undefined {
    const message = [...this.outbox].reverse().find((m) => m.to === to);
    return message?.text.match(/\b(\d{6})\b/)?.[1];
  }

  clear(): void {
    this.outbox.length = 0;
  }
}
