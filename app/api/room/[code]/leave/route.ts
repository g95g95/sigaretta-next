import { errorResponse, json, leaveAsPlayer, normalizeCode } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  try {
    const code = normalizeCode((await params).code);
    await leaveAsPlayer(code, req);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
