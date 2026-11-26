"use strict";

// Traduit le plan de calcul (déjà validé et exécuté par le visuel) en DAX, sans IA :
// une requête pour la vue Requête DAX de Power BI Desktop, et une mesure à ajouter au modèle.
// Aucun import Power BI ni DOM : le module se teste dans Node.

import { enDate, estVrai, trouverColonne } from "./engine";
import { iso } from "./schema";
import { Col, Dataset, Filtre, Periode, Plan, Resultat } from "./types";

export interface CodeDax { requete: string; mesures: { nom: string; code: string }[]; notes: string[]; }

export class DaxIndisponible extends Error { }

const nomTable = (t: string) => `'${t.replace(/'/g, "''")}'`;
const texte = (s: unknown) => `"${String(s).replace(/"/g, "\"\"")}"`;
const nomExt = (s: string) => `[${s.replace(/\]/g, "]]")}]`;           // colonne ajoutée dans la requête
const nomMesure = (s: string) => s.replace(/[[\]]/g, "").trim();

function ref(c: Col): string {
    if (!c.cible) throw new DaxIndisponible(`« ${c.name} » n'est pas une colonne simple du modèle (mesure, hiérarchie ou champ calculé) : le DAX ne peut pas être généré.`);
    return `${nomTable(c.cible.table)}[${c.cible.colonne.replace(/\]/g, "]]")}]`;
}

// même découpage que le visuel : 2025 · 2025-T1 · 2025-03 · 2025-03-14
function expPeriode(r: string, p: Periode): string {
    if (p === "annee") return `YEAR(${r})`;
    if (p === "trimestre") return `YEAR(${r}) & "-T" & QUARTER(${r})`;
    if (p === "mois") return `FORMAT(${r}, "yyyy-mm")`;
    return `FORMAT(${r}, "yyyy-mm-dd")`;
}

function dateDax(v: unknown, col: Col): string {
    const d = enDate(v);
    if (!d) throw new DaxIndisponible(`« ${String(v)} » n'est pas une date valide pour « ${col.name} ».`);
    return `DATE(${d.getFullYear()}, ${d.getMonth() + 1}, ${d.getDate()})`;
}

const OPS: Record<string, string> = { "=": "=", "!=": "<>", ">": ">", ">=": ">=", "<": "<", "<=": "<=" };

// un filtre du plan → une condition DAX sur une seule colonne
function predicat(ds: Dataset, f: Filtre): { col: Col; exp: string } {
    const col = ds.cols[trouverColonne(ds, f.colonne)];
    const r = ref(col);
    const op = f.op;
    const brutes: unknown[] = op === "in" || op === "entre" ? (f.valeurs ?? (Array.isArray(f.valeur) ? f.valeur : [f.valeur])) : [f.valeur];
    const compare = (e: string, lits: string[]) => {
        if (op === "in") return `${e} IN { ${lits.join(", ")} }`;
        if (op === "entre") return `${e} >= ${lits[0]} && ${e} <= ${lits[1]}`;
        if (!OPS[op]) throw new DaxIndisponible(`Le filtre « ${op} » n'a pas d'équivalent DAX simple.`);
        return `${e} ${OPS[op]} ${lits[0]}`;
    };

    if (col.kind === "date") {
        let p = f.periode || null;
        if (!p && (op === "=" || op === "!=" || op === "in")) {
            const s = String(brutes[0]);
            if (/^\d{4}$/.test(s)) p = "annee";
            else if (/^\d{4}-\d{2}$/.test(s)) p = "mois";
        }
        if (p === "annee") return { col, exp: compare(`YEAR(${r})`, brutes.map(v => String(Number(String(v).trim().slice(0, 4))))) };
        if (p) {
            const lits = brutes.map(v => {
                const s = String(v).trim();
                if (p === "trimestre") return texte(s.toUpperCase().replace(/^(\d{4})\D*T?Q?(\d)$/, "$1-T$2"));
                const d = enDate(s);
                if (!d) throw new DaxIndisponible(`« ${s} » n'est pas une date valide pour « ${col.name} ».`);
                return texte(p === "mois" ? iso(d).slice(0, 7) : iso(d));
            });
            return { col, exp: compare(expPeriode(r, p), lits) };
        }
        const lits = brutes.map(v => dateDax(v, col));
        if (op === "entre") return { col, exp: `${r} >= ${lits[0]} && ${r} < ${lits[1]} + 1` };   // le dernier jour est inclus
        return { col, exp: compare(r, lits) };
    }
    if (col.kind === "nombre") {
        const lits = brutes.map(v => {
            const n = Number(String(v).replace(/[\s  ]/g, "").replace(",", "."));
            if (!isFinite(n)) throw new DaxIndisponible(`« ${String(v)} » n'est pas un nombre pour « ${col.name} ».`);
            return String(n);
        });
        return { col, exp: compare(r, lits) };
    }
    if (col.kind === "booleen") {
        const lits = brutes.map(v => estVrai(v) ? "TRUE()" : "FALSE()");
        return { col, exp: compare(r, lits) };
    }
    if (op === "contient") return { col, exp: `CONTAINSSTRING(${r}, ${texte(brutes[0])})` };
    return { col, exp: compare(r, brutes.map(texte)) };
}

