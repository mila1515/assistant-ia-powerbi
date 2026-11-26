"use strict";

// Étapes 3 et 5 : les deux seuls échanges avec Gemini. Ce module n'envoie jamais le tableau :
// il reçoit déjà la description (étape 3) ou les quelques lignes du résultat (étape 5).

export class GeminiError extends Error { }

const URL = "https://generativelanguage.googleapis.com/v1beta/models/";
// du plus rapide au plus lent : flash-lite répond en 2 s quand 3.5-flash peut rester saturé (503)
const SECOURS = ["gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-3.5-flash"];
const ATTENTE_MAX = 15_000;

// Un modèle saturé, hors quota ou inexistant est mis de côté quelques minutes :
// les appels suivants (2 à 4 par question) ne l'attendent plus.
const ecartes = new Map<string, number>();
const ecarter = (m: string, ms: number) => ecartes.set(m, Date.now() + ms);

export interface Message { role: "user" | "model"; text: string; }

export interface Reponse { json: Record<string, unknown>; modele: string; tokens: number; }

export async function demanderGemini(cle: string, modele: string, systeme: string, messages: Message[]): Promise<Reponse> {
    if (!cle) throw new GeminiError("Ajoute ta clé API Gemini dans Format > Assistant IA.");
    const tous = [...new Set([/^gpt/i.test(modele) ? "" : modele, ...SECOURS].filter(Boolean))];
    const dispo = tous.filter(m => (ecartes.get(m) || 0) < Date.now());
    const modeles = dispo.length ? dispo : tous;
    const body = JSON.stringify({
        systemInstruction: { parts: [{ text: systeme }] },
        contents: messages.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
        generationConfig: { temperature: 0, responseMimeType: "application/json" }
    });
    let derniere = "", retenter = false;
    const essais: string[] = [];
    // une surcharge (503) ou un quota par minute (429) est souvent passager : une 2e tentative sur le même modèle avant de changer
    for (const m of modeles) essais.push(m, m);
    for (let k = 0; k < essais.length; k++) {
        const m = essais[k];
        if (k % 2 === 1) {
            if (!retenter) continue;   // le 1er essai a échoué pour une raison durable (modèle absent, délai dépassé…)
            await new Promise(ok => setTimeout(ok, 1200));
        }
        retenter = false;
        let r: Response;
        const stop = new AbortController();
        const minuteur = setTimeout(() => stop.abort(), ATTENTE_MAX);
        try {
            r = await fetch(URL + encodeURIComponent(m) + ":generateContent", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": cle },
                body,
                signal: stop.signal
            });
        } catch (e) {
            if (stop.signal.aborted) {
                derniere = `Gemini (${m}) met trop de temps à répondre.`;
                if (k % 2 === 0) retenter = true; else ecarter(m, 60_000);
            } else derniere = "Impossible de joindre Gemini (réseau, ou adresse bloquée par ton organisation).";
            continue;
        } finally {
            clearTimeout(minuteur);
        }
        if (r.status === 400 || r.status === 401 || r.status === 403) {
            const t = await r.text();
            if (/API key|API_KEY|permission/i.test(t)) throw new GeminiError("Ta clé API Gemini est refusée. Vérifie-la dans Format > Assistant IA.");
            throw new GeminiError(`Gemini a refusé la demande (${r.status}).`);
        }
        if (r.status === 404) { derniere = `Le modèle « ${m} » n'existe pas.`; ecarter(m, 60 * 60_000); continue; }
        if (!r.ok) {
            derniere = r.status === 429 ? "Quota Gemini atteint. Attends une minute ou change de modèle."
                : r.status === 503 ? "Gemini est surchargé (503). Réessaie dans un instant." : `Gemini a répondu ${r.status}.`;
            if (k % 2 === 0) retenter = true;   // on retente une fois ce modèle
            else ecarter(m, 60_000);            // deux échecs : on le laisse de côté une minute
            continue;
        }
        const data = await r.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const texte = parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || "").join("");
        return { json: lireJson(texte), modele: m, tokens: data?.usageMetadata?.totalTokenCount || 0 };
    }
    throw new GeminiError(derniere || "Gemini n'a pas répondu.");
}

export function lireJson(texte: string): Record<string, unknown> {
    const t = texte.replace(/^```(?:json)?|```$/gm, "").trim();
    const i = t.indexOf("{"), j = t.lastIndexOf("}");
    if (i >= 0 && j > i) {
        try { return JSON.parse(t.slice(i, j + 1)); } catch { /* on tombe sur l'erreur ci-dessous */ }
    }
    throw new GeminiError("La réponse de Gemini n'était pas du JSON lisible.");
}

