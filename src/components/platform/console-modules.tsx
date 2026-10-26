"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DecisionBadge,
  Drawer,
  EmptyState,
  ErrorBlock,
  Field,
  PrototypeBanner,
  SimpleSelect,
  StatusBadge,
  useFormatters,
  useScopeLabel,
  useToast,
} from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { CaseSheetBar, QueryFields, type FieldGroup } from "@/components/platform/case-batch";
import { TestReport, isSeedAudit } from "@/components/platform/test-report";
import { auditGroupFields, presentAudit } from "@/lib/platform/audit-present";
import { downloadCsv, hitSeries } from "@/lib/platform/csv";
import { interceptText } from "@/lib/platform/intercept";
import { releaseGate } from "@/lib/platform/governance";
import { moderationLimits } from "@/lib/platform/limits";
import { datasets } from "@/lib/platform/seed";
import { OperatorGate, useSession } from "@/lib/platform/session";
import { usePrototypeStore } from "@/lib/platform/store";
import type { AuditRecord, Capability, Decision } from "@/lib/platform/types";
import { QuickRollback } from "@/components/platform/ops-views";
import { validateWorkflow } from "@/lib/platform/workflow-engine";

export function OverviewView() {
  const t = useTranslations("Console");
  const store = usePrototypeStore();
  const signals = [
    { label: "example_politics", score: "0.18" },
    { label: "example_adult", score: "0.04" },
    { label: "example_risk", score: "0.61" },
  ];
  const trend = hitSeries.filter((item) => item.tenantId === "ten_demo" && item.month === "2026-10");
  const max = Math.max(...trend.map((item) => item.count), 1);
  const cards = [
    ["rules", store.state.rules.length, "/console/rules"],
    ["workflows", store.state.workflows.length, "/console/workflows"],
    ["lab", store.state.evaluations.length, "/console/lab"],
    ["releases", store.state.releases.length, "/console/releases"],
  ] as const;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("overviewTitle")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">{t("overviewBody")}</p>
      </div>
      <div className="grid gap-4">
        <article className="rounded-2xl bg-zinc-950 p-5 text-white">
          <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
            <span>{t("queueTitle")}</span>
            <span>{t("simulated")}</span>
          </div>
          <p className="mt-4 max-w-xl text-lg leading-snug">{t("queueSample")}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {signals.map((item) => (
              <span key={item.label} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-zinc-100">
                {item.label}
                <span className="ml-2 text-zinc-400">{item.score}</span>
              </span>
            ))}
          </div>
          <div className="mt-6 flex items-end justify-between gap-3 border-t border-white/10 pt-4">
            <div>
              <p className="text-xs text-zinc-500">{t("queueDecision")}</p>
              <p className="mt-1 text-sm font-medium">{t("queueAction")}</p>
            </div>
            <Link href="/console/audit-logs" className="text-sm text-zinc-300 underline-offset-4 hover:underline">
              {t("openQueue")}
            </Link>
          </div>
        </article>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cards.map(([key, count, href]) => (
            <Link key={key} href={href} className="rounded-2xl border border-zinc-200 bg-white p-4 hover:border-zinc-400">
              <p className="text-xs text-zinc-500">{t(`nav.${key}`)}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight">{count}</p>
            </Link>
          ))}
        </div>
      </div>
      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("signalTitle")}</h2>
        <div className="mt-4 space-y-3">
          {trend.map((item) => (
            <div key={item.label} className="grid grid-cols-[8rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm">
              <span className="truncate text-zinc-600">{item.label}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
                <span className="block h-1.5 rounded-full bg-zinc-950" style={{ width: `${(item.count / max) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums">{item.count}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function CapabilitiesView() {
  const t = useTranslations("Capabilities");
  const enums = useTranslations("Enums");
  const site = useTranslations("Site");
  const format = useFormatters();
  const store = usePrototypeStore();
  const { notify } = useToast();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [active, setActive] = useState<Capability | null>(null);
  const [name, setName] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(2000);
  const [enabled, setEnabled] = useState<Capability["status"]>("enabled");

  const rows = store.state.capabilities.filter((item) => {
    const label = (item.customName ?? enums(`capabilities.${item.id}`)).toLowerCase();
    if (query && !`${label} ${item.id}`.includes(query.toLowerCase())) return false;
    if (type !== "all" && item.type !== type) return false;
    if (status !== "all" && item.status !== status) return false;
    return true;
  });

  function open(item: Capability) {
    setActive(item);
    setName(item.customName ?? "");
    setTimeoutMs(item.timeoutMs);
    setEnabled(item.status);
  }

  return (
    <OperatorGate>
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("title")}</h1>
      <p className="max-w-3xl text-sm text-slate-600">{t("description")}</p>
      <PrototypeBanner>{t("notConnected")}</PrototypeBanner>
      <div className="grid gap-3 md:grid-cols-3">
        <Input value={query} placeholder={t("search")} onChange={(event) => setQuery(event.target.value)} />
        <SimpleSelect
          value={type}
          onChange={setType}
          options={[
            { value: "all", label: site("all") },
            ...["inhouse_small", "inhouse_llm", "keyword_list", "other"].map((item) => ({
              value: item,
              label: enums(`capabilityType.${item}`),
            })),
          ]}
        />
        <SimpleSelect
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: site("all") },
            { value: "enabled", label: enums("status.enabled") },
            { value: "disabled", label: enums("status.disabled") },
          ]}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {["id", "name", "type", "modalities", "version", "status", "timeout", "actions"].map(
                (column) => (
                  <th key={column} className="px-3 py-2 font-medium">
                    {t(`columns.${column}`)}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const activeVersion = item.versions.find((version) => version.status === "active");
              return (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{item.id}</td>
                  <td className="px-3 py-2">{item.customName ?? enums(`capabilities.${item.id}`)}</td>
                  <td className="px-3 py-2">{enums(`capabilityType.${item.type}`)}</td>
                  <td className="px-3 py-2">
                    {item.modalities.map((modality) => enums(`modality.${modality}`)).join(", ")}
                  </td>
                  <td className="px-3 py-2">{activeVersion?.version}</td>
                  <td className="px-3 py-2">
                    <StatusBadge value={item.status} />
                  </td>
                  <td className="px-3 py-2">{format.number(item.timeoutMs)} ms</td>
                  <td className="px-3 py-2">
                    <Button size="sm" variant="outline" onClick={() => open(item)}>
                      {site("view")}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Drawer
        open={Boolean(active)}
        title={active ? active.customName ?? enums(`capabilities.${active.id}`) : ""}
        description={active?.id}
        onClose={() => setActive(null)}
      >
        {active ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">{t("boundary")}</p>
            <ul className="space-y-1 text-sm">
              {active.versions.map((version) => (
                <li key={version.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  {version.version} · {version.id} · {enums(`versionState.${version.status}`)}
                </li>
              ))}
            </ul>
            <Field label={t("customName")} hint={t("customNameHint")}>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label={t("timeout")}>
              <Input
                type="number"
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(Number(event.target.value))}
              />
            </Field>
            <Field label={t("statusLabel")}>
              <SimpleSelect
                value={enabled}
                onChange={(value) => setEnabled(value as Capability["status"])}
                options={[
                  { value: "enabled", label: enums("status.enabled") },
                  { value: "disabled", label: enums("status.disabled") },
                ]}
              />
            </Field>
            <Button
              onClick={() => {
                const result = store.updateCapability(active.id, {
                  customName: name,
                  timeoutMs,
                  status: enabled,
                });
                if (!result.ok) {
                  notify({ tone: "error", title: t("timeoutError") });
                  return;
                }
                notify({ tone: "success", title: t("saved") });
                setActive(null);
              }}
            >
              {site("save")}
            </Button>
          </div>
        ) : null}
      </Drawer>
    </div>
    </OperatorGate>
  );
}

export function LabView() {
  const t = useTranslations("Lab");
  const catalog = useTranslations("Catalog");
  const ops = useTranslations("Ops");
  const enums = useTranslations("Enums");
  const format = useFormatters();
  const store = usePrototypeStore();
  const { notify } = useToast();
  const [target, setTarget] = useState("rule:rule_struct");
  const [datasetId, setDatasetId] = useState("ds_mirror");
  const [pending, setPending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>("ev_struct_mirror");
  const [effect, setEffect] = useState<Array<{ input: string; expected: string; status: string; decision: string }>>([]);

  const [targetType, targetId] = target.split(":") as ["rule" | "workflow", string];
  const options = [
    ...store.state.rules.map((rule) => {
      const version = store.state.ruleVersions.find((item) => item.id === rule.currentVersionId);
      return { value: `rule:${rule.id}`, label: `${t("rule")} · ${version?.name ?? rule.id}` };
    }),
    ...store.state.workflows.map((workflow) => {
      const version = store.state.workflowVersions.find(
        (item) => item.id === workflow.currentVersionId
      );
      return {
        value: `workflow:${workflow.id}`,
        label: `${t("workflow")} · ${version?.name ?? workflow.id}`,
      };
    }),
  ];

  const run = store.state.evaluations.find((item) => item.id === activeRunId) ?? null;
  const plan = store.state.executionPlans.find((item) => item.id === run?.executionPlanId);

  async function start() {
    if (targetType === "workflow") {
      const workflow = store.state.workflows.find((item) => item.id === targetId);
      const version = store.state.workflowVersions.find(
        (item) => item.id === workflow?.currentVersionId
      );
      if (version && validateWorkflow(version.nodes, version.edges).length > 0) {
        notify({ tone: "error", title: t("invalidWorkflow") });
        return;
      }
    }
    setPending(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const result = store.startEvaluation({ targetType, targetId, datasetId });
    setPending(false);
    if (!result.ok) {
      notify({ tone: "error", title: t("failed") });
      return;
    }
    setActiveRunId(result.data.id);
    notify({ tone: "success", title: t("finished") });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("title")}</h1>
      <p className="max-w-3xl text-sm text-slate-600">{t("description")}</p>
      <PrototypeBanner>{t("mockNotice")}</PrototypeBanner>
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-3">
        <Field label={t("candidate")}>
          <SimpleSelect value={target} onChange={setTarget} options={options} />
        </Field>
        <Field label={t("dataset")}>
          <SimpleSelect
            value={datasetId}
            onChange={setDatasetId}
            options={datasets.map((dataset) => ({
              value: dataset.id,
              label: t(`datasets.${dataset.id}`),
            }))}
          />
        </Field>
        <div className="flex items-end">
          <Button onClick={start} disabled={pending}>
            {pending ? t("running") : t("start")}
          </Button>
        </div>
      </div>
      <p className="text-sm text-slate-600">{t("baselineHelp")}</p>
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{catalog("effectTitle")}</h2>
        <p className="text-sm text-slate-600">{catalog("effectBody")}</p>
        <CaseSheetBar
          onLoad={(rows) => {
            const versions =
              targetType === "rule"
                ? store.state.ruleVersions.filter((version) => {
                    const rule = store.state.rules.find((item) => item.id === targetId);
                    return version.id === rule?.currentVersionId && version.status !== "archived";
                  })
                : [];
            setEffect(
              rows.map((row) => {
                if (targetType === "rule") {
                  const result = interceptText(row.input, versions);
                  return { input: row.input, expected: row.expected, status: result.status, decision: result.decision ?? "" };
                }
                const text = row.input.toLowerCase();
                const decision = text.includes("demo_block_token")
                  ? "block"
                  : text.includes("demo_review_token")
                    ? "review"
                    : "allow";
                return { input: row.input, expected: row.expected, status: "success", decision };
              })
            );
          }}
        />
        {effect.length > 0 ? (
          <TestReport
            source={`lab-effect-${targetId}`}
            cases={effect.map((row) => ({
              ...row,
              capabilityIds: targetType === "workflow" ? ["cap_text_llm"] : ["cap_text_small"],
            }))}
          />
        ) : null}
      </div>
      {run ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={run.status === "passed" ? "evaluation_passed" : "failed"} />
            <span className="text-sm text-slate-500">{format.date(run.createdAt)}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label={t("total")} value={format.number(run.total)} />
            <Metric label={t("changed")} value={format.number(run.changedCount)} />
            <Metric label={enums("decision.allow")} value={format.number(run.decisionCounts.allow)} />
            <Metric label={enums("decision.block")} value={format.number(run.decisionCounts.block)} />
          </div>
          {plan ? (
            <div className="text-xs text-slate-600">
              <p>{t("plan", { id: plan.id })}</p>
              <p>
                {t("planBody", {
                  rules: plan.ruleVersionIds.join(", ") || "—",
                  capabilities: plan.capabilityVersionIds.join(", ") || "—",
                  policy: t(`policies.${plan.decisionPolicy}`),
                })}
              </p>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  {["sample", "summary", "baseline", "candidate", "changed", "status", "review"].map((column) => (
                    <th key={column} className="px-2 py-2 font-medium">
                      {t(`columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {run.cases.map((item) => (
                  <tr key={item.sampleId} className="border-t border-slate-100">
                    <td className="px-2 py-2 font-mono text-xs">{item.sampleId}</td>
                    <td className="px-2 py-2">{t(`samples.${item.sampleId}`)}</td>
                    <td className="px-2 py-2">
                      <DecisionBadge value={item.baselineDecision} />
                    </td>
                    <td className="px-2 py-2">
                      {item.candidateDecision === "error" ? (
                        <StatusBadge value="failed" />
                      ) : (
                        <DecisionBadge value={item.candidateDecision} />
                      )}
                    </td>
                    <td className="px-2 py-2">{item.changed ? t("yes") : t("no")}</td>
                    <td className="px-2 py-2">{t(`caseStatus.${item.status}`)}</td>
                    <td className="px-2 py-2">
                      <SimpleSelect
                        value={
                          store.state.caseReviews.find(
                            (review) => review.runId === run.id && review.sampleId === item.sampleId
                          )?.humanDecision ?? "unset"
                        }
                        onChange={(value) => {
                          if (value === "unset") return;
                          store.saveCaseReview({
                            runId: run.id,
                            sampleId: item.sampleId,
                            humanDecision: value as Decision,
                            note: "",
                          });
                        }}
                        options={[
                          { value: "unset", label: ops("reviewPending") },
                          { value: "allow", label: enums("decision.allow") },
                          { value: "block", label: enums("decision.block") },
                          { value: "review", label: enums("decision.review") },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TestReport
            source={`lab-run-${run.id}`}
            cases={run.cases.map((item) => ({
              input: t(`samples.${item.sampleId}`),
              expected: item.baselineDecision,
              decision: item.candidateDecision === "error" ? "" : item.candidateDecision,
              status: item.candidateDecision === "error" ? "error" : "success",
              capabilityIds: plan?.capabilityVersionIds.length ? ["cap_text_small"] : ["cap_text_small"],
            }))}
          />
          <Button
            variant="outline"
            onClick={() => {
              downloadCsv("evaluation-review.csv", [
                [ops("sample"), ops("review")],
                ...run.cases.map((item) => {
                  const review = store.state.caseReviews.find(
                    (entry) => entry.runId === run.id && entry.sampleId === item.sampleId
                  );
                  return [item.sampleId, review?.humanDecision ?? ""];
                }),
              ]);
              notify({ tone: "success", title: ops("exported") });
            }}
          >
            {ops("exportReview")}
          </Button>
        </div>
      ) : (
        <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

export function ReleasesView() {
  const t = useTranslations("Releases");
  const format = useFormatters();
  const store = usePrototypeStore();
  const { notify } = useToast();
  const [target, setTarget] = useState("rule:rule_struct");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<"publish" | "rollback" | null>(null);
  const [targetType, targetId] = target.split(":") as ["rule" | "workflow", string];
  const gate = releaseGate(store.state, targetType, targetId);
  const versions =
    targetType === "rule"
      ? store.state.ruleVersions.filter((item) => item.ruleId === targetId)
      : store.state.workflowVersions.filter((item) => item.workflowId === targetId);
  const records = store.state.releases.filter((item) => item.targetId === targetId);
  const liveId =
    targetType === "rule"
      ? store.state.rules.find((item) => item.id === targetId)?.publishedVersionId
      : store.state.workflows.find((item) => item.id === targetId)?.publishedVersionId;

  const options = [
    ...store.state.rules.map((rule) => ({ value: `rule:${rule.id}`, label: rule.id })),
    ...store.state.workflows.map((workflow) => ({
      value: `workflow:${workflow.id}`,
      label: workflow.id,
    })),
  ];

  return (
    <OperatorGate>
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("title")}</h1>
      <p className="max-w-3xl text-sm text-slate-600">{t("description")}</p>
      <PrototypeBanner>{t("mockNotice")}</PrototypeBanner>
      <QuickRollback />
      <Field label={t("target")}>
        <SimpleSelect value={target} onChange={setTarget} options={options} />
      </Field>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("gateTitle")}</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {gate?.checks.map((check) => (
            <li key={check.id} className={check.ok ? "text-emerald-700" : "text-red-700"}>
              {t(`checks.${check.id}`)} · {check.ok ? t("pass") : t("fail")}
            </li>
          ))}
        </ul>
        {gate?.alreadyLive ? <p className="mt-2 text-sm text-slate-600">{t("alreadyLive")}</p> : null}
        <p className="mt-3 text-xs text-slate-500">{t("planNote", { id: gate?.fingerprint ?? "—" })}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={!gate?.ok} onClick={() => setConfirming("publish")}>
            {t("publish")}
          </Button>
          <Button variant="outline" onClick={() => setConfirming("rollback")}>
            {t("rollback")}
          </Button>
        </div>
        {!gate?.ok ? <p className="mt-2 text-sm text-slate-600">{t("blocked")}</p> : null}
      </div>
      {confirming ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium">
            {confirming === "publish" ? t("confirmPublish") : t("confirmRollback")}
          </p>
          <Field label={t("note")}>
            <Input value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button
              onClick={() => {
                const result =
                  confirming === "publish"
                    ? store.publish({ targetType, targetId, note })
                    : store.rollback({ targetType, targetId, note });
                if (!result.ok) {
                  notify({
                    tone: "error",
                    title: result.error === "no_previous" ? t("noPrevious") : t("rejected"),
                  });
                  return;
                }
                notify({
                  tone: "success",
                  title: confirming === "publish" ? t("published") : t("rolledBack"),
                });
                setConfirming(null);
                setNote("");
              }}
            >
              {t("confirm")}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">{t("version")}</th>
              <th className="px-3 py-2">{t("status")}</th>
              <th className="px-3 py-2">{t("summary")}</th>
              <th className="px-3 py-2">{t("live")}</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  v{version.version} · {version.id}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge value={version.status} />
                </td>
                <td className="px-3 py-2">{version.changeSummary}</td>
                <td className="px-3 py-2">{version.id === liveId ? t("yes") : t("no")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("history")}</h2>
        {records.length === 0 ? (
          <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          records
            .slice()
            .reverse()
            .map((record) => (
              <article key={record.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <p className="font-medium">
                  {t(`actions.${record.action}`)} · {record.versionId}
                </p>
                <p className="text-slate-600">{record.note}</p>
                <p className="text-xs text-slate-500">
                  {format.date(record.createdAt)} · {t("actor")} · {record.executionPlanId}
                  {record.previousVersionId ? ` · ${record.previousVersionId}` : ""}
                </p>
              </article>
            ))
        )}
      </div>
    </div>
    </OperatorGate>
  );
}

export function AuditView() {
  const t = useTranslations("Audit");
  const catalog = useTranslations("Catalog");
  const enums = useTranslations("Enums");
  const site = useTranslations("Site");
  const format = useFormatters();
  const scope = useScopeLabel();
  const store = usePrototypeStore();
  const { session } = useSession();
  const [active, setActive] = useState<AuditRecord | null>(null);
  const [focus, setFocus] = useState("");
  useEffect(() => {
    const value = sessionStorage.getItem("aegis_audit_focus") ?? "";
    if (!value) return;
    sessionStorage.removeItem("aegis_audit_focus");
    setFocus(value);
  }, []);

  const presented = useMemo(
    () =>
      store.state.auditRecords
        .filter((record) => {
          if (session?.role !== "customer") return true;
          const tenantId = store.state.applications.find((item) => item.id === record.applicationId)?.tenantId;
          return tenantId === session.tenantId;
        })
        .map((record) => ({
          record,
          flat: presentAudit(record, {
            application: store.state.applications.find((item) => item.id === record.applicationId)?.name ?? record.applicationId,
            channel: store.state.channels.find((item) => item.id === record.channelId)?.name ?? record.channelId,
            scene: scope(record.sceneId),
            capability: (id) => store.state.capabilities.find((item) => item.id === id)?.customName || enums(`capabilities.${id}`),
          }),
        })),
    [enums, scope, session, store.state.applications, store.state.auditRecords, store.state.capabilities, store.state.channels]
  );
  const labels = Object.fromEntries(Object.keys(presented[0]?.flat ?? {}).map((field) => [field, catalog(`auditField.${field}`)]));
  const groups: FieldGroup[] = auditGroupFields.map((group) => ({
    id: group.id,
    label: catalog(`fieldGroup.${group.id}`),
    fields: [...group.fields],
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("title")}</h1>
      <p className="max-w-3xl text-sm text-slate-600">{t("description")}</p>
      <PrototypeBanner>{t("mockNotice")}</PrototypeBanner>
      <QueryFields
        rows={presented.map((item) => item.flat)}
        defaultFields={["serial", "createdAt", "content", "contentMd5", "capabilities", "application", "channel", "ruleIds"]}
        labels={labels}
        groups={groups}
        hint={catalog("auditFieldHint")}
        focus={focus}
      >
        {(matched, selected) => {
          const ids = new Set(matched.map((row) => row.id));
          const visible = presented.filter((item) => ids.has(item.record.id));
          if (visible.length === 0 || selected.length === 0) {
            return <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />;
          }
          return (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    {selected.map((field) => (
                      <th key={field} className="px-3 py-2 font-medium">{labels[field] ?? field}</th>
                    ))}
                    <th className="px-3 py-2 font-medium">{site("view")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ record, flat }) => (
                    <tr key={record.id} className="border-t border-slate-100">
                      {selected.map((field) => (
                        <td key={field} className="px-3 py-2">
                          {field === "decision" ? (
                            <DecisionBadge value={record.decision} />
                          ) : field === "status" ? (
                            <StatusBadge value={record.status === "error" ? "failed" : "completed"} />
                          ) : field === "createdAt" ? (
                            format.date(record.createdAt)
                          ) : field === "inputType" ? (
                            enums(`modality.${record.inputType}`)
                          ) : field === "latencyMs" ? (
                            format.number(record.latencyMs)
                          ) : (
                            <span className={field === "content" ? "block max-w-xs truncate" : undefined} title={flat[field]}>{flat[field] || "—"}</span>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <Button size="sm" variant="outline" onClick={() => setActive(record)}>
                          {site("view")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </QueryFields>
      <Drawer open={Boolean(active)} title={active?.requestId ?? ""} onClose={() => setActive(null)} wide>
        {active ? (
          <div className="space-y-4 text-sm">
            <p>{isSeedAudit(active.id) ? t(`summaries.${active.id}`) : active.content}</p>
            <Section title={catalog("auditField.content")}>{active.content || "—"}</Section>
            <Section title={catalog("auditField.contentMd5")}>{active.contentMd5 || "—"}</Section>
            <Section title={catalog("channel")}>
              {store.state.channels.find((item) => item.id === active.channelId)?.name ?? active.channelId}
            </Section>
            <Section title={catalog("auditField.ruleIds")}>
              {active.ruleHits.map((hit) => hit.ruleId).join(", ") || t("noRules")}
            </Section>
            {active.status === "error" ? (
              <ErrorBlock title={t("errorTitle", { code: active.errorCode ?? 500 })} description={t("errorBody")} />
            ) : (
              <DecisionBadge value={active.decision} />
            )}
            <Section title={t("rules")}>
              {active.ruleHits.length === 0
                ? t("noRules")
                : active.ruleHits.map((hit) => `${hit.ruleId} v${hit.version} · ${hit.action}`).join(", ")}
            </Section>
            <Section title={catalog("auditField.capabilities")}>
              {active.modelCalls.length === 0
                ? t("noModels")
                : active.modelCalls
                    .map((call) => `${store.state.capabilities.find((item) => item.id === call.capabilityId)?.customName || enums(`capabilities.${call.capabilityId}`)} · ${call.status}`)
                    .join("\n")}
            </Section>
            <Section title={t("trace")}>
              {active.trace.map((step) => enums(`trace.${step}`)).join(" → ")}
            </Section>
            <Section title={t("reason")}>{isSeedAudit(active.id) ? t(`reasons.${active.id}`) : catalog("testReason")}</Section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <p className="mt-1 whitespace-pre-wrap text-slate-800">{children}</p>
    </div>
  );
}

export function TasksView() {
  const t = useTranslations("Tasks");
  const enums = useTranslations("Enums");
  const format = useFormatters();
  const store = usePrototypeStore();
  const { notify } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = store.state.tasks.find((task) => task.id === activeId) ?? null;

  return (
    <OperatorGate>
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("title")}</h1>
      <p className="max-w-3xl text-sm text-slate-600">{t("description")}</p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {["id", "type", "status", "total", "processed", "failed", "created", "actions"].map((column) => (
                <th key={column} className="px-3 py-2 font-medium">
                  {t(`columns.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {store.state.tasks.map((task) => (
              <tr key={task.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{task.id}</td>
                <td className="px-3 py-2">{enums(`taskType.${task.type}`)}</td>
                <td className="px-3 py-2">
                  <StatusBadge value={task.status} />
                </td>
                <td className="px-3 py-2">{format.number(task.total)}</td>
                <td className="px-3 py-2">{format.number(task.processed)}</td>
                <td className="px-3 py-2">{format.number(task.failed)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{format.date(task.createdAt)}</td>
                <td className="px-3 py-2">
                  <Button size="sm" variant="outline" onClick={() => setActiveId(task.id)}>
                    {t("details")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Drawer open={Boolean(active)} title={active?.id ?? ""} onClose={() => setActiveId(null)}>
        {active ? (
          <div className="space-y-3 text-sm">
            <StatusBadge value={active.status} />
            <p>
              {t("progress", {
                processed: format.number(active.processed),
                total: format.number(active.total),
              })}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full bg-blue-600"
                style={{
                  width: `${active.total === 0 ? 0 : Math.min(100, (active.processed / active.total) * 100)}%`,
                }}
              />
            </div>
            <div>
              <p className="font-medium">{t("failures")}</p>
              {active.failures.length === 0 ? (
                <p className="text-slate-500">{t("noFailures")}</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {active.failures.map((failure) => (
                    <li key={failure.itemId}>
                      {failure.itemId}: {t(`failureReasons.${failure.reasonCode}`)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  const result = store.retryTask(active.id);
                  notify({
                    tone: result.ok ? "success" : "error",
                    title: result.ok ? t("retried") : t("notRetryable"),
                  });
                }}
              >
                {t("retry")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const result = store.cancelTask(active.id);
                  notify({
                    tone: result.ok ? "info" : "error",
                    title: result.ok ? t("cancelled") : t("notCancellable"),
                  });
                }}
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
    </OperatorGate>
  );
}

export function SettingsView() {
  const t = useTranslations("Settings");
  const ops = useTranslations("Ops");
  const format = useFormatters();
  const store = usePrototypeStore();
  const { notify } = useToast();
  const { session } = useSession();
  const [confirming, setConfirming] = useState(false);
  const planned = t.raw("planned") as string[];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("title")}</h1>
      <p className="max-w-3xl text-sm text-slate-600">{t("description")}</p>
      <PrototypeBanner>{t("persistence")}</PrototypeBanner>
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{ops("storageTitle")}</h2>
        <p className="text-sm text-slate-600">{ops("storageBody")}</p>
        {store.state.tenants
          .filter((tenant) => session?.role !== "customer" || tenant.id === session.tenantId)
          .map((tenant) => (
            <label key={tenant.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(store.state.storageByTenant[tenant.id])}
                onChange={(event) => store.setStorage(tenant.id, event.target.checked)}
              />
              {tenant.name}
            </label>
          ))}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <p>{t("limitsTitle")}</p>
        <ul className="mt-2 space-y-1 text-slate-700">
          <li>{t("textLimit", { count: format.number(moderationLimits.textMaxChars) })}</li>
          <li>{t("imageLimit", { size: format.bytes(moderationLimits.imageMaxBytes) })}</li>
          <li>{t("rateLimit", { count: format.number(moderationLimits.playgroundRequestsPerMinute) })}</li>
        </ul>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("plannedTitle")}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {planned.map((item) => (
            <li key={item}>
              {item} · {t("plannedBadge")}
            </li>
          ))}
        </ul>
      </div>
      {confirming ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
          <p>{t("resetConfirm")}</p>
          <div className="mt-3 flex gap-2">
            <Button
              onClick={() => {
                store.reset();
                setConfirming(false);
                notify({ tone: "success", title: t("resetDone") });
              }}
            >
              {t("reset")}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setConfirming(true)}>
          {t("reset")}
        </Button>
      )}
    </div>
  );
}
