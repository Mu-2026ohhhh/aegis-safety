"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PublicShell } from "@/components/platform/public-shell";
import { CodeBlock, Field, PrototypeBanner } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import { contractExamples, prettyJson } from "@/lib/platform/moderation";

export function ProductsView() {
  const t = useTranslations("Products");
  const items = t.raw("items") as Array<{
    title: string;
    description: string;
    points: string[];
  }>;
  return (
    <PublicShell>
      <PageIntro eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-16 sm:px-6">
        {items.map((item) => (
          <article key={item.title} className="rounded-xl border border-slate-200 p-5">
            <h2 className="text-lg font-semibold">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.description}</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {item.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </article>
        ))}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <h2 className="text-base font-semibold">{t("exampleTitle")}</h2>
          <p className="mt-2 text-sm text-slate-600">{t("exampleBody")}</p>
          <div className="mt-4">
            <CodeBlock code={prettyJson(contractExamples.textResponse)} label="JSON" />
          </div>
        </div>
      </div>
    </PublicShell>
  );
}

export function UseCasesView() {
  const t = useTranslations("UseCases");
  const items = t.raw("items") as Array<{ title: string; description: string; stack: string }>;
  return (
    <PublicShell>
      <PageIntro eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <div className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 sm:px-6 md:grid-cols-2">
        {items.map((item) => (
          <article key={item.title} className="rounded-xl border border-slate-200 p-5">
            <h2 className="text-lg font-semibold">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.description}</p>
            <p className="mt-3 text-sm text-slate-800">{item.stack}</p>
          </article>
        ))}
      </div>
    </PublicShell>
  );
}

export function PricingView() {
  const t = useTranslations("PricingPage");
  const plans = t.raw("plans") as Array<{ name: string; audience: string; points: string[] }>;
  return (
    <PublicShell>
      <PageIntro eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <PrototypeBanner>{t("demoNotice")}</PrototypeBanner>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => (
            <article key={plan.name} className="rounded-xl border border-slate-200 p-5">
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="mt-1 text-sm text-slate-500">{plan.audience}</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                {plan.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <Button className="mt-5 w-full" variant="outline" render={<Link href="/contact" />}>
                {t("contactSales")}
              </Button>
            </article>
          ))}
        </div>
      </div>
    </PublicShell>
  );
}

export function ContactView() {
  const t = useTranslations("Contact");
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [need, setNeed] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: string[] = [];
    if (!company.trim()) next.push("company");
    if (!name.trim()) next.push("name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.push("email");
    if (need.trim().length < 12) next.push("need");
    setErrors(next);
    setDone(next.length === 0);
  }

  return (
    <PublicShell>
      <PageIntro eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <div className="mx-auto max-w-xl px-4 pb-16 sm:px-6">
        <PrototypeBanner>{t("demoNotice")}</PrototypeBanner>
        {done ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-medium">{t("successTitle")}</p>
            <p className="mt-1">{t("successBody")}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
            <Field label={t("company")} error={errors.includes("company") ? t("companyError") : undefined}>
              <Input value={company} onChange={(event) => setCompany(event.target.value)} />
            </Field>
            <Field label={t("name")} error={errors.includes("name") ? t("nameError") : undefined}>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label={t("email")} error={errors.includes("email") ? t("emailError") : undefined}>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label={t("need")} error={errors.includes("need") ? t("needError") : undefined}>
              <Textarea value={need} onChange={(event) => setNeed(event.target.value)} />
            </Field>
            <Button type="submit">{t("submit")}</Button>
          </form>
        )}
      </div>
    </PublicShell>
  );
}

export function LegalView({ kind }: { kind: "privacy" | "terms" }) {
  const t = useTranslations("Legal");
  const paragraphs = t.raw(`${kind}.paragraphs`) as string[];
  return (
    <PublicShell>
      <PageIntro eyebrow={t("eyebrow")} title={t(`${kind}.title`)} description={t(`${kind}.description`)} />
      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-16 text-sm leading-relaxed text-slate-700 sm:px-6">
        <PrototypeBanner>{t("placeholder")}</PrototypeBanner>
        {paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </PublicShell>
  );
}

function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <p className="text-sm font-medium text-blue-700">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-3xl text-base leading-relaxed text-slate-600">{description}</p>
    </div>
  );
}
