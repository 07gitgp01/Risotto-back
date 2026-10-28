import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';

export interface PushMessage {
  title: string;
  body: string;
  /** Routing hints for the app (type, ids). Never sensitive content. */
  data: Record<string, string>;
}

export interface PushResult {
  /** Tokens rejected by FCM as no longer valid: they are deleted. */
  invalidTokens: string[];
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushSender {
  send(tokens: string[], message: PushMessage): Promise<PushResult>;
}

/** Used when FCM is not configured (local development, tests). */
export class NoopPushSender implements PushSender {
  private readonly logger = new Logger('Push');

  send(tokens: string[], message: PushMessage): Promise<PushResult> {
    this.logger.debug(`Push disabled, skipped "${message.title}" for ${tokens.length} device(s)`);
    return Promise.resolve({ invalidTokens: [] });
  }
}

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/** Firebase Cloud Messaging, from a service account JSON file (never committed). */
export class FcmPushSender implements PushSender {
  private readonly logger = new Logger('Push');
  private readonly messaging: Promise<import('firebase-admin/messaging').Messaging>;

  constructor(serviceAccountPath: string) {
    this.messaging = (async () => {
      const { cert, getApps, initializeApp } = await import('firebase-admin/app');
      const { getMessaging } = await import('firebase-admin/messaging');
      const credentials = JSON.parse(readFileSync(serviceAccountPath, 'utf8')) as Record<
        string,
        string
      >;
      const app =
        getApps().find((a) => a.name === 'risotto') ??
        initializeApp({ credential: cert(credentials) }, 'risotto');
      return getMessaging(app);
    })();
  }

  async send(tokens: string[], message: PushMessage): Promise<PushResult> {
    if (tokens.length === 0) {
      return { invalidTokens: [] };
    }
    const messaging = await this.messaging;
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: { priority: 'high', notification: { channelId: 'risotto_default' } },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    const invalidTokens = response.responses.flatMap((result, index) =>
      !result.success && INVALID_TOKEN_CODES.has(result.error?.code ?? '') ? [tokens[index]] : [],
    );
    if (response.failureCount > invalidTokens.length) {
      this.logger.warn(`${response.failureCount - invalidTokens.length} push(es) failed`);
    }
    return { invalidTokens };
  }
}
