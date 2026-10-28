// Creates demo accounts and data through the API (same rules, encryption and
// notifications as the app). Local development only. Safe to run again.
//
//   npm run seed                      # API on http://localhost:3000/api
//   API_URL=http://host:3000/api npm run seed

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const PASSWORD = 'Risotto2026';

const PEOPLE = {
  alice: {
    email: 'alice@risotto.dev',
    profile: {
      firstName: 'Alice',
      lastName: 'Martin',
      headline: 'Cheffe de projet digital',
      jobTitle: 'Product manager',
      company: 'Risotto SAS',
      location: 'Lyon',
      bio: 'Je relie les équipes produit, design et technique. Toujours partante pour un café.',
      website: 'https://alice.example.com',
      phone: '+33 6 12 34 56 78',
      visibility: 'public',
      shareEmail: true,
      sharePhone: true,
    },
  },
  bob: {
    email: 'bob@risotto.dev',
    profile: {
      firstName: 'Bob',
      lastName: 'Durand',
      headline: 'Designer UX / UI',
      jobTitle: 'Lead designer',
      company: 'Basilic Studio',
      location: 'Paris',
      bio: 'Interfaces simples pour des problèmes compliqués.',
      visibility: 'public',
      shareEmail: true,
    },
  },
  carol: {
    email: 'carol@risotto.dev',
    profile: {
      firstName: 'Carol',
      lastName: 'Petit',
      headline: 'CTO en recherche de profils mobiles',
      jobTitle: 'CTO',
      company: 'Safran Tech',
      location: 'Bordeaux',
      visibility: 'connections',
    },
  },
  david: {
    email: 'david@risotto.dev',
    profile: {
      firstName: 'David',
      lastName: 'Nguyen',
      headline: 'Développeur Flutter freelance',
      jobTitle: 'Développeur mobile',
      company: 'Indépendant',
      location: 'Nantes',
      visibility: 'public',
    },
  },
  emma: {
    email: 'emma@risotto.dev',
    profile: {
      firstName: 'Émma',
      lastName: 'Leroy',
      headline: 'Juriste RGPD',
      company: 'Tomate & Associés',
      visibility: 'private',
      sharePhone: true,
      phone: '+33 7 98 76 54 32',
    },
  },
};

async function call(method, path, { token, body, expect = [200, 201, 204] } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!expect.includes(res.status)) {
    throw new Error(`${method} ${path} → ${res.status} ${text}`);
  }
  return { status: res.status, data };
}

/**
 * Signs in, or registers the account the first time. One auth call per account on
 * later runs, to stay under the auth rate limit (10 per minute per IP).
 */
async function account(key) {
  const { email, profile } = PEOPLE[key];
  const login = await call('POST', '/auth/login', {
    body: { email, password: PASSWORD },
    expect: [200, 401],
  });
  const session =
    login.status === 200
      ? login.data
      : (await call('POST', '/auth/register', { body: { email, password: PASSWORD } })).data;
  const token = session.accessToken;
  const created = await call('POST', '/profiles/me', { token, body: profile, expect: [201, 409] });
  if (created.status === 409) {
    await call('PATCH', '/profiles/me', { token, body: profile });
  }
  return { key, id: session.user.id, token, name: profile.firstName };
}

/** Sends a request, or does nothing if one already exists between the two. */
async function ask(from, to, message, viaQr = false) {
  // A private profile can only be reached through its QR code.
  const target = viaQr
    ? { qrPayload: (await call('GET', '/qr/me', { token: to.token })).data.payload }
    : { userId: to.id };
  return call('POST', '/connections', {
    token: from.token,
    body: { ...target, message },
    expect: [201, 409],
  });
}

async function connect(from, to, message, viaQr = false) {
  const res = await ask(from, to, message, viaQr);
  if (res.status === 201 && res.data.status === 'pending') {
    await call('POST', `/connections/${res.data.id}/accept`, { token: to.token });
  }
}

async function main() {
  console.log(`Seeding ${API} …`);
  await call('GET', '/health');

  const [alice, bob, carol, david, emma] = await Promise.all(
    ['alice', 'bob', 'carol', 'david', 'emma'].map(account),
  );

  // Alice ↔ Bob and Alice ↔ Emma connected; Carol → Alice pending; Alice → David pending.
  await connect(bob, alice, 'Ravi de t’avoir croisée au meetup Flutter !');
  await connect(alice, emma, 'Contente de t’avoir rencontrée au salon.', true);
  await ask(carol, alice, 'Je recrute pour une app mobile, on en parle ?');
  await ask(alice, david, 'Ton talk sur Riverpod était top, restons en contact.');

  // A conversation with a few messages, the last two unread by Alice.
  const conversation = (
    await call('POST', '/conversations', { token: bob.token, body: { userId: alice.id } })
  ).data;
  const history = await call('GET', `/conversations/${conversation.id}/messages?limit=1`, {
    token: alice.token,
  });
  if (history.data.messages.length === 0) {
    const lines = [
      [bob, 'Salut Alice ! Merci pour la mise en relation 🙂'],
      [alice, 'Avec plaisir Bob. Tu as pu regarder les maquettes ?'],
      [alice, 'On peut en parler jeudi si tu veux.'],
      [bob, 'Oui, j’ai quelques idées pour l’écran d’accueil.'],
      [bob, 'Jeudi 10 h, ça te va ?'],
    ];
    for (const [author, body] of lines) {
      await call('POST', `/conversations/${conversation.id}/messages`, {
        token: author.token,
        body: { body },
      });
      if (author === alice) {
        await call('POST', `/conversations/${conversation.id}/read`, { token: alice.token });
      }
    }
  }

  // Alice scanned David's QR code and kept his card.
  const davidQr = (await call('GET', '/qr/me', { token: david.token })).data;
  await call('POST', '/qr/scan', {
    token: alice.token,
    body: { payload: davidQr.payload, saveContact: true },
  });

  console.log('\nDemo accounts (password for all: %s)', PASSWORD);
  for (const person of [alice, bob, carol, david, emma]) {
    console.log(`  ${PEOPLE[person.key].email.padEnd(20)} ${PEOPLE[person.key].profile.headline}`);
  }
  console.log(`
Sign in as alice@risotto.dev to see:
  - 2 connections (Bob, Émma), 1 incoming request (Carol), 1 sent request (David)
  - a conversation with Bob with 2 unread messages
  - David's card in contacts, notifications for the requests`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
