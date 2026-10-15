"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Loader2 } from "lucide-react";
import { useLeadModal } from "@/components/lead-modal-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CtaBanner() {
  const t = useTranslations("Cta");
  const { openLead } = useLeadModal();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email) return;
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setLoading(false);
    openLead("demo");
  }

  return (
    <section className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl border border-sky-400/25 bg-gradient-to-br from-sky-500/20 via-indigo-500/10 to-slate-950 p-8 sm:p-12">
        <div className="pointer-events-none absolute -top-20 right-0 h-64 w-64 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-sky-300 uppercase">
              {t("eyebrow")}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
              {t("title")}
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
              {t("description")}
            </p>
          </div>
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 backdrop-blur"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                className="h-11 border-white/10 bg-white/5 text-white placeholder:text-slate-500"
              />
              <Button
                type="submit"
                disabled={loading}
                className="h-11 shrink-0 bg-gradient-to-r from-sky-500 to-indigo-500 px-5 text-white glow-btn"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    {t("submit")}
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
