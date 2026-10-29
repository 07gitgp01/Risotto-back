// Grants or removes the admin role of an existing account. The role can never be
// obtained through the API: only someone with database access can run this.
//
//   npm run admin:grant -- alice@risotto.dev
//   npm run admin:revoke -- alice@risotto.dev
//
// Reads the DB_* variables from the environment or the local .env file.

const { existsSync } = require('fs');
const { Client } = require('pg');

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const [action, email] = process.argv.slice(2);
if (!['grant', 'revoke'].includes(action) || !email) {
  console.error('Usage: node scripts/admin-role.js <grant|revoke> <email>');
  process.exit(1);
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
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
