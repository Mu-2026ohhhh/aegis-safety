"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Menu, Shield, X } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/products", key: "products" },
  { href: "/use-cases", key: "useCases" },
  { href: "/docs", key: "docs" },
  { href: "/playground", key: "playground" },
  { href: "/pricing", key: "pricing" },
] as const;

export function PublicShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("PublicNav");
  const site = useTranslations("Site");
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Shield className="size-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">{site("brand")}</span>
          </Link>
          <nav className="hidden items-center gap-6 lg:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-slate-600 hover:text-slate-950"
              >
                {t(link.key)}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <LanguageSwitcher tone="light" />
            <Button variant="outline" render={<Link href="/console" />}>
              {t("console")}
            </Button>
            <Button variant="ghost" render={<Link href="/login" />}>
              {t("login")}
            </Button>
            <Button render={<Link href="/playground" />}>{t("startTesting")}</Button>
          </div>
          <div className="flex items-center gap-2 lg:hidden">
            <LanguageSwitcher tone="light" />
            <button
              type="button"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200"
              onClick={() => setOpen((value) => !value)}
              aria-label={t("menu")}
            >
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
        {open ? (
          <div className="border-t border-slate-200 px-4 py-3 lg:hidden">
            <div className="flex flex-col gap-2">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {t(link.key)}
                </Link>
              ))}
              <Link href="/console" onClick={() => setOpen(false)} className="px-2 py-2 text-sm">
                {t("console")}
              </Link>
              <Link href="/login" onClick={() => setOpen(false)} className="px-2 py-2 text-sm">
                {t("login")}
              </Link>
              <Button render={<Link href="/playground" />} onClick={() => setOpen(false)}>
                {t("startTesting")}
              </Button>
            </div>
          </div>
        ) : null}
      </header>
      <main>{children}</main>
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-1">
            <p className="text-sm font-semibold">{site("brand")}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{site("footerBlurb")}</p>
          </div>
          <FooterColumn
            title={t("product")}
            items={[
              ["/products", t("products")],
              ["/use-cases", t("useCases")],
              ["/pricing", t("pricing")],
              ["/contact", t("contact")],
            ]}
          />
          <FooterColumn
            title={t("developers")}
            items={[
              ["/docs", t("docs")],
              ["/docs/quickstart", t("quickstart")],
              ["/playground", t("playground")],
              ["/docs/errors", t("errors")],
            ]}
          />
          <div>
            <p className="text-sm font-medium text-slate-900">{t("language")}</p>
            <div className="mt-3">
              <LanguageSwitcher tone="light" />
            </div>
            <div className="mt-4 flex flex-col gap-2 text-sm text-slate-600">
              <Link href="/privacy" className="hover:text-slate-950">
                {t("privacy")}
              </Link>
              <Link href="/terms" className="hover:text-slate-950">
                {t("terms")}
              </Link>
            </div>
          </div>
        </div>
        <div className="border-t border-slate-200 px-4 py-4 text-xs text-slate-500 sm:px-6">
          <div className="mx-auto max-w-6xl">{site("rights")}</div>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({
  title,
  items,
}: {
  title: string;
  items: Array<[string, string]>;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <div className="mt-3 flex flex-col gap-2">
        {items.map(([href, label]) => (
          <Link key={href} href={href} className={cn("text-sm text-slate-600 hover:text-slate-950")}>
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
