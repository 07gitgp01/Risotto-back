import { Relationship } from '../connections/relationship.service';
import { Profile, ProfileVisibility } from './profile.entity';

/**
 * What a viewer may see of a profile:
 * - full: every field (email/phone only if the owner shares them)
 * - preview: name, headline and photo
 * - minimal: name only
 * - none: the profile does not exist for this viewer (404)
 */
export type ProfileAccess = 'full' | 'preview' | 'minimal' | 'none';

export function profileAccess(
  visibility: ProfileVisibility,
  relationship: Relationship,
): ProfileAccess {
  switch (relationship) {
    case 'self':
    case 'connected':
      return 'full';
    case 'blocked':
      return 'none';
    case 'stranger':
      return visibility === 'public'
        ? 'full'
        : visibility === 'connections'
          ? 'preview'
          : 'minimal';
  }
}

/** Users appear in search unless their profile is private. */
export function isSearchable(visibility: ProfileVisibility): boolean {
  return visibility !== 'private';
}

export interface ProfileView {
  userId: string;
  access: Exclude<ProfileAccess, 'none'>;
  firstName: string;
  lastName: string;
  headline: string | null;
  jobTitle: string | null;
  company: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  /** Relative to the API base URL; null when there is no photo or it is hidden. */
  photoUrl: string | null;
  updatedAt: string;
}

/** The owner's own profile: everything, including the privacy settings. */
export interface OwnProfileView extends ProfileView {
  visibility: ProfileVisibility;
  shareEmail: boolean;
  sharePhone: boolean;
  /** Always the account email, so the owner sees what sharing would expose. */
  accountEmail: string;
}

export function photoUrl(profile: Profile): string | null {
  return profile.photoKey
    ? `/profiles/${profile.userId}/photo?v=${profile.photoKey.slice(0, 8)}`
    : null;
}

export function toProfileView(
  profile: Profile,
  email: string,
  access: Exclude<ProfileAccess, 'none'>,
): ProfileView {
  const full = access === 'full';
  const preview = full || access === 'preview';
  return {
    userId: profile.userId,
    access,
    firstName: profile.firstName,
    lastName: profile.lastName,
    headline: preview ? profile.headline : null,
    jobTitle: full ? profile.jobTitle : null,
    company: full ? profile.company : null,
    bio: full ? profile.bio : null,
    location: full ? profile.location : null,
    website: full ? profile.website : null,
    email: full && profile.shareEmail ? email : null,
    phone: full && profile.sharePhone ? profile.phone : null,
    photoUrl: preview ? photoUrl(profile) : null,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function toOwnProfileView(profile: Profile, email: string): OwnProfileView {
  return {
    ...toProfileView(profile, email, 'full'),
    // The owner always sees their own phone, shared or not.
    phone: profile.phone,
    visibility: profile.visibility,
    shareEmail: profile.shareEmail,
    sharePhone: profile.sharePhone,
    accountEmail: email,
  };
}
