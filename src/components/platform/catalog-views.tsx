"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { depthTitle, Field, PrototypeBanner, SimpleSelect, useScopeLabel, useToast } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CaseSheetBar, RecordBrowser, TemplateButton } from "@/components/platform/case-batch";
import { TestReport } from "@/components/platform/test-report";
import { downloadCsv } from "@/lib/platform/csv";
import { createId } from "@/lib/platform/hash";
import { interceptText } from "@/lib/platform/intercept";
import { runSelect, type QueryTable } from "@/lib/platform/log-query";
import { scenes } from "@/lib/platform/seed";
import { OperatorGate, useSession } from "@/lib/platform/session";
import { usePrototypeStore } from "@/lib/platform/store";
import type {
  ContentLabel,
  Decision,
  LibraryEntry,
  LlmCase,
  MediaModality,
  RuleType,
  RuleVersion,
} from "@/lib/platform/types";

const ruleTypes: RuleType[] = ["keyword", "ignore_term", "regex", "structured", "model_threshold"];

function fuzzy(query: string, text: string) {
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

const modalities: MediaModality[] = ["text", "image", "video", "audio"];

function blankLabel(): ContentLabel {
  return {
    id: "",
    name: "",
    parentId: null,
    definition: "",
    annotation: "",
    positiveCases: [],
    negativeCases: [],
    sceneIds: [],
  };
}

function chainDepth(labels: ContentLabel[], id: string | null): number {
  if (!id) return 0;
  let depth = 1;
  let parent = labels.find((item) => item.id === id)?.parentId ?? null;
  const seen = new Set<string>([id]);
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    depth += 1;
    parent = labels.find((item) => item.id === parent)?.parentId ?? null;
  }
  return depth;
}

function parseTable(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells: string[] = [];
      let current = "";
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"') {
          if (quoted && line[i + 1] === '"') {
            current += '"';
            i += 1;
          } else quoted = !quoted;
        } else if (char === "," && !quoted) {
          cells.push(current.trim());
          current = "";
        } else current += char;
      }
      cells.push(current.trim());
      return cells;
    });
}

