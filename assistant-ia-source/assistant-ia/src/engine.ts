"use strict";

// Étape 4 : vérifier le plan de Gemini contre le vrai tableau, puis faire le calcul ici, dans le visuel.
// Une colonne ou une valeur qui n'existe pas lève une PlanError : on ne devine jamais à la place de l'utilisateur.

import { cle, iso, norm } from "./schema";
import { Cell, Col, Dataset, Filtre, Operation, Out, Periode, Plan, Resultat } from "./types";

export class PlanError extends Error { }

const OPS: Operation[] = ["somme", "moyenne", "min", "max", "nombre_lignes", "nombre_distinct"];
const PERIODES: Periode[] = ["annee", "trimestre", "mois", "jour"];
const LIB_OP: Record<Operation, string> = {
    somme: "Somme de", moyenne: "Moyenne de", min: "Minimum de", max: "Maximum de",
    nombre_lignes: "Nombre de lignes", nombre_distinct: "Nombre distinct de"
};
// « Somme de » + « Somme de Montant » donnerait « Somme de Somme de Montant » : on évite le doublon
function libelle(op: Operation, mesure: string): string {
    if (op === "somme" && /^(somme|total)\b/i.test(mesure)) return mesure;
    return `${LIB_OP[op]} ${mesure}`;
}
const LIB_PER: Record<Periode, string> = { annee: "année", trimestre: "trimestre", mois: "mois", jour: "jour" };

function liste(ds: Dataset): string {
    return ds.cols.map(c => `« ${c.name} »`).join(", ");
}

export function trouverColonne(ds: Dataset, nom: unknown): number {
    const n = norm(nom);
    if (!n) throw new PlanError("Une colonne n'a pas de nom dans le plan.");
    let i = ds.cols.findIndex(c => norm(c.name) === n);
    if (i >= 0) return i;
    // « Somme de Montant » -> « Montant », et l'inverse
    const proches = ds.cols.map((c, k) => [norm(c.name), k] as [string, number])
        .filter(([cn]) => cn.endsWith(" " + n) || n.endsWith(" " + cn) || cn.startsWith(n + " "));
    if (proches.length === 1) return proches[0][1];
    throw new PlanError(`La colonne « ${String(nom)} » n'existe pas. Colonnes disponibles : ${liste(ds)}.`);
}

export function enDate(v: unknown): Date | null {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === "number" || typeof v === "string") {
        const s = String(v).trim();
        if (/^\d{4}$/.test(s)) return new Date(Number(s), 0, 1);
        if (/^\d{4}-\d{2}$/.test(s)) return new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, 1);
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function bucket(v: Cell, p: Periode): string | null {
    const d = enDate(v);
    if (!d) return null;
    const y = d.getFullYear(), m = d.getMonth();
    if (p === "annee") return String(y);
    if (p === "trimestre") return `${y}-T${Math.floor(m / 3) + 1}`;
    if (p === "mois") return `${y}-${String(m + 1).padStart(2, "0")}`;
    return iso(d);
}

function periodeValide(p: unknown): Periode | null {
    return PERIODES.includes(p as Periode) ? (p as Periode) : null;
}

function enNombre(v: unknown): number | null {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
        const t = v.replace(/[\s  ]/g, "").replace(",", ".");
        const n = Number(t);
        return t !== "" && isFinite(n) ? n : null;
    }
    return null;
}

// « vrai », « oui », « 1 »… pour un filtre sur une colonne oui/non
export function estVrai(v: unknown): boolean {
    return ["true", "vrai", "oui", "1", "yes"].includes(norm(v));
}

// les valeurs texte de la colonne, pour remplacer « nord » par « Nord » ou refuser « Nordd »
function valeursTexte(ds: Dataset, i: number): Map<string, string> {
    const m = new Map<string, string>();
    for (const r of ds.rows) {
        const k = cle(r[i]);
        if (!m.has(norm(k))) m.set(norm(k), k);
    }
    return m;
}

