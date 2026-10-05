import { BadRequestError, errorResponse, json, mutateAsPlayer, normalizeCode, readBody } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  try {
    const code = normalizeCode((await params).code);
    const body = await readBody<{ playerId?: unknown }>(req);
    if (typeof body.playerId !== "string") throw new BadRequestError();
    const targetId = body.playerId;
    const view = await mutateAsPlayer(code, req, (playerId, now) => ({
      type: "kick",
      playerId,
      targetId,
      now,
    }));
    return json(view);
  } catch (e) {
    return errorResponse(e);
  }
}