export function versDax(ds: Dataset, plan: Plan, res: Resultat): CodeDax {
    if (plan.action !== "calcul" || !plan.operation) throw new DaxIndisponible("Pas de calcul à traduire.");
    const op = plan.operation;
    const mesure = plan.mesure ? ds.cols[trouverColonne(ds, plan.mesure)] : null;
    const par = (plan.par || []).map(g => ({ col: ds.cols[trouverColonne(ds, g.colonne)], p: g.periode || null }));
    const filtres = (plan.filtres || []).map(f => predicat(ds, f));

    // toutes les colonnes doivent venir de la même table
    const utilisees = [...(mesure ? [mesure] : []), ...par.map(g => g.col), ...filtres.map(f => f.col)];
    utilisees.forEach(ref);
    const avecCible = utilisees.length ? utilisees : ds.cols.filter(c => c.cible);
    const tables = [...new Set(avecCible.map(c => c.cible!.table))];
    if (!tables.length) throw new DaxIndisponible("Aucune colonne simple du modèle dans le visuel : le DAX ne peut pas être généré.");
    if (tables.length > 1) throw new DaxIndisponible(`Les colonnes viennent de plusieurs tables (${tables.join(", ")}) : le DAX n'est généré que pour une seule table.`);
    const T = nomTable(tables[0]);
    const m = mesure ? ref(mesure) : "";

    // noms lisibles d'après les vraies colonnes du modèle (« Somme de Montant », « Date (mois) »)
    const LIB: Record<string, string> = { somme: "Somme de", moyenne: "Moyenne de", min: "Minimum de", max: "Maximum de", nombre_distinct: "Nombre distinct de" };
    const PER: Record<string, string> = { annee: "année", trimestre: "trimestre", mois: "mois", jour: "jour" };
    const nomValeur = op === "nombre_lignes" ? "Nombre de lignes" : `${LIB[op]} ${mesure!.cible!.colonne}`;
    const nomsCles = par.map(g => g.p ? `${g.col.cible!.colonne} (${PER[g.p]})` : g.col.cible!.colonne);

    // agrégat sur une table de lignes (requête), et version CURRENTGROUP() pour GROUPBY
    const surTable = (x: string) => {
        switch (op) {
            case "somme": return `SUMX(${x}, ${m})`;
            case "moyenne": return `AVERAGEX(${x}, ${m})`;
            case "min": return `MINX(${x}, ${m})`;
            case "max": return `MAXX(${x}, ${m})`;
            case "nombre_lignes": return `COUNTROWS(${x})`;
            case "nombre_distinct": return `COUNTROWS(FILTER(DISTINCT(SELECTCOLUMNS(${x}, "@v", ${m})), NOT ISBLANK([@v])))`;
        }
    };
    const surGroupe = () => {
        switch (op) {
            case "somme": return `SUMX(CURRENTGROUP(), ${m})`;
            case "moyenne": return `AVERAGEX(CURRENTGROUP(), ${m})`;
            case "min": return `MINX(CURRENTGROUP(), ${m})`;
            case "max": return `MAXX(CURRENTGROUP(), ${m})`;
            default: return "COUNTX(CURRENTGROUP(), 1)";
        }
    };

    // agrégat simple pour une mesure (et pour une requête sans regroupement ni filtre)
    const agg = (() => {
        switch (op) {
            case "somme": return `SUM(${m})`;
            case "moyenne": return `AVERAGE(${m})`;
            case "min": return `MIN(${m})`;
            case "max": return `MAX(${m})`;
            case "nombre_lignes": return `COUNTROWS(${T})`;
            case "nombre_distinct": return `DISTINCTCOUNTNOBLANK(${m})`;
        }
    })();

    // ---------- requête : autonome, sans commentaire ; une seule instruction quand c'est possible ----------
    let requete: string;
    if (!par.length) {
        const lignes = filtres.length ? `FILTER(${T}, ${filtres.map(f => f.exp).join(" && ")})` : "";
        requete = `EVALUATE ROW(${texte(nomValeur)}, ${lignes ? surTable(lignes) : agg})`;
    } else {
        const L: string[] = ["DEFINE"];
        L.push(filtres.length
            ? `    VAR lignes = FILTER(${T},\n        ${filtres.map(f => f.exp).join("\n        && ")}\n    )`
            : `    VAR lignes = ${T}`);
        const ajouts = par.map((g, k) => g.p ? `${texte(nomsCles[k])}, ${expPeriode(ref(g.col), g.p)}` : "").filter(Boolean);
        let base = "lignes";
        if (op === "nombre_distinct") {
            L.push(`    VAR utiles = FILTER(lignes, NOT ISBLANK(${m}))`);
            base = "utiles";
        }
        if (ajouts.length) {
            L.push(`    VAR base = ADDCOLUMNS(${base}, ${ajouts.join(", ")})`);
            base = "base";
        }
        const cles = par.map((g, k) => g.p ? nomExt(nomsCles[k]) : ref(g.col));
        if (op === "nombre_distinct") {
            // d'abord les couples (regroupement, valeur) distincts, puis on les compte
            L.push(`    VAR couples = GROUPBY(${base}, ${[...cles, m].join(", ")})`);
            L.push(`    VAR groupes = GROUPBY(couples, ${cles.join(", ")}, ${texte(nomValeur)}, COUNTX(CURRENTGROUP(), 1))`);
        } else {
            L.push(`    VAR groupes = GROUPBY(${base}, ${cles.join(", ")}, ${texte(nomValeur)}, ${surGroupe()})`);
        }
        let final = "groupes";
        if (res.avecPart) {
            L.push(`    VAR total = ${surTable("lignes")}`);
            L.push(`    VAR avecPart = ADDCOLUMNS(groupes, "Part du total", DIVIDE(${nomExt(nomValeur)}, total))`);
            final = "avecPart";
        }
        const tri = plan.tri || (par[0].p ? "chrono" : "desc");
        if (plan.limite && tri !== "chrono") final = `TOPN(${plan.limite}, ${final}, ${nomExt(nomValeur)}, ${tri === "asc" ? "ASC" : "DESC"})`;
        L.push("EVALUATE", `    ${final}`);
        L.push(tri === "chrono" ? `ORDER BY ${cles.map(c => `${c} ASC`).join(", ")}` : `ORDER BY ${nomExt(nomValeur)} ${tri === "asc" ? "ASC" : "DESC"}`);
        requete = L.join("\n");
    }

    // ---------- mesures : une par zone, qui commence par son nom (un commentaire en tête casse « Nouvelle mesure ») ----------
    const calc = filtres.length
        ? `CALCULATE(\n    ${agg},\n    ${filtres.map(f => `FILTER(ALL(${ref(f.col)}), ${f.exp})`).join(",\n    ")}\n)`
        : agg;
    const nom = nomMesure(nomValeur + (filtres.length ? " (filtré)" : ""));
    const mesures = [{ nom, code: `${nom} =\n${calc}` }];
    const g0 = par[0];
    if (res.avecPart && g0 && !g0.p) {
        const nomPart = `Part de ${nom}`;
        mesures.push({ nom: nomPart, code: `${nomPart} =\nDIVIDE([${nom}], CALCULATE([${nom}], ALLSELECTED(${ref(g0.col)})))` });
    }

    const notes = [
        "La requête ignore les segments et filtres du rapport. Mêmes chiffres que l'assistant si l'identifiant de ligne est dans « Colonnes ».",
        ...(par.length ? [`Pour la mesure : place ${par.map(g => g.p ? `« ${g.col.name} » (${PER[g.p]})` : `« ${g.col.name} »`).join(" et ")} en axe d'un graphique pour retrouver le regroupement.`] : []),
        ...(mesures.length > 1 ? [`Crée d'abord « ${nom} », puis « Part de ${nom} » qui l'utilise.`] : [])
    ];
    return { requete, mesures, notes };
}
