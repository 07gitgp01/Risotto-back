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
| `users` | id uuid PK, email citext (unique, minuscules), password_hash (argon2id), qr_token (unique, jalon 4), created_at, updated_at | |
| `refresh_tokens` | id, user_id FK, family_id, token_hash (unique), expires_at, used_at, revoked_at, created_at, user_agent | index (user_id), (family_id) |
| `password_reset_codes` | id, user_id FK, code_hash (HMAC-SHA256), expires_at, used_at, failed_attempts, created_at | TTL 30 min, 5 essais, seul le dernier code est valide |
| `profiles` | user_id PK/FK, first_name, last_name, headline, job_title, company, bio, location, phone, website, photo_key, visibility (`public`/`connections`/`private`, défaut `connections`), share_email, share_phone (défaut false), updated_at | créé à l'onboarding (`POST /profiles/me`) |
| `saved_contacts` | id, owner_id FK, contact_id FK, note (≤ 500, privée), created_at | unique (owner_id, contact_id) |
| `connections` | id, user_a_id, user_b_id (paire ordonnée a < b), requester_id, addressee_id, status (`pending`/`accepted`/`declined`), message (≤ 300), created_at, responded_at | unique (user_a_id, user_b_id) : une ligne par paire |
| `blocks` | blocker_id FK, blocked_id FK, created_at | PK (blocker_id, blocked_id) |
| `conversations` | id, user_a_id, user_b_id (a < b), user_a_last_read_at, user_b_last_read_at, last_message_at, created_at | unique (user_a_id, user_b_id) ; 1-à-1 donc un marqueur de lecture par côté (pas de table `conversation_members`) |
| `messages` | id, conversation_id FK, sender_id FK, ciphertext bytea, iv bytea (12 o), auth_tag bytea (16 o), key_version, created_at | index (conversation_id, created_at, id) ; AAD = `conversationId:senderId` |
| `notifications` | id, user_id FK, type, data jsonb (ids seulement : actorId, connectionId…), read_at, created_at | index (user_id, created_at) ; les noms sont résolus à la lecture |
| `notification_preferences` | user_id, type, in_app, push | PK (user_id, type) ; ligne créée seulement quand l'utilisateur change un défaut |
| `device_tokens` | id, user_id FK, token (unique), platform (`android`/`ios`), created_at, last_seen_at | un jeton appartient au dernier utilisateur connecté sur l'appareil |

## Endpoints REST (préfixe `/api`, JWT requis sauf mention)
| Domaine | Méthode et chemin | Règle d'accès |
|---|---|---|
| Santé | `GET /health` | public |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password` | public, rate limit renforcé |
| Auth | `POST /auth/logout`, `POST /auth/logout-all` | propriétaire du token |
| Utilisateur | `GET /users/me` | soi-même |
| Profil | `GET/POST/PATCH /profiles/me`, `PUT/DELETE /profiles/me/photo` | soi-même |
| Profil | `GET /profiles/:userId`, `GET /profiles/:userId/photo` | selon visibilité, 404 si bloqué |
| Contacts | `GET /contacts/card/me`, `GET /contacts`, `PATCH /contacts/:contactId {note}`, `DELETE /contacts/:contactId` | propriétaire |
| QR | `GET /qr/me`, `POST /qr/me/rotate`, `POST /qr/scan {payload, saveContact?}` (aperçu ou enregistrement ; la demande de relation par QR arrive au jalon 5) | authentifié, scan limité à 30/min |
| Recherche | `GET /users/search?q=&limit=&offset=` | profils non privés, hors soi et bloqués ; insensible à la casse et aux accents (`unaccent`) |
| Relations | `POST /connections {userId \| qrPayload, message?}`, `GET /connections`, `GET /connections/requests?direction=incoming\|outgoing` | parties concernées |
| Relations | `POST /connections/:id/accept`, `/decline` | destinataire uniquement |
| Relations | `DELETE /connections/:id` | l'une des deux parties |
| Blocage | `POST /blocks`, `GET /blocks`, `DELETE /blocks/:userId` | soi-même |
| Messagerie | `GET /conversations`, `POST /conversations {userId}`, `GET /conversations/:id` | membre ; création si en relation |
| Messagerie | `GET /conversations/:id/messages?before=&limit=`, `POST /conversations/:id/messages`, `POST /conversations/:id/read` | membre |
| Notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` | propriétaire |
| Notifications | `GET/PUT /notifications/preferences`, `POST /devices`, `DELETE /devices {token}` (jeton dans le corps : trop long pour une URL) | soi-même |
| Tableau de bord | `GET /dashboard` : demandes reçues (nombre + 3 dernières), messages non lus (nombre + 3 conversations), notifications non lues, nombre de relations et de contacts, 10 dernières activités | soi-même |

