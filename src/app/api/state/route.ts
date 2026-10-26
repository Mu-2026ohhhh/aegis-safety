import { isPrototypeState } from "@/lib/platform/state-guard";
import { readPrototypeState, writePrototypeState } from "@/lib/server/state-store";

export async function GET() {
  try {
    const envelope = await readPrototypeState();
    if (!envelope) return Response.json({ savedAt: null, state: null });
    return Response.json(envelope);
  } catch {
    return Response.json({ error: "store" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let text = "";
  try {
    text = await request.text();
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  if (text.length > 8_000_000) return Response.json({ error: "too_large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return Response.json({ error: "invalid" }, { status: 400 });
  const record = body as { savedAt?: unknown; state?: unknown };
  if (typeof record.savedAt !== "string" || Number.isNaN(Date.parse(record.savedAt))) {
    return Response.json({ error: "savedAt" }, { status: 400 });
  }
  if (!isPrototypeState(record.state)) return Response.json({ error: "state" }, { status: 400 });
  try {
    await writePrototypeState(record.savedAt, record.state);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "store" }, { status: 500 });
  }
}
