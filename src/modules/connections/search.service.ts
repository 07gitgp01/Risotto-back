import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../profiles/profile.entity';
import { ProfilesService } from '../profiles/profiles.service';
import { RelationshipService } from '../relationships/relationship.service';
import { SearchQuery, SearchResult } from './dto/connections.dto';

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly relationships: RelationshipService,
    private readonly profileViews: ProfilesService,
  ) {}

  /**
   * Accent- and case-insensitive search on names and headline; company and job title
   * only for public profiles (they are hidden from strangers otherwise). Private
   * profiles, blocked users and the viewer are excluded.
   */
  async search(viewerId: string, query: SearchQuery): Promise<SearchResult[]> {
    const excluded = [viewerId, ...(await this.relationships.blockedUserIds(viewerId))];
    const rows = await this.profiles
      .createQueryBuilder('p')
      .select('p.user_id', 'userId')
      .where(`p.visibility <> 'private'`)
      .andWhere('p.user_id NOT IN (:...excluded)', { excluded })
      // Same expression as the trigram index IDX_profiles_search (see the migration).
      .andWhere(
        `profile_search_text(p.visibility, p.first_name, p.last_name, p.headline,
           p.job_title, p.company) LIKE '%' || unaccent(lower(:term)) || '%'`,
        { term: escapeLike(query.q) },
      )
      .orderBy('p.first_name', 'ASC')
      .addOrderBy('p.last_name', 'ASC')
      .addOrderBy('p.user_id', 'ASC')
      .limit(query.limit)
      .offset(query.offset)
      .getRawMany<{ userId: string }>();

    const ids = rows.map((row) => row.userId);
    const [views, states] = await Promise.all([
      this.profileViews.viewsFor(viewerId, ids),
      this.relationships.connectionStates(viewerId, ids),
    ]);
    return ids.flatMap((id) => {
      const view = views.get(id);
      return view ? [{ ...view, connection: states.get(id)! }] : [];
    });
  }
}
