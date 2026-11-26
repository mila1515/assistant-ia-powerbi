"use strict";

// Point d'entrée Power BI. Le visuel reçoit les champs glissés dedans (déjà filtrés par le rapport),
// les garde en mémoire, et répond aux questions avec le pipeline de pipeline.ts.

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import DataView = powerbi.DataView;

import { DaxIndisponible, versDax } from "./dax";
import { lireTableau } from "./donnees";
import { demander } from "./ia";
import { Appel, proposer, repondre, suggestions, synthese, Synthese, Tour } from "./pipeline";
import { rapportTexte } from "./rapport";
import { MODELE_PAR_DEFAUT, VisualFormattingSettingsModel } from "./settings";
import { Col, Dataset } from "./types";
import { boutonsQuestions, carte, copier, h, vider, zoneTexte } from "./ui";

const message = (e: unknown) => e instanceof Error ? e.message : String(e);

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private settings: VisualFormattingSettingsModel;
    private fs = new FormattingSettingsService();

    private ds: Dataset | null = null;
    private tours: Tour[] = [];
    private occupe = false;
    private contenu = false;      // le fil contient déjà des propositions ou des réponses : on ne le réécrit plus
    private ideesPour = "";       // colonnes pour lesquelles on a déjà proposé des analyses automatiquement
    private filtreActif = "";     // libellé du filtre que l'assistant a posé sur le rapport

    private root: HTMLElement;
    private statut: HTMLElement;
    private boutonIdees: HTMLButtonElement;
    private boutonRapport: HTMLButtonElement;
    private puceFiltre: HTMLButtonElement;
    private fil: HTMLElement;
    private input: HTMLInputElement;
    private bouton: HTMLButtonElement;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.root = h("div", "ia");
        options.element.appendChild(this.root);

        const tete = h("div", "ia-tete");
        tete.appendChild(h("span", "ia-logo", "✦"));
        tete.appendChild(h("span", "ia-nom", "Demander à l'IA"));
        this.statut = h("span", "ia-statut");
        tete.appendChild(this.statut);
        this.boutonIdees = h("button", "ia-chip ia-btn-idees", "✦ Idées", { type: "button", title: "Propose-moi des analyses sur ces données" });
        this.boutonIdees.onclick = () => this.proposerAnalyses();
        tete.appendChild(this.boutonIdees);
        this.boutonRapport = h("button", "ia-chip ia-btn-idees", "📋 Rapport", { type: "button", title: "Rédiger le rapport de toutes les analyses, à copier dans Word" });
        this.boutonRapport.onclick = () => this.genererRapport();
        tete.appendChild(this.boutonRapport);
        this.root.appendChild(tete);

        this.puceFiltre = h("button", "ia-puce-filtre", undefined, { type: "button", title: "Retirer le filtre posé sur le rapport" });
        this.puceFiltre.onclick = () => this.retirerFiltre();
        this.root.appendChild(this.puceFiltre);

        this.fil = h("div", "ia-fil");
        this.root.appendChild(this.fil);

        // pas de <form> : l'iframe des visuels interdit l'envoi de formulaires, l'événement submit ne partirait jamais
        const form = h("div", "ia-form");
        this.input = h("input", "ia-input", undefined, { type: "text", placeholder: "Pose une question sur tes données…", "aria-label": "Question" });
        this.bouton = h("button", "ia-envoyer", "Envoyer", { type: "button" });
        form.appendChild(this.input);
        form.appendChild(this.bouton);
        this.bouton.onclick = () => this.poser(this.input.value);
        this.input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); this.poser(this.input.value); } };
        this.root.appendChild(form);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);
        try {
            const dv: DataView | undefined = options.dataViews?.[0];
            this.settings = this.fs.populateFormattingSettingsModel(VisualFormattingSettingsModel, dv);
            const max = Math.max(1000, Number(this.settings.iaCard.maxLignes.value) || 30000);

            // Power BI envoie les lignes par paquets : on demande la suite jusqu'à la limite
            const n = dv?.table?.rows?.length || 0;
            if (dv?.metadata?.segment && n < max && this.host.fetchMoreData(true)) {
                this.statut.textContent = `Chargement… ${n.toLocaleString("fr-FR")} lignes`;
                this.events.renderingFinished(options);
                return;
            }

            if (options.type & powerbi.VisualUpdateType.Data || !this.ds) this.ds = lireTableau(dv);
            // le filtre posé par l'assistant est enregistré avec le rapport : on le retrouve à la réouverture
            if (!options.jsonFilters?.length) this.filtreActif = "";
            else if (!this.filtreActif) this.filtreActif = "filtre de l'assistant";
            this.afficherEtat();
            this.events.renderingFinished(options);
        } catch (e) {
            this.events.renderingFailed(options, String(e));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.fs.buildFormattingModel(this.settings);
    }

    // ---------- état et outils communs ----------

    private cle(): string {
        return String(this.settings?.iaCard.apiKey.value || "").trim();
    }

    private exemples(): boolean {
        return !!this.settings.iaCard.exemples.value;
    }

    // la fonction qui parle à l'IA, avec la clé et le modèle du volet Format
    private appel(): Appel {
        const modele = String(this.settings.iaCard.modele.value || "").trim() || MODELE_PAR_DEFAUT;
        const cle = this.cle();
        return (sys, msgs) => demander(cle, modele, sys, msgs);
    }

    private defiler() {
        this.fil.scrollTop = this.fil.scrollHeight;
    }

    // début d'une action : le fil d'accueil laisse la place, les boutons sont bloqués
    private commencer() {
        if (!this.contenu) vider(this.fil);
        this.contenu = true;
        this.occupe = true;
        this.afficherEtat();
    }

    private terminer() {
        this.occupe = false;
        this.afficherEtat();
        this.defiler();
    }

    // une carte vide avec un message d'attente, remplie ensuite
    private carteAttente(attente: string): HTMLElement {
        const t = h("div", "ia-tour");
        const box = h("div", "ia-rep");
        t.appendChild(box);
        box.appendChild(h("div", "ia-charge", attente));
        this.fil.appendChild(t);
        this.defiler();
        return box;
    }

    private afficherEtat() {
        const ds = this.ds;
        const pret = !!ds && ds.cols.length > 0;
        this.statut.textContent = pret ? `${ds!.cols.length} colonnes · ${ds!.rows.length.toLocaleString("fr-FR")} lignes` : "";
        this.input.disabled = !pret || this.occupe;
        this.bouton.disabled = !pret || this.occupe;
        this.boutonIdees.disabled = !pret || this.occupe || !this.cle();
        this.boutonRapport.disabled = this.occupe || !this.tours.some(t => t.type === "reponse");
        this.puceFiltre.textContent = `✕  Rapport filtré : ${this.filtreActif}`;
        this.puceFiltre.style.display = this.filtreActif ? "" : "none";
        if (this.contenu || this.occupe) return;

        vider(this.fil);
        const vide = h("div", "ia-vide");
        if (!pret) {
            vide.appendChild(h("div", "ia-titre", "Glisse tes colonnes dans le visuel"));
            vide.appendChild(h("p", "ia-texte", "Mets tes catégories, dates et identifiants dans « Colonnes », et tes montants ou quantités dans « Valeurs ». L'IA ne voit que les noms des colonnes, jamais les données."));
        } else if (!this.cle()) {
            vide.appendChild(h("div", "ia-titre", "Ajoute ta clé API"));
            vide.appendChild(h("p", "ia-texte", "Format du visuel > Assistant IA > Clé API. Colle une clé Gemini (gratuite sur aistudio.google.com) ou une clé OpenAI (sk-…)."));
        } else {
            vide.appendChild(h("div", "ia-titre", "Que veux-tu savoir ?"));
            vide.appendChild(h("p", "ia-texte", `${ds!.cols.map(c => c.name).join(", ")}.`));
            vide.appendChild(boutonsQuestions(suggestions(ds!), q => this.poser(q)));
        }
        this.fil.appendChild(vide);

        // données et clé prêtes : l'assistant regarde les colonnes et propose des analyses, une fois par jeu de colonnes
        if (pret && this.cle()) {
            const sig = ds!.cols.map(c => c.name).join("|");
            if (sig !== this.ideesPour) { this.ideesPour = sig; void this.proposerAnalyses(); }
        }
    }

    // ---------- propositions d'analyses ----------

    private async proposerAnalyses() {
        const ds = this.ds;
        if (!ds || !ds.cols.length || this.occupe || !this.cle()) return;
        this.commencer();
        const box = this.carteAttente(`Je regarde tes ${ds.cols.length} colonnes et ${ds.rows.length.toLocaleString("fr-FR")} lignes…`);
        try {
            const p = await proposer(ds, this.exemples(), this.appel());
            vider(box);
            box.appendChild(h("div", "ia-titre", "Voici ce que je te propose"));
            if (p.apercu) box.appendChild(h("p", "ia-texte", p.apercu));
            const liste = h("div", "ia-idees");
            for (const i of p.idees) {
                const b = h("button", "ia-idee", undefined, { type: "button", title: i.question });
                b.appendChild(h("span", "ia-idee-t", i.titre || i.question));
                if (i.pourquoi) b.appendChild(h("span", "ia-idee-p", i.pourquoi));
                b.onclick = () => this.poser(i.question);
                liste.appendChild(b);
            }
            box.appendChild(liste);
            box.appendChild(h("p", "ia-meta", "Clique sur une analyse, ou pose ta propre question en bas."));
        } catch (e) {
            // IA indisponible : on garde au moins les suggestions calculées sur place
            vider(box);
            box.className = "ia-rep ia-erreur";
            box.appendChild(h("div", "ia-titre", "Je n'ai pas pu proposer d'analyses"));
            box.appendChild(h("p", "ia-texte", message(e)));
            box.appendChild(boutonsQuestions(suggestions(ds), q => this.poser(q)));
        }
        this.terminer();
    }

    // ---------- question / réponse ----------

    private async poser(q: string) {
        q = q.trim();
        if (!q || this.occupe || !this.ds) return;
        this.input.value = "";
        this.commencer();

        const enCours = h("div", "ia-tour");
        enCours.appendChild(h("div", "ia-q", q));
        const etape = h("div", "ia-charge", "…");
        enCours.appendChild(etape);
        this.fil.appendChild(enCours);
        this.defiler();

        let tour: Tour;
        try {
            tour = await repondre(q, this.ds, this.exemples(), this.tours, this.appel(), t => { etape.textContent = t; });
        } catch (e) {
            tour = { question: q, type: "erreur", titre: "Je n'ai pas pu répondre", texte: message(e),
                     chiffres: [], suggestions: [], verifies: 0, nonVerifies: [], appels: 0, tokens: 0, ms: 0 };
        }
        this.tours.push(tour);
        const c = carte(tour, x => this.poser(x));
        const rep = c.querySelector(".ia-rep");
        const barre = this.barreFiltre(tour);
        if (barre) rep?.appendChild(barre);
        const dax = this.blocDax(tour);
        if (dax) rep?.appendChild(dax);
        enCours.replaceWith(c);
        this.terminer();
        this.input.focus();
    }

    // ---------- filtrer le rapport à partir d'une réponse ----------

    // sous une réponse regroupée par une colonne du modèle (pas une période), un bouton par valeur en tête
    private barreFiltre(t: Tour): HTMLElement | null {
        const r = t.resultat, g = t.plan?.par?.[0];
        if (t.type !== "reponse" || !r || !g || g.periode || !this.ds) return null;
        const col = this.ds.cols.find(c => c.name === g.colonne);
        if (!col?.cible || col.kind === "date") return null;
        const valeurs = r.lignes.map(l => l[0]).filter((v): v is string | number => v !== null && v !== "(vide)").slice(0, 5);
        if (!valeurs.length) return null;
        const barre = h("div", "ia-filtres");
        barre.appendChild(h("span", "ia-meta", "Filtrer le rapport :"));
        for (const v of valeurs) {
            const b = h("button", "ia-chip", String(v), { type: "button", title: `Afficher seulement ${col.name} = ${v} dans tout le rapport` });
            b.onclick = () => this.filtrer(col, [v], String(v));
            barre.appendChild(b);
        }
        if (valeurs.length >= 3) {
            const top = valeurs.slice(0, 3);
            const b = h("button", "ia-chip", "Les 3 premiers", { type: "button", title: top.join(", ") });
            b.onclick = () => this.filtrer(col, top, top.join(", "));
            barre.appendChild(b);
        }
        return barre;
    }

    private filtrer(col: Col, valeurs: (string | number)[], libelle: string) {
        if (!col.cible) return;
        // les valeurs doivent avoir le type de la colonne du modèle
        const typees = valeurs.map(v => col.kind === "nombre" ? Number(v) : col.kind === "booleen" ? String(v) === "true" : String(v));
        const filtre = {
            // identifiant fixe du format de filtre Power BI (pas une page web)
            // eslint-disable-next-line powerbi-visuals/no-http-string
            $schema: "http://powerbi.com/product/schema#basic",
            target: { table: col.cible.table, column: col.cible.colonne },
            filterType: 1,
            operator: "In",
            values: typees,
            requireSingleSelection: false
        };
        try {
            this.host.applyJsonFilter(filtre, "general", "filter", powerbi.FilterAction.merge);
            this.filtreActif = `${col.name} = ${libelle}`;
            this.afficherEtat();
        } catch (e) {
            // sans ce message, un refus de Power BI passerait inaperçu
            this.filtreActif = "";
            this.afficherEtat();
            this.puceFiltre.style.display = "";
            this.puceFiltre.textContent = `Filtre refusé par Power BI (${col.cible.table}[${col.cible.colonne}]) : ${message(e)}`;
        }
    }

    private retirerFiltre() {
        this.host.applyJsonFilter(null as unknown as powerbi.IFilter, "general", "filter", powerbi.FilterAction.remove);
        this.filtreActif = "";
        this.afficherEtat();
    }

    // ---------- le même calcul en DAX ----------

    private blocDax(t: Tour): HTMLElement | null {
        if (t.type !== "reponse" || !t.plan || !t.resultat || !this.ds) return null;
        const d = h("details", "ia-details ia-dax");
        d.appendChild(h("summary", undefined, "Voir le DAX"));
        try {
            const code = versDax(this.ds, t.plan, t.resultat);
            d.appendChild(h("p", "ia-meta", "Clique dans une zone : tout le code est sélectionné. Copie-le en entier (Ctrl+C), sans en oublier le début."));
            d.appendChild(this.blocCode("Requête : vue Requête DAX > coller > Exécuter", code.requete));
            code.mesures.forEach((m, i) => d.appendChild(this.blocCode(
                `Mesure${code.mesures.length > 1 ? ` ${i + 1}` : ""} « ${m.nom} » : Modélisation > Nouvelle mesure > remplacer tout le texte`, m.code)));
            for (const n of code.notes) d.appendChild(h("p", "ia-meta", n));
        } catch (e) {
            d.appendChild(h("p", "ia-meta", e instanceof DaxIndisponible ? e.message : `DAX indisponible : ${message(e)}`));
        }
        return d;
    }

    private blocCode(titre: string, code: string): HTMLElement {
        const bloc = h("div", "ia-code");
        const tete = h("div", "ia-code-tete");
        tete.appendChild(h("span", "ia-meta", titre));
        const zone = zoneTexte(code, Math.min(14, code.split("\n").length + 1), titre);
        const b = h("button", "ia-chip", "Copier", { type: "button" });
        b.onclick = () => { b.textContent = copier(zone) ? "Copié ✓" : "Sélectionné : Ctrl+C"; };
        tete.appendChild(b);
        bloc.appendChild(tete);
        bloc.appendChild(zone);
        return bloc;
    }

    // ---------- rapport : synthèse + texte complet à copier (Power BI bloque les téléchargements depuis les visuels) ----------

    private async genererRapport() {
        const ds = this.ds;
        const faites = this.tours.filter(t => t.type === "reponse");
        if (!ds || this.occupe || !faites.length) return;
        this.commencer();
        const box = this.carteAttente(`Je rédige le rapport à partir de tes ${faites.length} analyse${faites.length > 1 ? "s" : ""}…`);

        let syn: Synthese | null = null, erreurSyn = "";
        try {
            syn = await synthese(this.tours, this.appel());
        } catch (e) {
            erreurSyn = message(e);
        }

        vider(box);
        box.appendChild(h("div", "ia-titre", "Rapport d'analyse"));
        if (syn) {
            box.appendChild(h("p", "ia-texte", syn.synthese));
            const ul = h("ul", "ia-constats");
            for (const c of syn.constats) ul.appendChild(h("li", undefined, c));
            box.appendChild(ul);
            if (syn.nonVerifies.length) box.appendChild(h("span", "ia-badge ia-ko", `Chiffres non retrouvés : ${syn.nonVerifies.join(", ")}`));
        } else {
            box.appendChild(h("p", "ia-texte", `Synthèse indisponible (${erreurSyn}). Le rapport ci-dessous contient quand même le détail de chaque analyse.`));
        }

        // le rapport complet en texte : à copier dans Word, puis Fichier > Enregistrer sous > PDF
        const texte = rapportTexte({ date: new Date(), lignes: ds.rows.length, colonnes: ds.cols.map(c => c.name), filtreRapport: this.filtreActif || undefined }, this.tours, syn);
        const zone = zoneTexte(texte, 10, "Rapport en texte");
        const bouton = h("button", "ia-envoyer", "Copier le rapport", { type: "button" });
        const info = h("span", "ia-meta", "Colle-le dans Word (Ctrl+V), puis Fichier > Enregistrer sous > PDF.");
        bouton.onclick = () => {
            info.textContent = copier(zone)
                ? "Copié ✓ Colle-le dans Word (Ctrl+V), puis Fichier > Enregistrer sous > PDF."
                : "Le texte est sélectionné : fais Ctrl+C, puis colle-le dans Word (Ctrl+V).";
        };
        const barre = h("div", "ia-filtres");
        barre.appendChild(bouton);
        barre.appendChild(info);
        box.appendChild(barre);
        box.appendChild(zone);
        this.terminer();
    }
}
