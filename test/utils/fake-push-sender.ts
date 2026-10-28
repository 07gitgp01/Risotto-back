import {
  PushMessage,
  PushResult,
  PushSender,
} from '../../src/modules/notifications/push/push-sender';

/** Records pushes instead of calling FCM. Tokens listed in `invalid` are reported as dead. */
export class FakePushSender implements PushSender {
  readonly sent: { tokens: string[]; message: PushMessage }[] = [];
  readonly invalid = new Set<string>();

  send(tokens: string[], message: PushMessage): Promise<PushResult> {
    this.sent.push({ tokens, message });
    return Promise.resolve({ invalidTokens: tokens.filter((t) => this.invalid.has(t)) });
  }

  clear(): void {
    this.sent.length = 0;
    this.invalid.clear();
  }
}
