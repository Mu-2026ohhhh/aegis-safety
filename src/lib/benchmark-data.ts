export type BenchmarkRow = {
  model: string;
  provider: string;
  jailbreak: number;
  sensitive: number;
  privacy: number;
  overall: number;
};

export const benchmarkRows: BenchmarkRow[] = [
  {
    model: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    jailbreak: 94,
    sensitive: 96,
    privacy: 93,
    overall: 94.3,
  },
  {
    model: "GPT-4o",
    provider: "OpenAI",
    jailbreak: 91,
    sensitive: 93,
    privacy: 90,
    overall: 91.3,
  },
  {
    model: "Gemini 1.5 Pro",
    provider: "Google",
    jailbreak: 88,
    sensitive: 91,
    privacy: 89,
    overall: 89.3,
  },
  {
    model: "Llama 3.1 405B",
    provider: "Meta",
    jailbreak: 82,
    sensitive: 85,
    privacy: 84,
    overall: 83.7,
  },
  {
    model: "Mistral Large 2",
    provider: "Mistral",
    jailbreak: 80,
    sensitive: 84,
    privacy: 82,
    overall: 82.0,
  },
  {
    model: "Qwen2.5 72B",
    provider: "Alibaba",
    jailbreak: 79,
    sensitive: 83,
    privacy: 81,
    overall: 81.0,
  },
];

export const BENCHMARK_UPDATED_AT = "2026-03-01";
