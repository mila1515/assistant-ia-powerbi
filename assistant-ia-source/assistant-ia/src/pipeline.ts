"use strict";

// Les 6 étapes bout à bout. `appel` est la fonction qui parle à Gemini : on la remplace par une fausse dans les tests.

import { decrirePlan, executer, PlanError } from "./engine";
import { Message, Reponse, SYSTEME_IDEES, SYSTEME_PHRASE, SYSTEME_PLAN, SYSTEME_RAPPORT } from "./gemini";
import { verifier } from "./guard";
import { decrire } from "./schema";
import { Dataset, Plan, Resultat } from "./types";

export type Appel = (systeme: string, messages: Message[]) => Promise<Reponse>;

export interface Chiffre { label: string; valeur: string; }

export interface Tour {
    question: string;
    type: "reponse" | "impossible" | "erreur";
    titre: string;
    texte: string;
    chiffres: Chiffre[];
    suggestions: string[];
    plan?: Plan;
    resultat?: Resultat;
    verifies: number;
    nonVerifies: string[];
    appels: number;
    tokens: number;
    modele?: string;
    ms: number;
}

export type Etape = (texte: string) => void;

// Combien de valeurs différentes compte le regroupement, sous un nom que l'IA comprend
// (« Client_differents: 420 » → « 420 clients ») plutôt qu'un « groupes » technique qu'elle recopiait tel quel.
function nombreDeGroupes(r: Resultat): Record<string, number> {
    if (!r.nbCles) return {};
    const nom = r.nbCles === 1 ? `${r.colonnes[0]}_differents` : `combinaisons_${r.colonnes.slice(0, r.nbCles).join("_")}_differentes`;
    return { [nom]: r.nbGroupes };
}

// Le total des lignes du résultat (« les 10 premiers clients totalisent… ») est calculé ici :
// un modèle de langage additionne mal, et un chiffre faux serait signalé au lieu d'être juste.
function sommeDesLignes(r: Resultat, plan: Plan): { somme_des_lignes_du_resultat?: number } {
    if (!r.nbCles || (plan.operation !== "somme" && plan.operation !== "nombre_lignes")) return {};
    const s = r.lignes.reduce((acc, l) => acc + (typeof l[r.nbCles] === "number" ? l[r.nbCles] as number : 0), 0);
    return { somme_des_lignes_du_resultat: Math.round(s * 100) / 100 };
}

const AVEC_HISTORIQUE = 3;

