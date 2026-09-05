import type { GameMode, RoomSettings, SlotKind } from "./types";

/** Gli 8 prompt fissi del gioco classico, nell'ordine degli slot 0–7. */
export const PROMPTS = [
  "Chi? (personaggio 1)",
  "Chi? (personaggio 2)",
  "Dove?",
  "Cosa fanno?",
  "Cosa dice il personaggio 1?",
  "Cosa dice il personaggio 2?",
  "Chi arriva?",
  "Cosa dice chi arriva?",
] as const;

export const SLOTS = PROMPTS.length; // 8 (modalità classic)

// Valori di default delle impostazioni di stanza (l'host può cambiarli in lobby).
export const ROUND_MS = 60_000;
export const DRAW_EXTRA_MS = 30_000; // i turni di disegno durano roundMs + questo
export const MIN_ROUNDS = 4; // drawing
export const MAX_ROUNDS = 8; // drawing
export const DEFAULT_ROUNDS = 6; // drawing
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const MAX_ANSWER_LEN = 120;

export const DEFAULT_SETTINGS: RoomSettings = {
  roomName: "",
  mode: "classic",
  rounds: SLOTS,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  roundMs: ROUND_MS,
  maxAnswerLen: MAX_ANSWER_LEN,
};

/** Intervalli ammessi per le impostazioni: limiti duri, non modificabili dall'host. */
export const LIMITS = {
  players: { min: 2, max: 10 },
  rounds: { min: MIN_ROUNDS, max: MAX_ROUNDS }, // solo drawing; classic è sempre SLOTS
  roundMs: { min: 15_000, max: 300_000, step: 5_000 },
  answerLen: { min: 20, max: 300, step: 10 },
} as const;

export const MAX_NAME_LEN = 20;
export const MAX_ROOM_NAME_LEN = 30;
export const CONNECTED_MS = 10_000; // lastSeen entro 10s = connesso
export const HOST_TIMEOUT_MS = 30_000; // host silente da >30s = migrazione
export const ROOM_TTL_S = 24 * 60 * 60;
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export const EMPTY = "…";

/** Frase completa a partire dagli 8 pezzi (null = slot saltato). */
export function composeSentence(parts: (string | null)[]): string {
  const p = parts.map((x) => (x && x.trim() ? x.trim() : EMPTY));
  return `${p[0]} e ${p[1]} si trovano ${p[2]} e ${p[3]}. ${p[0]} dice: «${p[4]}». ${p[1]} risponde: «${p[5]}». Arriva ${p[6]} e dice: «${p[7]}».`;
}

/** Tipo di contenuto dello slot: in drawing i turni pari (2°, 4°, …) sono disegni. */
export function slotKind(mode: GameMode, slot: number): SlotKind {
  return mode === "drawing" && slot % 2 === 1 ? "drawing" : "text";
}

export function roundDuration(settings: RoomSettings, slot: number): number {
  return settings.roundMs + (slotKind(settings.mode, slot) === "drawing" ? DRAW_EXTRA_MS : 0);
}

/** Consegna mostrata al giocatore nel turno `slot`. */
export function promptFor(mode: GameMode, slot: number): string {
  if (mode === "classic") return PROMPTS[slot];
  if (slot === 0) return "Descrivi una scena da disegnare";
  return slotKind(mode, slot) === "drawing" ? "Disegna quello che leggi" : "Descrivi quello che vedi";
}
