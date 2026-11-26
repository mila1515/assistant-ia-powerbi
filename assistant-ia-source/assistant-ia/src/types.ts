"use strict";

// Types partagés par tout le pipeline. Aucun import Power BI ici : ces modules se testent dans Node.

export type Kind = "texte" | "nombre" | "date" | "booleen";
export type Cell = string | number | boolean | Date | null;

export interface Col {
    name: string;
    kind: Kind;
    role: "colonne" | "valeur";
    cible?: { table: string; colonne: string };   // colonne du modèle Power BI, pour filtrer le rapport
}

export interface Dataset {
    cols: Col[];
    rows: Cell[][];
}

export type Periode = "annee" | "trimestre" | "mois" | "jour";
export type Operation = "somme" | "moyenne" | "min" | "max" | "nombre_lignes" | "nombre_distinct";
export type FiltreOp = "=" | "!=" | "in" | ">" | ">=" | "<" | "<=" | "entre" | "contient";

export interface Regroupement {
    colonne: string;
    periode?: Periode | null;
}

export interface Filtre {
    colonne: string;
    op: FiltreOp;
    valeur?: unknown;
    valeurs?: unknown[];
    periode?: Periode | null;
}

export interface Plan {
    action: "calcul" | "impossible";
    raison?: string;
    suggestions?: string[];
    operation?: Operation;
    mesure?: string | null;
    par?: Regroupement[];
    filtres?: Filtre[];
    tri?: "desc" | "asc" | "chrono";
    limite?: number;
    part_du_total?: boolean;
}

export type Out = string | number | null;

export interface Resultat {
    colonnes: string[];        // libellés : regroupements, puis la valeur, puis la part éventuelle
    lignes: Out[][];
    nbCles: number;            // nombre de colonnes de regroupement en tête de chaque ligne
    total: number | null;      // même opération sur toutes les lignes filtrées
    nbLignesSource: number;    // lignes après filtres
    nbGroupes: number;         // groupes avant la limite
    temporel: boolean;         // le premier regroupement est une période
    avecPart: boolean;
}
