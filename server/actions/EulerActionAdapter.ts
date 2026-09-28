import type { ActionType } from "../../shared/types";
import { ChatSendError, MUTE_DURATIONS, type EulerChatSender, type MuteDuration } from "../chat/EulerChat";
import { TikTokManualActionAdapter } from "./adapters";
import { bilingual, type ActionCapability, type ActionResult, type ActionTarget, type ModerationActionAdapter } from "./ModerationActionAdapter";

/*
 * TikTok moderation through Euler Stream's documented moderation API, as the moderator
 * account connected in Settings (it must be a moderator of the LIVE — TikTok enforces it).
 *
 *  - mute  → PUT /webcast/rooms/{room}/moderation/mutes   (5 s … 5 min, or until unmuted)
 *  - block → PUT /webcast/rooms/{room}/moderation/bans    (removes the viewer from the LIVE)
 *
 * Success is reported only when TikTok accepted the action. Anything else (not connected,
 * no moderation permission, not a moderator of this LIVE, LIVE over…) falls back to the
 * exact manual steps with the reason — never a fake success. Warn and report stay manual
 * (a warning can be posted with "Send in chat"; TikTok reports go through the app).
 */
export class EulerActionAdapter implements ModerationActionAdapter {
  readonly id = "tiktok-euler";
  private manual = new TikTokManualActionAdapter();

  constructor(
    private deps: {
      chat: () => EulerChatSender | undefined;
      /** TikTok room id of the account's current LIVE. */
      roomId: () => string | undefined;
    },
  ) {}

  capabilities(): Record<ActionType, ActionCapability> {
    return { ...this.manual.capabilities(), mute: "automated", block: "automated" };
  }

  watch = (t: ActionTarget) => this.manual.watch(t);
  dismiss = (t: ActionTarget) => this.manual.dismiss(t);
  warn = (t: ActionTarget) => this.manual.warn(t);
  report = (t: ActionTarget) => this.manual.report(t);

  async mute(t: ActionTarget): Promise<ActionResult> {
    const seconds: MuteDuration = (MUTE_DURATIONS as readonly number[]).includes(t.muteSeconds ?? NaN) ? (t.muteSeconds as MuteDuration) : 300;
    const u = `@${t.viewer.username}`;
    const len = { en: seconds === -1 ? "until unmuted" : seconds >= 60 ? `${seconds / 60} min` : `${seconds} s`, fr: seconds === -1 ? "jusqu'à nouvel ordre" : seconds >= 60 ? `${seconds / 60} min` : `${seconds} s` };
    return this.run(t, "mute", (chat, room, uid) => chat.mute(room, uid, seconds), {
      en: `${u} muted in TikTok (${len.en}).`,
      fr: `${u} mis en sourdine dans TikTok (${len.fr}).`,
    });
  }

  async block(t: ActionTarget): Promise<ActionResult> {
    const u = `@${t.viewer.username}`;
    return this.run(t, "block", (chat, room, uid) => chat.kick(room, uid), {
      en: `${u} removed from the LIVE in TikTok.`,
      fr: `${u} retiré(e) du LIVE dans TikTok.`,
    });
  }

  private async run(t: ActionTarget, action: "mute" | "block", call: (chat: EulerChatSender, roomId: string, userId: string) => Promise<void>, done: { en: string; fr: string }): Promise<ActionResult> {
    const chat = this.deps.chat();
    const roomId = this.deps.roomId();
    // TikTok needs the viewer's numeric id (kept from the LIVE's events as "tt:<id>").
    const userId = /^tt:(\d{5,25})$/.exec(t.viewer.id)?.[1];
    if (!chat || !(await chat.canModerate()) || !roomId || !userId) return this.manual[action](t);
    try {
      await call(chat, roomId, userId);
      return bilingual("executed", t.language, { message: done.en }, { message: done.fr });
    } catch (e) {
      const fallback = await this.manual[action](t);
      const code = e instanceof ChatSendError ? e.code : "chat_failed";
      const detail = e instanceof Error && e.message !== code ? ` (${e.message})` : "";
      const why = {
        en: code === "mod_refused" ? `TikTok refused — is your connected account a moderator of this LIVE?${detail}` : code === "mod_reconnect" ? "Reconnect the TikTok account in Settings to allow moderation." : `The action could not be sent${detail}.`,
        fr: code === "mod_refused" ? `TikTok a refusé — ton compte connecté est-il modérateur de ce LIVE ?${detail}` : code === "mod_reconnect" ? "Reconnecte le compte TikTok dans Réglages pour autoriser la modération." : `L'action n'a pas pu être envoyée${detail}.`,
      };
      const en = fallback.i18n?.en ?? { message: fallback.message };
      const fr = fallback.i18n?.fr ?? { message: fallback.message };
      return bilingual("manual_required", t.language, { ...en, message: `${why.en} ${en.message}` }, { ...fr, message: `${why.fr} ${fr.message}` });
    }
  }
}
