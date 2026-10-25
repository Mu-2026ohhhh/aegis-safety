import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const core = (await import(`../../messages/${locale}.json`)).default;
  const platform = (await import(`../../messages/platform/${locale}.json`)).default;

  return {
    locale,
    messages: deepMerge(core, platform),
  };
});

function deepMerge(
  base: Record<string, unknown>,
  extra: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(extra)) {
    const next = extra[key];
    const prev = out[key];
    if (
      prev &&
      next &&
      typeof prev === "object" &&
      typeof next === "object" &&
      !Array.isArray(prev) &&
      !Array.isArray(next)
    ) {
      out[key] = deepMerge(
        prev as Record<string, unknown>,
        next as Record<string, unknown>
      );
    } else {
      out[key] = next;
    }
  }
  return out;
}
