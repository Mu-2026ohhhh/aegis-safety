export type DashboardAction = "pass" | "block" | "review";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ModerationLog = {
  id: string;
  timestamp: string;
  content: string;
  category: string;
  riskLevel: RiskLevel;
  score: number;
  confidence: number;
  action: DashboardAction;
  model: string;
  latencyMs: number;
};

const categories = [
  "Hate speech",
  "Violence",
  "Sexual content",
  "Spam",
  "Jailbreak",
  "PII",
  "Self-harm",
] as const;

const models = ["gpt-4o-guard", "aegis-mm-v3", "claude-mod-lite", "llama-safety"] as const;
const actions: DashboardAction[] = ["pass", "block", "review"];
const levels: RiskLevel[] = ["low", "medium", "high", "critical"];

function seeded(n: number) {
  const x = Math.sin(n + 1) * 10000;
  return x - Math.floor(x);
}

export function generateModerationLogs(count = 120): ModerationLog[] {
  const now = Date.UTC(2026, 2, 10, 12, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const r = seeded(index);
    const score = Math.round((0.05 + r * 0.94) * 100) / 100;
    const riskLevel =
      score > 0.85
        ? "critical"
        : score > 0.65
          ? "high"
          : score > 0.35
            ? "medium"
            : "low";
    const action =
      riskLevel === "critical" || riskLevel === "high"
        ? actions[Math.floor(seeded(index + 3) * 2) + 1]
        : actions[Math.floor(seeded(index + 5) * 3)];

    return {
      id: `EVT-${94800 + index}`,
      timestamp: new Date(now - index * 1000 * 60 * (8 + (index % 5))).toISOString(),
      content: `Sample moderated payload #${index + 1} — multimodal envelope preview.`,
      category: categories[index % categories.length],
      riskLevel: riskLevel as RiskLevel,
      score,
      confidence: Math.round((0.7 + seeded(index + 7) * 0.29) * 100) / 100,
      action,
      model: models[index % models.length],
      latencyMs: Math.round(120 + seeded(index + 11) * 180),
    };
  });
}

export const trendSeries = [
  { day: "Mon", violations: 420 },
  { day: "Tue", violations: 510 },
  { day: "Wed", violations: 460 },
  { day: "Thu", violations: 580 },
  { day: "Fri", violations: 640 },
  { day: "Sat", violations: 390 },
  { day: "Sun", violations: 350 },
];

export const riskDistribution = [
  { name: "Hate", value: 28 },
  { name: "Violence", value: 18 },
  { name: "Jailbreak", value: 16 },
  { name: "Spam", value: 14 },
  { name: "PII", value: 12 },
  { name: "Other", value: 12 },
];
