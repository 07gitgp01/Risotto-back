import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
export const CURRENT_KEY_VERSION = 1;

/**
 * AES-256-GCM encryption at rest. Not end-to-end: the server holds the key.
 * The associated data binds a ciphertext to its conversation and sender, so a row
 * copied into another conversation fails to decrypt.
 */
export class MessageCipher {
  private readonly keys: Map<number, Buffer>;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) {
      throw new Error('MESSAGE_ENCRYPTION_KEY must decode to 32 bytes');
    }
    // Key rotation: add older versions here and keep encrypting with the newest.
    this.keys = new Map([[CURRENT_KEY_VERSION, key]]);
  }

  encrypt(plaintext: string, associatedData: string): EncryptedPayload {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key(CURRENT_KEY_VERSION), iv);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: CURRENT_KEY_VERSION };
  }

  /** Throws if the data was tampered with or does not belong to `associatedData`. */
  decrypt(payload: EncryptedPayload, associatedData: string): string {
    const decipher = createDecipheriv(ALGORITHM, this.key(payload.keyVersion), payload.iv);
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(payload.authTag);
    return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString('utf8');
  }

  private key(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(`Unknown message key version ${version}`);
    }
    return key;
  }
}
