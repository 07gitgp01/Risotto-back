import Redis from 'ioredis';
import { RedisThrottlerStorage } from '../src/common/throttler/redis-throttler.storage';

describe('RedisThrottlerStorage (real Redis)', () => {
  let redis: Redis;
  let storage: RedisThrottlerStorage;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL as string);
    storage = new RedisThrottlerStorage(redis, `test-${Date.now()}`);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('counts hits within the window', async () => {
    const first = await storage.increment('ip-a', 10_000, 3, 10_000, 'default');
    const second = await storage.increment('ip-a', 10_000, 3, 10_000, 'default');
    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(second.isBlocked).toBe(false);
    expect(second.timeToExpire).toBeGreaterThan(0);
  });

  it('blocks once the limit is exceeded and keeps blocking', async () => {
    for (let i = 0; i < 2; i++) {
      await storage.increment('ip-b', 10_000, 2, 5_000, 'default');
    }
    const exceeded = await storage.increment('ip-b', 10_000, 2, 5_000, 'default');
    const stillBlocked = await storage.increment('ip-b', 10_000, 2, 5_000, 'default');
    expect(exceeded.isBlocked).toBe(true);
    expect(stillBlocked.isBlocked).toBe(true);
    expect(stillBlocked.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('isolates keys and throttler names', async () => {
    await storage.increment('ip-c', 10_000, 1, 5_000, 'default');
    const otherKey = await storage.increment('ip-d', 10_000, 1, 5_000, 'default');
    const otherThrottler = await storage.increment('ip-c', 10_000, 1, 5_000, 'auth');
    expect(otherKey.totalHits).toBe(1);
    expect(otherThrottler.totalHits).toBe(1);
  });
});
