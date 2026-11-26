# Assistant IA (générique) pour Power BI

Un visuel personnalisé Power BI qui répond en français à des questions sur **n'importe quel jeu de données**.
Gemini ne voit jamais les données : il choisit le calcul, le visuel le fait lui-même, puis vérifie chaque chiffre de la réponse.

## Comment ça marche

**Filtrer le rapport** : sous une réponse regroupée par une colonne (Région, Catégorie…), des boutons « Filtrer le rapport : Nord, Sud… » appliquent ce filtre à toute la page. Le bandeau « ✕ Rapport filtré » en haut du visuel le retire.

**Voir le DAX** : sous chaque réponse, le même calcul traduit en DAX (sans IA, directement depuis le plan vérifié) : une requête à coller dans la vue Requête DAX pour retrouver les mêmes chiffres, et une mesure à ajouter au modèle. Disponible pour les champs glissés directement depuis une table (pas pour les mesures existantes ni les hiérarchies de dates).

**Rapport** : le bouton « 📋 Rapport » rédige une synthèse neutre de toutes les analyses (constats chiffrés et vérifiés, sans jugement ni recommandation) et affiche le rapport complet en texte, avec un bouton « Copier le rapport » : colle-le dans Word puis Fichier > Enregistrer sous > PDF. (Power BI bloque souvent les téléchargements depuis les visuels ; le PDF reste généré par `npm run test:ia`.)

**Propositions d'analyses** : dès que les champs et la clé sont en place, l'assistant lit la description des colonnes (pas les lignes), résume ce que contient le tableau et propose 5 analyses à lancer d'un clic. Le bouton « ✦ Idées » en haut du visuel en redemande à tout moment.

1. Tu poses une question dans le visuel.
2. Le visuel décrit tes colonnes : noms, types, quelques exemples de valeurs (désactivable).
3. Gemini renvoie un **plan de calcul** en JSON, par exemple : somme de Montant par Région, filtré sur 2025, top 3.
4. Le visuel vérifie le plan (colonnes et valeurs existantes) et calcule sur tes lignes, déjà filtrées par le rapport.
5. Gemini rédige la phrase à partir des quelques lignes du résultat.
6. Le visuel vérifie que chaque chiffre de la phrase vient du résultat, puis affiche la réponse, le graphique et « Voir le calcul ».

Si la question porte sur une information absente (une colonne qui n'existe pas, une prévision, une cause), l'assistant le dit au lieu d'inventer.

## Installation (5 minutes)

1. **Clé API** : une clé Gemini gratuite (https://aistudio.google.com/apikey, commence par `AIza`) ou une clé OpenAI payante (https://platform.openai.com/api-keys, commence par `sk-`). Le visuel reconnaît le fournisseur tout seul. Avec OpenAI, il essaie `gpt-4.1-mini`, puis `gpt-4o-mini`, puis `gpt-5-mini`.
2. **Importer le visuel** : dans Power BI Desktop, volet Visualisations > `…` > *Importer un visuel à partir d'un fichier* > `assistantIA….pbiviz`.
3. **Charger des données** : par exemple `ventes_exemple.csv` (séparateur `;`, virgule décimale).
   Dans Power Query, vérifie que `Date` est de type Date et `Montant` de type Nombre décimal.
4. **Ajouter le visuel** sur la page, puis glisser les champs :
   - **Colonnes** : Date, Région, Catégorie, Canal, Client, et un identifiant de ligne (`IdVente`)
   - **Valeurs** : Montant, Quantité
5. **Coller la clé** : Format du visuel > *Assistant IA* > *Clé API (Gemini ou OpenAI)*.
6. Pose une question : « Quelle région a le plus vendu en 2025 ? », « Comment évolue le montant par mois ? », « Et en 2024 ? ».

## Conseils

- **Mets un identifiant de ligne dans Colonnes** (IdVente, numéro de commande…). Sinon, Power BI fusionne les lignes identiques et les comptages deviennent faux.
- **Les dates** : dans le puits *Colonnes*, clique sur la flèche du champ Date et choisis *Date* plutôt que *Hiérarchie de dates*. Le visuel sait regrouper par année, trimestre, mois ou jour.
- **Les Valeurs sont additionnées** par ligne : c'est parfait pour des montants ou des quantités.
- **Les segments et filtres du rapport s'appliquent** : si tu filtres sur 2024, l'assistant ne voit que 2024.
- **Volume** : jusqu'à 30 000 lignes par défaut (réglable dans *Lignes max chargées*). Au-delà, l'approche devient lente : préfère la version avec passerelle Python.

## Limites à connaître

- L'IA ne voit que les champs glissés dans le visuel, pas tout le modèle.
- La clé API est stockée dans le fichier du rapport : toute personne qui peut modifier le rapport peut la lire. Pour une démo, c'est acceptable. En entreprise, il faudrait un petit proxy qui garde la clé côté serveur.
- Côté Google, l'offre gratuite de Gemini peut utiliser les requêtes pour améliorer ses produits. N'utilise pas de données confidentielles avec une clé gratuite.
- Opérations prises en charge : somme, moyenne, min, max, nombre de lignes, nombre distinct ; 0 à 2 regroupements ; filtres `= != in > >= < <= entre contient` ; tri, top N, part du total. Pas de prévisions ni de mesures DAX personnalisées.

## Structure du code

```text
capabilities.json   champs acceptés (Colonnes, Valeurs), paramètres, accès réseau limité à Gemini
src/visual.ts       point d'entrée Power BI : lit les lignes, charge les paquets suivants, affiche
src/schema.ts       étape 2 : décrit les colonnes sans envoyer les données
src/gemini.ts       étapes 3 et 5 : appels à Gemini et les deux consignes (plan, phrase)
src/engine.ts       étape 4 : valide le plan et calcule (filtres, regroupements, agrégats)
src/dax.ts          traduction du plan de calcul en requête DAX et en mesure
src/rapport.ts      rapport PDF (écrit sans bibliothèque) : synthèse, détail des analyses, méthode
src/guard.ts        étape 6 : retrouve chaque chiffre de la phrase dans le résultat
src/pipeline.ts     les 6 étapes enchaînées, avec une correction automatique si le plan ou la phrase est faux
src/ui.ts           carte de réponse, chiffres clés, barres ou courbe, « Voir le calcul »
tests/              tests du moteur et de la vérification sur le jeu d'exemple (sans appel à Gemini)
```

## Recompiler

```bash
npm install
npx pbiviz package          # crée dist/*.pbiviz
npx esbuild tests/test.ts --bundle --platform=node --outfile=tests/t.js && node tests/t.js ventes_exemple.csv
```

Le modèle Gemini se change dans le volet Format (*Modèle Gemini*). Par défaut : `gemini-3.1-flash-lite`, le plus rapide (environ 2 s par question). Si le modèle choisi est saturé (503), hors quota ou trop lent (plus de 20 s), le visuel le met de côté quelques minutes et passe à `gemini-3.1-flash-lite`, puis `gemini-2.5-flash`, puis `gemini-3.5-flash`.
