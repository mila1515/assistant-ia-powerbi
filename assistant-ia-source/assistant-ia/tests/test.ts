import { readFileSync } from "fs";
import { executer, decrirePlan, PlanError } from "../src/engine";
import { verifier, nombres } from "../src/guard";
import { decrire } from "../src/schema";
import { repondre, suggestions } from "../src/pipeline";
import { Dataset, Plan } from "../src/types";

const txt = readFileSync(process.argv[2], "utf8").replace(/^﻿/, "").trim().split("\n");
const head = txt[0].split(";");
const ds: Dataset = {
  cols: [
    { name: "IdVente", kind: "texte", role: "colonne" }, { name: "Date", kind: "date", role: "colonne" },
    { name: "Région", kind: "texte", role: "colonne" }, { name: "Catégorie", kind: "texte", role: "colonne" },
    { name: "Canal", kind: "texte", role: "colonne" }, { name: "Client", kind: "texte", role: "colonne" },
    { name: "Somme de Quantité", kind: "nombre", role: "valeur" }, { name: "Somme de Montant", kind: "nombre", role: "valeur" }],
  rows: txt.slice(1).map(l => { const c = l.split(";"); const [y, m, d] = c[1].split("-").map(Number);
    return [c[0], new Date(y, m - 1, d), c[2], c[3], c[4], c[5], Number(c[6]), Number(c[7].replace(",", "."))]; })
};
console.log(head.length, "colonnes,", ds.rows.length, "lignes");
const sch = decrire(ds, true);
console.log("schema bytes:", JSON.stringify(sch).length, "| Région:", JSON.stringify(sch.colonnes[2]));

