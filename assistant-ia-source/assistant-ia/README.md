# Assistant IA — code source du visuel

Présentation, démo et installation : voir le [README principal](../../README.md).
Ce fichier décrit le code et les commandes de développement.

## Commandes

```bash
npm install
npm test            # tests hors ligne (moteur, vérification, pipeline avec une IA simulée) sur ../../ventes_exemple.csv
npm run test:ia     # test avec la vraie IA : clé dans .env (voir .env.example), rapport PDF dans tests/rapport-test.pdf
npm run lint        # ESLint (règles Power BI)
npx pbiviz package  # crée dist/*.pbiviz à importer dans Power BI Desktop
```

## Déroulé d'une question

1. `schema.ts` décrit les colonnes du visuel : noms, types, nombre de valeurs distinctes, exemples, min et max. Les lignes ne sont pas envoyées.
2. L'IA renvoie un **plan de calcul** JSON (`SYSTEME_PLAN` dans `gemini.ts`).
3. `engine.ts` valide le plan (colonnes, valeurs, types) et calcule sur les lignes du rapport. Un plan invalide repart une fois vers l'IA avec l'erreur précise.
4. L'IA rédige la phrase à partir des 30 premières lignes du résultat (`SYSTEME_PHRASE`).
5. `guard.ts` retrouve chaque chiffre de la phrase dans le résultat (valeurs, écarts, ratios, pourcentages, à l'arrondi près). En cas d'écart, une réécriture, puis signalement.
6. `ui.ts` affiche la réponse ; `visual.ts` ajoute les boutons de filtre et le DAX (`dax.ts`).

Les mêmes briques servent aux **propositions d'analyses** (`proposer`, `SYSTEME_IDEES`) et à la **synthèse du rapport** (`synthese`, `SYSTEME_RAPPORT`), dont les chiffres sont aussi vérifiés.

## Fichiers

```text
capabilities.json   champs (Colonnes, Valeurs), réglages, objet de filtre, accès réseau (Gemini, OpenAI)
src/visual.ts       point d'entrée Power BI : interface, questions, filtres du rapport, DAX, rapport
src/donnees.ts      lecture des champs du visuel (table Power BI → colonnes typées et lignes)
src/pipeline.ts     enchaînement des étapes, propositions d'analyses, synthèse vérifiée
src/engine.ts       validation du plan et calcul : filtres, regroupements (dont périodes), agrégats, part du total
src/guard.ts        extraction des nombres au format français et vérification
src/schema.ts       description des colonnes envoyée à l'IA
src/dax.ts          traduction du plan en requête DAX (vue Requête DAX) et en mesures
src/rapport.ts      rapport en texte (copié dans Word depuis le visuel) et en PDF (utilisé par npm run test:ia)
src/ia.ts           choix du fournisseur d'après la clé : sk-… = OpenAI, sinon Gemini
src/gemini.ts       client Gemini et les quatre consignes (plan, phrase, idées, synthèse)
src/openai.ts       client OpenAI (Chat Completions, réponse JSON)
src/ui.ts           cartes de réponse, chiffres clés, barres et courbes, « Voir le calcul », zones à copier
src/format.ts       mise en forme des nombres en français (interface et rapport)
src/settings.ts     volet Format : clé, modèle, exemples de valeurs, lignes max
src/types.ts        types partagés (aucun import Power BI : testables dans Node)
tests/test.ts       tests hors ligne
tests/live.ts       test de bout en bout avec la vraie IA
```

## Fournisseurs et modèles

| Clé | Fournisseur | Modèles essayés dans l'ordre |
|---|---|---|
| `AIza…` | Gemini | modèle du volet Format, puis `gemini-3.1-flash-lite`, `gemini-2.5-flash`, `gemini-3.5-flash` |
| `sk-…` | OpenAI | modèle du volet Format, puis `gpt-4.1-mini`, `gpt-4o-mini`, `gpt-5-mini` |

Un nom de modèle de l'autre fournisseur est ignoré. Chaque appel a un délai maximal (15 s pour Gemini, 30 s pour OpenAI). Une surcharge (503) ou un quota par minute (429) déclenche une 2e tentative sur le même modèle, puis le passage au suivant ; un modèle qui échoue deux fois est mis de côté une minute.

## Limites

- Opérations : somme, moyenne, min, max, nombre de lignes, nombre distinct ; 0 à 2 regroupements ; filtres `= != in > >= < <= entre contient` ; tri, top N, part du total.
- Les valeurs du puits *Valeurs* sont agrégées par Power BI pour chaque combinaison de *Colonnes* : mettre un identifiant de ligne pour que les comptages et moyennes portent sur les lignes d'origine.
- Le filtre du rapport et le DAX ne sont proposés que pour les colonnes simples d'une même table (pas les mesures, ni les hiérarchies de dates).
- La clé API est enregistrée dans le `.pbix`.
