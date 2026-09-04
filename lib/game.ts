import {
  CODE_ALPHABET,
  CONNECTED_MS,
  EMPTY,
  HOST_TIMEOUT_MS,
  MAX_ANSWER_LEN,
  MAX_NAME_LEN,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PROMPTS,
  ROUND_MS,
  SLOTS,
} from "./prompts";
import { GameError } from "./types";
import type { Action, PlayerView, RoomState } from "./types";

const SEEN_GRANULARITY_MS = 4000;

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
  if (state.round + 1 < SLOTS) {
    return { ...state, round: state.round + 1, roundEndsAt: now + ROUND_MS };
  }
  return { ...state, phase: "reveal", revealIndex: 0, roundEndsAt: null };
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
    players: [{ ...action.host, lastSeen: action.now }],
    round: 0,
    roundEndsAt: null,
    sheets: [],
    revealIndex: 0,
  };
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
      if (s.players.length >= MAX_PLAYERS) throw new GameError("ROOM_FULL");
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
      const n = s.players.length;
      if (n < MIN_PLAYERS) throw new GameError("NOT_ENOUGH_PLAYERS");
      return {
        ...s,
        phase: "round",
        round: 0,
        roundEndsAt: action.now + ROUND_MS,
        revealIndex: 0,
        sheets: Array.from({ length: n }, () => Array<string | null>(SLOTS).fill(null)),
      };
    }

    case "answer": {
      if (s.phase !== "round") throw new GameError("WRONG_PHASE");
      const seat = seatOf(s, action.playerId);
      const text = action.text.trim();
      if (text.length < 1 || text.length > MAX_ANSWER_LEN) throw new GameError("INVALID_ANSWER");
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
      if (s.revealIndex >= s.players.length - 1) return { ...s, phase: "ended" };
      return { ...s, revealIndex: s.revealIndex + 1 };
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
  const n = state.players.length;
  const players = state.players.map((p, seat) => ({
    id: p.id,
    name: p.name,
    connected: p.lastSeen >= now - CONNECTED_MS,
    isHost: p.id === state.hostId,
    answered: answeredInRound(state, seat),
  }));
  const me = players[mySeat];

  let reveal: PlayerView["reveal"] = null;
  if (state.phase === "reveal" || state.phase === "ended") {
    const upto = state.phase === "ended" ? n : state.revealIndex + 1;
    reveal = {
      index: state.phase === "ended" ? n - 1 : state.revealIndex,
      total: n,
      sheets: state.sheets.slice(0, upto).map((sheet) => sheet.map((v) => v ?? EMPTY)),
    };
  }

  return {
    code: state.code,
    version: state.version,
    game: state.game,
    phase: state.phase,
    serverNow: now,
    me: { id: me.id, name: me.name, isHost: me.isHost, answered: me.answered },
    players,
    round: state.round,
    prompt: state.phase === "round" ? PROMPTS[state.round] : null,
    roundEndsAt: state.phase === "round" ? state.roundEndsAt : null,
    answeredCount: state.phase === "round" ? players.filter((p) => p.answered).length : 0,
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
