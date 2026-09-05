import { parseDrawing } from "./drawing";
import {
  CODE_ALPHABET,
  CONNECTED_MS,
  DEFAULT_ROUNDS,
  DEFAULT_SETTINGS,
  EMPTY,
  HOST_TIMEOUT_MS,
  LIMITS,
  MAX_NAME_LEN,
  SLOTS,
  promptFor,
  roundDuration,
  slotKind,
} from "./prompts";
import { GameError } from "./types";
import type { Action, PlayerView, RoomSettings, RoomState, SettingsPatch } from "./types";

const SEEN_GRANULARITY_MS = 4000;

/** Impostazioni della stanza, con fallback (anche per singolo campo) per le stanze salvate prima. */
export function settingsOf(state: RoomState): RoomSettings {
  return state.settings ? { ...DEFAULT_SETTINGS, ...state.settings } : DEFAULT_SETTINGS;
}

function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Applica il patch alle impostazioni correnti validando i limiti duri.
 * `playerCount` impedisce di ridurre la capienza sotto i presenti.
 */
export function applySettings(
  current: RoomSettings,
  patch: SettingsPatch,
  playerCount: number,
): RoomSettings {
  const mode = patch.mode ?? current.mode;
  if (mode !== "classic" && mode !== "drawing") {
    throw new GameError("INVALID_SETTINGS", "Modalità sconosciuta");
  }
  const next: RoomSettings = {
    mode,
    // classic ha sempre 8 turni; in drawing si può scegliere
    rounds: mode === "classic" ? SLOTS : (patch.rounds ?? (current.mode === "drawing" ? current.rounds : DEFAULT_ROUNDS)),
    minPlayers: patch.minPlayers ?? current.minPlayers,
    maxPlayers: patch.maxPlayers ?? current.maxPlayers,
    roundMs: patch.roundMs ?? current.roundMs,
    maxAnswerLen: patch.maxAnswerLen ?? current.maxAnswerLen,
  };

  if (mode === "drawing" && !inRange(next.rounds, LIMITS.rounds.min, LIMITS.rounds.max)) {
    throw new GameError("INVALID_SETTINGS", "Numero di turni fuori intervallo");
  }
  if (!inRange(next.minPlayers, LIMITS.players.min, LIMITS.players.max)) {
    throw new GameError("INVALID_SETTINGS", "Numero minimo di giocatori fuori intervallo");
  }
  if (!inRange(next.maxPlayers, LIMITS.players.min, LIMITS.players.max)) {
    throw new GameError("INVALID_SETTINGS", "Numero massimo di giocatori fuori intervallo");
  }
  if (next.minPlayers > next.maxPlayers) {
    throw new GameError("INVALID_SETTINGS", "Il minimo non può superare il massimo");
  }
  if (next.maxPlayers < playerCount) {
    throw new GameError("INVALID_SETTINGS", "Ci sono già più giocatori del massimo scelto");
  }
  if (!inRange(next.roundMs, LIMITS.roundMs.min, LIMITS.roundMs.max)) {
    throw new GameError("INVALID_SETTINGS", "Tempo per round fuori intervallo");
  }
  if (!inRange(next.maxAnswerLen, LIMITS.answerLen.min, LIMITS.answerLen.max)) {
    throw new GameError("INVALID_SETTINGS", "Lunghezza risposta fuori intervallo");
  }
  return next;
}

/** Foglietto compilato dal giocatore con seat p al round r. */
export function sheetFor(seat: number, round: number, n: number): number {
  return (((seat - round) % n) + n) % n;
}

function seatOf(state: RoomState, playerId: string): number {
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat < 0) throw new GameError("NOT_A_PLAYER");
  return seat;
}

function requireHost(state: RoomState, playerId: string): void {
  seatOf(state, playerId);
  if (state.hostId !== playerId) throw new GameError("NOT_HOST");
}

function closeRound(state: RoomState, now: number): RoomState {
  const settings = settingsOf(state);
  const next = state.round + 1;
  if (next < settings.rounds) {
    return { ...state, round: next, roundEndsAt: now + roundDuration(settings, next) };
  }
  return { ...state, phase: "reveal", revealIndex: 0, revealStep: 0, roundEndsAt: null };
}

