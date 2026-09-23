import type { Category } from "../../shared/types";

// Known patterns, English + French. Patterns run on normalize()d text
// (lowercase, accents stripped). They are *signals*, not verdicts: the
// heuristic scorer combines them with per-viewer and room context.

export interface PatternRule {
  category: Category;
  weight: number; // 0..1 contribution before contextual modifiers
  reason: string;
  re: RegExp;
  /** Pattern only counts when the message is directed at someone (you / @mention / tu). */
  needsTarget?: boolean;
}

/** Second-person / directed-at-someone markers. */
export const TARGET_RE =
  /(^|\s)(you|u|ur|youre|you're|your|yours|ya|tu|t'es|tes|te|toi|ton|ta|vous|votre)(\s|$|[!?.,])|@\w+|\bshe\b|\bher\b|\bhe\b|\bhim\b|\belle\b/;

export const MITIGATION_RE = /\b(lol|lmao|jk|just kidding|haha+|mdr|ptdr|jpp|xd)\b|😂|🤣|😆/;

export const PATTERNS: PatternRule[] = [
  // ---- threats -------------------------------------------------------------
  {
    category: "threat",
    weight: 0.7,
    reason: "Targeted threat",
    re: /\b(i('?ll| will| am going to|m going to|m gonna| gonna)|we('?ll| will| gonna))\s+(come\s+(and\s+)?)?(find|get|hurt|kill|beat|end|visit|hunt|catch|smash|come (for|to|find|get))\b/,
  },
  { category: "threat", weight: 0.75, reason: "Death threat", re: /\b(kill (you|u|her|him|urself|yourself)|you('?re| are) dead|kys|gonna die|watch your back)\b/ },
  { category: "threat", weight: 0.7, reason: "Location threat", re: /\b(i know where (you|u) live|i know (your|ur) (address|house|school)|coming to (your|ur) (house|home|place))\b/ },
  {
    category: "threat",
    weight: 0.75,
    reason: "Targeted threat (FR)",
    re: /\b(je vais (te|la|le) (tuer|retrouver|trouver|frapper|defoncer|buter)|t'?es mort|je sais ou tu (habites|vis)|on va te (trouver|retrouver))\b/,
  },

  // ---- doxxing / personal info ----------------------------------------------
  {
    category: "doxxing",
    weight: 0.5,
    reason: "Requests personal info",
    re: /\b(give|send|tell|drop|what'?s|whats) (me )?(your|ur|her|his) (address|home address|phone|number|school|real name|location|ip)\b|\bwhere (do )?(you|u) (live|stay)\b/,
  },
  { category: "doxxing", weight: 0.45, reason: "Requests personal info (FR)", re: /\b(ton adresse|ton numero|tu habites ou|ou tu habites|ton vrai nom|ton ecole)\b/ },
  { category: "doxxing", weight: 0.7, reason: "Shares an address", re: /\b\d{1,5}\s+(rue|avenue|av|boulevard|bd|chemin|street|st|road|rd|lane|ln|drive|dr|ave)\b/ },
  { category: "doxxing", weight: 0.65, reason: "Shares a phone number", re: /(\+?\d[\d .-]{8,}\d)/ },
  { category: "doxxing", weight: 0.35, reason: "Shares an email", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/ },
  { category: "doxxing", weight: 0.45, reason: "Exposes identity", re: /\b(her|his|their) (real )?(name|address|school|job) is\b|\b(sa vraie adresse|son vrai nom|il habite|elle habite)\b/ },

  // ---- insults / harassment -------------------------------------------------
  {
    category: "insult",
    weight: 0.25,
    reason: "Insult",
    re: /\b(idiot|stupid|dumb|moron|loser|clown|pathetic|trash|garbage|ugly|fat|worthless|useless|cringe|l+ozer|braindead|dumbass|fool|annoying|irritating|embarrassing)\b/,
    needsTarget: true,
  },
  {
    category: "insult",
    weight: 0.3,
    reason: "Insult (FR)",
    re: /\b(connard|connasse|conne|debile|abruti|idiote|nul(le)?|bouffon|cassos|clochard|moche|grosse?|boloss|teube|relou|chiante?|saoulante?)\b/,
    needsTarget: true,
  },
  { category: "insult", weight: 0.3, reason: "Hostile dismissal", re: /\b(shut up|stfu|shut your mouth|ferme[- ]la|ta gueule|tg)\b/ },
  {
    category: "harassment",
    weight: 0.5,
    reason: "Targeted harassment",
    re: /\b(nobody (likes|wants|cares about) (you|u)|everyone hates (you|u)|just quit|go away forever|you should (quit|leave|disappear)|personne t'?aime|casse[- ]toi|degage)\b/,
  },
  { category: "harassment", weight: 0.45, reason: "Self-harm encouragement", re: /\b(kill yourself|go die|end it|va mourir|creve)\b/ },

  // ---- hate / abusive ------------------------------------------------------------
  {
    category: "hate",
    weight: 0.6,
    reason: "Hateful / dehumanizing",
    re: /\b(go back to (your|ur) country|your kind|you people are|subhuman|vermin|animals like you|retourne dans ton pays|sale race)\b/,
  },

  // ---- sexual harassment ----------------------------------------------------
  {
    category: "sexual_harassment",
    weight: 0.62,
    reason: "Sexual harassment",
    re: /\b(send (me )?(nudes|pics|feet pics|pictures)|show (me )?(your|ur) (body|feet|boobs|ass|legs)|take it off|sit on my|envoie (des )?(nudes|photos)|montre (tes|ton) (seins|corps|fesses)|t'?es bonne)\b/,
  },
  { category: "sexual_harassment", weight: 0.3, reason: "Sexualized remark", re: /\b(sexy|hot af|daddy|mommy)\b|👅|🍆|🍑|😏/u, needsTarget: true },

  // ---- scams -----------------------------------------------------------------
  {
    category: "scam",
    weight: 0.45,
    reason: "Free-reward scam",
    re: /\b(free|gratuit[s]?)\s+(\d+k?\s+)?(coins|diamonds|followers|gifts|robux|vbucks|v-bucks|money|iphone|pieces|abonnes)\b/,
  },
  {
    category: "scam",
    weight: 0.4,
    reason: "Off-platform lure",
    re: /\b(dm me to (win|claim|get)|claim (your|ur) (prize|reward)|whatsapp me|add me on telegram|text me on|contacte[- ]moi sur (whatsapp|telegram))\b/,
  },
  { category: "scam", weight: 0.45, reason: "Investment scam", re: /\b(double (your|ur) (money|crypto|btc)|guaranteed (profit|returns)|crypto (signal|investment)|invest with me|forex mentor)\b/ },
  { category: "scam", weight: 0.3, reason: "Giveaway bait", re: /\b(giveaway|winner|you won|tu as gagne|gagnant)\b.*\b(link|click|dm|bio|claim)\b/ },

  // ---- spam ----------------------------------------------------------------------
  { category: "spam", weight: 0.3, reason: "Self-promotion", re: /\b(follow me|check my (profile|page|bio)|f4f|l4l|sub4sub|follow for follow|abonne[- ]toi a moi|va voir mon profil)\b/ },

  // ---- impersonation ----------------------------------------------------------
  {
    category: "impersonation",
    weight: 0.45,
    reason: "Claims official identity",
    re: /\b(this is (my|the) (backup|second|new|real) account|i am the (real|official)|tiktok (support|team|staff)|official (team|support)|je suis le vrai|compte officiel)\b/,
  },
];

export const SHORTENER_RE = /\b(bit\.ly|tinyurl|t\.co|goo\.gl|cutt\.ly|shorturl|is\.gd|rb\.gy|t\.me|tiny\.cc)\b/;

export const IMPERSONATION_NAME_RE = /(official|officiel|support|admin|staff|tiktok|moderator|modteam|backup)/;

// ---- assistant lexicons ------------------------------------------------------------

export const POSITIVE_RE =
  /\b(love|amazing|awesome|great|best|nice|cool|beautiful|fire|goat|legend|hype|excited|thanks|thank you|merci|trop bien|genial|incroyable|magnifique|super|bravo|j'?adore|top|gg|wow)\b|❤️|❤|😍|🔥|🥰|👏|🙌|💯|✨|😊|🎉|💖|👑/gu;

export const NEGATIVE_RE =
  /\b(hate|boring|bad|worst|trash|sad|angry|annoying|cringe|scam|fake|ugly|stupid|terrible|awful|nul|chiant|ennuyeux|decu|nulle|pourri|arnaque)\b|😡|🤬|👎|💀|😒|🙄|😢|😭/gu;

export const QUESTION_START_RE =
  /^(who|what|what's|whats|when|where|why|how|is|are|can|could|will|would|do|does|did|should|which|any|anyone|quand|comment|pourquoi|est[- ]ce|c'?est quoi|ou|combien|quel|quelle|quels|tu peux|vous pouvez|y a)\b/;

export const REQUEST_RE =
  /\b(please|pls|plz|can you|could you|play|show us|do a|shoutout|shout out|say hi|say my name|stp|svp|s'il te plait|tu peux|fais un|montre|joue)\b/;
