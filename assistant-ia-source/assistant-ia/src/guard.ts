"use strict";

// Étape 6 : chaque chiffre écrit par Gemini doit se retrouver dans le résultat du calcul.
// Un chiffre est « vérifié » s'il vaut une valeur du résultat, ou un écart, un ratio, un pourcentage
// ou une somme de deux valeurs, à l'arrondi affiché près. Les années et les petits entiers sont ignorés.

import { Resultat } from "./types";

export interface Nombre { brut: string; v: number; tol: number; pct: boolean; }

// 1 240 000 | 1,24 | 12.5 | -3 | 1.240.000, suivi éventuellement de k, M, Md, millions, %
const NUM = /(?<![\w.,])[-−]?(?:\d{1,3}(?:[   ]\d{3})+|\d{1,3}(?:\.\d{3}){2,}|\d+)(?:[.,]\d+)?(?:\s?(?:%|k€|M€|Md€|k\b|K\b|M\b|Md\b|Mds\b|milliers?\b|millions?\b|milliards?\b))?/g;

export function nombres(texte: string): Nombre[] {
    const out: Nombre[] = [];
    for (const m of texte.matchAll(NUM)) {
        const brut = m[0];
        const unite = (brut.match(/(%|k€|M€|Md€|Mds|Md|milliards?|millions?|milliers?|[kKM])$/) || [""])[0];
        let corps = brut.slice(0, brut.length - unite.length).trim().replace("−", "-");
        if (/^\-?\d{1,3}(\.\d{3}){2,}$/.test(corps)) corps = corps.replace(/\./g, "");
        corps = corps.replace(/[   ]/g, "").replace(",", ".");
        const v = Number(corps);
        if (!isFinite(v)) continue;
        const dec = corps.includes(".") ? corps.split(".")[1].length : 0;
        const mult = /^(Md€|Mds|Md|milliards?)$/i.test(unite) ? 1e9
            : /^(M|M€|millions?)$/.test(unite) ? 1e6
                : /^(k|K|k€|milliers?)$/.test(unite) ? 1e3 : 1;
        out.push({ brut, v: v * mult, tol: 0.5 * Math.pow(10, -dec) * mult, pct: unite === "%" });
    }
    return out;
}

function base(r: Resultat): number[] {
    const vals: number[] = [];
    for (const l of r.lignes) {
        for (const x of l) {
            if (typeof x === "number") vals.push(x);
            else if (typeof x === "string" && /^\d{4}$/.test(x)) vals.push(Number(x));
        }
    }
    if (r.total !== null) vals.push(r.total);
    vals.push(r.nbLignesSource, r.nbGroupes);
    return [...new Set(vals)].slice(0, 120);
}

function candidats(r: Resultat): number[] {
    const b = base(r);
    const out = new Set<number>();
    let somme = 0;
    for (const v of b) { out.add(v); out.add(v * 100); out.add(Math.abs(v)); }
    for (const l of r.lignes) { const v = l[r.nbCles]; if (typeof v === "number") somme += v; }
    out.add(somme);
    for (const a of b) {
        for (const c of b) {
            if (a === c) continue;
            out.add(a - c); out.add(Math.abs(a - c)); out.add(a + c);
            if (c) { out.add(a / c); out.add((a / c) * 100); out.add((a / c - 1) * 100); out.add(Math.abs(a / c - 1) * 100); }
        }
    }
    return [...out].filter(x => isFinite(x));
}

export interface Verdict { verifies: number; nonVerifies: string[]; }

export function verifier(textes: string[], r: Resultat, question: string): Verdict {
    const cands = candidats(r).sort((a, b) => a - b);
    const dansQuestion = new Set(nombres(question).map(n => n.v));
    let ok = 0;
    const ko: string[] = [];
    for (const t of textes) {
        for (const n of nombres(t)) {
            const entier = Number.isInteger(n.v) && n.tol === 0.5 && !n.pct;
            if (entier && n.v >= 1900 && n.v <= 2100) continue;   // une année
            if (entier && Math.abs(n.v) <= 12) continue;          // « top 3 », « 2 régions »
            if (dansQuestion.has(n.v)) continue;
            const tol = Math.max(n.tol, Math.abs(n.v) * 1e-3) + 1e-9;
            if (proche(cands, n.v, tol)) ok++;
            else ko.push(n.brut.trim());
        }
    }
    return { verifies: ok, nonVerifies: [...new Set(ko)] };
}

function proche(tri: number[], v: number, tol: number): boolean {
    let lo = 0, hi = tri.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tri[m] < v - tol) lo = m + 1; else hi = m; }
    return lo < tri.length && tri[lo] <= v + tol;
}
