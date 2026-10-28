import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

/** SHA-256 hex digest. Enough for high-entropy secrets such as refresh tokens. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Keyed HMAC-SHA256 hex digest. Required for low-entropy secrets (6-digit codes). */
export function hmacSha256(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

/** URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Uniformly distributed numeric code, left-padded with zeros. */
export function randomDigits(length: number): string {
  return Array.from({ length }, () => randomInt(0, 10)).join('');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
