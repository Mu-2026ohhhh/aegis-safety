"use client";

import { useTranslations } from "next-intl";
import { Shield } from "lucide-react";
import { Link } from "@/i18n/navigation";

export function Footer() {
  const t = useTranslations("Footer");
  const tCommon = useTranslations("Common");
  const tNav = useTranslations("Nav");

  const columns = [
    {
      title: t("product"),
      links: [
        { label: tNav("features"), href: "/#features" },
        { label: tNav("sandbox"), href: "/#sandbox" },
        { label: tNav("benchmarks"), href: "/benchmarks" },
        { label: tNav("pricing"), href: "/#pricing" },
      ],
    },
    {
      title: t("solutions"),
      links: [
        { label: "Social Platforms", href: "/#features" },
        { label: "AI Companions", href: "/#features" },
        { label: "Marketplaces", href: "/#features" },
        { label: "Enterprises", href: "/#features" },
      ],
    },
    {
      title: t("resources"),
      links: [
        { label: tNav("benchmarks"), href: "/benchmarks" },
        { label: tNav("dashboard"), href: "/dashboard" },
        { label: "Security", href: "/#features" },
        { label: "Docs", href: "/#sandbox" },
      ],
    },
    {
      title: t("legal"),
      links: [
        { label: "Privacy Policy", href: "/" },
        { label: "Terms of Service", href: "/" },
        { label: "GDPR", href: "/" },
        { label: "DPA", href: "/" },
      ],
    },
  ];

  return (
    <footer className="border-t border-white/10 px-4 pt-16 pb-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500">
                <Shield className="size-4 text-white" />
              </span>
              <span className="font-semibold text-white">{tCommon("brand")}</span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
              {t("blurb")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {columns.map((column) => (
              <div key={column.title}>
                <p className="text-sm font-semibold text-white">{column.title}</p>
                <ul className="mt-3 space-y-2">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-slate-400 transition hover:text-white"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>{t("rights")}</p>
          <p>{t("compliance")}</p>
        </div>
      </div>
    </footer>
  );
}
