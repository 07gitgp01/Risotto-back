import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RelationshipService } from '../relationships/relationship.service';
import { UsersService } from '../users/users.service';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';
import { PhotoStorage } from './photo-storage.service';
import { Profile } from './profile.entity';
import {
  MemberProfileView,
  OwnProfileView,
  profileAccess,
  ProfileView,
  toOwnProfileView,
  toProfileView,
} from './profile-view';

const PROFILE_NOT_FOUND = 'Profile not found';

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly users: UsersService,
    private readonly relationships: RelationshipService,
    private readonly photos: PhotoStorage,
  ) {}

  async getOwn(userId: string): Promise<OwnProfileView> {
    return this.ownView(await this.getEntity(userId));
  }

  async create(userId: string, dto: CreateProfileDto): Promise<OwnProfileView> {
    if (await this.profiles.existsBy({ userId })) {
      throw new ConflictException('Profile already exists');
    }
    await this.profiles.insert({ ...dto, userId });
    return this.getOwn(userId);
  }

  async update(userId: string, dto: UpdateProfileDto): Promise<OwnProfileView> {
    const profile = await this.getEntity(userId);
    // Only declared DTO fields reach here (whitelist), so user_id cannot be changed.
    await this.profiles.update({ userId }, { ...dto, updatedAt: new Date() });
    return this.getOwn(profile.userId);
  }

  /** Someone else's profile, filtered by visibility and relationship (404 if hidden). */
  async getForViewer(
    viewerId: string,
    ownerId: string,
  ): Promise<OwnProfileView | MemberProfileView> {
    const profile = await this.profiles.findOneBy({ userId: ownerId });
    if (!profile) {
      throw new NotFoundException(PROFILE_NOT_FOUND);
    }
    const access = profileAccess(
      profile.visibility,
      await this.relationships.resolve(viewerId, ownerId),
    );
    if (access === 'none') {
      throw new NotFoundException(PROFILE_NOT_FOUND);
    }
    if (access === 'full' && viewerId === ownerId) {
      return this.ownView(profile);
    }
    const owner = await this.users.getById(ownerId);
    return {
      ...toProfileView(profile, owner.email, access),
      connection: await this.relationships.connectionState(viewerId, ownerId),
    };
  }

  /**
   * Profiles of several users as `viewerId` may see them, in the order of `ownerIds`.
   * Users without profile, or hidden by a block, are left out.
   */
  async viewsFor(viewerId: string, ownerIds: string[]): Promise<Map<string, ProfileView>> {
    const views = new Map<string, ProfileView>();
    if (ownerIds.length === 0) {
      return views;
    }
    const [profiles, users] = await Promise.all([
      this.profiles.findBy({ userId: In(ownerIds) }),
      this.users.findByIds(ownerIds),
    ]);
    const emails = new Map(users.map((user) => [user.id, user.email]));
    for (const profile of profiles) {
      const access = profileAccess(
        profile.visibility,
        await this.relationships.resolve(viewerId, profile.userId),
      );
      if (access !== 'none') {
        views.set(profile.userId, toProfileView(profile, emails.get(profile.userId) ?? '', access));
      }
    }
    return views;
  }

  async setPhoto(userId: string, image: Buffer): Promise<OwnProfileView> {
    const profile = await this.getEntity(userId);
    const key = await this.photos.save(image);
    await this.profiles.update({ userId }, { photoKey: key, updatedAt: new Date() });
    if (profile.photoKey) {
      await this.photos.remove(profile.photoKey);
    }
    return this.getOwn(userId);
  }

  async removePhoto(userId: string): Promise<void> {
    const profile = await this.getEntity(userId);
    if (profile.photoKey) {
      await this.profiles.update({ userId }, { photoKey: null, updatedAt: new Date() });
      await this.photos.remove(profile.photoKey);
    }
  }

  /** The photo is visible from the `preview` level up, or on a saved contact card. */
  async getPhoto(viewerId: string, ownerId: string): Promise<Buffer> {
    const profile = await this.profiles.findOneBy({ userId: ownerId });
    if (!profile?.photoKey) {
      throw new NotFoundException('Photo not found');
    }
    const relationship = await this.relationships.resolve(viewerId, ownerId);
    const access = profileAccess(profile.visibility, relationship);
    const visible =
      access === 'full' ||
      access === 'preview' ||
      (relationship !== 'blocked' && (await this.relationships.hasSavedCard(viewerId, ownerId)));
    if (!visible) {
      throw new NotFoundException('Photo not found');
    }
    return this.photos.read(profile.photoKey);
  }

  private async getEntity(userId: string): Promise<Profile> {
    const profile = await this.profiles.findOneBy({ userId });
    if (!profile) {
      throw new NotFoundException(PROFILE_NOT_FOUND);
    }
    return profile;
  }

  private async ownView(profile: Profile): Promise<OwnProfileView> {
    const user = await this.users.getById(profile.userId);
    return toOwnProfileView(profile, user.email);
  }
}
