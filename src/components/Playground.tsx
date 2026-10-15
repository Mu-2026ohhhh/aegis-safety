"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Sparkles,
  Timer,
} from "lucide-react";
import { LeadForm } from "@/components/LeadForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  FREE_SANDBOX_LIMIT,
  SANDBOX_UNLOCK_KEY,
  SANDBOX_USAGE_KEY,
  simulateModeration,
  type ModerationResult,
  type ScenarioId,
} from "@/lib/moderation-mock";
import { cn } from "@/lib/utils";

const SCENARIOS: ScenarioId[] = [
  "contraband",
  "hate",
  "violence",
  "jailbreak",
];

function readUsage(): number {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem(SANDBOX_USAGE_KEY);
  return raw ? Number(raw) || 0 : 0;
}

function readUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SANDBOX_UNLOCK_KEY) === "1";
}

export function Playground() {
  const t = useTranslations("Playground");
  const [text, setText] = useState("");
  const [scenario, setScenario] = useState<ScenarioId | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ModerationResult | null>(null);
  const [usage, setUsage] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);

  useEffect(() => {
    setUsage(readUsage());
    setUnlocked(readUnlocked());
  }, []);

  const remaining = useMemo(
    () => Math.max(0, FREE_SANDBOX_LIMIT - usage),
    [usage]
  );

  function applyPreset(id: ScenarioId) {
    setScenario(id);
    setText(t(`samples.${id}`));
    setResult(null);
  }

  async function runDetection() {
    if (!text.trim()) return;

    if (!unlocked && usage >= FREE_SANDBOX_LIMIT) {
      setLeadOpen(true);
      return;
    }

    setLoading(true);
    setResult(null);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const next = simulateModeration(text, scenario);
    setResult(next);
    setLoading(false);

    if (!unlocked) {
      const nextUsage = usage + 1;
      setUsage(nextUsage);
      localStorage.setItem(SANDBOX_USAGE_KEY, String(nextUsage));
      if (nextUsage >= FREE_SANDBOX_LIMIT) {
        setTimeout(() => setLeadOpen(true), 400);
      }
    }
  }

  function handleUnlocked() {
    setUnlocked(true);
    localStorage.setItem(SANDBOX_UNLOCK_KEY, "1");
  }

  return (
    <section
      id="sandbox"
      className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-sky-300/90 uppercase">
            {t("eyebrow")}
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-400 sm:text-lg">
            {t("description")}
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="glass-strong rounded-2xl p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-white">{t("presets")}</p>
              <Badge
                variant="outline"
                className="border-white/15 bg-white/5 text-slate-300"
              >
                {unlocked
                  ? "∞"
                  : t("remaining", { count: remaining })}
              </Badge>
            </div>

            <div className="mb-5 flex flex-wrap gap-2">
              {SCENARIOS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyPreset(id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition",
                    scenario === id
                      ? "border-sky-400/40 bg-sky-500/15 text-sky-200"
                      : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-white"
                  )}
                >
                  {t(`scenarios.${id}`)}
                </button>
              ))}
            </div>

            <label className="mb-2 block text-sm text-slate-300">
              {t("customInput")}
            </label>
            <Textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setScenario(null);
              }}
              placeholder={t("placeholder")}
              className="min-h-36 border-white/10 bg-white/[0.03] text-white placeholder:text-slate-500"
            />

            <Button
              size="lg"
              onClick={runDetection}
              disabled={loading || !text.trim()}
              className="mt-4 h-11 w-full bg-gradient-to-r from-sky-500 to-indigo-500 text-white glow-btn hover:from-sky-400 hover:to-indigo-400"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("analyzing")}
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  {t("runTest")}
                </>
              )}
            </Button>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent p-5 sm:p-6">
            <div className="pointer-events-none absolute -top-16 right-0 h-40 w-40 rounded-full bg-sky-500/20 blur-3xl" />

            {!result && !loading ? (
              <div className="flex h-full min-h-72 flex-col items-center justify-center text-center text-slate-500">
                <ShieldAlert className="mb-3 size-8 text-slate-600" />
                <p className="text-sm">Run a preset or paste content to see results.</p>
              </div>
            ) : null}

            {loading ? (
              <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-slate-300">
                <Loader2 className="size-8 animate-spin text-sky-300" />
                <p className="text-sm">{t("analyzing")}</p>
              </div>
            ) : null}

            {result && !loading ? (
              <div className="relative space-y-5">
                <div
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ring-1",
                    result.decision === "passed"
                      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30"
                      : "bg-rose-500/15 text-rose-300 ring-rose-400/30"
                  )}
                >
                  {result.decision === "passed" ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <AlertTriangle className="size-4" />
                  )}
                  {result.decision === "passed" ? t("passed") : t("blocked")}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Timer className="size-3.5" />
                      {t("latency")}
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-white">
                      {result.latencyMs}
                      <span className="ml-1 text-sm font-normal text-slate-400">
                        ms
                      </span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-xs text-slate-500">Risk score</p>
                    <p className="mt-1 text-2xl font-semibold text-white">
                      {Math.round(result.overallRisk * 100)}%
                    </p>
                  </div>
                </div>

                <div>
                  <p className="mb-3 text-sm font-medium text-white">
                    {t("riskBreakdown")}
                  </p>
                  <div className="space-y-3">
                    {result.breakdown.map((item) => (
                      <div key={item.label}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-slate-400">{item.label}</span>
                          <span className="text-slate-300">
                            {Math.round(item.score * 100)}%
                          </span>
                        </div>
                        <Progress
                          value={item.score * 100}
                          className="h-1.5 bg-white/10"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-sky-400/20 bg-sky-500/10 px-4 py-3">
                  <p className="text-xs text-sky-200/80">{t("matchedPolicy")}</p>
                  <p className="mt-1 text-sm font-medium text-sky-100">
                    {result.matchedPolicy}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <LeadForm
        open={leadOpen}
        onOpenChange={setLeadOpen}
        defaultIntent="sandbox"
        title={t("unlockTitle")}
        description={t("unlockDescription")}
        onSuccess={handleUnlocked}
      />
    </section>
  );
}
