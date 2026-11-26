"use strict";

// Mise en forme des nombres en français, partagée par l'interface et le rapport.

import { Out } from "./types";

export const NF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const PF = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });

// une cellule de résultat : nombre (ou part du total en %), texte, ou « vide » si absente
export function fmt(v: Out, part = false, vide = "–"): string {
    if (v === null) return vide;
    if (typeof v === "number") return part ? PF.format(v) : NF.format(v);
    return v;
}