/** Timeout round + host migration. Restituisce la stessa reference se nulla cambia. */
export function settle(state: RoomState, now: number): RoomState {
  let s = state;
  if (s.phase === "round" && s.roundEndsAt !== null && now >= s.roundEndsAt) {
    s = closeRound(s, now);
  }
  const host = s.players.find((p) => p.id === s.hostId);
  if (host && host.lastSeen < now - HOST_TIMEOUT_MS) {
    const next = s.players.find((p) => p.lastSeen >= now - CONNECTED_MS);
    if (next && next.id !== s.hostId) s = { ...s, hostId: next.id };
  }
  return s;
}

function createRoom(action: Extract<Action, { type: "create" }>): RoomState {
  return {
    code: action.code,
    version: 0,
    createdAt: action.now,
    game: 1,
    phase: "lobby",
    hostId: action.host.id,
    settings: applySettings(DEFAULT_SETTINGS, action.settings, 1),
    players: [{ ...action.host, lastSeen: action.now }],
    round: 0,
    roundEndsAt: null,
    sheets: [],
    revealIndex: 0,
    revealStep: 0,
  };
}

/** Valida e normalizza la risposta per il tipo di slot; lancia INVALID_ANSWER. */
function cleanAnswer(state: RoomState, raw: string): string {
  const settings = settingsOf(state);
  if (slotKind(settings.mode, state.round) === "drawing") {
    if (!parseDrawing(raw)) throw new GameError("INVALID_ANSWER");
    return raw;
  }
  const text = raw.trim();
  if (text.length < 1 || text.length > settings.maxAnswerLen) throw new GameError("INVALID_ANSWER");
  return text;
}

export function reduce(state: RoomState | null, action: Action): RoomState {
  if (action.type === "create") return createRoom(action);
  if (!state) throw new GameError("ROOM_NOT_FOUND");

  const s = settle(state, action.now);

  switch (action.type) {
    case "tick":
      return s;

    case "seen": {
      const seat = seatOf(s, action.playerId);
      const p = s.players[seat];
      if (action.now - p.lastSeen < SEEN_GRANULARITY_MS) return s;
      const players = s.players.slice();
      players[seat] = { ...p, lastSeen: action.now };
      return { ...s, players };
    }

    case "join": {
      if (s.phase !== "lobby") throw new GameError("NOT_IN_LOBBY");
      if (s.players.length >= settingsOf(s).maxPlayers) throw new GameError("ROOM_FULL");
      const name = action.player.name.trim();
      if (name.length < 1 || name.length > MAX_NAME_LEN) throw new GameError("INVALID_NAME");
      const lower = name.toLowerCase();
      if (s.players.some((p) => p.name.toLowerCase() === lower)) throw new GameError("NAME_TAKEN");
      return {
        ...s,
        players: [...s.players, { ...action.player, name, lastSeen: action.now }],
      };
    }

    case "start": {
      requireHost(s, action.playerId);
      if (s.phase !== "lobby") throw new GameError("NOT_IN_LOBBY");
      const settings = settingsOf(s);
      const n = s.players.length;
      if (n < settings.minPlayers) throw new GameError("NOT_ENOUGH_PLAYERS");
      return {
        ...s,
        phase: "round",
        round: 0,
        roundEndsAt: action.now + roundDuration(settings, 0),
        revealIndex: 0,
        revealStep: 0,
        sheets: Array.from({ length: n }, () => Array<string | null>(settings.rounds).fill(null)),
      };
    }

    case "settings": {
      requireHost(s, action.playerId);
      if (s.phase !== "lobby") throw new GameError("NOT_IN_LOBBY");
      const current = settingsOf(s);
      const settings = applySettings(current, action.patch, s.players.length);
      const same = (Object.keys(settings) as (keyof RoomSettings)[]).every(
        (k) => settings[k] === current[k],
      );
      return same && s.settings ? s : { ...s, settings };
    }

    case "answer": {
      if (s.phase !== "round") throw new GameError("WRONG_PHASE");
      const seat = seatOf(s, action.playerId);
      // Risposta arrivata dopo la chiusura del round: non deve finire nel round successivo.
      if (action.round !== s.round) throw new GameError("ROUND_OVER");
      const text = cleanAnswer(s, action.text);
      const n = s.players.length;
      const sheetIdx = sheetFor(seat, s.round, n);
      if (s.sheets[sheetIdx][s.round] !== null) throw new GameError("ALREADY_ANSWERED");
      const sheets = s.sheets.map((sheet, i) =>
        i === sheetIdx ? sheet.map((v, slot) => (slot === s.round ? text : v)) : sheet,
      );
      const next = { ...s, sheets };
      const all = sheets.every((sheet) => sheet[s.round] !== null);
      return all ? closeRound(next, action.now) : next;
    }

    case "advance": {
      requireHost(s, action.playerId);
      if (s.phase !== "reveal") throw new GameError("WRONG_PHASE");
      const settings = settingsOf(s);
      // In drawing si svela un passaggio alla volta prima di passare al foglietto dopo.
      if (settings.mode === "drawing" && s.revealStep + 1 < settings.rounds) {
        return { ...s, revealStep: s.revealStep + 1 };
      }
      if (s.revealIndex >= s.players.length - 1) return { ...s, phase: "ended" };
      return { ...s, revealIndex: s.revealIndex + 1, revealStep: 0 };
    }

    case "restart": {
      requireHost(s, action.playerId);
      if (s.phase !== "reveal" && s.phase !== "ended") throw new GameError("WRONG_PHASE");
      return {
        ...s,
        phase: "lobby",
        game: s.game + 1,
        sheets: [],
        round: 0,
        revealIndex: 0,
        revealStep: 0,
        roundEndsAt: null,
      };
    }
  }
}

