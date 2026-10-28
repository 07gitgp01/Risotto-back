# Risotto — plan d'architecture

## Vue d'ensemble
```
 Flutter (Android/iOS)  ──HTTPS/REST (dio)──►  NestJS API (/api)  ──TypeORM──►  PostgreSQL 16
          │                                         │   ▲
          └──────Socket.IO (/ws, JWT)───────────────┘   └── Redis 7 (rate limit, Socket.IO adapter)
                                                    │
                                                    ├──SMTP──► Mailpit (local)
                                                    └──FCM───► Firebase (optionnel)
```

## Arborescence backend (`risotto-back`)
```
src/
  main.ts                    bootstrap (helmet, CORS, ValidationPipe, prefix /api)
  app.module.ts
  config/                    validation des variables d'env (Joi) + config typée
  common/                    guards (JwtAuthGuard), décorateurs (@CurrentUser, @Public),
                             filtres d'erreur, crypto (AES-GCM, hash), redis, pagination
  database/
    data-source.ts           DataSource CLI TypeORM
    migrations/              migrations versionnées
  modules/
    health/                  GET /health
    users/                   entité User, GET /users/me, recherche
    auth/                    register, login, refresh, logout, forgot/reset password
    mail/                    envoi SMTP (nodemailer)
    profiles/                profil, photo, visibilité
    contacts/                carte de contact, QR personnel, scan, contacts enregistrés
    connections/             demandes, acceptation/refus, blocage
    messaging/               conversations, messages chiffrés, gateway Socket.IO
    notifications/           notifications in-app, préférences, devices FCM
    dashboard/               agrégats
test/                        tests e2e (Supertest, vraie base risotto_test)
docker/                      init SQL (création de la base de test)
docker-compose.yml  Dockerfile  .env.example  .github/workflows/ci.yml
```

## Arborescence mobile (`risotto-front`)
```
lib/
  main.dart / app.dart
  core/       config (API_BASE_URL), network (dio + intercepteur refresh), storage (secure storage),
              theme (charte Risotto), router (go_router + garde d'auth), realtime (socket), widgets communs
  features/
    auth/ profile/ contacts/ connections/ messaging/ notifications/ dashboard/
      data/          modèles + repositories (appels API)
      application/   notifiers / providers Riverpod
      presentation/  écrans et widgets
test/                tests unitaires et de widgets
```

## Schéma de base de données
| Table | Colonnes principales | Contraintes |
|---|---|---|
| `users` | id uuid PK, email (unique, minuscules), password_hash, qr_token (unique), created_at, updated_at | |
| `refresh_tokens` | id, user_id FK, family_id, token_hash (unique), expires_at, used_at, revoked_at, created_at, user_agent | index (user_id), (family_id) |
| `password_reset_tokens` | id, user_id FK, token_hash (unique), expires_at, used_at | TTL 30 min |
| `profiles` | user_id PK/FK, first_name, last_name, headline, job_title, company, bio, location, phone, website, photo_key, visibility (`public`/`connections`/`private`), share_email, share_phone, updated_at | |
| `saved_contacts` | id, owner_id FK, contact_id FK, note, created_at | unique (owner_id, contact_id) |
| `connections` | id, requester_id FK, addressee_id FK, status (`pending`/`accepted`/`declined`), created_at, responded_at | unique paire non orientée (least, greatest) |
| `blocks` | blocker_id FK, blocked_id FK, created_at | PK (blocker_id, blocked_id) |
| `conversations` | id, user_a_id, user_b_id (a < b), last_message_at, created_at | unique (user_a_id, user_b_id) |
| `conversation_members` | conversation_id, user_id, last_read_at | PK composite |
| `messages` | id, conversation_id FK, sender_id FK, ciphertext bytea, iv bytea, auth_tag bytea, key_version, created_at | index (conversation_id, created_at desc) |
| `notifications` | id, user_id FK, type, data jsonb, read_at, created_at | index (user_id, created_at desc) |
| `notification_preferences` | user_id, type, in_app, push | PK (user_id, type) |
| `device_tokens` | id, user_id FK, token (unique), platform, created_at | |

## Endpoints REST (préfixe `/api`, JWT requis sauf mention)
| Domaine | Méthode et chemin | Règle d'accès |
|---|---|---|
| Santé | `GET /health` | public |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password` | public, rate limit renforcé |
| Auth | `POST /auth/logout`, `POST /auth/logout-all` | propriétaire du token |
| Utilisateur | `GET /users/me` | soi-même |
| Profil | `GET/PATCH /profiles/me`, `PUT/DELETE /profiles/me/photo` | soi-même |
| Profil | `GET /profiles/:userId`, `GET /profiles/:userId/photo` | selon visibilité, 404 si bloqué |
| Contacts | `GET /contacts/card/me`, `GET /contacts`, `DELETE /contacts/:id` | propriétaire |
| QR | `GET /qr/me`, `POST /qr/me/rotate`, `POST /qr/scan` (`connect` ou `save_contact`) | authentifié |
| Recherche | `GET /users/search?q=` | profils publics/connexions, hors bloqués |
| Relations | `POST /connections`, `GET /connections`, `GET /connections/requests?direction=incoming\|outgoing` | parties concernées |
| Relations | `POST /connections/:id/accept`, `/decline` | destinataire uniquement |
| Relations | `DELETE /connections/:id` | l'une des deux parties |
| Blocage | `POST /blocks`, `GET /blocks`, `DELETE /blocks/:userId` | soi-même |
| Messagerie | `GET /conversations`, `POST /conversations` | membre ; création si connectés |
| Messagerie | `GET /conversations/:id/messages?before=&limit=`, `POST /conversations/:id/messages`, `POST /conversations/:id/read` | membre |
| Notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` | propriétaire |
| Notifications | `GET/PUT /notifications/preferences`, `POST /devices`, `DELETE /devices/:token` | soi-même |
| Tableau de bord | `GET /dashboard` | soi-même |

## Socket.IO (`/ws`, auth : `auth.token` = access token)
- Client → serveur : `message:send {conversationId, body}`, `conversation:read {conversationId}`.
- Serveur → client : `message:new`, `conversation:read`, `notification:new`, `connection:update`.
- Chaque socket rejoint la room `user:<id>` ; les émissions passent par l'adapter Redis.

## Choix pris en mode autonome (à valider)
- Visibilité : `public` (tout utilisateur connecté, présent dans la recherche), `connections` (profil complet pour les relations, aperçu nom + titre + photo pour les autres, présent dans la recherche), `private` (nom seul, absent de la recherche).
- QR code : contient `risotto://u/<qr_token>` (jeton aléatoire révocable, pas l'id utilisateur).
- Carte de contact : email/téléphone inclus uniquement si `share_email` / `share_phone` activés.
- Messagerie : conversations 1-à-1 uniquement, réservées aux utilisateurs en relation acceptée.
- Reset mot de passe : lien/jeton envoyé par email (Mailpit en local), valable 30 min, usage unique, révoque toutes les sessions.
- Photos : JPEG/PNG/WebP ≤ 5 Mo, vérification des magic bytes, stockage disque local.
