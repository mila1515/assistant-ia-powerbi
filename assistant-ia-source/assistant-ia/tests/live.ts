// Test avec la vraie IA, sans Power BI : npm run test:ia
// Lit la clé dans .env (OpenAI si remplie, sinon Gemini), propose des analyses, pose quelques questions,
// rédige la synthèse et écrit le rapport PDF dans tests/rapport-test.pdf.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { fournisseur, demander } from "../src/ia";
import { proposer, repondre, synthese, Synthese, Tour } from "../src/pipeline";
import { enBase64, rapportPdf } from "../src/rapport";
import { Dataset } from "../src/types";

function lireEnv(chemin: string): Record<string, string> {
    if (!existsSync(chemin)) return {};
    const out: Record<string, string> = {};
    for (const l of readFileSync(chemin, "utf8").split(/\r?\n/)) {
        const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
}

const env = { ...lireEnv(".env"), ...process.env } as Record<string, string | undefined>;
const cle = (env.OPENAI_API_KEY || env.GEMINI_API_KEY || "").trim();
if (!cle) {
    console.log("Aucune clé : remplis OPENAI_API_KEY ou GEMINI_API_KEY dans le fichier .env");
    process.exit(1);
}
const modele = (env.MODELE || "").trim();

const fichier = process.argv[2] || "../../ventes_exemple.csv";
const txt = readFileSync(fichier, "utf8").replace(/^﻿/, "").trim().split("\n");
const ds: Dataset = {
    cols: [
        { name: "IdVente", kind: "texte", role: "colonne" }, { name: "Date", kind: "date", role: "colonne" },
        { name: "Région", kind: "texte", role: "colonne" }, { name: "Catégorie", kind: "texte", role: "colonne" },
        { name: "Canal", kind: "texte", role: "colonne" }, { name: "Client", kind: "texte", role: "colonne" },
        { name: "Somme de Quantité", kind: "nombre", role: "valeur" }, { name: "Somme de Montant", kind: "nombre", role: "valeur" }],
    rows: txt.slice(1).map(l => {
        const c = l.split(";"); const [y, m, d] = c[1].split("-").map(Number);
        return [c[0], new Date(y, m - 1, d), c[2], c[3], c[4], c[5], Number(c[6]), Number(c[7].replace(",", "."))];
    })
};

const appel = (s: string, m: Parameters<typeof demander>[3]) => demander(cle, modele, s, m);
const sec = (t0: number) => ((Date.now() - t0) / 1000).toFixed(1) + " s";

(async () => {
    console.log(`Fournisseur : ${fournisseur(cle)}${modele ? ` (modèle ${modele})` : " (modèle automatique)"} · ${ds.rows.length} lignes\n`);

    let t0 = Date.now();
    const p = await proposer(ds, true, appel);
    console.log(`Propositions (${sec(t0)}) : ${p.apercu}`);
    for (const i of p.idees) console.log(`  → ${i.titre} : ${i.question}`);

    const tours: Tour[] = [];
    for (const q of [p.idees[0]?.question || "Quelle région a le plus vendu en 2025 ?", "Et en 2024 ?", "Quelle est la marge par catégorie ?"]) {
        try {
            const t = await repondre(q, ds, true, tours, appel);
            tours.push(t);
            console.log(`\nQ : ${q}\n  ${t.type} · ${t.modele} · ${(t.ms / 1000).toFixed(1)} s · non vérifiés ${JSON.stringify(t.nonVerifies)}\n  ${t.titre} — ${t.texte}`);
        } catch (e) {
            console.log(`\nQ : ${q}\n  ERREUR : ${(e as Error).message}`);
        }
    }

    t0 = Date.now();
    let syn: Synthese | null = null;
    try {
        syn = await synthese(tours, appel);
        console.log(`\nSynthèse (${sec(t0)}) : ${syn.synthese}`);
        syn.constats.forEach(c => console.log(`  - ${c}`));
        if (syn.nonVerifies.length) console.log(`  chiffres non retrouvés : ${syn.nonVerifies.join(", ")}`);
    } catch (e) {
        console.log(`\nSynthèse : ERREUR ${(e as Error).message}`);
    }
    const pdf = rapportPdf({ date: new Date(), lignes: ds.rows.length, colonnes: ds.cols.map(c => c.name) }, tours, syn);
    writeFileSync("tests/rapport-test.pdf", Buffer.from(enBase64(pdf), "base64"));
    console.log("\nRapport écrit : tests/rapport-test.pdf");
})().catch(e => { console.log("ERREUR :", e.message); process.exitCode = 1; });
