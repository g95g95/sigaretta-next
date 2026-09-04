import { describe, expect, it } from "vitest";
import { generateCode, reduce, settle, sheetFor, toPlayerView } from "./game";
import { CODE_ALPHABET, EMPTY, ROUND_MS, SLOTS } from "./prompts";
import { GameError } from "./types";
import type { RoomState } from "./types";

const T0 = 1_000_000;

function player(i: number) {
  return { id: `p${i}`, token: `tok${i}`, name: `Player${i}` };
}

function lobby(n: number, now = T0): RoomState {
  let s = reduce(null, { type: "create", code: "ABCD", host: player(0), now });
  for (let i = 1; i < n; i++) s = reduce(s, { type: "join", player: player(i), now });
  return s;
}

function started(n: number, now = T0): RoomState {
  return reduce(lobby(n, now), { type: "start", playerId: "p0", now });
}

function answerAll(s: RoomState, now: number): RoomState {
  const r = s.round;
  for (const p of s.players) s = reduce(s, { type: "answer", playerId: p.id, text: `${p.id}-r${r}`, now });
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
    s = reduce(s, { type: "answer", playerId: "p0", text: "a", now: T0 + 1 });
    expect(s.round).toBe(0);
    s = reduce(s, { type: "answer", playerId: "p1", text: "b", now: T0 + 2 });
    expect(s.round).toBe(1);
    expect(s.roundEndsAt).toBe(T0 + 2 + ROUND_MS);
  });
});

describe("timeout", () => {
  it("advances the round on tick after roundEndsAt; missing slots stay null and show as EMPTY", () => {
    let s = started(2);
    s = reduce(s, { type: "answer", playerId: "p0", text: "solo", now: T0 + 5 });
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

  it("settle is applied before any action (late answer lands in the next round)", () => {
    let s = started(2);
    s = reduce(s, { type: "answer", playerId: "p0", text: "late", now: T0 + ROUND_MS });
    expect(s.round).toBe(1);
    expect(s.sheets[sheetFor(0, 1, 2)][1]).toBe("late");
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
    s = reduce(s, { type: "answer", playerId: "p0", text: "SEGRETO", now: T0 + 1 });
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
    reduce(s, { type: "answer", playerId: "p0", text: "x", now: T0 + 1 });
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
    const s = reduce(started(2), { type: "answer", playerId: "p0", text: "a", now: T0 });
    expect(code(() => reduce(s, { type: "answer", playerId: "p0", text: "b", now: T0 }))).toBe("ALREADY_ANSWERED");
  });
  it("INVALID_ANSWER on empty text", () => {
    expect(code(() => reduce(started(2), { type: "answer", playerId: "p0", text: "   ", now: T0 }))).toBe("INVALID_ANSWER");
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
