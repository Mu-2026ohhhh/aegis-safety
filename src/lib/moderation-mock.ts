export type ScenarioId = "contraband" | "hate" | "violence" | "jailbreak";

export type RiskBreakdown = {
  label: string;
  score: number;
};

export type ModerationResult = {
  decision: "passed" | "blocked";
  latencyMs: number;
  overallRisk: number;
  breakdown: RiskBreakdown[];
  matchedPolicy: string;
};

const scenarioResults: Record<ScenarioId, Omit<ModerationResult, "latencyMs">> = {
  contraband: {
    decision: "blocked",
    overallRisk: 0.91,
    breakdown: [
      { label: "Illicit goods", score: 0.93 },
      { label: "Fraud intent", score: 0.72 },
      { label: "PII exposure", score: 0.12 },
    ],
    matchedPolicy: "POL-ILLICIT-TRADE · DSA Art. 16",
  },
  hate: {
    decision: "blocked",
    overallRisk: 0.88,
    breakdown: [
      { label: "Hate / discrimination", score: 0.9 },
      { label: "Harassment", score: 0.64 },
      { label: "Toxicity", score: 0.81 },
    ],
    matchedPolicy: "POL-HATE-SPEECH · EU DSA",
  },
  violence: {
    decision: "blocked",
    overallRisk: 0.94,
    breakdown: [
      { label: "Self-harm", score: 0.95 },
      { label: "Violence", score: 0.78 },
      { label: "Crisis escalation", score: 0.86 },
    ],
    matchedPolicy: "POL-SELF-HARM · Crisis protocol",
  },
  jailbreak: {
    decision: "blocked",
    overallRisk: 0.86,
    breakdown: [
      { label: "Prompt injection", score: 0.92 },
      { label: "Policy override", score: 0.84 },
      { label: "System leakage", score: 0.71 },
    ],
    matchedPolicy: "POL-JAILBREAK · AI Safety Guardrail",
  },
};

function hashText(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function simulateModeration(
  text: string,
  scenario?: ScenarioId | null
): ModerationResult {
  const latencyMs = 140 + (hashText(text) % 120);

  if (scenario && scenarioResults[scenario]) {
    return { ...scenarioResults[scenario], latencyMs };
  }

  const lower = text.toLowerCase();
  const jailbreakHints = [
    "ignore all",
    "system prompt",
    "jailbreak",
    "bypass",
    "忽略",
    "system prompt",
  ];
  const hateHints = ["inferior", "hate", "odio", "歧视", "低人一等"];
  const violenceHints = ["hurt yourself", "kill", "violencia", "自残", "伤害自己"];
  const contrabandHints = ["pharmaceutical", "fármaco", "处方药", "bulk resale"];

  if (jailbreakHints.some((h) => lower.includes(h))) {
    return { ...scenarioResults.jailbreak, latencyMs };
  }
  if (hateHints.some((h) => lower.includes(h))) {
    return { ...scenarioResults.hate, latencyMs };
  }
  if (violenceHints.some((h) => lower.includes(h))) {
    return { ...scenarioResults.violence, latencyMs };
  }
  if (contrabandHints.some((h) => lower.includes(h))) {
    return { ...scenarioResults.contraband, latencyMs };
  }

  const seed = hashText(text) % 100;
  if (seed > 72) {
    return {
      decision: "blocked",
      latencyMs,
      overallRisk: 0.62 + (seed % 20) / 100,
      breakdown: [
        { label: "Toxicity", score: 0.58 },
        { label: "Spam", score: 0.41 },
        { label: "Policy ambiguity", score: 0.33 },
      ],
      matchedPolicy: "POL-GENERIC-RISK · Review queue",
    };
  }

  return {
    decision: "passed",
    latencyMs,
    overallRisk: 0.08 + (seed % 12) / 100,
    breakdown: [
      { label: "Toxicity", score: 0.06 },
      { label: "Spam", score: 0.04 },
      { label: "PII exposure", score: 0.02 },
    ],
    matchedPolicy: "POL-ALLOW · Clean content",
  };
}

export const FREE_SANDBOX_LIMIT = 3;
export const SANDBOX_USAGE_KEY = "aegis_sandbox_usage";
export const SANDBOX_UNLOCK_KEY = "aegis_sandbox_unlocked";
