"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Disclosure, Field } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createId } from "@/lib/platform/hash";
import { md5 } from "@/lib/platform/md5";
import {
  classifyOutcome,
  countOutcomes,
  evaluateFormula,
  type MetricDefinition,
  type OutcomeKind,
} from "@/lib/platform/metrics";
import { usePrototypeStore } from "@/lib/platform/store";
import type { AuditRecord, Decision } from "@/lib/platform/types";

export type TestCase = {
  input: string;
  expected: string;
  decision: string;
  status: string;
  capabilityIds?: string[];
  ruleHits?: AuditRecord["ruleHits"];
};

const builtinMetrics = new Set(["accuracy", "falsePositiveRate", "falseNegativeRate"]);
const seedAuditIds = new Set(["aud_1", "aud_2", "aud_3", "aud_4", "aud_5", "aud_6", "aud_7", "aud_8"]);

export function isSeedAudit(id: string) {
  return seedAuditIds.has(id);
}

export function TestReport({
  cases,
  source,
  applicationId = "app_community",
  channelId = "ch_posts",
  sceneId = "scene_ugc",
  inputType = "text",
}: {
  cases: TestCase[];
  source: string;
  applicationId?: string;
  channelId?: string;
  sceneId?: string;
  inputType?: "text" | "image";
}) {
  const t = useTranslations("Catalog");
  const enums = useTranslations("Enums");
  const store = usePrototypeStore();
  const counts = useMemo(() => countOutcomes(cases), [cases]);
  const signature = cases.map((item) => [item.input, item.expected, item.decision, item.status].join("\t")).join("\n");
  const batch = useMemo(() => (signature ? md5(`${source}\n${signature}`).slice(0, 10) : ""), [signature, source]);
  const [draft, setDraft] = useState<MetricDefinition[]>(store.state.metrics);

  useEffect(() => {
    setDraft(store.state.metrics);
  }, [store.state.metrics]);

  useEffect(() => {
    if (!cases.length || !batch) return;
    const now = new Date().toISOString();
    const records: AuditRecord[] = cases.map((item, index) => {
      const errored = item.status === "error" || (item.expected && !item.decision);
      const decision = item.decision === "allow" || item.decision === "block" || item.decision === "review" ? item.decision : null;
      return {
        id: `aud_${batch}_${index + 1}`,
        requestId: `req_${batch}_${index + 1}`,
        applicationId,
        channelId,
        sceneId,
        inputType,
        content: item.input,
        contentMd5: md5(item.input),
        decision: errored ? null : decision,
        riskLabels: [],
        status: errored ? "error" : "success",
        latencyMs: 1,
        createdAt: now,
        ruleHits: item.ruleHits ?? [],
        modelCalls: (item.capabilityIds ?? []).map((capabilityId) => ({
          capabilityId,
          status: errored ? "error" as const : "success" as const,
          latencyMs: 1,
        })),
        trace: ["start", "end"],
      };
    });
    store.recordAudits(records);
  }, [applicationId, batch, cases, channelId, inputType, sceneId, store]);

  function labelOf(metric: MetricDefinition) {
    if (metric.name.trim()) return metric.name.trim();
    if (builtinMetrics.has(metric.id)) return t(`metric.${metric.id}`);
    return metric.id;
  }

  function formatValue(formula: string) {
    const value = evaluateFormula(formula, counts);
    if (value == null) return t("formulaError");
    if (!Number.isFinite(value)) return "—";
    if (formula.includes("/")) return `${(value * 100).toFixed(1)}%`;
    return String(Math.round(value * 1000) / 1000);
  }

  function outcomeLabel(kind: OutcomeKind) {
    return t(`outcome.${kind}`);
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("outcomeTitle")}</h2>
        <Link
          href="/console/audit-logs"
          className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-sm"
          onClick={() => {
            if (batch) sessionStorage.setItem("aegis_audit_focus", batch);
          }}
        >
          {t("viewAudit")}
        </Link>
      </div>
      <p className="text-sm text-slate-600">{t("outcomeHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CountCard label={t("outcome.falsePositive")} value={String(counts.falsePositive)} />
        <CountCard label={t("outcome.falseNegative")} value={String(counts.falseNegative)} />
        <CountCard label={t("outcome.correct")} value={String(counts.correct)} />
        <CountCard label={t("metric.total")} value={String(counts.total)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {store.state.metrics.map((metric) => (
          <CountCard key={metric.id} label={labelOf(metric)} value={formatValue(metric.formula)} hint={metric.formula} />
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">{t("caseInput")}</th>
              <th className="px-3 py-2 font-medium">{t("expected")}</th>
              <th className="px-3 py-2 font-medium">{t("decision")}</th>
              <th className="px-3 py-2 font-medium">{t("outcomeTitle")}</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((item, index) => {
              const kind = classifyOutcome(item.expected, item.decision, item.status);
              return (
                <tr key={`${item.input}-${index}`} className="border-t border-slate-100">
                  <td className="max-w-xs truncate px-3 py-2" title={item.input}>{item.input}</td>
                  <td className="px-3 py-2">{decisionLabel(item.expected, enums)}</td>
                  <td className="px-3 py-2">{decisionLabel(item.decision, enums)}</td>
                  <td className="px-3 py-2">{outcomeLabel(kind)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Disclosure title={t("metricsTitle")} hint={t("metricsShared")}>
        <p className="text-xs text-slate-500">{t("metricVars")}</p>
        <div className="space-y-2">
          {draft.map((metric, index) => (
            <div key={metric.id} className="grid gap-2 md:grid-cols-[1fr_1.4fr_auto]">
              <Field label={t("metricName")}>
                <Input
                  value={metric.name}
                  placeholder={labelOf(metric)}
                  onChange={(event) => setDraft(draft.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
                />
              </Field>
              <Field label={t("formula")}>
                <Input
                  value={metric.formula}
                  onChange={(event) => setDraft(draft.map((item, itemIndex) => itemIndex === index ? { ...item, formula: event.target.value } : item))}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDraft(draft.filter((_, itemIndex) => itemIndex !== index))}
                >
                  {t("delete")}
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft([...draft, { id: createId("metric"), name: "", formula: "correct / total" }])}
          >
            {t("addMetric")}
          </Button>
          <Button type="button" onClick={() => store.saveMetrics(draft.length ? draft : store.state.metrics)}>
            {t("save")}
          </Button>
        </div>
      </Disclosure>
    </section>
  );
}

function CountCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold tracking-tight text-zinc-950">{value}</p>
      {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

function decisionLabel(value: string, enums: (key: string) => string) {
  if (value === "allow" || value === "block" || value === "review") return enums(`decision.${value as Decision}`);
  return "—";
}
