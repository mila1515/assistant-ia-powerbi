"use strict";

// L'affichage : question, réponse, chiffres clés, graphique, badges et « Voir le calcul ».
// Tout est construit avec createElement (pas d'innerHTML) : rien de ce que renvoie Gemini n'est interprété comme du HTML.

import { decrirePlan } from "./engine";
import { fmt, NF } from "./format";
import type { Tour } from "./pipeline";
import { Resultat } from "./types";

type Attrs = Record<string, string>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, txt?: string, attrs?: Attrs): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
}

export function vider(e: HTMLElement) {
    while (e.firstChild) e.removeChild(e.firstChild);
}

// une rangée de questions cliquables
export function boutonsQuestions(questions: string[], surClic: (q: string) => void): HTMLElement {
    const s = h("div", "ia-sugg");
    for (const q of questions) {
        const b = h("button", "ia-chip", q, { type: "button" });
        b.onclick = () => surClic(q);
        s.appendChild(b);
    }
    return s;
}

// zone de texte en lecture seule : un clic sélectionne tout, pour qu'une copie à la main n'oublie rien
export function zoneTexte(texte: string, lignes: number, label: string): HTMLTextAreaElement {
    const zone = h("textarea", "ia-rapport-texte", undefined, { readonly: "true", rows: String(lignes), spellcheck: "false", "aria-label": label });
    zone.value = texte;
    zone.onclick = () => zone.select();
    zone.onfocus = () => zone.select();
    return zone;
}

// copie la zone ; si Power BI bloque la copie automatique, le texte reste sélectionné pour un Ctrl+C
export function copier(zone: HTMLTextAreaElement): boolean {
    zone.focus();
    zone.select();
    try { return document.execCommand("copy"); } catch { return false; }
}


function court(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e9) return NF.format(Math.round(v / 1e7) / 100) + " Md";
    if (a >= 1e6) return NF.format(Math.round(v / 1e4) / 100) + " M";
    if (a >= 1e4) return NF.format(Math.round(v / 100) / 10) + " k";
    return NF.format(Math.round(v * 100) / 100);
}

export function carte(t: Tour, surSuggestion: (q: string) => void): HTMLElement {
    const c = h("div", "ia-tour");
    c.appendChild(h("div", "ia-q", t.question));
    const box = h("div", "ia-rep" + (t.type !== "reponse" ? " ia-" + t.type : ""));
    c.appendChild(box);
    box.appendChild(h("div", "ia-titre", t.titre));
    if (t.texte) box.appendChild(h("p", "ia-texte", t.texte));

    if (t.chiffres.length) {
        const g = h("div", "ia-chiffres");
        for (const ch of t.chiffres) {
            const k = h("div", "ia-chiffre");
            k.appendChild(h("div", "ia-cl", ch.label));
            k.appendChild(h("div", "ia-cv", ch.valeur));
            g.appendChild(k);
        }
        box.appendChild(g);
    }

    if (t.resultat && t.type === "reponse") {
        const g = graphique(t.resultat);
        if (g) box.appendChild(g);
    }

    if (t.suggestions.length) box.appendChild(boutonsQuestions(t.suggestions, surSuggestion));

    const pied = h("div", "ia-pied");
    if (t.type === "reponse") {
        if (t.nonVerifies.length) pied.appendChild(h("span", "ia-badge ia-ko", `⚠ Non vérifié : ${t.nonVerifies.join(", ")}`));
        else pied.appendChild(h("span", "ia-badge ia-ok", `✓ ${t.verifies}/${t.verifies} chiffres vérifiés`));
        pied.appendChild(h("span", "ia-badge ia-info", "Suit les filtres du rapport"));
    }
    if (t.appels) pied.appendChild(h("span", "ia-meta", `${t.appels} appel${t.appels > 1 ? "s" : ""} IA${t.modele ? ` (${t.modele})` : ""} · ${t.tokens} tokens · ${(t.ms / 1000).toFixed(1)} s`));
    box.appendChild(pied);

    if (t.plan) box.appendChild(details(t));
    return c;
}

