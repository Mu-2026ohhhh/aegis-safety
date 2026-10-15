"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDownToLine,
  Bot,
  Filter,
  RefreshCcw,
  Shield,
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import {
  generateModerationLogs,
  riskDistribution,
  trendSeries,
  type DashboardAction,
  type ModerationLog,
  type RiskLevel,
} from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

const PIE_COLORS = [
  "#38bdf8",
  "#818cf8",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#94a3b8",
];

type SortKey = "timestamp" | "score" | "latencyMs";

export function DashboardConsole() {
  const t = useTranslations("Dashboard");
  const logs = useMemo(() => generateModerationLogs(120), []);
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDesc, setSortDesc] = useState(true);
  const [riskLevel, setRiskLevel] = useState("all");
  const [category, setCategory] = useState("all");
  const [action, setAction] = useState("all");
  const [model, setModel] = useState("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const rows = logs.filter((row) => {
      if (riskLevel !== "all" && row.riskLevel !== riskLevel) return false;
      if (category !== "all" && row.category !== category) return false;
      if (action !== "all" && row.action !== action) return false;
      if (model !== "all" && row.model !== model) return false;
      return true;
    });

    return [...rows].sort((a, b) => {
      const direction = sortDesc ? -1 : 1;
      if (sortKey === "timestamp") {
        return (
          (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) *
          direction
        );
      }
      return (a[sortKey] - b[sortKey]) * direction;
    });
  }, [logs, riskLevel, category, action, model, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc((prev) => !prev);
      return;
    }
    setSortKey(key);
    setSortDesc(true);
  }

  function exportData(format: "csv" | "json") {
    if (format === "json") {
      downloadBlob(
        new Blob([JSON.stringify(filtered, null, 2)], {
          type: "application/json",
        }),
        "aegis-moderation-logs.json"
      );
      return;
    }

    const header = [
      "id",
      "timestamp",
      "category",
      "riskLevel",
      "score",
      "action",
      "model",
      "latencyMs",
    ];
    const body = filtered
      .map((row) =>
        [
          row.id,
          row.timestamp,
          row.category,
          row.riskLevel,
          row.score,
          row.action,
          row.model,
          row.latencyMs,
        ].join(",")
      )
      .join("\n");
    downloadBlob(
      new Blob([[header.join(","), body].join("\n")], { type: "text/csv" }),
      "aegis-moderation-logs.csv"
    );
  }

  const categories = Array.from(new Set(logs.map((l) => l.category)));
  const models = Array.from(new Set(logs.map((l) => l.model)));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500">
              <Shield className="size-4 text-white" />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">{t("title")}</p>
              <p className="text-xs text-slate-500">{t("badge")}</p>
            </div>
          </div>
          <Link
            href="/"
            className="text-sm text-sky-300 transition hover:text-sky-200"
          >
            {t("backHome")}
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {t("title")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            {t("description")}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={t("trend")}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendSeries}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="day" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="violations"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t("distribution")}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={riskDistribution}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                >
                  {riskDistribution.map((entry, index) => (
                    <Cell
                      key={entry.name}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Filter className="size-4 text-sky-300" />
              {t("filters")}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-white/15 bg-transparent text-slate-200"
                onClick={() => exportData("csv")}
              >
                <ArrowDownToLine className="size-3.5" />
                {t("exportCsv")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-white/15 bg-transparent text-slate-200"
                onClick={() => exportData("json")}
              >
                <ArrowDownToLine className="size-3.5" />
                {t("exportJson")}
              </Button>
              <Button
                size="sm"
                className="bg-sky-500/20 text-sky-100 hover:bg-sky-500/30"
              >
                <RefreshCcw className="size-3.5" />
                {t("requeue")}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              label={t("riskLevel")}
              value={riskLevel}
              onChange={setRiskLevel}
              options={["all", "low", "medium", "high", "critical"]}
              allLabel={t("all")}
            />
            <FilterSelect
              label={t("category")}
              value={category}
              onChange={setCategory}
              options={["all", ...categories]}
              allLabel={t("all")}
            />
            <FilterSelect
              label={t("action")}
              value={action}
              onChange={setAction}
              options={["all", "pass", "block", "review"]}
              allLabel={t("all")}
            />
            <FilterSelect
              label={t("model")}
              value={model}
              onChange={setModel}
              options={["all", ...models]}
              allLabel={t("all")}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <p className="text-sm font-medium text-white">{t("logs")}</p>
            <p className="text-xs text-slate-500">
              {t("rows", { count: filtered.length })}
            </p>
          </div>
          <div className="max-h-[480px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur">
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="w-10" />
                  <SortableHead
                    label={t("timestamp")}
                    active={sortKey === "timestamp"}
                    onClick={() => toggleSort("timestamp")}
                  />
                  <TableHead className="text-slate-400">ID</TableHead>
                  <TableHead className="text-slate-400">{t("content")}</TableHead>
                  <TableHead className="text-slate-400">{t("category")}</TableHead>
                  <TableHead className="text-slate-400">{t("riskLevel")}</TableHead>
                  <SortableHead
                    label={t("score")}
                    active={sortKey === "score"}
                    onClick={() => toggleSort("score")}
                  />
                  <TableHead className="text-slate-400">{t("action")}</TableHead>
                  <TableHead className="text-slate-400">{t("model")}</TableHead>
                  <SortableHead
                    label={t("latency")}
                    active={sortKey === "latencyMs"}
                    onClick={() => toggleSort("latencyMs")}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <LogRow
                    key={row.id}
                    row={row}
                    checked={Boolean(selected[row.id])}
                    onCheck={(checked) =>
                      setSelected((prev) => ({ ...prev, [row.id]: checked }))
                    }
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="rounded-2xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/10 to-transparent p-6">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/30">
              <Bot className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                {t("redTeam")}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                {t("redTeamDesc")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: "#0f172a",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12,
};

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="mb-3 text-sm font-medium text-white">{title}</p>
      <div className="h-56">{children}</div>
    </div>
  );
}

function SortableHead({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <TableHead
      className={cn(
        "cursor-pointer whitespace-nowrap text-slate-400 hover:text-white",
        active && "text-sky-300"
      )}
      onClick={onClick}
    >
      {label}
    </TableHead>
  );
}

function LogRow({
  row,
  checked,
  onCheck,
}: {
  row: ModerationLog;
  checked: boolean;
  onCheck: (checked: boolean) => void;
}) {
  return (
    <TableRow className="border-white/5 hover:bg-white/[0.03]">
      <TableCell>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheck(event.target.checked)}
          className="size-3.5 accent-sky-400"
        />
      </TableCell>
      <TableCell className="whitespace-nowrap text-slate-300">
        {new Date(row.timestamp).toLocaleString(undefined, {
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </TableCell>
      <TableCell className="text-slate-300">{row.id}</TableCell>
      <TableCell>
        <span className="line-clamp-1 max-w-[220px] text-slate-300">
          {row.content}
        </span>
      </TableCell>
      <TableCell className="text-slate-300">{row.category}</TableCell>
      <TableCell>
        <RiskBadge level={row.riskLevel} />
      </TableCell>
      <TableCell className="text-slate-300">
        {Math.round(row.score * 100)}%
      </TableCell>
      <TableCell>
        <ActionBadge action={row.action} />
      </TableCell>
      <TableCell className="text-slate-300">{row.model}</TableCell>
      <TableCell className="text-slate-300">{row.latencyMs}ms</TableCell>
    </TableRow>
  );
}

function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize",
        level === "critical" &&
          "border-rose-400/30 bg-rose-500/10 text-rose-300",
        level === "high" &&
          "border-amber-400/30 bg-amber-500/10 text-amber-300",
        level === "medium" && "border-sky-400/30 bg-sky-500/10 text-sky-300",
        level === "low" &&
          "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
      )}
    >
      {level}
    </Badge>
  );
}

function ActionBadge({ action }: { action: DashboardAction }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs capitalize ring-1",
        action === "block" && "bg-rose-500/10 text-rose-300 ring-rose-400/20",
        action === "review" &&
          "bg-amber-500/10 text-amber-300 ring-amber-400/20",
        action === "pass" &&
          "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
      )}
    >
      {action}
    </span>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-500">{label}</p>
      <Select value={value} onValueChange={(next) => onChange(String(next))}>
        <SelectTrigger className="w-full border-white/10 bg-white/5 text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-white/10 bg-slate-950 text-slate-100">
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option === "all" ? allLabel : option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