export function LabelsView() {
  const t = useTranslations("Catalog");
  const ops = useTranslations("Ops");
  const scope = useScopeLabel();
  const store = usePrototypeStore();
  const { notify } = useToast();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<ContentLabel>(blankLabel());
  const [comboScene, setComboScene] = useState<string>(scenes[0].id);
  const labels = store.state.labels;

  const visible = useMemo(() => {
    const ids = new Set<string>();
    for (const label of labels) {
      if (!fuzzy(query, `${label.name} ${label.definition}`)) continue;
      ids.add(label.id);
      let parent = label.parentId;
      while (parent) {
        ids.add(parent);
        parent = labels.find((item) => item.id === parent)?.parentId ?? null;
      }
    }
    return ids;
  }, [labels, query]);

  function save() {
    const result = store.saveLabel({
      ...draft,
      positiveCases: draft.positiveCases.map((item) => item.trim()).filter(Boolean),
      negativeCases: draft.negativeCases.map((item) => item.trim()).filter(Boolean),
    });
    if (!result.ok) {
      notify({ tone: "error", title: result.error === "depth" ? t("depthLimit") : ops("nameRequired") });
      return;
    }
    setDraft(blankLabel());
    notify({ tone: "success", title: t("saved") });
  }

  function toggleScene(label: ContentLabel, sceneId: string) {
    const sceneIds = label.sceneIds.includes(sceneId)
      ? label.sceneIds.filter((item) => item !== sceneId)
      : [...label.sceneIds, sceneId];
    store.saveLabel({ ...label, sceneIds });
  }

  function remove(id: string) {
    const result = store.deleteLabel(id);
    if (!result.ok) {
      notify({ tone: "error", title: t("hasChildren") });
      return;
    }
    notify({ tone: "success", title: t("deleted") });
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function importFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const table = parseTable(String(reader.result ?? ""));
      const start = table[0]?.[0]?.toLowerCase() === "level1" ? 1 : 0;
      const pool = [...labels];
      const created: ContentLabel[] = [];
      for (const row of table.slice(start)) {
        let parentId: string | null = null;
        const names = [row[0], row[1], row[2], row[3]].map((cell) => (cell ?? "").trim());
        const last = names.reduce((index, name, current) => (name ? current : index), -1);
        if (last < 0) continue;
        for (let level = 0; level <= last; level += 1) {
          const name = names[level];
          if (!name) break;
          const leaf = level === last;
          const found = [...pool, ...created].find(
            (item) => item.name === name && (item.parentId ?? null) === parentId
          );
          if (found) {
            if (leaf) {
              created.push({
                ...found,
                definition: row[4] ?? found.definition,
                annotation: row[5] ?? found.annotation,
                positiveCases: (row[6] ?? "").split("|").map((item) => item.trim()).filter(Boolean),
                negativeCases: (row[7] ?? "").split("|").map((item) => item.trim()).filter(Boolean),
              });
            }
            parentId = found.id;
            continue;
          }
          if (chainDepth([...pool, ...created], parentId) >= 4) break;
          const id = createId("label");
          created.push({
            id,
            name,
            parentId,
            definition: leaf ? (row[4] ?? "") : name,
            annotation: leaf ? (row[5] ?? "") : "",
            positiveCases: leaf ? (row[6] ?? "").split("|").map((item) => item.trim()).filter(Boolean) : [],
            negativeCases: leaf ? (row[7] ?? "").split("|").map((item) => item.trim()).filter(Boolean) : [],
            sceneIds: [],
          });
          parentId = id;
        }
      }
      if (!created.length) return;
      store.importLabels(created);
      notify({ tone: "success", title: t("imported") });
    };
    reader.readAsText(file);
  }

  function renderBranch(parentId: string | null, depth: number) {
    return labels
      .filter((label) => (label.parentId ?? null) === parentId && visible.has(label.id))
      .map((label) => {
        const hasChildren = labels.some((item) => item.parentId === label.id && visible.has(item.id));
        const open = query.trim().length > 0 || expanded.has(label.id);
        return (
          <div key={label.id} style={{ marginLeft: depth * 16 }}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2">
              <div className="flex items-center gap-2">
                {hasChildren ? (
                  <button type="button" className="w-5 text-slate-500" onClick={() => toggleExpanded(label.id)}>
                    {open ? "−" : "+"}
                  </button>
                ) : (
                  <span className="w-5" />
                )}
                <button type="button" className="text-left" onClick={() => setDraft(label)}>
                  <span className={depthTitle(depth)}>{label.name}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {label.sceneIds.map((item) => scope(item)).join(" · ") || t("noScene")}
                  </span>
                </button>
              </div>
              <div className="flex gap-2">
                {depth < 3 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDraft({ ...blankLabel(), parentId: label.id, sceneIds: [...label.sceneIds] })}
                  >
                    {t("addChild")}
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => remove(label.id)}>
                  {ops("remove")}
                </Button>
              </div>
            </div>
            {open ? renderBranch(label.id, depth + 1) : null}
          </div>
        );
      });
  }

  return (
    <OperatorGate>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{ops("labelsTitle")}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{t("labelsBody")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-sm" value={query} placeholder={t("labelSearch")} onChange={(event) => setQuery(event.target.value)} />
          <TemplateButton
            filename="label-template.csv"
            headers={["level1", "level2", "level3", "level4", "definition", "annotation", "positive", "negative"]}
          />
          <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-3 text-sm">
            {t("importLabels")}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importFile(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="text-sm text-slate-500">{t("levelHint")}</p>
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-4">{renderBranch(null, 0)}</div>
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <Field label={ops("name")}>
              <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label={t("parent")}>
              <SimpleSelect
                value={draft.parentId ?? "unset"}
                onChange={(value) => setDraft({ ...draft, parentId: value === "unset" ? null : value })}
                options={[
                  { value: "unset", label: t("root") },
                  ...labels
                    .filter((item) => item.id !== draft.id && chainDepth(labels, item.id) < 4)
                    .map((item) => ({ value: item.id, label: item.name })),
                ]}
              />
            </Field>
            <Field label={ops("definition")}>
              <Textarea value={draft.definition} onChange={(event) => setDraft({ ...draft, definition: event.target.value })} />
            </Field>
            <Field label={t("annotation")}>
              <Textarea value={draft.annotation} onChange={(event) => setDraft({ ...draft, annotation: event.target.value })} />
            </Field>
            <Field label={t("scenes")}>
              <div className="flex flex-wrap gap-3 text-sm">
                {scenes.map((scene) => (
                  <label key={scene.id} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={draft.sceneIds.includes(scene.id)}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          sceneIds: draft.sceneIds.includes(scene.id)
                            ? draft.sceneIds.filter((item) => item !== scene.id)
                            : [...draft.sceneIds, scene.id],
                        })
                      }
                    />
                    {scope(scene.id)}
                  </label>
                ))}
              </div>
            </Field>
            <Field label={ops("positive")}>
              <Textarea
                value={draft.positiveCases.join("\n")}
                onChange={(event) => setDraft({ ...draft, positiveCases: event.target.value.split("\n") })}
              />
            </Field>
            <Field label={ops("negative")}>
              <Textarea
                value={draft.negativeCases.join("\n")}
                onChange={(event) => setDraft({ ...draft, negativeCases: event.target.value.split("\n") })}
              />
            </Field>
            <Button onClick={save}>{ops("saveLabel")}</Button>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("sceneCombo")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("sceneComboHint")}</p>
          <div className="mt-3 max-w-sm">
            <SimpleSelect
              value={comboScene}
              onChange={setComboScene}
              options={scenes.map((scene) => ({ value: scene.id, label: scope(scene.id) }))}
            />
          </div>
          <div className="mt-3 space-y-2 text-sm">
            {labels.map((label) => (
              <label key={label.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={label.sceneIds.includes(comboScene)}
                  onChange={() => toggleScene(label, comboScene)}
                />
                {label.name}
              </label>
            ))}
          </div>
        </div>
      </div>
    </OperatorGate>
  );
}

