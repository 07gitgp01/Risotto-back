# CLAUDE.md — risotto-back

API NestJS de **Risotto**, application mobile de réseautage professionnel (client : `risotto-front`, Flutter).
Langue des échanges : français. Code, commits, noms techniques : anglais.

## Décisions techniques
- Node.js 20+ / NestJS 11 (TypeScript strict), PostgreSQL 16, TypeORM 0.3 avec **migrations versionnées** (`synchronize: false` partout).
- Redis 7 : stockage du rate limiting, adapter Socket.IO, cache léger.
- Socket.IO (namespace `/ws`) pour la messagerie et les notifications temps réel.
- Tout tourne en local via Docker Compose (PostgreSQL, Redis, Mailpit, API). Pas de serveur de production.
- Emails (reset mot de passe) : SMTP → Mailpit en local (UI http://localhost:8025).
- Photos de profil : stockage disque local (`UPLOAD_DIR`, volume Docker), servies par un endpoint authentifié. Toute image est décodée et réencodée par `sharp` (WebP 512 px, sans EXIF) : on ne stocke jamais le fichier envoyé tel quel.
- Push : FCM via `firebase-admin`, désactivé si `FCM_SERVICE_ACCOUNT_PATH` est vide.
- Architecture : un module Nest par domaine dans `src/modules/*`, code transverse dans `src/common`, config typée dans `src/config`.

## Sécurité (non négociable)
- Mots de passe : argon2id via `@node-rs/argon2` (le paquet `argon2` ne compile pas sous Windows sans Visual Studio). Jamais loggés, jamais renvoyés (`select: false` sur `password_hash`). Politique : 8 à 128 caractères, au moins une lettre et un chiffre.
- Access token JWT 15 min (`JWT_ACCESS_SECRET`), refresh token opaque à **rotation** stocké hashé (SHA-256) par famille ; réutilisation d'un refresh déjà utilisé ⇒ révocation de toute la famille.
- `ValidationPipe` global : `whitelist`, `forbidNonWhitelisted`, `transform`. Tout DTO est validé par class-validator.
- helmet, CORS restreint à `CORS_ORIGINS`, rate limiting global + renforcé sur `/auth/*`.
- Contrôle d'accès sur **chaque** ressource : l'utilisateur courant vient du JWT, jamais du body. Un utilisateur bloqué ne voit rien de celui qui l'a bloqué.
- Messages chiffrés au repos en AES-256-GCM (`MESSAGE_ENCRYPTION_KEY`, 32 octets base64). Ce n'est **pas** du bout en bout : le serveur peut déchiffrer.
- Aucun secret dans Git : `.env` ignoré, `.env.example` documenté. Réponses d'erreur sans stack trace.
- Réponses anti-énumération : `forgot-password` répond toujours 204 (email envoyé en arrière-plan) ; `login` renvoie le même 401 et vérifie un hash factice si l'email est inconnu.
- Reset mot de passe : code à 6 chiffres, HMAC-SHA256 (`TOKEN_HASH_SECRET`), 30 min, 5 essais (incrément atomique), seul le dernier code est valide, succès ⇒ révocation de tous les refresh tokens.
- Guard JWT **global** (`JwtAuthGuard`) : toute route est protégée sauf `@Public()`. Routes d'auth : `@AuthRateLimit()` (throttler `auth`).

## Git
- Branche de travail : `develop`. Jamais de push sur `main`, jamais de `--force`.
- Commits petits, Conventional Commits (`feat(auth): ...`, `test(...)`, `chore(...)`), push à la fin de chaque jalon.

## Tests
- Jest + Supertest sur une **vraie base PostgreSQL** (`risotto_test`) et Redis (db 1). Pas de mock de la base.
- Chaque endpoint a au moins un test de droits d'accès (401 sans token, 403/404 sur la ressource d'un autre).
- On ne passe pas au jalon suivant tant que `npm run lint && npm test && npm run test:e2e && npm run build` ne passent pas.

