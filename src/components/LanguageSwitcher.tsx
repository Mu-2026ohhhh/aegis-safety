"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { Check, Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePathname, useRouter } from "@/i18n/navigation";
import { localeLabels, locales, type Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "aegis_preferred_locale";

export function LanguageSwitcher({
  className,
  tone = "dark",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  const t = useTranslations("Common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function switchLocale(next: Locale) {
    if (next === locale) return;

    try {
      localStorage.setItem(STORAGE_KEY, next);
      document.cookie = `NEXT_LOCALE=${next};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    } catch {
      // ignore storage failures
    }

    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  const current = localeLabels[locale];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        aria-label={t("language")}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-sky-400/40",
          tone === "light"
            ? "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            : "text-slate-300 hover:bg-white/5 hover:text-white",
          className
        )}
      >
        <Languages className="size-3.5" />
        <span className="hidden sm:inline" aria-hidden>
          {current.flag}
        </span>
        <span>{current.short}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn(
          "min-w-40 backdrop-blur-xl",
          tone === "light"
            ? "border-slate-200 bg-white text-slate-900"
            : "border-white/10 bg-slate-950/95 text-slate-100"
        )}
      >
        {locales.map((code) => {
          const item = localeLabels[code];
          const active = code === locale;
          return (
            <DropdownMenuItem
              key={code}
              onClick={() => switchLocale(code)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3",
                tone === "light" ? "focus:bg-slate-100" : "focus:bg-white/10"
              )}
            >
              <span className="flex items-center gap-2">
                <span aria-hidden>{item.flag}</span>
                <span>{item.label}</span>
              </span>
              {active ? <Check className="size-3.5 text-sky-300" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
