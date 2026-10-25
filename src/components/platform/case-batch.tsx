"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Disclosure, useScopeLabel } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { presentAudit } from "@/lib/platform/audit-present";
import { downloadCsv } from "@/lib/platform/csv";
import { auditRecords } from "@/lib/platform/seed";
import { usePrototypeStore } from "@/lib/platform/store";
import type { SampleRecord } from "@/lib/platform/types";

export type SheetRow = { input: string; expected: string };
export type FlatRecord = Record<string, string>;
type CompareOp = "eq" | "contains";

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

export function parseCaseSheet(text: string): SheetRow[] {
  const table = parseTable(text);
  const start = table[0]?.[0]?.toLowerCase() === "input" ? 1 : 0;
  return table
    .slice(start)
    .filter((row) => row[0])
    .slice(0, 50)
    .map((row) => ({ input: row[0] ?? "", expected: row[1] ?? "" }));
}

function flattenValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        item && typeof item === "object"
          ? Object.values(item as Record<string, unknown>).map((part) => flattenValue(part)).join(":")
          : String(item)
      )
      .join("|");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => `${key}=${flattenValue(inner)}`)
      .join("|");
  }
  return String(value);
}

export function flattenRecord(record: object): FlatRecord {
  const flat: FlatRecord = {};
  for (const [key, value] of Object.entries(record)) {
    flat[key] = flattenValue(value);
  }
  return flat;
}

export function fieldsOf(rows: FlatRecord[]) {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) keys.add(key);
  }
  return [...keys];
}

function caseFromHistory(row: FlatRecord): SheetRow {
  const requestId = row.serial || row.requestId || row.id || "";
  const decision = row.decision ?? "";
  const input =
    decision === "block"
      ? `DEMO_BLOCK_TOKEN ${requestId}`
      : decision === "review"
        ? `DEMO_REVIEW_TOKEN ${requestId}`
        : `Thanks for the update. ${requestId}`;
  return { input, expected: decision };
}

export function TemplateButton({ filename, headers }: { filename: string; headers: string[] }) {
  const t = useTranslations("Catalog");
  return (
    <Button type="button" variant="outline" onClick={() => downloadCsv(filename, [headers])}>
      {t("downloadTemplate")}
    </Button>
  );
}

export type FieldGroup = { id: string; label: string; fields: string[] };

function clampLimit(value: number) {
  if (!Number.isFinite(value)) return 20;
  return Math.min(500, Math.max(1, Math.round(value)));
}

function pickSamples(rows: SampleRecord[], polarity: "all" | "black" | "white", blackLimit: number, whiteLimit: number, total: number) {
  const black = rows.filter((row) => row.polarity === "black").slice(0, blackLimit);
  const white = rows.filter((row) => row.polarity === "white").slice(0, whiteLimit);
  const mixed = polarity === "black" ? black : polarity === "white" ? white : [...black, ...white];
  return mixed.slice(0, total);
}

function FieldChecks({
  fields,
  selected,
  labels,
  onToggle,
  conditions,
  onCondition,
}: {
  fields: string[];
  selected: string[];
  labels: Record<string, string>;
  onToggle: (field: string) => void;
  conditions: Record<string, { op: CompareOp; value: string }>;
  onCondition: (field: string, patch: Partial<{ op: CompareOp; value: string }>) => void;
}) {
  const t = useTranslations("Catalog");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {fields.map((field) => (
          <label key={field} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs">
            <input type="checkbox" checked={selected.includes(field)} onChange={() => onToggle(field)} />
            {labels[field] ?? field}
          </label>
        ))}
      </div>
      {fields.filter((field) => selected.includes(field)).map((field) => {
        const condition = conditions[field] ?? { op: "contains" as const, value: "" };
        return (
          <div key={field} className="grid gap-2 md:grid-cols-[8rem_7rem_1fr]">
            <span className="self-center text-xs text-slate-600">{labels[field] ?? field}</span>
            <select
              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
              value={condition.op}
              onChange={(event) => onCondition(field, { op: event.target.value as CompareOp })}
            >
              <option value="contains">{t("contains")}</option>
              <option value="eq">{t("equals")}</option>
            </select>
            <Input
              value={condition.value}
              placeholder={t("condition")}
              onChange={(event) => onCondition(field, { value: event.target.value })}
            />
          </div>
        );
      })}
    </div>
  );
}

