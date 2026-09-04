import { errorResponse, json, mutate, normalizeCode, readBody } from "@/lib/api";
import { newId, newToken } from "@/lib/game";
import type { JoinResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  try {
    const code = normalizeCode((await params).code);
    const { name } = await readBody<{ name?: unknown }>(req);
    const player = { id: newId(), token: newToken(), name: typeof name === "string" ? name : "" };

    await mutate(code, (_s, now) => ({ type: "join", player, now }), { viewAs: player.id });

    const body: JoinResponse = { code, token: player.token, playerId: player.id };
    return json(body);
  } catch (e) {
    return errorResponse(e);
  }
}
