# 🥕 Périmo

Scanne les produits de ton frigo, note leur date de péremption, reçois une alerte
à J-5 et trouve des recettes pour éviter le gaspillage.

Périmo est une **app web sans serveur à faire tourner** :

| Partie | Où | Coût |
|---|---|---|
| Interface (`docs/`) | GitHub Pages (ou tout hébergement de fichiers en HTTPS) | gratuit |
| Données + connexion | Supabase (base PostgreSQL) | gratuit |
| Alerte quotidienne | Supabase (tâche planifiée `pg_cron`) → ntfy | gratuit |
| Infos produit | Open Food Facts, appelé depuis le téléphone | gratuit |
| Lecture de la date | Tesseract.js, dans le téléphone | gratuit |
| Recettes | Base intégrée `docs/recettes.json` | gratuit |

## Mise en place

### 1. Supabase

1. Dans le projet Supabase : **SQL Editor** → coller le contenu de
   [supabase/schema.sql](supabase/schema.sql) → **Run**.
   Cela crée les tables, les règles de sécurité et l'alerte de chaque matin.
2. **Project Settings → API** : copier l'**URL du projet** et la clé **anon**
   (onglet « Legacy API keys » si elle n'est pas affichée directement).
3. Les coller dans [docs/config.js](docs/config.js).

⚠️ La clé `anon` est faite pour être publique (la sécurité vient des règles RLS).
Ne jamais mettre la clé `service_role` / `secret` dans `config.js`.

### 2. Tester sur le PC

```bash
python -m http.server 8765 --bind 127.0.0.1 --directory docs
```

Ouvrir http://127.0.0.1:8765, cliquer sur **Créer un compte**, valider le lien
reçu par e-mail, puis se connecter.

### 3. Mettre en ligne (GitHub Pages)

1. Créer un dépôt GitHub et y envoyer le projet.
2. **Settings → Pages** : Source « Deploy from a branch », branche `main`,
   dossier `/docs`.
3. L'app est disponible à `https://<pseudo>.github.io/<depot>/`.
4. Dans Supabase, **Authentication → URL Configuration** : mettre cette adresse
   dans **Site URL** (pour que le lien de confirmation d'e-mail y ramène).

### 4. Sur le téléphone

1. Ouvrir l'adresse GitHub Pages, se connecter.
2. Menu du navigateur → **Ajouter à l'écran d'accueil**.
3. Installer l'app **ntfy** et s'abonner au sujet affiché dans la section 🔔.

## Fonctionnalités

- **Scan du code-barres** (caméra, HTTPS nécessaire) → nom, marque et photo via Open Food Facts.
- **Lecture de la date sur une photo** : `12/11/2026`, `12.11.26`, `12 NOV 2026`,
  `11/2027` (→ fin du mois), `12/11` (→ prochaine occurrence). Les erreurs de lecture
  courantes (`O`→`0`, `I`→`1`…) sont corrigées. Toujours vérifier la date lue.
- **Liste du frigo** triée par date, pastille verte / orange (J-5) / rouge.
- **Alerte quotidienne** : tous les jours à 7h UTC (9h l'été, 8h l'hiver à Paris),
  Supabase envoie sur ntfy la liste des produits à J-5 ou moins.
  Le bouton « Envoyer une notification maintenant » envoie le même message tout de suite.
- **Recettes** : les 3 recettes de la base qui utilisent le plus de produits du frigo,
  en priorité ceux qui périment bientôt.

⚠️ Sur ntfy.sh, un sujet est public : toute personne qui connaît son nom peut lire
les messages. C'est pour ça que Périmo génère un nom aléatoire.

## Modifier les réglages

- **Délai d'alerte** : dans Supabase, **Table Editor → reglages**, colonne `jours_alerte`.
- **Heure de l'alerte** : relancer dans le SQL Editor, avec l'heure UTC voulue :
  ```sql
  select cron.schedule('perimo-alertes', '0 6 * * *', 'select public.envoyer_alertes_perimo()');
  ```

## Ajouter une recette

Ajouter un bloc dans [docs/recettes.json](docs/recettes.json) :

```json
{
  "titre": "Nom de la recette",
  "duree_minutes": 20,
  "ingredients": [
    {"nom": "Courgettes", "cles": ["courgette"]},
    {"nom": "Pommes", "cles": ["pomme"], "sauf": ["pomme de terre"]},
    {"nom": "Riz", "cles": ["riz"], "placard": true}
  ],
  "etapes": ["Étape 1", "Étape 2"]
}
```

`cles` : mots cherchés dans le nom du produit (sans accents, le pluriel est reconnu
tout seul). `sauf` : expressions qui empêchent la correspondance. `placard` : ingrédient
qu'on a souvent (pâtes, riz…), qui ne pénalise pas la recette s'il manque.

## Structure

```
supabase/schema.sql  Tables, sécurité et alerte quotidienne
docs/index.html       Page de l'app
docs/app.js           Connexion, frigo, scan, notifications
docs/config.js        URL et clé publique Supabase
docs/ocr-date.js      Lecture de la date sur une photo
docs/recettes.js      Choix des recettes selon le frigo
docs/recettes.json    Base de recettes françaises
```
