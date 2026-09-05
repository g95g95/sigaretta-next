import { describe, expect, it } from "vitest";
import { parseDrawing, serializeDrawing } from "./drawing";
import { applySettings, generateCode, reduce, settle, sheetFor, toPlayerView } from "./game";
import { CODE_ALPHABET, DEFAULT_SETTINGS, DRAW_EXTRA_MS, EMPTY, LIMITS, MAX_ROOM_NAME_LEN, ROUND_MS, SLOTS } from "./prompts";
import { GameError } from "./types";
import type { RoomState } from "./types";

const T0 = 1_000_000;

function player(i: number) {
  return { id: `p${i}`, token: `tok${i}`, name: `Player${i}` };
}

function lobby(n: number, now = T0): RoomState {
  let s = reduce(null, { type: "create", code: "ABCD", host: player(0), settings: {}, now });
  for (let i = 1; i < n; i++) s = reduce(s, { type: "join", player: player(i), now });
  return s;
}

function started(n: number, now = T0): RoomState {
  return reduce(lobby(n, now), { type: "start", playerId: "p0", now });
}

function answerAll(s: RoomState, now: number): RoomState {
  const r = s.round;
  for (const p of s.players) s = reduce(s, { type: "answer", playerId: p.id, round: r, text: `${p.id}-r${r}`, now });
  return s;
}

function code(fn: () => unknown): string | null {
  try {
    fn();
  } catch (e) {
    return (e as GameError).code;
  }
  return null;
}

describe("sheetFor", () => {
  it("rotates seats over sheets", () => {
    expect(sheetFor(0, 0, 3)).toBe(0);
    expect(sheetFor(0, 1, 3)).toBe(2);
    expect(sheetFor(2, 1, 3)).toBe(1);
    expect(sheetFor(1, 7, 3)).toBe(0);
  });
});

describe("rotation", () => {
  it("3 players x 8 rounds: each sheet slot filled by the expected player", () => {
    let s = started(3);
    for (let r = 0; r < SLOTS; r++) {
      expect(s.phase).toBe("round");
      expect(s.round).toBe(r);
      s = answerAll(s, T0 + r);
    }
    expect(s.phase).toBe("reveal");
    for (let i = 0; i < 3; i++) {
      for (let r = 0; r < SLOTS; r++) {
        const seat = (i + r) % 3;
        expect(s.sheets[i][r]).toBe(`p${seat}-r${r}`);
      }
    }
  });

  it("closes the round early when everyone answered", () => {
    let s = started(2);
    s = reduce(s, { type: "answer", playerId: "p0", round: 0, text: "a", now: T0 + 1 });
    expect(s.round).toBe(0);
    s = reduce(s, { type: "answer", playerId: "p1", round: 0, text: "b", now: T0 + 2 });
    expect(s.round).toBe(1);
    expect(s.roundEndsAt).toBe(T0 + 2 + ROUND_MS);
  });
});

describe("timeout", () => {
  it("advances the round on tick after roundEndsAt; missing slots stay null and show as EMPTY", () => {
    let s = started(2);
    s = reduce(s, { type: "answer", playerId: "p0", round: 0, text: "solo", now: T0 + 5 });
    s = reduce(s, { type: "tick", now: T0 + ROUND_MS });
    expect(s.round).toBe(1);
    expect(s.sheets[0][0]).toBe("solo");
    expect(s.sheets[1][0]).toBeNull();
    for (let r = 1; r < SLOTS; r++) s = reduce(s, { type: "tick", now: T0 + ROUND_MS * (r + 1) });
    expect(s.phase).toBe("reveal");
    const v = toPlayerView(s, "p0", T0 + ROUND_MS * 9);
    expect(v.reveal?.sheets[0][0]).toBe("solo");
    expect(v.reveal?.sheets[0][1]).toBe(EMPTY);
  });

  it("settle is applied before any action (late answer is refused with ROUND_OVER)", () => {
    const s = started(2);
    expect(code(() => reduce(s, { type: "answer", playerId: "p0", round: 0, text: "late", now: T0 + ROUND_MS }))).toBe("ROUND_OVER");
    const t = reduce(s, { type: "answer", playerId: "p0", round: 1, text: "ok", now: T0 + ROUND_MS });
    expect(t.round).toBe(1);
    expect(t.sheets[sheetFor(0, 1, 2)][1]).toBe("ok");
  });
});

