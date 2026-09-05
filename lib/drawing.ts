/**
 * Disegni vettoriali: tratti (colore, spessore, punti) su una griglia logica quadrata.
 * Serializzati in JSON compatto con coordinate delta-encoded, così stanno nello stesso
 * `sheets[i][slot]` del testo. Il formato è validato dal reducer (mai fidarsi del client).
 */

export const DRAW_SIZE = 400; // lato della griglia logica
export const DRAW_COLORS = [
  "#1f1b16",
  "#b3412a",
  "#e07a1f",
  "#e6c229",
  "#3f7d3a",
  "#2b6cb0",
  "#6b3fa0",
  "#7a4b2a",
  "#e88aa8",
  "#fffdf6", // gomma: colore della carta
] as const;
export const DRAW_WIDTHS = [3, 8, 16] as const;
export const MAX_DRAWING_LEN = 20_000; // caratteri serializzati per disegno
export const MAX_STROKES = 500;

export interface Stroke {
  c: number; // indice in DRAW_COLORS
  w: number; // indice in DRAW_WIDTHS
  p: number[]; // x0, y0, x1, y1, … (interi 0..DRAW_SIZE)
}

export type Drawing = Stroke[];

export function serializeDrawing(d: Drawing): string {
  const out = d.map((s) => {
    const arr = [s.c, s.w];
    for (let i = 0; i < s.p.length; i += 2) {
      arr.push(i === 0 ? s.p[0] : s.p[i] - s.p[i - 2], i === 0 ? s.p[1] : s.p[i + 1] - s.p[i - 1]);
    }
    return arr;
  });
  return JSON.stringify(out);
}

/** Ritorna null se la stringa non è un disegno valido. */
export function parseDrawing(raw: string): Drawing | null {
  if (raw.length > MAX_DRAWING_LEN) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length < 1 || data.length > MAX_STROKES) return null;
  const drawing: Drawing = [];
  for (const s of data) {
    if (!Array.isArray(s) || s.length < 4 || s.length % 2 !== 0) return null;
    if (!s.every((n) => Number.isInteger(n))) return null;
    const nums = s as number[];
    const [c, w] = nums;
    if (c < 0 || c >= DRAW_COLORS.length || w < 0 || w >= DRAW_WIDTHS.length) return null;
    const p: number[] = [];
    let x = 0;
    let y = 0;
    for (let i = 2; i < nums.length; i += 2) {
      x += nums[i];
      y += nums[i + 1];
      if (x < 0 || x > DRAW_SIZE || y < 0 || y > DRAW_SIZE) return null;
      p.push(x, y);
    }
    drawing.push({ c, w, p });
  }
  return drawing;
}