function resoudreTexte(ds: Dataset, i: number, v: unknown, cache: Map<number, Map<string, string>>): string {
    if (!cache.has(i)) cache.set(i, valeursTexte(ds, i));
    const m = cache.get(i)!;
    const n = norm(v);
    if (m.has(n)) return m.get(n)!;
    const proches = [...m.entries()].filter(([k]) => k.includes(n) || (k.length > 2 && n.includes(k)));
    if (proches.length === 1) return proches[0][1];
    const ex = [...m.values()].slice(0, 12).map(x => `« ${x} »`).join(", ");
    throw new PlanError(`La valeur « ${String(v)} » n'existe pas dans « ${ds.cols[i].name} ». Valeurs possibles : ${ex}${m.size > 12 ? "…" : ""}.`);
}

type Test = (row: Cell[]) => boolean;

function compiler(ds: Dataset, f: Filtre, cache: Map<number, Map<string, string>>): Test {
    const i = trouverColonne(ds, f.colonne);
    const col: Col = ds.cols[i];
    const op = f.op;
    const brutes: unknown[] = op === "in" || op === "entre" ? (f.valeurs ?? (Array.isArray(f.valeur) ? f.valeur : [f.valeur])) : [f.valeur];
    if (!brutes.length || brutes.some(v => v === undefined)) throw new PlanError(`Le filtre sur « ${col.name} » n'a pas de valeur.`);
    if (op === "entre" && brutes.length !== 2) throw new PlanError(`Le filtre « entre » sur « ${col.name} » demande exactement deux valeurs.`);

    if (col.kind === "date") {
        let p = periodeValide(f.periode);
        // « = 2025 » ou « = 2025-03 » sur une date : on comprend l'année ou le mois
        if (!p && (op === "=" || op === "!=" || op === "in")) {
            const s = String(brutes[0]);
            if (/^\d{4}$/.test(s)) p = "annee";
            else if (/^\d{4}-\d{2}$/.test(s)) p = "mois";
        }
        if (p) {
            const per = p;
            const cibles = brutes.map(v => {
                const s = String(v).trim();
                if (per === "annee") return s.slice(0, 4);
                if (per === "trimestre") return s.toUpperCase().replace(/^(\d{4})\D*T?Q?(\d)$/, "$1-T$2");
                const b = bucket(s, per);
                if (!b) throw new PlanError(`« ${s} » n'est pas une date valide pour « ${col.name} ».`);
                return b;
            });
            return row => {
                const b = bucket(row[i], per);
                if (b === null) return false;
                return cmp(b, cibles, op, (a, c) => a.localeCompare(c));
            };
        }
        const cibles = brutes.map(v => {
            const d = enDate(v);
            if (!d) throw new PlanError(`« ${String(v)} » n'est pas une date valide pour « ${col.name} ».`);
            return d.getTime();
        });
        if (op === "entre") cibles[1] = cibles[1] + 86399999; // « jusqu'au 30 juin » inclut le 30 juin
        return row => {
            const d = enDate(row[i]);
            return d !== null && cmp(d.getTime(), cibles, op, (a, c) => a - c);
        };
    }

    if (col.kind === "nombre") {
        const cibles = brutes.map(v => {
            const n = enNombre(v);
            if (n === null) throw new PlanError(`« ${String(v)} » n'est pas un nombre pour « ${col.name} ».`);
            return n;
        });
        return row => typeof row[i] === "number" && cmp(row[i] as number, cibles, op, (a, c) => a - c);
    }

    if (col.kind === "booleen") {
        const cibles = brutes.map(estVrai);
        return row => {
            const b = row[i] === true;
            return op === "!=" ? b !== cibles[0] : cibles.includes(b);
        };
    }

    if (op === "contient") {
        const n = norm(brutes[0]);
        return row => norm(row[i]).includes(n);
    }
    if ([">", ">=", "<", "<=", "entre"].includes(op)) {
        const cibles = brutes.map(v => String(v));
        return row => row[i] !== null && cmp(String(row[i]), cibles, op, (a, c) => a.localeCompare(c, "fr"));
    }
    const cibles = new Set(brutes.map(v => resoudreTexte(ds, i, v, cache)));
    return row => (op === "!=") !== cibles.has(cle(row[i]));
}

