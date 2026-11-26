# Assistant IA pour Power BI

Un visuel personnalisé Power BI qui répond **en français** à des questions sur tes données, **sans que l'IA voie jamais les lignes** et **sans laisser passer un chiffre inventé**.

> « Quelle région a le plus vendu en 2025 ? » → *Nord, 1,93 M€, soit 35,3 % du total*, avec le graphique, le détail du calcul et le même calcul en DAX.

Projet réalisé dans le cadre de l'EPSI.

---

## Ce que fait le visuel

| Fonction | Description |
|---|---|
| **Questions en français** | Pose une question, l'assistant répond avec une phrase, 2 à 3 chiffres clés et un graphique (barres ou courbe). Il comprend les questions de suivi (« Et en 2024 ? »). |
| **Propositions d'analyses** | Dès que les données sont chargées, l'assistant résume le tableau et propose 5 analyses adaptées, à lancer d'un clic (bouton « ✦ Idées »). |
| **Chiffres vérifiés** | Chaque chiffre écrit par l'IA est comparé au résultat du calcul. Un chiffre introuvable est signalé, jamais affiché comme vrai. |
| **Refus honnête** | Une question hors des données (marge absente, prévision, cause) reçoit « Pas dans tes données » au lieu d'une invention. |
| **Filtrer le rapport** | Sous une réponse, des boutons « Filtrer le rapport : Nord, Sud… » filtrent toute la page Power BI. |
| **Voir le DAX** | Le calcul traduit en DAX (sans IA) : une requête pour la vue Requête DAX, qui redonne les mêmes chiffres, et des mesures à ajouter au modèle. |
| **Rapport d'analyse** | « 📋 Rapport » rédige une synthèse neutre (constats chiffrés, sans jugement ni recommandation) et le rapport complet, à copier dans Word. |
| **Gemini ou OpenAI** | Colle une clé Gemini (`AIza…`, gratuite) ou OpenAI (`sk-…`) : le visuel choisit le fournisseur tout seul. |

## Comment ça marche

```text
 Question ──► 1. Le visuel décrit les colonnes (noms, types, exemples) ─► jamais les lignes
              2. L'IA renvoie un PLAN de calcul en JSON (somme de Montant par Région, filtré sur 2025, top 3)
              3. Le visuel vérifie le plan (colonnes et valeurs existantes) et CALCULE lui-même
              4. L'IA rédige la phrase à partir des quelques lignes du résultat
              5. Le visuel vérifie chaque chiffre de la phrase dans le résultat
              6. Affichage : réponse, chiffres clés, graphique, « Voir le calcul », « Voir le DAX »
```

L'IA ne sert qu'à **comprendre la question** et à **rédiger la réponse**. Le calcul est fait dans le visuel, sur les lignes du rapport, déjà filtrées par les segments.

## Installation (5 minutes)

1. **Une clé API** : Gemini gratuite sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey), ou OpenAI sur [platform.openai.com/api-keys](https://platform.openai.com/api-keys) (payant, avec crédit).
2. **Importer le visuel** dans Power BI Desktop : volet *Visualisations* > `…` > *Importer un visuel à partir d'un fichier* > [`Assistant_IA_Power_BI.pbiviz`](Assistant_IA_Power_BI.pbiviz).
3. **Charger des données**, par exemple [`ventes_exemple.csv`](ventes_exemple.csv) (séparateur `;`, virgule décimale).
4. **Ajouter le visuel** sur la page et glisser les champs :
   - **Colonnes** : un identifiant de ligne (`IdVente`), puis `Date`, `Région`, `Catégorie`, `Canal`, `Client`
   - **Valeurs** : `Montant`, `Quantité`
5. **Coller la clé** : *Format du visuel* > *Assistant IA* > *Clé API (Gemini ou OpenAI)*.

Conseils :
- Mets toujours **un identifiant de ligne** dans *Colonnes*, sinon Power BI fusionne les lignes identiques et les comptages deviennent faux.
- Pour une date, choisis **le champ Date** et non la *Hiérarchie de dates* : le visuel regroupe lui-même par année, trimestre, mois ou jour.

## Développement

Le code source est dans [`assistant-ia-source/assistant-ia`](assistant-ia-source/assistant-ia). Détails techniques : [README du visuel](assistant-ia-source/assistant-ia/README.md).

```bash
cd assistant-ia-source/assistant-ia
npm install
npm test               # 13 tests du moteur de calcul et de la vérification, sans IA
npx pbiviz package     # crée dist/*.pbiviz
```

Tester avec la vraie IA, sans Power BI :

```bash
cp .env.example .env   # puis remplis OPENAI_API_KEY ou GEMINI_API_KEY
npm run test:ia        # propositions, questions, synthèse et rapport PDF dans tests/rapport-test.pdf
```

### Structure

```text
src/visual.ts     point d'entrée Power BI : données, interface, filtres, rapport
src/pipeline.ts   les étapes enchaînées (plan → calcul → phrase → vérification), propositions, synthèse
src/engine.ts     validation du plan et calcul (filtres, regroupements, agrégats)
src/guard.ts      vérification de chaque chiffre de la réponse
src/schema.ts     description des colonnes envoyée à l'IA (sans les lignes)
src/ia.ts         choix du fournisseur d'après la clé
src/gemini.ts     appels Gemini et consignes (plan, phrase, idées, synthèse)
src/openai.ts     appels OpenAI
src/dax.ts        traduction du plan en requête DAX et en mesures
src/rapport.ts    rapport en texte et en PDF (sans bibliothèque)
src/ui.ts         cartes de réponse, chiffres clés, graphiques
tests/            tests hors ligne et test avec la vraie IA
```

## Sécurité et limites

- **Les données restent dans Power BI.** L'IA reçoit les noms et types de colonnes, quelques exemples de valeurs (désactivable dans le volet Format) et les quelques lignes agrégées d'un résultat.
- **La clé API est enregistrée dans le fichier `.pbix`** : toute personne qui peut modifier le rapport peut la lire. C'est acceptable pour une démo. En entreprise, il faudrait un petit serveur qui garde la clé.
- Avec une clé Gemini gratuite, Google peut utiliser les requêtes pour améliorer ses produits : pas de données confidentielles.
- Opérations prises en charge : somme, moyenne, min, max, nombre de lignes, nombre distinct ; 0 à 2 regroupements ; filtres ; tri, top N, part du total. Pas de prévisions.
- Le DAX n'est généré que pour les champs glissés directement depuis une table (pas pour les mesures existantes).
- Beaucoup d'organisations bloquent les téléchargements depuis les visuels : le rapport se copie donc dans Word.

## Licence

MIT
