import { Profile } from './profile.entity';
import { isSearchable, profileAccess, toOwnProfileView, toProfileView } from './profile-view';

function profile(overrides: Partial<Profile> = {}): Profile {
  return Object.assign(new Profile(), {
    userId: 'u1',
    firstName: 'Alice',
    lastName: 'Martin',
    headline: 'PM',
    jobTitle: 'Product manager',
    company: 'Risotto',
    bio: 'Bio',
    location: 'Lyon',
    phone: '+33612345678',
    website: 'https://a.example.com',
    photoKey: '0123456789abcdef0123456789abcdef0123.webp',
    visibility: 'connections',
    shareEmail: false,
    sharePhone: false,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
}

describe('profileAccess', () => {
  it.each([
    ['public', 'self', 'full'],
    ['private', 'self', 'full'],
    ['private', 'connected', 'full'],
    ['public', 'stranger', 'full'],
    ['connections', 'stranger', 'preview'],
    ['private', 'stranger', 'minimal'],
    ['public', 'blocked', 'none'],
  ] as const)('%s profile seen by %s → %s', (visibility, relationship, expected) => {
    expect(profileAccess(visibility, relationship)).toBe(expected);
  });

  it('private profiles are not searchable', () => {
    expect(isSearchable('private')).toBe(false);
    expect(isSearchable('connections')).toBe(true);
    expect(isSearchable('public')).toBe(true);
  });
});

describe('toProfileView', () => {
  it('full view hides unshared contact details', () => {
    const view = toProfileView(profile(), 'a@example.com', 'full');
    expect(view.bio).toBe('Bio');
    expect(view.email).toBeNull();
    expect(view.phone).toBeNull();
  });

  it('full view shows shared contact details', () => {
    const view = toProfileView(
      profile({ shareEmail: true, sharePhone: true }),
      'a@example.com',
      'full',
    );
    expect(view.email).toBe('a@example.com');
    expect(view.phone).toBe('+33612345678');
  });

  it('preview keeps name, headline and photo only', () => {
    const view = toProfileView(profile({ shareEmail: true }), 'a@example.com', 'preview');
    expect(view).toMatchObject({ headline: 'PM', company: null, bio: null, email: null });
    expect(view.photoUrl).toBe('/profiles/u1/photo?v=01234567');
  });

  it('minimal keeps the name only', () => {
    const view = toProfileView(profile(), 'a@example.com', 'minimal');
    expect(view).toMatchObject({ firstName: 'Alice', headline: null, photoUrl: null });
  });

  it('own view always exposes the phone and the settings', () => {
    const view = toOwnProfileView(profile(), 'a@example.com');
    expect(view).toMatchObject({
      phone: '+33612345678',
      email: null,
      visibility: 'connections',
      accountEmail: 'a@example.com',
    });
  });
});
