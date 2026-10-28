// Creates a local .env from .env.example with freshly generated secrets. Never overwrites.
const { randomBytes } = require('crypto');
const { existsSync, readFileSync, writeFileSync } = require('fs');

if (existsSync('.env')) {
  console.log('.env already exists, nothing to do.');
  process.exit(0);
}

const generated = {
  DB_PASSWORD: randomBytes(18).toString('hex'),
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64'),
  MESSAGE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

const content = readFileSync('.env.example', 'utf8')
  .split('\n')
  .map((line) => {
    const key = line.split('=')[0];
    return key in generated ? `${key}=${generated[key]}` : line;
  })
  .join('\n');

writeFileSync('.env', content);
console.log('.env created with generated secrets.');
