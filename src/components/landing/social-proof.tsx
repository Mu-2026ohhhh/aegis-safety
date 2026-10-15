"use client";

import { useTranslations } from "next-intl";
import { BadgeCheck, Building2, Globe2, ShieldCheck } from "lucide-react";

const logos = [
  "Northwind Labs",
  "Atlas Social",
  "Helix AI",
  "Cascade Media",
  "Vertex Cloud",
  "Orbit Markets",
];

export function SocialProof() {
  const t = useTranslations("SocialProof");

  const badges = [
    { icon: ShieldCheck, label: t("soc2") },
    { icon: BadgeCheck, label: t("gdpr") },
    { icon: Globe2, label: t("euAiAct") },
    { icon: Building2, label: t("sso") },
  ];

  return (
    <section className="relative border-y border-white/10 bg-white/[0.02] px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-center text-sm text-slate-400">{t("tagline")}</p>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {logos.map((logo) => (
            <div
              key={logo}
              className="flex h-14 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03] px-3 text-sm font-medium tracking-wide text-slate-500"
            >
              {logo}
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {badges.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-300"
            >
              <Icon className="size-3.5 text-sky-300" />
              {label}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
