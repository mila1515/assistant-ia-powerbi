"use strict";

// Lecture des champs glissés dans le visuel : la table que Power BI envoie devient un Dataset
// (colonnes typées, lignes) que le reste du code utilise sans dépendre de Power BI.

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;

import { Cell, Dataset, Kind } from "./types";

function genre(t: powerbi.ValueTypeDescriptor | undefined): Kind {
    if (!t) return "texte";
    if (t.dateTime) return "date";
    if (t.numeric || t.integer) return "nombre";
    if (t.bool) return "booleen";
    return "texte";
}

// queryName : « Table.Colonne » (colonne simple) ou « Sum(Table.Colonne) » (valeur agrégée) ;
// rien pour une mesure du modèle (sa formule n'est pas connue) ni pour une hiérarchie de dates
function cibleDe(q: string, role: "colonne" | "valeur"): { table: string; colonne: string } | undefined {
    const agg = q.match(/^[A-Za-z]+\((.+)\)$/);
    if (role === "valeur" && !agg) return undefined;
    if (role === "colonne" && agg) return undefined;
    const interne = agg ? agg[1] : q;
    const p = interne.indexOf(".");
    if (p <= 0 || interne.slice(p + 1).includes(".") || interne.includes("(")) return undefined;
    return { table: interne.slice(0, p), colonne: interne.slice(p + 1) };
}

export function lireTableau(dv: DataView | undefined): Dataset | null {
    const t = dv?.table;
    if (!t || !t.columns?.length) return null;
    const vus = new Map<string, number>();
    const cols = t.columns.map(c => {
        const role = (c.roles?.valeurs ? "valeur" : "colonne") as "valeur" | "colonne";
        let name = c.displayName || c.queryName || "Colonne";
        // « Sum of Montant » / « Somme de Montant » → « Montant » : l'assistant écrit lui-même « Somme de Montant »
        // (seulement pour la somme : un « Count of Client » reste un comptage, pas le client)
        if (role === "valeur") name = name.replace(/^(sum of|somme de|total de)\s+/i, "") || name;
        // deux champs du même nom : « Montant », « Montant (2) »
        const k = vus.get(name) || 0;
        vus.set(name, k + 1);
        if (k) name = `${name} (${k + 1})`;
        const cible = cibleDe(c.queryName || "", role);
        return { name, kind: genre(c.type), role, ...(cible ? { cible } : {}) };
    });
    const rows: Cell[][] = (t.rows || []).map(r => r.map((v, i): Cell => {
        if (v === null || v === undefined) return null;
        const k = cols[i].kind;
        if (k === "date") {
            const d = v instanceof Date ? v : new Date(v as string);
            return isNaN(d.getTime()) ? null : d;
        }
        if (k === "nombre") { const n = Number(v); return isFinite(n) ? n : null; }
        if (k === "booleen") return v === true || v === "true";
        return String(v);
    }));
    return { cols, rows };
}
