import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomToken } from '../../common/crypto/hashing';
import { RelationshipService } from '../relationships/relationship.service';
import { Profile } from '../profiles/profile.entity';
import { User } from '../users/user.entity';
import { ContactCard, parseQrPayload, QR_PAYLOAD_PREFIX, toContactCard } from './contact-card';
import { QrCodeView, SavedContactView, ScanQrDto, ScanResult } from './dto/contacts.dto';
import { SavedContact } from './saved-contact.entity';

const QR_NOT_FOUND = 'QR code not recognized';

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(SavedContact) private readonly contacts: Repository<SavedContact>,
    private readonly relationships: RelationshipService,
  ) {}

  /** Creates the token on first use. */
  async getQrCode(userId: string): Promise<QrCodeView> {
    const user = await this.users.findOneByOrFail({ id: userId });
    return toQrView(user.qrToken ?? (await this.rotateToken(userId)));
  }

  /** Invalidates the previous QR code (already saved contacts are kept). */
  async rotateQrCode(userId: string): Promise<QrCodeView> {
    return toQrView(await this.rotateToken(userId));
  }

  async getOwnCard(userId: string): Promise<ContactCard> {
    const [card] = await this.cardsFor([userId]);
    if (!card) {
      throw new NotFoundException('Profile not found');
    }
    return card;
  }

  async scan(viewerId: string, dto: ScanQrDto): Promise<ScanResult> {
    const token = parseQrPayload(dto.payload);
    const owner = token ? await this.users.findOneBy({ qrToken: token }) : null;
    if (!owner || (await this.relationships.resolve(viewerId, owner.id)) === 'blocked') {
      throw new NotFoundException(QR_NOT_FOUND);
    }
    const [card] = await this.cardsFor([owner.id]);
    if (!card) {
      throw new NotFoundException(QR_NOT_FOUND);
    }

    const isSelf = owner.id === viewerId;
    if (dto.saveContact) {
      if (isSelf) {
        throw new BadRequestException('You cannot save your own card');
      }
      await this.contacts
        .createQueryBuilder()
        .insert()
        .into(SavedContact)
        .values({ ownerId: viewerId, contactId: owner.id })
        .orIgnore()
        .execute();
    }
    const saved = !isSelf && (await this.isSaved(viewerId, owner.id));
    const connection = await this.relationships.connectionState(viewerId, owner.id);
    return { card, isSelf, saved, connection };
  }

  async list(ownerId: string): Promise<SavedContactView[]> {
    const saved = await this.contacts.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
      take: 500,
    });
    const blocked = new Set(await this.relationships.blockedUserIds(ownerId));
    const visible = saved.filter((contact) => !blocked.has(contact.contactId));
    const cards = new Map(
      (await this.cardsFor(visible.map((c) => c.contactId))).map((card) => [card.userId, card]),
    );
    return visible.flatMap((contact) => {
      const card = cards.get(contact.contactId);
      return card ? [{ card, note: contact.note, savedAt: contact.createdAt.toISOString() }] : [];
    });
  }

  async updateNote(ownerId: string, contactId: string, note: string | null): Promise<void> {
    const result = await this.contacts.update({ ownerId, contactId }, { note });
    if (result.affected !== 1) {
      throw new NotFoundException('Contact not found');
    }
  }

  async remove(ownerId: string, contactId: string): Promise<void> {
    const result = await this.contacts.delete({ ownerId, contactId });
    if (result.affected !== 1) {
      throw new NotFoundException('Contact not found');
    }
  }

  isSaved(ownerId: string, contactId: string): Promise<boolean> {
    return this.contacts.existsBy({ ownerId, contactId });
  }

  private async rotateToken(userId: string): Promise<string> {
    const token = randomToken(32);
    await this.users.update({ id: userId }, { qrToken: token });
    return token;
  }

  private async cardsFor(userIds: string[]): Promise<ContactCard[]> {
    if (userIds.length === 0) {
      return [];
    }
    const [profiles, users] = await Promise.all([
      this.profiles.findBy({ userId: In(userIds) }),
      this.users.findBy({ id: In(userIds) }),
    ]);
    const emails = new Map(users.map((user) => [user.id, user.email]));
    return profiles.map((profile) => toContactCard(profile, emails.get(profile.userId) ?? ''));
  }
}

function toQrView(token: string): QrCodeView {
  return { token, payload: `${QR_PAYLOAD_PREFIX}${token}` };
}
