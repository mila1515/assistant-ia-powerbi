"use strict";

// Choix du fournisseur d'après la clé collée dans le volet Format :
// « sk-… » est une clé OpenAI, « AIza… » une clé Gemini.

import { demanderGemini, Message, Reponse } from "./gemini";
import { demanderOpenAI } from "./openai";

export function fournisseur(cle: string): "OpenAI" | "Gemini" {
    return /^sk-/.test(cle.trim()) ? "OpenAI" : "Gemini";
}

export async function demander(cle: string, modele: string, systeme: string, messages: Message[]): Promise<Reponse> {
    cle = cle.trim();
    if (!cle) throw new Error("Ajoute ta clé API (Gemini ou OpenAI) dans Format > Assistant IA.");
    return fournisseur(cle) === "OpenAI"
        ? demanderOpenAI(cle, modele, systeme, messages)
        : demanderGemini(cle, modele, systeme, messages);
}
