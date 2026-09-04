import { reduce, toPlayerView } from "./game";
import { getStore } from "./store";
import { GameError } from "./types";
import type { Action, ApiError, GameErrorCode, PlayerView, RoomState } from "./types";

const MAX_ATTEMPTS = 5;

export class BadRequestError extends Error {
  constructor(message = "Body non valido") {
    super(message);
    this.name = "BadRequestError";
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function readBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new BadRequestError();
  }
}

export function tokenFrom(req: Request): string | null {
  return req.headers.get("x-player-token");
}

/** Codice stanza normalizzato; formato non valido = stanza inesistente. */
export function normalizeCode(raw: string): string {
  const code = raw.toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) throw new GameError("ROOM_NOT_FOUND");
  return code;
}

const STATUS: Partial<Record<GameErrorCode, number>> = {
  ROOM_NOT_FOUND: 404,
  NOT_HOST: 403,
  NOT_A_PLAYER: 403,
  CONFLICT: 409,
};

export function errorResponse(e: unknown): Response {
  const body: ApiError =
    e instanceof GameError
      ? { error: e.code, message: e.message }
      : e instanceof BadRequestError
        ? { error: "BAD_REQUEST", message: e.message }
        : { error: "INTERNAL", message: e instanceof Error ? e.message : "Errore interno" };

  if (e instanceof GameError) return json(body, STATUS[e.code] ?? 400);
  if (e instanceof BadRequestError) return json(body, 400);
  console.error("[sigaretta]", e);
  return json(body, 500);
}

/**
 * Chi guarda il risultato: un player già esistente (identificato dal token) oppure,
 * per il join, l'id del player che l'azione sta creando.
 */
type Viewer = { token: string } | { viewAs: string };

/** Applica un'azione con lock ottimistico: rilegge e riprova finché la CAS passa. */
export async function mutate(
  code: string,
  makeAction: (state: RoomState, now: number) => Action,
  viewer: Viewer,
): Promise<PlayerView> {
  const store = getStore();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const state = await store.get(code);
    if (!state) throw new GameError("ROOM_NOT_FOUND");

    let viewId: string;
    if ("token" in viewer) {
      const me = state.players.find((p) => p.token === viewer.token);
      if (!me) throw new GameError("NOT_A_PLAYER");
      viewId = me.id;
    } else {
      viewId = viewer.viewAs;
    }

    const now = Date.now();
    const next = reduce(state, makeAction(state, now));
    if (next === state) return toPlayerView(state, viewId, now);

    const written: RoomState = { ...next, version: state.version + 1 };
    if (await store.cas(code, state.version, written)) {
      return toPlayerView(written, viewId, now);
    }
  }

  throw new GameError("CONFLICT");
}

/** Azione di un player già iscritto: risolve l'id dal token e costruisce l'azione. */
export async function mutateAsPlayer(
  code: string,
  req: Request,
  makeAction: (playerId: string, now: number) => Action,
): Promise<PlayerView> {
  const token = tokenFrom(req);
  if (!token) throw new GameError("NOT_A_PLAYER");
  return mutate(
    code,
    (s, now) => {
      const me = s.players.find((p) => p.token === token);
      if (!me) throw new GameError("NOT_A_PLAYER");
      return makeAction(me.id, now);
    },
    { token },
  );
}
