"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { OperatorGate } from "@/lib/platform/session";
import { formatDateTime } from "@/lib/platform/hash";
import type { Inquiry } from "@/lib/inquiries";

export function InquiriesView() {
  const t = useTranslations("Console");
  const lead = useTranslations("LeadForm");
  const contact = useTranslations("Contact");
  const locale = useLocale();
  const [items, setItems] = useState<Inquiry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/inquiries", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("store");
        return response.json() as Promise<{ items?: Inquiry[] }>;
      })
      .then((body) => {
        if (!cancelled) setItems(body.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <OperatorGate>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("inquiriesTitle")}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{t("inquiriesBody")}</p>
        {failed ? <p className="text-sm text-rose-700">{t("inquiriesError")}</p> : null}
        {items && items.length === 0 ? <p className="text-sm text-slate-500">{t("inquiriesEmpty")}</p> : null}
        {items && items.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("inquiriesWhen")}</th>
                  <th className="px-3 py-2 font-medium">{t("inquiriesKind")}</th>
                  <th className="px-3 py-2 font-medium">{contact("name")}</th>
                  <th className="px-3 py-2 font-medium">{contact("email")}</th>
                  <th className="px-3 py-2 font-medium">{contact("company")}</th>
                  <th className="px-3 py-2 font-medium">{lead("intent")}</th>
                  <th className="px-3 py-2 font-medium">{contact("need")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                      {formatDateTime(item.createdAt, locale)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {item.kind === "contact" ? t("kindContact") : t("kindLead")}
                    </td>
                    <td className="px-3 py-2 text-slate-900">{item.name}</td>
                    <td className="px-3 py-2 text-slate-700">{item.email}</td>
                    <td className="px-3 py-2 text-slate-700">{item.company}</td>
                    <td className="px-3 py-2 text-slate-700">{intentLabel(item.intent, lead)}</td>
                    <td className="max-w-xs px-3 py-2 text-slate-700">{item.need || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </OperatorGate>
  );
}

function intentLabel(intent: string, lead: (key: string) => string): string {
  if (intent === "whitepaper") return lead("intentWhitepaper");
  if (intent === "demo") return lead("intentDemo");
  if (intent === "analytics") return lead("intentAnalytics");
  if (intent === "sandbox") return lead("intentSandbox");
  return "—";
}
