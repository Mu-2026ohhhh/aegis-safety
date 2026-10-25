export function createId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}_${rand}${time}`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue(record[key]);
        return acc;
      }, {});
  }
  return value;
}

export function fingerprint(value: unknown): string {
  const json = JSON.stringify(sortValue(value));
  let hash = 2166136261;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(16)}`;
}

export function intlLocale(locale: string): string {
  if (locale === "zh") return "zh-CN";
  return locale;
}

export function formatDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

export function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) {
    return `${formatNumber(bytes, locale)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${formatNumber(Math.round((bytes / 1024) * 10) / 10, locale)} KB`;
  }
  return `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10, locale)} MB`;
}
