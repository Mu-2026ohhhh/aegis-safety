"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Disclosure, Field, SimpleSelect, useToast } from "@/components/platform/ui";
import { TemplateButton } from "@/components/platform/case-batch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { downloadCsv } from "@/lib/platform/csv";
import { createId } from "@/lib/platform/hash";
import { OperatorGate } from "@/lib/platform/session";
import { usePrototypeStore } from "@/lib/platform/store";
import type { Decision, SamplePolarity, SampleRecord } from "@/lib/platform/types";

const templateHeaders = ["input", "expected", "polarity", "labels", "resource", "application", "channel"];

function blankSample(): SampleRecord {
  return {
    id: "",
    input: "",
    expected: "block",
    polarity: "black",
    labelIds: [],
    capabilityIds: [],
    applicationId: "",
    channelId: "",
    updatedAt: "",
  };
}

function splitList(value: string) {
  return value.split("|").map((item) => item.trim()).filter(Boolean);
}

export function SamplesView() {
  const t = useTranslations("Catalog");
  const ops = useTranslations("Ops");
  const enums = useTranslations("Enums");
  const store = usePrototypeStore();
  const { notify } = useToast();
  const [query, setQuery] = useState("");
  const [polarity, setPolarity] = useState<"all" | SamplePolarity>("all");
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [draft, setDraft] = useState<SampleRecord>(blankSample());
  const channels = store.state.channels.filter((channel) => !draft.applicationId || channel.applicationId === draft.applicationId);

  const rows = useMemo(
    () =>
      store.state.samples.filter((sample) => {
        if (polarity !== "all" && sample.polarity !== polarity) return false;
        if (labelFilter.length > 0 && !sample.labelIds.some((id) => labelFilter.includes(id))) return false;
        if (!query.trim()) return true;
        return sample.input.toLowerCase().includes(query.trim().toLowerCase());
      }),
    [labelFilter, polarity, query, store.state.samples]
  );

  function names(ids: string[], source: Array<{ id: string; name: string }>) {
    return ids.map((id) => source.find((item) => item.id === id)?.name ?? id).join(" · ");
  }

  function save() {
    const result = store.saveSample({
      ...draft,
      applicationId: draft.applicationId || store.state.applications[0]?.id || "",
      channelId: draft.channelId || channels[0]?.id || "",
    });
    if (!result.ok) {
      notify({ tone: "error", title: ops("nameRequired") });
      return;
    }
    setDraft(blankSample());
    notify({ tone: "success", title: t("saved") });
  }

  function importFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const start = lines[0]?.toLowerCase().startsWith("input") ? 1 : 0;
      const entries: SampleRecord[] = lines.slice(start).map((line) => {
        const cells = line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
        const expected: Decision | "" = cells[1] === "allow" || cells[1] === "block" || cells[1] === "review" ? cells[1] : "";
        const polarityCell = cells[2]?.toLowerCase();
        const nextPolarity: SamplePolarity = polarityCell === "white" || polarityCell === "白" || polarityCell === "白样本" ? "white" : "black";
        const labelIds = splitList(cells[3] ?? "").map((token) => store.state.labels.find((label) => label.id === token || label.name === token)?.id ?? token);
        const capabilityIds = splitList(cells[4] ?? "").map(
          (token) => store.state.capabilities.find((item) => item.id === token || item.customName === token)?.id ?? token
        );
        const application = store.state.applications.find((item) => item.id === cells[5] || item.name === cells[5]);
        const channel = store.state.channels.find((item) => item.id === cells[6] || item.name === cells[6]);
        return {
          id: createId("sample"),
          input: cells[0] ?? "",
          expected,
          polarity: nextPolarity,
          labelIds: labelIds.filter((id) => store.state.labels.some((label) => label.id === id)),
          capabilityIds: capabilityIds.filter((id) => store.state.capabilities.some((item) => item.id === id)),
          applicationId: application?.id ?? store.state.applications[0]?.id ?? "",
          channelId: channel?.id ?? "",
          updatedAt: new Date().toISOString(),
        };
      }).filter((item) => item.input);
      store.importSamples(entries);
      notify({ tone: "success", title: t("imported") });
    };
    reader.readAsText(file);
  }

  function downloadRows() {
    downloadCsv("samples.csv", [
      templateHeaders,
      ...rows.map((sample) => [
        sample.input,
        sample.expected,
        sample.polarity,
        sample.labelIds.map((id) => store.state.labels.find((label) => label.id === id)?.name ?? id).join("|"),
        sample.capabilityIds.join("|"),
        store.state.applications.find((item) => item.id === sample.applicationId)?.name ?? sample.applicationId,
        store.state.channels.find((item) => item.id === sample.channelId)?.name ?? sample.channelId,
      ]),
    ]);
  }

  return (
    <OperatorGate>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("samplesTitle")}</h1>
        <p className="max-w-3xl text-sm text-slate-600">{t("samplesBody")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-xs" value={query} placeholder={t("sampleSearch")} onChange={(event) => setQuery(event.target.value)} />
          {(["all", "black", "white"] as const).map((item) => (
            <Button key={item} size="sm" variant={polarity === item ? "default" : "outline"} onClick={() => setPolarity(item)}>
              {t(`polarity.${item}`)}
            </Button>
          ))}
          <TemplateButton filename="sample-template.csv" headers={templateHeaders} />
          <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-3 text-sm">
            {t("uploadSheet")}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importFile(file);
              event.target.value = "";
            }} />
          </label>
          <Button variant="outline" onClick={downloadRows}>{t("download")}</Button>
        </div>
        <Disclosure title={t("labelFilter")}>
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
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{t("sampleForm")}</h2>
          <Field label={t("caseInput")}>
            <Textarea value={draft.input} onChange={(event) => setDraft({ ...draft, input: event.target.value })} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("expected")}>
              <SimpleSelect
                value={draft.expected || "unset"}
                onChange={(value) => setDraft({ ...draft, expected: value === "unset" ? "" : value as Decision })}
                options={[
                  { value: "unset", label: t("pickDoc") },
                  ...(["allow", "block", "review"] as const).map((item) => ({ value: item, label: enums(`decision.${item}`) })),
                ]}
              />
            </Field>
            <Field label={t("samplePolarity")}>
              <SimpleSelect
                value={draft.polarity}
                onChange={(value) => setDraft({ ...draft, polarity: value as SamplePolarity })}
                options={[{ value: "black", label: t("polarity.black") }, { value: "white", label: t("polarity.white") }]}
              />
            </Field>
            <Field label={t("application")}>
              <SimpleSelect
                value={draft.applicationId || "unset"}
                onChange={(value) => setDraft({ ...draft, applicationId: value === "unset" ? "" : value, channelId: "" })}
                options={[{ value: "unset", label: t("pickDoc") }, ...store.state.applications.map((item) => ({ value: item.id, label: item.name }))]}
              />
            </Field>
            <Field label={t("channel")}>
              <SimpleSelect
                value={draft.channelId || "unset"}
                onChange={(value) => setDraft({ ...draft, channelId: value === "unset" ? "" : value })}
                options={[{ value: "unset", label: t("pickDoc") }, ...channels.map((item) => ({ value: item.id, label: item.name }))]}
              />
            </Field>
          </div>
          <Disclosure title={t("bindLabels")} hint={t("selectedFields", { count: draft.labelIds.length })}>
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
          <Disclosure title={t("resource")} hint={t("selectedFields", { count: draft.capabilityIds.length })}>
            <div className="flex flex-wrap gap-2 text-sm">
              {store.state.capabilities.map((item) => (
                <label key={item.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.capabilityIds.includes(item.id)}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        capabilityIds: draft.capabilityIds.includes(item.id)
                          ? draft.capabilityIds.filter((id) => id !== item.id)
                          : [...draft.capabilityIds, item.id],
                      })
                    }
                  />
                  {item.customName ?? enums(`capabilities.${item.id}`)}
                </label>
              ))}
            </div>
          </Disclosure>
          <Button onClick={save}>{t("save")}</Button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                {[t("caseInput"), t("samplePolarity"), t("bindLabels"), t("resource"), t("application"), t("channel"), ""].map((column) => (
                  <th key={column || "actions"} className="px-3 py-2 font-medium">{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((sample) => (
                <tr key={sample.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{sample.input}</td>
                  <td className="px-3 py-2">{t(`polarity.${sample.polarity}`)}</td>
                  <td className="px-3 py-2 text-slate-600">{names(sample.labelIds, store.state.labels)}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {sample.capabilityIds.map((id) => store.state.capabilities.find((item) => item.id === id)?.customName ?? enums(`capabilities.${id}`)).join(" · ")}
                  </td>
                  <td className="px-3 py-2">{store.state.applications.find((item) => item.id === sample.applicationId)?.name}</td>
                  <td className="px-3 py-2">{store.state.channels.find((item) => item.id === sample.channelId)?.name}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setDraft(sample)}>{t("edit")}</Button>
                    <Button size="sm" variant="outline" className="ml-2" onClick={() => store.deleteSample(sample.id)}>{ops("remove")}</Button>
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
