import { parseInquiry } from "@/lib/inquiries";
import { addInquiry, listInquiries } from "@/lib/server/inquiry-store";

export async function GET() {
  try {
    const items = await listInquiries();
    return Response.json({ items });
  } catch {
    return Response.json({ error: "store" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = parseInquiry(body);
  if (!parsed.ok) return Response.json({ error: "validation", fields: parsed.fields }, { status: 400 });
  try {
    const record = await addInquiry(parsed.value);
    return Response.json({ id: record.id });
  } catch {
    return Response.json({ error: "store" }, { status: 500 });
  }
}
