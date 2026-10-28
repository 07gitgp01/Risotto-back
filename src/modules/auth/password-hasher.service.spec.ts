import { PasswordHasher } from './password-hasher.service';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  beforeAll(async () => {
    await hasher.onModuleInit();
  });

  it('produces salted argon2id hashes', async () => {
    const a = await hasher.hash('risotto-2026');
    const b = await hasher.hash('risotto-2026');
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toBe(b);
  });

  it('verifies the right password only', async () => {
    const hash = await hasher.hash('risotto-2026');
    await expect(hasher.verify(hash, 'risotto-2026')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'risotto-2027')).resolves.toBe(false);
  });

  it('returns false for an unknown user, even with the dummy password', async () => {
    await expect(hasher.verify(undefined, 'risotto-timing-equalizer')).resolves.toBe(false);
  });

  it('returns false for a corrupted hash instead of throwing', async () => {
    await expect(hasher.verify('not-a-hash', 'x')).resolves.toBe(false);
  });
});
