"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Play, Terminal } from "lucide-react";
import { useLeadModal } from "@/components/lead-modal-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const CURL = `curl -X POST https://api.aegis.safety/v1/moderate \\
  -H "Authorization: Bearer $AEGIS_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"Check this message","modalities":["text"]}'`;

const PYTHON = `from aegis import SafetyClient

client = SafetyClient(api_key="...")
result = client.moderate(
    text="Check this message",
    modalities=["text"],
)
print(result.decision, result.latency_ms)`;

export function Hero() {
  const t = useTranslations("Hero");
  const tNav = useTranslations("Nav");
  const { openLead } = useLeadModal();
  const [codeTab, setCodeTab] = useState("curl");

  return (
    <section className="relative overflow-hidden px-4 pt-16 pb-16 sm:px-6 sm:pt-24 lg:px-8">
      <div className="pointer-events-none absolute inset-0 grid-fade" />
      <div className="pointer-events-none absolute top-0 left-1/2 h-[480px] w-[780px] -translate-x-1/2 rounded-full bg-sky-500/15 blur-[120px]" />

      <div className="relative mx-auto max-w-6xl">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex animate-in fade-in slide-in-from-bottom-2 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 duration-500 backdrop-blur fill-mode-both">
            <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-sky-300 uppercase">
              New
            </span>
            {t("badge")}
          </div>

          <h1 className="animate-in fade-in slide-in-from-bottom-3 text-4xl font-semibold tracking-tight text-balance text-white duration-700 fill-mode-both sm:text-5xl lg:text-6xl">
            {t("title")}
          </h1>

          <p className="mx-auto mt-6 max-w-2xl animate-in fade-in slide-in-from-bottom-3 text-base leading-relaxed text-pretty text-slate-400 duration-700 delay-100 fill-mode-both sm:text-lg">
            {t("subtitle")}
          </p>

          <div className="mt-8 flex animate-in fade-in slide-in-from-bottom-3 flex-col items-center justify-center gap-3 duration-700 delay-150 fill-mode-both sm:flex-row">
            <Button
              size="lg"
              onClick={() => openLead("demo")}
              className="h-11 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-6 text-white glow-btn hover:from-sky-400 hover:to-indigo-400"
            >
              {t("ctaDemo")}
              <ArrowRight className="size-4" />
            </Button>
            <a
              href="#sandbox"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-11 rounded-xl border-white/15 bg-white/5 px-6 text-white hover:bg-white/10"
              )}
            >
              <Play className="size-4" />
              {t("ctaSandbox")}
            </a>
          </div>

          <div className="mt-4 animate-in fade-in duration-700 delay-200 fill-mode-both">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-sm text-sky-300 transition hover:text-sky-200"
            >
              {tNav("viewDashboard")}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>

        <div className="relative mx-auto mt-14 max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 fill-mode-both">
          <div className="absolute -inset-4 rounded-3xl bg-gradient-to-r from-sky-500/15 via-indigo-500/10 to-violet-500/15 blur-2xl" />
          <div className="glass-strong relative overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <Terminal className="size-4 text-sky-300" />
                {t("apiLabel")}
              </div>
              <Tabs
                value={codeTab}
                onValueChange={(value) => setCodeTab(String(value))}
              >
                <TabsList className="h-8 bg-white/5">
                  <TabsTrigger value="curl" className="text-xs">
                    {t("codeCurl")}
                  </TabsTrigger>
                  <TabsTrigger value="python" className="text-xs">
                    {t("codePython")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Tabs
              value={codeTab}
              onValueChange={(value) => setCodeTab(String(value))}
            >
              <TabsContent value="curl">
                <pre className="overflow-x-auto p-4 text-left font-mono text-[12px] leading-relaxed text-sky-100/90 sm:text-[13px]">
                  <code>{CURL}</code>
                </pre>
              </TabsContent>
              <TabsContent value="python">
                <pre className="overflow-x-auto p-4 text-left font-mono text-[12px] leading-relaxed text-sky-100/90 sm:text-[13px]">
                  <code>{PYTHON}</code>
                </pre>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </section>
  );
}