export async function repondre(question: string, ds: Dataset, avecExemples: boolean, historique: Tour[], appel: Appel, etape: Etape = () => { /* rien */ }): Promise<Tour> {
    const t0 = Date.now();
    const tour: Tour = { question, type: "erreur", titre: "", texte: "", chiffres: [], suggestions: [], verifies: 0, nonVerifies: [], appels: 0, tokens: 0, ms: 0 };
    const compter = (r: Reponse) => { tour.appels++; tour.tokens += r.tokens; tour.modele = r.modele; return r.json; };

    // étape 2 : la structure, pas les données
    etape("Je lis la structure de tes colonnes…");
    const schema = decrire(ds, avecExemples);
    const passe = historique.filter(h => h.plan).slice(-AVEC_HISTORIQUE)
        .map(h => `- « ${h.question} » → ${JSON.stringify(h.plan)}`).join("\n");
    const messages: Message[] = [{
        role: "user",
        text: `Schéma du tableau :\n${JSON.stringify(schema)}\n\n${passe ? `Historique récent (question → plan) :\n${passe}\n\n` : ""}Question : ${question}`
    }];

    // étape 3 : Gemini choisit le calcul
    etape("L'IA choisit le calcul…");
    let plan = compter(await appel(SYSTEME_PLAN, messages)) as unknown as Plan;

    // étape 4 : on vérifie et on calcule ; une erreur repart une fois vers Gemini avec l'explication
    let exec = null;
    for (let essai = 0; essai < 2 && !exec; essai++) {
        if (plan.action === "impossible") {
            return {
                ...tour, type: "impossible", plan, ms: Date.now() - t0,
                titre: "Pas dans tes données",
                texte: String(plan.raison || "Les colonnes de ce visuel ne permettent pas de répondre."),
                suggestions: (plan.suggestions || []).slice(0, 3).map(String)
            };
        }
        etape("Je calcule sur tes données…");
        try {
            exec = executer(ds, plan);
        } catch (e) {
            if (!(e instanceof PlanError) || essai === 1) throw e;
            etape("Je corrige le calcul…");
            messages.push({ role: "model", text: JSON.stringify(plan) }, { role: "user", text: `Ce plan ne fonctionne pas : ${e.message} Renvoie un plan corrigé, ou "impossible".` });
            plan = compter(await appel(SYSTEME_PLAN, messages)) as unknown as Plan;
        }
    }
    if (!exec) throw new PlanError("Le calcul n'a pas pu être construit.");
    const { resultat } = exec;
    tour.plan = exec.plan;
    tour.resultat = resultat;

    // étape 5 : Gemini rédige à partir des quelques lignes du résultat
    etape("L'IA rédige la réponse…");
    const extrait = {
        colonnes: resultat.colonnes,
        lignes: resultat.lignes.slice(0, 30),
        total_toutes_lignes_filtrees: resultat.total,
        ...sommeDesLignes(resultat, exec.plan),
        ...nombreDeGroupes(resultat),
        ...(resultat.lignes.length > 30 || resultat.nbGroupes > resultat.lignes.length ? { note: "résultat tronqué, seules les premières lignes sont montrées" } : {})
    };
    const msgs: Message[] = [{ role: "user", text: `Question : ${question}\nCalcul exécuté : ${JSON.stringify(exec.plan)}\nRésultat : ${JSON.stringify(extrait)}` }];
    let phrase = compter(await appel(SYSTEME_PHRASE, msgs));

    // étape 6 : chaque chiffre doit venir du résultat ; sinon une réécriture, puis on signale
    for (let essai = 0; essai < 2; essai++) {
        const chiffres = (Array.isArray(phrase.chiffres) ? phrase.chiffres : []).slice(0, 4)
            .map((c: { label?: unknown; valeur?: unknown }) => ({ label: String(c?.label ?? ""), valeur: String(c?.valeur ?? "") }));
        const titre = String(phrase.titre || ""), texte = String(phrase.texte || "");
        const v = verifier([titre, texte, ...chiffres.map(c => c.valeur)], resultat, question);
        Object.assign(tour, { type: "reponse", titre, texte, chiffres, verifies: v.verifies, nonVerifies: v.nonVerifies });
        if (!v.nonVerifies.length || essai === 1) break;
        etape("Je vérifie les chiffres…");
        msgs.push({ role: "model", text: JSON.stringify(phrase) }, { role: "user", text: `Ces chiffres n'apparaissent pas dans le résultat : ${v.nonVerifies.join(", ")}. Réécris le JSON avec uniquement des chiffres du résultat.` });
        phrase = compter(await appel(SYSTEME_PHRASE, msgs));
    }
    tour.ms = Date.now() - t0;
    return tour;
}

