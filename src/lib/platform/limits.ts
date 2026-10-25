/** Shared prototype limits. Docs, Playground, and settings must read this object. */
export const moderationLimits = {
  textMaxChars: 4000,
  imageMaxBytes: 5 * 1024 * 1024,
  imageMimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
  imageExtensions: ["jpg", "jpeg", "png", "webp"] as const,
  requestTimeoutMs: 8000,
  /** Client-side demo quota only. Not a server rate limit. */
  playgroundRequestsPerMinute: 12,
} as const;

export const PLAYGROUND_QUOTA_KEY = "aegis_playground_hits";

export function consumePlaygroundQuota(): {
  ok: boolean;
  retryAfterSec: number;
} {
  if (typeof window === "undefined") return { ok: true, retryAfterSec: 0 };
  const now = Date.now();
  const windowMs = 60_000;
  let hits: number[] = [];
  try {
    const raw = sessionStorage.getItem(PLAYGROUND_QUOTA_KEY);
    hits = raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    hits = [];
  }
  hits = hits.filter((stamp) => now - stamp < windowMs);
  if (hits.length >= moderationLimits.playgroundRequestsPerMinute) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((windowMs - (now - hits[0])) / 1000)
    );
    return { ok: false, retryAfterSec };
  }
  hits.push(now);
  sessionStorage.setItem(PLAYGROUND_QUOTA_KEY, JSON.stringify(hits));
  return { ok: true, retryAfterSec: 0 };
}
