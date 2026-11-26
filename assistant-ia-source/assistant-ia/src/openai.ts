"use strict";

// Même rôle que gemini.ts, avec l'API OpenAI (Chat Completions) : on n'envoie jamais le tableau,
// seulement la description des colonnes ou les quelques lignes d'un résultat.

import { lireJson, Message, Reponse } from "./gemini";

export class OpenAIError extends Error { }

const URL = "https://api.openai.com/v1/chat/completions";
// rapides et sans raisonnement d'abord ; si un nom n'existe plus (404), on passe au suivant
const SECOURS = ["gpt-4.1-mini", "gpt-4o-mini", "gpt-5-mini"];
const ATTENTE_MAX = 30_000;

const ecartes = new Map<string, number>();

export async function demanderOpenAI(cle: string, modele: string, systeme: string, messages: Message[]): Promise<Reponse> {
    // un nom de modèle Gemini resté dans le volet Format est ignoré
    const choisi = /^gemini/i.test(modele) ? "" : modele;
    const tous = [...new Set([choisi, ...SECOURS].filter(Boolean))];
    const dispo = tous.filter(m => (ecartes.get(m) || 0) < Date.now());
    let derniere = "";
    for (const m of dispo.length ? dispo : tous) {
        const body = JSON.stringify({
            model: m,
            messages: [{ role: "system", content: systeme }, ...messages.map(x => ({ role: x.role === "model" ? "assistant" : "user", content: x.text }))],
            response_format: { type: "json_object" }
        });
        let r: Response;
        const stop = new AbortController();
        const minuteur = setTimeout(() => stop.abort(), ATTENTE_MAX);
        try {
            r = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cle}` }, body, signal: stop.signal });
        } catch (e) {
            derniere = stop.signal.aborted ? `OpenAI (${m}) met trop de temps à répondre.` : "Impossible de joindre OpenAI (réseau, ou adresse bloquée par ton organisation).";
            continue;
        } finally {
            clearTimeout(minuteur);
        }
        if (r.status === 401 || r.status === 403) throw new OpenAIError("Ta clé API OpenAI est refusée. Vérifie-la dans Format > Assistant IA.");
        if (r.status === 404) { derniere = `Le modèle « ${m} » n'est pas disponible avec ta clé.`; ecartes.set(m, Date.now() + 3600_000); continue; }
        if (r.status === 429) {
            const t = await r.text();
            if (/insufficient_quota|billing/i.test(t)) throw new OpenAIError("Ton compte OpenAI n'a plus de crédit (platform.openai.com > Billing).");
            derniere = "Limite d'appels OpenAI atteinte. Attends une minute.";
            continue;
        }
        if (r.status === 400) {
            const t = await r.text();
            if (/model/i.test(t) && /not (exist|found|supported)|does not have access/i.test(t)) { derniere = `Le modèle « ${m} » n'est pas disponible avec ta clé.`; ecartes.set(m, Date.now() + 3600_000); continue; }
            throw new OpenAIError(`OpenAI a refusé la demande (400).`);
        }
        if (!r.ok) { derniere = `OpenAI a répondu ${r.status}.`; continue; }
        const data = await r.json();
        const texte = String(data?.choices?.[0]?.message?.content || "");
        return { json: lireJson(texte), modele: String(data?.model || m), tokens: data?.usage?.total_tokens || 0 };
    }
    throw new OpenAIError(derniere || "OpenAI n'a pas répondu.");
}
