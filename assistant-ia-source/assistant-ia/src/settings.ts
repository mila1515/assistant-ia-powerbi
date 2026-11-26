"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export const MODELE_PAR_DEFAUT = "gemini-3.1-flash-lite";

class IaCard extends FormattingSettingsCard {
    apiKey = new formattingSettings.TextInput({
        name: "apiKey",
        displayName: "Clé API (Gemini ou OpenAI)",
        placeholder: "AIza… (Gemini) ou sk-… (OpenAI)",
        value: ""
    });

    modele = new formattingSettings.TextInput({
        name: "modele",
        displayName: "Modèle IA",
        placeholder: MODELE_PAR_DEFAUT,
        value: MODELE_PAR_DEFAUT
    });

    exemples = new formattingSettings.ToggleSwitch({
        name: "exemples",
        displayName: "Envoyer des exemples de valeurs",
        value: true
    });

    maxLignes = new formattingSettings.NumUpDown({
        name: "maxLignes",
        displayName: "Lignes max chargées",
        value: 30000
    });

    name: string = "ia";
    displayName: string = "Assistant IA";
    slices: Array<FormattingSettingsSlice> = [this.apiKey, this.modele, this.exemples, this.maxLignes];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    iaCard = new IaCard();
    cards = [this.iaCard];
}
