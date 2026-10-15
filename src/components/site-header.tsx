"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Menu, Shield, X } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLeadModal } from "@/components/lead-modal-context";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const t = useTranslations("Nav");
  const tCommon = useTranslations("Common");
  const { openLead } = useLeadModal();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { href: "/#features", label: t("features") },
    { href: "/#sandbox", label: t("sandbox") },
    { href: "/benchmarks", label: t("benchmarks") },
    { href: "/#pricing", label: t("pricing") },
  ] as const;

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full transition-all duration-300",
        scrolled
          ? "border-b border-white/10 bg-slate-950/75 backdrop-blur-xl"
          : "bg-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 shadow-[0_0_24px_rgba(56,189,248,0.35)]">
            <Shield className="size-4 text-white" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-white sm:text-base">
            {tCommon("brand")}
          </span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-slate-300 transition-colors hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <LanguageSwitcher />
          <Button
            variant="ghost"
            className="text-slate-300 hover:bg-white/5 hover:text-white"
          >
            {t("logIn")}
          </Button>
          <Button
            onClick={() => openLead("demo")}
            className="bg-gradient-to-r from-sky-500 to-indigo-500 text-white glow-btn hover:from-sky-400 hover:to-indigo-400"
          >
            {t("bookDemo")}
          </Button>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <LanguageSwitcher />
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-lg border border-white/10 text-white"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="border-t border-white/10 bg-slate-950/95 px-4 py-4 backdrop-blur-xl md:hidden">
          <div className="flex flex-col gap-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
            >
              {t("dashboard")}
            </Link>
            <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-3">
              <Button
                variant="outline"
                className="border-white/15 bg-transparent text-white"
              >
                {t("logIn")}
              </Button>
              <Button
                onClick={() => {
                  setMobileOpen(false);
                  openLead("demo");
                }}
                className="bg-gradient-to-r from-sky-500 to-indigo-500 text-white"
              >
                {t("bookDemo")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