function details(t: Tour): HTMLElement {
    const d = h("details", "ia-details");
    d.appendChild(h("summary", "", "Voir le calcul"));
    d.appendChild(h("p", "ia-phrase", decrirePlan(t.plan!)));
    const r = t.resultat;
    if (r) {
        d.appendChild(h("p", "ia-meta", `${NF.format(r.nbLignesSource)} lignes utilisées · ${NF.format(r.nbGroupes)} groupe${r.nbGroupes > 1 ? "s" : ""}`
            + (r.total !== null && r.nbCles ? ` · total ${NF.format(r.total)}` : "")));
        const tab = h("table", "ia-table");
        const tr = h("tr");
        r.colonnes.forEach(c => tr.appendChild(h("th", "", c)));
        tab.appendChild(tr);
        for (const l of r.lignes.slice(0, 15)) {
            const row = h("tr");
            l.forEach((v, i) => row.appendChild(h("td", typeof v === "number" ? "n" : "", fmt(v, r.avecPart && i === l.length - 1))));
            tab.appendChild(row);
        }
        d.appendChild(tab);
        if (r.lignes.length > 15) d.appendChild(h("p", "ia-meta", `… et ${r.lignes.length - 15} autres lignes`));
    }
    d.appendChild(h("pre", "ia-json", JSON.stringify(t.plan, null, 2)));
    return d;
}

const SVG = "http://www.w3.org/2000/svg";
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    return e;
}

function graphique(r: Resultat): HTMLElement | null {
    if (!r.nbCles || r.lignes.length < 2) return null;
    const vi = r.nbCles;
    const pts = r.lignes.filter(l => typeof l[vi] === "number")
        .map(l => ({ label: l.slice(0, vi).map(x => fmt(x)).join(" · "), v: l[vi] as number }));
    if (pts.length < 2) return null;
    const wrap = h("div", "ia-graph");

    if (r.temporel && r.nbCles === 1 && pts.length >= 3) {
        const W = 320, H = 120, m = { l: 4, r: 4, t: 14, b: 18 };
        const max = Math.max(...pts.map(p => p.v)), min = Math.min(0, ...pts.map(p => p.v));
        const x = (i: number) => m.l + (i * (W - m.l - m.r)) / (pts.length - 1);
        const y = (v: number) => m.t + (H - m.t - m.b) * (1 - (v - min) / (max - min || 1));
        const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", class: "ia-ligne" });
        svg.appendChild(s("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(""), fill: "none", class: "ia-trait" }));
        const best = pts.reduce((a, b) => (b.v > a.v ? b : a));
        const bi = pts.indexOf(best);
        svg.appendChild(s("circle", { cx: x(bi), cy: y(best.v), r: 3, class: "ia-point" }));
        const tx = s("text", { x: Math.min(Math.max(x(bi), 30), W - 30), y: y(best.v) - 5, "text-anchor": "middle", class: "ia-svgt" });
        tx.textContent = court(best.v);
        svg.appendChild(tx);
        for (const [i, a] of [[0, "start"], [pts.length - 1, "end"]] as [number, string][]) {
            const l = s("text", { x: x(i), y: H - 4, "text-anchor": a, class: "ia-svgt" });
            l.textContent = pts[i].label;
            svg.appendChild(l);
        }
        wrap.appendChild(svg);
        return wrap;
    }

    const top = pts.slice(0, 8);
    const max = Math.max(...top.map(p => Math.abs(p.v))) || 1;
    for (const p of top) {
        const row = h("div", "ia-barre");
        row.appendChild(h("span", "ia-bl", p.label, { title: p.label }));
        const piste = h("span", "ia-piste");
        const b = h("span", "ia-b");
        b.style.width = `${Math.max(2, (Math.abs(p.v) / max) * 100)}%`;
        piste.appendChild(b);
        row.appendChild(piste);
        row.appendChild(h("span", "ia-bv", court(p.v)));
        wrap.appendChild(row);
    }
    if (pts.length > 8) wrap.appendChild(h("p", "ia-meta", `${pts.length - 8} autres dans « Voir le calcul »`));
    return wrap;
}
