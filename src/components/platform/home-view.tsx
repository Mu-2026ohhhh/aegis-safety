"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { PublicShell } from "@/components/platform/public-shell";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export function HomeView() {
  const t = useTranslations("Home");
  const nav = useTranslations("PublicNav");
  const capabilities = t.raw("capabilities") as Array<{ title: string; description: string }>;
  const scenes = t.raw("scenes") as Array<{ title: string; description: string }>;
  const steps = t.raw("steps") as string[];

  return (
    <PublicShell>
      <section className="bg-zinc-950 text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-zinc-400 uppercase">{t("eyebrow")}</p>
            <h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {t("title")}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-300">{t("subtitle")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" className="h-10 bg-white px-4 text-zinc-950 hover:bg-zinc-200" render={<Link href="/playground" />}>
                {nav("tryPlayground")}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-10 border-white/20 bg-transparent px-4 text-white hover:bg-white/10"
                render={<Link href="/docs" />}
              >
                {nav("readDocs")}
              </Button>
            </div>
            <p className="mt-4 max-w-xl text-sm text-zinc-500">{t("mockNotice")}</p>
          </div>
          <article className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>{t("previewKicker")}</span>
              <span>{t("previewMock")}</span>
            </div>
            <p className="mt-4 text-base leading-relaxed text-zinc-100">{t("previewSample")}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {(t.raw("previewChips") as Array<{ label: string; score: string }>).map((chip) => (
                <span key={chip.label} className="rounded-full bg-black/30 px-2.5 py-1 text-xs">
                  {chip.label}
                  <span className="ml-2 text-zinc-400">{chip.score}</span>
                </span>
              ))}
            </div>
            <div className="mt-6 border-t border-white/10 pt-4">
              <p className="text-xs text-zinc-500">{t("previewDecisionLabel")}</p>
              <p className="mt-1 text-sm font-medium">{t("previewDecision")}</p>
            </div>
          </article>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-8 md:grid-cols-3">
          {(t.raw("stages") as Array<{ kicker: string; title: string; body: string }>).map((stage) => (
            <article key={stage.title}>
              <p className="text-xs font-medium tracking-[0.16em] text-zinc-500 uppercase">{stage.kicker}</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">{stage.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">{stage.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">{t("capabilitiesTitle")}</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">{t("capabilitiesIntro")}</p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {capabilities.map((item) => (
              <article key={item.title} className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-base font-medium">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.description}</p>
              </article>
            ))}
          </div>
          <Link
            href="/products"
            className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-blue-700"
          >
            {t("viewProducts")} <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight">{t("scenesTitle")}</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">{t("scenesIntro")}</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {scenes.map((item) => (
            <article key={item.title} className="rounded-xl border border-slate-200 p-5">
              <h3 className="text-base font-medium">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">{t("flowTitle")}</h2>
          <ol className="mt-8 grid gap-3 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-blue-700">
                  {t("stepLabel", { index: index + 1 })}
                </p>
                <p className="mt-2 text-sm text-slate-800">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </PublicShell>
  );
}
