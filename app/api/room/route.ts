import { errorResponse, json, readBody } from "@/lib/api";
import { generateCode, newId, newToken, reduce } from "@/lib/game";
import { MAX_NAME_LEN } from "@/lib/prompts";
import { getStore } from "@/lib/store";
import { GameError } from "@/lib/types";
import type { GameMode, JoinResponse, SettingsPatch } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CODE_TRIES = 10;

export async function POST(req: Request): Promise<Response> {
  try {
    const { name, mode, rounds } = await readBody<{ name?: unknown; mode?: unknown; rounds?: unknown }>(req);
    // Il reducer non valida il nome dell'host in "create": lo facciamo qui.
    const clean = typeof name === "string" ? name.trim() : "";
    if (clean.length < 1 || clean.length > MAX_NAME_LEN) throw new GameError("INVALID_NAME");
    // Impostazioni iniziali (solo modalità e turni; il resto ai default). Le valida il reducer.
    const settings: SettingsPatch = {};
    if (mode !== undefined) settings.mode = mode as GameMode;
    if (rounds !== undefined) settings.rounds = rounds as number;

    const store = getStore();
    const host = { id: newId(), token: newToken(), name: clean };

    for (let i = 0; i < MAX_CODE_TRIES; i++) {
      const code = generateCode();
      const state = reduce(null, { type: "create", code, host, settings, now: Date.now() });
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
