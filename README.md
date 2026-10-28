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

### Données de démonstration

```bash
npm run seed        # l'API doit tourner ; relançable sans doublons
```

Crée 5 comptes (mot de passe commun : `Risotto2026`) :

| Compte | Profil | Situation vue par Alice |
|---|---|---|
| `alice@risotto.dev` | public, email et téléphone partagés | compte principal à utiliser |
| `bob@risotto.dev` | public | relation, conversation avec 2 messages non lus |
| `carol@risotto.dev` | visibilité « relations » | demande de mise en relation reçue |
| `david@risotto.dev` | public | demande envoyée par Alice, carte enregistrée dans ses contacts |
| `emma@risotto.dev` | privé | relation (ajoutée par QR code) |

Les comptes de démonstration n'existent qu'en local : ne jamais lancer ce script sur un serveur réel.

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
| `GET /users/search?q=` | connecté | recherche de membres (≥ 2 caractères, sans accents ni casse), avec l'état de relation |
| `POST /connections` | connecté | `{userId}` ou `{qrPayload}`, `message?` : demande de mise en relation (accepte si l'autre a déjà demandé) |
| `GET /connections` | connecté | mes relations |
| `GET /connections/requests?direction=incoming\|outgoing` | connecté | demandes reçues / envoyées en attente |
| `POST /connections/:id/accept` · `/decline` | destinataire | répondre à une demande |
| `DELETE /connections/:id` | l'une des parties | annuler ma demande ou retirer une relation |
| `POST /blocks` · `GET /blocks` · `DELETE /blocks/:userId` | connecté | bloquer, lister, débloquer |
| `GET /conversations` | connecté | mes conversations : interlocuteur, dernier message, non lus, accusé de lecture |
| `POST /conversations` | connecté | `{userId}` : ouvre (ou retrouve) la conversation avec une relation |
| `GET /conversations/:id` | membre | une conversation |
| `GET /conversations/:id/messages?before=&limit=` | membre | historique, du plus récent au plus ancien, curseur `nextCursor` |
| `POST /conversations/:id/messages` | membre en relation | `{body}` (1 à 4 000 caractères) |
| `POST /conversations/:id/read` | membre | marque la conversation comme lue (accusé envoyé à l'autre) |

| `GET /notifications?before=&limit=` | connecté | notifications in-app (+ `unreadCount`) |
| `POST /notifications/:id/read` · `POST /notifications/read-all` | propriétaire | marquer comme lu |
| `GET /notifications/preferences` · `PUT /notifications/preferences` | connecté | `{preferences: [{type, inApp?, push?}]}` |
| `POST /devices` · `DELETE /devices` | connecté | `{token, platform}` / `{token}` : jeton FCM de l'appareil |
| `GET /dashboard` | connecté | résumé de l'accueil : demandes en attente, messages non lus, notifications non lues, statistiques, activité récente |

### Temps réel (Socket.IO)

Namespace `/ws` sur le même port que l'API (`http://localhost:3000/ws`), jeton d'accès dans `auth: { token }`.

| Sens | Évènement | Contenu |
|---|---|---|
| serveur → client | `message:new` | message déchiffré `{id, conversationId, senderId, body, createdAt}` |
| serveur → client | `conversation:read` | `{conversationId, userId, readAt}` |
| serveur → client | `notification:new` | notification in-app `{id, type, actor, data, readAt, createdAt}` |
| client → serveur | `message:send` | `{conversationId, body}` → acquittement `{ok, data}` |
| client → serveur | `conversation:read` | `{conversationId}` → acquittement |

Les évènements passent par l'adapter Redis : plusieurs instances de l'API peuvent tourner derrière un répartiteur.

Les routes `/auth/*` ont une limitation de débit renforcée (`THROTTLE_AUTH_LIMIT` par minute et par IP).

## Notifications push (FCM)

Désactivées par défaut. Pour les activer :

1. Créer un projet Firebase, y ajouter une app Android (`com.risotto.risotto`) et une app iOS (même identifiant).
2. Télécharger une clé de compte de service (Paramètres > Comptes de service), la placer hors du dépôt et renseigner `FCM_SERVICE_ACCOUNT_PATH` dans `.env` (en Docker, monter le fichier dans le conteneur).
3. Côté app, voir le README de `risotto-front`.

## Configuration

Toutes les variables sont documentées dans [.env.example](.env.example) et validées au démarrage : l'API refuse de démarrer si une variable est absente ou invalide. Le fichier `.env` n'est jamais commité.

## Sécurité

- Mots de passe hachés en argon2id ; access token JWT (HS256) de 15 min et refresh token opaque à rotation. Seule l'empreinte SHA-256 du refresh token est stockée. Réutiliser un refresh token déjà consommé révoque toute la session (détection de vol).
- Révocation immédiate des access tokens : déconnexion (la session), déconnexion partout et changement de mot de passe (toutes les sessions), réutilisation d'un refresh token (la session). Vérifiée à chaque requête et à l'ouverture d'un WebSocket, avec un cache Redis et la base comme source de vérité.
- Verrouillage par compte : 10 mots de passe faux en 15 min bloquent les connexions à ce compte (429), quelle que soit l'IP ; même comportement pour un email inconnu.
- Codes de réinitialisation stockés sous forme d'HMAC (clé `TOKEN_HASH_SECRET`), valables 30 min, 5 essais maximum.
- Validation stricte des entrées (class-validator, propriétés inconnues refusées), helmet, CORS restreint à `CORS_ORIGINS`, limitation de débit stockée dans Redis.
- Les erreurs renvoyées ne contiennent jamais de stack trace ni de message interne.

### Revue de sécurité (jalon 9)

| Point vérifié | État |
|---|---|
| Authentification, rotation et révocation des jetons | tests e2e `auth`, `security` |
| Contrôle d'accès sur chaque route (401 sans jeton, 403/404 sur la ressource d'un autre) | testé par suite e2e |
| Énumération de comptes (login, mot de passe oublié, reset) | réponses identiques, testé |
| Injections SQL | requêtes paramétrées uniquement (QueryBuilder / `$1`) |
| Entrées | DTO stricts (propriétés inconnues refusées), corps JSON limité à 100 ko (413) |
| Fichiers envoyés | format vérifié par décodage, image réencodée sans métadonnées |
| Secrets | `.env` ignoré, validé au démarrage, aucun secret dans Git ni dans les logs |
| Dépendances | `npm audit --omit=dev` : 0 vulnérabilité (multer et uuid forcés à des versions corrigées via `overrides`, nodemailer 10) |
| Conteneur | image Node 20 Alpine, utilisateur non root ; PostgreSQL, Redis et Mailpit exposés sur 127.0.0.1 uniquement |

Limites connues, à traiter avant toute mise en production :

- Pas de TLS en local : à placer derrière un reverse proxy HTTPS.
- Redis sans mot de passe (accessible seulement depuis la machine) : en ajouter un en production.
- La clé `MESSAGE_ENCRYPTION_KEY` est unique (version 1) ; la rotation est prévue dans `MessageCipher` mais pas outillée.
- Pas de suppression de compte ni d'export des données (RGPD) : à ajouter.

### Performances

- Listes (conversations, contacts, recherche, relations) : nombre de requêtes SQL constant, quelle que soit la taille de la liste (test `performance.e2e-spec.ts`).
- Recherche de membres : expression `profile_search_text()` indexée par un index GIN trigram (`pg_trgm`), utilisable avec `LIKE '%…%'`.
- Historique de messages et notifications paginés par curseur (index `(conversation_id, created_at, id)` et `(user_id, created_at)`).

### Chiffrement de la messagerie : ce n'est pas du bout en bout

Les messages sont protégés **en transit** par TLS et **au repos** par AES-256-GCM, avec la clé `MESSAGE_ENCRYPTION_KEY` fournie par variable d'environnement. Le serveur détient cette clé : il **peut déchiffrer** les messages, par exemple pour les afficher ou les notifier. Une personne ayant accès à la base de données seule ne peut pas les lire. Une personne ayant accès à la base **et** à la clé le peut. Ce n'est donc pas un chiffrement de bout en bout.

En local, l'API est servie en HTTP simple : le TLS sera assuré par un reverse proxy le jour où un serveur sera déployé.
