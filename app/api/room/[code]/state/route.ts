import { errorResponse, json, mutateAsPlayer, normalizeCode } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  try {
    const code = normalizeCode((await params).code);
    const view = await mutateAsPlayer(code, req, (playerId, now) => ({
      type: "seen",
      playerId,
      now,
    }));
    return json(view);
  } catch (e) {
    return errorResponse(e);
  }
}
