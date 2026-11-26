"use strict";

// Rapport d'analyse : en texte (copié dans Word depuis le visuel) et en PDF écrit à la main, sans bibliothèque
// (utilisé par npm run test:ia). Aucun import Power BI ni DOM : le module se teste dans Node.

import { decrirePlan } from "./engine";
import { fmt } from "./format";
import type { Synthese, Tour } from "./pipeline";
import { Out, Resultat } from "./types";

// valeur d'une cellule ; « - » plutôt que « – » pour une case vide (police Helvetica du PDF)
const val = (v: Out, part = false) => fmt(v, part, "-");

// ---------- PDF minimal : Helvetica, encodage WinAnsi, A4 ----------

const W = 595, H = 842, MARGE = 50, LARGEUR = W - 2 * MARGE;
type Couleur = [number, number, number];
const ENCRE: Couleur = [0.12, 0.16, 0.18], DOUX: Couleur = [0.36, 0.42, 0.44], TEAL: Couleur = [0.06, 0.43, 0.41];
const FOND: Couleur = [0.965, 0.973, 0.976], LIGNE: Couleur = [0.89, 0.91, 0.92];

// Helvetica n'a que les caractères WinAnsi : on remplace le reste
function winAnsi(s: string): string {
    return s
        .replace(/[    ]/g, " ")
        .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, "\"")
        .replace(/[–—−]/g, "-").replace(/…/g, "...")
        .replace(/→/g, "->").replace(/[✓✦✕⤓]/g, "").replace(/≈/g, "~")
        .replace(/€/g, "\x80").replace(/œ/g, "\x9C").replace(/Œ/g, "\x8C")
        .replace(/[^\x00-\xFF]/g, "?");
}

// largeur approximative d'un texte en Helvetica (en points)
function largeur(s: string, taille: number, gras: boolean): number {
    let u = 0;
    for (const c of s) {
        if (c === " ") u += 0.278;
        else if ("iljtfI.,;:'!|".includes(c)) u += 0.28;
        else if ("r()[]-".includes(c)) u += 0.34;
        else if ("mwMW%".includes(c)) u += 0.86;
        else if (c >= "A" && c <= "Z") u += 0.68;
        else if (c >= "0" && c <= "9") u += 0.556;
        else u += 0.53;
    }
    return u * taille * (gras ? 1.06 : 1);
}

