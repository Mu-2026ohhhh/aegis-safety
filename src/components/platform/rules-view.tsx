"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DecisionBadge,
  Drawer,
  EmptyState,
  Field,
  Pagination,
  RadioGroup,
  SimpleSelect,
  StatusBadge,
  useFormatters,
  useScopeLabel,
  useToast,
} from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LibrariesView } from "@/components/platform/catalog-views";
import { downloadCsv } from "@/lib/platform/csv";
import { defaultConfig, testRegex, validateRuleDraft } from "@/lib/platform/rules";
import type { RuleDraft } from "@/lib/platform/rule-draft";
import { scenes } from "@/lib/platform/seed";
import { useSession } from "@/lib/platform/session";
import { usePrototypeStore } from "@/lib/platform/store";
import type { CompareOperator, LabelBinding, ModelThresholdConfig, RuleConfig, RuleType, RuleVersion, ThresholdCondition } from "@/lib/platform/types";
import { createId } from "@/lib/platform/hash";

const pageSize = 5;
const ruleTypes: RuleType[] = [
  "keyword",
  "ignore_term",
  "regex",
  "structured",
  "model_threshold",
];

function blankDraft(): RuleDraft {
  return {
    name: "",
    description: "",
    type: "keyword",
    tenantId: "ten_demo",
    applicationId: "app_community",
    sceneId: "scene_ugc",
    action: "block",
    priority: 20,
    notes: "",
    changeSummary: "",
    labelBindings: [],
    config: defaultConfig("keyword"),
  };
}

function draftFromVersion(version: RuleVersion): RuleDraft {
  return {
    name: version.name,
    description: version.description,
    type: version.type,
    tenantId: version.tenantId,
    applicationId: version.applicationId,
    sceneId: version.sceneId,
    action: version.action,
    priority: version.priority,
    notes: version.notes,
    changeSummary: "",
    labelBindings: version.labelBindings ?? [],
    config: version.config,
  };
}

