import type { LiveEvent, ViewerRef } from "../../shared/types";
import { createRng, pick } from "./rng";

// Realistic, deterministic demo chat: normal conversation interleaved with a
// scripted timeline of incidents so Novus can be seen detecting problems live.

const ADJ = ["lunar", "velvet", "neon", "quiet", "golden", "wild", "cosmic", "silver", "sunny", "mellow", "rapid", "misty", "lucky", "brave", "chill", "pixel", "retro", "frosty", "happy", "noble"];
const NOUN = ["fox", "otter", "wave", "panda", "rider", "echo", "petal", "comet", "tiger", "maple", "drift", "sparrow", "koala", "lynx", "falcon", "ember", "river", "moth", "nova", "cloud"];

const CHATTER = [
  "hiii from Paris 👋",
  "love this stream ❤️",
  "the new application looks so clean",
  "this is fire 🔥🔥",
  "hello everyone!",
  "gg",
  "omg the design 😍",
  "just got here, what did I miss?",
  "Discord gang where you at",
  "trop bien ce live",
  "salut tout le monde 👋",
  "the dark mode is gorgeous",
  "lol that transition",
  "so hyped for the release",
  "wow 😮",
  "can't wait to try the app",
  "greetings from Montréal 🇨🇦",
  "this music tho 🎶",
  "the new app UI is insane",
  "l'application a l'air incroyable",
  "been waiting all week for this live",
  "you're doing amazing 👏",
  "respect for the work 🙌",
  "is the beta free?",
  "lets goooo",
  "merci pour le live ❤️",
  "the Pulse Engine demo was crazy",
  "saving this for later",
  "who else is from Belgium?",
  "the app looks premium fr",
];

const QUESTIONS = [
  "When does the new app launch?",
  "when is the release date??",
  "what's the release date for the application?",
  "Is there a Discord?",
  "what's the discord link?",
  "How much will the app cost?",
  "Is it on Android too?",
  "Quand sort l'application ?",
  "Y a un discord ?",
  "can you show the new features?",
  "does it work on iPhone?",
  "is there a waitlist for the beta?",
  "c'est combien l'appli ?",
];

const REQUESTS = ["pls say hi to my sister Lena!", "can you show the dashboard again?", "shoutout pls 🙏", "play the intro song again pls", "tu peux montrer le mode sombre ?"];

interface ScriptItem {
  at: number; // demo seconds within a cycle
  user: string;
  kind: "comment" | "gift" | "follow";
  text?: string;
  gift?: { name: string; count: number; value: number };
}

export const DEMO_CYCLE_SECONDS = 200;

export const DEMO_SCRIPT: ScriptItem[] = [
  { at: 8, user: "first_timer_mia", kind: "comment", text: "first time here, love the vibe ✨" },
  { at: 10, user: "golden_patron", kind: "gift", gift: { name: "Lion", count: 1, value: 29999 } },
  { at: 15, user: "promo_kingz_77", kind: "comment", text: "follow me for free followers 🔥 check my profile" },
  { at: 17, user: "promo_kingz_77", kind: "comment", text: "follow me for free followers 🔥 check my profile" },
  { at: 19, user: "promo_kingz_77", kind: "comment", text: "follow me for free followers 🔥🔥 check my profile" },
  { at: 21, user: "promo_kingz_77", kind: "comment", text: "FOLLOW ME FOR FREE FOLLOWERS 🔥 CHECK MY PROFILE" },
  { at: 30, user: "banter_bro", kind: "comment", text: "lol you're such a clown for that transition 😂" },
  { at: 38, user: "grumpy_dan", kind: "comment", text: "this stream is boring, you're kinda dumb" },
  { at: 45, user: "shadow_vex", kind: "comment", text: "you're so annoying honestly" },
  { at: 55, user: "shadow_vex", kind: "comment", text: "nobody likes you, just quit" },
  { at: 60, user: "diamond_drop_official", kind: "comment", text: "FREE 10k coins 💎 claim at bit.ly/free-coinz dm me to claim" },
  { at: 65, user: "shadow_vex", kind: "comment", text: "shut up you pathetic clown" },
  { at: 72, user: "diamond_drop_official", kind: "comment", text: "FREE 10k coins 💎 claim at bit.ly/free-coinz dm me to claim" },
  { at: 78, user: "shadow_vex", kind: "comment", text: "i know what city you're in 👀" },
  { at: 90, user: "shadow_vex", kind: "comment", text: "give me your address i'll come find you" },
  { at: 100, user: "leak_master", kind: "comment", text: "her real address is 42 rue de la Paix lol" },
  { at: 106, user: "leak_master", kind: "comment", text: "call her 06 12 34 56 78 😂" },
  { at: 115, user: "raid_crew_1", kind: "comment", text: "L STREAM 💀💀 raid time" },
  { at: 115.5, user: "raid_crew_2", kind: "comment", text: "L STREAM 💀💀 raid time" },
  { at: 116, user: "raid_crew_3", kind: "comment", text: "L STREAM 💀 raid time" },
  { at: 116.4, user: "raid_crew_4", kind: "comment", text: "L STREAM 💀💀 raid time" },
  { at: 117, user: "raid_crew_5", kind: "comment", text: "l stream 💀💀 RAID TIME" },
  { at: 117.3, user: "raid_crew_6", kind: "comment", text: "L STREAM 💀💀 raid time" },
  { at: 118, user: "raid_crew_7", kind: "comment", text: "L STREAM 💀💀💀 raid time" },
  { at: 118.6, user: "raid_crew_8", kind: "comment", text: "L STREAM 💀💀 raid time" },
  { at: 125, user: "novarys", kind: "comment", text: "Release date is next Friday! Discord link is in my bio 🖤" },
  { at: 130, user: "novarys_officiall", kind: "comment", text: "This is my backup account, send gifts here 🎁" },
  { at: 140, user: "thirsty_42", kind: "comment", text: "send pics 😏 show me your body" },
  { at: 150, user: "le_troll_fr", kind: "comment", text: "t'es nul, ferme-la" },
  { at: 160, user: "le_troll_fr", kind: "comment", text: "je sais où tu habites" },
  { at: 170, user: "golden_patron", kind: "comment", text: "Novarys this project is genuinely inspiring, been following since day one 👑" },
  { at: 175, user: "crypto_mentor_x", kind: "comment", text: "double your money with my crypto signal, whatsapp me +33 7 11 22 33 44" },
];