function cmp<T>(a: T, c: T[], op: string, f: (x: T, y: T) => number): boolean {
    switch (op) {
        case "=": return f(a, c[0]) === 0;
        case "!=": return f(a, c[0]) !== 0;
        case "in": return c.some(x => f(a, x) === 0);
        case ">": return f(a, c[0]) > 0;
        case ">=": return f(a, c[0]) >= 0;
        case "<": return f(a, c[0]) < 0;
        case "<=": return f(a, c[0]) <= 0;
        case "entre": return f(a, c[0]) >= 0 && f(a, c[1]) <= 0;
        default: throw new PlanError(`Opérateur de filtre inconnu « ${op} ».`);
    }
}

class Acc {
    sum = 0; n = 0; rows = 0; min = Infinity; max = -Infinity; set = new Set<string>();
    add(v: Cell, op: Operation) {
        this.rows++;
        if (op === "nombre_distinct") { if (v !== null && v !== undefined) this.set.add(cle(v)); return; }
        if (typeof v === "number" && isFinite(v)) {
            this.sum += v; this.n++;
            if (v < this.min) this.min = v;
            if (v > this.max) this.max = v;
        }
    }
    value(op: Operation): number | null {
        switch (op) {
            case "nombre_lignes": return this.rows;
            case "nombre_distinct": return this.set.size;
            case "somme": return this.n ? this.sum : null;
            case "moyenne": return this.n ? this.sum / this.n : null;
            case "min": return this.n ? this.min : null;
            case "max": return this.n ? this.max : null;
        }
    }
}

export interface Execution {
    plan: Plan;          // le plan nettoyé (noms de colonnes exacts)
    resultat: Resultat;
}

export function executer(ds: Dataset, brut: Plan): Execution {
    if (!ds.rows.length) throw new PlanError("Le tableau est vide avec les filtres actuels du rapport.");
    const op = (brut.operation || "somme") as Operation;
    if (!OPS.includes(op)) throw new PlanError(`Opération inconnue « ${op} ». Utilise : ${OPS.join(", ")}.`);

    let mi = -1;
    if (op !== "nombre_lignes") {
        if (!brut.mesure) throw new PlanError(`L'opération « ${op} » demande une colonne « mesure ».`);
        mi = trouverColonne(ds, brut.mesure);
        if (op !== "nombre_distinct" && ds.cols[mi].kind !== "nombre") {
            throw new PlanError(`« ${ds.cols[mi].name} » n'est pas une colonne de nombres : utilise nombre_distinct ou une autre mesure.`);
        }
    }

    const par = (brut.par || []).slice(0, 2).map(g => {
        const i = trouverColonne(ds, g.colonne);
        let p = periodeValide(g.periode);
        if (ds.cols[i].kind !== "date") p = null;
        else if (!p) p = "jour";
        return { i, p };
    });

    const cache = new Map<number, Map<string, string>>();
    const tests = (brut.filtres || []).map(f => compiler(ds, f, cache));
    const lignes = ds.rows.filter(r => tests.every(t => t(r)));

    const groupes = new Map<string, { cles: Out[]; acc: Acc }>();
    const tout = new Acc();
    for (const r of lignes) {
        const v = mi >= 0 ? r[mi] : null;
        tout.add(v, op);
        const cles: Out[] = par.map(g => {
            if (g.p) return bucket(r[g.i], g.p);
            const x = r[g.i];
            return x === null || x === undefined ? "(vide)" : typeof x === "number" ? x : cle(x);
        });
        const k = JSON.stringify(cles);
        let g = groupes.get(k);
        if (!g) { g = { cles, acc: new Acc() }; groupes.set(k, g); }
        g.acc.add(v, op);
    }

    const total = tout.value(op);
    const avecPart = !!brut.part_du_total && par.length > 0 && (op === "somme" || op === "nombre_lignes" || op === "nombre_distinct") && !!total;
    let rows = [...groupes.values()].map(g => {
        const v = g.acc.value(op);
        const out: Out[] = [...g.cles, v === null ? null : arrondi(v)];
        if (avecPart) out.push(v === null || !total ? null : arrondi(v / total, 4));
        return out;
    });

    const temporel = par.length > 0 && !!par[0].p;
    const tri = brut.tri || (temporel ? "chrono" : "desc");
    const vi = par.length;
    if (tri === "chrono") rows.sort((a, b) => compareCles(a.slice(0, vi), b.slice(0, vi)));
    else rows.sort((a, b) => ((tri === "asc" ? 1 : -1) * (((a[vi] as number) ?? -Infinity) - ((b[vi] as number) ?? -Infinity))));
    const nbGroupes = rows.length;
    const limite = Math.max(1, Math.min(Number(brut.limite) || 100, 500));
    rows = rows.slice(0, limite);

    const lib = (k: number) => ds.cols[k].name;
    const colonnes = [
        ...par.map(g => g.p ? `${lib(g.i)} (${LIB_PER[g.p]})` : lib(g.i)),
        op === "nombre_lignes" ? LIB_OP[op] : libelle(op, lib(mi)),
        ...(avecPart ? ["Part du total"] : [])
    ];

    const plan: Plan = {
        action: "calcul", operation: op,
        ...(mi >= 0 ? { mesure: lib(mi) } : {}),
        ...(par.length ? { par: par.map(g => ({ colonne: lib(g.i), ...(g.p ? { periode: g.p } : {}) })) } : {}),
        ...(brut.filtres?.length ? { filtres: brut.filtres.map(f => ({ ...f, colonne: lib(trouverColonne(ds, f.colonne)) })) } : {}),
        tri, ...(brut.limite ? { limite } : {}), ...(avecPart ? { part_du_total: true } : {})
    };
    return {
        plan,
        resultat: { colonnes, lignes: rows, nbCles: par.length, total: total === null ? null : arrondi(total), nbLignesSource: lignes.length, nbGroupes, temporel, avecPart }
    };
}