export const SYSTEME_PLAN = `Tu es le moteur de requête d'un assistant intégré à un rapport Power BI.
Tu ne vois PAS les données, seulement la description de leurs colonnes. Ton seul travail : traduire la question en un plan de calcul JSON que le rapport exécutera lui-même.

Réponds par un seul objet JSON, rien d'autre :
{"action":"calcul","operation":"somme|moyenne|min|max|nombre_lignes|nombre_distinct","mesure":"<nom exact d'une colonne>","par":[{"colonne":"<nom exact>","periode":"annee|trimestre|mois|jour"}],"filtres":[{"colonne":"<nom exact>","op":"=|!=|in|>|>=|<|<=|entre|contient","valeur":<valeur>,"valeurs":[<valeurs>],"periode":"annee|trimestre|mois|jour"}],"tri":"desc|asc|chrono","limite":<entier>,"part_du_total":true}
ou bien :
{"action":"impossible","raison":"<pourquoi, en une phrase>","suggestions":["<question faisable>","<question faisable>"]}

Règles :
1. Recopie exactement les noms de colonnes du schéma. N'invente jamais une colonne.
2. "mesure" doit être de type "nombre" pour somme, moyenne, min et max. Pour compter des lignes : nombre_lignes, sans mesure. Pour compter des éléments différents (clients, produits) : nombre_distinct avec la colonne concernée.
3. "par" : 0 à 2 regroupements. "periode" seulement sur une colonne de type "date".
4. Filtres texte : écris les valeurs comme dans "exemples". Une année sur une colonne date : {"colonne":"Date","op":"=","periode":"annee","valeur":2025}. Une plage de dates : "op":"entre","valeurs":["2025-01-01","2025-06-30"].
5. Évolution dans le temps : regroupe par période, tri "chrono". Comparer deux années : filtre "in" sur les deux années (periode annee) et regroupe par année.
6. « Qui est premier », « le top » : tri "desc" et limite. « Le moins » : tri "asc".
7. Part ou pourcentage du total : "part_du_total": true (avec somme ou nombre_lignes) et un regroupement.
8. Question de suivi (« et en 2024 ? », « et pour le Sud ? ») : repars du dernier plan de l'historique et change seulement ce qui change.
9. Si la question demande une information absente du schéma (colonne inexistante, prévision du futur, cause, opinion, données externes), réponds "impossible". Ne remplace jamais par une colonne proche.
10. Omets les champs inutiles.`;

export const SYSTEME_PHRASE = `Tu es l'analyste d'un rapport Power BI. On te donne une question, le calcul exécuté et son résultat exact.
Rédige la réponse en français, comme un analyste qui briefe son manager : la réponse d'abord, puis 1 ou 2 chiffres qui l'expliquent.

Règles :
1. Chaque chiffre écrit doit venir du résultat, ou être un écart, un ratio ou un pourcentage calculé à partir de deux valeurs du résultat. Aucune connaissance extérieure.
2. Format français : virgule décimale, espace pour les milliers, « k » pour milliers, « M » pour millions, « % » précédé d'une espace. Arrondis raisonnablement.
3. Si le résultat est vide, dis-le simplement.
4. N'explique pas les causes : les données ne les contiennent pas.
5. Réponds par un seul objet JSON : {"titre":"<10 mots max>","texte":"<60 mots max>","chiffres":[{"label":"<court>","valeur":"<chiffre formaté>"}]} avec 2 ou 3 chiffres.`;

export const SYSTEME_IDEES = `Tu es l'analyste d'un rapport Power BI. On te donne la description des colonnes d'un tableau (noms, types, nombre de valeurs distinctes, exemples, min et max), jamais ses lignes.
Ton travail : dire en une ou deux phrases ce que contient ce tableau, puis proposer 5 analyses utiles que l'utilisateur pourra lancer d'un clic.

Les analyses doivent être faisables avec ces seules opérations : somme, moyenne, min, max, nombre de lignes, nombre distinct ; 0 à 2 regroupements ; filtres ; classement et top N ; part du total ; regroupement par année, trimestre, mois ou jour sur une colonne date.
Pas de prévision, de corrélation, de médiane, d'écart-type ni d'explication des causes.

Règles :
1. Varie les angles : un classement, une évolution dans le temps (s'il y a une date), une répartition en part du total, une comparaison entre deux catégories ou deux périodes, un comptage.
2. Appuie-toi sur les vraies colonnes et les vraies valeurs d'exemple. Écris les questions en français naturel, comme les poserait un utilisateur.
3. Une colonne qui a presque autant de valeurs distinctes que de lignes est un identifiant : ne regroupe jamais dessus, compte-la.
4. Les colonnes de rôle « valeur agrégée » sont les nombres à additionner ou à moyenner.

Réponds par un seul objet JSON :
{"apercu":"<1 ou 2 phrases sur le contenu du tableau>","idees":[{"titre":"<5 mots max>","question":"<question complète>","pourquoi":"<ce que ça apprend, 15 mots max>"}]}`;

export const SYSTEME_RAPPORT = `Tu rédiges la synthèse d'un rapport d'analyse, à partir d'analyses déjà faites sur un rapport Power BI.
Pour chaque analyse, on te donne la question, le calcul exécuté, son résultat exact et la réponse déjà vérifiée.

Ton style est neutre et factuel : tu constates ce que montrent les résultats.
- Pas de jugement (pas de « excellent », « mauvais », « inquiétant », « performant »).
- Pas de recommandation, pas de conseil.
- Pas d'explication des causes : les données ne les contiennent pas.
- Si les résultats ne permettent pas de conclure sur un point, dis-le.

Règles :
1. Chaque chiffre écrit doit venir d'un résultat fourni, ou être un écart, un ratio ou un pourcentage calculé entre deux valeurs d'un même résultat.
2. Format français : virgule décimale, espace pour les milliers, « k » pour milliers, « M » pour millions, « % » précédé d'une espace.
3. Les constats doivent couvrir les différentes analyses, sans répéter mot pour mot les réponses.
4. Les limites portent sur la portée des données (filtres, colonnes disponibles, période couverte), pas sur la méthode.

Réponds par un seul objet JSON :
{"synthese":"<3 à 5 phrases>","constats":["<1 phrase factuelle avec un chiffre>"],"limites":["<1 phrase>"]}
Donne 3 à 6 constats et 1 à 3 limites.`;
