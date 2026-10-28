# CLAUDE.md — risotto-back

API NestJS de **Risotto**, application mobile de réseautage professionnel (client : `risotto-front`, Flutter).
Langue des échanges : français. Code, commits, noms techniques : anglais.

## Décisions techniques
- Node.js 20+ / NestJS 11 (TypeScript strict), PostgreSQL 16, TypeORM 0.3 avec **migrations versionnées** (`synchronize: false` partout).
- Redis 7 : stockage du rate limiting, adapter Socket.IO, cache léger.
- Socket.IO (namespace `/ws`) pour la messagerie et les notifications temps réel.
- Tout tourne en local via Docker Compose (PostgreSQL, Redis, Mailpit, API). Pas de serveur de production.
- Emails (reset mot de passe) : SMTP → Mailpit en local (UI http://localhost:8025).
- Photos de profil : stockage disque local (`UPLOAD_DIR`, volume Docker), servies par un endpoint authentifié.
- Push : FCM via `firebase-admin`, désactivé si `FCM_SERVICE_ACCOUNT_PATH` est vide.
- Architecture : un module Nest par domaine dans `src/modules/*`, code transverse dans `src/common`, config typée dans `src/config`.

## Sécurité (non négociable)
- Mots de passe : argon2id. Jamais loggés, jamais renvoyés.
- Access token JWT 15 min (`JWT_ACCESS_SECRET`), refresh token opaque à **rotation** stocké hashé (SHA-256) par famille ; réutilisation d'un refresh déjà utilisé ⇒ révocation de toute la famille.
- `ValidationPipe` global : `whitelist`, `forbidNonWhitelisted`, `transform`. Tout DTO est validé par class-validator.
- helmet, CORS restreint à `CORS_ORIGINS`, rate limiting global + renforcé sur `/auth/*`.
- Contrôle d'accès sur **chaque** ressource : l'utilisateur courant vient du JWT, jamais du body. Un utilisateur bloqué ne voit rien de celui qui l'a bloqué.
- Messages chiffrés au repos en AES-256-GCM (`MESSAGE_ENCRYPTION_KEY`, 32 octets base64). Ce n'est **pas** du bout en bout : le serveur peut déchiffrer.
- Aucun secret dans Git : `.env` ignoré, `.env.example` documenté. Réponses d'erreur sans stack trace.
- Réponses anti-énumération : `forgot-password` répond toujours 204.

## Git
- Branche de travail : `develop`. Jamais de push sur `main`, jamais de `--force`.
- Commits petits, Conventional Commits (`feat(auth): ...`, `test(...)`, `chore(...)`), push à la fin de chaque jalon.

## Tests
- Jest + Supertest sur une **vraie base PostgreSQL** (`risotto_test`) et Redis (db 1). Pas de mock de la base.
- Chaque endpoint a au moins un test de droits d'accès (401 sans token, 403/404 sur la ressource d'un autre).
- On ne passe pas au jalon suivant tant que `npm run lint && npm test && npm run test:e2e && npm run build` ne passent pas.

## Commandes locales
```bash
cp .env.example .env              # puis renseigner les secrets (voir README)
docker compose up -d postgres redis mailpit
npm ci
npm run migration:run
npm run start:dev                 # API sur http://localhost:3000/api
npm run lint && npm test && npm run test:e2e && npm run build
docker compose up -d --build      # tout en conteneurs (API incluse)
npm run migration:generate -- src/database/migrations/<Name>   # nouvelle migration
```

## Jalons
- [ ] 1. Fondations (structure, Docker Compose, CI, config env)
- [ ] 2. Authentification (inscription, connexion, refresh, déconnexion, reset mot de passe)
- [ ] 3. Profil (création, édition, photo, visibilité)
- [ ] 4. Contacts et partage (carte de contact, QR code personnel, scan)
- [ ] 5. Mise en relation (recherche, demande, acceptation/refus, blocage)
- [ ] 6. Messagerie (WebSocket, historique paginé, accusés de lecture, chiffrement au repos)
- [ ] 7. Notifications (temps réel, push FCM, préférences)
- [ ] 8. Tableau de bord (demandes en attente, non lus, activité récente)
- [ ] 9. Finalisation (revue sécurité, performances, accessibilité, hors ligne)