## Socket.IO (`/ws`, auth : `auth.token` = access token)
- Client → serveur : `message:send {conversationId, body}`, `conversation:read {conversationId}` ; réponse par acquittement `{ok, data}` ou `{ok: false, error, status}` (jamais d'exception). Envoi limité à 20 messages / 10 s / utilisateur.
- Authentification au handshake (`auth.token`) ; un jeton expiré ferme le socket au prochain évènement, `logout-all` et le changement de mot de passe ferment tous les sockets de l'utilisateur.
- Serveur → client : `message:new`, `conversation:read`, `notification:new`, `connection:update`.
- Chaque socket rejoint la room `user:<id>` ; les émissions passent par l'adapter Redis.

## Choix pris en mode autonome (à valider)
- Visibilité : `public` (tout utilisateur connecté, présent dans la recherche), `connections` (profil complet pour les relations, aperçu nom + titre + photo pour les autres, présent dans la recherche), `private` (nom seul, absent de la recherche).
- QR code : contient `risotto://u/<qr_token>` (jeton aléatoire 256 bits, créé au premier affichage, régénérable ; jamais l'id utilisateur). Régénérer invalide l'ancien QR mais conserve les contacts déjà enregistrés.
- Scanner un QR révèle la **carte de contact** (nom, titre, poste, entreprise, ville, site, photo ; email/téléphone selon les partages) même si le profil est privé : montrer son QR est un acte de partage volontaire. La bio n'en fait pas partie.
- Un contact enregistré voit la photo de la carte même si le profil est privé ; la carte reste à jour avec le profil.
- Partage hors app : export vCard 3.0 via la feuille de partage du système.
- Carte de contact : email/téléphone inclus uniquement si `share_email` / `share_phone` activés.
- Mise en relation :
  - par `userId` (recherche, profil) seulement si le profil n'est pas privé ; un profil privé n'est joignable que via son QR code ;
  - si l'autre m'a déjà envoyé une demande, ma demande l'accepte ;
  - refus : le demandeur refusé ne peut pas redemander pendant 30 jours ; celui qui a refusé peut demander quand il veut ;
  - le demandeur annule (`DELETE`), le destinataire refuse (`decline`) ; l'un ou l'autre retire une relation acceptée.
- Blocage : supprime relation et demandes, masque les deux membres l'un à l'autre (profil, photo, recherche, QR, contacts enregistrés, demandes). Le membre bloqué n'est pas prévenu et ne voit pas qui l'a bloqué.
- Recherche : nom, prénom et titre pour tous ; poste et entreprise uniquement pour les profils publics (sinon on révélerait des champs masqués).
- Messagerie : conversations 1-à-1 uniquement, ouvertes et alimentées seulement entre relations acceptées. Si la relation est retirée, l'historique reste lisible mais l'envoi est bloqué (`canSend: false`) ; un blocage masque la conversation aux deux. L'app envoie en HTTP (refresh automatique du jeton) et reçoit en temps réel par WebSocket ; le serveur accepte aussi l'envoi par socket.
- Reset mot de passe (validé) : **code à 6 chiffres** envoyé par email (Mailpit en local), valable 30 min, usage unique, 5 essais maximum, révoque toutes les sessions. `POST /auth/reset-password {email, code, newPassword}`.
- Mot de passe : 8 à 128 caractères, au moins une lettre et un chiffre.
- Hachage : argon2id via `@node-rs/argon2` (binaires précompilés ; le paquet `argon2` exige une compilation C++ sous Windows).
- Notifications :
  - types : `connection_request`, `connection_accepted` (liste in-app + push), `message` (push uniquement : les messages ont déjà leurs badges de non-lus) ;
  - déclenchées par des évènements de domaine (`@nestjs/event-emitter`), traitées en asynchrone : un échec de notification ne casse jamais l'action d'origine ;
  - le push d'un message affiche le nom de l'expéditeur et « Nouveau message », **jamais le contenu** (écran verrouillé) ;
  - FCM via `firebase-admin`, activé seulement si `FCM_SERVICE_ACCOUNT_PATH` pointe vers un fichier ; les jetons refusés par FCM sont supprimés ;
  - côté app, le push n'est actif qu'avec `--dart-define=FCM_ENABLED=true` et les fichiers Firebase (non commités).
- Photos : JPEG/PNG/WebP ≤ 5 Mo ; le format est détecté par décodage (sharp), puis l'image est réencodée en WebP 512 px max, sans métadonnées (EXIF/GPS supprimés). Stockage disque local (`UPLOAD_DIR/photos`), nom aléatoire, servie via `GET /profiles/:userId/photo` (authentifié, même règle de visibilité que le profil).
- Profil : créé après l'inscription via un écran d'onboarding (prénom + nom obligatoires). Visibilité par défaut `connections`, email et téléphone non partagés par défaut (confidentialité par défaut).
- Niveaux d'accès d'un profil : `full` (soi, relations, ou profil public), `preview` (nom, titre, photo : profil `connections` vu par un non-relation), `minimal` (nom seul : profil `private`), 404 si blocage.
