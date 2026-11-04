// Grants or removes the admin role of an existing account. The role can never be
// obtained through the API: only someone with database access can run this.
//
//   npm run admin:grant -- alice@risotto.dev
//   npm run admin:revoke -- alice@risotto.dev
//
// Reads DATABASE_URL (+ DB_SSL, DB_SSL_CA_FILE) or the DB_* variables from the
// environment or the local .env file. Hosted database (Supabase), from your machine:
//   DATABASE_URL="<url>" DB_SSL=true DB_SSL_CA_FILE=prod-ca-2021.crt npm run admin:grant -- alice@risotto.dev

const { existsSync, readFileSync } = require('fs');
const { Client } = require('pg');

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const [action, email] = process.argv.slice(2);
if (!['grant', 'revoke'].includes(action) || !email) {
  console.error('Usage: node scripts/admin-role.js <grant|revoke> <email>');
  process.exit(1);
}

// TLS parameters in the URL (sslmode=require…) would override `ssl` and drop the CA.
function stripSslParams(url) {
  const [base, query] = url.split('?', 2);
  const kept = (query ?? '')
    .split('&')
    .filter((param) => param && !/^(ssl[a-z]*|uselibpqcompat)=/i.test(param));
  return kept.length > 0 ? `${base}?${kept.join('&')}` : base;
}

async function main() {
  const caFile = process.env.DB_SSL_CA_FILE;
  const ssl =
    process.env.DB_SSL === 'true' ? (caFile ? { ca: readFileSync(caFile, 'utf8') } : true) : false;
  const client = new Client(
    process.env.DATABASE_URL
      ? { connectionString: stripSslParams(process.env.DATABASE_URL), ssl }
      : {
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT),
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          ssl,
        },
  );
  await client.connect();
  try {
    const role = action === 'grant' ? 'admin' : 'member';
    const { rowCount } = await client.query('UPDATE users SET role = $1 WHERE email = $2', [
      role,
      email.trim().toLowerCase(),
    ]);
    if (rowCount === 0) {
      console.error(`No account with the email ${email}. Register it in the app first.`);
      process.exitCode = 1;
      return;
    }
    console.log(`${email} is now ${role}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
