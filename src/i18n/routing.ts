import { defineRouting } from "next-intl/routing";

export const locales = ["en", "es", "zh"] as const;
export type Locale = (typeof locales)[number];

export const localeLabels: Record<
  Locale,
  { label: string; short: string; flag: string }
> = {
  en: { label: "English", short: "EN", flag: "🇺🇸" },
  es: { label: "Español", short: "ES", flag: "🇪🇸" },
  zh: { label: "简体中文", short: "中文", flag: "🇨🇳" },
};

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  localePrefix: "always",
  localeCookie: {
    name: "NEXT_LOCALE",
    maxAge: 60 * 60 * 24 * 365,
  },
});
