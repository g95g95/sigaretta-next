import { errorResponse, json, readBody } from "@/lib/api";
import { generateCode, newId, newToken, reduce } from "@/lib/game";
import { MAX_NAME_LEN } from "@/lib/prompts";
import { getStore } from "@/lib/store";
import { GameError } from "@/lib/types";
import type { JoinResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CODE_TRIES = 10;

export async function POST(req: Request): Promise<Response> {
  try {
    const { name } = await readBody<{ name?: unknown }>(req);
    // Il reducer non valida il nome dell'host in "create": lo facciamo qui.
    const clean = typeof name === "string" ? name.trim() : "";
    if (clean.length < 1 || clean.length > MAX_NAME_LEN) throw new GameError("INVALID_NAME");

    const store = getStore();
    const host = { id: newId(), token: newToken(), name: clean };

    for (let i = 0; i < MAX_CODE_TRIES; i++) {
      const code = generateCode();
      const state = reduce(null, { type: "create", code, host, now: Date.now() });
      try {
        await store.create(state);
      } catch (e) {
        if (e instanceof GameError && e.code === "CONFLICT") continue;
        throw e;
      }
      const body: JoinResponse = { code, token: host.token, playerId: host.id };
      return json(body, 201);
    }

    throw new GameError("CONFLICT", "Nessun codice stanza libero");
  } catch (e) {
    return errorResponse(e);
  }
}