export function VariablesView() {
  const t = useTranslations("Catalog");
  const ops = useTranslations("Ops");
  const store = usePrototypeStore();
  const { notify } = useToast();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState({ id: "", key: "", name: "", valueType: "string" as "string" | "number", value: "", description: "" });
  const rows = store.state.variables.filter((item) => fuzzy(query, `${item.key} ${item.name}`));

  function save() {
    const result = store.saveVariable(draft);
    if (!result.ok) {
      notify({ tone: "error", title: ops("nameRequired") });
      return;
    }
    setDraft({ id: "", key: "", name: "", valueType: "string", value: "", description: "" });
    notify({ tone: "success", title: t("saved") });
  }

  return (
    <OperatorGate>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("variablesTitle")}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{t("variablesBody")}</p>
        <Input className="max-w-sm" value={query} placeholder={t("varSearch")} onChange={(event) => setQuery(event.target.value)} />
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
          <Field label={t("varKey")}><Input value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} /></Field>
          <Field label={ops("name")}><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
          <Field label={t("varType")}>
            <SimpleSelect
              value={draft.valueType}
              onChange={(value) => setDraft({ ...draft, valueType: value as "string" | "number" })}
              options={[{ value: "string", label: t("string") }, { value: "number", label: t("number") }]}
            />
          </Field>
          <Field label={t("varValue")}><Input value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></Field>
          <div className="md:col-span-2">
            <Field label={ops("description")}><Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
          </div>
          <Button onClick={save}>{t("save")}</Button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2">{t("varKey")}</th>
                <th className="px-3 py-2">{ops("name")}</th>
                <th className="px-3 py-2">{t("varType")}</th>
                <th className="px-3 py-2">{t("varValue")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{item.key}</td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2">{item.valueType}</td>
                  <td className="px-3 py-2">{item.value}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setDraft(item)}>{t("edit")}</Button>
                    <Button size="sm" variant="outline" className="ml-2" onClick={() => store.deleteVariable(item.id)}>{ops("remove")}</Button>
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

function blankLibrary(type: RuleType, modality: MediaModality, scene: string): LibraryEntry {
  return { id: "", type, modality, sceneId: scene, labelIds: [], name: "", description: "", body: "", updatedAt: "" };
}