/** Offender accounts get a new suffix on every cycle so each cycle is a fresh set of incidents. */
const RECURRING_USERS = new Set(["golden_patron", "novarys"]);

export interface DemoGeneratorOptions {
  seed?: number;
  speed?: number;
}

export class DemoTrafficGenerator {
  private rng: () => number;
  private demoMs = 0;
  private chatterAcc = 0;
  private scriptCursor = 0;
  private cycle = 0;
  private seq = 0;
  private viewerCount = 140;
  private lastViewerEmit = -10_000;
  private pool: ViewerRef[] = [];
  speed: number;

  constructor(opts: DemoGeneratorOptions = {}) {
    this.rng = createRng(opts.seed ?? 42);
    this.speed = opts.speed ?? 1;
  }

  get demoSecond(): number {
    return Math.floor(this.demoMs / 1000);
  }

  private viewer(username: string): ViewerRef {
    return { id: `mock:${username}`, username, displayName: username };
  }

  private poolViewer(): ViewerRef {
    const target = Math.round(70 * Math.max(1, this.speed));
    while (this.pool.length < target) {
      const i = this.pool.length;
      const name = `${ADJ[i % ADJ.length]}_${NOUN[Math.floor(i / ADJ.length) % NOUN.length]}${i >= 400 ? i : ""}`;
      this.pool.push(this.viewer(name));
    }
    return this.pool[Math.floor(this.rng() * target)];
  }

  private id(sessionId: string): string {
    this.seq += 1;
    return `${sessionId}-m${this.seq}`;
  }

  private chatterText(): string {
    const r = this.rng();
    if (r < 0.22) return pick(this.rng, QUESTIONS);
    if (r < 0.28) return pick(this.rng, REQUESTS);
    return pick(this.rng, CHATTER);
  }

  private scripted(item: ScriptItem, sessionId: string, now: number): LiveEvent {
    const suffix = this.cycle > 0 && !RECURRING_USERS.has(item.user) ? String(this.cycle + 1) : "";
    const v = this.viewer(item.user + suffix);
    const base = { id: this.id(sessionId), sessionId, platform: "mock" as const, timestamp: now };
    if (item.kind === "gift" && item.gift) return { ...base, type: "gift", viewer: v, giftName: item.gift.name, count: item.gift.count, value: item.gift.value };
    if (item.kind === "follow") return { ...base, type: "follow", viewer: v };
    return { ...base, type: "comment", viewer: v, text: item.text ?? "" };
  }

  /** Advance the demo clock by `realMs * speed` and return the events that occurred. */
  advance(realMs: number, sessionId: string, now: number): LiveEvent[] {
    const dt = realMs * this.speed;
    const out: LiveEvent[] = [];
    this.demoMs += dt;

    // Scripted incidents (cycle through the script).
    for (;;) {
      const cycleStart = this.cycle * DEMO_CYCLE_SECONDS * 1000;
      const item = DEMO_SCRIPT[this.scriptCursor];
      if (!item) {
        if (this.demoMs >= cycleStart + DEMO_CYCLE_SECONDS * 1000) {
          this.cycle += 1;
          this.scriptCursor = 0;
          continue;
        }
        break;
      }
      if (cycleStart + item.at * 1000 > this.demoMs) break;
      out.push(this.scripted(item, sessionId, now));
      this.scriptCursor += 1;
    }

    // Background chatter (~1.3 msg per demo second), plus joins/follows/gifts.
    this.chatterAcc += (dt / 1000) * 1.3;
    while (this.chatterAcc >= 1) {
      this.chatterAcc -= 1;
      const v = this.poolViewer();
      const base = { id: this.id(sessionId), sessionId, platform: "mock" as const, timestamp: now };
      const r = this.rng();
      if (r < 0.9) out.push({ ...base, type: "comment", viewer: v, text: this.chatterText() });
      else if (r < 0.95) out.push({ ...base, type: "join", viewer: v });
      else if (r < 0.98) out.push({ ...base, type: "follow", viewer: v });
      else out.push({ ...base, type: "gift", viewer: v, giftName: pick(this.rng, ["Rose", "Heart", "Galaxy", "Finger Heart"]), count: 1 + Math.floor(this.rng() * 5), value: 1 + Math.floor(this.rng() * 20) });
    }

    // Viewer count drifts with the traffic level, emitted every ~5 demo seconds.
    if (this.demoMs - this.lastViewerEmit >= 5000) {
      this.lastViewerEmit = this.demoMs;
      const target = 140 * Math.max(1, this.speed) + 40;
      this.viewerCount = Math.max(12, Math.round(this.viewerCount + (target - this.viewerCount) * 0.15 + (this.rng() - 0.45) * 12));
      out.push({ id: this.id(sessionId), sessionId, platform: "mock", timestamp: now, type: "viewer_count", count: this.viewerCount });
    }
    return out;
  }
}
