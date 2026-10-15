"use client";

import { useTranslations } from "next-intl";
import {
  Bot,
  Fingerprint,
  Globe,
  Layers3,
  ScanSearch,
  Workflow,
} from "lucide-react";

const featureKeys = [
  { key: "multimodal", icon: ScanSearch },
  { key: "policy", icon: Layers3 },
  { key: "compliance", icon: Globe },
  { key: "hitl", icon: Workflow },
  { key: "llm", icon: Bot },
  { key: "identity", icon: Fingerprint },
] as const;

export function Features() {
  const t = useTranslations("Features");

  return (
    <section id="features" className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8">
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

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featureKeys.map(({ key, icon: Icon }) => (
            <div
              key={key}
              className="group h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-all hover:-translate-y-1 hover:border-sky-400/30 hover:bg-sky-500/[0.05]"
            >
              <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500/20 to-indigo-500/10 text-sky-300 ring-1 ring-sky-400/20">
                <Icon className="size-5" />
              </div>
              <h3 className="text-lg font-semibold text-white">
                {t(`items.${key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {t(`items.${key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
