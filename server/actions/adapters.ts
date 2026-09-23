import type { ActionType } from "../../shared/types";
import {
  warningMessage,
  type ActionCapability,
  type ActionResult,
  type ActionTarget,
  type ModerationActionAdapter,
} from "./ModerationActionAdapter";

// Local-only actions (watch / dismiss) are pure bookkeeping inside Novus.
const local = {
  watch: async (t: ActionTarget): Promise<ActionResult> => ({
    status: "recorded",
    message: t.language === "fr" ? `@${t.viewer.username} ajouté à la surveillance.` : `@${t.viewer.username} is now being watched.`,
  }),
  dismiss: async (t: ActionTarget): Promise<ActionResult> => ({
    status: "recorded",
    message: t.language === "fr" ? "Alerte ignorée." : `Alert for @${t.viewer.username} dismissed.`,
  }),
};

/** Demo mode: actions apply to the mock platform only and are labelled as simulated. */
export class SimulatedActionAdapter implements ModerationActionAdapter {
  readonly id = "mock-platform";

  constructor(private onApply?: (action: ActionType, target: ActionTarget) => void) {}

  capabilities(): Record<ActionType, ActionCapability> {
    return { watch: "local", dismiss: "local", warn: "simulated", mute: "simulated", block: "simulated", report: "simulated" };
  }

  private sim(action: ActionType, t: ActionTarget, extra: Partial<ActionResult> = {}): ActionResult {
    this.onApply?.(action, t);
    return {
      status: "simulated",
      message: `${action.toUpperCase()} applied to @${t.viewer.username} on the demo platform (simulation — nothing was sent to TikTok).`,
      ...extra,
    };
  }

  watch = local.watch;
  dismiss = local.dismiss;
  async warn(t: ActionTarget) {
    return this.sim("warn", t, { suggestedMessage: warningMessage(t.viewer.username, t.language) });
  }
  async mute(t: ActionTarget) {
    return this.sim("mute", t);
  }
  async block(t: ActionTarget) {
    return this.sim("block", t);
  }
  async report(t: ActionTarget) {
    return this.sim("report", t);
  }
}

/**
 * TikTok: no authorized public API is available to Novus for moderator actions,
 * so every platform action is MANUAL ACTION REQUIRED with exact in-app steps.
 * When an approved TikTok moderation API becomes available, implement it in a new
 * adapter and flip capabilities to "automated" — the rest of the app is unchanged.
 */
export class TikTokManualActionAdapter implements ModerationActionAdapter {
  readonly id = "tiktok-manual";

  capabilities(): Record<ActionType, ActionCapability> {
    return { watch: "local", dismiss: "local", warn: "manual", mute: "manual", block: "manual", report: "manual" };
  }

  watch = local.watch;
  dismiss = local.dismiss;

  private manual(t: ActionTarget, en: { msg: string; steps: string[] }, fr: { msg: string; steps: string[] }, suggestedMessage?: string): ActionResult {
    const copy = t.language === "fr" ? fr : en;
    return { status: "manual_required", message: copy.msg, instructions: copy.steps, suggestedMessage };
  }

  async warn(t: ActionTarget) {
    const u = `@${t.viewer.username}`;
    return this.manual(
      t,
      {
        msg: `MANUAL ACTION REQUIRED — post a warning to ${u} in the TikTok LIVE chat.`,
        steps: ["Open the TikTok LIVE chat.", "Tap the comment field.", `Paste the suggested warning addressed to ${u} and send it.`],
      },
      {
        msg: `ACTION MANUELLE REQUISE — avertis ${u} dans le chat du LIVE TikTok.`,
        steps: ["Ouvre le chat du LIVE TikTok.", "Touche le champ de commentaire.", `Colle l'avertissement suggéré pour ${u} et envoie-le.`],
      },
      warningMessage(t.viewer.username, t.language),
    );
  }

  async mute(t: ActionTarget) {
    const u = `@${t.viewer.username}`;
    return this.manual(
      t,
      {
        msg: `MANUAL ACTION REQUIRED — mute ${u} inside TikTok LIVE.`,
        steps: [
          `In the TikTok LIVE chat, tap ${u}'s comment or username.`,
          "In the profile card, tap Mute.",
          "Choose a duration (recommended: 5 minutes for a first offence).",
          "Come back to Novus and tap “Done in TikTok”.",
        ],
      },
      {
        msg: `ACTION MANUELLE REQUISE — mets ${u} en sourdine dans le LIVE TikTok.`,
        steps: [
          `Dans le chat du LIVE TikTok, touche le commentaire ou le pseudo de ${u}.`,
          "Dans la fiche, touche « Mettre en sourdine » (Mute).",
          "Choisis une durée (conseillé : 5 minutes pour une première fois).",
          "Reviens dans Novus et touche « Fait dans TikTok ».",
        ],
      },
    );
  }

  async block(t: ActionTarget) {
    const u = `@${t.viewer.username}`;
    return this.manual(
      t,
      {
        msg: `MANUAL ACTION REQUIRED — block/remove ${u} from the LIVE inside TikTok.`,
        steps: [
          `In the TikTok LIVE chat, tap ${u}'s comment or username.`,
          "In the profile card, tap Block (removes them from this LIVE).",
          "If the behaviour is threatening, also Report (see REPORT).",
          "Come back to Novus and tap “Done in TikTok”.",
        ],
      },
      {
        msg: `ACTION MANUELLE REQUISE — bloque / retire ${u} du LIVE dans TikTok.`,
        steps: [
          `Dans le chat du LIVE TikTok, touche le commentaire ou le pseudo de ${u}.`,
          "Dans la fiche, touche « Bloquer » (retire la personne du LIVE).",
          "Si c'est menaçant, signale aussi (voir SIGNALER).",
          "Reviens dans Novus et touche « Fait dans TikTok ».",
        ],
      },
    );
  }

  async report(t: ActionTarget) {
    const u = `@${t.viewer.username}`;
    const reason = t.reasons?.[0] ?? "the most relevant reason";
    return this.manual(
      t,
      {
        msg: `MANUAL ACTION REQUIRED — report ${u} to TikTok.`,
        steps: [
          `In the TikTok LIVE chat, tap ${u}'s comment or username.`,
          "Tap Report.",
          `Pick the category matching: ${reason}.`,
          "Submit, then block the viewer if they are still active.",
          "If someone is in immediate danger, contact local emergency services.",
        ],
      },
      {
        msg: `ACTION MANUELLE REQUISE — signale ${u} à TikTok.`,
        steps: [
          `Dans le chat du LIVE TikTok, touche le commentaire ou le pseudo de ${u}.`,
          "Touche « Signaler ».",
          `Choisis la catégorie correspondant à : ${reason}.`,
          "Envoie, puis bloque la personne si elle est encore active.",
          "En cas de danger immédiat, contacte les services d'urgence.",
        ],
      },
    );
  }
}