export function RulesView({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useTranslations("Rules");
  const ops = useTranslations("Ops");
  const enums = useTranslations("Enums");
  const site = useTranslations("Site");
  const store = usePrototypeStore();
  const { session } = useSession();
  const format = useFormatters();
  const scope = useScopeLabel();
  const { notify } = useToast();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [applicationId, setApplicationId] = useState("all");
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<"closed" | "create" | "edit" | "view">("closed");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(blankDraft());
  const [errors, setErrors] = useState<string[]>([]);
  const [regexResult, setRegexResult] = useState<string>("");
  const [templateId, setTemplateId] = useState("unset");
  const [selected, setSelected] = useState<string[]>([]);

  const rows = useMemo(() => {
    return store.state.rules
      .map((rule) => {
        const version = store.state.ruleVersions.find((item) => item.id === rule.currentVersionId);
        return version ? { rule, version } : null;
      })
      .filter((row): row is { rule: (typeof store.state.rules)[number]; version: RuleVersion } =>
        Boolean(row)
      )
      .filter((row) => {
        const haystack = `${row.version.name} ${row.rule.id}`.toLowerCase();
        if (query && !haystack.includes(query.toLowerCase())) return false;
        if (type !== "all" && row.version.type !== type) return false;
        if (status !== "all" && row.rule.status !== status) return false;
        if (applicationId !== "all" && row.version.applicationId !== applicationId) return false;
        if (session?.role === "customer" && row.version.tenantId !== session.tenantId) return false;
        return true;
      });
  }, [applicationId, query, session, status, store.state.ruleVersions, store.state.rules, type]);

  const visible = rows.slice((page - 1) * pageSize, page * pageSize);
  const active = store.state.rules.find((rule) => rule.id === activeId);
  const activeVersion = store.state.ruleVersions.find(
    (version) => version.id === active?.currentVersionId
  );
  const history = store.state.ruleVersions
    .filter((version) => version.ruleId === activeId)
    .sort((a, b) => b.version - a.version);

  function openCreate() {
    setDraft(blankDraft());
    setErrors([]);
    setRegexResult("");
    setActiveId(null);
    setTemplateId("unset");
    setMode("create");
  }

  function openEdit(ruleId: string) {
    const rule = store.state.rules.find((item) => item.id === ruleId);
    const version = store.state.ruleVersions.find((item) => item.id === rule?.currentVersionId);
    if (!version || rule?.status === "archived") {
      notify({ tone: "error", title: t("archivedError") });
      return;
    }
    setActiveId(ruleId);
    setDraft(draftFromVersion(version));
    setErrors([]);
    setRegexResult("");
    setMode("edit");
  }

  function save() {
    const resultErrors = validateRuleDraft(draft);
    setErrors(resultErrors);
    if (resultErrors.length > 0) {
      notify({ tone: "error", title: t("validationTitle") });
      return;
    }
    if (mode === "create") {
      const result = store.createRule(draft);
      if (!result.ok) {
        notify({ tone: "error", title: t("saveFailed") });
        return;
      }
      notify({ tone: "success", title: t("created") });
    } else if (activeId) {
      const result = store.updateRule(activeId, draft);
      if (!result.ok) {
        notify({ tone: "error", title: t("saveFailed") });
        return;
      }
      notify({
        tone: "success",
        title: result.data.forked ? t("forked") : t("updated"),
        description: t("statusDraft"),
      });
    }
    setMode("closed");
  }

  function runRegex() {
    if (draft.config.type !== "regex") return;
    const result = testRegex(draft.config.pattern, draft.config.flags, draft.config.sampleText);
    setRegexResult(
      result.ok
        ? result.matches.length
          ? t("regexMatched", { values: result.matches.join(", ") })
          : t("regexNone")
        : t(`regexErrors.${result.error}`)
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {embedded ? (
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("title")}</h2>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("title")}</h1>
          )}
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("description")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              downloadCsv("rules.csv", [
                [t("name"), ops("ruleId"), t("type"), t("status"), t("action")],
                ...rows.map((row) => [
                  row.version.name,
                  row.rule.id,
                  enums(`ruleType.${row.version.type}`),
                  enums(`status.${row.rule.status}`),
                  enums(`action.${row.version.action}`),
                ]),
              ]);
              notify({ tone: "success", title: ops("exported") });
            }}
          >
            {ops("exportRules")}
          </Button>
          <Button onClick={openCreate}>{t("create")}</Button>
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-3 md:grid-cols-4">
        <Field label={t("search")}>
          <Input
            value={query}
            placeholder={t("searchPlaceholder")}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label={t("type")}>
          <SimpleSelect
            value={type}
            onChange={(value) => {
              setType(value);
              setPage(1);
            }}
            options={[
              { value: "all", label: site("all") },
              ...ruleTypes.map((item) => ({ value: item, label: enums(`ruleType.${item}`) })),
            ]}
          />
        </Field>
        <Field label={t("status")}>
          <SimpleSelect
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: "all", label: site("all") },
              ...[
                "draft",
                "pending_evaluation",
                "evaluation_passed",
                "pending_release",
                "published",
                "disabled",
                "archived",
              ].map((item) => ({ value: item, label: enums(`status.${item}`) })),
            ]}
          />
        </Field>
        <Field label={t("scope")}>
          <SimpleSelect
            value={applicationId}
            onChange={(value) => {
              setApplicationId(value);
              setPage(1);
            }}
            options={[
              { value: "all", label: site("all") },
              ...store.state.applications
                .filter((item) => session?.role !== "customer" || item.tenantId === session.tenantId)
                .map((item) => ({ value: item.id, label: item.name || scope(item.id) })),
            ]}
          />
        </Field>
        <div className="md:col-span-4">
          <Button
            variant="outline"
            onClick={() => {
              setQuery("");
              setType("all");
              setStatus("all");
              setApplicationId("all");
              setPage(1);
            }}
          >
            {t("resetFilters")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">{ops("selectedCount", { count: selected.length })}</span>
        <Button
          variant="outline"
          onClick={() => {
            const result = store.batchRules(selected, "enable");
            if (!result.ok) return notify({ tone: "error", title: ops("batchEmpty") });
            setSelected([]);
            notify({ tone: "success", title: ops("batchDone") });
          }}
        >
          {ops("batchEnable")}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const result = store.batchRules(selected, "disable");
            if (!result.ok) return notify({ tone: "error", title: ops("batchEmpty") });
            setSelected([]);
            notify({ tone: "success", title: ops("batchDone") });
          }}
        >
          {ops("batchDisable")}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const result = store.batchRules(selected, "close");
            if (!result.ok) return notify({ tone: "error", title: ops("batchEmpty") });
            setSelected([]);
            notify({ tone: "success", title: ops("batchDone") });
          }}
        >
          {ops("batchClose")}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const result = store.batchRules(selected, "delete");
            if (!result.ok) return notify({ tone: "error", title: ops("batchEmpty") });
            setSelected([]);
            notify({ tone: "success", title: ops("batchDone") });
          }}
        >
          {ops("batchDelete")}
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={visible.length > 0 && visible.every((row) => selected.includes(row.rule.id))}
                    onChange={(event) => {
                      const ids = visible.map((row) => row.rule.id);
                      setSelected((current) =>
                        event.target.checked
                          ? [...new Set([...current, ...ids])]
                          : current.filter((id) => !ids.includes(id))
                      );
                    }}
                  />
                </th>
                {["id", "name", "type", "scope", "action", "version", "status", "updated", "actions"].map(
                  (column) => (
                    <th key={column} className="px-3 py-2 font-medium">
                      {t(`columns.${column}`)}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ rule, version }) => (
                <tr key={rule.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(rule.id)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(rule.id) ? current.filter((id) => id !== rule.id) : [...current, rule.id]
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{rule.id}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium">{version.name}</p>
                    {rule.publishedVersionId && rule.publishedVersionId !== rule.currentVersionId ? (
                      <p className="text-xs text-slate-500">{t("liveCandidate")}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{enums(`ruleType.${version.type}`)}</td>
                  <td className="px-3 py-2">{scope(version.applicationId)}</td>
                  <td className="px-3 py-2">
                    <DecisionBadge value={version.action} />
                  </td>
                  <td className="px-3 py-2">v{version.version}</td>
                  <td className="px-3 py-2">
                    <StatusBadge value={rule.status} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{format.date(rule.updatedAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setActiveId(rule.id);
                          setMode("view");
                        }}
                      >
                        {site("view")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(rule.id)}>
                        {site("edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const result = store.copyRule(rule.id, `${version.name} ${t("copySuffix")}`);
                          if (result.ok) notify({ tone: "success", title: t("copied") });
                        }}
                      >
                        {site("copy")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageSize={pageSize} total={rows.length} onPage={setPage} />

      <Drawer
        open={mode !== "closed"}
        wide
        title={mode === "create" ? t("create") : mode === "edit" ? t("editTitle") : t("detailTitle")}
        description={mode === "view" ? active?.id : t("formHelp")}
        onClose={() => setMode("closed")}
      >
        {mode === "view" && active && activeVersion ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <StatusBadge value={active.status} />
              <DecisionBadge value={activeVersion.action} />
            </div>
            <p className="text-base font-medium">{activeVersion.name}</p>
            <p className="text-slate-600">{activeVersion.description}</p>
            <p>
              {t("scope")}: {scope(activeVersion.tenantId)} / {scope(activeVersion.applicationId)} /{" "}
              {scope(activeVersion.sceneId)}
            </p>
            <p>
              {t("priority")}: {format.number(activeVersion.priority)}
            </p>
            <p>
              {t("summary")}: {activeVersion.changeSummary}
            </p>
            <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">
              {JSON.stringify(activeVersion.config, null, 2)}
            </pre>
            <div>
              <p className="font-medium">{t("history")}</p>
              <ul className="mt-2 space-y-2">
                {history.map((version) => (
                  <li key={version.id} className="rounded-lg border border-slate-200 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        v{version.version} · {version.id}
                      </span>
                      <StatusBadge value={version.status} />
                    </div>
                    <p className="mt-1 text-slate-600">{version.changeSummary}</p>
                    <p className="text-xs text-slate-500">{format.date(version.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => openEdit(active.id)}>{site("edit")}</Button>
              {active.status === "draft" ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    const result = store.setRuleLifecycle(active.id, "submit");
                    if (result.ok) notify({ tone: "success", title: t("submitted") });
                  }}
                >
                  {t("submitEval")}
                </Button>
              ) : null}
              {active.status !== "disabled" && active.status !== "archived" ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    const result = store.setRuleLifecycle(active.id, "disable");
                    if (result.ok) notify({ tone: "success", title: t("disabled") });
                    setMode("closed");
                  }}
                >
                  {t("disable")}
                </Button>
              ) : null}
              {active.status === "disabled" ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    store.setRuleLifecycle(active.id, "restore");
                    notify({ tone: "success", title: t("restored") });
                    setMode("closed");
                  }}
                >
                  {t("restore")}
                </Button>
              ) : null}
              {active.status !== "archived" ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    store.setRuleLifecycle(active.id, "archive");
                    notify({ tone: "info", title: t("archived") });
                    setMode("closed");
                  }}
                >
                  {t("archive")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {active?.publishedVersionId === active?.currentVersionId && mode === "edit" ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("forkNotice")}</p>
            ) : null}
            {mode === "create" ? (
              <Field label={ops("template")}>
                <SimpleSelect
                  value={templateId}
                  onChange={(value) => {
                    setTemplateId(value);
                    const template = store.state.templates.find((item) => item.id === value);
                    if (!template) return;
                    setDraft({
                      ...draft,
                      name: template.name,
                      description: template.description,
                      type: template.type,
                      action: template.action,
                      config: structuredClone(template.config),
                    });
                  }}
                  options={[
                    { value: "unset", label: ops("noTemplate") },
                    ...store.state.templates.map((item) => ({ value: item.id, label: item.name })),
                  ]}
                />
              </Field>
            ) : null}
            <Field label={t("name")} error={errors.includes("name") ? t("errors.name") : undefined}>
              <Input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>
            <Field
              label={t("descriptionLabel")}
              error={errors.includes("description") ? t("errors.description") : undefined}
            >
              <Textarea
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </Field>
            <Field label={t("type")}>
              <SimpleSelect
                value={draft.type}
                onChange={(value) => {
                  const nextType = value as RuleType;
                  setDraft({ ...draft, type: nextType, config: defaultConfig(nextType) });
                }}
                options={ruleTypes.map((item) => ({
                  value: item,
                  label: enums(`ruleType.${item}`),
                }))}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("tenant")}>
                <SimpleSelect
                  value={draft.tenantId}
                  onChange={(value) => setDraft({ ...draft, tenantId: value })}
                  options={(session?.role === "customer"
                    ? store.state.tenants.filter((item) => item.id === session.tenantId)
                    : store.state.tenants
                  ).map((item) => ({ value: item.id, label: item.name || scope(item.id) }))}
                />
              </Field>
              <Field label={t("application")}>
                <SimpleSelect
                  value={draft.applicationId}
                  onChange={(value) => {
                    const scene = scenes.find((item) => item.applicationId === value);
                    setDraft({
                      ...draft,
                      applicationId: value,
                      sceneId: scene?.id ?? draft.sceneId,
                    });
                  }}
                  options={store.state.applications
                    .filter((item) => item.tenantId === draft.tenantId)
                    .map((item) => ({ value: item.id, label: item.name || scope(item.id) }))}
                />
              </Field>
              <Field label={t("scene")}>
                <SimpleSelect
                  value={draft.sceneId}
                  onChange={(value) => setDraft({ ...draft, sceneId: value })}
                  options={scenes
                    .filter((item) => item.applicationId === draft.applicationId)
                    .map((item) => ({ value: item.id, label: scope(item.id) }))}
                />
              </Field>
            </div>
            <Field label={t("action")}>
              <RadioGroup
                name="rule-action"
                value={draft.action}
                onChange={(value) =>
                  setDraft({ ...draft, action: value as RuleDraft["action"] })
                }
                options={["allow", "block", "review"].map((item) => ({
                  value: item,
                  label: enums(`decision.${item}`),
                }))}
              />
            </Field>
            <Field
              label={t("priority")}
              error={errors.includes("priority") ? t("errors.priority") : undefined}
            >
              <Input
                type="number"
                min={1}
                max={100}
                value={draft.priority}
                onChange={(event) =>
                  setDraft({ ...draft, priority: Number(event.target.value) })
                }
              />
            </Field>
            <ConfigFields
              config={draft.config}
              errors={errors}
              onChange={(config) => setDraft({ ...draft, config })}
            />
            {draft.config.type === "regex" ? (
              <div className="space-y-2">
                <Button type="button" variant="outline" onClick={runRegex}>
                  {t("testRegex")}
                </Button>
                {regexResult ? <p className="text-sm text-slate-700">{regexResult}</p> : null}
              </div>
            ) : null}
            <LabelSceneBinder
              bindings={draft.labelBindings}
              onChange={(labelBindings) => setDraft({ ...draft, labelBindings })}
            />
            <Field label={t("notes")}>
              <Textarea
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            </Field>
            <Field label={t("summary")}>
              <Input
                value={draft.changeSummary}
                onChange={(event) => setDraft({ ...draft, changeSummary: event.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <Button onClick={save}>{site("save")}</Button>
              <Button variant="outline" onClick={() => setMode("closed")}>
                {site("cancel")}
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function matchesQuery(query: string, text: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const hay = text.toLowerCase();
  if (hay.includes(needle)) return true;
  let index = 0;
  for (const char of hay) {
    if (char === needle[index]) index += 1;
    if (index >= needle.length) return true;
  }
  return false;
}

function LabelSceneBinder({
  bindings,
  onChange,
}: {
  bindings: LabelBinding[];
  onChange: (bindings: LabelBinding[]) => void;
}) {
  const ops = useTranslations("Catalog");
  const scope = useScopeLabel();
  const store = usePrototypeStore();
  const [query, setQuery] = useState("");
  const catalog = store.state.labels.flatMap((label) =>
    label.sceneIds.map((sceneId) => ({
      labelId: label.id,
      sceneId,
      text: `${label.name} ${scope(sceneId)}`,
      labelName: label.name,
      sceneName: scope(sceneId),
    }))
  );
  const selected = new Set(bindings.map((item) => `${item.labelId}:${item.sceneId}`));

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium">{ops("bindTitle")}</p>
      <p className="text-xs text-slate-500">{ops("bindHint")}</p>
      <Input value={query} placeholder={ops("labelSearch")} onChange={(event) => setQuery(event.target.value)} />
      <div className="max-h-40 space-y-1 overflow-y-auto text-sm">
        {catalog
          .filter((item) => matchesQuery(query, item.text))
          .map((item) => {
            const key = `${item.labelId}:${item.sceneId}`;
            const on = selected.has(key);
            return (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    onChange(
                      on
                        ? bindings.filter((binding) => `${binding.labelId}:${binding.sceneId}` !== key)
                        : [...bindings, { labelId: item.labelId, sceneId: item.sceneId }]
                    )
                  }
                />
                <span>{item.labelName}</span>
                <span className="text-slate-500">{item.sceneName}</span>
              </label>
            );
          })}
      </div>
    </div>
  );
}

function ConfigFields({
  config,
  errors,
  onChange,
}: {
  config: RuleConfig;
  errors: string[];
  onChange: (config: RuleConfig) => void;
}) {
  const t = useTranslations("Rules");
  const enums = useTranslations("Enums");
  if (config.type === "keyword" || config.type === "ignore_term") {
    return (
      <div className="space-y-3">
        <Field label={t("terms")} error={errors.includes("terms") ? t("errors.terms") : undefined}>
          <Textarea
            value={config.terms.join("\n")}
            onChange={(event) =>
              onChange({
                ...config,
                terms: event.target.value.split("\n"),
              })
            }
          />
        </Field>
        <Field label={t("matchMode")}>
          <SimpleSelect
            value={config.matchMode}
            onChange={(value) => {
              if (config.type === "keyword") {
                onChange({ ...config, matchMode: value as "contains" | "exact" | "word" });
                return;
              }
              onChange({ ...config, matchMode: value as "contains" | "exact" });
            }}
            options={(config.type === "keyword" ? ["contains", "exact", "word"] : ["contains", "exact"]).map(
              (item) => ({ value: item, label: enums(`matchMode.${item}`) })
            )}
          />
        </Field>
        {config.type === "keyword" ? (
          <>
            <Field label={t("exclusions")}>
              <Textarea
                value={config.exclusions.join("\n")}
                onChange={(event) =>
                  onChange({
                    ...config,
                    exclusions: event.target.value
                      .split("\n")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
            <Field label={t("textScope")}>
              <SimpleSelect
                value={config.textScope}
                onChange={(value) =>
                  onChange({
                    ...config,
                    textScope: value as "all" | "user_text" | "model_output",
                  })
                }
                options={["all", "user_text", "model_output"].map((item) => ({
                  value: item,
                  label: enums(`textScope.${item}`),
                }))}
              />
            </Field>
          </>
        ) : null}
      </div>
    );
  }
  if (config.type === "regex") {
    return (
      <div className="space-y-3">
        <Field label={t("pattern")} error={errors.includes("regex") ? t("errors.regex") : undefined}>
          <Input
            value={config.pattern}
            onChange={(event) => onChange({ ...config, pattern: event.target.value })}
          />
        </Field>
        <Field label={t("flags")}>
          <Input
            value={config.flags}
            onChange={(event) => onChange({ ...config, flags: event.target.value })}
          />
        </Field>
        <Field label={t("sampleText")}>
          <Textarea
            value={config.sampleText}
            onChange={(event) => onChange({ ...config, sampleText: event.target.value })}
          />
        </Field>
      </div>
    );
  }
  if (config.type === "structured") {
    return (
      <div className="grid gap-3">
        <Field label={t("field")} error={errors.includes("structured") ? t("errors.structured") : undefined}>
          <Input
            value={config.field}
            onChange={(event) => onChange({ ...config, field: event.target.value })}
          />
        </Field>
        <Field label={t("operator")}>
          <SimpleSelect
            value={config.operator}
            onChange={(value) =>
              onChange({
                ...config,
                operator: value as "eq" | "neq" | "contains" | "gt" | "lt",
              })
            }
            options={["eq", "neq", "contains", "gt", "lt"].map((item) => ({
              value: item,
              label: enums(`operator.${item}`),
            }))}
          />
        </Field>
        <Field label={t("value")}>
          <Input
            value={config.value}
            onChange={(event) => onChange({ ...config, value: event.target.value })}
          />
        </Field>
      </div>
    );
  }
  return <ModelThresholdFields config={config} errors={errors} onChange={onChange} />;
}

function ModelThresholdFields({
  config,
  errors,
  onChange,
}: {
  config: ModelThresholdConfig;
  errors: string[];
  onChange: (config: RuleConfig) => void;
}) {
  const t = useTranslations("Rules");
  const ops = useTranslations("Ops");
  const enums = useTranslations("Enums");
  const store = usePrototypeStore();
  const operators: CompareOperator[] = ["gt", "lt", "eq"];

  function addCondition(kind: "constant" | "variable") {
    const next: ThresholdCondition = {
      id: createId("cond"),
      kind,
      left: kind === "constant" ? ops("constant") : "risk_score",
      operator: "gt",
      right: kind === "constant" ? "800" : "risk_score",
    };
    onChange({ ...config, conditions: [...config.conditions, next] });
  }

  return (
    <div className="space-y-3">
      <Field label={t("capability")} error={errors.includes("model") ? t("errors.model") : undefined}>
        <SimpleSelect
          value={config.capabilityId}
          onChange={(value) => onChange({ ...config, capabilityId: value })}
          options={store.state.capabilities.map((item) => ({
            value: item.id,
            label: item.customName || enums(`capabilities.${item.id}`),
          }))}
        />
      </Field>
      <Field label={t("feature")}>
        <Input value={config.feature} onChange={(event) => onChange({ ...config, feature: event.target.value })} />
      </Field>
      <div className="grid gap-3 md:grid-cols-[8rem_1fr]">
        <Field label={ops("compareLabel")} error={errors.includes("threshold") ? t("errors.threshold") : undefined}>
          <SimpleSelect
            value={config.operator}
            onChange={(value) => onChange({ ...config, operator: value as CompareOperator })}
            options={operators.map((item) => ({ value: item, label: ops(`compare.${item}`) }))}
          />
        </Field>
        <Field label={ops("score")}>
          <Input
            type="number"
            min={0}
            max={1000}
            value={config.threshold}
            onChange={(event) => onChange({ ...config, threshold: Number(event.target.value), score: Number(event.target.value) })}
          />
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={ops("riskLabel")}>
          <SimpleSelect
            value={config.riskLabel || "unset"}
            onChange={(value) => onChange({ ...config, riskLabel: value === "unset" ? "" : value })}
            options={[
              { value: "unset", label: ops("pickLabel") },
              ...store.state.labels.map((item) => ({ value: item.name, label: item.name })),
              ...(config.riskLabel && !store.state.labels.some((item) => item.name === config.riskLabel)
                ? [{ value: config.riskLabel, label: config.riskLabel }]
                : []),
            ]}
          />
        </Field>
        <Field label={ops("riskType")}>
          <Input value={config.riskType} onChange={(event) => onChange({ ...config, riskType: event.target.value })} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={config.dispose}
          onChange={(event) => onChange({ ...config, dispose: event.target.checked })}
        />
        {ops("dispose")}
      </label>
      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{ops("conditions")}</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => addCondition("constant")}>
              {ops("addConstant")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => addCondition("variable")}>
              {ops("addVariable")}
            </Button>
          </div>
        </div>
        {config.conditions.map((condition) => (
          <div key={condition.id} className="grid gap-2 md:grid-cols-[1fr_6rem_1fr_auto]">
            <Input
              value={condition.left}
              onChange={(event) =>
                onChange({
                  ...config,
                  conditions: config.conditions.map((item) =>
                    item.id === condition.id ? { ...item, left: event.target.value } : item
                  ),
                })
              }
            />
            <SimpleSelect
              value={condition.operator}
              onChange={(value) =>
                onChange({
                  ...config,
                  conditions: config.conditions.map((item) =>
                    item.id === condition.id ? { ...item, operator: value as CompareOperator } : item
                  ),
                })
              }
              options={operators.map((item) => ({ value: item, label: ops(`compare.${item}`) }))}
            />
            {condition.kind === "variable" ? (
              <SimpleSelect
                value={condition.right || "unset"}
                onChange={(value) =>
                  onChange({
                    ...config,
                    conditions: config.conditions.map((item) =>
                      item.id === condition.id ? { ...item, right: value === "unset" ? "" : value } : item
                    ),
                  })
                }
                options={[
                  { value: "unset", label: ops("pickVariable") },
                  ...store.state.variables.map((item) => ({ value: item.key, label: `${item.name} (${item.key})` })),
                ]}
              />
            ) : (
              <Input
                value={condition.right}
                onChange={(event) =>
                  onChange({
                    ...config,
                    conditions: config.conditions.map((item) =>
                      item.id === condition.id ? { ...item, right: event.target.value } : item
                    ),
                  })
                }
              />
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onChange({ ...config, conditions: config.conditions.filter((item) => item.id !== condition.id) })
              }
            >
              {ops("remove")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RulesModule({ initial = "rules" }: { initial?: "rules" | "library" }) {
  const t = useTranslations("Catalog");
  const { session } = useSession();
  const operator = session?.role !== "customer";
  const [tab, setTab] = useState<"rules" | "library">(initial);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("rulesModule")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("rulesModuleBody")}</p>
      </div>
      <div className="flex gap-2">
        <Button variant={tab === "rules" ? "default" : "outline"} onClick={() => setTab("rules")}>
          {t("rulesSection")}
        </Button>
        {operator ? (
          <Button variant={tab === "library" ? "default" : "outline"} onClick={() => setTab("library")}>
            {t("librariesTitle")}
          </Button>
        ) : null}
      </div>
      {tab === "library" ? <LibrariesView embedded /> : <RulesView embedded />}
    </div>
  );
}
