import { randomBytes } from 'crypto';
import { MessageCipher } from './message-cipher';

describe('MessageCipher', () => {
  const cipher = new MessageCipher(randomBytes(32).toString('base64'));

  it('round-trips unicode text', () => {
    const encrypted = cipher.encrypt('Bonjour 👋 — à bientôt', 'conv-1:user-1');
    expect(cipher.decrypt(encrypted, 'conv-1:user-1')).toBe('Bonjour 👋 — à bientôt');
  });

  it('never stores the plaintext and uses a fresh IV each time', () => {
    const a = cipher.encrypt('secret message', 'ctx');
    const b = cipher.encrypt('secret message', 'ctx');
    expect(a.ciphertext.toString('utf8')).not.toContain('secret');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.iv).toHaveLength(12);
    expect(a.authTag).toHaveLength(16);
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = cipher.encrypt('hello', 'ctx');
    encrypted.ciphertext[0] ^= 0xff;
    expect(() => cipher.decrypt(encrypted, 'ctx')).toThrow();
  });

  it('rejects a ciphertext moved to another conversation', () => {
    const encrypted = cipher.encrypt('hello', 'conv-1:user-1');
    expect(() => cipher.decrypt(encrypted, 'conv-2:user-1')).toThrow();
  });

  it('cannot be read with another key', () => {
    const other = new MessageCipher(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(cipher.encrypt('hello', 'ctx'), 'ctx')).toThrow();
  });

  it('refuses a key of the wrong size', () => {
    expect(() => new MessageCipher(randomBytes(16).toString('base64'))).toThrow();
  });
});
