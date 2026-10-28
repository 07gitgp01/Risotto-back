import configuration, { parseCorsOrigins } from './configuration';

describe('parseCorsOrigins', () => {
  it('returns an empty list when unset or blank (deny all browser origins)', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins('  ')).toEqual([]);
  });

  it('splits, trims and drops empty entries', () => {
    expect(parseCorsOrigins(' http://a.test , ,http://b.test ')).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
  });
});

describe('configuration', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('maps env variables to the typed config', () => {
    process.env.PORT = '4000';
    process.env.DB_PORT = '5433';
    process.env.THROTTLE_LIMIT = '7';
    process.env.CORS_ORIGINS = 'http://a.test';
    const config = configuration();
    expect(config.port).toBe(4000);
    expect(config.db.port).toBe(5433);
    expect(config.throttle.limit).toBe(7);
    expect(config.corsOrigins).toEqual(['http://a.test']);
  });
});