function FieldPicker({
  fields,
  selected,
  onToggle,
  conditions,
  onCondition,
  hint,
  labels = {},
  groups = [],
}: {
  fields: string[];
  selected: string[];
  onToggle: (field: string) => void;
  conditions: Record<string, { op: CompareOp; value: string }>;
  onCondition: (field: string, patch: Partial<{ op: CompareOp; value: string }>) => void;
  hint?: string;
  labels?: Record<string, string>;
  groups?: FieldGroup[];
}) {
  const t = useTranslations("Catalog");
  const known = new Set(groups.flatMap((group) => group.fields));
  const extra = fields.filter((field) => !known.has(field));
  const sections = groups.length
    ? [
        ...groups
          .map((group) => ({ ...group, fields: group.fields.filter((field) => fields.includes(field)) }))
          .filter((group) => group.fields.length > 0),
        ...(extra.length ? [{ id: "extra", label: t("fieldGroup.extra"), fields: extra }] : []),
      ]
    : [];
  return (
    <Disclosure title={t("queryFields")} hint={t("selectedFields", { count: selected.length })} defaultOpen={fields.length <= 6}>
      <p className="text-xs text-slate-500">{hint ?? t("fieldHint")}</p>
      {sections.length > 0 ? (
        sections.map((group) => (
          <Disclosure key={group.id} title={group.label} defaultOpen>
            <FieldChecks
              fields={group.fields}
              selected={selected}
              labels={labels}
              onToggle={onToggle}
              conditions={conditions}
              onCondition={onCondition}
            />
          </Disclosure>
        ))
      ) : (
        <FieldChecks
          fields={fields}
          selected={selected}
          labels={labels}
          onToggle={onToggle}
          conditions={conditions}
          onCondition={onCondition}
        />
      )}
    </Disclosure>
  );
}

function useRecordQuery(rows: FlatRecord[], defaultFields: string[]) {
  const fields = useMemo(() => fieldsOf(rows), [rows]);
  const [selected, setSelected] = useState<string[]>(defaultFields.filter((field) => fields.includes(field)));
  const [conditions, setConditions] = useState<Record<string, { op: CompareOp; value: string }>>({});
  const matched = useMemo(
    () =>
      rows.filter((row) =>
        selected.every((field) => {
          const condition = conditions[field];
          if (!condition?.value.trim()) return true;
          const cell = (row[field] ?? "").toLowerCase();
          const needle = condition.value.trim().toLowerCase();
          return condition.op === "eq" ? cell === needle : cell.includes(needle);
        })
      ),
    [conditions, rows, selected]
  );
  function toggle(field: string) {
    setSelected((current) => (current.includes(field) ? current.filter((item) => item !== field) : [...current, field]));
  }
  function setCondition(field: string, patch: Partial<{ op: CompareOp; value: string }>) {
    setConditions((current) => ({
      ...current,
      [field]: { op: current[field]?.op ?? "contains", value: current[field]?.value ?? "", ...patch },
    }));
  }
  return { fields, selected, conditions, matched, toggle, setCondition };
}

