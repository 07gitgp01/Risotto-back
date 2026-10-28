import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import { REDIS_CLIENT } from '../src/common/redis/redis.constants';
import { bearer, registerUser, RegisteredUser } from './utils/auth-helpers';
import { createTestApp, resetDatabase } from './utils/create-test-app';
import { createProfile } from './utils/profile-helpers';

/** Guards the query plans and query counts that keep lists fast as data grows. */
describe('Performance (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let dataSource: DataSource;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    server = app.getHttpServer();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await app.get<Redis>(REDIS_CLIENT).flushdb();
  });

  afterAll(async () => {
    await app.close();
  });

  it('member search can use the trigram index', async () => {
    const runner = dataSource.createQueryRunner();
    try {
      await runner.startTransaction();
      // Force the planner to show whether the index matches the query expression.
      await runner.query('SET LOCAL enable_seqscan = off');
      const plan = (await runner.query(
        `EXPLAIN SELECT user_id FROM profiles p
         WHERE profile_search_text(p.visibility, p.first_name, p.last_name, p.headline,
           p.job_title, p.company) LIKE '%' || unaccent(lower('durand')) || '%'`,
      )) as { 'QUERY PLAN': string }[];
      expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('IDX_profiles_search');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('listing conversations costs a constant number of queries', async () => {
    const me = await registerUser(app, 'me@example.com');
    await createProfile(app, me, { firstName: 'Moi', visibility: 'public' });
    const others: RegisteredUser[] = [];
    for (let i = 0; i < 6; i++) {
      const other = await registerUser(app);
      await createProfile(app, other, { firstName: `Membre${i}`, visibility: 'public' });
      const ask = await request(server)
        .post('/api/connections')
        .set(bearer(other.accessToken))
        .send({ userId: me.id })
        .expect(201);
      await request(server)
        .post(`/api/connections/${ask.body.id}/accept`)
        .set(bearer(me.accessToken))
        .expect(200);
      const conversation = await request(server)
        .post('/api/conversations')
        .set(bearer(other.accessToken))
        .send({ userId: me.id })
        .expect(201);
      await request(server)
        .post(`/api/conversations/${conversation.body.id}/messages`)
        .set(bearer(other.accessToken))
        .send({ body: `Bonjour ${i}` })
        .expect(201);
      others.push(other);
    }

    /** Counts SQL statements sent while listing conversations. */
    const countQueries = async (): Promise<number> => {
      const prototype = PostgresQueryRunner.prototype as unknown as {
        query: (...args: unknown[]) => Promise<unknown>;
      };
      const original = prototype.query;
      let count = 0;
      prototype.query = function (this: unknown, ...args: unknown[]) {
        count += 1;
        return original.apply(this, args);
      };
      try {
        const res = await request(server).get('/api/conversations').set(bearer(me.accessToken));
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(others.length);
      } finally {
        prototype.query = original;
      }
      return count;
    };

    const withSix = await countQueries();
    expect(withSix).toBeGreaterThan(0);
    // Was 4 queries per conversation before batching (30+ here).
    expect(withSix).toBeLessThanOrEqual(15);
  });
});
