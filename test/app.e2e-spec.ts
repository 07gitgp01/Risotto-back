import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp } from './utils/create-test-app';

describe('Application foundations (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/health', () => {
    it('is public and reports database and redis as up', async () => {
      const res = await request(app.getHttpServer()).get('/api/health').expect(200);
      expect(res.body).toEqual({ status: 'ok', database: 'up', redis: 'up' });
    });

    it('sends helmet security headers and hides the framework', async () => {
      const res = await request(app.getHttpServer()).get('/api/health').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS', () => {
    it('does not allow an unknown origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .set('Origin', 'https://evil.example.com')
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows a configured origin', async () => {
      const origin = (process.env.CORS_ORIGINS ?? '').split(',')[0].trim();
      expect(origin).not.toHaveLength(0);
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .set('Origin', origin)
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    });
  });

  describe('errors', () => {
    it('returns a normalised 404 without stack trace for unknown routes', async () => {
      const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
      expect(res.body).toEqual({
        statusCode: 404,
        message: expect.any(String),
        error: expect.any(String),
      });
      expect(JSON.stringify(res.body)).not.toContain('stack');
    });

    it('only serves routes under the /api prefix', async () => {
      await request(app.getHttpServer()).get('/health').expect(404);
    });
  });

  describe('database', () => {
    it('has every migration applied (schema managed by migrations only)', async () => {
      const dataSource = app.get(DataSource);
      expect(dataSource.options.synchronize).toBe(false);
      expect(await dataSource.showMigrations()).toBe(false);
      const [{ count }] = await dataSource.query<{ count: string }[]>(
        `SELECT count(*) FROM pg_extension WHERE extname = 'citext'`,
      );
      expect(Number(count)).toBe(1);
    });

    it('has no drift between entities and migrations', async () => {
      const dataSource = app.get(DataSource);
      const sql = await dataSource.driver.createSchemaBuilder().log();
      expect(sql.upQueries.map((q) => q.query)).toEqual([]);
    });
  });
});