function answeredInRound(state: RoomState, seat: number): boolean {
  if (state.phase !== "round") return false;
  const n = state.players.length;
  return state.sheets[sheetFor(seat, state.round, n)][state.round] !== null;
}

export function toPlayerView(state: RoomState, playerId: string, now: number): PlayerView {
  const mySeat = seatOf(state, playerId);
  const settings = settingsOf(state);
  const { mode, rounds: slots } = settings;
  const n = state.players.length;
  const players = state.players.map((p, seat) => ({
    id: p.id,
    name: p.name,
    connected: p.lastSeen >= now - CONNECTED_MS,
    isHost: p.id === state.hostId,
    answered: answeredInRound(state, seat),
  }));
  const me = players[mySeat];
  const inRound = state.phase === "round";

  // Drawing: il giocatore vede solo il passaggio precedente del foglietto che ha in mano.
  let previous: string | null = null;
  if (inRound && mode === "drawing" && state.round > 0) {
    previous = state.sheets[sheetFor(mySeat, state.round, n)][state.round - 1];
  }

  let reveal: PlayerView["reveal"] = null;
  if (state.phase === "reveal" || state.phase === "ended") {
    const ended = state.phase === "ended";
    const index = ended ? n - 1 : state.revealIndex;
    const step = ended || mode === "classic" ? slots - 1 : (state.revealStep ?? 0);
    const sheets = state.sheets.slice(0, index + 1).map((sheet, i) => {
      const visible = i === index ? sheet.slice(0, step + 1) : sheet;
      return visible.map((v) => v ?? EMPTY);
    });
    reveal = { index, step, total: n, sheets };
  }

  return {
    code: state.code,
    version: state.version,
    game: state.game,
    phase: state.phase,
    serverNow: now,
    settings,
    mode,
    slots,
    me: { id: me.id, name: me.name, isHost: me.isHost, answered: me.answered },
    players,
    round: state.round,
    prompt: inRound ? promptFor(mode, state.round) : null,
    kind: inRound ? slotKind(mode, state.round) : null,
    previous,
    roundEndsAt: inRound ? state.roundEndsAt : null,
    answeredCount: inRound ? players.filter((p) => p.answered).length : 0,
    total: n,
    reveal,
  };
}

export function generateCode(rand: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  }
  return code;
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

function randomString(len: number): string {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b & 63];
  return out;
}

export function newId(): string {
  return randomString(8);
}

export function newToken(): string {
  return randomString(32);
}
