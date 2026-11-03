# Déployer Risotto sur Render (offre gratuite)

Le fichier `render.yaml` (Blueprint) crée trois ressources dans la région Francfort :

| Ressource | Nom | Offre |
|---|---|---|
| API NestJS (image Docker du dépôt) | `risotto-api` | Free |
| PostgreSQL | `risotto-db` | Free |
| Key Value (Redis) | `risotto-redis` | Free |

Les photos de profil sont stockées dans PostgreSQL (table `profile_photos`) : aucun disque n'est nécessaire.

## Limites de l'offre gratuite

- L'API s'endort après 15 minutes sans requête ; la première requête suivante prend environ une minute.
- **La base gratuite expire 30 jours après sa création** : passez-la en offre payante avant cette date pour garder les données.
- Redis gratuit n'est pas persistant : un redémarrage vide les compteurs de limitation de débit (sans conséquence).
- Pas d'accès shell sur l'offre gratuite : les scripts d'administration se lancent depuis votre poste (voir plus bas).

## 1. Emails avec Brevo

1. Créez un compte sur [brevo.com](https://www.brevo.com).
2. *Senders, Domains & Dedicated IPs* > *Senders* : ajoutez et validez l'adresse d'expédition (par exemple `no-reply@votre-domaine` ou votre adresse personnelle).
3. *SMTP & API* > onglet *SMTP* : notez le **login SMTP** et générez une **clé SMTP**.

## 2. Créer les ressources sur Render

1. Connectez votre compte GitHub à Render.
2. *New* > *Blueprint*, choisissez le dépôt `Risotto-back`, **branche `develop`**.
3. Render demande les variables marquées `sync: false` :
   - `SMTP_USER` : le login SMTP Brevo ;
   - `SMTP_PASSWORD` : la clé SMTP Brevo ;
   - `MAIL_FROM` : `Risotto <adresse validée chez Brevo>`.
4. Validez. Les secrets (`JWT_ACCESS_SECRET`, `TOKEN_HASH_SECRET`, `MESSAGE_ENCRYPTION_KEY`) sont générés par Render.
   **Ne modifiez jamais `MESSAGE_ENCRYPTION_KEY`** : les messages existants deviendraient illisibles.
5. Au démarrage, l'image applique les migrations puis lance l'API. Vérifiez :
   `https://risotto-api.onrender.com/api/health` (l'adresse exacte est affichée sur la page du service).

Chaque push sur `develop` redéploie l'API automatiquement.

## 3. Créer le compte administrateur

1. Créez le compte depuis l'application (inscription).
2. Sur Render, page de `risotto-db` > *Connect* > *External Connection* : copiez l'**External Database URL**.
3. Depuis le dossier `Risotto-back` de votre poste :

```bash
DATABASE_URL="<External Database URL>" DB_SSL=true npm run admin:grant -- votre@email
```

## 4. Application mobile

Compiler l'APK avec l'adresse de l'API :

```bash
flutter build apk --release --target-platform android-arm64 \
  --dart-define=API_BASE_URL=https://risotto-api.onrender.com/api
```

## 5. Vérifier la limitation de débit (TRUST_PROXY)

`TRUST_PROXY=1` indique à l'API qu'un seul proxy Render se trouve devant elle, pour lire la vraie adresse IP du client.
Contrôle, avec une adresse email **qui n'existe pas** (pour ne verrouiller aucun compte) : depuis le Wi-Fi, faites
11 tentatives de connexion en une minute (la 11ᵉ est refusée : « trop de tentatives », code 429) ; juste après, une
tentative depuis le téléphone **en 4G** doit encore obtenir « identifiants incorrects ». Si elle est aussi refusée, tous les
utilisateurs partagent le même compteur : augmentez `TRUST_PROXY` à `2` dans les variables du service et recommencez.