function couper(s: string, taille: number, gras: boolean, max: number): string[] {
    const out: string[] = [];
    for (const para of s.split("\n")) {
        let ligne = "";
        for (const mot of para.split(/\s+/).filter(Boolean)) {
            const essai = ligne ? ligne + " " + mot : mot;
            if (largeur(essai, taille, gras) <= max || !ligne) ligne = essai;
            else { out.push(ligne); ligne = mot; }
        }
        out.push(ligne);
    }
    return out;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const rgb = (c: Couleur) => c.map(x => x.toFixed(3)).join(" ");

class Pdf {
    private pages: string[][] = [];
    private cur: string[] = [];
    y = H - MARGE;

    constructor() { this.nouvellePage(); }

    private nouvellePage() {
        this.cur = [];
        this.pages.push(this.cur);
        this.y = H - MARGE;
    }

    place(h: number) { if (this.y - h < MARGE + 20) this.nouvellePage(); }

    texteA(x: number, y: number, s: string, taille: number, gras = false, c: Couleur = ENCRE) {
        this.cur.push(`BT /${gras ? "F2" : "F1"} ${taille} Tf ${rgb(c)} rg ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(winAnsi(s))}) Tj ET`);
    }

    rect(x: number, y: number, w: number, h: number, c: Couleur) {
        this.cur.push(`${rgb(c)} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`);
    }

    texte(s: string, o: { taille?: number; gras?: boolean; c?: Couleur; retrait?: number; apres?: number } = {}) {
        const taille = o.taille ?? 10, gras = !!o.gras, retrait = o.retrait ?? 0, inter = taille * 1.4;
        for (const l of couper(winAnsi(s), taille, gras, LARGEUR - retrait)) {
            this.place(inter);
            this.y -= inter;
            this.texteA(MARGE + retrait, this.y, l, taille, gras, o.c ?? ENCRE);
        }
        this.y -= o.apres ?? 4;
    }

    puce(s: string, c: Couleur = ENCRE) {
        const lignes = couper(winAnsi(s), 10, false, LARGEUR - 14);
        lignes.forEach((l, i) => {
            this.place(14);
            this.y -= 14;
            if (i === 0) this.rect(MARGE + 3, this.y + 3, 3, 3, TEAL);
            this.texteA(MARGE + 14, this.y, l, 10, false, c);
        });
        this.y -= 3;
    }

    filet() { this.place(10); this.y -= 6; this.rect(MARGE, this.y, LARGEUR, 0.7, LIGNE); this.y -= 6; }

    tableau(r: Resultat, max = 10) {
        const n = r.colonnes.length;
        const wCle = n > 1 ? LARGEUR * (r.nbCles > 1 ? 0.3 : 0.5) : LARGEUR;
        const largeurs = r.colonnes.map((_, i) => i < r.nbCles ? wCle : (LARGEUR - wCle * r.nbCles) / Math.max(1, n - r.nbCles));
        const ligne = (cells: string[], gras: boolean, fond: boolean) => {
            this.place(15);
            this.y -= 15;
            if (fond) this.rect(MARGE, this.y - 4, LARGEUR, 15, FOND);
            let x = MARGE;
            cells.forEach((t, i) => {
                const w = largeurs[i];
                let s = winAnsi(t);
                while (s.length > 1 && largeur(s, 9, gras) > w - 8) s = s.slice(0, -2) + ".";
                const droite = i >= r.nbCles;
                this.texteA(droite ? x + w - 4 - largeur(s, 9, gras) : x + 4, this.y, s, 9, gras, gras ? DOUX : ENCRE);
                x += w;
            });
        };
        ligne(r.colonnes, true, true);
        for (const l of r.lignes.slice(0, max)) {
            ligne(l.map((v, i) => val(v, r.avecPart && i === l.length - 1)), false, false);
        }
        if (r.lignes.length > max || r.nbGroupes > r.lignes.length) {
            this.texte(`${r.nbGroupes - Math.min(max, r.lignes.length)} autres lignes non affichées.`, { taille: 8, c: DOUX });
        }
        this.y -= 4;
    }

    barres(r: Resultat, max = 8) {
        if (r.nbCles !== 1 || r.temporel) return;
        const pts = r.lignes.slice(0, max).filter(l => typeof l[1] === "number");
        if (pts.length < 2) return;
        const vmax = Math.max(...pts.map(l => Math.abs(l[1] as number))) || 1;
        const wLib = LARGEUR * 0.3, wPiste = LARGEUR * 0.55;
        for (const l of pts) {
            this.place(14);
            this.y -= 14;
            let lib = winAnsi(String(l[0]));
            while (lib.length > 1 && largeur(lib, 8, false) > wLib - 6) lib = lib.slice(0, -2) + ".";
            this.texteA(MARGE, this.y, lib, 8, false, DOUX);
            this.rect(MARGE + wLib, this.y - 1, wPiste, 8, FOND);
            this.rect(MARGE + wLib, this.y - 1, Math.max(2, wPiste * Math.abs(l[1] as number) / vmax), 8, TEAL);
            this.texteA(MARGE + wLib + wPiste + 6, this.y, val(l[1]), 8, false, DOUX);
        }
        this.y -= 6;
    }

    // assemble le fichier ; chaque caractère vaut un octet (WinAnsi), donc la longueur de la chaîne = les octets
    fichier(pied: string): string {
        const objs: string[] = [];
        const add = (s: string) => { objs.push(s); return objs.length; };
        const catalog = add(""), pagesId = add("");
        const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
        const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
        const kids: number[] = [];
        this.pages.forEach((p, i) => {
            const bas = `BT /F1 8 Tf ${rgb(DOUX)} rg ${MARGE} 28 Td (${esc(winAnsi(`${pied} - page ${i + 1} / ${this.pages.length}`))}) Tj ET`;
            const flux = [...p, bas].join("\n");
            const contenu = add(`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`);
            kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contenu} 0 R >>`));
        });
        objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
        objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
        let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        const pos: number[] = [];
        objs.forEach((o, i) => { pos.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
        const xref = out.length;
        out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + pos.map(p => `${String(p).padStart(10, "0")} 00000 n \n`).join("");
        out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
        return out;
    }
}

// ---------- contenu du rapport ----------

export interface InfosRapport {
    date: Date;
    lignes: number;
    colonnes: string[];
    filtreRapport?: string;     // filtre posé par l'assistant sur le rapport, s'il y en a un
}

export function rapportPdf(infos: InfosRapport, tours: Tour[], syn: Synthese | null): string {
    const p = new Pdf();
    const jour = infos.date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    const faites = tours.filter(t => t.type === "reponse" && t.resultat && t.plan);
    const horsDonnees = tours.filter(t => t.type === "impossible");

    p.texte("Rapport d'analyse", { taille: 20, gras: true, apres: 2 });
    p.texte(`Généré le ${jour} par l'Assistant IA du rapport Power BI`, { c: DOUX, apres: 10 });

    p.texte("Périmètre", { taille: 13, gras: true, c: TEAL });
    p.texte(`${infos.lignes.toLocaleString("fr-FR")} lignes, ${infos.colonnes.length} colonnes : ${infos.colonnes.join(", ")}.`);
    p.texte("Les données sont celles visibles dans le visuel au moment de l'export, après les filtres et segments du rapport." +
        (infos.filtreRapport ? ` Filtre appliqué par l'assistant : ${infos.filtreRapport}.` : ""), { c: DOUX });
    p.texte(`${faites.length} analyse${faites.length > 1 ? "s" : ""} réalisée${faites.length > 1 ? "s" : ""}` +
        (horsDonnees.length ? `, ${horsDonnees.length} question${horsDonnees.length > 1 ? "s" : ""} hors des données.` : "."), { c: DOUX, apres: 10 });

    if (syn) {
        p.texte("Synthèse", { taille: 13, gras: true, c: TEAL });
        p.texte(syn.synthese, { apres: 8 });
        if (syn.constats.length) {
            p.texte("Constats", { taille: 11, gras: true });
            syn.constats.forEach(c => p.puce(c));
            p.y -= 6;
        }
        if (syn.nonVerifies.length) {
            p.texte(`Chiffres de la synthèse non retrouvés dans les résultats (à vérifier) : ${syn.nonVerifies.join(", ")}.`, { taille: 9, c: [0.54, 0.35, 0.04] });
        }
    } else {
        p.texte("Synthèse", { taille: 13, gras: true, c: TEAL });
        p.texte("La synthèse automatique n'a pas pu être rédigée. Le détail des analyses ci-dessous reste complet.", { c: DOUX, apres: 8 });
    }

    faites.forEach((t, i) => {
        p.filet();
        p.place(60);
        p.texte(`Analyse ${i + 1} - ${t.question}`, { taille: 12, gras: true, apres: 2 });
        if (t.titre) p.texte(t.titre, { gras: true, c: TEAL, apres: 2 });
        if (t.texte) p.texte(t.texte, { apres: 6 });
        p.texte(`Calcul : ${decrirePlan(t.plan!)}`, { taille: 9, c: DOUX, apres: 2 });
        p.texte(`${t.resultat!.nbLignesSource.toLocaleString("fr-FR")} lignes utilisées. ` +
            (t.nonVerifies.length ? `Chiffres non retrouvés dans le résultat : ${t.nonVerifies.join(", ")}.` : `${t.verifies} chiffre${t.verifies > 1 ? "s" : ""} du texte vérifié${t.verifies > 1 ? "s" : ""} dans le résultat.`),
            { taille: 9, c: DOUX, apres: 6 });
        p.barres(t.resultat!);
        p.tableau(t.resultat!);
    });

    if (horsDonnees.length) {
        p.filet();
        p.texte("Questions hors des données", { taille: 13, gras: true, c: TEAL });
        horsDonnees.forEach(t => p.puce(`${t.question} : ${t.texte}`));
    }

    p.filet();
    p.texte("Méthode et limites", { taille: 13, gras: true, c: TEAL });
    const limites = [
        "Les calculs sont faits dans le visuel, sur les lignes du rapport. L'IA (Gemini ou OpenAI) ne reçoit que la description des colonnes et les résultats agrégés, jamais les lignes.",
        "Chaque chiffre écrit par l'IA est comparé automatiquement au résultat du calcul ; les chiffres non retrouvés sont signalés.",
        "Le rapport décrit ce que montrent les données. Il n'établit pas de causes et ne formule pas de recommandations.",
        ...(syn?.limites || [])
    ];
    limites.forEach(l => p.puce(l, DOUX));

    return p.fichier(`Rapport d'analyse - ${jour}`);
}

// Même rapport en texte, pour le copier dans Word quand Power BI bloque les téléchargements.
// Les tableaux sont séparés par des tabulations : collés dans Word ou Excel, ils gardent leurs colonnes.
export function rapportTexte(infos: InfosRapport, tours: Tour[], syn: Synthese | null): string {
    const jour = infos.date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    const faites = tours.filter(t => t.type === "reponse" && t.resultat && t.plan);
    const horsDonnees = tours.filter(t => t.type === "impossible");
    const l: string[] = [];

    l.push("RAPPORT D'ANALYSE", `Généré le ${jour} par l'Assistant IA du rapport Power BI`, "");
    l.push("PÉRIMÈTRE");
    l.push(`${infos.lignes.toLocaleString("fr-FR")} lignes, ${infos.colonnes.length} colonnes : ${infos.colonnes.join(", ")}.`);
    l.push("Données visibles dans le visuel au moment de l'export, après les filtres et segments du rapport." +
        (infos.filtreRapport ? ` Filtre appliqué par l'assistant : ${infos.filtreRapport}.` : ""), "");

    l.push("SYNTHÈSE");
    if (syn) {
        l.push(syn.synthese, "");
        if (syn.constats.length) { l.push("Constats :"); syn.constats.forEach(c => l.push(`- ${c}`)); l.push(""); }
        if (syn.nonVerifies.length) l.push(`Chiffres non retrouvés dans les résultats (à vérifier) : ${syn.nonVerifies.join(", ")}.`, "");
    } else {
        l.push("La synthèse automatique n'a pas pu être rédigée. Le détail des analyses ci-dessous reste complet.", "");
    }

    faites.forEach((t, i) => {
        const r = t.resultat!;
        l.push(`ANALYSE ${i + 1} - ${t.question}`);
        if (t.titre) l.push(t.titre);
        if (t.texte) l.push(t.texte);
        l.push(`Calcul : ${decrirePlan(t.plan!)}`);
        l.push(`${r.nbLignesSource.toLocaleString("fr-FR")} lignes utilisées. ` +
            (t.nonVerifies.length ? `Chiffres non retrouvés : ${t.nonVerifies.join(", ")}.` : `${t.verifies} chiffre(s) du texte vérifié(s) dans le résultat.`), "");
        l.push(r.colonnes.join("\t"));
        for (const ligne of r.lignes.slice(0, 15)) l.push(ligne.map((v, k) => val(v, r.avecPart && k === ligne.length - 1)).join("\t"));
        if (r.nbGroupes > Math.min(15, r.lignes.length)) l.push(`(${r.nbGroupes - Math.min(15, r.lignes.length)} autres lignes non affichées)`);
        l.push("");
    });

    if (horsDonnees.length) {
        l.push("QUESTIONS HORS DES DONNÉES");
        horsDonnees.forEach(t => l.push(`- ${t.question} : ${t.texte}`));
        l.push("");
    }

    l.push("MÉTHODE ET LIMITES");
    l.push("- Les calculs sont faits dans le visuel, sur les lignes du rapport. L'IA ne reçoit que la description des colonnes et les résultats agrégés, jamais les lignes.");
    l.push("- Chaque chiffre écrit par l'IA est comparé automatiquement au résultat du calcul ; les chiffres non retrouvés sont signalés.");
    l.push("- Le rapport décrit ce que montrent les données. Il n'établit pas de causes et ne formule pas de recommandations.");
    (syn?.limites || []).forEach(x => l.push(`- ${x}`));
    return l.join("\n");
}

// base64 d'une chaîne d'octets (chaque caractère < 256) ; btoa existe dans le navigateur et dans Node 16+
export function enBase64(octets: string): string {
    return btoa(octets);
}