let ok = 0, ko = 0;
const t = (nom: string, f: () => void) => { try { f(); ok++; console.log("  ok  ", nom); } catch (e) { ko++; console.log("  FAIL", nom, (e as Error).message); } };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} attendu ${JSON.stringify(b)} obtenu ${JSON.stringify(a)}`); };

// vérité calculée à la main
const sumBy = (f: (r: any[]) => boolean) => Math.round(ds.rows.filter(f).reduce((s, r) => s + (r[7] as number), 0) * 100) / 100;

t("somme par région 2025, top 3, part", () => {
  const { resultat: r, plan } = executer(ds, { action: "calcul", operation: "somme", mesure: "Montant", par: [{ colonne: "region" }],
    filtres: [{ colonne: "Date", op: "=", periode: "annee", valeur: 2025 }], tri: "desc", limite: 3, part_du_total: true });
  const nord = sumBy(x => x[2] === "Nord" && (x[1] as Date).getFullYear() === 2025);
  eq(r.lignes[0][0], "Nord"); eq(Math.round((r.lignes[0][1] as number) * 100) / 100, nord, "Nord");
  eq(r.lignes.length, 3); eq(plan.mesure, "Somme de Montant");
  console.log("     ", decrirePlan(plan), JSON.stringify(r.lignes));
});
t("evolution mensuelle chrono", () => {
  const { resultat: r } = executer(ds, { action: "calcul", operation: "somme", mesure: "Somme de Montant", par: [{ colonne: "Date", periode: "mois" }] });
  eq(r.lignes.length, 24); eq(r.lignes[0][0], "2024-01"); eq(r.temporel, true);
});
t("comparer 2024 vs 2025 par canal", () => {
  const { resultat: r } = executer(ds, { action: "calcul", operation: "somme", mesure: "Montant",
    par: [{ colonne: "Canal" }, { colonne: "Date", periode: "annee" }], filtres: [{ colonne: "Date", op: "in", periode: "annee", valeurs: [2024, 2025] }], tri: "chrono" });
  eq(r.lignes.length, 6);
});
t("nombre distinct de clients en IDF (casse/accents)", () => {
  const { resultat: r } = executer(ds, { action: "calcul", operation: "nombre_distinct", mesure: "client", filtres: [{ colonne: "Région", op: "=", valeur: "ile de france" }] });
  const vrai = new Set(ds.rows.filter(x => x[2] === "Île-de-France").map(x => x[5])).size;
  eq(r.lignes[0][0], vrai);
});
t("entre deux dates inclusif", () => {
  const { resultat: r } = executer(ds, { action: "calcul", operation: "nombre_lignes", filtres: [{ colonne: "Date", op: "entre", valeurs: ["2025-06-01", "2025-06-30"] }] });
  eq(r.lignes[0][0], ds.rows.filter(x => (x[1] as Date).getFullYear() === 2025 && (x[1] as Date).getMonth() === 5).length);
});
t("moyenne par trimestre", () => {
  const { resultat: r } = executer(ds, { action: "calcul", operation: "moyenne", mesure: "Montant", par: [{ colonne: "Date", periode: "trimestre" }] });
  eq(r.lignes[0][0], "2024-T1"); eq(r.lignes.length, 8);
});
t("colonne inexistante refusée", () => {
  try { executer(ds, { action: "calcul", operation: "somme", mesure: "Marge" }); throw new Error("pas d'erreur"); }
  catch (e) { if (!(e instanceof PlanError)) throw e; console.log("     ", e.message.slice(0, 90)); }
});
t("valeur inexistante refusée", () => {
  try { executer(ds, { action: "calcul", operation: "somme", mesure: "Montant", filtres: [{ colonne: "Région", op: "=", valeur: "Bretagne" }] }); throw new Error("pas d'erreur"); }
  catch (e) { if (!(e instanceof PlanError)) throw e; console.log("     ", e.message.slice(0, 90)); }
});
t("somme sur colonne texte refusée", () => {
  try { executer(ds, { action: "calcul", operation: "somme", mesure: "Région" }); throw new Error("pas d'erreur"); }
  catch (e) { if (!(e instanceof PlanError)) throw e; }
});
t("parse nombres fr", () => {
  eq(nombres("1,24 M€ soit 31 % et 1 240 000 puis 12,5 k et 2025").map(n => Math.round(n.v)), [1240000, 31, 1240000, 12500, 2025]);
});
t("guard : vrais chiffres vérifiés, faux détecté", () => {
  const { resultat: r } = executer(ds, { action: "calcul", operation: "somme", mesure: "Montant", par: [{ colonne: "Région" }], part_du_total: true });
  const v0 = r.lignes[0][1] as number, v1 = r.lignes[1][1] as number, p0 = r.lignes[0][2] as number;
  const f = (x: number) => (Math.round(x / 1e4) / 100).toLocaleString("fr-FR") + " M€";
  const bon = `${r.lignes[0][0]} : ${f(v0)}, soit ${Math.round(p0 * 100)} % du total, ${Math.round((v0 / v1 - 1) * 100)} % de plus que ${r.lignes[1][0]}.`;
  const v = verifier([bon], r, "q"); eq(v.nonVerifies, [], "bon"); console.log("     ", bon, "->", v.verifies, "vérifiés");
  const faux = verifier([`${f(v0 * 1.2)} et 12,34 %`], r, "q"); eq(faux.nonVerifies.length, 2, "faux");
});

// pipeline complet avec un faux Gemini
(async () => {
  let n = 0;
  const appel = async (sys: string, msgs: any[]) => {
    n++;
    if (sys.includes("moteur de requête")) {
      const last = msgs[msgs.length - 1].text as string;
      if (last.includes("ne fonctionne pas")) return { json: { action: "calcul", operation: "somme", mesure: "Somme de Montant", par: [{ colonne: "Région" }], limite: 2 }, modele: "faux", tokens: 10 };
      if (last.includes("marge")) return { json: { action: "impossible", raison: "Aucune colonne de marge.", suggestions: ["Montant par région ?"] }, modele: "faux", tokens: 10 };
      return { json: { action: "calcul", operation: "somme", mesure: "Chiffre", par: [{ colonne: "Région" }], limite: 2 }, modele: "faux", tokens: 10 }; // mauvaise colonne -> retry
    }
    const res = JSON.parse((msgs[0].text as string).split("Résultat : ")[1]);
    const v = res.lignes[0][1];
    if (msgs.length === 1) return { json: { titre: "Test", texte: `${res.lignes[0][0]} fait 999 999 €.`, chiffres: [] }, modele: "faux", tokens: 5 }; // invente
    return { json: { titre: `${res.lignes[0][0]} en tête`, texte: `${Math.round(v).toLocaleString("fr-FR")} €.`, chiffres: [{ label: "Total", valeur: `${Math.round(v / 1000).toLocaleString("fr-FR")} k€` }] }, modele: "faux", tokens: 5 };
  };
  const tour = await repondre("Quelle région vend le plus ?", ds, true, [], appel as any, s => console.log("     étape:", s));
  console.log("  pipeline:", tour.type, "|", tour.titre, "|", tour.texte, "| vérifiés", tour.verifies, "non", tour.nonVerifies, "| appels", tour.appels);
  if (tour.type !== "reponse" || tour.nonVerifies.length || tour.appels !== 4) { ko++; console.log("  FAIL pipeline"); } else ok++;
  const imp = await repondre("Quelle est la marge ?", ds, true, [tour], appel as any);
  console.log("  impossible:", imp.type, imp.texte, imp.suggestions);
  if (imp.type !== "impossible") ko++; else ok++;
  console.log("  suggestions:", suggestions(ds));
  console.log(`\n${ok} ok, ${ko} échecs`);
  process.exit(ko ? 1 : 0);
})();
