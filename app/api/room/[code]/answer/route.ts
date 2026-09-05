import { BadRequestError, errorResponse, json, mutateAsPlayer, normalizeCode, readBody } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  try {
    const code = normalizeCode((await params).code);
    const { text, round } = await readBody<{ text?: unknown; round?: unknown }>(req);
    if (typeof round !== "number") throw new BadRequestError("round mancante");
    const view = await mutateAsPlayer(code, req, (playerId, now) => ({
      type: "answer",
      playerId,
      round,
      text: typeof text === "string" ? text : "",
      now,
    }));
    return json(view);
  } catch (e) {
    return errorResponse(e);
  }
}
