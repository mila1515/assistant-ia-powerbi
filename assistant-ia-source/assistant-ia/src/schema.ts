"use strict";

// Étape 2 : décrire le tableau sans l'envoyer. Gemini reçoit les noms, les types et quelques exemples.

import { Cell, Dataset } from "./types";

export function norm(s: unknown): string {
    return String(s ?? "")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase().replace(/[_\-\s]+/g, " ").trim();
}

export function iso(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function cle(v: Cell): string {
    if (v === null || v === undefined) return "(vide)";
    if (v instanceof Date) return iso(v);
    return String(v);
}

export interface DescCol {
    nom: string;
    type: string;
    role: string;
    valeurs_distinctes: number;
    exemples?: string[];
    min?: string | number;
    max?: string | number;
}

export interface Description {
    lignes: number;
    colonnes: DescCol[];
}

export function decrire(ds: Dataset, avecExemples: boolean, maxExemples = 15): Description {
    const colonnes = ds.cols.map((c, i): DescCol => {
        const freq = new Map<string, number>();
        let min: number | Date | null = null, max: number | Date | null = null;
        for (const r of ds.rows) {
            const v = r[i];
            const k = cle(v);
            freq.set(k, (freq.get(k) || 0) + 1);
            if (typeof v === "number" || v instanceof Date) {
                if (min === null || v < min) min = v;
                if (max === null || v > max) max = v;
            }
        }
        const d: DescCol = { nom: c.name, type: c.kind, role: c.role === "valeur" ? "valeur agrégée" : "colonne", valeurs_distinctes: freq.size };
        if (min !== null && max !== null) {
            d.min = min instanceof Date ? iso(min) : round(min);
            d.max = max instanceof Date ? iso(max as Date) : round(max as number);
        }
        const discret = c.kind === "texte" || c.kind === "booleen" || (c.kind === "nombre" && c.role === "colonne" && freq.size <= 40);
        if (avecExemples && discret) {
            d.exemples = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxExemples).map(e => e[0]);
        }
        return d;
    });
    return { lignes: ds.rows.length, colonnes };
}

function round(v: number): number {
    return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
}
