# Déployer Risotto : API sur Render, base sur Supabase

| Élément | Hébergeur | Offre |
|---|---|---|
| API NestJS (image Docker du dépôt) | Render, *Web Service* | Free |
| PostgreSQL | Supabase | Free |
| Redis | Render, *Key Value* | Free |
| Emails (codes de réinitialisation) | Brevo, relais SMTP | Free |

Les photos de profil sont stockées dans PostgreSQL (table `profile_photos`) : aucun disque n'est nécessaire.

## 1. Supabase : adresse de connexion et certificat

1. Projet Supabase > bouton **Connect** (en haut) > onglet *Connection string* > **Session pooler**.
   Copiez l'adresse : `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<région>.pooler.supabase.com:5432/postgres`.
   - Prenez le *Session pooler* (port **5432**) : la connexion directe (`db.<ref>.supabase.co`) n'est joignable
     qu'en IPv6, ce que Render ne gère pas, et le *Transaction pooler* (6543) ne convient pas aux migrations.
   - Remplacez `[YOUR-PASSWORD]` par le mot de passe de la base. S'il contient des caractères spéciaux
     (`@ : / # ? %`…), encodez-les (`@` → `%40`, `#` → `%23`…) ou choisissez un mot de passe alphanumérique
     (*Project Settings* > *Database* > *Reset database password*).
2. *Project Settings* > *Database* > **SSL Configuration** > *Download certificate* : fichier `prod-ca-2021.crt`.
   Il permet à l'API de vérifier qu'elle parle bien à Supabase.

## 2. Render : Redis (Key Value)

*New* > **Key Value** : nom `risotto-redis`, offre *Free*, **même région que le web service**,
politique d'éviction `noeviction`. Laissez la liste d'accès vide (accessible seulement depuis Render).
Copiez ensuite l'**Internal Key Value URL** (`redis://red-…:6379`).

## 3. Brevo : SMTP

1. Compte sur [brevo.com](https://www.brevo.com).
2. *Senders* : ajoutez et validez l'adresse d'expédition.
3. *SMTP & API* > *SMTP* : notez le **login SMTP** et générez une **clé SMTP**.

## 4. Render : réglages du web service

*Settings* :
- **Repository** `Risotto-back`, **Branch** `develop`, **Language / Runtime** `Docker`
  (le `Dockerfile` applique les migrations puis lance l'API).
- **Health Check Path** : `/api/health`.

*Environment* > variables :

| Variable | Valeur |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | l'adresse *Session pooler* Supabase, mot de passe inclus |
| `DB_SSL` | `true` |
| `DB_SSL_CA` | tout le contenu du fichier `prod-ca-2021.crt` (de `-----BEGIN CERTIFICATE-----` à `-----END CERTIFICATE-----`) |
| `REDIS_URL` | l'*Internal Key Value URL* |
| `TRUST_PROXY` | `1` |
| `CORS_ORIGINS` | *(vide)* |
| `JWT_ACCESS_SECRET` | secret aléatoire (voir ci-dessous) |
| `TOKEN_HASH_SECRET` | autre secret aléatoire |
| `MESSAGE_ENCRYPTION_KEY` | clé aléatoire de 32 octets (voir ci-dessous) |
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` |
| `SMTP_USER` | login SMTP Brevo |
| `SMTP_PASSWORD` | clé SMTP Brevo |
| `MAIL_FROM` | `Risotto <adresse validée chez Brevo>` |

Générer les secrets sur votre poste (une valeur par variable, à coller directement dans Render, jamais dans Git) :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # JWT_ACCESS_SECRET, TOKEN_HASH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # MESSAGE_ENCRYPTION_KEY
```

**Ne changez jamais `MESSAGE_ENCRYPTION_KEY` une fois l'API en service** : les messages existants deviendraient illisibles.
Gardez-en une copie en lieu sûr (gestionnaire de mots de passe).

Enregistrez : Render redéploie. Vérifiez `https://<votre-service>.onrender.com/api/health`.
Chaque push sur `develop` redéploie ensuite l'API.

## 5. Compte administrateur

1. Créez le compte depuis l'application (inscription).
2. Depuis le dossier `Risotto-back` de votre poste :

```bash
DATABASE_URL="<adresse Session pooler>" DB_SSL=true DB_SSL_CA_FILE=chemin/vers/prod-ca-2021.crt \
  npm run admin:grant -- votre@email
```

## 6. Application mobile

```bash
flutter build apk --release --target-platform android-arm64 \
  --dart-define=API_BASE_URL=https://<votre-service>.onrender.com/api
```

## 7. Vérifier la limitation de débit (TRUST_PROXY)

`TRUST_PROXY=1` indique qu'un seul proxy Render se trouve devant l'API, pour lire la vraie adresse IP du client.
Contrôle, avec une adresse email **qui n'existe pas** (pour ne verrouiller aucun compte) : depuis le Wi-Fi, faites
11 tentatives de connexion en une minute (la 11ᵉ est refusée : « trop de tentatives », code 429) ; juste après, une
tentative depuis le téléphone **en 4G** doit encore obtenir « identifiants incorrects ». Si elle est aussi refusée,
tous les utilisateurs partagent le même compteur : passez `TRUST_PROXY` à `2` et recommencez.

## Limites des offres gratuites

- Render : l'API s'endort après 15 minutes sans requête ; la requête suivante prend environ une minute.
- Supabase : un projet gratuit inactif pendant une semaine est mis en pause (à relancer depuis le tableau de bord).
- Redis gratuit n'est pas persistant : un redémarrage vide les compteurs de limitation (sans conséquence).