describe("reconnect", () => {
  it("seen keeps seat and updates lastSeen with 4s granularity", () => {
    let s = started(3);
    const same = reduce(s, { type: "seen", playerId: "p1", now: T0 + 1000 });
    expect(same).toBe(s);
    s = reduce(s, { type: "seen", playerId: "p1", now: T0 + 5000 });
    expect(s.players[1].id).toBe("p1");
    expect(s.players[1].lastSeen).toBe(T0 + 5000);
    expect(s.players.map((p) => p.id)).toEqual(["p0", "p1", "p2"]);
  });

  it("join is refused during a round", () => {
    const s = started(2);
    expect(code(() => reduce(s, { type: "join", player: player(9), now: T0 }))).toBe("NOT_IN_LOBBY");
  });

  it("seen on unknown player throws NOT_A_PLAYER", () => {
    expect(code(() => reduce(lobby(2), { type: "seen", playerId: "zz", now: T0 }))).toBe("NOT_A_PLAYER");
  });
});

describe("host migration", () => {
  it("moves host to first connected player after 30s silence", () => {
    let s = lobby(3);
    s = reduce(s, { type: "seen", playerId: "p2", now: T0 + 31_000 });
    expect(s.hostId).toBe("p0"); // settle avviene prima dell aggiornamento di lastSeen: nessuno connesso
    s = reduce(s, { type: "seen", playerId: "p1", now: T0 + 31_000 });
    s = reduce(s, { type: "tick", now: T0 + 31_001 });
    expect(s.hostId).toBe("p2");
    // host p2 silente a sua volta: passa al primo seat connesso
    s = reduce(s, { type: "seen", playerId: "p1", now: T0 + 70_000 });
    s = reduce(s, { type: "tick", now: T0 + 70_001 });
    expect(s.hostId).toBe("p1");
  });

  it("keeps host when nobody is connected", () => {
    const s = lobby(3);
    const t = settle(s, T0 + 60_000);
    expect(t).toBe(s);
    expect(t.hostId).toBe("p0");
  });
});

describe("reveal", () => {
  function revealed(): RoomState {
    let s = started(3);
    for (let r = 0; r < SLOTS; r++) s = answerAll(s, T0 + r);
    return s;
  }

  it("shows sheets progressively and ends after the last", () => {
    let s = revealed();
    expect(s.phase).toBe("reveal");
    expect(toPlayerView(s, "p1", T0).reveal?.sheets.length).toBe(1);
    s = reduce(s, { type: "advance", playerId: "p0", now: T0 });
    expect(s.revealIndex).toBe(1);
    expect(toPlayerView(s, "p1", T0).reveal?.sheets.length).toBe(2);
    s = reduce(s, { type: "advance", playerId: "p0", now: T0 });
    expect(s.revealIndex).toBe(2);
    expect(s.phase).toBe("reveal");
    s = reduce(s, { type: "advance", playerId: "p0", now: T0 });
    expect(s.phase).toBe("ended");
    const v = toPlayerView(s, "p1", T0);
    expect(v.reveal?.sheets.length).toBe(3);
    expect(v.reveal?.sheets[2]).toHaveLength(SLOTS);
  });

  it("only host can advance; advance is refused outside reveal", () => {
    const s = revealed();
    expect(code(() => reduce(s, { type: "advance", playerId: "p1", now: T0 }))).toBe("NOT_HOST");
    expect(code(() => reduce(started(2), { type: "advance", playerId: "p0", now: T0 }))).toBe("WRONG_PHASE");
  });

  it("restart returns to lobby with same players and game+1", () => {
    let s = revealed();
    expect(code(() => reduce(started(2), { type: "restart", playerId: "p0", now: T0 }))).toBe("WRONG_PHASE");
    s = reduce(s, { type: "restart", playerId: "p0", now: T0 });
    expect(s.phase).toBe("lobby");
    expect(s.game).toBe(2);
    expect(s.sheets).toEqual([]);
    expect(s.players.map((p) => p.id)).toEqual(["p0", "p1", "p2"]);
    expect(s.hostId).toBe("p0");
    const again = reduce(s, { type: "start", playerId: "p0", now: T0 });
    expect(again.phase).toBe("round");
    expect(again.sheets).toHaveLength(3);
  });
});