export function RecordBrowser({
  rows,
  downloadName,
  defaultFields = [],
}: {
  rows: FlatRecord[];
  downloadName: string;
  defaultFields?: string[];
}) {
  const t = useTranslations("Catalog");
  const query = useRecordQuery(rows, defaultFields);
  return (
    <div className="space-y-3">
      <FieldPicker
        fields={query.fields}
        selected={query.selected}
        onToggle={query.toggle}
        conditions={query.conditions}
        onCondition={query.setCondition}
        hint={t("resultFieldHint")}
      />
      {query.selected.length === 0 ? (
        <p className="text-sm text-slate-500">{t("pickFields")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {query.selected.map((field) => (
                  <th key={field} className="px-2 py-2 font-medium">{field}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.matched.slice(0, 30).map((row, index) => (
                <tr key={`${row.id ?? row.input ?? index}`} className="border-t border-slate-100">
                  {query.selected.map((field) => (
                    <td key={field} className="px-2 py-2">{row[field]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={query.selected.length === 0}
        onClick={() =>
          downloadCsv(downloadName, [
            query.selected,
            ...query.matched.map((row) => query.selected.map((field) => row[field] ?? "")),
          ])
        }
      >
        {t("downloadSelected")}
      </Button>
    </div>
  );
}

export function QueryFields({
  rows,
  defaultFields,
  labels = {},
  groups = [],
  hint,
  children,
}: {
  rows: FlatRecord[];
  defaultFields: string[];
  labels?: Record<string, string>;
  groups?: FieldGroup[];
  hint?: string;
  children?: (matched: FlatRecord[], selected: string[]) => ReactNode;
}) {
  const query = useRecordQuery(rows, defaultFields);
  return (
    <div className="space-y-3">
      <FieldPicker
        fields={query.fields}
        selected={query.selected}
        onToggle={query.toggle}
        conditions={query.conditions}
        onCondition={query.setCondition}
        hint={hint}
        labels={labels}
        groups={groups}
      />
      {children ? children(query.matched, query.selected) : null}
    </div>
  );
}

function SampleImport({ onLoad, limit }: { onLoad: (rows: SheetRow[]) => void; limit: number }) {
  const t = useTranslations("Catalog");
  const store = usePrototypeStore();
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [polarity, setPolarity] = useState<"all" | "black" | "white">("all");
  const [blackLimit, setBlackLimit] = useState(10);
  const [whiteLimit, setWhiteLimit] = useState(10);
  const matched = useMemo(() => {
    const rows = store.state.samples.filter((sample) => labelIds.length === 0 || sample.labelIds.some((id) => labelIds.includes(id)));
    return pickSamples(rows, polarity, clampLimit(blackLimit), clampLimit(whiteLimit), limit);
  }, [blackLimit, labelIds, limit, polarity, store.state.samples, whiteLimit]);

  return (
    <Disclosure title={t("importSamples")} hint={t("selectedFields", { count: matched.length })}>
      <div className="flex flex-wrap gap-2">
        {(["all", "black", "white"] as const).map((item) => (
          <Button key={item} type="button" size="sm" variant={polarity === item ? "default" : "outline"} onClick={() => setPolarity(item)}>
            {t(`polarity.${item}`)}
          </Button>
        ))}
      </div>
      <Disclosure title={t("bindLabels")}>
        <div className="flex flex-wrap gap-2 text-xs">
          {store.state.labels.map((label) => (
            <label key={label.id} className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1">
              <input
                type="checkbox"
                checked={labelIds.includes(label.id)}
                onChange={() =>
                  setLabelIds((current) => (current.includes(label.id) ? current.filter((id) => id !== label.id) : [...current, label.id]))
                }
              />
              {label.name}
            </label>
          ))}
        </div>
      </Disclosure>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-xs text-slate-600">
          {t("blackLimit")}
          <Input className="mt-1" type="number" min={1} max={500} value={blackLimit} onChange={(event) => setBlackLimit(Number(event.target.value))} />
        </label>
        <label className="text-xs text-slate-600">
          {t("whiteLimit")}
          <Input className="mt-1" type="number" min={1} max={500} value={whiteLimit} onChange={(event) => setWhiteLimit(Number(event.target.value))} />
        </label>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => onLoad(matched.map((sample) => ({ input: sample.input, expected: sample.expected })))}
      >
        {t("importSamples")}
      </Button>
    </Disclosure>
  );
}

export function CaseSheetBar({ onLoad }: { onLoad: (rows: SheetRow[]) => void }) {
  const t = useTranslations("Catalog");
  const store = usePrototypeStore();
  const scope = useScopeLabel();
  const [limit, setLimit] = useState(20);
  const history = useMemo(
    () =>
      auditRecords.map((record) =>
        presentAudit(record, {
          application: store.state.applications.find((item) => item.id === record.applicationId)?.name ?? record.applicationId,
          channel: store.state.channels.find((item) => item.id === record.channelId)?.name ?? record.channelId,
          scene: scope(record.sceneId),
        })
      ),
    [scope, store.state.applications, store.state.channels]
  );
  const labels = useMemo(
    () => Object.fromEntries(history.length ? Object.keys(history[0]).map((field) => [field, t(`auditField.${field}`)]) : []),
    [history, t]
  );
  const groups: FieldGroup[] = [
    { id: "record", label: t("fieldGroup.record"), fields: ["serial", "createdAt", "id"] },
    { id: "scope", label: t("fieldGroup.scope"), fields: ["application", "channel", "scene"] },
    { id: "hit", label: t("fieldGroup.hit"), fields: ["decision", "ruleIds", "status", "inputType", "riskLabels", "latencyMs"] },
  ];
  const query = useRecordQuery(history, ["serial", "decision", "channel"]);
  const capped = clampLimit(limit);

  function upload(file: File) {
    const reader = new FileReader();
    reader.onload = () => onLoad(parseCaseSheet(String(reader.result ?? "")).slice(0, capped));
    reader.readAsText(file);
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-3 text-sm">
          {t("uploadSheet")}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
              event.target.value = "";
            }}
          />
        </label>
        <TemplateButton filename="case-template.csv" headers={["input", "expected"]} />
        <label className="flex items-center gap-2 text-xs text-slate-600">
          {t("dataLimit")}
          <Input className="h-8 w-20" type="number" min={1} max={500} value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
        </label>
        <Button type="button" variant="outline" onClick={() => onLoad(query.matched.slice(0, capped).map(caseFromHistory))}>
          {t("importOnline")}
        </Button>
      </div>
      <FieldPicker
        fields={query.fields}
        selected={query.selected}
        onToggle={query.toggle}
        conditions={query.conditions}
        onCondition={query.setCondition}
        labels={labels}
        groups={groups}
      />
      {query.selected.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                {query.selected.map((field) => (
                  <th key={field} className="px-2 py-2 font-medium">{labels[field] ?? field}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.matched.slice(0, 8).map((row) => (
                <tr key={row.id || row.serial} className="border-t border-slate-100">
                  {query.selected.map((field) => (
                    <td key={field} className="px-2 py-2">{row[field]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-slate-500">{t("pickFields")}</p>
      )}
      <SampleImport limit={capped} onLoad={onLoad} />
    </div>
  );
}