export function LibrariesView({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useTranslations("Catalog");
  const ops = useTranslations("Ops");
  const store = usePrototypeStore();
  const { notify } = useToast();
  const scope = useScopeLabel();
  const [type, setType] = useState<RuleType>("keyword");
  const [modality, setModality] = useState<MediaModality>("text");
  const [sceneId, setSceneId] = useState<string>(scenes[0].id);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [draft, setDraft] = useState<LibraryEntry>(blankLibrary("keyword", "text", scenes[0].id));
  const rows = store.state.libraries.filter(
    (item) =>
      item.type === type &&
      item.modality === modality &&
      (labelFilter.length === 0 || (item.labelIds ?? []).some((id) => labelFilter.includes(id)))
  );

  function save() {
    const result = store.saveLibrary({ ...draft, type, modality, sceneId: draft.sceneId || sceneId });
    if (!result.ok) {
      notify({ tone: "error", title: ops("nameRequired") });
      return;
    }
    setDraft(blankLibrary(type, modality, sceneId));
    notify({ tone: "success", title: t("saved") });
  }

  function exportRows() {
    downloadCsv(`${type}-library.csv`, [
      ["name", "description", "body"],
      ...rows.map((item) => [item.name, item.description, item.body]),
    ]);
    notify({ tone: "success", title: ops("exported") });
  }

  function importFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const table = parseTable(String(reader.result ?? ""));
      const start = table[0]?.[0]?.toLowerCase() === "name" ? 1 : 0;
      const entries: LibraryEntry[] = table.slice(start).filter((row) => row[0]).map((row) => ({
        id: createId("lib"),
        type,
        modality,
        sceneId,
        labelIds: [],
        name: row[0] ?? "",
        description: row[1] ?? "",
        body: row[2] ?? "",
        updatedAt: new Date().toISOString(),
      }));
      store.importLibraries(entries);
      notify({ tone: "success", title: t("imported") });
    };
    reader.readAsText(file);
  }

  return (
    <OperatorGate>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {embedded ? (
              <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("librariesTitle")}</h2>
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("librariesTitle")}</h1>
            )}
            <p className="mt-2 max-w-3xl text-sm text-slate-600">{t("librariesBody")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportRows}>{t("export")}</Button>
            <TemplateButton filename="library-template.csv" headers={["name", "description", "body"]} />
            <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-slate-200 px-3 text-sm">
              {t("import")}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importFile(file);
                event.target.value = "";
              }} />
            </label>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {modalities.map((item) => (
            <Button key={item} variant={item === modality ? "default" : "outline"} onClick={() => { setModality(item); setDraft((current) => ({ ...current, id: "", modality: item })); }}>
              {t(`media.${item}`)}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {ruleTypes.map((item) => (
            <Button key={item} variant={item === type ? "default" : "outline"} onClick={() => { setType(item); setDraft(blankLibrary(item, modality, sceneId)); }}>
              {ops(`ruleType.${item}`)}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
          <Field label={t("modality")}>
            <SimpleSelect
              value={draft.modality}
              onChange={(value) => {
                setModality(value as MediaModality);
                setDraft({ ...draft, modality: value as MediaModality });
              }}
              options={modalities.map((item) => ({ value: item, label: t(`media.${item}`) }))}
            />
          </Field>
          <Field label={t("sceneStrategy")}>
            <SimpleSelect
              value={draft.sceneId || sceneId}
              onChange={(value) => {
                setSceneId(value);
                setDraft({ ...draft, sceneId: value });
              }}
              options={scenes.map((scene) => ({ value: scene.id, label: scope(scene.id) }))}
            />
          </Field>
          <Field label={ops("name")}><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
          <Field label={ops("description")}><Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
          <Field label={t("payload")} hint={t("payloadHint")}><Textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></Field>
          <div className="md:col-span-2">
            <p className="mb-2 text-sm font-medium text-zinc-800">{t("bindLabels")}</p>
            <div className="flex flex-wrap gap-3 text-sm">
              {store.state.labels.map((label) => (
                <label key={label.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={(draft.labelIds ?? []).includes(label.id)}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        labelIds: (draft.labelIds ?? []).includes(label.id)
                          ? (draft.labelIds ?? []).filter((id) => id !== label.id)
                          : [...(draft.labelIds ?? []), label.id],
                      })
                    }
                  />
                  {label.name}
                </label>
              ))}
            </div>
          </div>
          <Button onClick={save}>{t("save")}</Button>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-zinc-800">{t("labelFilter")}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {store.state.labels.map((label) => (
              <label key={label.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={labelFilter.includes(label.id)}
                  onChange={() =>
                    setLabelFilter((current) =>
                      current.includes(label.id) ? current.filter((id) => id !== label.id) : [...current, label.id]
                    )
                  }
                />
                {label.name}
              </label>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">{ops("name")}</th><th className="px-3 py-2">{t("modality")}</th><th className="px-3 py-2">{t("sceneStrategy")}</th><th className="px-3 py-2">{ops("labelsTitle")}</th><th className="px-3 py-2">{t("payload")}</th><th /></tr></thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2">{t(`media.${item.modality}`)}</td>
                  <td className="px-3 py-2">{scope(item.sceneId)}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {(item.labelIds ?? []).map((id) => store.state.labels.find((label) => label.id === id)?.name).filter(Boolean).join(" · ")}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{item.body}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => { setDraft(item); setType(item.type); setModality(item.modality); setSceneId(item.sceneId); }}>{t("edit")}</Button>
                    <Button size="sm" variant="outline" className="ml-2" onClick={() => store.deleteLibrary(item.id)}>{ops("remove")}</Button>
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

export function KnowledgeView() {
  const t = useTranslations("Catalog");
  const ops = useTranslations("Ops");
  const store = usePrototypeStore();
  const { notify } = useToast();
  const [docOpen, setDocOpen] = useState<Set<string>>(new Set());
  const [ragOpen, setRagOpen] = useState<Set<string>>(new Set());
  const [doc, setDoc] = useState({ id: "", parentId: null as string | null, labelIds: [] as string[], title: "", body: "" });
  const [prompt, setPrompt] = useState({ id: "", name: "", body: "" });
  const [rag, setRag] = useState({ id: "", parentId: null as string | null, knowledgeId: store.state.knowledge[0]?.id ?? "unset", title: "", body: "" });

  function toggleSet(current: Set<string>, id: string) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  function saveDoc() {
    const result = store.saveKnowledge({ ...doc, parentId: doc.parentId, updatedAt: "" });
    if (!result.ok) return notify({ tone: "error", title: ops("nameRequired") });
    setDoc({ id: "", parentId: null, labelIds: [], title: "", body: "" });
    notify({ tone: "success", title: t("saved") });
  }
  function savePrompt() {
    const result = store.savePrompt({ ...prompt, updatedAt: "" });
    if (!result.ok) return notify({ tone: "error", title: ops("nameRequired") });
    setPrompt({ id: "", name: "", body: "" });
    notify({ tone: "success", title: t("saved") });
  }
  function saveRag() {
    if (rag.knowledgeId === "unset") return notify({ tone: "error", title: t("pickDoc") });
    const result = store.saveRag({ ...rag, parentId: rag.parentId, knowledgeId: rag.knowledgeId, updatedAt: "" });
    if (!result.ok) return notify({ tone: "error", title: ops("nameRequired") });
    setRag({ id: "", parentId: null, knowledgeId: rag.knowledgeId, title: "", body: "" });
    notify({ tone: "success", title: t("saved") });
  }

  function renderDocs(parentId: string | null, depth: number): ReactNode {
    return store.state.knowledge
      .filter((item) => (item.parentId ?? null) === parentId)
      .map((item) => {
        const hasChildren = store.state.knowledge.some((child) => child.parentId === item.id);
        const open = docOpen.has(item.id);
        return (
          <div key={item.id} style={{ marginLeft: depth * 16 }} className="border-t border-slate-100 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {hasChildren ? (
                  <button type="button" className="w-5 text-slate-500" onClick={() => setDocOpen((current) => toggleSet(current, item.id))}>{open ? "−" : "+"}</button>
                ) : <span className="w-5" />}
                <button type="button" className={`text-left ${depthTitle(depth)}`} onClick={() => setDoc({ id: item.id, parentId: item.parentId, labelIds: item.labelIds ?? [], title: item.title, body: item.body })}>{item.title}</button>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setDoc({ id: "", parentId: item.id, labelIds: [], title: "", body: "" })}>{t("addChild")}</Button>
                <Button size="sm" variant="outline" onClick={() => store.deleteKnowledge(item.id)}>{ops("remove")}</Button>
              </div>
            </div>
            {open ? renderDocs(item.id, depth + 1) : null}
          </div>
        );
      });
  }

  function renderRag(parentId: string | null, depth: number): ReactNode {
    return store.state.ragEntries
      .filter((item) => (item.parentId ?? null) === parentId)
      .map((item) => {
        const hasChildren = store.state.ragEntries.some((child) => child.parentId === item.id);
        const open = ragOpen.has(item.id);
        return (
          <div key={item.id} style={{ marginLeft: depth * 16 }} className="border-t border-slate-100 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {hasChildren ? (
                  <button type="button" className="w-5 text-slate-500" onClick={() => setRagOpen((current) => toggleSet(current, item.id))}>{open ? "−" : "+"}</button>
                ) : <span className="w-5" />}
                <button type="button" className={`text-left ${depthTitle(depth)}`} onClick={() => setRag({ id: item.id, parentId: item.parentId, knowledgeId: item.knowledgeId, title: item.title, body: item.body })}>{item.title}</button>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setRag({ id: "", parentId: item.id, knowledgeId: item.knowledgeId, title: "", body: "" })}>{t("addChild")}</Button>
                <Button size="sm" variant="outline" onClick={() => store.deleteRag(item.id)}>{ops("remove")}</Button>
              </div>
            </div>
            {open ? renderRag(item.id, depth + 1) : null}
          </div>
        );
      });
  }

  return (
    <OperatorGate>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("knowledgeTitle")}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{t("knowledgeBody")}</p>
        <PrototypeBanner>{t("localNotice")}</PrototypeBanner>
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("documents")}</h2>
          <Field label={t("parent")}>
            <SimpleSelect
              value={doc.parentId ?? "unset"}
              onChange={(value) => setDoc({ ...doc, parentId: value === "unset" ? null : value })}
              options={[{ value: "unset", label: t("root") }, ...store.state.knowledge.filter((item) => item.id !== doc.id).map((item) => ({ value: item.id, label: item.title }))]}
            />
          </Field>
          <Field label={t("docTitle")}><Input value={doc.title} onChange={(event) => setDoc({ ...doc, title: event.target.value })} /></Field>
          <Field label={t("docBody")}><Textarea value={doc.body} onChange={(event) => setDoc({ ...doc, body: event.target.value })} /></Field>
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-800">{t("bindLabels")}</p>
            <div className="flex flex-wrap gap-3 text-sm">
              {store.state.labels.map((label) => (
                <label key={label.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={doc.labelIds.includes(label.id)}
                    onChange={() =>
                      setDoc({
                        ...doc,
                        labelIds: doc.labelIds.includes(label.id)
                          ? doc.labelIds.filter((id) => id !== label.id)
                          : [...doc.labelIds, label.id],
                      })
                    }
                  />
                  {label.name}
                </label>
              ))}
            </div>
          </div>
          {doc.labelIds.length > 0 ? (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              <p className="text-sm font-medium text-zinc-800">{t("referencedLabels")}</p>
              {doc.labelIds.map((id) => {
                const label = store.state.labels.find((item) => item.id === id);
                if (!label) return null;
                return (
                  <div key={id} className="border-t border-slate-200 pt-2 text-sm text-slate-700">
                    <p className="font-medium text-zinc-900">{label.name}</p>
                    <p><span className="text-slate-500">{ops("definition")}</span> {label.definition}</p>
                    <p><span className="text-slate-500">{t("annotation")}</span> {label.annotation}</p>
                    <p><span className="text-slate-500">{ops("positive")}</span> {label.positiveCases.join(" / ")}</p>
                    <p><span className="text-slate-500">{ops("negative")}</span> {label.negativeCases.join(" / ")}</p>
                  </div>
                );
              })}
            </div>
          ) : null}
          <Button onClick={saveDoc}>{t("save")}</Button>
          <div className="text-sm">{renderDocs(null, 0)}</div>
        </section>
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("prompts")}</h2>
          <Field label={ops("name")}><Input value={prompt.name} onChange={(event) => setPrompt({ ...prompt, name: event.target.value })} /></Field>
          <Field label={t("promptBody")}><Textarea value={prompt.body} onChange={(event) => setPrompt({ ...prompt, body: event.target.value })} /></Field>
          <Button onClick={savePrompt}>{t("save")}</Button>
          <ul className="space-y-2 text-sm">
            {store.state.prompts.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                <button type="button" className="text-left text-sm font-medium text-zinc-800" onClick={() => setPrompt({ id: item.id, name: item.name, body: item.body })}>{item.name}</button>
                <Button size="sm" variant="outline" onClick={() => store.deletePrompt(item.id)}>{ops("remove")}</Button>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("ragEntries")}</h2>
          <Field label={t("parent")}>
            <SimpleSelect
              value={rag.parentId ?? "unset"}
              onChange={(value) => setRag({ ...rag, parentId: value === "unset" ? null : value })}
              options={[{ value: "unset", label: t("root") }, ...store.state.ragEntries.filter((item) => item.id !== rag.id).map((item) => ({ value: item.id, label: item.title }))]}
            />
          </Field>
          <Field label={t("documents")}>
            <SimpleSelect
              value={rag.knowledgeId || "unset"}
              onChange={(value) => setRag({ ...rag, knowledgeId: value })}
              options={[{ value: "unset", label: t("pickDoc") }, ...store.state.knowledge.map((item) => ({ value: item.id, label: item.title }))]}
            />
          </Field>
          <Field label={t("docTitle")}><Input value={rag.title} onChange={(event) => setRag({ ...rag, title: event.target.value })} /></Field>
          <Field label={t("docBody")}><Textarea value={rag.body} onChange={(event) => setRag({ ...rag, body: event.target.value })} /></Field>
          <Button onClick={saveRag}>{t("save")}</Button>
          <div className="text-sm">{renderRag(null, 0)}</div>
        </section>
      </div>
    </OperatorGate>
  );
}

