import type { Decision, RuleVersion } from "@/lib/platform/types";

export type InterceptHit = {
  ruleId: string;
  name: string;
  action: Decision;
};

export type InterceptResult = {
  status: "success" | "error";
  decision: Decision | null;
  hits: InterceptHit[];
  is_mock: true;
};

function keywordHit(text: string, terms: string[], mode: "contains" | "exact" | "word") {
  const hay = text.toLowerCase();
  return terms.some((term) => {
    const needle = term.trim().toLowerCase();
    if (!needle) return false;
    if (mode === "exact") return hay === needle;
    if (mode === "word") {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i").test(text);
    }
    return hay.includes(needle);
  });
}

function modelHit(text: string, operator: "gt" | "lt" | "eq", threshold: number) {
  const lower = text.toLowerCase();
  const score = lower.includes("demo_block_token") ? 920 : lower.includes("demo_review_token") ? 640 : 120;
  if (operator === "gt") return score > threshold;
  if (operator === "lt") return score < threshold;
  return score === threshold;
}

export function interceptText(text: string, versions: RuleVersion[]): InterceptResult {
  const hits: InterceptHit[] = [];
  for (const version of versions) {
    const config = version.config;
    try {
      let matched = false;
      if (config.type === "keyword") {
        matched = keywordHit(text, config.terms, config.matchMode);
      } else if (config.type === "ignore_term") {
        matched = keywordHit(text, config.terms, config.matchMode === "exact" ? "exact" : "contains");
      } else if (config.type === "regex") {
        const flags = config.flags.replace(/[^gimsuy]/g, "").slice(0, 6);
        matched = new RegExp(config.pattern, flags).test(text);
      } else if (config.type === "structured") {
        const value = config.value.toLowerCase();
        const hay = text.toLowerCase();
        if (config.operator === "contains") matched = hay.includes(value);
        else if (config.operator === "eq") matched = hay === value;
        else if (config.operator === "neq") matched = hay !== value;
        else if (config.operator === "gt") matched = Number(text) > Number(config.value);
        else matched = Number(text) < Number(config.value);
      } else {
        matched = modelHit(text, config.operator, config.threshold);
      }
      if (matched) {
        hits.push({
          ruleId: version.ruleId,
          name: version.name,
          action: config.type === "ignore_term" ? "allow" : version.action,
        });
      }
    } catch {
      return { status: "error", decision: null, hits: [], is_mock: true };
    }
  }
  const decision: Decision = hits.some((hit) => hit.action === "block")
    ? "block"
    : hits.some((hit) => hit.action === "review")
      ? "review"
      : "allow";
  return { status: "success", decision, hits, is_mock: true };
}