describe("blindness", () => {
  it("round view never contains answers or tokens", () => {
    let s = started(3);
    s = reduce(s, { type: "answer", playerId: "p0", round: 0, text: "SEGRETO", now: T0 + 1 });
    for (const p of s.players) {
      const json = JSON.stringify(toPlayerView(s, p.id, T0 + 2));
      expect(json).not.toContain("SEGRETO");
      expect(json).not.toContain("tok");
    }
    const v = toPlayerView(s, "p1", T0 + 2);
    expect(v.reveal).toBeNull();
    expect(v.prompt).toBeTruthy();
    expect(v.answeredCount).toBe(1);
    expect(v.total).toBe(3);
    expect(v.players.find((p) => p.id === "p0")?.answered).toBe(true);
    expect(v.me.answered).toBe(false);
  });

  it("reveal view has no tokens", () => {
    let s = started(2);
    for (let r = 0; r < SLOTS; r++) s = answerAll(s, T0 + r);
    expect(JSON.stringify(toPlayerView(s, "p0", T0))).not.toContain("tok");
  });
});

describe("no-op and immutability", () => {
  it("tick without changes returns same reference and actions do not mutate input", () => {
    const s = started(2);
    const snapshot = JSON.stringify(s);
    expect(reduce(s, { type: "tick", now: T0 + 1 })).toBe(s);
    reduce(s, { type: "answer", playerId: "p0", round: 0, text: "x", now: T0 + 1 });
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe("errors", () => {
  it("NOT_HOST on start by non-host", () => {
    expect(code(() => reduce(lobby(2), { type: "start", playerId: "p1", now: T0 }))).toBe("NOT_HOST");
  });
  it("NOT_ENOUGH_PLAYERS", () => {
    expect(code(() => reduce(lobby(1), { type: "start", playerId: "p0", now: T0 }))).toBe("NOT_ENOUGH_PLAYERS");
  });
  it("ALREADY_ANSWERED", () => {
    const s = reduce(started(2), { type: "answer", playerId: "p0", round: 0, text: "a", now: T0 });
    expect(code(() => reduce(s, { type: "answer", playerId: "p0", round: 0, text: "b", now: T0 }))).toBe("ALREADY_ANSWERED");
  });
  it("INVALID_ANSWER on empty text", () => {
    expect(code(() => reduce(started(2), { type: "answer", playerId: "p0", round: 0, text: "   ", now: T0 }))).toBe("INVALID_ANSWER");
  });
  it("ROOM_FULL", () => {
    expect(code(() => reduce(lobby(10), { type: "join", player: player(10), now: T0 }))).toBe("ROOM_FULL");
  });
  it("NAME_TAKEN (case-insensitive) and INVALID_NAME", () => {
    const s = lobby(2);
    expect(code(() => reduce(s, { type: "join", player: { ...player(5), name: "player0" }, now: T0 }))).toBe("NAME_TAKEN");
    expect(code(() => reduce(s, { type: "join", player: { ...player(5), name: "  " }, now: T0 }))).toBe("INVALID_NAME");
  });
  it("ROOM_NOT_FOUND on null state", () => {
    expect(code(() => reduce(null, { type: "tick", now: T0 }))).toBe("ROOM_NOT_FOUND");
  });
});

describe("generateCode", () => {
  it("4 chars from the alphabet, never O/I/0/1", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode();
      expect(c).toHaveLength(4);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
      expect(c).not.toMatch(/[OI01]/);
    }
    expect(generateCode(() => 0)).toBe("AAAA");
    expect(generateCode(() => 0.9999)).toBe("ZZZZ");
  });
});

// ---------- modalità disegno ----------

const DRAWING = serializeDrawing([
  { c: 0, w: 1, p: [10, 10, 50, 60, 100, 60] },
  { c: 3, w: 0, p: [200, 200] },
]);

function drawingLobby(n: number, rounds = 4, now = T0): RoomState {
  let s = reduce(null, { type: "create", code: "ABCD", host: player(0), settings: { mode: "drawing", rounds }, now });
  for (let i = 1; i < n; i++) s = reduce(s, { type: "join", player: player(i), now });
  return s;
}

function drawingStarted(n: number, rounds = 4, now = T0): RoomState {
  return reduce(drawingLobby(n, rounds, now), { type: "start", playerId: "p0", now });
}

function answerAllDrawing(s: RoomState, now: number): RoomState {
  const r = s.round;
  for (const p of s.players) {
    const text = r % 2 === 1 ? DRAWING : `${p.id}-r${r}`;
    s = reduce(s, { type: "answer", playerId: p.id, round: r, text, now });
  }
  return s;
}

describe("drawing encoding", () => {
  it("round-trips and rejects malformed input", () => {
    expect(parseDrawing(DRAWING)).toEqual([
      { c: 0, w: 1, p: [10, 10, 50, 60, 100, 60] },
      { c: 3, w: 0, p: [200, 200] },
    ]);
    expect(parseDrawing("[]")).toBeNull();
    expect(parseDrawing("ciao")).toBeNull();
    expect(parseDrawing("[[0,0,10]]")).toBeNull(); // dispari
    expect(parseDrawing("[[99,0,10,10]]")).toBeNull(); // colore fuori range
    expect(parseDrawing("[[0,0,10,10,-20,0]]")).toBeNull(); // fuori griglia
    expect(parseDrawing("[[0,0,1.5,2]]")).toBeNull(); // non interi
  });
});

describe("drawing settings", () => {
  it("classic is always 8 rounds; drawing 4–8", () => {
    const D = DEFAULT_SETTINGS;
    expect(applySettings(D, { mode: "classic", rounds: 3 }, 1).rounds).toBe(SLOTS);
    expect(applySettings(D, { mode: "drawing", rounds: 4 }, 1)).toMatchObject({ mode: "drawing", rounds: 4 });
    expect(applySettings(D, { mode: "drawing", rounds: 8 }, 1)).toMatchObject({ mode: "drawing", rounds: 8 });
    expect(applySettings(D, { mode: "drawing" }, 1).rounds).toBe(6); // default drawing
    expect(code(() => applySettings(D, { mode: "drawing", rounds: 3 }, 1))).toBe("INVALID_SETTINGS");
    expect(code(() => applySettings(D, { mode: "drawing", rounds: 9 }, 1))).toBe("INVALID_SETTINGS");
    expect(code(() => applySettings(D, { mode: "drawing", rounds: 5.5 }, 1))).toBe("INVALID_SETTINGS");
    expect(code(() => applySettings(D, { mode: "boh" as "drawing" }, 1))).toBe("INVALID_SETTINGS");
    expect(drawingStarted(2, 5).sheets[0]).toHaveLength(5);
  });

  it("host can switch mode and rounds in lobby; classic resets rounds to 8", () => {
    let s = lobby(2);
    s = reduce(s, { type: "settings", playerId: "p0", patch: { mode: "drawing", rounds: 5 }, now: T0 });
    expect(s.settings).toMatchObject({ mode: "drawing", rounds: 5 });
    expect(toPlayerView(s, "p1", T0)).toMatchObject({ mode: "drawing", slots: 5 });
    s = reduce(s, { type: "settings", playerId: "p0", patch: { mode: "classic" }, now: T0 });
    expect(s.settings).toMatchObject({ mode: "classic", rounds: SLOTS });
    expect(code(() => reduce(started(2), { type: "settings", playerId: "p0", patch: { mode: "drawing" }, now: T0 }))).toBe("NOT_IN_LOBBY");
  });

  it("drawing rounds use roundMs + DRAW_EXTRA_MS; text slots respect maxAnswerLen", () => {
    let s = reduce(drawingLobby(2), { type: "settings", playerId: "p0", patch: { roundMs: 20_000, maxAnswerLen: 20 }, now: T0 });
    s = reduce(s, { type: "start", playerId: "p0", now: T0 });
    expect(s.roundEndsAt).toBe(T0 + 20_000);
    expect(code(() => reduce(s, { type: "answer", playerId: "p0", round: 0, text: "x".repeat(21), now: T0 }))).toBe("INVALID_ANSWER");
    s = reduce(s, { type: "tick", now: T0 + 20_000 });
    expect(s.round).toBe(1);
    expect(s.roundEndsAt).toBe(T0 + 20_000 + 20_000 + DRAW_EXTRA_MS);
  });
});

describe("drawing rounds", () => {
  it("alternates text and drawing, with longer drawing rounds", () => {
    let s = drawingStarted(2);
    expect(s.roundEndsAt).toBe(T0 + ROUND_MS);
    let v = toPlayerView(s, "p0", T0);
    expect(v.kind).toBe("text");
    expect(v.previous).toBeNull();
    s = answerAllDrawing(s, T0 + 1);
    expect(s.round).toBe(1);
    expect(s.roundEndsAt).toBe(T0 + 1 + ROUND_MS + DRAW_EXTRA_MS);
    v = toPlayerView(s, "p0", T0 + 2);
    expect(v.kind).toBe("drawing");
    // p0 al round 1 ha il foglietto 1, scritto da p1 al round 0
    expect(v.previous).toBe("p1-r0");
    expect(toPlayerView(s, "p1", T0 + 2).previous).toBe("p0-r0");
  });

  it("validates the answer by slot kind", () => {
    let s = answerAllDrawing(drawingStarted(2), T0 + 1);
    expect(code(() => reduce(s, { type: "answer", playerId: "p0", round: 1, text: "un gatto", now: T0 + 2 }))).toBe("INVALID_ANSWER");
    s = reduce(s, { type: "answer", playerId: "p0", round: 1, text: DRAWING, now: T0 + 2 });
    expect(s.sheets[1][1]).toBe(DRAWING);
  });

  it("previous is null when the previous step timed out", () => {
    let s = drawingStarted(2);
    s = reduce(s, { type: "tick", now: T0 + ROUND_MS });
    expect(s.round).toBe(1);
    expect(toPlayerView(s, "p0", T0 + ROUND_MS).previous).toBeNull();
  });

  it("round view never leaks other sheets", () => {
    let s = drawingStarted(3);
    s = reduce(s, { type: "answer", playerId: "p0", round: 0, text: "SEGRETO", now: T0 + 1 });
    for (const id of ["p1", "p2"]) {
      expect(JSON.stringify(toPlayerView(s, id, T0 + 2))).not.toContain("SEGRETO");
    }
  });
});

describe("drawing reveal", () => {
  function revealed(): RoomState {
    let s = drawingStarted(2);
    for (let r = 0; r < 4; r++) s = answerAllDrawing(s, T0 + r);
    return s;
  }

  it("reveals one step at a time, then the next sheet, then ends", () => {
    let s = revealed();
    expect(s.phase).toBe("reveal");
    let v = toPlayerView(s, "p1", T0);
    expect(v.reveal?.step).toBe(0);
    expect(v.reveal?.sheets).toEqual([["p0-r0"]]);
    s = reduce(s, { type: "advance", playerId: "p0", now: T0 });
    v = toPlayerView(s, "p1", T0);
    expect(v.reveal?.sheets).toEqual([["p0-r0", DRAWING]]);
    s = reduce(s, { type: "advance", playerId: "p0", now: T0 });
    s = reduce(s, { type: "advance", playerId: "p0", now: T0 });
    expect(s.revealIndex).toBe(0);
    expect(toPlayerView(s, "p1", T0).reveal?.sheets[0]).toHaveLength(4);
    s = reduce(s, { type: "advance", playerId: "p0", now: T0 });
    expect(s.revealIndex).toBe(1);
    expect(s.revealStep).toBe(0);
    v = toPlayerView(s, "p1", T0);
    expect(v.reveal?.sheets[0]).toHaveLength(4);
    expect(v.reveal?.sheets[1]).toEqual(["p1-r0"]);
    for (let i = 0; i < 3; i++) s = reduce(s, { type: "advance", playerId: "p0", now: T0 });
    expect(s.phase).toBe("reveal");
    s = reduce(s, { type: "advance", playerId: "p0", now: T0 });
    expect(s.phase).toBe("ended");
    v = toPlayerView(s, "p1", T0);
    expect(v.reveal?.sheets.map((x) => x.length)).toEqual([4, 4]);
  });

  it("restart keeps mode and rounds", () => {
    let s = revealed();
    s = reduce(s, { type: "restart", playerId: "p0", now: T0 });
    expect(s.settings.mode).toBe("drawing");
    expect(s.settings.rounds).toBe(4);
    expect(s.revealStep).toBe(0);
  });
});

describe("settings", () => {
  it("defaults to the standard values and exposes them in the view", () => {
    const s = lobby(2);
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
    expect(toPlayerView(s, "p0", T0).settings).toEqual(DEFAULT_SETTINGS);
  });

  it("host updates only the given fields", () => {
    const s = reduce(lobby(2), {
      type: "settings",
      playerId: "p0",
      patch: { roundMs: 30_000 },
      now: T0,
    });
    expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, roundMs: 30_000 });
  });

  it("returns the same reference when nothing changes", () => {
    const s = lobby(2);
    expect(reduce(s, { type: "settings", playerId: "p0", patch: { roundMs: ROUND_MS }, now: T0 })).toBe(s);
  });

  it("only the host, only in lobby", () => {
    expect(code(() => reduce(lobby(2), { type: "settings", playerId: "p1", patch: {}, now: T0 }))).toBe("NOT_HOST");
    expect(
      code(() => reduce(started(2), { type: "settings", playerId: "p0", patch: { roundMs: 30_000 }, now: T0 })),
    ).toBe("NOT_IN_LOBBY");
  });

  it("rejects out-of-range, inconsistent or non-integer values", () => {
    const s = lobby(3);
    const bad = (patch: Record<string, unknown>) =>
      code(() => reduce(s, { type: "settings", playerId: "p0", patch: patch as never, now: T0 }));
    expect(bad({ minPlayers: 1 })).toBe("INVALID_SETTINGS");
    expect(bad({ maxPlayers: LIMITS.players.max + 1 })).toBe("INVALID_SETTINGS");
    expect(bad({ minPlayers: 6, maxPlayers: 4 })).toBe("INVALID_SETTINGS");
    expect(bad({ maxPlayers: 2 })).toBe("INVALID_SETTINGS"); // già 3 giocatori dentro
    expect(bad({ roundMs: LIMITS.roundMs.min - 1000 })).toBe("INVALID_SETTINGS");
    expect(bad({ maxAnswerLen: LIMITS.answerLen.max + 1 })).toBe("INVALID_SETTINGS");
    expect(bad({ roundMs: 30_000.5 })).toBe("INVALID_SETTINGS");
    expect(bad({ maxAnswerLen: "120" })).toBe("INVALID_SETTINGS");
  });

  it("maxPlayers caps the room", () => {
    let s = reduce(lobby(2), { type: "settings", playerId: "p0", patch: { maxPlayers: 3 }, now: T0 });
    s = reduce(s, { type: "join", player: player(2), now: T0 });
    expect(code(() => reduce(s, { type: "join", player: player(3), now: T0 }))).toBe("ROOM_FULL");
  });

  it("minPlayers gates the start", () => {
    const s = reduce(lobby(2), { type: "settings", playerId: "p0", patch: { minPlayers: 3 }, now: T0 });
    expect(code(() => reduce(s, { type: "start", playerId: "p0", now: T0 }))).toBe("NOT_ENOUGH_PLAYERS");
  });

  it("roundMs drives the round deadline and the timeout", () => {
    let s = reduce(lobby(2), { type: "settings", playerId: "p0", patch: { roundMs: 20_000 }, now: T0 });
    s = reduce(s, { type: "start", playerId: "p0", now: T0 });
    expect(s.roundEndsAt).toBe(T0 + 20_000);
    s = reduce(s, { type: "tick", now: T0 + 20_000 });
    expect(s.round).toBe(1);
    expect(s.roundEndsAt).toBe(T0 + 40_000);
  });

  it("maxAnswerLen limits the answers", () => {
    let s = reduce(lobby(2), { type: "settings", playerId: "p0", patch: { maxAnswerLen: 20 }, now: T0 });
    s = reduce(s, { type: "start", playerId: "p0", now: T0 });
    expect(code(() => reduce(s, { type: "answer", playerId: "p0", round: 0, text: "x".repeat(21), now: T0 }))).toBe(
      "INVALID_ANSWER",
    );
    expect(reduce(s, { type: "answer", playerId: "p0", round: 0, text: "x".repeat(20), now: T0 }).sheets[0][0]).toBe(
      "x".repeat(20),
    );
  });

  it("falls back to the defaults for rooms saved before settings existed", () => {
    const { settings: _omit, ...legacy } = lobby(2);
    const s = legacy as unknown as RoomState;
    expect(toPlayerView(s, "p0", T0).settings).toEqual(DEFAULT_SETTINGS);
    expect(reduce(s, { type: "start", playerId: "p0", now: T0 }).roundEndsAt).toBe(T0 + ROUND_MS);
  });
});

