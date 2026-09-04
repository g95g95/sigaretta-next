import { errorResponse, json, mutateAsPlayer, normalizeCode } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  try {
    const code = normalizeCode((await params).code);
    const view = await mutateAsPlayer(code, req, (playerId, now) => ({
      type: "advance",
      playerId,
      now,
    }));
    return json(view);
  } catch (e) {
    return errorResponse(e);
  }
}
