import { hmacSha256, randomDigits, randomToken, safeEqualHex, sha256 } from './hashing';

describe('hashing', () => {
  it('sha256 is deterministic and hex encoded', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hmacSha256 depends on the key', () => {
    expect(hmacSha256('k1', '123456')).not.toBe(hmacSha256('k2', '123456'));
    expect(hmacSha256('k1', '123456')).toBe(hmacSha256('k1', '123456'));
  });

  it('randomToken is url-safe and unique', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('randomDigits returns exactly the requested number of digits', () => {
    for (let i = 0; i < 50; i++) {
      expect(randomDigits(6)).toMatch(/^\d{6}$/);
    }
  });

  it('safeEqualHex compares digests', () => {
    expect(safeEqualHex(sha256('a'), sha256('a'))).toBe(true);
    expect(safeEqualHex(sha256('a'), sha256('b'))).toBe(false);
    expect(safeEqualHex(sha256('a'), 'abcd')).toBe(false);
  });
});
