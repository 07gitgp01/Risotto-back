import { Profile } from '../profiles/profile.entity';
import { photoUrl } from '../profiles/profile-view';

/**
 * Business card shared through the QR code. Sharing the QR is a deliberate act, so the
 * card ignores the profile visibility, but email and phone still follow the share flags.
 */
export interface ContactCard {
  userId: string;
  firstName: string;
  lastName: string;
  headline: string | null;
  jobTitle: string | null;
  company: string | null;
  location: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
}

export function toContactCard(profile: Profile, email: string): ContactCard {
  return {
    userId: profile.userId,
    firstName: profile.firstName,
    lastName: profile.lastName,
    headline: profile.headline,
    jobTitle: profile.jobTitle,
    company: profile.company,
    location: profile.location,
    website: profile.website,
    email: profile.shareEmail ? email : null,
    phone: profile.sharePhone ? profile.phone : null,
    photoUrl: photoUrl(profile),
  };
}

export const QR_PAYLOAD_PREFIX = 'risotto://u/';
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

/** Accepts the full QR payload or the bare token; null if it is not a Risotto QR code. */
export function parseQrPayload(payload: string): string | null {
  const trimmed = payload.trim();
  const token = trimmed.startsWith(QR_PAYLOAD_PREFIX)
    ? trimmed.slice(QR_PAYLOAD_PREFIX.length)
    : trimmed;
  return TOKEN.test(token) ? token : null;
}
