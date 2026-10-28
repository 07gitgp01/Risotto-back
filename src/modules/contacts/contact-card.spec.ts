import { Profile } from '../profiles/profile.entity';
import { parseQrPayload, toContactCard } from './contact-card';

const token = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';

describe('parseQrPayload', () => {
  it('accepts the Risotto payload and the bare token', () => {
    expect(parseQrPayload(`risotto://u/${token}`)).toBe(token);
    expect(parseQrPayload(`  ${token}  `)).toBe(token);
  });

  it.each([
    'https://example.com',
    'risotto://u/',
    'risotto://u/short',
    `risotto://u/${token}/../../etc`,
    `risotto://u/${token}?x=1`,
  ])('rejects %s', (payload) => {
    expect(parseQrPayload(payload)).toBeNull();
  });
});

describe('toContactCard', () => {
  const profile = Object.assign(new Profile(), {
    userId: 'u1',
    firstName: 'Alice',
    lastName: 'Martin',
    headline: 'PM',
    jobTitle: null,
    company: 'Risotto',
    bio: 'secret bio',
    location: null,
    website: null,
    phone: '+33612345678',
    photoKey: null,
    visibility: 'private',
    shareEmail: false,
    sharePhone: true,
  });

  it('follows the share flags and leaves the bio out', () => {
    const card = toContactCard(profile, 'a@example.com');
    expect(card.email).toBeNull();
    expect(card.phone).toBe('+33612345678');
    expect(card).not.toHaveProperty('bio');
  });
});
