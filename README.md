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

## Configuration

Toutes les variables sont documentées dans [.env.example](.env.example) et validées au démarrage : l'API refuse de démarrer si une variable est absente ou invalide. Le fichier `.env` n'est jamais commité.

## Sécurité

- Mots de passe hachés en argon2id ; access token JWT de 15 min et refresh token à rotation avec détection de réutilisation.
- Validation stricte des entrées (class-validator, propriétés inconnues refusées), helmet, CORS restreint à `CORS_ORIGINS`, limitation de débit stockée dans Redis.
- Les erreurs renvoyées ne contiennent jamais de stack trace ni de message interne.

### Chiffrement de la messagerie : ce n'est pas du bout en bout

Les messages sont protégés **en transit** par TLS et **au repos** par AES-256-GCM, avec la clé `MESSAGE_ENCRYPTION_KEY` fournie par variable d'environnement. Le serveur détient cette clé : il **peut déchiffrer** les messages, par exemple pour les afficher ou les notifier. Une personne ayant accès à la base de données seule ne peut pas les lire. Une personne ayant accès à la base **et** à la clé le peut. Ce n'est donc pas un chiffrement de bout en bout.

En local, l'API est servie en HTTP simple : le TLS sera assuré par un reverse proxy le jour où un serveur sera déployé.