## Commandes locales
```bash
npm ci
npm run env:init                  # crée .env avec des secrets générés (n'écrase jamais)
docker compose up -d postgres redis mailpit
npm run migration:run
npm run start:dev                 # API sur http://localhost:3000/api
npm run lint && npm test && npm run test:e2e && npm run build
docker compose up -d --build      # tout en conteneurs (API incluse, migrations au démarrage)
npm run migration:generate -- src/database/migrations/<Name>   # nouvelle migration
```
- PostgreSQL est exposé sur le port hôte **5433** (un PostgreSQL local occupe 5432).
- `tsconfig` en `isolatedModules` : ts-jest transpile sans vérifier les types (sinon les tests sont très lents) ; le typage est vérifié par `npm run build` et `npm run lint`.
- Globs TypeORM : toujours avec des `/` (Windows), voir `src/database/typeorm-options.ts`.
- Les e2e utilisent `createTestApp()` (`test/utils`) : même pile HTTP que `main.ts` via `setupApp()`, seul l'email est remplacé par `FakeMailService` (`mail.lastResetCode(email)`). `resetDatabase(app)` vide les tables ; `registerUser(app)` crée un compte avec tokens.
- Les e2e lèvent les limites de débit (`test/setup-env.ts`) ; seul `rate-limit.e2e-spec.ts` les abaisse.
- TypeORM : `uuidExtension: 'pgcrypto'` (gen_random_uuid), colonnes en snake_case via `name:` explicite. `returning()` du QueryBuilder : passer une chaîne SQL (`'user_id, family_id'`), un tableau est ignoré silencieusement.
- Modules : `relationships` (bas niveau, `RelationshipService`, aucun import de services métier) ← `profiles`, `contacts`, `connections`. Ne jamais faire dépendre `relationships` d'un module métier (cycle).
- Visibilité : toute règle d'accès passe par `RelationshipService.resolve(viewer, owner)` (`self`/`connected`/`stranger`/`blocked`) puis `profileAccess()`. Ne pas dupliquer la logique ailleurs.
- DTO : `@OptionalNotNull()` pour un champ facultatif qui ne doit jamais valoir null (sinon `@IsOptional` laisse passer null → 500).
- QR : `risotto://u/<token>` (`parseQrPayload`). La carte de contact (`toContactCard`) ignore la visibilité mais respecte share_email/share_phone.
- Temps réel : `RealtimeService.emitToUser(userId, event, payload)` (module global) ; ne pas émettre directement depuis un gateway. Auth des sockets par middleware de namespace (`RealtimeGateway`). Les handlers WS renvoient un acquittement `{ok, ...}`, jamais d'exception.
- Messages : chiffrés par `MessageCipher` (AES-256-GCM, AAD `conversationId:senderId`) ; ne jamais logger un corps de message.
- `socket.io` doit avoir la même version que celle de `@nestjs/platform-socket.io` (sinon conflit de types) : `npm ls socket.io`.
- Notifications : les modules métier émettent des évènements (`DomainEvents`) via `EventEmitter2` ; seul `NotificationsService` crée notifications et pushs (handlers `async`, erreurs absorbées). En test, `createTestApp()` remplace FCM par `FakePushSender` (`push.sent`) ; `eventually()` attend les handlers asynchrones.
- Test anti-dérive : `app.e2e-spec.ts` échoue si les entités et les migrations divergent.

## Jalons
- [x] 1. Fondations (structure, Docker Compose, CI, config env)
- [x] 2. Authentification (inscription, connexion, refresh, déconnexion, reset mot de passe)
- [x] 3. Profil (création, édition, photo, visibilité)
- [x] 4. Contacts et partage (carte de contact, QR code personnel, scan)
- [x] 5. Mise en relation (recherche, demande, acceptation/refus, blocage)
- [x] 6. Messagerie (WebSocket, historique paginé, accusés de lecture, chiffrement au repos)
- [x] 7. Notifications (temps réel, push FCM, préférences)
- [ ] 8. Tableau de bord (demandes en attente, non lus, activité récente)
- [ ] 9. Finalisation (revue sécurité, performances, accessibilité, hors ligne)
