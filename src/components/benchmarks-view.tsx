"use client";

import { useTranslations } from "next-intl";
import { useLeadModal } from "@/components/lead-modal-context";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BENCHMARK_UPDATED_AT, benchmarkRows } from "@/lib/benchmark-data";

export function BenchmarksView() {
  const t = useTranslations("Benchmarks");
  const { openLead } = useLeadModal();

  return (
    <div className="mt-10 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {t("updated")}: {BENCHMARK_UPDATED_AT}
        </p>
        <Button
          onClick={() => openLead("analytics")}
          className="bg-gradient-to-r from-sky-500 to-indigo-500 text-white glow-btn"
        >
          {t("cta")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="text-slate-400">#</TableHead>
              <TableHead className="text-slate-400">{t("model")}</TableHead>
              <TableHead className="text-slate-400">{t("jailbreak")}</TableHead>
              <TableHead className="text-slate-400">{t("sensitive")}</TableHead>
              <TableHead className="text-slate-400">{t("privacy")}</TableHead>
              <TableHead className="text-slate-400">{t("overall")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {benchmarkRows.map((row, index) => (
              <TableRow
                key={row.model}
                className="border-white/5 hover:bg-sky-500/[0.06]"
              >
                <TableCell className="font-medium text-sky-300">
                  {index + 1}
                </TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium text-white">{row.model}</p>
                    <p className="text-xs text-slate-500">{row.provider}</p>
                  </div>
                </TableCell>
                <TableCell className="text-slate-300">{row.jailbreak}</TableCell>
                <TableCell className="text-slate-300">{row.sensitive}</TableCell>
                <TableCell className="text-slate-300">{row.privacy}</TableCell>
                <TableCell>
                  <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-sm font-semibold text-sky-200 ring-1 ring-sky-400/20">
                    {row.overall.toFixed(1)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
