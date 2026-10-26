export const leadIntents = ["whitepaper", "demo", "analytics", "sandbox"] as const;

export type LeadIntent = (typeof leadIntents)[number];

export type InquiryKind = "contact" | "lead";

export type Inquiry = {
  id: string;
  kind: InquiryKind;
  name: string;
  email: string;
  company: string;
  intent: string;
  need: string;
  locale: string;
  createdAt: string;
};

export type InquiryInput = Omit<Inquiry, "id" | "createdAt">;

const locales = new Set(["en", "es", "zh"]);
const intentSet = new Set<string>(leadIntents);

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function parseInquiry(
  body: unknown
): { ok: true; value: InquiryInput } | { ok: false; fields: string[] } {
  if (!body || typeof body !== "object") return { ok: false, fields: ["body"] };
  const record = body as Record<string, unknown>;
  const kind = record.kind === "contact" || record.kind === "lead" ? record.kind : null;
  const fields: string[] = [];
  if (!kind) fields.push("kind");
  const name = text(record.name, 80);
  const email = text(record.email, 120);
  const company = text(record.company, 120);
  const need = text(record.need, 2000);
  const intent = text(record.intent, 40);
  const locale = text(record.locale, 8);
  if (!name) fields.push("name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.push("email");
  if (!company) fields.push("company");
  if (kind === "contact" && need.length < 12) fields.push("need");
  if (kind === "lead" && !intentSet.has(intent)) fields.push("intent");
  if (!kind || fields.length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: {
      kind,
      name,
      email,
      company,
      intent: kind === "lead" ? intent : "",
      need: kind === "contact" ? need : "",
      locale: locales.has(locale) ? locale : "en",
    },
  };
}