function mockLlm(text: string, modelId: string, ragCount: number) {
  const lower = text.toLowerCase();
  if (lower.includes("demo_outage")) return { status: "error" as const, decision: null };
  let decision: Decision = "allow";
  if (lower.includes("demo_block_token")) decision = "block";
  else if (lower.includes("demo_review_token") || (ragCount > 0 && lower.includes("example_politics"))) decision = "review";
  if (modelId === "cap_platform_llm_plus" && decision === "allow" && lower.includes("risk")) decision = "review";
  return { status: "success" as const, decision };
}

export function LlmLabView() {
  const t = useTranslations("Catalog");
  const enums = useTranslations("Enums");
  const store = usePrototypeStore();
  const { notify } = useToast();
  const models = store.state.capabilities.filter((item) => item.type === "inhouse_llm");
  const [picked, setPicked] = useState<string[]>(models.slice(0, 1).map((item) => item.id));
  const [promptId, setPromptId] = useState(store.state.prompts[0]?.id ?? "unset");
  const [ragIds, setRagIds] = useState<string[]>(store.state.ragEntries.slice(0, 1).map((item) => item.id));
  const [input, setInput] = useState("");
  const [expected, setExpected] = useState<Decision | "">("allow");
  const [results, setResults] = useState<Record<string, string>[]>([]);

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  }

  function addCase() {
    if (!input.trim()) return;
    const next: LlmCase = { id: createId("case"), input: input.trim(), expected };
    store.setLlmCases([...store.state.llmCases, next]);
    setInput("");
  }

  function run() {
    const prompt = store.state.prompts.find((item) => item.id === promptId);
    const rows: Record<string, string>[] = [];
    for (const item of store.state.llmCases) {
      for (const modelId of picked) {
        const outcome = mockLlm(item.input, modelId, ragIds.length);
        rows.push({
          input: item.input,
          expected: item.expected,
          model: modelId,
          status: outcome.status,
          decision: outcome.decision ?? "",
          is_mock: "true",
          sent_externally: "false",
          prompt: prompt?.name ?? "",
          rag: String(ragIds.length),
        });
      }
    }
    setResults(rows);
    notify({ tone: "success", title: t("ran") });
  }

  function upload(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const table = parseTable(String(reader.result ?? ""));
      const start = table[0]?.[0]?.toLowerCase() === "input" ? 1 : 0;
      const cases: LlmCase[] = table.slice(start).filter((row) => row[0]).map((row) => ({
        id: createId("case"),
        input: row[0],
        expected: row[1] === "block" || row[1] === "review" || row[1] === "allow" ? row[1] : "",
      }));
      store.setLlmCases([...store.state.llmCases, ...cases]);
      notify({ tone: "success", title: t("imported") });
    };
    reader.readAsText(file);
  }

  return (
    <OperatorGate>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("llmLabTitle")}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{t("llmLabBody")}</p>
        <PrototypeBanner>{t("localNotice")}</PrototypeBanner>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <p className="text-base font-semibold tracking-tight text-zinc-900">{t("models")}</p>
            {models.map((item) => (
              <label key={item.id} className="flex items-center gap-2">
                <input type="checkbox" checked={picked.includes(item.id)} onChange={() => setPicked(toggle(picked, item.id))} />
                {item.customName ?? enums(`capabilities.${item.id}`)}
              </label>
            ))}
            <Field label={t("prompts")}>
              <SimpleSelect
                value={promptId}
                onChange={setPromptId}
                options={[{ value: "unset", label: t("pickDoc") }, ...store.state.prompts.map((item) => ({ value: item.id, label: item.name }))]}
              />
            </Field>
            <p className="text-base font-semibold tracking-tight text-zinc-900">{t("ragEntries")}</p>
            {store.state.ragEntries.map((item) => (
              <label key={item.id} className="flex items-center gap-2">
                <input type="checkbox" checked={ragIds.includes(item.id)} onChange={() => setRagIds(toggle(ragIds, item.id))} />
                {item.title}
              </label>
            ))}
          </div>
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <Field label={t("caseInput")}><Textarea value={input} onChange={(event) => setInput(event.target.value)} /></Field>
            <Field label={t("expected")}>
              <SimpleSelect
                value={expected || "allow"}
                onChange={(value) => setExpected(value as Decision)}
                options={["allow", "block", "review"].map((item) => ({ value: item, label: enums(`decision.${item}`) }))}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={addCase}>{t("addCase")}</Button>
              <Button variant="outline" onClick={run}>{t("run")}</Button>
              <Button variant="outline" onClick={() => downloadCsv("llm-cases.csv", [["input", "expected"], ...store.state.llmCases.map((item) => [item.input, item.expected])])}>{t("download")}</Button>
              <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-slate-200 px-3 text-sm">
                {t("upload")}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) upload(file);
                  event.target.value = "";
                }} />
              </label>
              <TemplateButton filename="llm-case-template.csv" headers={["input", "expected"]} />
            </div>
            <CaseSheetBar
              onLoad={(rows) => {
                const cases: LlmCase[] = rows.map((row) => ({
                  id: createId("case"),
                  input: row.input,
                  expected: row.expected === "block" || row.expected === "review" || row.expected === "allow" ? row.expected : "",
                }));
                store.setLlmCases([...store.state.llmCases, ...cases]);
                notify({ tone: "success", title: t("imported") });
              }}
            />
          </div>
        </div>
        <ul className="space-y-1 text-sm">
          {store.state.llmCases.map((item) => (
            <li key={item.id} className="flex justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span>{item.input}</span>
              <button type="button" onClick={() => store.setLlmCases(store.state.llmCases.filter((row) => row.id !== item.id))}>{t("delete")}</button>
            </li>
          ))}
        </ul>
        {results.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("runExamples")}</h2>
            <TestReport
              source="llm-lab"
              cases={results.map((row) => ({
                input: row.input,
                expected: row.expected,
                decision: row.decision,
                status: row.status,
                capabilityIds: [row.model],
              }))}
            />
            <RecordBrowser rows={results} downloadName="llm-lab-results.csv" defaultFields={["input", "decision", "status"]} />
          </section>
        ) : null}
      </div>
    </OperatorGate>
  );
}