// Trois questions de départ construites à partir des colonnes, pour ne pas commencer devant une page blanche
export function suggestions(ds: Dataset): string[] {
    const nom = (i: number) => ds.cols[i].name.replace(/^(somme|moyenne|nombre|total|minimum|maximum)\s+(de|des|d')\s*/i, "").toLowerCase();
    const idx = ds.cols.map((_, i) => i);
    // la mesure : la colonne « valeur » numérique au plus gros total (souvent le montant)
    const nums = idx.filter(i => ds.cols[i].kind === "nombre" && ds.cols[i].role === "valeur");
    const tot = (i: number) => ds.rows.reduce((s, r) => s + (typeof r[i] === "number" ? Math.abs(r[i] as number) : 0), 0);
    const num = nums.sort((a, b) => tot(b) - tot(a))[0];
    // les catégories : peu de valeurs différentes (on écarte les identifiants)
    const distinct = (i: number) => new Set(ds.rows.map(r => String(r[i]))).size;
    const cats = idx.filter(i => ds.cols[i].kind === "texte").map(i => [i, distinct(i)] as [number, number])
        .filter(([, d]) => d >= 2 && d <= 60).sort((a, b) => a[1] - b[1]).map(([i]) => i);
    const date = idx.find(i => ds.cols[i].kind === "date");
    const out: string[] = [];
    if (num !== undefined && cats[0] !== undefined) out.push(`Top 3 en ${nom(num)} par ${nom(cats[0])} ?`);
    if (num !== undefined && date !== undefined) out.push(`Comment évolue ${nom(num)} par mois ?`);
    if (num !== undefined && cats[1] !== undefined) out.push(`Quelle part de ${nom(num)} pour chaque ${nom(cats[1])} ?`);
    else if (cats[0] !== undefined) out.push(`Combien de lignes par ${nom(cats[0])} ?`);
    return out.slice(0, 3);
}

// « Propose-moi des analyses » : Gemini lit la description des colonnes (pas les lignes) et propose des questions à lancer d'un clic
export interface Idee { titre: string; question: string; pourquoi: string; }

export interface Propositions { apercu: string; idees: Idee[]; }

export async function proposer(ds: Dataset, avecExemples: boolean, appel: Appel): Promise<Propositions> {
    const schema = decrire(ds, avecExemples);
    const r = (await appel(SYSTEME_IDEES, [{ role: "user", text: `Schéma du tableau :
${JSON.stringify(schema)}` }])).json;
    const idees = (Array.isArray(r.idees) ? r.idees : [])
        .map((i: { titre?: unknown; question?: unknown; pourquoi?: unknown }) => ({ titre: String(i?.titre ?? "").trim(), question: String(i?.question ?? "").trim(), pourquoi: String(i?.pourquoi ?? "").trim() }))
        .filter((i: Idee) => i.question)
        .slice(0, 6);
    return { apercu: String(r.apercu ?? "").trim(), idees };
}

// Rapport : Gemini rédige une synthèse neutre de toutes les analyses ; chaque chiffre doit se retrouver dans l'un des résultats
export interface Synthese { synthese: string; constats: string[]; limites: string[]; nonVerifies: string[]; appels: number; }

export async function synthese(tours: Tour[], appel: Appel): Promise<Synthese> {
    const faites = tours.filter(t => t.type === "reponse" && t.resultat && t.plan);
    if (!faites.length) throw new PlanError("Aucune analyse à résumer : pose d'abord une question.");
    const analyses = faites.map(t => ({
        question: t.question,
        calcul: decrirePlan(t.plan!),
        resultat: { colonnes: t.resultat!.colonnes, lignes: t.resultat!.lignes.slice(0, 15), total: t.resultat!.total, ...sommeDesLignes(t.resultat!, t.plan!), ...nombreDeGroupes(t.resultat!) },
        reponse: t.texte
    }));
    const hors = tours.filter(t => t.type === "impossible").map(t => ({ question: t.question, raison: t.texte }));
    const msgs: Message[] = [{ role: "user", text: `Analyses :
${JSON.stringify(analyses)}${hors.length ? `

Questions hors des données :
${JSON.stringify(hors)}` : ""}` }];

    let out: Synthese = { synthese: "", constats: [], limites: [], nonVerifies: [], appels: 0 };
    for (let essai = 0; essai < 2; essai++) {
        const r = (await appel(SYSTEME_RAPPORT, msgs)).json;
        const liste = (x: unknown) => (Array.isArray(x) ? x : []).map(v => String(v ?? "").trim()).filter(Boolean);
        out = { synthese: String(r.synthese ?? "").trim(), constats: liste(r.constats).slice(0, 6), limites: liste(r.limites).slice(0, 3), nonVerifies: [], appels: out.appels + 1 };
        // un chiffre est accepté s'il est retrouvé dans au moins un des résultats
        const textes = [out.synthese, ...out.constats];
        const parResultat = faites.map(t => new Set(verifier(textes, t.resultat!, t.question).nonVerifies));
        out.nonVerifies = [...parResultat[0]].filter(n => parResultat.every(s => s.has(n)));
        if (!out.nonVerifies.length || essai === 1) break;
        msgs.push({ role: "model", text: JSON.stringify(r) }, { role: "user", text: `Ces chiffres n'apparaissent dans aucun résultat : ${out.nonVerifies.join(", ")}. Réécris le JSON avec uniquement des chiffres des résultats.` });
    }
    return out;
}
