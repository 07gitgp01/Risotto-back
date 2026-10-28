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
      .andWhere(
        `unaccent(lower(
          CASE WHEN p.visibility = 'public'
            THEN concat_ws(' ', p.first_name, p.last_name, p.headline, p.job_title, p.company)
            ELSE concat_ws(' ', p.first_name, p.last_name, p.headline)
          END
        )) LIKE '%' || unaccent(lower(:term)) || '%'`,
        { term: escapeLike(query.q) },
      )
      .orderBy('p.first_name', 'ASC')
      .addOrderBy('p.last_name', 'ASC')
      .addOrderBy('p.user_id', 'ASC')
      .limit(query.limit)
      .offset(query.offset)
      .getRawMany<{ userId: string }>();

    const ids = rows.map((row) => row.userId);
    const views = await this.profileViews.viewsFor(viewerId, ids);
    const results: SearchResult[] = [];
    for (const id of ids) {
      const view = views.get(id);
      if (view) {
        results.push({
          ...view,
          connection: await this.relationships.connectionState(viewerId, id),
        });
      }
    }
    return results;
  }
}
