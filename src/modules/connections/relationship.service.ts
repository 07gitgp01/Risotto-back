import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedContact } from '../contacts/saved-contact.entity';

/** How the viewer relates to the owner of a resource. Drives every visibility rule. */
export type Relationship = 'self' | 'connected' | 'stranger' | 'blocked';

@Injectable()
export class RelationshipService {
  constructor(
    @InjectRepository(SavedContact) private readonly savedContacts: Repository<SavedContact>,
  ) {}

  /**
   * `blocked` means either user blocked the other: neither may see the other's data.
   * Connections and blocks arrive in milestone 5; until then other users are strangers.
   */
  resolve(viewerId: string, ownerId: string): Promise<Relationship> {
    return Promise.resolve(viewerId === ownerId ? 'self' : 'stranger');
  }

  /** The viewer kept the owner's card after scanning their QR code. */
  hasSavedCard(viewerId: string, ownerId: string): Promise<boolean> {
    return this.savedContacts.existsBy({ ownerId: viewerId, contactId: ownerId });
  }
}
