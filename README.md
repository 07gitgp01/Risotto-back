# risotto-back

API NestJS de **Risotto**, application mobile de réseautage professionnel. Le client mobile est dans [`risotto-front`](https://github.com/07gitgp01/Risotto-front).

- Plan d'architecture : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Conventions de travail : [CLAUDE.md](CLAUDE.md)

## Prérequis

- Node.js 20+ et npm
- Docker Desktop (Docker Compose v2)

## Démarrage en local

```bash
npm ci
npm run env:init                          # crée .env depuis .env.example avec des secrets générés
docker compose up -d postgres redis mailpit
npm run migration:run
npm run start:dev                         # http://localhost:3000/api/health
```

Ou tout en conteneurs, API comprise (les migrations s'appliquent au démarrage) :

```bash
docker compose up -d --build
```

Les deux modes utilisent le port 3000 : arrêter le conteneur `api` (`docker compose stop api`) avant `npm run start:dev`.

| Service | Adresse locale |
|---|---|
| API | http://localhost:3000/api (émulateur Android : http://10.0.2.2:3000/api) |
| PostgreSQL | `localhost:5433` (5433 pour ne pas entrer en conflit avec un PostgreSQL installé sur la machine) |
| Redis | `localhost:6379` |
| Mailpit (emails de test) | http://localhost:8025 |

## Tests

```bash
npm run lint
npm test              # tests unitaires
npm run test:e2e      # Supertest sur une vraie base PostgreSQL (risotto_test) et Redis (db 1)
npm run build
```

La base `risotto_test` est créée automatiquement au premier démarrage du conteneur PostgreSQL. Les tests e2e y appliquent les migrations avant de s'exécuter.

## Migrations

Le schéma n'évolue que par migrations versionnées (`synchronize` est désactivé).

```bash
npm run migration:generate -- src/database/migrations/<Name>
npm run migration:run
npm run migration:revert
```

## API

Préfixe `/api`. Toutes les routes exigent `Authorization: Bearer <accessToken>`, sauf mention « public ».

| Méthode et chemin | Accès | Rôle |
|---|---|---|
| `GET /health` | public | état de l'API, de PostgreSQL et de Redis |
| `POST /auth/register` | public | `{email, password}` → session (`accessToken`, `refreshToken`, `user`) |
| `POST /auth/login` | public | `{email, password}` → session ; 401 identique si l'email est inconnu |
| `POST /auth/refresh` | public | `{refreshToken}` → nouvelle paire ; l'ancien jeton devient inutilisable |
| `POST /auth/logout` | connecté | `{refreshToken}` → ferme cette session (204) |
| `POST /auth/logout-all` | connecté | ferme toutes les sessions de l'utilisateur (204) |
| `POST /auth/forgot-password` | public | `{email}` → 204 toujours ; envoie un code à 6 chiffres si le compte existe |
| `POST /auth/reset-password` | public | `{email, code, newPassword}` → 204 ; ferme toutes les sessions |
| `GET /users/me` | connecté | utilisateur courant |
| `GET /profiles/me` | connecté | mon profil (404 tant qu'il n'est pas créé) |
| `POST /profiles/me` | connecté | crée mon profil (`firstName`, `lastName` obligatoires) |
| `PATCH /profiles/me` | connecté | modifie mon profil ; `""` efface un champ facultatif |
| `PUT /profiles/me/photo` | connecté | multipart, champ `photo` : JPEG/PNG/WebP ≤ 5 Mo, réencodée en WebP 512 px sans métadonnées |
| `DELETE /profiles/me/photo` | connecté | supprime ma photo |
| `GET /profiles/:userId` | connecté | profil d'un membre, filtré selon sa visibilité (`access`: `full`, `preview`, `minimal`) |
| `GET /profiles/:userId/photo` | connecté | photo d'un membre (visible à partir du niveau `preview`, ou si sa carte est dans mes contacts) |
| `GET /qr/me` | connecté | mon QR code : `{token, payload}` où `payload = risotto://u/<token>` |
| `POST /qr/me/rotate` | connecté | nouveau QR code ; l'ancien ne fonctionne plus |
| `POST /qr/scan` | connecté | `{payload, saveContact?}` → carte de contact du propriétaire du QR (30 scans/min) |
| `GET /contacts/card/me` | connecté | ma carte, telle que les autres la reçoivent |
| `GET /contacts` | connecté | mes contacts enregistrés (cartes à jour + note privée) |
| `PATCH /contacts/:contactId` | connecté | `{note}` ; `""` efface la note |
| `DELETE /contacts/:contactId` | connecté | retire un contact |

Les routes `/auth/*` ont une limitation de débit renforcée (`THROTTLE_AUTH_LIMIT` par minute et par IP).

## Configuration

Toutes les variables sont documentées dans [.env.example](.env.example) et validées au démarrage : l'API refuse de démarrer si une variable est absente ou invalide. Le fichier `.env` n'est jamais commité.

## Sécurité

- Mots de passe hachés en argon2id ; access token JWT (HS256) de 15 min et refresh token opaque à rotation. Seule l'empreinte SHA-256 du refresh token est stockée. Réutiliser un refresh token déjà consommé révoque toute la session (détection de vol).
- Codes de réinitialisation stockés sous forme d'HMAC (clé `TOKEN_HASH_SECRET`), valables 30 min, 5 essais maximum.
- Un access token reste valable jusqu'à son expiration (15 min max) après une déconnexion ou un changement de mot de passe : seuls les refresh tokens sont révoqués.
- Validation stricte des entrées (class-validator, propriétés inconnues refusées), helmet, CORS restreint à `CORS_ORIGINS`, limitation de débit stockée dans Redis.
- Les erreurs renvoyées ne contiennent jamais de stack trace ni de message interne.

### Chiffrement de la messagerie : ce n'est pas du bout en bout

Les messages sont protégés **en transit** par TLS et **au repos** par AES-256-GCM, avec la clé `MESSAGE_ENCRYPTION_KEY` fournie par variable d'environnement. Le serveur détient cette clé : il **peut déchiffrer** les messages, par exemple pour les afficher ou les notifier. Une personne ayant accès à la base de données seule ne peut pas les lire. Une personne ayant accès à la base **et** à la clé le peut. Ce n'est donc pas un chiffrement de bout en bout.

En local, l'API est servie en HTTP simple : le TLS sera assuré par un reverse proxy le jour où un serveur sera déployé.