describe("roomName", () => {
  it("defaults to empty", () => {
    expect(lobby(2).settings.roomName).toBe("");
  });

  it("is trimmed at creation and by the host patch", () => {
    const s = reduce(null, {
      type: "create",
      code: "ABCD",
      host: player(0),
      settings: { roomName: "  Cena del venerdi  " },
      now: T0,
    });
    expect(s.settings.roomName).toBe("Cena del venerdi");

    const renamed = reduce(s, { type: "settings", playerId: "p0", patch: { roomName: " Nuovo " }, now: T0 });
    expect(renamed.settings.roomName).toBe("Nuovo");
    expect(toPlayerView(renamed, "p0", T0).settings.roomName).toBe("Nuovo");
  });

  it("rejects a name longer than the limit", () => {
    const s = lobby(2);
    expect(
      code(() => reduce(s, { type: "settings", playerId: "p0", patch: { roomName: "x".repeat(MAX_ROOM_NAME_LEN + 1) }, now: T0 })),
    ).toBe("INVALID_SETTINGS");
    expect(
      reduce(s, { type: "settings", playerId: "p0", patch: { roomName: "x".repeat(MAX_ROOM_NAME_LEN) }, now: T0 })
        .settings.roomName,
    ).toBe("x".repeat(MAX_ROOM_NAME_LEN));
  });

  it("an unchanged name leaves the state untouched, and can be cleared", () => {
    const named = reduce(lobby(2), { type: "settings", playerId: "p0", patch: { roomName: "Casa" }, now: T0 });
    expect(reduce(named, { type: "settings", playerId: "p0", patch: { roomName: "Casa" }, now: T0 })).toBe(named);
    expect(
      reduce(named, { type: "settings", playerId: "p0", patch: { roomName: "   " }, now: T0 }).settings.roomName,
    ).toBe("");
  });

  it("other settings changes keep the name", () => {
    const named = reduce(lobby(2), { type: "settings", playerId: "p0", patch: { roomName: "Casa" }, now: T0 });
    const s = reduce(named, { type: "settings", playerId: "p0", patch: { roundMs: 30_000 }, now: T0 });
    expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, roomName: "Casa", roundMs: 30_000 });
  });
});
