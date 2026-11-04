import configuration, {
  normalizePem,
  parseCorsOrigins,
  parseTrustProxy,
  stripSslParams,
} from './configuration';

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

describe('parseTrustProxy', () => {
  it('reads a hop count and falls back to loopback', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(undefined)).toBe('loopback');
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });
});

describe('stripSslParams', () => {
  it('removes TLS parameters so DB_SSL / DB_SSL_CA decide', () => {
    const base = 'postgresql://postgres.ref:p%40ss@aws-0-eu.pooler.supabase.com:5432/postgres';
    expect(stripSslParams(`${base}?sslmode=require`)).toBe(base);
    expect(stripSslParams(`${base}?sslmode=require&application_name=risotto`)).toBe(
      `${base}?application_name=risotto`,
    );
    expect(stripSslParams(base)).toBe(base);
    expect(stripSslParams('')).toBeUndefined();
  });
});

describe('normalizePem', () => {
  const pem = [
    '-----BEGIN CERTIFICATE-----',
    'A'.repeat(64),
    'B'.repeat(10),
    '-----END CERTIFICATE-----',
  ].join('\n');

  it('keeps a well-formed certificate', () => {
    expect(normalizePem(pem)).toBe(pem);
  });

  it('restores line breaks flattened to spaces or escaped as \\n', () => {
    expect(normalizePem(pem.replace(/\n/g, ' '))).toBe(pem);
    expect(normalizePem(pem.replace(/\n/g, '\\n'))).toBe(pem);
    expect(normalizePem(`  ${pem.replace(/\n/g, '\r\n')}\r\n`)).toBe(pem);
  });

  it('returns an empty string when unset', () => {
    expect(normalizePem(undefined)).toBe('');
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