export function InterceptView() {
  const t = useTranslations("Catalog");
  const enums = useTranslations("Enums");
  const store = usePrototypeStore();
  const { session } = useSession();
  const [tenantId, setTenantId] = useState(session?.role === "customer" ? session.tenantId : "ten_demo");
  const [single, setSingle] = useState("");
  const [singleExpected, setSingleExpected] = useState("");
  const [batch, setBatch] = useState("");
  const [batchExpected, setBatchExpected] = useState("");
  const [rows, setRows] = useState<Array<{ input: string; expected: string; status: string; decision: string; capabilityIds: string[]; ruleHits: Array<{ ruleId: string; version: number; action: Decision }> }>>([]);
  const locked = session?.role === "customer";
  const activeTenant = locked ? session.tenantId : tenantId;

  function versionsForTenant(): RuleVersion[] {
    return store.state.rules
      .map((rule) => store.state.ruleVersions.find((item) => item.id === rule.currentVersionId))
      .filter((item): item is RuleVersion => Boolean(item))
      .filter((item) => item.tenantId === activeTenant && item.status !== "archived");
  }

  function capabilityIds(versions: ReturnType<typeof versionsForTenant>) {
    const ids = new Set<string>();
    for (const version of versions) {
      if (version.type === "keyword" || version.type === "ignore_term") ids.add("cap_politics_keywords");
      else if (version.type === "model_threshold") ids.add("cap_text_small");
      else ids.add("cap_text_small");
    }
    return [...ids];
  }

  function run(lines: Array<{ input: string; expected: string }>) {
    const versions = versionsForTenant();
    const caps = capabilityIds(versions);
    setRows(lines.filter((line) => line.input.trim()).slice(0, 50).map((line) => {
      const result = interceptText(line.input, versions);
      return {
        input: line.input,
        expected: line.expected,
        status: result.status,
        decision: result.decision ?? "",
        capabilityIds: caps,
        ruleHits: result.hits.map((hit) => ({ ruleId: hit.ruleId, version: 1, action: hit.action })),
      };
    }));
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("interceptTitle")}</h1>
      <p className="max-w-3xl text-sm text-slate-600">{t("interceptBody")}</p>
      <PrototypeBanner>{t("interceptNotice")}</PrototypeBanner>
      {locked ? <p className="text-sm text-slate-600">{t("tenantLocked")} {activeTenant}</p> : (
        <div className="max-w-sm">
          <Field label={t("tenant")}>
            <SimpleSelect
              value={tenantId}
              onChange={setTenantId}
              options={store.state.tenants.map((item) => ({ value: item.id, label: item.name }))}
            />
          </Field>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <Field label={t("single")}><Textarea value={single} onChange={(event) => setSingle(event.target.value)} /></Field>
          <Field label={t("expected")}>
            <SimpleSelect
              value={singleExpected || "unset"}
              onChange={(value) => setSingleExpected(value === "unset" ? "" : value)}
              options={[
                { value: "unset", label: t("noExpected") },
                ...["allow", "block", "review"].map((item) => ({ value: item, label: enums(`decision.${item}`) })),
              ]}
            />
          </Field>
          <Button onClick={() => run([{ input: single, expected: singleExpected }])}>{t("runSingle")}</Button>
        </div>
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <Field label={t("batch")} hint={t("batchHint")}><Textarea value={batch} onChange={(event) => setBatch(event.target.value)} /></Field>
          <Field label={t("expected")}>
            <SimpleSelect
              value={batchExpected || "unset"}
              onChange={(value) => setBatchExpected(value === "unset" ? "" : value)}
              options={[
                { value: "unset", label: t("noExpected") },
                ...["allow", "block", "review"].map((item) => ({ value: item, label: enums(`decision.${item}`) })),
              ]}
            />
          </Field>
          <Button onClick={() => run(batch.split(/\r?\n/).map((input) => ({ input, expected: batchExpected })))}>{t("runBatch")}</Button>
          <CaseSheetBar
            onLoad={(loaded) => {
              setBatch(loaded.map((row) => row.input).join("\n"));
              run(loaded.map((row) => ({ input: row.input, expected: row.expected })));
            }}
          />
        </div>
      </div>
      {rows.length > 0 ? (
        <TestReport
          source={`intercept-${activeTenant}`}
          applicationId={store.state.applications.find((item) => item.tenantId === activeTenant)?.id ?? "app_community"}
          channelId={store.state.channels.find((item) => item.applicationId === (store.state.applications.find((app) => app.tenantId === activeTenant)?.id ?? ""))?.id ?? "ch_posts"}
          cases={rows}
        />
      ) : null}
    </div>
  );
}

export function QueryView() {
  const t = useTranslations("Catalog");
  const store = usePrototypeStore();
  const { session } = useSession();
  const { notify } = useToast();
  const [sql, setSql] = useState("SELECT id, decision, scene_id, status FROM logs LIMIT 20");
  const [queryId, setQueryId] = useState("");
  const [queryName, setQueryName] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState("");

  function tables() {
    const apps = store.state.applications;
    const tenantId = session?.role === "customer" ? session.tenantId : null;
    const logs: QueryTable[] = store.state.auditRecords
      .filter((record) => {
        if (!tenantId) return true;
        const app = apps.find((item) => item.id === record.applicationId);
        return app?.tenantId === tenantId;
      })
      .map((record) => ({
        id: record.id,
        request_id: record.requestId,
        application_id: record.applicationId,
        scene_id: record.sceneId,
        input_type: record.inputType,
        decision: record.decision ?? "",
        status: record.status,
        latency_ms: String(record.latencyMs),
        created_at: record.createdAt,
        risk_labels: record.riskLabels.join("|"),
        content: record.content,
        content_md5: record.contentMd5,
        capabilities: record.modelCalls.map((call) => call.capabilityId).join("|"),
      }));
    const history: QueryTable[] = store.state.releases
      .filter((record) => {
        if (!tenantId) return true;
        if (record.targetType !== "rule") return false;
        const rule = store.state.rules.find((item) => item.id === record.targetId);
        const version = store.state.ruleVersions.find((item) => item.id === rule?.currentVersionId);
        return version?.tenantId === tenantId;
      })
      .map((record) => ({
        id: record.id,
        target_type: record.targetType,
        target_id: record.targetId,
        version_id: record.versionId,
        action: record.action,
        note: record.note,
        created_at: record.createdAt,
      }));
    return { logs, history };
  }

  function run() {
    const outcome = runSelect(sql, tables());
    if (!outcome.ok) {
      setColumns([]);
      setRows([]);
      setError(t(`queryError.${outcome.error}`));
      return;
    }
    setError("");
    setColumns(outcome.columns);
    setRows(outcome.rows);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("queryTitle")}</h1>
      <p className="max-w-3xl text-sm text-slate-600">{t("queryBody")}</p>
      <PrototypeBanner>{t("queryNotice")}</PrototypeBanner>
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("savedQueries")}</h2>
        <ul className="space-y-2 text-sm">
          {store.state.savedQueries.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
              <button
                type="button"
                className="text-left"
                onClick={() => {
                  setQueryId(item.id);
                  setQueryName(item.name);
                  setSql(item.sql);
                }}
              >
                <span className="font-medium">{item.name}</span>
                <span className="mt-1 block font-mono text-xs text-slate-500">{item.sql}</span>
              </button>
              <Button size="sm" variant="outline" onClick={() => store.deleteQuery(item.id)}>{t("deleteQuery")}</Button>
            </li>
          ))}
        </ul>
      </div>
      <Field label={t("queryName")}><Input value={queryName} onChange={(event) => setQueryName(event.target.value)} /></Field>
      <Field label={t("sql")}><Textarea className="min-h-28 font-mono" value={sql} onChange={(event) => setSql(event.target.value)} /></Field>
      <div className="flex flex-wrap gap-2">
        <Button onClick={run}>{t("runSql")}</Button>
        <Button
          variant="outline"
          onClick={() => {
            const result = store.saveQuery({ id: queryId, name: queryName, sql });
            if (!result.ok) {
              notify({ tone: "error", title: t("queryName") });
              return;
            }
            setQueryId(result.data.id);
            notify({ tone: "success", title: t("saved") });
          }}
        >
          {t("saveQuery")}
        </Button>
        <Button variant="outline" onClick={() => { if (!columns.length) return; downloadCsv("log-query.csv", [columns, ...rows]); notify({ tone: "success", title: t("exported") }); }}>{t("export")}</Button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {columns.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>{columns.map((column) => <th key={column} className="px-3 py-2 font-medium">{column}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-slate-100">
                  {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