function compareCles(a: Out[], b: Out[]): number {
    for (let k = 0; k < a.length; k++) {
        const x = a[k], y = b[k];
        if (x === y) continue;
        if (typeof x === "number" && typeof y === "number") return x - y;
        return String(x).localeCompare(String(y), "fr", { numeric: true });
    }
    return 0;
}

function arrondi(v: number, d = 6): number {
    const f = Math.pow(10, d);
    return Math.round(v * f) / f;
}

// Le plan en une phrase, pour « Voir le calcul »
export function decrirePlan(p: Plan): string {
    if (p.action !== "calcul") return "Aucun calcul : la question ne correspond pas aux colonnes.";
    const op = p.operation as Operation;
    const parts = [op === "nombre_lignes" ? "Nombre de lignes" : (op === "somme" && /^(somme|total)\b/i.test(String(p.mesure)) ? `« ${p.mesure} »` : `${LIB_OP[op]} « ${p.mesure} »`)];
    if (p.par?.length) parts.push("par " + p.par.map(g => `« ${g.colonne} »${g.periode ? ` (${LIB_PER[g.periode]})` : ""}`).join(" et "));
    if (p.filtres?.length) {
        parts.push("où " + p.filtres.map(f => {
            const v = f.op === "in" || f.op === "entre" ? (f.valeurs || []).join(f.op === "entre" ? " et " : ", ") : String(f.valeur);
            const per = f.periode ? ` (${LIB_PER[f.periode]})` : "";
            return `« ${f.colonne} »${per} ${f.op === "in" ? "parmi" : f.op} ${v}`;
        }).join(" et "));
    }
    if (p.tri === "desc") parts.push("du plus grand au plus petit");
    else if (p.tri === "asc") parts.push("du plus petit au plus grand");
    else if (p.tri === "chrono") parts.push("dans l'ordre chronologique");
    if (p.limite) parts.push(`${p.limite} premiers`);
    if (p.part_du_total) parts.push("avec la part du total");
    return parts.join(", ") + ".";
}
