import { Injectable } from '@nestjs/common';

/** How the viewer relates to the owner of a resource. Drives every visibility rule. */
export type Relationship = 'self' | 'connected' | 'stranger' | 'blocked';

@Injectable()
export class RelationshipService {
  /**
   * `blocked` means either user blocked the other: neither may see the other's data.
   * Connections and blocks arrive in milestone 5; until then other users are strangers.
   */
  resolve(viewerId: string, ownerId: string): Promise<Relationship> {
    return Promise.resolve(viewerId === ownerId ? 'self' : 'stranger');
  }
}
