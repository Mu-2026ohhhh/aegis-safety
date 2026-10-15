"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useLeadModal } from "@/components/lead-modal-context";

const RATE_PER_1K = 1.2;
const ENTERPRISE_FLOOR = 2500;

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

function formatMoney(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function PricingCalculator({ locale }: { locale: string }) {
  const t = useTranslations("Pricing");
  const { openLead } = useLeadModal();
  const [calls, setCalls] = useState(500_000);

  const estimate = useMemo(() => {
    const payg = (calls / 1000) * RATE_PER_1K;
    const enterprise = Math.max(ENTERPRISE_FLOOR, payg * 0.72);
    return { payg, enterprise };
  }, [calls]);

  return (
    <section id="pricing" className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8">
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

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="glass-strong rounded-2xl p-6 sm:p-8">
            <p className="text-sm font-medium text-white">{t("calculator")}</p>
            <div className="mt-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs text-slate-500">{t("monthlyCalls")}</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-white">
                  {formatNumber(calls, locale)}
                </p>
              </div>
              <p className="text-sm text-slate-400">
                ${RATE_PER_1K.toFixed(2)} {t("perCall")}
              </p>
            </div>

            <div className="mt-8">
              <Slider
                min={10_000}
                max={5_000_000}
                step={10_000}
                value={[calls]}
                onValueChange={(value) => {
                  const next = Array.isArray(value) ? Number(value[0]) : Number(value);
                  setCalls(Number.isFinite(next) ? next : 10_000);
                }}
              />
              <div className="mt-2 flex justify-between text-[11px] text-slate-500">
                <span>10K</span>
                <span>5M</span>
              </div>
            </div>

            <div className="mt-8 rounded-xl border border-sky-400/25 bg-sky-500/10 p-5">
              <p className="text-xs text-sky-200/80">{t("estimated")}</p>
              <p className="mt-2 text-4xl font-semibold tracking-tight text-white">
                {formatMoney(estimate.payg, locale)}
              </p>
              <p className="mt-2 text-xs text-slate-400">{t("note")}</p>
            </div>
          </div>

          <div className="grid gap-4">
            <TierCard
              name={t("payg")}
              price={formatMoney(estimate.payg, locale)}
              includes={t("includes")}
              highlighted={false}
              cta={t("cta")}
              onCta={() => openLead("demo")}
            />
            <TierCard
              name={t("enterprise")}
              price={formatMoney(estimate.enterprise, locale)}
              includes={t("enterpriseIncludes")}
              highlighted
              cta={t("cta")}
              onCta={() => openLead("demo")}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function TierCard({
  name,
  price,
  includes,
  highlighted,
  cta,
  onCta,
}: {
  name: string;
  price: string;
  includes: string;
  highlighted: boolean;
  cta: string;
  onCta: () => void;
}) {
  return (
    <div
      className={
        highlighted
          ? "rounded-2xl border border-sky-400/40 bg-gradient-to-b from-sky-500/15 to-transparent p-6 shadow-[0_0_40px_rgba(56,189,248,0.12)] transition-transform hover:-translate-y-0.5"
          : "rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-transform hover:-translate-y-0.5"
      }
    >
      <p className="text-sm font-medium text-slate-300">{name}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{price}</p>
      <ul className="mt-4 space-y-2">
        {includes.split(",").map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 text-sm text-slate-400"
          >
            <Check className="mt-0.5 size-4 shrink-0 text-sky-300" />
            {item.trim()}
          </li>
        ))}
      </ul>
      <Button
        onClick={onCta}
        className={
          highlighted
            ? "mt-6 w-full bg-gradient-to-r from-sky-500 to-indigo-500 text-white glow-btn"
            : "mt-6 w-full border border-white/15 bg-white/5 text-white hover:bg-white/10"
        }
        variant={highlighted ? "default" : "outline"}
      >
        {cta}
      </Button>
    </div>
  );
}
