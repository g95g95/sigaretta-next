/** Gli 8 prompt fissi del gioco, nell'ordine degli slot 0–7. */
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

export const SLOTS = PROMPTS.length; // 8
export const ROUND_MS = 60_000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const MAX_ANSWER_LEN = 120;
export const MAX_NAME_LEN = 20;
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
