"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { OperatorGate, useSession } from "@/lib/platform/session";
import { downloadCsv, hitSeries } from "@/lib/platform/csv";
import { CaseSheetBar } from "@/components/platform/case-batch";
import { auditRecords, applications as seedApps, scenes } from "@/lib/platform/seed";
import { defaultConfig } from "@/lib/platform/rules";
import { usePrototypeStore } from "@/lib/platform/store";
import type { ContentLabel, Decision, RuleTemplate } from "@/lib/platform/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Disclosure,
  Field,
  PrototypeBanner,
  SimpleSelect,
  useFormatters,
  useScopeLabel,
  useToast,
} from "@/components/platform/ui";

function tenantOf(applicationId: string, apps: Array<{ id: string; tenantId: string }>) {
  return apps.find((item) => item.id === applicationId)?.tenantId ?? seedApps.find((item) => item.id === applicationId)?.tenantId ?? "ten_demo";
}

function blankTemplate(): RuleTemplate {
  return {
    id: "",
    name: "",
    description: "",
    sceneId: scenes[0].id,
    labelIds: [],
    ruleIds: [],
    type: "keyword",
    action: "block",
    config: defaultConfig("keyword"),
  };
}

export function TemplatesView() {
  const t = useTranslations("Ops");
  const catalog = useTranslations("Catalog");
  const store = usePrototypeStore();
  const scope = useScopeLabel();
  const { notify } = useToast();
  const [query, setQuery] = useState("");
  const [sceneFilter, setSceneFilter] = useState("all");
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [draft, setDraft] = useState<RuleTemplate>(blankTemplate());
  const [channelId, setChannelId] = useState(store.state.channels[0]?.id ?? "unset");

  const rows = store.state.templates.filter((item) => {
    if (sceneFilter !== "all" && item.sceneId !== sceneFilter) return false;
    if (labelFilter.length > 0 && !item.labelIds.some((id) => labelFilter.includes(id))) return false;
    if (!query.trim()) return true;
    return `${item.name} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  function ruleName(id: string) {
    const rule = store.state.rules.find((item) => item.id === id);
    return store.state.ruleVersions.find((item) => item.id === rule?.currentVersionId)?.name ?? id;
  }

  function save() {
    const result = store.saveTemplate(draft);
    if (!result.ok) {
      notify({ tone: "error", title: t("nameRequired") });
      return;
    }
    setDraft(blankTemplate());
    notify({ tone: "success", title: t("templateSaved") });
  }

  function apply() {
    if (!draft.id || channelId === "unset") {
      notify({ tone: "error", title: t("templatePick") });
      return;
    }
    const result = store.applyTemplate(draft.id, channelId);
    if (!result.ok) {
      notify({ tone: "error", title: t("templatePick") });
      return;
    }
    notify({ tone: "success", title: t("templateApplied", { count: result.data.count }) });
  }

  return (
    <OperatorGate>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("templatesTitle")}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{t("templatesBody")}</p>
        <PrototypeBanner>{t("templateNotice")}</PrototypeBanner>
        <Disclosure title={t("templateFilter")} defaultOpen>
          <div className="grid gap-3 md:grid-cols-2">
            <Input value={query} placeholder={t("templateSearch")} onChange={(event) => setQuery(event.target.value)} />
            <SimpleSelect
              value={sceneFilter}
              onChange={setSceneFilter}
              options={[{ value: "all", label: t("allScenes") }, ...scenes.map((scene) => ({ value: scene.id, label: scope(scene.id) }))]}
            />
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {store.state.labels.map((label) => (
              <label key={label.id} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1">
                <input
                  type="checkbox"
                  checked={labelFilter.includes(label.id)}
                  onChange={() =>
                    setLabelFilter((current) => (current.includes(label.id) ? current.filter((id) => id !== label.id) : [...current, label.id]))
                  }
                />
                {label.name}
              </label>
            ))}
          </div>
        </Disclosure>
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("templateCompose")}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("name")}><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
            <Field label={t("templateScene")}>
              <SimpleSelect
                value={draft.sceneId}
                onChange={(value) => setDraft({ ...draft, sceneId: value })}
                options={scenes.map((scene) => ({ value: scene.id, label: scope(scene.id) }))}
              />
            </Field>
          </div>
          <Field label={t("description")}>
            <Textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </Field>
          <Disclosure title={catalog("bindLabels")} hint={catalog("selectedFields", { count: draft.labelIds.length })}>
            <div className="flex flex-wrap gap-2 text-sm">
              {store.state.labels.map((label) => (
                <label key={label.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.labelIds.includes(label.id)}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        labelIds: draft.labelIds.includes(label.id)
                          ? draft.labelIds.filter((id) => id !== label.id)
                          : [...draft.labelIds, label.id],
                      })
                    }
                  />
                  {label.name}
                </label>
              ))}
            </div>
          </Disclosure>
          <Disclosure title={t("templateRules")} hint={catalog("selectedFields", { count: draft.ruleIds.length })}>
            <div className="flex flex-wrap gap-2 text-sm">
              {store.state.rules.map((rule) => (
                <label key={rule.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.ruleIds.includes(rule.id)}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        ruleIds: draft.ruleIds.includes(rule.id)
                          ? draft.ruleIds.filter((id) => id !== rule.id)
                          : [...draft.ruleIds, rule.id],
                      })
                    }
                  />
                  {ruleName(rule.id)}
                </label>
              ))}
            </div>
          </Disclosure>
          <Button onClick={save}>{t("saveTemplate")}</Button>
        </div>
        <Disclosure title={t("applyScope")} defaultOpen>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Field label={t("pickChannel")}>
              <SimpleSelect
                value={channelId}
                onChange={setChannelId}
                options={[
                  { value: "unset", label: t("pickChannel") },
                  ...store.state.channels.map((channel) => ({
                    value: channel.id,
                    label: `${channel.name} · ${scope(channel.sceneId)}`,
                  })),
                ]}
              />
            </Field>
            <div className="flex items-end">
              <Button onClick={apply}>{t("templateApply")}</Button>
            </div>
          </div>
          <p className="text-xs text-slate-500">{t("templateApplyHint")}</p>
        </Disclosure>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">{t("name")}</th>
                <th className="px-3 py-2 font-medium">{t("templateScene")}</th>
                <th className="px-3 py-2 font-medium">{catalog("bindLabels")}</th>
                <th className="px-3 py-2 font-medium">{t("templateRules")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-slate-500">{item.description}</p>
                  </td>
                  <td className="px-3 py-2">{scope(item.sceneId)}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {item.labelIds.map((id) => store.state.labels.find((label) => label.id === id)?.name).filter(Boolean).join(" · ")}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{item.ruleIds.map(ruleName).join(" · ")}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setDraft(item)}>{catalog("edit")}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </OperatorGate>
  );
}

export function LabelsView() {
  const t = useTranslations("Ops");
  const store = usePrototypeStore();
  const { notify } = useToast();
  const [draft, setDraft] = useState<ContentLabel>({
    id: "",
    name: "",
    parentId: null,
    definition: "",
    annotation: "",
    positiveCases: [""],
    negativeCases: [""],
    sceneIds: [],
  });

  function save() {
    const result = store.saveLabel({
      ...draft,
      positiveCases: draft.positiveCases.map((item) => item.trim()).filter(Boolean),
      negativeCases: draft.negativeCases.map((item) => item.trim()).filter(Boolean),
    });
    if (!result.ok) {
      notify({ tone: "error", title: t("nameRequired") });
      return;
    }
    setDraft({ id: "", name: "", parentId: null, definition: "", annotation: "", positiveCases: [""], negativeCases: [""], sceneIds: [] });
    notify({ tone: "success", title: t("labelSaved") });
  }

  function exportRules() {
    const rows = [
      [t("ruleId"), t("name"), t("type"), t("status"), t("label")],
      ...store.state.rules.map((rule) => {
        const version = store.state.ruleVersions.find((item) => item.id === rule.currentVersionId);
        const label =
          version?.config.type === "model_threshold" ? version.config.riskLabel : "";
        return [rule.id, version?.name ?? "", version?.type ?? "", rule.status, label];
      }),
    ];
    downloadCsv("rules.csv", rows);
    notify({ tone: "success", title: t("exported") });
  }

  return (
    <OperatorGate>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("labelsTitle")}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">{t("labelsBody")}</p>
          </div>
          <Button variant="outline" onClick={exportRules}>
            {t("exportRules")}
          </Button>
        </div>
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <Field label={t("name")}>
            <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label={t("definition")}>
            <Textarea
              value={draft.definition}
              onChange={(event) => setDraft({ ...draft, definition: event.target.value })}
            />
          </Field>
          <Field label={t("positive")}>
            <Textarea
              value={draft.positiveCases.join("\n")}
              onChange={(event) => setDraft({ ...draft, positiveCases: event.target.value.split("\n") })}
            />
          </Field>
          <Field label={t("negative")}>
            <Textarea
              value={draft.negativeCases.join("\n")}
              onChange={(event) => setDraft({ ...draft, negativeCases: event.target.value.split("\n") })}
            />
          </Field>
          <Button onClick={save}>{t("saveLabel")}</Button>
        </div>
        <div className="space-y-3">
          {store.state.labels.map((label) => (
            <article key={label.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{label.name}</h2>
              <p className="mt-1 text-slate-600">{label.definition}</p>
              <p className="mt-3 text-xs font-medium text-slate-500">{t("positive")}</p>
              <ul className="mt-1 list-disc pl-5 text-slate-700">
                {label.positiveCases.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs font-medium text-slate-500">{t("negative")}</p>
              <ul className="mt-1 list-disc pl-5 text-slate-700">
                {label.negativeCases.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </OperatorGate>
  );
}

export function TuningView() {
  const t = useTranslations("Ops");
  const store = usePrototypeStore();
  const { notify } = useToast();
  const profile = store.state.llm;
  const [endpoint, setEndpoint] = useState(profile.endpoint);
  const [prompt, setPrompt] = useState(profile.prompt);
  const [rag, setRag] = useState(profile.ragNotes.join("\n"));
  const [sample, setSample] = useState("Thanks for the update.");
  const [debug, setDebug] = useState("");
  const [sheet, setSheet] = useState<Array<{ input: string; expected: string; decision: string }>>([]);

  function save() {
    store.saveLlm({
      endpoint: endpoint.trim(),
      prompt: prompt.trim(),
      ragNotes: rag.split("\n").map((item) => item.trim()).filter(Boolean),
      updatedAt: profile.updatedAt,
    });
    notify({ tone: "success", title: t("tuningSaved") });
  }

  function runDebug() {
    const text = sample.toLowerCase();
    const decision = text.includes("demo_block_token")
      ? "block"
      : text.includes("demo_review_token")
        ? "review"
        : "allow";
    setDebug(
      JSON.stringify(
        {
          decision,
          is_mock: true,
          prompt_applied: true,
          rag_notes: rag.split("\n").filter((item) => item.trim()).length,
          endpoint_saved: Boolean(endpoint.trim()),
          sent_externally: false,
        },
        null,
        2
      )
    );
  }

  return (
    <OperatorGate>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("tuningTitle")}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{t("tuningBody")}</p>
        <PrototypeBanner>{t("tuningNotice")}</PrototypeBanner>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <Field label={t("endpoint")} hint={t("endpointHint")}>
              <Input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://example.com/v1" />
            </Field>
            <Field label={t("prompt")}>
              <Textarea className="min-h-32" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </Field>
            <Field label={t("rag")} hint={t("ragHint")}>
              <Textarea className="min-h-24" value={rag} onChange={(event) => setRag(event.target.value)} />
            </Field>
            <Button onClick={save}>{t("saveTuning")}</Button>
          </div>
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <Field label={t("debugInput")}>
              <Textarea value={sample} onChange={(event) => setSample(event.target.value)} />
            </Field>
            <Button variant="outline" onClick={runDebug}>
              {t("runDebug")}
            </Button>
            <CaseSheetBar
              onLoad={(rows) => {
                setSheet(
                  rows.map((row) => {
                    const text = row.input.toLowerCase();
                    const decision = text.includes("demo_block_token")
                      ? "block"
                      : text.includes("demo_review_token")
                        ? "review"
                        : "allow";
                    return { input: row.input, expected: row.expected, decision };
                  })
                );
              }}
            />
            {sheet.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="px-2 py-1">{t("debugInput")}</th>
                      <th className="px-2 py-1">{t("expected")}</th>
                      <th className="px-2 py-1">{t("decision")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.map((row) => (
                      <tr key={row.input} className="border-t border-slate-100">
                        <td className="px-2 py-1">{row.input}</td>
                        <td className="px-2 py-1">{row.expected}</td>
                        <td className="px-2 py-1">{row.decision}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {debug ? (
              <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{debug}</pre>
            ) : (
              <p className="text-sm text-slate-500">{t("debugEmpty")}</p>
            )}
          </div>
        </div>
      </div>
    </OperatorGate>
  );
}

export function InsightsView() {
  const t = useTranslations("Ops");
  const format = useFormatters();
  const store = usePrototypeStore();
  const { session } = useSession();
  const locked = session?.role === "customer" ? session.tenantId : null;
  const [tenantId, setTenantId] = useState(locked ?? "ten_demo");
  const activeTenant = locked ?? tenantId;
  const points = hitSeries.filter((item) => item.tenantId === activeTenant);
  const max = Math.max(...points.map((item) => item.count), 1);
  const history = useMemo(
    () =>
      auditRecords.filter(
        (record) => tenantOf(record.applicationId, store.state.applications) === activeTenant
      ),
    [activeTenant, store.state.applications]
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("insightsTitle")}</h1>
      <p className="max-w-3xl text-sm text-slate-600">{t("insightsBody")}</p>
      <PrototypeBanner>{locked ? t("tenantLocked") : t("insightsNotice")}</PrototypeBanner>
      {locked ? null : (
        <Field label={t("tenant")}>
          <SimpleSelect
            value={activeTenant}
            onChange={setTenantId}
            options={store.state.tenants.map((item) => ({ value: item.id, label: item.name }))}
          />
        </Field>
      )}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold tracking-tight text-zinc-900">{t("trendTitle")}</h2>
        <div className="mt-4 space-y-3">
          {points.map((item) => (
            <div key={`${item.label}-${item.month}`} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm">
              <span className="text-slate-600">
                {item.label} · {item.month}
              </span>
              <span className="h-2 rounded-full bg-slate-100">
                <span
                  className="block h-2 rounded-full bg-blue-600"
                  style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }}
                />
              </span>
              <span className="text-right">{format.number(item.count)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {["request", "app", "decision", "labels", "when"].map((column) => (
                <th key={column} className="px-3 py-2 font-medium">
                  {t(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((record) => (
              <tr key={record.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{record.requestId}</td>
                <td className="px-3 py-2">{record.applicationId}</td>
                <td className="px-3 py-2">{record.decision ?? t("noDecision")}</td>
                <td className="px-3 py-2">{record.riskLabels.join(", ") || "—"}</td>
                <td className="px-3 py-2">{format.date(record.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OrgView() {
  const t = useTranslations("Ops");
  const scope = useScopeLabel();
  const store = usePrototypeStore();
  const { notify } = useToast();
  const [tenantId, setTenantId] = useState(store.state.tenants[0]?.id ?? "ten_demo");
  const [appName, setAppName] = useState("");
  const [applicationId, setApplicationId] = useState(store.state.applications[0]?.id ?? "");
  const [channelName, setChannelName] = useState("");
  const [kind, setKind] = useState<"text" | "image" | "video" | "audio" | "mixed">("text");
  const tenantApps = store.state.applications.filter((item) => item.tenantId === tenantId);
  const channelApp = tenantApps.some((item) => item.id === applicationId) ? applicationId : (tenantApps[0]?.id ?? "");

  return (
    <OperatorGate>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("orgTitle")}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{t("orgBody")}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <Field label={t("tenant")}>
              <SimpleSelect
                value={tenantId}
                onChange={setTenantId}
                options={store.state.tenants.map((item) => ({ value: item.id, label: item.name }))}
              />
            </Field>
            <Field label={t("appName")}>
              <Input value={appName} onChange={(event) => setAppName(event.target.value)} />
            </Field>
            <Button
              onClick={() => {
                const result = store.addApplication(tenantId, appName);
                if (!result.ok) {
                  notify({ tone: "error", title: t("nameRequired") });
                  return;
                }
                setAppName("");
                notify({ tone: "success", title: t("appSaved") });
              }}
            >
              {t("addApp")}
            </Button>
          </div>
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <Field label={t("application")}>
              <SimpleSelect
                value={channelApp}
                onChange={setApplicationId}
                options={tenantApps.map((item) => ({ value: item.id, label: item.name }))}
              />
            </Field>
            <Field label={t("channelName")}>
              <Input value={channelName} onChange={(event) => setChannelName(event.target.value)} />
            </Field>
            <Field label={t("channelKind")}>
              <SimpleSelect
                value={kind}
                onChange={(value) => setKind(value as typeof kind)}
                options={["text", "image", "video", "audio", "mixed"].map((item) => ({ value: item, label: t(`kind.${item}`) }))}
              />
            </Field>
            <Button
              onClick={() => {
                const result = store.addChannel(channelApp, channelName, kind);
                if (!result.ok) {
                  notify({ tone: "error", title: t("nameRequired") });
                  return;
                }
                setChannelName("");
                notify({ tone: "success", title: t("channelSaved") });
              }}
            >
              {t("addChannel")}
            </Button>
          </div>
        </div>
        <div className="space-y-4">
          {store.state.tenants.map((tenant) => (
            <section key={tenant.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-semibold tracking-tight text-zinc-950">{tenant.name}</h2>
              <div className="mt-3 space-y-3">
                {store.state.applications
                  .filter((app) => app.tenantId === tenant.id)
                  .map((app) => (
                    <div key={app.id} className="rounded-lg border border-slate-100 p-3">
                      <h3 className="text-base font-medium text-zinc-800">{app.name}</h3>
                      <div className="mt-2 space-y-3">
                        {store.state.channels
                          .filter((channel) => channel.applicationId === app.id)
                          .map((channel) => {
                            const sceneLabels = store.state.labels.filter((label) =>
                              label.sceneIds.includes(channel.sceneId)
                            );
                            return (
                              <div key={channel.id} className="grid gap-2 border-t border-slate-100 pt-3 md:grid-cols-[12rem_14rem_1fr]">
                                <p className="text-sm text-zinc-700">
                                  {channel.name}
                                  <span className="mt-1 block text-xs text-slate-500">{t(`kind.${channel.kind}`)}</span>
                                </p>
                                <Field label={t("sceneStrategy")}>
                                  <SimpleSelect
                                    value={channel.sceneId}
                                    onChange={(sceneId) =>
                                      store.setChannelStrategy(
                                        channel.id,
                                        sceneId,
                                        channel.strategyLabelIds.filter((id) =>
                                          store.state.labels.find((label) => label.id === id)?.sceneIds.includes(sceneId)
                                        )
                                      )
                                    }
                                    options={scenes.map((scene) => ({ value: scene.id, label: scope(scene.id) }))}
                                  />
                                </Field>
                                <div>
                                  <p className="mb-1 text-xs text-slate-500">{t("strategyLabels")}</p>
                                  <div className="flex flex-wrap gap-3 text-sm">
                                    {sceneLabels.map((label) => (
                                      <label key={label.id} className="flex items-center gap-1.5">
                                        <input
                                          type="checkbox"
                                          checked={channel.strategyLabelIds.includes(label.id)}
                                          onChange={() => {
                                            const next = channel.strategyLabelIds.includes(label.id)
                                              ? channel.strategyLabelIds.filter((id) => id !== label.id)
                                              : [...channel.strategyLabelIds, label.id];
                                            store.setChannelStrategy(channel.id, channel.sceneId, next);
                                          }}
                                        />
                                        {label.name}
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </OperatorGate>
  );
}

export function QuickRollback() {
  const t = useTranslations("Ops");
  const enums = useTranslations("Enums");
  const store = usePrototypeStore();
  const { notify } = useToast();
  const models = store.state.capabilities.filter((item) => item.versions.some((version) => version.status === "retired"));
  const words = store.state.rules.filter((rule) => {
    const version = store.state.ruleVersions.find((item) => item.id === rule.currentVersionId);
    return version?.type === "keyword" && Boolean(rule.publishedVersionId);
  });

  function rollbackModel(id: string) {
    const result = store.rollbackCapability(id);
    notify({
      tone: result.ok ? "success" : "error",
      title: result.ok ? t("rolledBack") : t("noPrevious"),
    });
  }

  function rollbackTarget(targetType: "rule" | "workflow", targetId: string) {
    const result = store.rollback({ targetType, targetId, note: t("oneClickNote") });
    notify({
      tone: result.ok ? "success" : "error",
      title: result.ok ? t("rolledBack") : t("noPrevious"),
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold tracking-tight text-zinc-900">{t("rollbackTitle")}</h2>
      <p className="text-sm text-slate-600">{t("rollbackBody")}</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <section>
          <h3 className="text-xs font-medium text-slate-500">{t("models")}</h3>
          <ul className="mt-2 space-y-2">
            {models.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{item.customName ?? enums(`capabilities.${item.id}`)}</span>
                <Button size="sm" variant="outline" onClick={() => rollbackModel(item.id)}>
                  {t("rollback")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="text-xs font-medium text-slate-500">{t("strategies")}</h3>
          <ul className="mt-2 space-y-2">
            {store.state.workflows
              .filter((item) => item.publishedVersionId)
              .map((item) => {
                const version = store.state.workflowVersions.find(
                  (entry) => entry.id === item.currentVersionId
                );
                return (
                  <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{version?.name ?? item.id}</span>
                    <Button size="sm" variant="outline" onClick={() => rollbackTarget("workflow", item.id)}>
                      {t("rollback")}
                    </Button>
                  </li>
                );
              })}
          </ul>
        </section>
        <section>
          <h3 className="text-xs font-medium text-slate-500">{t("keywords")}</h3>
          <ul className="mt-2 space-y-2">
            {words.map((item) => {
              const version = store.state.ruleVersions.find((entry) => entry.id === item.currentVersionId);
              return (
                <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{version?.name ?? item.id}</span>
                  <Button size="sm" variant="outline" onClick={() => rollbackTarget("rule", item.id)}>
                    {t("rollback")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function decisionOptions(): Decision[] {
  return ["allow", "block", "review"];
}
