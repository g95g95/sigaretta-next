import { BadRequestError, errorResponse, json, mutateAsPlayer, normalizeCode, readBody } from "@/lib/api";
import type { RoomSettings, SettingsPatch } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEYS: (keyof RoomSettings)[] = ["mode", "rounds", "minPlayers", "maxPlayers", "roundMs", "maxAnswerLen"];

/** Tiene solo le chiavi note e presenti; i valori li valida il reducer. */
function toPatch(body: unknown): SettingsPatch {
  if (!body || typeof body !== "object") throw new BadRequestError();
  const patch: Record<string, unknown> = {};
  const src = body as Record<string, unknown>;
  for (const k of KEYS) if (src[k] !== undefined) patch[k] = src[k];
  return patch as SettingsPatch;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  try {
    const code = normalizeCode((await params).code);
    const patch = toPatch(await readBody<unknown>(req));
    const view = await mutateAsPlayer(code, req, (playerId, now) => ({
      type: "settings",
      playerId,
      patch,
      now,
    }));
    return json(view);
  } catch (e) {
    return errorResponse(e);
  }
}
